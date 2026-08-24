import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  balanceSnapshot,
  blockHash,
  defineRescueWorkflow,
  defineTransactionGraph,
  draftTransaction,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce,
  prepareTransaction,
  recordSimulation,
  signSimulated,
  simulateRescueWorkflowOnFork,
  assertForkRescueSimulationPassed,
  transactionHash,
  wei,
  type ForkSequenceAdapter,
} from "../src/web3/index.js";

const FORK_HASH = `0x${"11".repeat(32)}`;
const AFTER_HASH = `0x${"22".repeat(32)}`;
const TX_HASH = `0x${"33".repeat(32)}`;

function rescueFixture() {
  const victim = address("0x0000000000000000000000000000000000001000", Ethereum);
  const safe = address("0x0000000000000000000000000000000000002000", Ethereum);
  const draft = draftTransaction({ chain: Ethereum, from: victim, to: safe, value: wei(9n) });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Ethereum, 7, "explicit"),
    gas: gas(21_000n),
    fees: {
      type: "eip1559",
      maxFeePerGas: maxFeePerGas(30_000_000_000n),
      maxPriorityFeePerGas: maxPriorityFeePerGas(2_000_000_000n),
    },
  });
  const simulated = recordSimulation(prepared, {
    status: "success",
    blockNumber: 100n,
    blockHash: FORK_HASH,
    stateOverrides: false,
  });
  const signed = signSimulated(simulated, "0x01");
  const graph = defineTransactionGraph(Ethereum, [{
    id: "sweep",
    tx: signed,
    action: { kind: "native-sweep", from: victim, to: safe },
  }]);
  const workflow = defineRescueWorkflow({
    chain: Ethereum,
    victim,
    safe,
    assets: [],
    graph,
    requireNativeSweep: true,
    nativeDustLimit: wei(0n),
  });
  const before = balanceSnapshot({
    chain: Ethereum,
    blockNumber: 100n,
    blockHash: blockHash(FORK_HASH, Ethereum),
    native: [{ account: victim, balance: wei(9n) }, { account: safe, balance: wei(0n) }],
    tokens: [],
  });
  const after = balanceSnapshot({
    chain: Ethereum,
    blockNumber: 101n,
    blockHash: blockHash(AFTER_HASH, Ethereum),
    native: [{ account: victim, balance: wei(0n) }, { account: safe, balance: wei(9n) }],
    tokens: [],
  });
  return { workflow, before, after };
}

function adapter(status: "success" | "reverted" = "success"): ForkSequenceAdapter<typeof Ethereum> & { reverted: boolean } {
  const result = {
    chain: Ethereum,
    provider: "mock-anvil",
    forkBlockNumber: 100n,
    forkBlockHash: blockHash(FORK_HASH, Ethereum),
    reverted: false,
    async snapshot() { return "0x1"; },
    async revert() { result.reverted = true; },
    async executeRawTransaction(nodeId: string) {
      return {
        nodeId,
        transactionHash: transactionHash(TX_HASH, Ethereum),
        status,
        blockNumber: 101n,
        blockHash: blockHash(AFTER_HASH, Ethereum),
        gasUsed: 21_000n,
      };
    },
  };
  return result;
}

test("fork sequence executes workflow order and verifies final-state invariant", async () => {
  const { workflow, before, after } = rescueFixture();
  const fork = adapter();
  let captures = 0;
  const evidence = await simulateRescueWorkflowOnFork(fork, workflow, async () => (++captures === 1 ? before : after));
  assert.equal(evidence.executionSucceeded, true);
  assert.equal(evidence.invariantsPassed, true);
  assert.equal(evidence.executions[0]?.nodeId, "sweep");
  assert.equal(fork.reverted, true);
  assert.doesNotThrow(() => assertForkRescueSimulationPassed(evidence));
});

test("fork sequence does not treat a reverted workflow transaction as valid simulation", async () => {
  const { workflow, before } = rescueFixture();
  const fork = adapter("reverted");
  const evidence = await simulateRescueWorkflowOnFork(fork, workflow, async () => before);
  assert.equal(evidence.executionSucceeded, false);
  assert.equal(evidence.invariantsPassed, false);
  assert.throws(
    () => assertForkRescueSimulationPassed(evidence),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4075",
  );
  assert.equal(fork.reverted, true);
});

test("fork sequence refuses a node that is not anchored to the declared source block", async () => {
  const { workflow, before } = rescueFixture();
  const fork = adapter();
  const wrong = { ...before, blockNumber: 99n };
  await assert.rejects(
    () => simulateRescueWorkflowOnFork(fork, workflow, async () => wrong),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4074",
  );
  assert.equal(fork.reverted, true);
});
