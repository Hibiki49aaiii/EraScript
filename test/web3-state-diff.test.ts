import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  draftTransaction,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce,
  prepareTransaction,
  recordSimulation,
  traceSimulatedStateDiff,
  assertRealStateDiffEvidence,
} from "../src/web3/index.js";

const BLOCK_HASH = `0x${"33".repeat(32)}` as `0x${string}`;

function simulatedTx() {
  const from = address("0x0000000000000000000000000000000000001000", Ethereum);
  const to = address("0x0000000000000000000000000000000000002000", Ethereum);
  const draft = draftTransaction({ chain: Ethereum, from, to });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Ethereum, 7, "explicit"),
    gas: gas(50_000n),
    fees: {
      type: "eip1559",
      maxFeePerGas: maxFeePerGas(30_000_000_000n),
      maxPriorityFeePerGas: maxPriorityFeePerGas(2_000_000_000n),
    },
  });
  return recordSimulation(prepared, {
    status: "success",
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    stateOverrides: false,
  });
}

test("debug_traceCall state diff is anchored and normalized", async () => {
  const simulated = simulatedTx();
  const account = "0x0000000000000000000000000000000000001000";
  let method: string | undefined;
  const client = {
    chain: { id: 1, name: "Ethereum" },
    async getBlock() { return { number: 100n, hash: BLOCK_HASH }; },
    async request(args: { method: string }) {
      method = args.method;
      return {
        pre: { [account]: { balance: "0x1", nonce: 7 } },
        post: { [account]: { balance: "0x0", nonce: 8 } },
      };
    },
  };
  const evidence = await traceSimulatedStateDiff(client, simulated, { provider: "mock-geth" });
  assert.equal(method, "debug_traceCall");
  assert.equal(evidence.blockNumber, 100n);
  assert.equal(evidence.changedAccounts, 1);
  assert.equal(evidence.hypothetical, false);
  assert.equal(evidence.pre[account]?.balance, "0x1");
  assert.doesNotThrow(() => assertRealStateDiffEvidence(evidence));
});

test("state/block overrides remain hypothetical evidence", async () => {
  const simulated = simulatedTx();
  const client = {
    chain: { id: 1, name: "Ethereum" },
    async getBlock() { return { number: 100n, hash: BLOCK_HASH }; },
    async request() { return { pre: {}, post: {} }; },
  };
  const evidence = await traceSimulatedStateDiff(client, simulated, { stateOverrides: {} });
  assert.equal(evidence.hypothetical, true);
  assert.throws(
    () => assertRealStateDiffEvidence(evidence),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4065",
  );
});
