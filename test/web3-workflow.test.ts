import assert from "node:assert/strict";
import test from "node:test";
import {
  Ethereum,
  address,
  assertRescueFinalState,
  balanceSnapshot,
  defineRescueWorkflow,
  defineToken,
  defineTransactionGraph,
  draftTransaction,
  gas,
  nonce,
  prepareTransaction,
  recordSimulation,
  signSimulated,
  tokenAmountRaw,
  wei,
  weiPerGas,
  type SignedTx,
  type WorkflowNode,
} from "../src/web3/index.js";
import { EraDiagnosticError } from "../src/diagnostics.js";

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
  return signSimulated(recordSimulation(prepared, { status: "success", blockNumber: 100n, blockHash: `0x${"aa".repeat(32)}`, stateOverrides: false }), raw);
}

function completeNodes(): WorkflowNode<typeof Ethereum>[] {
  return [
    {
      id: "fund",
      tx: signed(safe, victim, 1, "0x01"),
      action: { kind: "fund", from: safe, to: victim },
    },
    {
      id: "claim",
      tx: signed(victim, claimContract, 5, "0x02"),
      action: { kind: "claim", signer: victim, contract: claimContract },
      dependsOn: ["fund"],
    },
    {
      id: "rescue-token",
      tx: signed(victim, token.address, 6, "0x03"),
      action: { kind: "token-rescue", token, from: victim, to: safe },
      dependsOn: ["claim"],
    },
    {
      id: "sweep-native",
      tx: signed(victim, safe, 7, "0x04"),
      action: { kind: "native-sweep", from: victim, to: safe },
      dependsOn: ["rescue-token"],
    },
  ];
}

test("rescue workflow requires final native sweep", () => {
  const graph = defineTransactionGraph(Ethereum, completeNodes().filter((node) => node.id !== "sweep-native"));
  assert.throws(
    () => defineRescueWorkflow({ chain: Ethereum, victim, safe, assets: [token], graph }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4011",
  );
});

test("same-signer nonce ordering must be explicit in DAG dependencies", () => {
  const nodes = completeNodes();
  const rescue = nodes.find((node) => node.id === "rescue-token")!;
  const broken = nodes.map((node) => node.id === rescue.id ? { ...node, dependsOn: ["fund"] } : node);
  assert.throws(
    () => defineTransactionGraph(Ethereum, broken),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4008",
  );
});

test("rescue final-state invariants prove victim cleared and safe received expected asset", () => {
  const graph = defineTransactionGraph(Ethereum, completeNodes());
  const workflow = defineRescueWorkflow({
    chain: Ethereum,
    victim,
    safe,
    assets: [token],
    graph,
    nativeDustLimit: wei(0n),
    expectedRecoveries: [tokenAmountRaw(token, 100n)],
  });

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

  const result = assertRescueFinalState(workflow, before, after);
  assert.equal(result.passed, true);
  assert.ok(result.results.every((item) => item.passed));
});
