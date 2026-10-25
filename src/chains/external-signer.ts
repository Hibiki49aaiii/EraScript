import { createHash, randomBytes } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import { immutableSnapshot } from "../internal/snapshot.js";
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
  if (typeof payload !== "string" || payload.length > 2_000_000 || !["base64", "hex", "utf8"].includes(encoding)) fail("ES4530", "InvalidSigningPayload", "Signing payload encoding/size is invalid.");
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
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 10 * 60_000 || !Number.isSafeInteger(nowMs + ttlMs)) fail("ES4532", "InvalidSigningRequestLifetime", "Signing request TTL must be a positive safe integer no longer than 10 minutes.", { nowMs, ttlMs });
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

// Process-local accidental replay guard. The authority must also persist consumption
// across processes/restarts. This cache is deliberately bounded and fails closed.
const consumed = new Map<string, number>();

export async function signWithMultichainExternalSigner(input: {
  signer: MultichainExternalSigner;
  request: MultichainSigningRequest;
  verifier: MultichainSignatureVerifier;
  verifierName: string;
  nowMs?: number;
  /** Trusted clock injection for tests/hosts; never accept a clock from untrusted input. */
  clock?: () => number;
}): Promise<VerifiedMultichainSignature> {
  const request = immutableSnapshot(input.request);
  const verifier = input.verifier;
  const verifierName = input.verifierName;
  validPayload(request.payload, request.payloadEncoding);
  if (request.kind !== "multichain-signing-request"
    || request.payloadHash !== hash(`${request.payloadEncoding}:${request.payload}`)
    || !/^0x[0-9a-f]{64}$/.test(request.contextHash)
    || !/^[0-9a-fA-F-]{8,128}$/.test(request.requestId)
    || !/^[0-9a-fA-F]{32,128}$/.test(request.challenge)
    || ![request.signer, request.network, request.profileId, verifierName].every((v) => typeof v === "string" && v.trim().length > 0)
    || !["evm", "solana", "sui"].includes(request.family)
    || !["transaction-signer", "fee-payer", "sender", "gas-owner", "sponsor", "authority"].includes(request.role)) {
    fail("ES4900", "InvalidExternalSigningRequest", "External signing request has invalid identity, payload hash, or binding fields.");
  }
  const ttl = request.expiresAtMs - request.createdAtMs;
  if (!Number.isSafeInteger(request.createdAtMs) || request.createdAtMs < 0 || !Number.isSafeInteger(request.expiresAtMs) || ttl <= 0 || ttl > 600_000) fail("ES4532", "InvalidSigningRequestLifetime", "External signing request has invalid lifetime bounds.");
  const clock = input.clock ?? (input.nowMs === undefined ? Date.now : () => input.nowMs!);
  const startedAt = clock();
  const monotonicStart = performance.now();
  const assertLive = (): void => {
    const observed = clock();
    const now = Math.max(observed, startedAt + performance.now() - monotonicStart);
    if (!Number.isFinite(observed) || !Number.isSafeInteger(startedAt) || observed < startedAt || now < request.createdAtMs || now >= request.expiresAtMs) {
      fail("ES4535", "SigningRequestExpired", "Signing request is not live at the verifier's current clock.");
    }
  };
  assertLive();
  for (const [key, expiry] of consumed) if (expiry <= monotonicStart) consumed.delete(key);
  const scope = `${request.family}:${request.network}:${request.signer}:`;
  const keys = [`${scope}id:${request.requestId.toLowerCase()}`, `${scope}challenge:${request.challenge.toLowerCase()}`];
  if (keys.some((key) => consumed.has(key))) fail("ES4901", "SigningRequestAlreadyConsumed", "Signing request ID or challenge was already reserved in this process.");
  if (consumed.size + keys.length > 10_000) fail("ES4902", "SigningReplayCacheFull", "Signing replay guard capacity reached; wait for request expiry.");
  // Reserve before awaiting. Even failure consumes the request to prevent retries
  // after an ambiguous authority response; a retry needs a new request/challenge.
  for (const key of keys) consumed.set(key, monotonicStart + request.expiresAtMs - startedAt);
  const withinDeadline = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertLive();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expiry = new Promise<never>((_resolve, reject) => {
        const remaining = request.expiresAtMs - Math.max(clock(), startedAt + performance.now() - monotonicStart);
        timer = setTimeout(() => reject(new EraDiagnosticError({ code: "ES4535", severity: "error", kind: "SigningRequestExpired", message: "External signing operation exceeded the request deadline." })), Math.max(1, Math.ceil(remaining)));
      });
      return await Promise.race([operation(), expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const response = immutableSnapshot(await withinDeadline(() => input.signer.sign(request)));
  assertLive();
  if (!response || response.kind !== "multichain-signing-response" || response.requestId !== request.requestId || response.payloadHash !== request.payloadHash || response.contextHash !== request.contextHash || response.challenge !== request.challenge) {
    fail("ES4536", "SigningResponseBindingMismatch", "External signer response is not bound to the exact request payload/context/challenge.", { requestId: request.requestId });
  }
  if (response.signer !== request.signer) fail("ES4537", "SigningResponseIdentityMismatch", "External signer response claims a different signer identity.");
  if (!Number.isSafeInteger(response.respondedAtMs) || response.respondedAtMs < request.createdAtMs || response.respondedAtMs >= request.expiresAtMs) fail("ES4538", "SigningResponseTimeInvalid", "External signer response timestamp is outside the request lifetime.");
  if (typeof response.signature !== "string" || !response.signature) fail("ES4539", "MissingExternalSignature", "External signer returned an empty signature.");
  const verified = await withinDeadline(() => Promise.resolve(verifier({ request, response })));
  assertLive();
  if (verified !== true) fail("ES4540", "MultichainSignatureVerificationFailed", "Family-specific verifier rejected the external signature or signed payload.", { verifier: verifierName, signer: request.signer });
  return Object.freeze({ kind: "verified-multichain-signature", request, response, verifier: verifierName, verified: true });
}

export function solanaSigningIdentity(address: SolanaAddress): string { return address; }
export function suiSigningIdentity(address: SuiAddress): string { return address; }
