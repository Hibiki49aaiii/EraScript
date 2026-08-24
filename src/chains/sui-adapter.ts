import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import { suiAddress, suiEffectsEvidence, suiTransactionDigest, type SuiAddress, type SuiEffectsEvidence, type SuiTransactionDigest } from "./sui.js";
import type { SuiChainProfile } from "./types.js";

declare const suiAdapterBrand: unique symbol;
export type SuiTransactionBindingHash = string & { readonly [suiAdapterBrand]: "SuiTransactionBindingHash" };

export interface SuiCoreLike {
  getChainIdentifier?: () => Promise<unknown>;
  simulateTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
  executeTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
  waitForTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
  getTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
}
export interface SuiClientLike {
  readonly network?: string;
  readonly core?: SuiCoreLike;
  simulateTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
  executeTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
  waitForTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
  getTransaction?: (input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Normalize `Transaction.from(bytes).getData()` (or an equivalent trusted decoder)
 * into this small inspection surface. EraScript intentionally does not depend on
 * @mysten/sui directly; the caller supplies the decoder from the installed SDK.
 */
export interface SuiTransactionInspection {
  readonly sender: string;
  readonly gasOwner: string;
  readonly gasBudget?: bigint | string | number;
  readonly gasPrice?: bigint | string | number;
  readonly commandCount?: number;
}
export type SuiTransactionInspector = (serializedTransaction: Uint8Array) => SuiTransactionInspection | Promise<SuiTransactionInspection>;

export interface SuiPreparedTransaction {
  readonly state: "sui-prepared";
  readonly profileId: string;
  readonly sender: SuiAddress;
  readonly gasOwner: SuiAddress;
  readonly serializedBase64: string;
  readonly bindingHash: SuiTransactionBindingHash;
  readonly inspectionVerified: false;
}
export interface SuiVerifiedPreparedTransaction extends Omit<SuiPreparedTransaction, "inspectionVerified"> {
  readonly inspectionVerified: true;
  readonly inspection: {
    readonly sender: SuiAddress;
    readonly gasOwner: SuiAddress;
    readonly gasBudget?: bigint;
    readonly gasPrice?: bigint;
    readonly commandCount?: number;
  };
}
export interface SuiSimulationEvidence {
  readonly state: "sui-simulated";
  readonly transaction: SuiVerifiedPreparedTransaction;
  readonly checksEnabled: boolean;
  readonly success: boolean;
  readonly statusError?: string;
  readonly balanceChanges?: readonly unknown[];
  readonly commandResults?: readonly unknown[];
  readonly raw: unknown;
}
export interface SuiExecutedTransaction {
  readonly state: "sui-executed";
  readonly simulation: SuiSimulationEvidence & { readonly success: true; readonly checksEnabled: true };
  readonly digest: SuiTransactionDigest;
  readonly effects: SuiEffectsEvidence;
  readonly signatures: readonly string[];
  readonly raw: unknown;
}
export interface SuiExecutionFailedTransaction {
  readonly state: "sui-execution-failed";
  readonly simulation: SuiSimulationEvidence & { readonly success: true; readonly checksEnabled: true };
  readonly digest?: SuiTransactionDigest;
  readonly error: string;
  readonly signatures: readonly string[];
  readonly raw: unknown;
}
export interface SuiCheckpointEvidence {
  readonly state: "sui-checkpointed";
  readonly transaction: SuiExecutedTransaction;
  readonly checkpoint: bigint;
  readonly observedThrough: "waitForTransaction";
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4490", "MalformedSuiResponse", `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4490", "MalformedSuiResponse", `Sui field '${field}' must be a non-negative integer.`, { field, value: String(value) });
}
function optionalInteger(value: unknown, field: string): bigint | undefined {
  return value === undefined || value === null ? undefined : integer(value, field);
}
function responseField(value: unknown, field: string): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && field in (value as Record<string, unknown>)) return (value as Record<string, unknown>)[field];
  return value;
}
function base64Bytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) fail("ES4491", "InvalidSuiTransactionBytes", "Sui transaction bytes must use canonical base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) fail("ES4491", "InvalidSuiTransactionBytes", "Sui transaction bytes are malformed or empty.");
  return bytes;
}
function bindingHash(serializedBase64: string, sender: SuiAddress, gasOwner: SuiAddress): SuiTransactionBindingHash {
  return `0x${createHash("sha256").update(JSON.stringify({ serializedBase64, sender, gasOwner })).digest("hex")}` as SuiTransactionBindingHash;
}
function method(client: SuiClientLike, name: keyof SuiCoreLike): (input: Record<string, unknown>) => Promise<unknown> {
  const direct = client[name as keyof SuiClientLike];
  if (typeof direct === "function") return direct.bind(client) as (input: Record<string, unknown>) => Promise<unknown>;
  const core = client.core?.[name];
  if (typeof core === "function") return core.bind(client.core) as (input: Record<string, unknown>) => Promise<unknown>;
  fail("ES4492", "MissingSuiClientMethod", `@mysten/sui v2-compatible client does not expose '${String(name)}'.`, { method: String(name) });
}
function resultTransaction(raw: unknown): { success: boolean; record: Record<string, unknown>; error?: string } {
  const root = object(raw, "Sui transaction result");
  if (root.Transaction) return { success: true, record: object(root.Transaction, "Transaction") };
  if (root.FailedTransaction) {
    const record = object(root.FailedTransaction, "FailedTransaction");
    const status = record.status && typeof record.status === "object" ? record.status as Record<string, unknown> : undefined;
    return { success: false, record, error: String(status?.error ?? record.error ?? "Sui transaction failed") };
  }
  if (root.$kind === "FailedTransaction") return { success: false, record: root, error: String(root.error ?? "Sui transaction failed") };
  if (root.$kind === "Transaction") return { success: true, record: root };
  const status = root.status && typeof root.status === "object" ? root.status as Record<string, unknown> : undefined;
  if (typeof status?.success === "boolean") return { success: status.success, record: root, ...(status.success ? {} : { error: String(status.error ?? "Sui transaction failed") }) };
  fail("ES4490", "MalformedSuiResponse", "Sui client returned an unrecognized transaction result union.");
}
function digestFrom(record: Record<string, unknown>): SuiTransactionDigest | undefined {
  return typeof record.digest === "string" ? suiTransactionDigest(record.digest) : undefined;
}
function checkpointFrom(record: Record<string, unknown>): bigint | undefined {
  const candidate = record.checkpoint ?? (record.effects && typeof record.effects === "object" ? (record.effects as Record<string, unknown>).checkpoint : undefined);
  return candidate === undefined || candidate === null ? undefined : integer(candidate, "checkpoint");
}

