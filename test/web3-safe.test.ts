import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  addSafeConfirmation,
  address,
  calldata,
  createSafeTransaction,
  markSafeExecutable,
  markSafeExecution,
  proposeSafeTransaction,
  safeExecutionEvidence,
  verifySafeConfirmation,
  wei,
} from "../src/web3/index.js";

const safe = address("0x0000000000000000000000000000000000005000", Ethereum);
const owner1 = address("0x0000000000000000000000000000000000005001", Ethereum);
const owner2 = address("0x0000000000000000000000000000000000005002", Ethereum);
const recipient = address("0x0000000000000000000000000000000000006000", Ethereum);
const zero = address("0x0000000000000000000000000000000000000000", Ethereum);
const outerTxHash = `0x${"11".repeat(32)}`;
const outerBlockHash = `0x${"22".repeat(32)}`;

function created() {
  return createSafeTransaction(
    {
      chain: Ethereum,
      safe,
      owners: [owner1, owner2],
      threshold: 2,
      nonce: 5n,
    },
    {
      to: recipient,
      value: wei(1n),
      data: calldata("0x"),
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zero,
      refundReceiver: zero,
      nonce: 5n,
    },
  );
}

async function confirmation(owner: typeof owner1 | typeof owner2, tx = created()) {
  return verifySafeConfirmation({
    transaction: tx,
    owner,
    signature: "0x01",
    scheme: "custom",
    verifierName: "unit-test",
    verifier: async (input) => input.safeTxHash === tx.safeTxHash && input.owner === owner,
  });
}

test("SafeTxHash is distinct evidence and threshold is not execution", async () => {
  const tx = created();
  assert.match(tx.safeTxHash, /^0x[0-9a-f]{64}$/i);

  const first = await confirmation(owner1, tx);
  const proposed = proposeSafeTransaction(tx, first);
  assert.equal(proposed.state, "proposed");
  if (proposed.state !== "proposed") assert.fail("threshold should not be reached after one signature");

  const second = await confirmation(owner2, tx);
  const threshold = addSafeConfirmation(proposed, second);
  assert.equal(threshold.state, "threshold-reached");
  if (threshold.state !== "threshold-reached") assert.fail("threshold should be reached");
  assert.equal(threshold.confirmations.length, 2);

  const executable = markSafeExecutable(threshold, 5n);
  assert.equal(executable.state, "executable");
  assert.notEqual(executable.safeTxHash.toLowerCase(), outerTxHash.toLowerCase());

  const evidence = safeExecutionEvidence(executable, {
    outerTransactionHash: outerTxHash,
    blockHash: outerBlockHash,
    blockNumber: 100n,
    outerReceiptStatus: "success",
    safeEvent: "ExecutionSuccess",
    eventSafeTxHash: executable.safeTxHash,
  });
  const executed = markSafeExecution(executable, evidence);
  assert.equal(executed.state, "executed");
  if (executed.state === "executed") {
    assert.equal(executed.execution.outerTransactionHash, outerTxHash);
    assert.equal(executed.execution.eventSafeTxHash, executable.safeTxHash);
  }
});

test("Safe ExecutionFailure remains failure even when outer receipt succeeded", async () => {
  const tx = created();
  const first = await confirmation(owner1, tx);
  const proposed = proposeSafeTransaction(tx, first);
  if (proposed.state !== "proposed") assert.fail("unexpected threshold");
  const threshold = addSafeConfirmation(proposed, await confirmation(owner2, tx));
  if (threshold.state !== "threshold-reached") assert.fail("threshold not reached");
  const executable = markSafeExecutable(threshold, 5n);
  const evidence = safeExecutionEvidence(executable, {
    outerTransactionHash: outerTxHash,
    blockHash: outerBlockHash,
    blockNumber: 100n,
    outerReceiptStatus: "success",
    safeEvent: "ExecutionFailure",
    eventSafeTxHash: executable.safeTxHash,
  });
  assert.equal(markSafeExecution(executable, evidence).state, "execution-failed");
});

test("Safe lifecycle rejects stale nonce and mismatched event hash", async () => {
  const tx = created();
  const first = await confirmation(owner1, tx);
  const proposed = proposeSafeTransaction(tx, first);
  if (proposed.state !== "proposed") assert.fail("unexpected threshold");
  const threshold = addSafeConfirmation(proposed, await confirmation(owner2, tx));
  if (threshold.state !== "threshold-reached") assert.fail("threshold not reached");

  assert.throws(
    () => markSafeExecutable(threshold, 6n),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4212",
  );

  const executable = markSafeExecutable(threshold, 5n);
  assert.throws(
    () => safeExecutionEvidence(executable, {
      outerTransactionHash: outerTxHash,
      blockHash: outerBlockHash,
      blockNumber: 100n,
      outerReceiptStatus: "success",
      safeEvent: "ExecutionSuccess",
      eventSafeTxHash: `0x${"33".repeat(32)}`,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4214",
  );
});
