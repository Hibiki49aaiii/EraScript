import { keccak256, stringToHex, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain, Hash } from "../web3/types.js";
import { hash } from "../web3/types.js";

const railgunBrand: unique symbol = Symbol("railgunBrand");
export type RailgunAddress = string & { readonly [railgunBrand]: "RailgunAddress" };

export interface RailgunIntent<C extends EvmChain = EvmChain> {
  readonly state: "railgun-intent";
  readonly chain: C;
  readonly txidVersion: string;
  readonly walletId: string;
  readonly recipients: readonly RailgunAddress[];
  readonly tokenAmounts: readonly { readonly token: `0x${string}`; readonly amount: bigint }[];
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
  readonly expiresAt: number;
  readonly feeBindingHash: Hash<"railgun-fee-binding">;
}

export interface RailgunProofEvidence<C extends EvmChain = EvmChain> {
  readonly state: "railgun-proof-generated";
  readonly chain: C;
  readonly proofId: string;
  readonly proofBindingHash: Hash<"railgun-proof-binding">;
  readonly generatedAt: number;
  readonly broadcasterFeeExpiresAt?: number;
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
  readonly submittedAt: number;
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
  recipients: readonly RailgunAddress[];
  tokenAmounts: readonly { readonly token: `0x${string}`; readonly amount: bigint }[];
  memo?: string;
  sendWithPublicWallet?: boolean;
}): RailgunIntent<C> {
  if (!input.txidVersion) fail("ES4431", "MissingRailgunTxidVersion", "RAILGUN intent must bind an explicit TXID version.");
  if (!input.walletId) fail("ES4432", "MissingRailgunWalletId", "RAILGUN intent must bind a wallet ID.");
  if (input.recipients.length === 0) fail("ES4433", "EmptyRailgunRecipients", "RAILGUN private transfer must contain at least one recipient.");
  if (input.tokenAmounts.length === 0) fail("ES4434", "EmptyRailgunAmounts", "RAILGUN private transfer must contain at least one token amount.");
  if (input.recipients.length !== input.tokenAmounts.length) fail("ES4435", "RailgunRecipientAmountMismatch", "RAILGUN normalized intent requires one token amount entry per recipient entry.", { recipients: input.recipients.length, tokenAmounts: input.tokenAmounts.length });
  for (const row of input.tokenAmounts) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(row.token)) fail("ES4436", "InvalidRailgunTokenAddress", "RAILGUN token address must be a 20-byte EVM address.", { token: row.token });
    if (row.amount < 0n) fail("ES4437", "InvalidRailgunTokenAmount", "RAILGUN token amounts cannot be negative.", { amount: row.amount.toString() });
  }
  const sendWithPublicWallet = input.sendWithPublicWallet ?? false;
  const canonical = {
    chainId: input.chain.id,
    txidVersion: input.txidVersion,
    walletId: input.walletId,
    recipients: input.recipients,
    tokenAmounts: input.tokenAmounts,
    memo: input.memo ?? null,
    sendWithPublicWallet,
  };
  return {
    state: "railgun-intent",
    chain: input.chain,
    txidVersion: input.txidVersion,
    walletId: input.walletId,
    recipients: input.recipients,
    tokenAmounts: input.tokenAmounts,
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
  expiresAt: number;
  now?: number;
}): RailgunBroadcasterFeeEvidence<C> {
  if (gas.sendWithPublicWallet) fail("ES4439", "UnexpectedRailgunBroadcasterFee", "Broadcaster fee evidence cannot be attached to a self-submit RAILGUN intent.");
  if (!input.broadcasterId) fail("ES4440", "MissingRailgunBroadcaster", "Broadcaster quote must identify the selected Broadcaster.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.feeToken)) fail("ES4441", "InvalidRailgunFeeToken", "Broadcaster fee token must be an EVM token address.");
  if (input.feeAmount < 0n) fail("ES4442", "InvalidRailgunFeeAmount", "Broadcaster fee amount cannot be negative.");
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= (input.now ?? Date.now())) fail("ES4443", "ExpiredRailgunBroadcasterFee", "Broadcaster fee quote is already expired or has an invalid expiry.", { expiresAt: input.expiresAt });
  const feeBindingHash = binding("railgun-fee-binding", {
    gasBindingHash: gas.gasBindingHash,
    broadcasterId: input.broadcasterId,
    feeToken: input.feeToken.toLowerCase(),
    feeAmount: input.feeAmount,
    feeRecipient: input.feeRecipient,
    expiresAt: input.expiresAt,
  });
  return {
    ...gas,
    state: "railgun-broadcaster-fee-quoted",
    broadcasterId: input.broadcasterId,
    feeToken: input.feeToken,
    feeAmount: input.feeAmount,
    feeRecipient: input.feeRecipient,
    expiresAt: input.expiresAt,
    feeBindingHash,
  };
}

