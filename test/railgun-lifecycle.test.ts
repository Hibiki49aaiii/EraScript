import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  attachRailgunBroadcasterFee,
  attachRailgunGasEvidence,
  assertRailgunProofFresh,
  createRailgunIntent,
  createRailgunProofEvidence,
  markRailgunSubmitted,
  populateRailgunTransaction,
  railgunAddress,
} from "../src/index.js";

const validate0zk = (value: string) => /^0zk1[0-9a-z]+$/i.test(value);

test("RAILGUN broadcaster proof binds transfer, gas and fee quote lifetime", () => {
  const recipient = railgunAddress("0zk1recipienttest", validate0zk);
  const feeRecipient = railgunAddress("0zk1broadcasterfee", validate0zk);
  const intent = createRailgunIntent({
    chain: Ethereum,
    txidVersion: "V2_PoseidonMerkle",
    walletId: "wallet-test",
    transfers: [{
      recipient,
      token: "0x0000000000000000000000000000000000001000",
      amount: 123n,
    }],
  });
  const gas = attachRailgunGasEvidence(intent, { gasEstimate: 500_000n, overallBatchMinGasPrice: 10n });
  const quote = attachRailgunBroadcasterFee(gas, {
    broadcasterId: "waku-broadcaster-1",
    feeToken: "0x0000000000000000000000000000000000002000",
    feeAmount: 5n,
    feeRecipient,
    expiresAtMs: 2_000,
    nowMs: 1_000,
  });
  const proof = createRailgunProofEvidence(quote, { proofId: "proof-1", generatedAtMs: 1_500 });
  assert.doesNotThrow(() => assertRailgunProofFresh(proof, 1_999));
  assert.throws(
    () => assertRailgunProofFresh(proof, 2_000),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4446",
  );
});

test("RAILGUN proof cannot silently switch submission identity model", () => {
  const recipient = railgunAddress("0zk1recipienttest", validate0zk);
  const feeRecipient = railgunAddress("0zk1broadcasterfee", validate0zk);
  const intent = createRailgunIntent({
    chain: Ethereum,
    txidVersion: "V2_PoseidonMerkle",
    walletId: "wallet-test",
    transfers: [{ recipient, token: "0x0000000000000000000000000000000000001000", amount: 1n }],
  });
  const gas = attachRailgunGasEvidence(intent, { gasEstimate: 100n, overallBatchMinGasPrice: 1n });
  const quote = attachRailgunBroadcasterFee(gas, {
    broadcasterId: "waku-broadcaster-1",
    feeToken: "0x0000000000000000000000000000000000002000",
    feeAmount: 1n,
    feeRecipient,
    expiresAtMs: 5_000,
    nowMs: 1_000,
  });
  const proof = createRailgunProofEvidence(quote, { proofId: "proof-2", generatedAtMs: 2_000 });
  const populated = populateRailgunTransaction(proof, "0x1234", 2_500);
  assert.throws(
    () => markRailgunSubmitted(populated, { submission: "self", submittedAtMs: 3_000 }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4448",
  );
  const submitted = markRailgunSubmitted(populated, { submission: "broadcaster", submittedAtMs: 3_000, submissionId: "waku-message" });
  assert.equal(submitted.submission, "broadcaster");
});
