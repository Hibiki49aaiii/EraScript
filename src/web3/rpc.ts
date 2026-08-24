import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { nonce, type Nonce, type NonceSource } from "./nonce.js";
import {
  markBroadcast,
  markConfirmed,
  markFinalized,
  markIncluded,
  markReplaced,
  prepareTransaction,
  recordSimulation,
  type BroadcastTx,
  type ConfirmedTx,
  type DraftTx,
  type FeeModel,
  type FinalizedTx,
  type IncludedTx,
  type PendingTx,
  type PreparedTx,
  type ReceiptEvidence,
  type ReplacedTx,
  type SignedTx,
  type SimulationFailedTx,
  type SimulatedTx,
} from "./tx.js";
import { blockHash, transactionHash, type Address, type EvmChain } from "./types.js";
import { gas, maxFeePerGas, maxPriorityFeePerGas, unwrapGas, unwrapWei, weiPerGas } from "./values.js";

export interface ViemClientLike {
  readonly chain?: { readonly id: number; readonly name?: string };
}

export type RpcNonceSource = Exclude<NonceSource, "explicit">;
export type RpcBlockTag = "latest" | "pending" | "safe" | "finalized";
export type SimulationBlockTag = Exclude<RpcBlockTag, "pending">;
export type RpcFeePreference = "auto" | "eip1559" | "legacy";

