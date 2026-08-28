import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  createMultichainSigningRequest,
  type MultichainSigningRequest,
  type VerifiedMultichainSignature,
} from "./external-signer.js";
import { solanaAddress, type SolanaAddress } from "./solana.js";
import {
  prepareSolanaDurableNonceSerializedTransaction,
  prepareSolanaSerializedTransaction,
  verifySolanaSerializedTransaction,
  type SolanaExecutionReadyTransaction,
  type SolanaTransactionInspector,
  type SolanaVerifiedPreparedTransaction,
} from "./solana-adapter.js";
import type { SolanaChainProfile } from "./types.js";

export interface SolanaSigningInspection {
  readonly signingPayloadBase64: string;
  readonly requiredSigners: readonly string[];
  readonly feePayer: string;
}

export type SolanaSigningInspector = (serializedTransaction: Uint8Array) => SolanaSigningInspection | Promise<SolanaSigningInspection>;

export interface SolanaSigningEvidenceBinding {
  readonly kind: string;
  readonly hash: string;
}

export interface SolanaSigningPlan {
  readonly kind: "solana-signing-plan";
  readonly profileId: string;
  readonly transactionBindingHash: string;
  readonly signingPayloadBase64: string;
  readonly payloadHash: string;
  readonly feePayer: SolanaAddress;
  readonly requiredSigners: readonly SolanaAddress[];
  readonly evidenceBindings: readonly SolanaSigningEvidenceBinding[];
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

export interface SolanaSignedTransactionAssembler {
  assemble(input: {
    readonly serializedTransaction: Uint8Array;
    readonly signatures: readonly { readonly signer: SolanaAddress; readonly signature: string }[];
  }): string | Promise<string>;
}

export interface SolanaAssembledSignedTransaction {
  readonly kind: "solana-assembled-signed-transaction";
  readonly source: SolanaVerifiedPreparedTransaction;
  readonly signatureSet: SolanaSignatureSetEvidence;
  readonly transaction: SolanaExecutionReadyTransaction;
  readonly assemblyHash: string;
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
function sameSigners(a: readonly SolanaAddress[], b: readonly SolanaAddress[]): boolean {
  return a.length === b.length && a.every((signer, index) => signer === b[index]);
}

export async function createSolanaSigningPlan(
  profile: SolanaChainProfile,
  transaction: SolanaVerifiedPreparedTransaction,
  inspector: SolanaSigningInspector,
  evidenceBindings: readonly SolanaSigningEvidenceBinding[] = [],
): Promise<SolanaSigningPlan> {
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
  const automaticBindings: SolanaSigningEvidenceBinding[] = transaction.lifetimeKind === "durable-nonce"
    ? [{ kind: "durable-nonce", hash: transaction.durableNonce.bindingHash }]
    : [];
  const combinedBindings = [...automaticBindings, ...evidenceBindings];
  const byKind = new Map<string, string>();
  for (const binding of combinedBindings) {
    const existing = byKind.get(binding.kind);
    if (existing && existing.toLowerCase() !== binding.hash.toLowerCase()) {
      fail("ES4637", "ConflictingSolanaSigningEvidenceBinding", "Solana signing plan contains conflicting evidence hashes for the same semantic binding kind.", {
        kind: binding.kind,
        existing,
        incoming: binding.hash,
      });
    }
    byKind.set(binding.kind, binding.hash);
  }
  const normalizedBindings = [...byKind.entries()].map(([kind, hash]) => ({ kind, hash })).map((binding) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(binding.kind) || !/^0x[0-9a-fA-F]{64}$/.test(binding.hash)) {
      return fail("ES4636", "InvalidSolanaSigningEvidenceBinding", "Solana signing evidence bindings require a stable kind and 32-byte hash.", { kind: binding.kind, hash: binding.hash });
    }
    return { kind: binding.kind, hash: binding.hash.toLowerCase() };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.hash.localeCompare(b.hash));
  return {
    kind: "solana-signing-plan",
    profileId: profile.id,
    transactionBindingHash: transaction.bindingHash,
    signingPayloadBase64,
    payloadHash: sha256(`solana-signing-payload:${signingPayloadBase64}`),
    feePayer,
    requiredSigners,
    evidenceBindings: normalizedBindings,
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
      context: { kind: "solana-transaction-message", transactionBindingHash: plan.transactionBindingHash, payloadHash: plan.payloadHash, signerIndex: index, requiredSigners: plan.requiredSigners, evidenceBindings: plan.evidenceBindings },
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
    evidenceBindings: plan.evidenceBindings,
    signatures: bound.map((entry) => ({ signer: entry.signer, role: entry.role, signature: entry.signature.response.signature })),
  }));
  return { kind: "solana-signature-set-evidence", plan, signatures: bound, complete: true, evidenceHash };
}

