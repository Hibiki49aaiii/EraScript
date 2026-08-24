import { keccak256, stringToHex, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { assertRpcChain, type ViemClientLike } from "./rpc.js";
import { assertRescueFinalState, type BalanceSnapshot, type RescueWorkflow } from "./workflow.js";
import { blockHash, hash, transactionHash, type BlockHash, type EvmChain, type Hash, type TransactionHash } from "./types.js";

export interface ForkTransactionExecution<C extends EvmChain = EvmChain> {
  readonly nodeId: string;
  readonly transactionHash: TransactionHash<C>;
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash<C>;
  readonly gasUsed: bigint;
}

export interface ForkSequenceEvidence<C extends EvmChain = EvmChain> {
  readonly kind: "fork-sequence-evidence";
  readonly chain: C;
  readonly provider: string;
  readonly forkBlockNumber: bigint;
  readonly forkBlockHash: BlockHash<C>;
  readonly executions: readonly ForkTransactionExecution<C>[];
  readonly before: BalanceSnapshot<C>;
  readonly after: BalanceSnapshot<C>;
  readonly executionSucceeded: boolean;
  readonly invariantsPassed: boolean;
  readonly evidenceHash: Hash<"fork-sequence">;
}

export interface ForkSequenceAdapter<C extends EvmChain = EvmChain> {
  readonly chain: C;
  readonly provider: string;
  readonly forkBlockNumber: bigint;
  readonly forkBlockHash: BlockHash<C>;
  snapshot(): Promise<string>;
  revert(snapshotId: string): Promise<void>;
  executeRawTransaction(nodeId: string, rawTransaction: Hex): Promise<ForkTransactionExecution<C>>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function rpcAction<A, R>(client: ViemClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4070", "MissingForkRpcAction", `The supplied fork RPC client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

export function createRpcForkSequenceAdapter<C extends EvmChain>(client: ViemClientLike, input: {
  chain: C;
  provider?: string;
  forkBlockNumber: bigint;
  forkBlockHash: string;
}): ForkSequenceAdapter<C> {
  assertRpcChain(client, input.chain);
  const request = rpcAction<{ method: string; params: readonly unknown[] }, unknown>(client, "request");
  const sendRaw = rpcAction<{ serializedTransaction: Hex }, Hex>(client, "sendRawTransaction");
  const wait = rpcAction<{ hash: Hex; confirmations: number }, {
    transactionHash: Hex;
    blockHash: Hex;
    blockNumber: bigint;
    status: "success" | "reverted";
    gasUsed: bigint;
  }>(client, "waitForTransactionReceipt");

  return {
    chain: input.chain,
    provider: input.provider ?? "rpc-fork",
    forkBlockNumber: input.forkBlockNumber,
    forkBlockHash: blockHash(input.forkBlockHash, input.chain),
    async snapshot() {
      const value = await request({ method: "evm_snapshot", params: [] });
      if (typeof value !== "string" && typeof value !== "number") fail("ES4071", "InvalidForkSnapshotId", "Fork RPC returned an invalid evm_snapshot identifier.");
      return String(value);
    },
    async revert(snapshotId) {
      const value = await request({ method: "evm_revert", params: [snapshotId] });
      if (value !== true) fail("ES4072", "ForkRevertFailed", "Fork RPC failed to restore the pre-simulation snapshot.", { snapshotId, result: String(value) });
    },
    async executeRawTransaction(nodeId, rawTransaction) {
      const sent = await sendRaw({ serializedTransaction: rawTransaction });
      const receipt = await wait({ hash: sent, confirmations: 1 });
      if (receipt.transactionHash.toLowerCase() !== sent.toLowerCase()) fail("ES4073", "ForkReceiptHashMismatch", "Fork receipt transaction hash does not match submitted raw transaction.", { nodeId, submitted: sent, receipt: receipt.transactionHash });
      return {
        nodeId,
        transactionHash: transactionHash(sent, input.chain),
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: blockHash(receipt.blockHash, input.chain),
        gasUsed: receipt.gasUsed,
      };
    },
  };
}

function evidenceHash<C extends EvmChain>(input: Omit<ForkSequenceEvidence<C>, "kind" | "evidenceHash">): Hash<"fork-sequence"> {
  const normalized = JSON.stringify({
    chainId: input.chain.id,
    provider: input.provider,
    forkBlockNumber: input.forkBlockNumber.toString(),
    forkBlockHash: input.forkBlockHash.toLowerCase(),
    executions: input.executions.map((execution) => ({
      nodeId: execution.nodeId,
      transactionHash: execution.transactionHash.toLowerCase(),
      status: execution.status,
      blockNumber: execution.blockNumber.toString(),
      blockHash: execution.blockHash.toLowerCase(),
      gasUsed: execution.gasUsed.toString(),
    })),
    beforeBlockNumber: input.before.blockNumber.toString(),
    beforeBlockHash: input.before.blockHash?.toLowerCase() ?? null,
    afterBlockNumber: input.after.blockNumber.toString(),
    afterBlockHash: input.after.blockHash?.toLowerCase() ?? null,
    executionSucceeded: input.executionSucceeded,
    invariantsPassed: input.invariantsPassed,
  });
  return hash(keccak256(stringToHex(normalized)), "fork-sequence");
}

export async function simulateRescueWorkflowOnFork<C extends EvmChain>(adapter: ForkSequenceAdapter<C>, workflow: RescueWorkflow<C>, capture: () => Promise<BalanceSnapshot<C>>): Promise<ForkSequenceEvidence<C>> {
  if (adapter.chain.id !== workflow.chain.id) fail("ES3104", "ChainMismatch", "Fork adapter and rescue workflow are bound to different chains.", { forkChain: adapter.chain.id, workflowChain: workflow.chain.id });
  const snapshotId = await adapter.snapshot();
  try {
    const before = await capture();
    if (before.chain.id !== workflow.chain.id) fail("ES3104", "ChainMismatch", "Fork before-snapshot belongs to another chain.");
    if (before.blockNumber !== adapter.forkBlockNumber || !before.blockHash || before.blockHash.toLowerCase() !== adapter.forkBlockHash.toLowerCase()) {
      fail("ES4074", "ForkAnchorMismatch", "Fork node is not at the declared source block before sequence simulation.", {
        expectedBlockNumber: adapter.forkBlockNumber.toString(),
        actualBlockNumber: before.blockNumber.toString(),
        expectedBlockHash: adapter.forkBlockHash,
        actualBlockHash: before.blockHash ?? null,
      });
    }

    const executions: ForkTransactionExecution<C>[] = [];
    let executionSucceeded = true;
    for (const node of workflow.graph.ordered) {
      const execution = await adapter.executeRawTransaction(node.id, node.tx.rawTransaction);
      executions.push(execution);
      if (execution.status !== "success") {
        executionSucceeded = false;
        break;
      }
    }

    const after = await capture();
    if (after.chain.id !== workflow.chain.id) fail("ES3104", "ChainMismatch", "Fork after-snapshot belongs to another chain.");
    let invariantsPassed = false;
    if (executionSucceeded && executions.length === workflow.graph.ordered.length) {
      try {
        assertRescueFinalState(workflow, before, after);
        invariantsPassed = true;
      } catch (error) {
        if (!(error instanceof EraDiagnosticError)) throw error;
      }
    }

    const base = {
      chain: workflow.chain,
      provider: adapter.provider,
      forkBlockNumber: adapter.forkBlockNumber,
      forkBlockHash: adapter.forkBlockHash,
      executions,
      before,
      after,
      executionSucceeded: executionSucceeded && executions.length === workflow.graph.ordered.length,
      invariantsPassed,
    };
    return { kind: "fork-sequence-evidence", ...base, evidenceHash: evidenceHash(base) };
  } finally {
    await adapter.revert(snapshotId);
  }
}

export function assertForkRescueSimulationPassed<C extends EvmChain>(evidence: ForkSequenceEvidence<C>): ForkSequenceEvidence<C> {
  if (!evidence.executionSucceeded) fail("ES4075", "ForkSequenceExecutionFailed", "Fork sequence did not execute every workflow transaction successfully.", { evidenceHash: evidence.evidenceHash });
  if (!evidence.invariantsPassed) fail("ES4076", "ForkSequenceInvariantFailed", "Fork sequence executed but did not satisfy rescue final-state invariants.", { evidenceHash: evidence.evidenceHash });
  return evidence;
}
