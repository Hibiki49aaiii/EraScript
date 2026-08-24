import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  createMultichainSigningRequest,
  type MultichainSigningRequest,
  type VerifiedMultichainSignature,
} from "./external-signer.js";
import { solanaAddress, type SolanaAddress } from "./solana.js";
import type { SolanaVerifiedPreparedTransaction } from "./solana-adapter.js";
import type { SolanaChainProfile } from "./types.js";

export interface SolanaSigningInspection {
  readonly signingPayloadBase64: string;
  readonly requiredSigners: readonly string[];
  readonly feePayer: string;
}

export type SolanaSigningInspector = (serializedTransaction: Uint8Array) => SolanaSigningInspection | Promise<SolanaSigningInspection>;

export interface SolanaSigningPlan {
  readonly kind: "solana-signing-plan";
  readonly profileId: string;
  readonly transactionBindingHash: string;
  readonly signingPayloadBase64: string;
  readonly payloadHash: string;
  readonly feePayer: SolanaAddress;
  readonly requiredSigners: readonly SolanaAddress[];
}

export interface SolanaSignerRequest {
  readonly signer: SolanaAddress;
  readonly role: "fee-payer" | "transaction-signer";
  readonly request: MultichainSigningRequest;
}

export interface SolanaSignatureSetEvidence {
  readonly kind: "solana-signature-set-evidence";
  readonly plan: SolanaSigningPlan;
  readonly signatures: readonly {
    readonly signer: SolanaAddress;
    readonly role: "fee-payer" | "transaction-signer";
    readonly signature: VerifiedMultichainSignature;
  }[];
  readonly complete: true;
  readonly evidenceHash: string;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function canonicalBase64(value: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) fail("ES4580", "InvalidSolanaSigningPayload", "Solana signing payload must be canonical base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) fail("ES4580", "InvalidSolanaSigningPayload", "Solana signing payload is empty or malformed.");
  return value;
}
function sha256(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}
function base64Bytes(value: string): Uint8Array {
  return Buffer.from(canonicalBase64(value), "base64");
}

export async function createSolanaSigningPlan(profile: SolanaChainProfile, transaction: SolanaVerifiedPreparedTransaction, inspector: SolanaSigningInspector): Promise<SolanaSigningPlan> {
  if (transaction.profileId !== profile.id) fail("ES4581", "SolanaSigningProfileMismatch", "Solana transaction belongs to a different chain profile.", { transactionProfile: transaction.profileId, profile: profile.id });
  let inspection: SolanaSigningInspection;
  try { inspection = await inspector(base64Bytes(transaction.serializedBase64)); }
  catch (error) { return fail("ES4582", "SolanaSigningInspectionFailed", "Failed to derive the Solana signing payload/signer set from serialized transaction bytes.", { cause: error instanceof Error ? error.message : String(error) }); }
  const signingPayloadBase64 = canonicalBase64(inspection.signingPayloadBase64);
  if (inspection.requiredSigners.length === 0) fail("ES4583", "MissingSolanaRequiredSigners", "Solana signing plan must contain at least one required signer.");
  const requiredSigners = inspection.requiredSigners.map(solanaAddress);
  if (new Set(requiredSigners).size !== requiredSigners.length) fail("ES4584", "DuplicateSolanaRequiredSigner", "Solana signing plan contains duplicate required signer addresses.");
  const feePayer = solanaAddress(inspection.feePayer);
  if (requiredSigners[0] !== feePayer) fail("ES4585", "SolanaFeePayerSignerOrderMismatch", "Solana fee payer must be the first required signer in the decoded message header/account order.", { feePayer, firstSigner: requiredSigners[0] });
  if (transaction.inspection.signerCount !== undefined && transaction.inspection.signerCount !== requiredSigners.length) fail("ES4586", "SolanaSignerCountMismatch", "Signing inspector signer set does not match the serialized transaction inspection signer count.", { expected: transaction.inspection.signerCount, actual: requiredSigners.length });
  return {
    kind: "solana-signing-plan",
    profileId: profile.id,
    transactionBindingHash: transaction.bindingHash,
    signingPayloadBase64,
    payloadHash: sha256(`solana-signing-payload:${signingPayloadBase64}`),
    feePayer,
    requiredSigners,
  };
}

export function createSolanaSigningRequests(profile: SolanaChainProfile, plan: SolanaSigningPlan, options: { ttlMs?: number; nowMs?: number } = {}): readonly SolanaSignerRequest[] {
  if (plan.profileId !== profile.id) fail("ES4581", "SolanaSigningProfileMismatch", "Solana signing plan belongs to a different chain profile.", { planProfile: plan.profileId, profile: profile.id });
  return plan.requiredSigners.map((signer, index) => {
    const role = index === 0 ? "fee-payer" as const : "transaction-signer" as const;
    const request = createMultichainSigningRequest({
      profile,
      role,
      signer,
      payload: plan.signingPayloadBase64,
      payloadEncoding: "base64",
      context: { kind: "solana-transaction-message", transactionBindingHash: plan.transactionBindingHash, payloadHash: plan.payloadHash, signerIndex: index, requiredSigners: plan.requiredSigners },
      ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    });
    return { signer, role, request };
  });
}

export function bindSolanaVerifiedSignatures(plan: SolanaSigningPlan, requests: readonly SolanaSignerRequest[], signatures: readonly VerifiedMultichainSignature[]): SolanaSignatureSetEvidence {
  if (requests.length !== plan.requiredSigners.length || signatures.length !== plan.requiredSigners.length) fail("ES4587", "IncompleteSolanaSignatureSet", "Solana signature set must contain exactly one verified signature for every required signer.", { required: plan.requiredSigners.length, requests: requests.length, signatures: signatures.length });
  const bound = plan.requiredSigners.map((signer, index) => {
    const requestEntry = requests[index];
    const signature = signatures[index];
    if (!requestEntry || !signature) return fail("ES4587", "IncompleteSolanaSignatureSet", "Solana signature set is missing a required signer entry.", { index });
    if (requestEntry.signer !== signer || requestEntry.request.signer !== signer || signature.request.signer !== signer || signature.response.signer !== signer) fail("ES4588", "SolanaSignerIdentityMismatch", "Verified Solana signature does not belong to the required signer at this message position.", { index, expected: signer });
    if (signature.request.requestId !== requestEntry.request.requestId || signature.request.family !== "solana" || signature.request.profileId !== plan.profileId) fail("ES4589", "SolanaSigningRequestMismatch", "Verified Solana signature belongs to a different request/profile.", { index, signer });
    if (signature.request.payload !== plan.signingPayloadBase64 || signature.request.payloadEncoding !== "base64" || signature.response.payloadHash !== requestEntry.request.payloadHash || signature.response.contextHash !== requestEntry.request.contextHash) fail("ES4589", "SolanaSigningRequestMismatch", "Verified Solana signature is not bound to the exact message bytes/context.", { index, signer });
    return { signer, role: requestEntry.role, signature };
  });
  const evidenceHash = sha256(JSON.stringify({
    payloadHash: plan.payloadHash,
    requiredSigners: plan.requiredSigners,
    signatures: bound.map((entry) => ({ signer: entry.signer, role: entry.role, signature: entry.signature.response.signature })),
  }));
  return { kind: "solana-signature-set-evidence", plan, signatures: bound, complete: true, evidenceHash };
}