export function createRailgunProofEvidence<C extends EvmChain>(source: RailgunGasEvidence<C> | RailgunBroadcasterFeeEvidence<C>, input: {
  proofId: string;
  generatedAt?: number;
}): RailgunProofEvidence<C> {
  if (!input.proofId) fail("ES4444", "MissingRailgunProofId", "Generated RAILGUN proof evidence requires a stable proof identifier.");
  if (!source.sendWithPublicWallet && source.state !== "railgun-broadcaster-fee-quoted") fail("ES4445", "RailgunBroadcasterFeeRequired", "Broadcaster RAILGUN proof generation requires a current broadcaster fee quote.");
  const generatedAt = input.generatedAt ?? Date.now();
  if (source.state === "railgun-broadcaster-fee-quoted" && generatedAt >= source.expiresAt) fail("ES4443", "ExpiredRailgunBroadcasterFee", "Broadcaster fee expired before proof generation completed.", { generatedAt, expiresAt: source.expiresAt });
  const proofBindingHash = binding("railgun-proof-binding", {
    base: source.state === "railgun-broadcaster-fee-quoted" ? source.feeBindingHash : source.gasBindingHash,
    proofId: input.proofId,
  });
  return {
    state: "railgun-proof-generated",
    chain: source.chain,
    proofId: input.proofId,
    proofBindingHash,
    generatedAt,
    ...(source.state === "railgun-broadcaster-fee-quoted" ? { broadcasterFeeExpiresAt: source.expiresAt } : {}),
    sendWithPublicWallet: source.sendWithPublicWallet,
  };
}

export function assertRailgunProofFresh<C extends EvmChain>(proof: RailgunProofEvidence<C>, now = Date.now()): RailgunProofEvidence<C> {
  if (proof.broadcasterFeeExpiresAt !== undefined && now >= proof.broadcasterFeeExpiresAt) fail("ES4446", "RailgunProofFeeBindingExpired", "RAILGUN proof is bound to an expired Broadcaster fee quote and must be regenerated.", { proofId: proof.proofId, expiresAt: proof.broadcasterFeeExpiresAt, now });
  return proof;
}

export function populateRailgunTransaction<C extends EvmChain>(proof: RailgunProofEvidence<C>, serializedTransaction: Hex, now = Date.now()): RailgunPopulatedTransaction<C> {
  assertRailgunProofFresh(proof, now);
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
  submittedAt?: number;
}): RailgunSubmittedTransaction<C> {
  if (transaction.proof.sendWithPublicWallet && input.submission !== "self") fail("ES4448", "RailgunSubmissionModeMismatch", "Self-submit RAILGUN proof cannot be submitted through a Broadcaster.");
  if (!transaction.proof.sendWithPublicWallet && input.submission !== "broadcaster") fail("ES4448", "RailgunSubmissionModeMismatch", "Broadcaster-bound RAILGUN proof cannot be silently switched to self submission.");
  assertRailgunProofFresh(transaction.proof, input.submittedAt ?? Date.now());
  return { ...transaction, state: "railgun-submitted", submission: input.submission, submittedAt: input.submittedAt ?? Date.now(), ...(input.submissionId ? { submissionId: input.submissionId } : {}) };
}