export async function assertSuiClientNetwork(client: SuiClientLike, profile: SuiChainProfile, expectedChainIdentifier?: string): Promise<string | undefined> {
  if (client.network && client.network !== profile.network) fail("ES4493", "SuiNetworkMismatch", "Sui client network does not match the selected EraScript profile.", { expected: profile.network, actual: client.network });
  if (!expectedChainIdentifier) return undefined;
  const getChainIdentifier = client.core?.getChainIdentifier;
  if (typeof getChainIdentifier !== "function") fail("ES4492", "MissingSuiClientMethod", "Sui chain identifier verification requires client.core.getChainIdentifier().");
  const raw = await getChainIdentifier.call(client.core);
  const value = responseField(raw, "chainIdentifier");
  if (typeof value !== "string") fail("ES4490", "MalformedSuiResponse", "getChainIdentifier did not return a chain identifier string.");
  if (value !== expectedChainIdentifier) fail("ES4494", "SuiChainIdentifierMismatch", "Sui client is connected to a different chain identifier.", { expected: expectedChainIdentifier, actual: value });
  return value;
}

export function prepareSuiTransaction(input: { profile: SuiChainProfile; sender: string; gasOwner?: string; serializedBase64: string }): SuiPreparedTransaction {
  base64Bytes(input.serializedBase64);
  const sender = suiAddress(input.sender);
  const gasOwner = suiAddress(input.gasOwner ?? input.sender);
  return { state: "sui-prepared", profileId: input.profile.id, sender, gasOwner, serializedBase64: input.serializedBase64, bindingHash: bindingHash(input.serializedBase64, sender, gasOwner), inspectionVerified: false };
}

export async function verifySuiSerializedTransaction(prepared: SuiPreparedTransaction, inspector: SuiTransactionInspector): Promise<SuiVerifiedPreparedTransaction> {
  let raw: SuiTransactionInspection;
  try { raw = await inspector(base64Bytes(prepared.serializedBase64)); }
  catch (error) { return fail("ES4501", "SuiTransactionInspectionFailed", "Failed to inspect serialized Sui transaction bytes.", { cause: error instanceof Error ? error.message : String(error) }); }
  const sender = suiAddress(raw.sender);
  const gasOwner = suiAddress(raw.gasOwner);
  if (sender !== prepared.sender) fail("ES4502", "SuiTransactionInspectionMismatch", "Serialized Sui transaction sender differs from the EraScript-bound sender.", { expected: prepared.sender, actual: sender });
  if (gasOwner !== prepared.gasOwner) fail("ES4502", "SuiTransactionInspectionMismatch", "Serialized Sui transaction gas owner differs from the EraScript-bound gas owner.", { expected: prepared.gasOwner, actual: gasOwner });
  if (raw.commandCount !== undefined && (!Number.isSafeInteger(raw.commandCount) || raw.commandCount < 0)) fail("ES4502", "SuiTransactionInspectionMismatch", "Sui transaction inspector returned an invalid command count.", { commandCount: raw.commandCount });
  const gasBudget = optionalInteger(raw.gasBudget, "gasBudget");
  const gasPrice = optionalInteger(raw.gasPrice, "gasPrice");
  return {
    ...prepared,
    inspectionVerified: true,
    inspection: {
      sender,
      gasOwner,
      ...(gasBudget !== undefined ? { gasBudget } : {}),
      ...(gasPrice !== undefined ? { gasPrice } : {}),
      ...(raw.commandCount !== undefined ? { commandCount: raw.commandCount } : {}),
    },
  };
}

