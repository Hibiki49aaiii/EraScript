import { keccak256, stringToHex, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain, Hash } from "../web3/types.js";
import { hash } from "../web3/types.js";

const railgunBrand: unique symbol = Symbol("railgunBrand");
export type RailgunAddress = string & { readonly [railgunBrand]: "RailgunAddress" };

export interface RailgunPrivateTransfer {
  readonly recipient: RailgunAddress;
  readonly token: `0x${string}`;
  readonly amount: bigint;
}

export interface RailgunIntent<C extends EvmChain = EvmChain> {
  readonly state: "railgun-intent";
  readonly operation: "private-transfer";
  readonly chain: C;
  readonly txidVersion: string;
  readonly walletId: string;
  readonly transfers: readonly RailgunPrivateTransfer[];
  readonly memo?: string;
  readonly sendWithPublicWallet: boolean;
  readonly intentHash: Hash<"railgun-intent">;
}

export interface RailgunGasEvidence<C extends EvmChain = EvmChain> extends Omit<RailgunIntent<C>, "state"> {
  readonly state: "railgun-gas-estimated";
  readonly gasEstimate: bigint;
  readonly overallBatchMinGasPrice: bigint;
  readonly gasBindingHash: Hash<"railgun-gas-binding">;
}

export interface RailgunBroadcasterFeeEvidence<C extends EvmChain = EvmChain> extends Omit<RailgunGasEvidence<C>, "state"> {
  readonly state: "railgun-broadcaster-fee-quoted";
  readonly broadcasterId: string;
  readonly feeToken: `0x${string}`;
  readonly feeAmount: bigint;
  readonly feeRecipient: RailgunAddress;
  /** EraScript adapters normalize provider quote expiry to Unix milliseconds. */
  readonly expiresAtMs: number;
  readonly feeBindingHash: Hash<"railgun-fee-binding">;
}

export interface RailgunProofEvidence<C extends EvmChain = EvmChain> {
  readonly state: "railgun-proof-generated";
  readonly chain: C;
  readonly proofId: string;
  readonly proofBindingHash: Hash<"railgun-proof-binding">;
  readonly generatedAtMs: number;
  readonly broadcasterFeeExpiresAtMs?: number;
  readonly sendWithPublicWallet: boolean;
}

export interface RailgunPopulatedTransaction<C extends EvmChain = EvmChain> {
  readonly state: "railgun-populated";
  readonly chain: C;
  readonly proof: RailgunProofEvidence<C>;
  readonly serializedTransaction: Hex;
  readonly populatedHash: Hash<"railgun-populated">;
}

export interface RailgunSubmittedTransaction<C extends EvmChain = EvmChain> extends Omit<RailgunPopulatedTransaction<C>, "state"> {
  readonly state: "railgun-submitted";
  readonly submission: "broadcaster" | "self";
  readonly submittedAtMs: number;
  readonly submissionId?: string;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function binding<Algorithm extends string>(algorithm: Algorithm, value: unknown): Hash<Algorithm> {
  return hash(keccak256(stringToHex(JSON.stringify(normalize(value)))), algorithm);
}

export function railgunAddress(value: string, validator: (value: string) => boolean): RailgunAddress {
  if (!validator(value)) fail("ES4430", "InvalidRailgunAddress", "RAILGUN address failed canonical SDK validation.", { value });
  return value as RailgunAddress;
}

export function createRailgunIntent<C extends EvmChain>(input: {
  chain: C;
  txidVersion: string;
  walletId: string;
  transfers: readonly RailgunPrivateTransfer[];
  memo?: string;
  sendWithPublicWallet?: boolean;
}): RailgunIntent<C> {
  if (!input.txidVersion) fail("ES4431", "MissingRailgunTxidVersion", "RAILGUN intent must bind an explicit TXID version.");
  if (!input.walletId) fail("ES4432", "MissingRailgunWalletId", "RAILGUN intent must bind a wallet ID.");
  if (input.transfers.length === 0) fail("ES4433", "EmptyRailgunTransfers", "RAILGUN private transfer must contain at least one transfer.");
  for (const [index, transfer] of input.transfers.entries()) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(transfer.token)) fail("ES4436", "InvalidRailgunTokenAddress", "RAILGUN token address must be a 20-byte EVM address.", { index, token: transfer.token });
    if (transfer.amount < 0n) fail("ES4437", "InvalidRailgunTokenAmount", "RAILGUN token amounts cannot be negative.", { index, amount: transfer.amount.toString() });
  }
  const sendWithPublicWallet = input.sendWithPublicWallet ?? false;
  const canonical = {
    operation: "private-transfer",
    chainId: input.chain.id,
    txidVersion: input.txidVersion,
    walletId: input.walletId,
    transfers: input.transfers.map((transfer) => ({ ...transfer, token: transfer.token.toLowerCase() })),
    memo: input.memo ?? null,
    sendWithPublicWallet,
  };
  return {
    state: "railgun-intent",
    operation: "private-transfer",
    chain: input.chain,
    txidVersion: input.txidVersion,
    walletId: input.walletId,
    transfers: input.transfers,
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
    sendWithPublicWallet,
    intentHash: binding("railgun-intent", canonical),
  };
}

