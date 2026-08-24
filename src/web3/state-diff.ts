import { keccak256, stringToHex, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { assertRpcChain, type ViemClientLike } from "./rpc.js";
import type { SimulatedTx } from "./tx.js";
import { blockHash, hash, type BlockHash, type EvmChain, type Hash } from "./types.js";
import { unwrapGas, unwrapWei } from "./values.js";

export interface StateDiffAccount {
  readonly balance?: string;
  readonly nonce?: string | number;
  readonly code?: Hex;
  readonly storage?: Readonly<Record<string, string>>;
}

export interface StateDiffSimulationEvidence<C extends EvmChain = EvmChain> {
  readonly kind: "state-diff-simulation";
  readonly engine: "debug_traceCall/prestateTracer";
  readonly chain: C;
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash<C>;
  readonly hypothetical: boolean;
  readonly provider?: string;
  readonly pre: Readonly<Record<string, StateDiffAccount>>;
  readonly post: Readonly<Record<string, StateDiffAccount>>;
  readonly changedAccounts: number;
  readonly diffHash: Hash<"state-diff">;
}

interface TraceDiffResult {
  readonly pre?: Record<string, unknown>;
  readonly post?: Record<string, unknown>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function rpcAction<A, R>(client: ViemClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4060", "MissingStateDiffRpcAction", `The supplied RPC client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

function wholeHex(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail("ES4061", "MalformedStateDiff", `${label} must be whole-byte 0x-prefixed hexadecimal.`);
  return value.toLowerCase();
}

function normalizeStorage(value: unknown, address: string): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("ES4061", "MalformedStateDiff", "State diff storage must be an object.", { address });
  const result: Record<string, string> = {};
  for (const [slot, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(slot) || typeof item !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item)) fail("ES4061", "MalformedStateDiff", "State diff storage slots and values must be bytes32 hexadecimal.", { address, slot });
    result[slot.toLowerCase()] = item.toLowerCase();
  }
  return result;
}

function normalizeAccount(value: unknown, address: string): StateDiffAccount {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("ES4061", "MalformedStateDiff", "State diff account must be an object.", { address });
  const record = value as Record<string, unknown>;
  const balance = wholeHex(record.balance, `${address}.balance`);
  const code = wholeHex(record.code, `${address}.code`);
  const nonce = record.nonce;
  if (nonce !== undefined && !(typeof nonce === "number" && Number.isSafeInteger(nonce) && nonce >= 0) && !(typeof nonce === "string" && /^0x[0-9a-fA-F]+$/.test(nonce))) {
    fail("ES4061", "MalformedStateDiff", "State diff nonce must be a non-negative safe integer or RPC hexadecimal quantity.", { address });
  }
  const storage = normalizeStorage(record.storage, address);
  return {
    ...(balance !== undefined ? { balance } : {}),
    ...(nonce !== undefined ? { nonce: typeof nonce === "string" ? nonce.toLowerCase() : nonce } : {}),
    ...(code !== undefined ? { code: code as Hex } : {}),
    ...(storage !== undefined ? { storage } : {}),
  };
}

function normalizeAccounts(value: unknown, label: string): Readonly<Record<string, StateDiffAccount>> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("ES4061", "MalformedStateDiff", `${label} must be an address-keyed object.`);
  const result: Record<string, StateDiffAccount> = {};
  for (const [account, state] of Object.entries(value as Record<string, unknown>)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) fail("ES4061", "MalformedStateDiff", "State diff account key is not an EVM address.", { account });
    result[account.toLowerCase()] = normalizeAccount(state, account);
  }
  return result;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function blockQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

