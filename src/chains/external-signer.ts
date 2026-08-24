import { createHash, randomBytes } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import type { SolanaAddress } from "./solana.js";
import type { SuiAddress } from "./sui.js";
import type { ChainFamily, ChainProfile } from "./types.js";

export type MultichainSignerRole = "transaction-signer" | "fee-payer" | "sender" | "gas-owner" | "sponsor" | "authority";
export type SigningPayloadEncoding = "base64" | "hex" | "utf8";

export interface MultichainSigningRequest {
  readonly kind: "multichain-signing-request";
  readonly requestId: string;
  readonly family: ChainFamily;
  readonly profileId: string;
  readonly network: string;
  readonly role: MultichainSignerRole;
  readonly signer: string;
  readonly payload: string;
  readonly payloadEncoding: SigningPayloadEncoding;
  readonly payloadHash: string;
  readonly contextHash: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly challenge: string;
}

export interface MultichainSigningResponse {
  readonly kind: "multichain-signing-response";
  readonly requestId: string;
  readonly payloadHash: string;
  readonly contextHash: string;
  readonly challenge: string;
  readonly signer: string;
  readonly signature: string;
  readonly signedPayload?: string;
  readonly respondedAtMs: number;
}

export interface MultichainExternalSigner {
  readonly id?: string;
  sign(request: MultichainSigningRequest): Promise<MultichainSigningResponse>;
}

export type MultichainSignatureVerifier = (input: {
  readonly request: MultichainSigningRequest;
  readonly response: MultichainSigningResponse;
}) => boolean | Promise<boolean>;

export interface VerifiedMultichainSignature {
  readonly kind: "verified-multichain-signature";
  readonly request: MultichainSigningRequest;
  readonly response: MultichainSigningResponse;
  readonly verifier: string;
  readonly verified: true;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function hash(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, normalize(inner)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

function validPayload(payload: string, encoding: SigningPayloadEncoding): void {
  if (encoding === "base64") {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4 !== 0 || Buffer.from(payload, "base64").toString("base64") !== payload) fail("ES4530", "InvalidSigningPayload", "Signing payload is not canonical base64.");
    return;
  }
  if (encoding === "hex") {
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) fail("ES4530", "InvalidSigningPayload", "Signing payload must be non-empty whole-byte 0x-prefixed hexadecimal.");
    return;
  }
  if (payload.length === 0) fail("ES4530", "InvalidSigningPayload", "Signing payload cannot be empty.");
}

export function createMultichainSigningRequest(input: {
  profile: ChainProfile;
  role: MultichainSignerRole;
  signer: string;
  payload: string;
  payloadEncoding: SigningPayloadEncoding;
  context: unknown;
  ttlMs?: number;
  nowMs?: number;
  requestId?: string;
  challenge?: string;
}): MultichainSigningRequest {
  validPayload(input.payload, input.payloadEncoding);
  if (!input.signer) fail("ES4531", "MissingSigningIdentity", "External signing request requires an explicit signer identity.");
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? 60_000;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 10 * 60_000) fail("ES4532", "InvalidSigningRequestLifetime", "Signing request TTL must be a positive safe integer no longer than 10 minutes.", { nowMs, ttlMs });
  const requestId = input.requestId ?? randomBytes(16).toString("hex");
  const challenge = input.challenge ?? randomBytes(32).toString("hex");
  if (!/^[0-9a-fA-F-]{8,128}$/.test(requestId)) fail("ES4533", "InvalidSigningRequestId", "Signing request ID must be stable ASCII hex/UUID-like text.", { requestId });
  if (!/^[0-9a-fA-F]{32,128}$/.test(challenge)) fail("ES4534", "InvalidSigningChallenge", "Signing challenge must contain at least 128 bits of hexadecimal entropy.");
  return {
    kind: "multichain-signing-request",
    requestId,
    family: input.profile.family,
    profileId: input.profile.id,
    network: input.profile.network,
    role: input.role,
    signer: input.signer,
    payload: input.payload,
    payloadEncoding: input.payloadEncoding,
    payloadHash: hash(`${input.payloadEncoding}:${input.payload}`),
    contextHash: hash(stable({ family: input.profile.family, profileId: input.profile.id, network: input.profile.network, role: input.role, signer: input.signer, context: input.context })),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    challenge,
  };
}

export async function signWithMultichainExternalSigner(input: {
  signer: MultichainExternalSigner;
  request: MultichainSigningRequest;
  verifier: MultichainSignatureVerifier;
  verifierName: string;
  nowMs?: number;
}): Promise<VerifiedMultichainSignature> {
  const nowMs = input.nowMs ?? Date.now();
  if (nowMs > input.request.expiresAtMs) fail("ES4535", "SigningRequestExpired", "External signing request expired before signing.", { requestId: input.request.requestId, expiresAtMs: input.request.expiresAtMs, nowMs });
  const response = await input.signer.sign(input.request);
  if (response.requestId !== input.request.requestId || response.payloadHash !== input.request.payloadHash || response.contextHash !== input.request.contextHash || response.challenge !== input.request.challenge) {
    fail("ES4536", "SigningResponseBindingMismatch", "External signer response is not bound to the exact request payload/context/challenge.", { requestId: input.request.requestId });
  }
  if (response.signer !== input.request.signer) fail("ES4537", "SigningResponseIdentityMismatch", "External signer response claims a different signer identity.", { expected: input.request.signer, actual: response.signer });
  if (!Number.isSafeInteger(response.respondedAtMs) || response.respondedAtMs < input.request.createdAtMs || response.respondedAtMs > input.request.expiresAtMs) fail("ES4538", "SigningResponseTimeInvalid", "External signer response timestamp is outside the request lifetime.", { respondedAtMs: response.respondedAtMs, createdAtMs: input.request.createdAtMs, expiresAtMs: input.request.expiresAtMs });
  if (!response.signature) fail("ES4539", "MissingExternalSignature", "External signer returned an empty signature.");
  const verified = await input.verifier({ request: input.request, response });
  if (!verified) fail("ES4540", "MultichainSignatureVerificationFailed", "Family-specific verifier rejected the external signature or signed payload.", { verifier: input.verifierName, signer: input.request.signer });
  return { kind: "verified-multichain-signature", request: input.request, response, verifier: input.verifierName, verified: true };
}

export function solanaSigningIdentity(address: SolanaAddress): string { return address; }
export function suiSigningIdentity(address: SuiAddress): string { return address; }