export function attachRailgunGasEvidence<C extends EvmChain>(intent: RailgunIntent<C>, input: {
  gasEstimate: bigint;
  overallBatchMinGasPrice: bigint;
}): RailgunGasEvidence<C> {
  if (input.gasEstimate < 0n || input.overallBatchMinGasPrice < 0n) fail("ES4438", "InvalidRailgunGasEvidence", "RAILGUN gas estimate and minimum gas price must be non-negative.");
  const gasBindingHash = binding("railgun-gas-binding", {
    intentHash: intent.intentHash,
    gasEstimate: input.gasEstimate,
    overallBatchMinGasPrice: input.overallBatchMinGasPrice,
  });
  return { ...intent, state: "railgun-gas-estimated", gasEstimate: input.gasEstimate, overallBatchMinGasPrice: input.overallBatchMinGasPrice, gasBindingHash };
}

export function attachRailgunBroadcasterFee<C extends EvmChain>(gas: RailgunGasEvidence<C>, input: {
  broadcasterId: string;
  feeToken: `0x${string}`;
  feeAmount: bigint;
  feeRecipient: RailgunAddress;
  expiresAtMs: number;
  nowMs?: number;
}): RailgunBroadcasterFeeEvidence<C> {
  if (gas.sendWithPublicWallet) fail("ES4439", "UnexpectedRailgunBroadcasterFee", "Broadcaster fee evidence cannot be attached to a self-submit RAILGUN intent.");
  if (!input.broadcasterId) fail("ES4440", "MissingRailgunBroadcaster", "Broadcaster quote must identify the selected Broadcaster.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.feeToken)) fail("ES4441", "InvalidRailgunFeeToken", "Broadcaster fee token must be an EVM token address.");
  if (input.feeAmount < 0n) fail("ES4442", "InvalidRailgunFeeAmount", "Broadcaster fee amount cannot be negative.");
  if (!Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= (input.nowMs ?? Date.now())) fail("ES4443", "ExpiredRailgunBroadcasterFee", "Broadcaster fee quote is already expired or has an invalid expiry.", { expiresAtMs: input.expiresAtMs });
  const feeBindingHash = binding("railgun-fee-binding", {
    gasBindingHash: gas.gasBindingHash,
    broadcasterId: input.broadcasterId,
    feeToken: input.feeToken.toLowerCase(),
    feeAmount: input.feeAmount,
    feeRecipient: input.feeRecipient,
    expiresAtMs: input.expiresAtMs,
  });
  return {
    ...gas,
    state: "railgun-broadcaster-fee-quoted",
    broadcasterId: input.broadcasterId,
    feeToken: input.feeToken,
    feeAmount: input.feeAmount,
    feeRecipient: input.feeRecipient,
    expiresAtMs: input.expiresAtMs,
    feeBindingHash,
  };
}

export function createRailgunProofEvidence<C extends EvmChain>(source: RailgunGasEvidence<C> | RailgunBroadcasterFeeEvidence<C>, input: {
  proofId: string;
  generatedAtMs?: number;
}): RailgunProofEvidence<C> {
  if (!input.proofId) fail("ES4444", "MissingRailgunProofId", "Generated RAILGUN proof evidence requires a stable proof identifier.");
  if (!source.sendWithPublicWallet && source.state !== "railgun-broadcaster-fee-quoted") fail("ES4445", "RailgunBroadcasterFeeRequired", "Broadcaster RAILGUN proof generation requires a current broadcaster fee quote.");
  const generatedAtMs = input.generatedAtMs ?? Date.now();
  if (source.state === "railgun-broadcaster-fee-quoted" && generatedAtMs >= source.expiresAtMs) fail("ES4443", "ExpiredRailgunBroadcasterFee", "Broadcaster fee expired before proof generation completed.", { generatedAtMs, expiresAtMs: source.expiresAtMs });
  const proofBindingHash = binding("railgun-proof-binding", {
    base: source.state === "railgun-broadcaster-fee-quoted" ? source.feeBindingHash : source.gasBindingHash,
    proofId: input.proofId,
  });
  return {
    state: "railgun-proof-generated",
    chain: source.chain,
    proofId: input.proofId,
    proofBindingHash,
    generatedAtMs,
    ...(source.state === "railgun-broadcaster-fee-quoted" ? { broadcasterFeeExpiresAtMs: source.expiresAtMs } : {}),
    sendWithPublicWallet: source.sendWithPublicWallet,
  };
}

export function assertRailgunProofFresh<C extends EvmChain>(proof: RailgunProofEvidence<C>, nowMs = Date.now()): RailgunProofEvidence<C> {
  if (proof.broadcasterFeeExpiresAtMs !== undefined && nowMs >= proof.broadcasterFeeExpiresAtMs) fail("ES4446", "RailgunProofFeeBindingExpired", "RAILGUN proof is bound to an expired Broadcaster fee quote and must be regenerated.", { proofId: proof.proofId, expiresAtMs: proof.broadcasterFeeExpiresAtMs, nowMs });
  return proof;
}

export function populateRailgunTransaction<C extends EvmChain>(proof: RailgunProofEvidence<C>, serializedTransaction: Hex, nowMs = Date.now()): RailgunPopulatedTransaction<C> {
  assertRailgunProofFresh(proof, nowMs);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(serializedTransaction)) fail("ES4447", "InvalidRailgunPopulatedTransaction", "RAILGUN populated transaction must be non-empty whole-byte hexadecimal.");
  return {
    state: "railgun-populated",
    chain: proof.chain,
    proof,
    serializedTransaction,
    populatedHash: binding("railgun-populated", { proofBindingHash: proof.proofBindingHash, serializedTransaction: serializedTransaction.toLowerCase() }),
  };
}

export function markRailgunSubmitted<C extends EvmChain>(transaction: RailgunPopulatedTransaction<C>, input: {
  submission: "broadcaster" | "self";
  submissionId?: string;
  submittedAtMs?: number;
}): RailgunSubmittedTransaction<C> {
  if (transaction.proof.sendWithPublicWallet && input.submission !== "self") fail("ES4448", "RailgunSubmissionModeMismatch", "Self-submit RAILGUN proof cannot be submitted through a Broadcaster.");
  if (!transaction.proof.sendWithPublicWallet && input.submission !== "broadcaster") fail("ES4448", "RailgunSubmissionModeMismatch", "Broadcaster-bound RAILGUN proof cannot be silently switched to self submission.");
  const submittedAtMs = input.submittedAtMs ?? Date.now();
  assertRailgunProofFresh(transaction.proof, submittedAtMs);
  return { ...transaction, state: "railgun-submitted", submission: input.submission, submittedAtMs, ...(input.submissionId ? { submissionId: input.submissionId } : {}) };
}
