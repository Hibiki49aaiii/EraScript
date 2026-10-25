import assert from "node:assert/strict";
import test from "node:test";
import { EthereumMainnetProfile, evmExecutionVerificationReport } from "../src/chains/index.js";
import {
  Ethereum, address, draftTransaction, gas, markBroadcast, markConfirmed, markFinalized,
  markIncluded, nonce, prepareTransaction, recordSimulation, signSimulated, weiPerGas,
} from "../src/web3/index.js";

test("direct EVM report cannot claim finality from caller-owned markFinalized", () => {
  const from = address("0x0000000000000000000000000000000000000011", Ethereum);
  const to = address("0x0000000000000000000000000000000000000022", Ethereum);
  const prepared = prepareTransaction(draftTransaction({ chain: Ethereum, from, to }), {
    nonce: nonce(Ethereum, 1, "explicit"),
    gas: gas(21_000n),
    fees: { type: "legacy", gasPrice: weiPerGas(1n) },
  });
  const signed = signSimulated(recordSimulation(prepared, {
    status: "success",
    blockNumber: 100n,
    blockHash: `0x${"aa".repeat(32)}`,
    stateOverrides: false,
  }), "0x01");
  const hash = `0x${"bb".repeat(32)}`;
  const blockHash = `0x${"cc".repeat(32)}`;
  const included = markIncluded(markBroadcast(signed, hash, 1_000), {
    transactionHash: hash,
    blockHash,
    blockNumber: 101n,
    status: "success",
    gasUsed: 21_000n,
  });
  const syntheticFinalized = markFinalized(markConfirmed(included, 1));
  const report = evmExecutionVerificationReport(EthereumMainnetProfile, syntheticFinalized);
  assert.equal(report.state, "EXECUTION_OBSERVED");
  assert.equal(report.verifiedFinality, false);
  assert.ok(report.checks.some((item) => item.id === "evm.finality" && item.status === "warning"));
});