type RpcBlock = { readonly number: bigint | null; readonly hash: Hex | null };
type RpcReceipt = {
  readonly transactionHash: Hex;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  readonly effectiveGasPrice?: bigint;
};
type ReplacementNotice = {
  readonly reason: "replaced" | "repriced" | "cancelled";
  readonly transaction: { readonly hash: Hex };
  readonly transactionReceipt: RpcReceipt;
};

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function action<A, R>(client: ViemClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES3700", "MissingRpcAction", `The supplied viem client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

export function assertRpcChain<C extends EvmChain>(client: ViemClientLike, chain: C): void {
  if (!client.chain) fail("ES3701", "UnboundRpcClient", "EraScript requires a chain-bound viem client for execution evidence.", { expectedChain: chain.name, expectedChainId: chain.id });
  if (client.chain.id !== chain.id) fail("ES3104", "ChainMismatch", "The viem client chain does not match the EraScript transaction chain.", {
    expectedChain: chain.name,
    expectedChainId: chain.id,
    actualChain: client.chain.name ?? "unknown",
    actualChainId: client.chain.id,
  });
}

export async function readNonceFromRpc<C extends EvmChain, S extends RpcNonceSource>(client: ViemClientLike, chain: C, account: Address<C>, source: S): Promise<Nonce<C, S>> {
  assertRpcChain(client, chain);
  const getCount = action<{ address: Hex; blockTag: RpcBlockTag }, number>(client, "getTransactionCount");
  const getBlock = action<{ blockTag: RpcBlockTag }, RpcBlock>(client, "getBlock");
  const [value, observed] = await Promise.all([getCount({ address: account, blockTag: source }), getBlock({ blockTag: source })]);
  return nonce(chain, value, source, observed.number ?? undefined);
}

export async function estimateGasFromRpc<C extends EvmChain>(client: ViemClientLike, draft: DraftTx<C>): Promise<ReturnType<typeof gas>> {
  assertRpcChain(client, draft.intent.chain);
  if (!draft.intent.from) fail("ES3702", "MissingTransactionSender", "RPC gas estimation requires an explicit transaction sender.");
  const estimate = action<{ account: Hex; to?: Hex; value?: bigint; data?: Hex }, bigint>(client, "estimateGas");
  return gas(await estimate({
    account: draft.intent.from,
    ...(draft.intent.to ? { to: draft.intent.to } : {}),
    ...(draft.intent.value !== undefined ? { value: unwrapWei(draft.intent.value) } : {}),
    ...(draft.intent.data !== undefined ? { data: draft.intent.data as Hex } : {}),
  }));
}

export async function estimateFeeModelFromRpc<C extends EvmChain>(client: ViemClientLike, chain: C, preference: RpcFeePreference = "auto"): Promise<FeeModel> {
  assertRpcChain(client, chain);
  const estimate = action<{ type?: "eip1559" | "legacy" }, { gasPrice?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>(client, "estimateFeesPerGas");
  const result = await estimate(preference === "auto" ? {} : { type: preference });
  if (preference !== "legacy" && result.maxFeePerGas !== undefined && result.maxPriorityFeePerGas !== undefined) {
    return { type: "eip1559", maxFeePerGas: maxFeePerGas(result.maxFeePerGas), maxPriorityFeePerGas: maxPriorityFeePerGas(result.maxPriorityFeePerGas) };
  }
  if (preference !== "eip1559" && result.gasPrice !== undefined) return { type: "legacy", gasPrice: weiPerGas(result.gasPrice) };
  return fail("ES3703", "UnsupportedFeeEvidence", "RPC fee estimation did not return the required fee model.", { preference });
}

export async function prepareDraftWithRpc<C extends EvmChain>(client: ViemClientLike, draft: DraftTx<C>, options: { nonceSource?: RpcNonceSource; feePreference?: RpcFeePreference } = {}): Promise<PreparedTx<C>> {
  if (!draft.intent.from) fail("ES3702", "MissingTransactionSender", "RPC transaction preparation requires an explicit sender.");
  const [txNonce, txGas, fees] = await Promise.all([
    readNonceFromRpc(client, draft.intent.chain, draft.intent.from, options.nonceSource ?? "pending"),
    estimateGasFromRpc(client, draft),
    estimateFeeModelFromRpc(client, draft.intent.chain, options.feePreference ?? "auto"),
  ]);
  return prepareTransaction(draft, { nonce: txNonce, gas: txGas, fees });
}

export async function simulatePreparedWithRpc<C extends EvmChain>(client: ViemClientLike, prepared: PreparedTx<C>, options: { blockTag?: SimulationBlockTag; stateOverride?: unknown; provider?: string; assumptions?: readonly string[] } = {}): Promise<SimulatedTx<C> | SimulationFailedTx<C>> {
  assertRpcChain(client, prepared.intent.chain);
  const blockTag = options.blockTag ?? "latest";
  let anchor: RpcBlock | undefined;
  try {
    anchor = await action<{ blockTag: SimulationBlockTag }, RpcBlock>(client, "getBlock")({ blockTag });
    if (anchor.number === null || anchor.hash === null) fail("ES3704", "UnanchoredSimulation", "Simulation block could not be anchored to a concrete number and hash.", { blockTag });
    const call = action<{ account?: Hex; to?: Hex; value?: bigint; data?: Hex; gas?: bigint; blockNumber: bigint; stateOverride?: unknown }, { data?: Hex }>(client, "call");
    const result = await call({
      ...(prepared.intent.from ? { account: prepared.intent.from as Hex } : {}),
      ...(prepared.intent.to ? { to: prepared.intent.to as Hex } : {}),
      ...(prepared.intent.value !== undefined ? { value: unwrapWei(prepared.intent.value) } : {}),
      ...(prepared.intent.data !== undefined ? { data: prepared.intent.data as Hex } : {}),
      gas: unwrapGas(prepared.gas),
      blockNumber: anchor.number,
      ...(options.stateOverride !== undefined ? { stateOverride: options.stateOverride } : {}),
    });
    return recordSimulation(prepared, {
      status: "success",
      blockNumber: anchor.number,
      blockHash: anchor.hash,
      ...(result.data !== undefined ? { returnData: result.data } : {}),
      stateOverrides: options.stateOverride !== undefined,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.assumptions ? { assumptions: options.assumptions } : {}),
    });
  } catch (error) {
    return recordSimulation(prepared, {
      status: "failure",
      ...(anchor?.number !== null && anchor?.number !== undefined ? { blockNumber: anchor.number } : {}),
      ...(anchor?.hash ? { blockHash: anchor.hash } : {}),
      stateOverrides: options.stateOverride !== undefined,
      ...(options.provider ? { provider: options.provider } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function broadcastSignedWithRpc<C extends EvmChain>(client: ViemClientLike, signed: SignedTx<C>): Promise<BroadcastTx<C>> {
  assertRpcChain(client, signed.intent.chain);
  const sendRaw = action<{ serializedTransaction: Hex }, Hex>(client, "sendRawTransaction");
  return markBroadcast(signed, await sendRaw({ serializedTransaction: signed.rawTransaction }));
}

function receiptEvidence<C extends EvmChain>(receipt: RpcReceipt, chain: C): ReceiptEvidence<C> {
  return {
    transactionHash: transactionHash(receipt.transactionHash, chain),
    blockHash: blockHash(receipt.blockHash, chain),
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    ...(receipt.effectiveGasPrice !== undefined ? { effectiveGasPrice: receipt.effectiveGasPrice } : {}),
  };
}

export type InclusionWaitResult<C extends EvmChain> =
  | { readonly kind: "included"; readonly transaction: IncludedTx<C> }
  | { readonly kind: "replaced"; readonly transaction: ReplacedTx<C>; readonly replacementReceipt: ReceiptEvidence<C> };

export async function waitForInclusionFromRpc<C extends EvmChain>(client: ViemClientLike, source: BroadcastTx<C> | PendingTx<C>): Promise<InclusionWaitResult<C>> {
  assertRpcChain(client, source.intent.chain);
  const wait = action<{ hash: Hex; confirmations: number; onReplaced: (notice: ReplacementNotice) => void }, RpcReceipt>(client, "waitForTransactionReceipt");
  const getReceipt = action<{ hash: Hex }, RpcReceipt>(client, "getTransactionReceipt");
  let replacement: ReplacementNotice | undefined;
  let receipt: RpcReceipt;
  try {
    receipt = await wait({ hash: source.hash, confirmations: 1, onReplaced: (notice) => { replacement = notice; } });
  } catch (waitError) {
    if (replacement) receipt = replacement.transactionReceipt;
    else {
      try { receipt = await getReceipt({ hash: source.hash }); }
      catch (receiptError) { return fail("ES3705", "ReceiptWaitFailed", "Failed to obtain transaction inclusion evidence.", { waitError: String(waitError), receiptError: String(receiptError), hash: source.hash }); }
    }
  }
  if (replacement) return {
    kind: "replaced",
    transaction: markReplaced(source, replacement.transaction.hash, replacement.reason),
    replacementReceipt: receiptEvidence(replacement.transactionReceipt, source.intent.chain),
  };
  return { kind: "included", transaction: markIncluded(source, receipt) };
}

export async function assertReceiptCanonicalFromRpc<C extends EvmChain>(client: ViemClientLike, transaction: Pick<IncludedTx<C>, "intent" | "receipt">): Promise<void> {
  assertRpcChain(client, transaction.intent.chain);
  const canonical = await action<{ blockNumber: bigint }, RpcBlock>(client, "getBlock")({ blockNumber: transaction.receipt.blockNumber });
  if (!canonical.hash || canonical.hash.toLowerCase() !== transaction.receipt.blockHash.toLowerCase()) fail("ES3707", "ReorgDetected", "The transaction receipt block is no longer canonical.", {
    receiptBlockNumber: transaction.receipt.blockNumber.toString(),
    receiptBlockHash: transaction.receipt.blockHash,
    canonicalBlockHash: canonical.hash ?? null,
  });
}

export async function confirmIncludedFromRpc<C extends EvmChain, N extends number>(client: ViemClientLike, included: IncludedTx<C>, required: N): Promise<ReturnType<typeof markConfirmed<C, N>>> {
  if (!Number.isSafeInteger(required) || required < 1) fail("ES3433", "InvalidConfirmationCount", "Confirmations must be a positive safe integer.", { confirmations: required });
  await assertReceiptCanonicalFromRpc(client, included);
  const observed = await action<{ hash: Hex }, bigint>(client, "getTransactionConfirmations")({ hash: included.hash });
  if (observed < BigInt(required)) fail("ES3706", "InsufficientConfirmations", "Transaction has not reached the required confirmation count.", { required, observed: observed.toString(), hash: included.hash });
  return markConfirmed(included, required);
}

export async function finalizeConfirmedFromRpc<C extends EvmChain>(client: ViemClientLike, confirmed: ConfirmedTx<C, number>): Promise<FinalizedTx<C>> {
  await assertReceiptCanonicalFromRpc(client, confirmed);
  const finalized = await action<{ blockTag: "finalized" }, RpcBlock>(client, "getBlock")({ blockTag: "finalized" });
  if (finalized.number === null) fail("ES3708", "FinalizedBlockUnavailable", "RPC did not return a concrete finalized block number.");
  if (finalized.number < confirmed.receipt.blockNumber) fail("ES3709", "TransactionNotFinalized", "Transaction block has not reached finalized status.", { transactionBlock: confirmed.receipt.blockNumber.toString(), finalizedBlock: finalized.number.toString() });
  return markFinalized(confirmed);
}