export async function assembleAndVerifySolanaSignedTransaction(input: {
  profile: SolanaChainProfile;
  source: SolanaVerifiedPreparedTransaction;
  signatureSet: SolanaSignatureSetEvidence;
  assembler: SolanaSignedTransactionAssembler;
  transactionInspector: SolanaTransactionInspector;
  signingInspector: SolanaSigningInspector;
}): Promise<SolanaAssembledSignedTransaction> {
  if (input.source.profileId !== input.profile.id || input.signatureSet.plan.profileId !== input.profile.id) fail("ES4630", "SolanaAssemblySourceMismatch", "Solana source transaction/signature set belong to a different chain profile.", { profile: input.profile.id, sourceProfile: input.source.profileId, signingProfile: input.signatureSet.plan.profileId });
  if (input.signatureSet.plan.transactionBindingHash !== input.source.bindingHash) fail("ES4630", "SolanaAssemblySourceMismatch", "Solana signature set was produced for a different transaction binding.", { sourceBindingHash: input.source.bindingHash, signatureBindingHash: input.signatureSet.plan.transactionBindingHash });

  let assembledBase64: string;
  try {
    assembledBase64 = canonicalBase64(await input.assembler.assemble({
      serializedTransaction: base64Bytes(input.source.serializedBase64),
      signatures: input.signatureSet.signatures.map((entry) => ({ signer: entry.signer, signature: entry.signature.response.signature })),
    }));
  } catch (error) {
    if (error instanceof EraDiagnosticError) throw error;
    return fail("ES4631", "SolanaTransactionAssemblyFailed", "Failed to assemble verified Solana signatures into the wire transaction.", { cause: error instanceof Error ? error.message : String(error) });
  }

  const prepared = input.source.lifetimeKind === "recent-blockhash"
    ? prepareSolanaSerializedTransaction({
        profile: input.profile,
        serializedBase64: assembledBase64,
        version: input.source.version,
        recentBlockhash: input.source.recentBlockhash,
      })
    : prepareSolanaDurableNonceSerializedTransaction({
        profile: input.profile,
        serializedBase64: assembledBase64,
        version: input.source.version,
        durableNonce: input.source.durableNonce,
      });
  const verified = await verifySolanaSerializedTransaction(prepared, input.transactionInspector);
  const assembledPlan = await createSolanaSigningPlan(input.profile, verified, input.signingInspector, input.signatureSet.plan.evidenceBindings);

  if (assembledPlan.signingPayloadBase64 !== input.signatureSet.plan.signingPayloadBase64 || assembledPlan.payloadHash !== input.signatureSet.plan.payloadHash) fail("ES4632", "SolanaAssembledPayloadMismatch", "Final signed Solana wire transaction contains message bytes different from those authorized by the signers.", { expectedPayloadHash: input.signatureSet.plan.payloadHash, actualPayloadHash: assembledPlan.payloadHash });
  if (!sameSigners(assembledPlan.requiredSigners, input.signatureSet.plan.requiredSigners)) fail("ES4633", "SolanaAssembledSignerSetMismatch", "Final signed Solana wire transaction has a different required signer sequence.", { expected: input.signatureSet.plan.requiredSigners, actual: assembledPlan.requiredSigners });
  if (assembledPlan.feePayer !== input.signatureSet.plan.feePayer) fail("ES4634", "SolanaAssembledFeePayerMismatch", "Final signed Solana wire transaction has a different fee payer.", { expected: input.signatureSet.plan.feePayer, actual: assembledPlan.feePayer });

  const transaction: SolanaExecutionReadyTransaction = {
    ...verified,
    signatureAssemblyVerified: true,
    signatureEvidenceHash: input.signatureSet.evidenceHash,
    evidenceBindings: input.signatureSet.plan.evidenceBindings,
  };
  return {
    kind: "solana-assembled-signed-transaction",
    source: input.source,
    signatureSet: input.signatureSet,
    transaction,
    assemblyHash: sha256(JSON.stringify({ sourceBindingHash: input.source.bindingHash, signatureEvidenceHash: input.signatureSet.evidenceHash, finalBindingHash: transaction.bindingHash, serializedBase64: assembledBase64 })),
  };
}
