import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  attachRailgunGasEvidence,
  createRailgunProofEvidence,
  populateRailgunTransaction,
  type RailgunBroadcasterFeeEvidence,
  type RailgunGasEvidence,
  type RailgunIntent,
  type RailgunPopulatedTransaction,
  type RailgunPrivateTransfer,
  type RailgunProofEvidence,
} from "./railgun.js";

export interface RailgunWalletSdkLike {
  gasEstimateForUnprovenTransfer(...args: readonly unknown[]): Promise<unknown>;
  generateTransferProof(...args: readonly unknown[]): Promise<unknown>;
  populateProvedTransfer(...args: readonly unknown[]): Promise<unknown>;
}

export interface RailgunWalletSdkConfig {
  readonly sdkTxidVersion: unknown;
  readonly sdkNetwork: unknown;
  readonly encryptionKey: string;
  readonly originalGasDetails: unknown;
  readonly overallBatchMinGasPrice: bigint;
  readonly feeTokenDetails?: unknown;
  readonly broadcasterFeeERC20AmountRecipient?: unknown;
  readonly transactionGasDetails?: unknown;
  readonly showSenderAddressToRecipient?: boolean;
  readonly serializeTransfer: (transfer: RailgunPrivateTransfer) => unknown;
  readonly serializePopulatedTransaction: (populateResponse: unknown) => Hex;
}

export interface RailgunSdkProofSession<C extends RailgunIntent["chain"] = RailgunIntent["chain"]> {
  readonly kind: "railgun-sdk-proof-session";
  readonly source: RailgunGasEvidence<C> | RailgunBroadcasterFeeEvidence<C>;
  readonly proof: RailgunProofEvidence<C>;
  readonly sdkNetwork: unknown;
  readonly sdkTxidVersion: unknown;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function bigintValue(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4510", "MalformedRailgunSdkResponse", `RAILGUN SDK field '${field}' must be a non-negative integer.`, { field, value: String(value) });
}

function gasEstimateFrom(value: unknown): bigint {
  if (value && typeof value === "object" && !Array.isArray(value) && "gasEstimate" in (value as Record<string, unknown>)) return bigintValue((value as Record<string, unknown>).gasEstimate, "gasEstimate");
  return bigintValue(value, "gasEstimate");
}

function sdkTransfers(intent: RailgunIntent, serializer: RailgunWalletSdkConfig["serializeTransfer"]): readonly unknown[] {
  return intent.transfers.map(serializer);
}

function assertSdkConfig(config: RailgunWalletSdkConfig): void {
  if (!config.encryptionKey) fail("ES4511", "MissingRailgunEncryptionKey", "RAILGUN Wallet SDK adapter requires an encryption key reference/value supplied outside AI source generation.");
  if (config.overallBatchMinGasPrice < 0n) fail("ES4512", "InvalidRailgunBatchMinGasPrice", "RAILGUN overallBatchMinGasPrice cannot be negative.", { value: config.overallBatchMinGasPrice.toString() });
}

export async function estimateRailgunTransferWithSdk<C extends RailgunIntent["chain"]>(sdk: RailgunWalletSdkLike, intent: RailgunIntent<C>, config: RailgunWalletSdkConfig): Promise<RailgunGasEvidence<C>> {
  assertSdkConfig(config);
  const transfers = sdkTransfers(intent, config.serializeTransfer);
  const response = await sdk.gasEstimateForUnprovenTransfer(
    config.sdkTxidVersion,
    config.sdkNetwork,
    intent.walletId,
    config.encryptionKey,
    intent.memo,
    transfers,
    [],
    config.originalGasDetails,
    config.feeTokenDetails,
    intent.sendWithPublicWallet,
  );
  return attachRailgunGasEvidence(intent, {
    gasEstimate: gasEstimateFrom(response),
    overallBatchMinGasPrice: config.overallBatchMinGasPrice,
  });
}

export async function generateRailgunTransferProofWithSdk<C extends RailgunIntent["chain"]>(sdk: RailgunWalletSdkLike, source: RailgunGasEvidence<C> | RailgunBroadcasterFeeEvidence<C>, config: RailgunWalletSdkConfig, options: { proofId?: string; progress?: (progress: number) => void; generatedAtMs?: number } = {}): Promise<RailgunSdkProofSession<C>> {
  assertSdkConfig(config);
  if (!source.sendWithPublicWallet && source.state !== "railgun-broadcaster-fee-quoted") fail("ES4513", "RailgunBroadcasterQuoteMissing", "RAILGUN proof generation through a Broadcaster requires fee evidence before calling the Wallet SDK.");
  const transfers = sdkTransfers(source, config.serializeTransfer);
  const progress = (value: unknown): void => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail("ES4510", "MalformedRailgunSdkResponse", "RAILGUN proof progress must be a finite number between 0 and 1.", { value: String(value) });
    options.progress?.(value);
  };
  await sdk.generateTransferProof(
    config.sdkTxidVersion,
    config.sdkNetwork,
    source.walletId,
    config.encryptionKey,
    config.showSenderAddressToRecipient ?? true,
    source.memo,
    transfers,
    [],
    source.state === "railgun-broadcaster-fee-quoted" ? config.broadcasterFeeERC20AmountRecipient : undefined,
    source.sendWithPublicWallet,
    source.overallBatchMinGasPrice,
    progress,
  );
  const generatedAtMs = options.generatedAtMs ?? Date.now();
  const proof = createRailgunProofEvidence(source, {
    proofId: options.proofId ?? `wallet-sdk:${source.intentHash}:${generatedAtMs}`,
    generatedAt: generatedAtMs,
  });
  return { kind: "railgun-sdk-proof-session", source, proof, sdkNetwork: config.sdkNetwork, sdkTxidVersion: config.sdkTxidVersion };
}

export async function populateRailgunTransferWithSdk<C extends RailgunIntent["chain"]>(sdk: RailgunWalletSdkLike, session: RailgunSdkProofSession<C>, config: RailgunWalletSdkConfig, nowMs = Date.now()): Promise<RailgunPopulatedTransaction<C>> {
  assertSdkConfig(config);
  if (config.transactionGasDetails === undefined) fail("ES4514", "MissingRailgunTransactionGasDetails", "RAILGUN populateProvedTransfer requires transactionGasDetails derived after gas estimation.");
  const source = session.source;
  const transfers = sdkTransfers(source, config.serializeTransfer);
  const populated = await sdk.populateProvedTransfer(
    config.sdkTxidVersion,
    config.sdkNetwork,
    source.walletId,
    config.showSenderAddressToRecipient ?? true,
    source.memo,
    transfers,
    [],
    source.state === "railgun-broadcaster-fee-quoted" ? config.broadcasterFeeERC20AmountRecipient : undefined,
    source.sendWithPublicWallet,
    source.overallBatchMinGasPrice,
    config.transactionGasDetails,
  );
  const serialized = config.serializePopulatedTransaction(populated);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(serialized)) fail("ES4515", "InvalidRailgunSerializedTransaction", "serializePopulatedTransaction must return non-empty whole-byte hex.");
  return populateRailgunTransaction(session.proof, serialized, nowMs);
}
