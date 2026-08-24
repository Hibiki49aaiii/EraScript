import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "../web3/types.js";
import {
  attachRailgunBroadcasterFee,
  markRailgunSubmitted,
  railgunAddress,
  type RailgunAddress,
  type RailgunBroadcasterFeeEvidence,
  type RailgunGasEvidence,
  type RailgunSubmittedTransaction,
} from "./railgun.js";
import type { RailgunSdkPopulatedSession } from "./railgun-adapter.js";

export interface RailgunWakuBroadcasterClientLike {
  findBestBroadcaster(chain: unknown, tokenAddress: string): Promise<unknown>;
}

export interface RailgunBroadcasterTransactionLike {
  create(...args: readonly unknown[]): Promise<unknown>;
  send(transaction: unknown): Promise<unknown>;
}

export interface RailgunBroadcasterSelection {
  readonly kind: "railgun-broadcaster-selection";
  readonly broadcasterId: string;
  readonly railgunAddress: RailgunAddress;
  readonly feesId: string;
  readonly feeToken: `0x${string}`;
  readonly feePerUnitGas?: bigint;
  readonly observedAtMs: number;
  readonly raw: unknown;
}

export interface RailgunBroadcasterPayload {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly nullifiers: readonly string[];
  readonly useRelayAdapt: boolean;
  readonly preTransactionPOIs: unknown;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4520", "MalformedRailgunBroadcasterResponse", `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function bigintValue(value: unknown, field: string): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4520", "MalformedRailgunBroadcasterResponse", `Broadcaster field '${field}' must be a non-negative integer.`, { field, value: String(value) });
}
function evmHex(value: unknown, field: string, bytes?: number): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) fail("ES4521", "InvalidRailgunBroadcasterHex", `Broadcaster field '${field}' must be whole-byte EVM hex.`, { field });
  if (bytes !== undefined && value.length !== 2 + bytes * 2) fail("ES4521", "InvalidRailgunBroadcasterHex", `Broadcaster field '${field}' must be exactly ${bytes} bytes.`, { field, bytes });
  return value as `0x${string}`;
}

export async function selectRailgunBroadcaster(input: {
  client: RailgunWakuBroadcasterClientLike;
  sdkChain: unknown;
  feeToken: `0x${string}`;
  validateRailgunAddress: (value: string) => boolean;
  nowMs?: number;
}): Promise<RailgunBroadcasterSelection> {
  evmHex(input.feeToken, "feeToken", 20);
  const raw = await input.client.findBestBroadcaster(input.sdkChain, input.feeToken);
  if (!raw) fail("ES4522", "RailgunBroadcasterUnavailable", "No RAILGUN Broadcaster is currently available for the selected fee token.", { feeToken: input.feeToken });
  const record = object(raw, "selected Broadcaster");
  const addressValue = record.railgunAddress;
  const feesIdValue = record.feesID ?? record.feesId;
  if (typeof addressValue !== "string" || typeof feesIdValue !== "string" || feesIdValue.length === 0) fail("ES4520", "MalformedRailgunBroadcasterResponse", "Selected Broadcaster is missing railgunAddress or feesID.");
  const rgAddress = railgunAddress(addressValue, input.validateRailgunAddress);
  const feePerUnitGas = bigintValue(record.feePerUnitGas, "feePerUnitGas");
  return {
    kind: "railgun-broadcaster-selection",
    broadcasterId: `${rgAddress}:${feesIdValue}`,
    railgunAddress: rgAddress,
    feesId: feesIdValue,
    feeToken: input.feeToken,
    ...(feePerUnitGas !== undefined ? { feePerUnitGas } : {}),
    observedAtMs: input.nowMs ?? Date.now(),
    raw,
  };
}

export function attachSelectedRailgunBroadcasterFee<C extends EvmChain>(gas: RailgunGasEvidence<C>, selection: RailgunBroadcasterSelection, input: {
  feeAmount: bigint;
  feeRecipient: RailgunAddress;
  expiresAtMs: number;
  nowMs?: number;
}): RailgunBroadcasterFeeEvidence<C> {
  if (gas.sendWithPublicWallet) fail("ES4523", "RailgunBroadcasterNotApplicable", "Cannot attach Broadcaster fee evidence to a self-submit RAILGUN transaction.");
  return attachRailgunBroadcasterFee(gas, {
    broadcasterId: selection.broadcasterId,
    feeToken: selection.feeToken,
    feeAmount: input.feeAmount,
    feeRecipient: input.feeRecipient,
    expiresAtMs: input.expiresAtMs,
    nowMs: input.nowMs,
  });
}

export async function submitRailgunWithBroadcaster<C extends EvmChain>(input: {
  broadcasterTransaction: RailgunBroadcasterTransactionLike;
  populated: RailgunSdkPopulatedSession<C>;
  selection: RailgunBroadcasterSelection;
  sdkChain: unknown;
  toBroadcasterPayload: (populateResponse: unknown) => RailgunBroadcasterPayload;
  submittedAtMs?: number;
}): Promise<RailgunSubmittedTransaction<C>> {
  const source = input.populated.proofSession.source;
  if (source.sendWithPublicWallet) fail("ES4523", "RailgunBroadcasterNotApplicable", "Self-submit RAILGUN proof cannot be sent through Waku Broadcaster.");
  if (source.state !== "railgun-broadcaster-fee-quoted") fail("ES4524", "RailgunBroadcasterFeeEvidenceMissing", "Broadcaster submission requires fee-quoted RAILGUN proof evidence.");
  if (source.broadcasterId !== input.selection.broadcasterId) fail("ES4525", "RailgunBroadcasterSelectionMismatch", "RAILGUN proof was generated for a different Broadcaster/feesID selection.", { proofBroadcaster: source.broadcasterId, selectedBroadcaster: input.selection.broadcasterId });
  if (source.feeToken.toLowerCase() !== input.selection.feeToken.toLowerCase()) fail("ES4526", "RailgunBroadcasterFeeTokenMismatch", "Selected Broadcaster fee token differs from the proof-bound fee token.", { proofFeeToken: source.feeToken, selectedFeeToken: input.selection.feeToken });

  const payload = input.toBroadcasterPayload(input.populated.sdkPopulateResponse);
  evmHex(payload.to, "to", 20);
  evmHex(payload.data, "data");
  const broadcasterTransaction = await input.broadcasterTransaction.create(
    input.populated.proofSession.sdkTxidVersion,
    payload.to,
    payload.data,
    input.selection.railgunAddress,
    input.selection.feesId,
    input.sdkChain,
    [...payload.nullifiers],
    source.overallBatchMinGasPrice,
    payload.useRelayAdapt,
    payload.preTransactionPOIs,
  );
  const raw = await input.broadcasterTransaction.send(broadcasterTransaction);
  const response = object(raw, "Broadcaster transaction response");
  const txHash = response.txHash ?? response.transactionHash;
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) fail("ES4520", "MalformedRailgunBroadcasterResponse", "Broadcaster submission did not return a 32-byte EVM transaction hash.");
  return markRailgunSubmitted(input.populated.transaction, { submission: "broadcaster", submissionId: txHash, submittedAtMs: input.submittedAtMs });
}
