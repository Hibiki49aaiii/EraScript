import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  balanceSnapshot,
  createFlashbotsBundle,
  defineRescueWorkflow,
  defineToken,
  defineTransactionGraph,
  draftTransaction,
  gas,
  nonce,
  prepareTransaction,
  recordSimulation,
  signSimulated,
  simulateFlashbotsBundle,
  tokenAmountRaw,
  verifyCompletedRescue,
  verifyRescuePlan,
  wei,
  weiPerGas,
  type FlashbotsRelay,
  type SignedTx,
  type WorkflowNode,
} from "../src/web3/index.js";

const victim = address("0x0000000000000000000000000000000000000011", Ethereum);
const safe = address("0x0000000000000000000000000000000000000022", Ethereum);
const claimContract = address("0x0000000000000000000000000000000000000033", Ethereum);
const token = defineToken({
  symbol: "CLAIM",
  chain: Ethereum,
  address: address("0x0000000000000000000000000000000000000044", Ethereum),
  decimals: 18,
});

function signed(from: typeof victim | typeof safe, to: typeof victim | typeof safe | typeof claimContract | typeof token.address, nonceValue: number, raw: `0x${string}`): SignedTx<typeof Ethereum> {
  const prepared = prepareTransaction(
    draftTransaction({ chain: Ethereum, from, to }),
    { nonce: nonce(Ethereum, nonceValue, "explicit"), gas: gas(100_000n), fees: { type: "legacy", gasPrice: weiPerGas(1n) } },
  );
  return signSimulated(recordSimulation(prepared, {
    status: "success",
    blockNumber: 100n,
    blockHash: `0x${"aa".repeat(32)}`,
    stateOverrides: false,
  }), raw);
}

function workflowFixture() {
  const nodes: WorkflowNode<typeof Ethereum>[] = [
    { id: "fund", tx: signed(safe, victim, 1, "0x01"), action: { kind: "fund", from: safe, to: victim } },
    { id: "claim", tx: signed(victim, claimContract, 5, "0x02"), action: { kind: "claim", signer: victim, contract: claimContract }, dependsOn: ["fund"] },
    { id: "rescue-token", tx: signed(victim, token.address, 6, "0x03"), action: { kind: "token-rescue", token, from: victim, to: safe }, dependsOn: ["claim"] },
    { id: "sweep-native", tx: signed(victim, safe, 7, "0x04"), action: { kind: "native-sweep", from: victim, to: safe }, dependsOn: ["rescue-token"] },
  ];
  const graph = defineTransactionGraph(Ethereum, nodes);
  return defineRescueWorkflow({
    chain: Ethereum,
    victim,
    safe,
    assets: [token],
    graph,
    nativeDustLimit: wei(0n),
    expectedRecoveries: [tokenAmountRaw(token, 100n)],
  });
}

function relay(): FlashbotsRelay {
  return {
    url: "https://relay.example.invalid",
    authAddress: "0x0000000000000000000000000000000000000009",
    async request<Result>(method: string): Promise<Result> {
      if (method !== "eth_callBundle") throw new Error(`unexpected ${method}`);
      return {
        bundleHash: `0x${"bb".repeat(32)}`,
        results: [
          { txHash: `0x${"11".repeat(32)}`, gasUsed: 1 },
          { txHash: `0x${"22".repeat(32)}`, gasUsed: 1 },
          { txHash: `0x${"33".repeat(32)}`, gasUsed: 1 },
          { txHash: `0x${"44".repeat(32)}`, gasUsed: 1 },
        ],
      } as unknown as Result;
    },
  };
}

test("fresh atomic rescue plan becomes READY_FOR_BROADCAST", async () => {
  const workflow = workflowFixture();
  const draftBundle = createFlashbotsBundle({ chain: Ethereum, transactions: workflow.graph.ordered.map((node) => node.tx), currentBlock: 100n });
  const bundle = await simulateFlashbotsBundle(relay(), draftBundle);

  const report = verifyRescuePlan({ workflow, currentBlock: 100n, flashbots: bundle });
  assert.equal(report.state, "READY_FOR_BROADCAST");
  assert.equal(report.readyForBroadcast, true);
  assert.equal(report.verifiedRecovery, false);
  assert.match(report.reportHash, /^0x[0-9a-f]{64}$/i);
});

test("stale Flashbots simulation keeps rescue plan NOT_READY", async () => {
  const workflow = workflowFixture();
  const draftBundle = createFlashbotsBundle({ chain: Ethereum, transactions: workflow.graph.ordered.map((node) => node.tx), currentBlock: 100n });
  const bundle = await simulateFlashbotsBundle(relay(), draftBundle);

  const report = verifyRescuePlan({ workflow, currentBlock: 101n, flashbots: bundle });
  assert.equal(report.state, "NOT_READY");
  assert.ok(report.checks.some((entry) => entry.id === "atomic.bundle-fresh" && entry.status === "fail"));
});

test("recovery is observed before finality and verified only when finalized", () => {
  const workflow = workflowFixture();
  const before = balanceSnapshot({
    chain: Ethereum,
    blockNumber: 100n,
    native: [{ account: victim, balance: wei(0n) }],
    tokens: [
      { account: victim, token, balance: tokenAmountRaw(token, 0n) },
      { account: safe, token, balance: tokenAmountRaw(token, 10n) },
    ],
  });
  const after = balanceSnapshot({
    chain: Ethereum,
    blockNumber: 101n,
    native: [{ account: victim, balance: wei(0n) }],
    tokens: [
      { account: victim, token, balance: tokenAmountRaw(token, 0n) },
      { account: safe, token, balance: tokenAmountRaw(token, 110n) },
    ],
  });

  const observed = verifyCompletedRescue({ workflow, before, after, finality: "confirmed" });
  assert.equal(observed.state, "RECOVERY_OBSERVED");
  assert.equal(observed.recoveryObserved, true);
  assert.equal(observed.verifiedRecovery, false);

  const finalized = verifyCompletedRescue({ workflow, before, after, finality: "finalized" });
  assert.equal(finalized.state, "VERIFIED_RECOVERY");
  assert.equal(finalized.verifiedRecovery, true);
});
