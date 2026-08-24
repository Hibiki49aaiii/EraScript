import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  createMultichainSigningRequest,
  type MultichainSigningRequest,
  type VerifiedMultichainSignature,
} from "./external-signer.js";
import {
  executeSuiTransaction,
  type SuiClientLike,
  type SuiExecutedTransaction,
  type SuiExecutionFailedTransaction,
  type SuiSimulationEvidence,
  type SuiVerifiedPreparedTransaction,
} from "./sui-adapter.js";
import type { SuiAddress } from "./sui.js";
import type { SuiChainProfile } from "./types.js";

export interface SuiSponsoredSigningPlan {
  readonly kind: "sui-sponsored-signing-plan";
  readonly profileId: string;
  readonly sender: SuiAddress;
  readonly sponsor: SuiAddress;
  readonly transaction: SuiVerifiedPreparedTransaction;
  readonly payloadBase64: string;
  readonly payloadHash: string;
}

export interface SuiSponsoredSigningRequests {
  readonly kind: "sui-sponsored-signing-requests";
  readonly plan: SuiSponsoredSigningPlan;
  readonly senderRequest: MultichainSigningRequest;
  readonly sponsorRequest: MultichainSigningRequest;
}

export interface SuiSponsoredSignatureEvidence {
  readonly kind: "sui-sponsored-signature-evidence";
  readonly plan: SuiSponsoredSigningPlan;
  readonly senderSignature: VerifiedMultichainSignature;
  readonly sponsorSignature: VerifiedMultichainSignature;
  readonly exactPayloadMatch: true;
  readonly evidenceHash: string;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function sha256(value: string): string {
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

export function createSuiSponsoredSigningPlan(profile: SuiChainProfile, transaction: SuiVerifiedPreparedTransaction): SuiSponsoredSigningPlan {
  if (transaction.profileId !== profile.id) fail("ES4570", "SuiSponsorshipProfileMismatch", "Sui sponsored transaction belongs to a different chain profile.", { transactionProfile: transaction.profileId, profile: profile.id });
  if (transaction.sender === transaction.gasOwner) fail("ES4571", "SuiSponsorshipNotRequired", "Sponsored Sui signing requires sender and gas owner to be different addresses.", { sender: transaction.sender });
  const payloadBase64 = transaction.serializedBase64;
  const payloadHash = sha256(`sui-transaction-bytes:${payloadBase64}`);
  return { kind: "sui-sponsored-signing-plan", profileId: profile.id, sender: transaction.sender, sponsor: transaction.gasOwner, transaction, payloadBase64, payloadHash };
}

export function createSuiSponsoredSigningRequests(profile: SuiChainProfile, plan: SuiSponsoredSigningPlan, options: { ttlMs?: number; nowMs?: number } = {}): SuiSponsoredSigningRequests {
  if (plan.profileId !== profile.id) fail("ES4570", "SuiSponsorshipProfileMismatch", "Sui sponsored signing plan belongs to a different profile.", { planProfile: plan.profileId, profile: profile.id });
  const requestOptions = { ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}), ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}) };
  const senderRequest = createMultichainSigningRequest({
    profile, role: "sender", signer: plan.sender, payload: plan.payloadBase64, payloadEncoding: "base64",
    context: { kind: "sui-sponsored-transaction", role: "sender", bindingHash: plan.transaction.bindingHash, payloadHash: plan.payloadHash, counterparty: plan.sponsor },
    ...requestOptions,
  });
  const sponsorRequest = createMultichainSigningRequest({
    profile, role: "sponsor", signer: plan.sponsor, payload: plan.payloadBase64, payloadEncoding: "base64",
    context: { kind: "sui-sponsored-transaction", role: "sponsor", bindingHash: plan.transaction.bindingHash, payloadHash: plan.payloadHash, counterparty: plan.sender },
    ...requestOptions,
  });
  return { kind: "sui-sponsored-signing-requests", plan, senderRequest, sponsorRequest };
}

function assertSignatureMatchesRequest(signature: VerifiedMultichainSignature, request: MultichainSigningRequest, label: string): void {
  if (signature.request.requestId !== request.requestId) fail("ES4572", "SuiSponsoredSignatureRequestMismatch", `${label} signature belongs to a different signing request.`, { expected: request.requestId, actual: signature.request.requestId });
  if (signature.request.family !== "sui" || signature.request.profileId !== request.profileId || signature.request.payload !== request.payload || signature.request.payloadEncoding !== "base64") fail("ES4572", "SuiSponsoredSignatureRequestMismatch", `${label} signature is not bound to the exact Sui transaction bytes/profile.`);
  if (signature.response.payloadHash !== request.payloadHash || signature.response.contextHash !== request.contextHash || signature.response.signer !== request.signer) fail("ES4572", "SuiSponsoredSignatureRequestMismatch", `${label} signature response binding differs from the expected request.`);
}

export function bindSuiSponsoredSignatures(requests: SuiSponsoredSigningRequests, input: { senderSignature: VerifiedMultichainSignature; sponsorSignature: VerifiedMultichainSignature }): SuiSponsoredSignatureEvidence {
  assertSignatureMatchesRequest(input.senderSignature, requests.senderRequest, "Sender");
  assertSignatureMatchesRequest(input.sponsorSignature, requests.sponsorRequest, "Sponsor");
  if (input.senderSignature.request.signer !== requests.plan.sender || input.sponsorSignature.request.signer !== requests.plan.sponsor) fail("ES4573", "SuiSponsoredSignerIdentityMismatch", "Sui sponsored signatures do not match sender/gas-owner identities.");
  if (input.senderSignature.request.payload !== input.sponsorSignature.request.payload || input.senderSignature.request.payload !== requests.plan.payloadBase64) fail("ES4574", "SuiSponsoredPayloadMismatch", "Sender and sponsor did not authorize exactly the same final Sui transaction bytes.");
  const evidenceHash = sha256(stable({ planPayloadHash: requests.plan.payloadHash, sender: requests.plan.sender, sponsor: requests.plan.sponsor, senderSignature: input.senderSignature.response.signature, sponsorSignature: input.sponsorSignature.response.signature }));
  return { kind: "sui-sponsored-signature-evidence", plan: requests.plan, senderSignature: input.senderSignature, sponsorSignature: input.sponsorSignature, exactPayloadMatch: true, evidenceHash };
}

export function assertSuiSponsoredSimulationMatches(evidence: SuiSponsoredSignatureEvidence, simulation: SuiSimulationEvidence): SuiSimulationEvidence & { readonly success: true; readonly checksEnabled: true } {
  if (simulation.transaction.bindingHash !== evidence.plan.transaction.bindingHash || simulation.transaction.serializedBase64 !== evidence.plan.payloadBase64) fail("ES4575", "SuiSponsoredSimulationMismatch", "Simulation evidence does not belong to the exact Sui bytes authorized by sender and sponsor.");
  if (!simulation.success || !simulation.checksEnabled) fail("ES4576", "SuiSponsoredSimulationNotExecutionReady", "Sponsored Sui execution requires a successful checks-enabled simulation of the exact signed bytes.");
  return simulation as SuiSimulationEvidence & { readonly success: true; readonly checksEnabled: true };
}

export async function executeSuiSponsoredTransaction(client: SuiClientLike, simulation: SuiSimulationEvidence, evidence: SuiSponsoredSignatureEvidence): Promise<SuiExecutedTransaction | SuiExecutionFailedTransaction> {
  const checked = assertSuiSponsoredSimulationMatches(evidence, simulation);
  return executeSuiTransaction(client, checked, [evidence.senderSignature.response.signature, evidence.sponsorSignature.response.signature]);
}
