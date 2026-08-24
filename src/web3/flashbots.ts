import { keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EraDiagnosticError } from "../diagnostics.js";
import type { PrivateKeyRef } from "./secrets.js";
import type { SignedTx } from "./tx.js";
import { hash, type EvmChain, type Hash } from "./types.js";

const MAX_BUNDLE_TRANSACTIONS = 100;
const MAX_BUNDLE_BYTES = 300_000;

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function hexBlock(value: bigint): Hex {
  if (value < 0n) fail("ES3930", "InvalidBundleBlock", "Bundle block numbers cannot be negative.", { value: value.toString() });
  return `0x${value.toString(16)}` as Hex;
}

function rawBytes(value: Hex): number {
  return (value.length - 2) / 2;
}

export interface FlashbotsBundle<C extends EvmChain = EvmChain> {
  readonly state: "bundle-draft";
  readonly chain: C;
  readonly transactions: readonly SignedTx<C>[];
  readonly targetBlock: bigint;
  readonly stateBlock: bigint;
  readonly minTimestamp?: number;
  readonly maxTimestamp?: number;
  readonly replacementUuid?: string;
  readonly builders?: readonly string[];
  readonly totalBytes: number;
  readonly transactionHashes: readonly Hash<"keccak256">[];
}

export interface FlashbotsTransactionSimulation {
  readonly txHash?: string;
  readonly gasUsed?: bigint;
  readonly error?: string;
  readonly revert?: string;
}

export interface FlashbotsBundleSimulation {
  readonly targetBlock: bigint;
  readonly stateBlock: bigint;
  readonly bundleHash: Hash<"keccak256">;
  readonly totalGasUsed?: bigint;
  readonly transactions: readonly FlashbotsTransactionSimulation[];
  readonly raw: unknown;
}

export interface SimulatedFlashbotsBundle<C extends EvmChain = EvmChain> extends Omit<FlashbotsBundle<C>, "state"> {
  readonly state: "bundle-simulated";
  readonly simulation: FlashbotsBundleSimulation;
}

export interface SubmittedFlashbotsBundle<C extends EvmChain = EvmChain> extends Omit<SimulatedFlashbotsBundle<C>, "state"> {
  readonly state: "bundle-submitted";
  readonly submittedAt: number;
  readonly relayBundleHash: Hash<"keccak256">;
  readonly smart: boolean;
}

export interface FlashbotsRelay {
  readonly url: string;
  readonly authAddress: string;
  request<Result>(method: string, params: readonly unknown[]): Promise<Result>;
}

export function createFlashbotsBundle<C extends EvmChain>(input: {
  chain: C;
  transactions: readonly SignedTx<C>[];
  currentBlock: bigint;
  targetBlock?: bigint;
  minTimestamp?: number;
  maxTimestamp?: number;
  replacementUuid?: string;
  builders?: readonly string[];
}): FlashbotsBundle<C> {
  const targetBlock = input.targetBlock ?? input.currentBlock + 1n;
  if (targetBlock <= input.currentBlock) fail("ES3931", "BundleTargetNotFuture", "Flashbots bundle target block must be in the future.", {
    currentBlock: input.currentBlock.toString(), targetBlock: targetBlock.toString(),
  });
  if (input.transactions.length === 0 || input.transactions.length > MAX_BUNDLE_TRANSACTIONS) {
    fail("ES3932", "InvalidBundleTransactionCount", `Flashbots bundle must contain 1-${MAX_BUNDLE_TRANSACTIONS} transactions.`, { count: input.transactions.length });
  }
  if (input.minTimestamp !== undefined && (!Number.isSafeInteger(input.minTimestamp) || input.minTimestamp < 0)) fail("ES3933", "InvalidBundleTimestamp", "minTimestamp must be a non-negative Unix timestamp.");
  if (input.maxTimestamp !== undefined && (!Number.isSafeInteger(input.maxTimestamp) || input.maxTimestamp < 0)) fail("ES3933", "InvalidBundleTimestamp", "maxTimestamp must be a non-negative Unix timestamp.");
  if (input.minTimestamp !== undefined && input.maxTimestamp !== undefined && input.minTimestamp > input.maxTimestamp) fail("ES3933", "InvalidBundleTimestamp", "minTimestamp cannot exceed maxTimestamp.");
  if (input.replacementUuid !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.replacementUuid)) {
    fail("ES3934", "InvalidReplacementUuid", "Flashbots replacementUuid must be UUIDv4.", { replacementUuid: input.replacementUuid });
  }

  const seenNonces = new Map<string, number>();
  let totalBytes = 0;
  const transactionHashes: Hash<"keccak256">[] = [];
  for (const [index, tx] of input.transactions.entries()) {
    if (tx.intent.chain.id !== input.chain.id) fail("ES3104", "ChainMismatch", "Flashbots bundle contains a transaction from another chain.", { index, bundleChain: input.chain.id, transactionChain: tx.intent.chain.id });
    totalBytes += rawBytes(tx.rawTransaction);
    transactionHashes.push(hash(keccak256(tx.rawTransaction), "keccak256"));
    if (tx.intent.from) {
      const key = tx.intent.from.toLowerCase();
      const previous = seenNonces.get(key);
      if (previous !== undefined && tx.nonce.value !== previous + 1) fail("ES3935", "BundleNonceGap", "Transactions from the same sender are not nonce-contiguous in bundle order.", { index, sender: tx.intent.from, previousNonce: previous, nonce: tx.nonce.value });
      seenNonces.set(key, tx.nonce.value);
    }
  }
  if (totalBytes > MAX_BUNDLE_BYTES) fail("ES3936", "BundleSizeExceeded", `Flashbots bundle exceeds ${MAX_BUNDLE_BYTES} bytes.`, { totalBytes });

  return {
    state: "bundle-draft",
    chain: input.chain,
    transactions: input.transactions,
    targetBlock,
    stateBlock: input.currentBlock,
    ...(input.minTimestamp !== undefined ? { minTimestamp: input.minTimestamp } : {}),
    ...(input.maxTimestamp !== undefined ? { maxTimestamp: input.maxTimestamp } : {}),
    ...(input.replacementUuid ? { replacementUuid: input.replacementUuid } : {}),
    ...(input.builders ? { builders: input.builders } : {}),
    totalBytes,
    transactionHashes,
  };
}