export async function simulateSuiPreparedTransaction(client: SuiClientLike, prepared: SuiVerifiedPreparedTransaction, options: { checksEnabled?: boolean; doGasSelection?: boolean } = {}): Promise<SuiSimulationEvidence> {
  const checksEnabled = options.checksEnabled ?? true;
  const simulate = method(client, "simulateTransaction");
  const raw = await simulate({ transaction: base64Bytes(prepared.serializedBase64), checksEnabled, ...(options.doGasSelection !== undefined ? { doGasSelection: options.doGasSelection } : {}), include: { effects: true, balanceChanges: true, commandResults: true } });
  const result = resultTransaction(raw);
  const balanceChanges = Array.isArray(result.record.balanceChanges) ? result.record.balanceChanges : undefined;
  const commandResults = Array.isArray(result.record.commandResults) ? result.record.commandResults : undefined;
  return { state: "sui-simulated", transaction: prepared, checksEnabled, success: result.success, ...(result.error ? { statusError: result.error } : {}), ...(balanceChanges ? { balanceChanges } : {}), ...(commandResults ? { commandResults } : {}), raw };
}

export function assertSuiRealSimulation(simulation: SuiSimulationEvidence): SuiSimulationEvidence & { readonly success: true; readonly checksEnabled: true } {
  if (!simulation.success) fail("ES4495", "SuiSimulationFailed", "Sui transaction simulation failed and cannot be executed.", { error: simulation.statusError ?? null });
  if (!simulation.checksEnabled) fail("ES4496", "UncheckedSuiSimulationRejected", "Sui simulation with checksEnabled=false is inspection-only and cannot satisfy the execution gate.");
  return simulation as SuiSimulationEvidence & { readonly success: true; readonly checksEnabled: true };
}

export async function executeSuiTransaction(client: SuiClientLike, simulation: SuiSimulationEvidence, signatures: readonly string[]): Promise<SuiExecutedTransaction | SuiExecutionFailedTransaction> {
  const checked = assertSuiRealSimulation(simulation);
  if (signatures.length === 0 || signatures.some((signature) => typeof signature !== "string" || signature.length === 0)) fail("ES4497", "MissingSuiSignatures", "Sui execution requires one or more non-empty serialized signatures.");
  const raw = await method(client, "executeTransaction")({ transaction: base64Bytes(checked.transaction.serializedBase64), signatures: [...signatures], include: { effects: true, events: true, balanceChanges: true, transaction: true } });
  const result = resultTransaction(raw);
  const digest = digestFrom(result.record);
  if (!result.success) return { state: "sui-execution-failed", simulation: checked, ...(digest ? { digest } : {}), error: result.error ?? "Sui transaction failed", signatures: [...signatures], raw };
  if (!digest) fail("ES4490", "MalformedSuiResponse", "Successful Sui transaction result is missing its digest.");
  const checkpoint = checkpointFrom(result.record);
  const effects = suiEffectsEvidence({ transactionDigest: digest, status: "success", ...(checkpoint !== undefined ? { checkpoint } : {}) });
  return { state: "sui-executed", simulation: checked, digest, effects, signatures: [...signatures], raw };
}

export async function waitForSuiCheckpoint(client: SuiClientLike, transaction: SuiExecutedTransaction, options: { timeoutMs?: number; pollSchedule?: readonly number[] } = {}): Promise<SuiCheckpointEvidence> {
  const raw = await method(client, "waitForTransaction")({ digest: transaction.digest, ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}), ...(options.pollSchedule ? { pollSchedule: [...options.pollSchedule] } : {}), include: { effects: true, transaction: true } });
  const result = resultTransaction(raw);
  if (!result.success) fail("ES4498", "SuiWaitObservedFailure", "waitForTransaction returned a failed transaction for a digest previously treated as successful.", { digest: transaction.digest, error: result.error ?? null });
  const digest = digestFrom(result.record);
  if (!digest || digest !== transaction.digest) fail("ES4499", "SuiDigestMismatch", "waitForTransaction returned evidence for a different transaction digest.", { expected: transaction.digest, actual: digest ?? null });
  const checkpoint = checkpointFrom(result.record);
  if (checkpoint === undefined) fail("ES4500", "SuiCheckpointUnavailable", "Sui transaction is executed but checkpoint inclusion is not yet available.", { digest: transaction.digest });
  return { state: "sui-checkpointed", transaction, checkpoint, observedThrough: "waitForTransaction" };
}