export async function traceSimulatedStateDiff<C extends EvmChain>(client: ViemClientLike, simulated: SimulatedTx<C>, options: {
  readonly stateOverrides?: unknown;
  readonly blockOverrides?: unknown;
  readonly disableCode?: boolean;
  readonly disableStorage?: boolean;
  readonly provider?: string;
} = {}): Promise<StateDiffSimulationEvidence<C>> {
  assertRpcChain(client, simulated.intent.chain);
  if (simulated.simulation.blockNumber === undefined || simulated.simulation.blockHash === undefined) fail("ES4062", "UnanchoredStateDiffSimulation", "State-diff tracing requires an already successful simulation anchored to a concrete block number/hash.");
  if (simulated.simulation.stateOverrides && options.stateOverrides === undefined) fail("ES4063", "StateDiffAssumptionMismatch", "The source simulation used state overrides but the state-diff trace did not receive equivalent overrides.");

  const getBlock = rpcAction<{ blockNumber: bigint }, { readonly number: bigint | null; readonly hash: Hex | null }>(client, "getBlock");
  const anchorBefore = await getBlock({ blockNumber: simulated.simulation.blockNumber });
  if (!anchorBefore.hash || anchorBefore.hash.toLowerCase() !== simulated.simulation.blockHash.toLowerCase()) fail("ES4064", "StateDiffAnchorReorged", "Simulation anchor block is no longer canonical before state-diff tracing.", { expected: simulated.simulation.blockHash, actual: anchorBefore.hash ?? null });

  const request = rpcAction<{ method: string; params: readonly unknown[] }, TraceDiffResult>(client, "request");
  const transaction: Record<string, unknown> = {
    ...(simulated.intent.from ? { from: simulated.intent.from } : {}),
    ...(simulated.intent.to ? { to: simulated.intent.to } : {}),
    ...(simulated.intent.value !== undefined ? { value: `0x${unwrapWei(simulated.intent.value).toString(16)}` } : {}),
    ...(simulated.intent.data !== undefined ? { data: simulated.intent.data } : {}),
    gas: `0x${unwrapGas(simulated.gas).toString(16)}`,
  };
  if (simulated.fees.type === "eip1559") {
    transaction.maxFeePerGas = `0x${unwrapWei(simulated.fees.maxFeePerGas).toString(16)}`;
    transaction.maxPriorityFeePerGas = `0x${unwrapWei(simulated.fees.maxPriorityFeePerGas).toString(16)}`;
  } else {
    transaction.gasPrice = `0x${unwrapWei(simulated.fees.gasPrice).toString(16)}`;
  }

  const traceConfig: Record<string, unknown> = {
    tracer: "prestateTracer",
    tracerConfig: {
      diffMode: true,
      disableCode: options.disableCode ?? false,
      disableStorage: options.disableStorage ?? false,
    },
    ...(options.stateOverrides !== undefined ? { stateOverrides: options.stateOverrides } : {}),
    ...(options.blockOverrides !== undefined ? { blockOverrides: options.blockOverrides } : {}),
  };

  const raw = await request({ method: "debug_traceCall", params: [transaction, blockQuantity(simulated.simulation.blockNumber), traceConfig] });
  const pre = normalizeAccounts(raw.pre, "pre");
  const post = normalizeAccounts(raw.post, "post");

  const anchorAfter = await getBlock({ blockNumber: simulated.simulation.blockNumber });
  if (!anchorAfter.hash || anchorAfter.hash.toLowerCase() !== simulated.simulation.blockHash.toLowerCase()) fail("ES4064", "StateDiffAnchorReorged", "Simulation anchor block changed while state-diff tracing was in progress.", { expected: simulated.simulation.blockHash, actual: anchorAfter.hash ?? null });

  const changed = new Set([...Object.keys(pre), ...Object.keys(post)]);
  const hypothetical = simulated.simulation.stateOverrides || options.stateOverrides !== undefined || options.blockOverrides !== undefined;
  const normalized = JSON.stringify(stable({
    chainId: simulated.intent.chain.id,
    blockNumber: simulated.simulation.blockNumber,
    blockHash: simulated.simulation.blockHash.toLowerCase(),
    hypothetical,
    pre,
    post,
  }));

  return {
    kind: "state-diff-simulation",
    engine: "debug_traceCall/prestateTracer",
    chain: simulated.intent.chain,
    blockNumber: simulated.simulation.blockNumber,
    blockHash: blockHash(simulated.simulation.blockHash, simulated.intent.chain),
    hypothetical,
    ...(options.provider ? { provider: options.provider } : {}),
    pre,
    post,
    changedAccounts: changed.size,
    diffHash: hash(keccak256(stringToHex(normalized)), "state-diff"),
  };
}

export function assertRealStateDiffEvidence(evidence: StateDiffSimulationEvidence): StateDiffSimulationEvidence {
  if (evidence.hypothetical) fail("ES4065", "HypotheticalStateDiffNotAccepted", "State-diff evidence used state/block overrides and cannot satisfy a real-state verification gate.", { diffHash: evidence.diffHash });
  return evidence;
}