/** Retargeting deliberately returns a draft bundle, forcing a fresh simulation for the new block. */
export function retargetFlashbotsBundle<C extends EvmChain>(bundle: FlashbotsBundle<C> | SimulatedFlashbotsBundle<C>, currentBlock: bigint, targetBlock = currentBlock + 1n): FlashbotsBundle<C> {
  return createFlashbotsBundle({
    chain: bundle.chain,
    transactions: bundle.transactions,
    currentBlock,
    targetBlock,
    ...(bundle.minTimestamp !== undefined ? { minTimestamp: bundle.minTimestamp } : {}),
    ...(bundle.maxTimestamp !== undefined ? { maxTimestamp: bundle.maxTimestamp } : {}),
    ...(bundle.replacementUuid ? { replacementUuid: bundle.replacementUuid } : {}),
    ...(bundle.builders ? { builders: bundle.builders } : {}),
  });
}

function parseBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^(?:0x[0-9a-f]+|\d+)$/i.test(value)) return BigInt(value);
  return undefined;
}

export async function simulateFlashbotsBundle<C extends EvmChain>(relay: FlashbotsRelay, bundle: FlashbotsBundle<C>): Promise<SimulatedFlashbotsBundle<C>> {
  const result = await relay.request<Record<string, unknown>>("eth_callBundle", [{
    txs: bundle.transactions.map((tx) => tx.rawTransaction),
    blockNumber: hexBlock(bundle.targetBlock),
    stateBlockNumber: hexBlock(bundle.stateBlock),
    ...(bundle.minTimestamp !== undefined ? { timestamp: bundle.minTimestamp } : {}),
  }]);
  const rows = Array.isArray(result.results) ? result.results as Record<string, unknown>[] : [];
  const transactions = rows.map((row) => ({
    ...(typeof row.txHash === "string" ? { txHash: row.txHash } : {}),
    ...(parseBigInt(row.gasUsed) !== undefined ? { gasUsed: parseBigInt(row.gasUsed)! } : {}),
    ...(typeof row.error === "string" ? { error: row.error } : {}),
    ...(typeof row.revert === "string" ? { revert: row.revert } : {}),
  }));
  const failed = transactions.find((tx) => tx.error !== undefined || tx.revert !== undefined);
  if (failed || typeof result.firstRevert === "object") fail("ES3937", "FlashbotsBundleSimulationFailed", "Flashbots bundle simulation contains a reverting or failed transaction.", { targetBlock: bundle.targetBlock.toString(), failure: failed ?? result.firstRevert });
  if (typeof result.bundleHash !== "string") fail("ES3938", "MissingBundleHash", "Flashbots simulation did not return a bundleHash.");
  return {
    ...bundle,
    state: "bundle-simulated",
    simulation: {
      targetBlock: bundle.targetBlock,
      stateBlock: bundle.stateBlock,
      bundleHash: hash(result.bundleHash, "keccak256"),
      ...(parseBigInt(result.totalGasUsed) !== undefined ? { totalGasUsed: parseBigInt(result.totalGasUsed)! } : {}),
      transactions,
      raw: result,
    },
  };
}

