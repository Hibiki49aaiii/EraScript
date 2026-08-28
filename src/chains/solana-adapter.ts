import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  assertSolanaBlockhashFresh,
  solanaBlockhash,
  solanaRecentBlockhash,
  solanaTransactionSignature,
  type SolanaBlockhash,
  type SolanaCommitment,
  type SolanaRecentBlockhashEvidence,
  type SolanaTransactionSignature,
  type SolanaTransactionVersion,
} from "./solana.js";
import type { SolanaAddressLookupReference } from "./solana-alt.js";
import {
  assertSolanaDurableNonceStillCurrent,
  type SolanaDurableNonceBindingEvidence,
  type SolanaDurableNonceReader,
} from "./solana-durable-nonce.js";
import type { SolanaChainProfile } from "./types.js";

declare const solanaAdapterBrand: unique symbol;
export type SolanaTransactionBindingHash = string & { readonly [solanaAdapterBrand]: "SolanaTransactionBindingHash" };

export interface SolanaRpcPending<R> { send(): Promise<R>; }
export interface SolanaKitRpcLike {
  getGenesisHash?: () => SolanaRpcPending<string>;
  getLatestBlockhash?: (config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  getBlockHeight?: (config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  simulateTransaction?: (transaction: string, config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  sendTransaction?: (transaction: string, config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  getSignatureStatuses?: (signatures: readonly string[], config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
}
export interface SolanaKitClientLike { readonly rpc: SolanaKitRpcLike; }

export interface SolanaTransactionInspection {
  readonly version: SolanaTransactionVersion;
  readonly recentBlockhash: SolanaBlockhash;
  readonly signerCount?: number;
  readonly addressTableLookups?: readonly SolanaAddressLookupReference[];
}
export type SolanaTransactionInspector = (serializedTransaction: Uint8Array) => SolanaTransactionInspection | Promise<SolanaTransactionInspection>;

interface SolanaPreparedTransactionBase {
  readonly state: "solana-prepared";
  readonly profileId: string;
  readonly version: SolanaTransactionVersion;
  readonly serializedBase64: string;
  readonly bindingHash: SolanaTransactionBindingHash;
  readonly inspectionVerified: false;
}
export interface SolanaRecentPreparedTransaction extends SolanaPreparedTransactionBase {
  readonly lifetimeKind: "recent-blockhash";
  readonly recentBlockhash: SolanaRecentBlockhashEvidence;
}
export interface SolanaDurableNoncePreparedTransaction extends SolanaPreparedTransactionBase {
  readonly lifetimeKind: "durable-nonce";
  readonly durableNonce: SolanaDurableNonceBindingEvidence;
}
export type SolanaPreparedTransaction = SolanaRecentPreparedTransaction | SolanaDurableNoncePreparedTransaction;
export type SolanaVerifiedPreparedTransaction = (Omit<SolanaRecentPreparedTransaction, "inspectionVerified"> | Omit<SolanaDurableNoncePreparedTransaction, "inspectionVerified">) & {
  readonly inspectionVerified: true;
  readonly inspection: SolanaTransactionInspection;
};
export type SolanaExecutionReadyTransaction = SolanaVerifiedPreparedTransaction & {
  readonly signatureAssemblyVerified: true;
  readonly signatureEvidenceHash: string;
  readonly evidenceBindings: readonly { readonly kind: string; readonly hash: string }[];
};

export interface SolanaLifetimeGuardOptions {
  readonly durableNonceReader?: SolanaDurableNonceReader;
}

export interface SolanaPreSignSimulationEvidence {
  readonly state: "solana-pre-sign-simulated";
  readonly transaction: SolanaVerifiedPreparedTransaction;
  readonly commitment: SolanaCommitment;
  readonly signatureVerification: false;
  readonly success: boolean;
  readonly err?: unknown;
  readonly logs: readonly string[];
  readonly unitsConsumed?: bigint;
  readonly simulatedAtBlockHeight: bigint;
}
export interface SolanaSimulationEvidence {
  readonly state: "solana-simulated";
  readonly transaction: SolanaExecutionReadyTransaction;
  readonly commitment: SolanaCommitment;
  readonly signatureVerification: true;
  readonly success: boolean;
  readonly err?: unknown;
  readonly logs: readonly string[];
  readonly unitsConsumed?: bigint;
  readonly simulatedAtBlockHeight: bigint;
}
export interface SolanaSubmittedTransaction {
  readonly state: "solana-submitted";
  readonly simulation: SolanaSimulationEvidence & { readonly success: true };
  readonly signature: SolanaTransactionSignature;
  readonly submittedAtBlockHeight: bigint;
}
export interface SolanaSignatureStatusEvidence {
  readonly state: "solana-signature-status";
  readonly signature: SolanaTransactionSignature;
  readonly found: boolean;
  readonly slot?: bigint;
  readonly confirmationStatus?: SolanaCommitment;
  readonly confirmations?: bigint | null;
  readonly err?: unknown;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function integer(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4460", "MalformedSolanaRpcResponse", `Solana RPC field '${field}' must be a non-negative integer.`, { field, value: String(value) });
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4460", "MalformedSolanaRpcResponse", `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function responseValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in (value as Record<string, unknown>)) return (value as Record<string, unknown>).value;
  return value;
}
function base64Bytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) fail("ES4461", "InvalidSolanaSerializedTransaction", "Solana serialized transaction must be canonical base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) fail("ES4461", "InvalidSolanaSerializedTransaction", "Solana serialized transaction base64 is malformed or empty.");
  return bytes;
}
function bindingHash(serializedBase64: string, lifetime: { readonly kind: "recent-blockhash"; readonly value: SolanaRecentBlockhashEvidence } | { readonly kind: "durable-nonce"; readonly value: SolanaDurableNonceBindingEvidence }, version: SolanaTransactionVersion): SolanaTransactionBindingHash {
  const lifetimeBinding = lifetime.kind === "recent-blockhash"
    ? { kind: lifetime.kind, blockhash: lifetime.value.blockhash, lastValidBlockHeight: lifetime.value.lastValidBlockHeight.toString() }
    : { kind: lifetime.kind, nonce: lifetime.value.lifetimeToken, nonceAccount: lifetime.value.account.nonceAccount, bindingHash: lifetime.value.bindingHash };
  return `0x${createHash("sha256").update(JSON.stringify({ serializedBase64, lifetime: lifetimeBinding, version })).digest("hex")}` as SolanaTransactionBindingHash;
}
function expectedLifetimeToken(transaction: SolanaPreparedTransaction | SolanaVerifiedPreparedTransaction): SolanaBlockhash {
  return transaction.lifetimeKind === "recent-blockhash" ? transaction.recentBlockhash.blockhash : transaction.durableNonce.lifetimeToken;
}
async function assertLifetimeUsable(transaction: SolanaVerifiedPreparedTransaction, currentBlockHeight: bigint, options: SolanaLifetimeGuardOptions): Promise<void> {
  if (transaction.lifetimeKind === "recent-blockhash") {
    assertSolanaBlockhashFresh(transaction.recentBlockhash, currentBlockHeight);
    return;
  }
  if (!options.durableNonceReader) {
    fail("ES4710", "MissingSolanaDurableNonceReader", "Durable nonce simulation/submission requires a nonce-account reader for immediate revalidation.", {
      nonceAccount: transaction.durableNonce.account.nonceAccount,
    });
  }
  await assertSolanaDurableNonceStillCurrent(options.durableNonceReader, transaction.durableNonce);
}
function rpcMethod<K extends keyof SolanaKitRpcLike>(client: SolanaKitClientLike, name: K): NonNullable<SolanaKitRpcLike[K]> {
  const value = client.rpc[name];
  if (typeof value !== "function") fail("ES4462", "MissingSolanaKitRpcMethod", `@solana/kit-compatible RPC client does not expose '${String(name)}'.`, { method: String(name) });
  return value as NonNullable<SolanaKitRpcLike[K]>;
}

export async function assertSolanaKitNetwork(client: SolanaKitClientLike, profile: SolanaChainProfile, expectedGenesisHash?: string): Promise<string | undefined> {
  if (!expectedGenesisHash) return undefined;
  const getGenesisHash = rpcMethod(client, "getGenesisHash") as () => SolanaRpcPending<string>;
  const observed = await getGenesisHash().send();
  if (observed !== expectedGenesisHash) fail("ES4463", "SolanaGenesisHashMismatch", "Solana RPC endpoint is connected to a different cluster than expected.", { profile: profile.id, expectedGenesisHash, observedGenesisHash: observed });
  return observed;
}

export async function captureSolanaRecentBlockhash(client: SolanaKitClientLike, commitment: SolanaCommitment = "confirmed"): Promise<SolanaRecentBlockhashEvidence> {
  const getLatestBlockhash = rpcMethod(client, "getLatestBlockhash") as (config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const getBlockHeight = rpcMethod(client, "getBlockHeight") as (config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const [rawHash, rawHeight] = await Promise.all([getLatestBlockhash({ commitment }).send(), getBlockHeight({ commitment }).send()]);
  const value = object(responseValue(rawHash), "getLatestBlockhash value");
  if (typeof value.blockhash !== "string") fail("ES4460", "MalformedSolanaRpcResponse", "getLatestBlockhash response is missing blockhash.");
  return solanaRecentBlockhash({ blockhash: value.blockhash, lastValidBlockHeight: integer(value.lastValidBlockHeight, "lastValidBlockHeight"), commitment, observedBlockHeight: integer(responseValue(rawHeight), "blockHeight") });
}

export function prepareSolanaSerializedTransaction(input: { profile: SolanaChainProfile; serializedBase64: string; version?: SolanaTransactionVersion; recentBlockhash: SolanaRecentBlockhashEvidence }): SolanaRecentPreparedTransaction {
  base64Bytes(input.serializedBase64);
  const version = input.version ?? 0;
  if (version !== "legacy" && version !== 0) fail("ES4464", "UnsupportedSolanaTransactionVersion", "EraScript currently supports Solana legacy and v0 transactions in the v0.6 adapter.", { version: String(version) });
  return {
    state: "solana-prepared",
    profileId: input.profile.id,
    version,
    serializedBase64: input.serializedBase64,
    bindingHash: bindingHash(input.serializedBase64, { kind: "recent-blockhash", value: input.recentBlockhash }, version),
    lifetimeKind: "recent-blockhash",
    recentBlockhash: input.recentBlockhash,
    inspectionVerified: false,
  };
}

export function prepareSolanaDurableNonceSerializedTransaction(input: { profile: SolanaChainProfile; serializedBase64: string; version?: SolanaTransactionVersion; durableNonce: SolanaDurableNonceBindingEvidence }): SolanaDurableNoncePreparedTransaction {
  const serializedBytes = base64Bytes(input.serializedBase64);
  const transactionHash = `0x${createHash("sha256").update(serializedBytes).digest("hex")}`;
  if (transactionHash !== input.durableNonce.transactionHash) {
    fail("ES4711", "SolanaDurableNonceTransactionBindingMismatch", "Durable nonce evidence was verified against different serialized transaction bytes.", {
      expectedTransactionHash: input.durableNonce.transactionHash,
      actualTransactionHash: transactionHash,
    });
  }
  const version = input.version ?? 0;
  if (version !== "legacy" && version !== 0) fail("ES4464", "UnsupportedSolanaTransactionVersion", "EraScript currently supports Solana legacy and v0 transactions in the v0.6 adapter.", { version: String(version) });
  return {
    state: "solana-prepared",
    profileId: input.profile.id,
    version,
    serializedBase64: input.serializedBase64,
    bindingHash: bindingHash(input.serializedBase64, { kind: "durable-nonce", value: input.durableNonce }, version),
    lifetimeKind: "durable-nonce",
    durableNonce: input.durableNonce,
    inspectionVerified: false,
  };
}

export async function verifySolanaSerializedTransaction(prepared: SolanaPreparedTransaction, inspector: SolanaTransactionInspector): Promise<SolanaVerifiedPreparedTransaction> {
  let inspection: SolanaTransactionInspection;
  try { inspection = await inspector(base64Bytes(prepared.serializedBase64)); }
  catch (error) { return fail("ES4469", "SolanaTransactionInspectionFailed", "Failed to inspect serialized Solana transaction bytes.", { cause: error instanceof Error ? error.message : String(error) }); }
  if (inspection.version !== prepared.version) fail("ES4468", "SolanaTransactionInspectionMismatch", "Serialized Solana transaction version differs from the declared EraScript version.", { expected: String(prepared.version), actual: String(inspection.version) });
  const observedBlockhash = solanaBlockhash(inspection.recentBlockhash);
  const expectedBlockhash = expectedLifetimeToken(prepared);
  if (observedBlockhash !== expectedBlockhash) fail("ES4468", "SolanaTransactionInspectionMismatch", "Serialized Solana transaction lifetime token differs from the bound recent-blockhash/durable-nonce evidence.", { expected: expectedBlockhash, actual: observedBlockhash, lifetimeKind: prepared.lifetimeKind });
  if (inspection.signerCount !== undefined && (!Number.isSafeInteger(inspection.signerCount) || inspection.signerCount < 1)) fail("ES4468", "SolanaTransactionInspectionMismatch", "Serialized Solana transaction inspector returned an invalid signer count.", { signerCount: inspection.signerCount });
  return { ...prepared, inspectionVerified: true, inspection: { ...inspection, recentBlockhash: observedBlockhash } };
}

async function simulateWire(client: SolanaKitClientLike, transaction: SolanaVerifiedPreparedTransaction, commitment: SolanaCommitment, sigVerify: boolean, options: SolanaLifetimeGuardOptions): Promise<{ success: boolean; err?: unknown; logs: readonly string[]; unitsConsumed?: bigint; simulatedAtBlockHeight: bigint }> {
  const getBlockHeight = rpcMethod(client, "getBlockHeight") as (config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const currentHeight = integer(responseValue(await getBlockHeight({ commitment }).send()), "blockHeight");
  await assertLifetimeUsable(transaction, currentHeight, options);
  const simulate = rpcMethod(client, "simulateTransaction") as (transaction: string, config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const value = object(responseValue(await simulate(transaction.serializedBase64, { encoding: "base64", commitment, sigVerify, replaceRecentBlockhash: false, ...(transaction.version === 0 ? { maxSupportedTransactionVersion: 0 } : {}) }).send()), "simulateTransaction value");
  const logs = Array.isArray(value.logs) ? value.logs.filter((entry): entry is string => typeof entry === "string") : [];
  const unitsConsumed = value.unitsConsumed === undefined || value.unitsConsumed === null ? undefined : integer(value.unitsConsumed, "unitsConsumed");
  const success = value.err === null || value.err === undefined;
  return { success, ...(success ? {} : { err: value.err }), logs, ...(unitsConsumed !== undefined ? { unitsConsumed } : {}), simulatedAtBlockHeight: currentHeight };
}

export async function simulateSolanaPreSignTransaction(client: SolanaKitClientLike, transaction: SolanaVerifiedPreparedTransaction, commitment: SolanaCommitment = "confirmed", options: SolanaLifetimeGuardOptions = {}): Promise<SolanaPreSignSimulationEvidence> {
  const result = await simulateWire(client, transaction, commitment, false, options);
  return { state: "solana-pre-sign-simulated", transaction, commitment, signatureVerification: false, ...result };
}

export async function simulateSolanaTransaction(client: SolanaKitClientLike, transaction: SolanaExecutionReadyTransaction, commitment: SolanaCommitment = "confirmed", options: SolanaLifetimeGuardOptions = {}): Promise<SolanaSimulationEvidence> {
  const result = await simulateWire(client, transaction, commitment, true, options);
  return { state: "solana-simulated", transaction, commitment, signatureVerification: true, ...result };
}

export async function submitSolanaTransaction(client: SolanaKitClientLike, simulation: SolanaSimulationEvidence & { readonly success: true }, options: SolanaLifetimeGuardOptions = {}): Promise<SolanaSubmittedTransaction> {
  if (!simulation.signatureVerification || !simulation.transaction.signatureAssemblyVerified) fail("ES4635", "SolanaSignatureVerificationRequired", "Solana submission requires signature-verified simulation of an assembly-verified final wire transaction.");
  const getBlockHeight = rpcMethod(client, "getBlockHeight") as (config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const height = integer(responseValue(await getBlockHeight({ commitment: simulation.commitment }).send()), "blockHeight");
  await assertLifetimeUsable(simulation.transaction, height, options);
  const send = rpcMethod(client, "sendTransaction") as (transaction: string, config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const raw = responseValue(await send(simulation.transaction.serializedBase64, { encoding: "base64", skipPreflight: false, preflightCommitment: simulation.commitment, ...(simulation.transaction.version === 0 ? { maxSupportedTransactionVersion: 0 } : {}) }).send());
  if (typeof raw !== "string") fail("ES4460", "MalformedSolanaRpcResponse", "sendTransaction did not return a transaction signature.");
  return { state: "solana-submitted", simulation, signature: solanaTransactionSignature(raw), submittedAtBlockHeight: height };
}

export async function readSolanaSignatureStatus(client: SolanaKitClientLike, signature: SolanaTransactionSignature): Promise<SolanaSignatureStatusEvidence> {
  const getStatuses = rpcMethod(client, "getSignatureStatuses") as (signatures: readonly string[], config?: Record<string, unknown>) => SolanaRpcPending<unknown>;
  const raw = responseValue(await getStatuses([signature], { searchTransactionHistory: true }).send());
  const values = Array.isArray(raw) ? raw : [];
  const first = values[0];
  if (first === null || first === undefined) return { state: "solana-signature-status", signature, found: false };
  const record = object(first, "signature status");
  const confirmationStatus = record.confirmationStatus;
  if (confirmationStatus !== undefined && confirmationStatus !== null && confirmationStatus !== "processed" && confirmationStatus !== "confirmed" && confirmationStatus !== "finalized") fail("ES4460", "MalformedSolanaRpcResponse", "Unknown Solana confirmationStatus.", { confirmationStatus: String(confirmationStatus) });
  const confirmations = record.confirmations === null ? null : record.confirmations === undefined ? undefined : integer(record.confirmations, "confirmations");
  return { state: "solana-signature-status", signature, found: true, ...(record.slot !== undefined ? { slot: integer(record.slot, "slot") } : {}), ...(confirmationStatus ? { confirmationStatus } : {}), ...(confirmations !== undefined ? { confirmations } : {}), ...(record.err !== null && record.err !== undefined ? { err: record.err } : {}) };
}

export function assertSolanaFinalized(status: SolanaSignatureStatusEvidence): SolanaSignatureStatusEvidence & { readonly found: true; readonly confirmationStatus: "finalized" } {
  if (!status.found) fail("ES4465", "SolanaTransactionNotFound", "Solana transaction signature is not present in RPC history.", { signature: status.signature });
  if (status.err !== undefined) fail("ES4466", "SolanaTransactionFailed", "Solana transaction executed with an error.", { signature: status.signature, err: status.err });
  if (status.confirmationStatus !== "finalized") fail("ES4467", "SolanaTransactionNotFinalized", "Solana transaction has not reached finalized commitment.", { signature: status.signature, confirmationStatus: status.confirmationStatus ?? null });
  return status as SolanaSignatureStatusEvidence & { readonly found: true; readonly confirmationStatus: "finalized" };
}
