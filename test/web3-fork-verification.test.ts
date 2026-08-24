import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  balanceSnapshot,
  blockHash,
  defineRescueWorkflow,
  defineTransactionGraph,
  draftTransaction,
  gas,
  hash,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce,
  prepareTransaction,
  recordSimulation,
  signSimulated,
  transactionHash,
  verifyRescuePlanWithFork,
  wei,
  type ForkSequenceEvidence,
} from "../src/web3/index.js";

const SOURCE_HASH = `0x${"11".repeat(32)}`;
const AFTER_HASH = `0x${"22".repeat(32)}`;
const TX_HASH = `0x${"33".repeat(32)}`;

function fixture() {
  const victim = address("0x0000000000000000000000000000000000001000", Ethereum);
  const safe = address("0x0000000000000000000000000000000000002000", Ethereum);
  const prepared = prepareTransaction(
    draftTransaction({ chain: Ethereum, from: victim, to: safe, value: wei(9n) }),
    {
      nonce: nonce(Ethereum, 7, "explicit"),
      gas: gas(21_000n),
      fees: {
        type: "eip1559",
        maxFeePerGas: maxFeePerGas(30_000_000_000n),
        maxPriorityFeePerGas: maxPriorityFeePerGas(2_000_000_000n),
      },
    },
  );
  const simulated = recordSimulation(prepared, {
    status: "success",
    blockNumber: 100n,
    blockHash: SOURCE_HASH,
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
    blockHash: blockHash(SOURCE_HASH, Ethereum),
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
  const fork: ForkSequenceEvidence<typeof Ethereum> = {
    kind: "fork-sequence-evidence",
    chain: Ethereum,
    provider: "mock-anvil",
    forkBlockNumber: 100n,
    forkBlockHash: blockHash(SOURCE_HASH, Ethereum),
    executions: [{
      nodeId: "sweep",
      transactionHash: transactionHash(TX_HASH, Ethereum),
      status: "success",
      blockNumber: 101n,
      blockHash: blockHash(AFTER_HASH, Ethereum),
      gasUsed: 21_000n,
    }],
    before,
    after,
    executionSucceeded: true,
    invariantsPassed: true,
    evidenceHash: hash(`0x${"44".repeat(32)}`, "fork-sequence"),
  };
  return { workflow, fork };
}

test("fork-enhanced verification reaches READY_FOR_BROADCAST only with fresh aligned evidence", () => {
  const { workflow, fork } = fixture();
  const report = verifyRescuePlanWithFork({ workflow, currentBlock: 100n, atomic: false, fork });
  assert.equal(report.state, "READY_FOR_BROADCAST");
  assert.equal(report.readyForBroadcast, true);
  assert.equal(report.checks.find((entry) => entry.id === "fork.anchor")?.status, "pass");
  assert.equal(report.checks.find((entry) => entry.id === "fork.invariants")?.status, "pass");
});

test("stale or failed fork evidence blocks broadcast readiness", () => {
  const { workflow, fork } = fixture();
  const stale = verifyRescuePlanWithFork({ workflow, currentBlock: 101n, atomic: false, fork });
  assert.equal(stale.state, "NOT_READY");
  assert.equal(stale.checks.find((entry) => entry.id === "fork.fresh")?.status, "fail");

  const failed = verifyRescuePlanWithFork({
    workflow,
    currentBlock: 100n,
    atomic: false,
    fork: { ...fork, invariantsPassed: false },
  });
  assert.equal(failed.state, "NOT_READY");
  assert.equal(failed.checks.find((entry) => entry.id === "fork.invariants")?.status, "fail");
});