export async function submitFlashbotsBundle<C extends EvmChain>(relay: FlashbotsRelay, bundle: SimulatedFlashbotsBundle<C>, currentBlock: bigint): Promise<SubmittedFlashbotsBundle<C>> {
  if (bundle.simulation.targetBlock !== bundle.targetBlock || bundle.simulation.stateBlock !== bundle.stateBlock) fail("ES3939", "BundleSimulationBindingMismatch", "Bundle simulation evidence is not bound to the bundle target/state block.");
  if (currentBlock !== bundle.stateBlock) fail("ES3940", "StaleBundleSimulation", "Chain head changed since this bundle was simulated. Retarget/re-simulate before submission.", { simulatedStateBlock: bundle.stateBlock.toString(), currentBlock: currentBlock.toString(), targetBlock: bundle.targetBlock.toString() });
  if (bundle.targetBlock <= currentBlock) fail("ES3941", "BundleTargetExpired", "Flashbots bundle target block is no longer in the future.", { targetBlock: bundle.targetBlock.toString(), currentBlock: currentBlock.toString() });

  const result = await relay.request<{ bundleHash: string; smart?: string | boolean }>("eth_sendBundle", [{
    txs: bundle.transactions.map((tx) => tx.rawTransaction),
    blockNumber: hexBlock(bundle.targetBlock),
    ...(bundle.minTimestamp !== undefined ? { minTimestamp: bundle.minTimestamp } : {}),
    ...(bundle.maxTimestamp !== undefined ? { maxTimestamp: bundle.maxTimestamp } : {}),
    ...(bundle.replacementUuid ? { replacementUuid: bundle.replacementUuid } : {}),
    ...(bundle.builders ? { builders: bundle.builders } : {}),
  }]);
  if (!result || typeof result.bundleHash !== "string") fail("ES3942", "FlashbotsSubmissionFailed", "Flashbots relay did not return a bundleHash.");
  return {
    ...bundle,
    state: "bundle-submitted",
    submittedAt: Date.now(),
    relayBundleHash: hash(result.bundleHash, "keccak256"),
    smart: result.smart === true || result.smart === "true",
  };
}

function loadAuthKey<C extends EvmChain>(ref: PrivateKeyRef<C>): Hex {
  const value = process.env[ref.source.name];
  if (!value) fail("ES3943", "MissingFlashbotsAuthSecret", "Flashbots auth key environment variable is unavailable.", { env: ref.source.name });
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) fail("ES3944", "InvalidFlashbotsAuthSecret", "Flashbots auth key must be a 32-byte ECDSA private key.", { env: ref.source.name });
  return value as Hex;
}

/**
 * Direct authenticated Flashbots JSON-RPC transport. Auth key is only relay identity/reputation and should be separate from funded transaction signers.
 */
export function createFlashbotsRelay<C extends EvmChain>(input: { url: string; auth: PrivateKeyRef<C> }): FlashbotsRelay {
  let account: ReturnType<typeof privateKeyToAccount>;
  try { account = privateKeyToAccount(loadAuthKey(input.auth)); }
  catch { return fail("ES3944", "InvalidFlashbotsAuthSecret", "Flashbots auth key could not derive an ECDSA account."); }
  return {
    url: input.url,
    authAddress: account.address,
    async request<Result>(method: string, params: readonly unknown[]): Promise<Result> {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
      const bodyHash = keccak256(stringToHex(body));
      const signature = await account.signMessage({ message: { raw: bodyHash } });
      let response: Response;
      try {
        response = await fetch(input.url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-flashbots-signature": `${account.address}:${signature}` },
          body,
        });
      } catch (error) {
        return fail("ES3945", "FlashbotsTransportError", "Flashbots relay request failed before receiving an HTTP response.", { method, cause: error instanceof Error ? error.message : String(error) });
      }
      if (!response.ok) fail("ES3946", "FlashbotsHttpError", "Flashbots relay returned a non-success HTTP status.", { method, status: response.status, statusText: response.statusText });
      const payload = await response.json() as { result?: Result; error?: { code?: number; message?: string } };
      if (payload.error) fail("ES3947", "FlashbotsRpcError", payload.error.message ?? "Flashbots relay returned a JSON-RPC error.", { method, rpcCode: payload.error.code });
      if (payload.result === undefined) fail("ES3948", "FlashbotsMissingResult", "Flashbots relay JSON-RPC response has no result.", { method });
      return payload.result;
    },
  };
}
