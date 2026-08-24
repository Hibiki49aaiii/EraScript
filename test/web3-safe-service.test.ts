import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  calldata,
  createSafeTransaction,
  proposeSafeTransactionToService,
  readSafeServiceEvidence,
  wei,
  type VerifiedSafeConfirmation,
} from "../src/web3/index.js";

const ZERO = address("0x0000000000000000000000000000000000000000", Ethereum);

function fixture(nonce = 9_007_199_254_740_993n) {
  const safe = address("0x0000000000000000000000000000000000001000", Ethereum);
  const owner = address("0x0000000000000000000000000000000000002000", Ethereum);
  const to = address("0x0000000000000000000000000000000000003000", Ethereum);
  const transaction = createSafeTransaction({
    chain: Ethereum,
    safe,
    owners: [owner],
    threshold: 1,
    nonce,
  }, {
    to,
    value: wei(1n),
    data: calldata("0x"),
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce,
  });
  const confirmation: VerifiedSafeConfirmation<typeof Ethereum> = {
    kind: "safe-confirmation",
    owner,
    safeTxHash: transaction.safeTxHash,
    signature: "0x01",
    scheme: "custom",
    verified: true,
    verifier: "test-fixture",
  };
  return { transaction, confirmation, safe, to };
}

test("Safe API v4 proposal serializes nonce and gas values as decimal strings", async () => {
  const { transaction, confirmation } = fixture();
  let proposed: Record<string, unknown> | undefined;
  const service = {
    async proposeTransaction(value: Record<string, unknown>) { proposed = value; },
  };
  await proposeSafeTransactionToService(service, transaction, confirmation);
  const data = proposed?.safeTransactionData as Record<string, unknown>;
  assert.equal(data.nonce, "9007199254740993");
  assert.equal(data.safeTxGas, "0");
  assert.equal(data.baseGas, "0");
  assert.equal(data.value, "1");
});

test("Safe service evidence verifies every SafeTx payload field and treats service execution as coordination evidence", async () => {
  const { transaction, safe, to } = fixture(7n);
  const record = {
    safe,
    to,
    value: "1",
    data: null,
    operation: 0,
    gasToken: null,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    refundReceiver: null,
    nonce: "7",
    safeTxHash: transaction.safeTxHash,
    confirmationsRequired: 1,
    transactionHash: null,
    isExecuted: false,
    isSuccessful: null,
    trusted: true,
  };
  const service = {
    serviceUrl: "https://safe.example",
    async getTransaction() { return record; },
    async getTransactionConfirmations() { return { count: 1, results: [{}] }; },
  };
  const evidence = await readSafeServiceEvidence(service, transaction);
  assert.equal(evidence.readyByCount, true);
  assert.equal(evidence.executedReported, false);
  assert.equal(evidence.executionTransactionHash, undefined);
  assert.equal(evidence.serviceTrustedFlag, true);

  const tampered = {
    ...service,
    async getTransaction() { return { ...record, safeTxGas: "1" }; },
  };
  await assert.rejects(
    () => readSafeServiceEvidence(tampered, transaction),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4226",
  );
});
