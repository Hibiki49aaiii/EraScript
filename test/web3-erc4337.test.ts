import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  attachUserOperationSignature,
  confirmUserOperationFromRpc,
  createUserOperationDraft,
  finalizeUserOperationFromRpc,
  getUserOperationReceiptFromBundler,
  prepareUserOperationWithBundler,
  submitUserOperationToBundler,
  type EntryPointBinding,
} from "../src/web3/index.js";

const sender = address("0x0000000000000000000000000000000000007001", Ethereum);
const entryPointAddress = address("0x0000000000000000000000000000000000007002", Ethereum);
const paymaster = address("0x0000000000000000000000000000000000007003", Ethereum);
const blockHash = `0x${"44".repeat(32)}` as `0x${string}`;
const outerTxHash = `0x${"55".repeat(32)}` as `0x${string}`;

const entryPoint09: EntryPointBinding<typeof Ethereum, "0.9"> = {
  chain: Ethereum,
  address: entryPointAddress,
  version: "0.9",
};
const entryPoint08: EntryPointBinding<typeof Ethereum, "0.8"> = {
  chain: Ethereum,
  address: entryPointAddress,
  version: "0.8",
};

function draft09(paymasterSignature = "0x1234" as `0x${string}`) {
  return createUserOperationDraft({
    entryPoint: entryPoint09,
    sender,
    nonce: 3n,
    callData: "0x1234",
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    paymaster,
    paymasterData: "0xabcd",
    paymasterSignature,
    signatureStub: "0x01",
  });
}

function mockBundler() {
  let sentHash: `0x${string}` | undefined;
  let receiptSuccess = true;
  return {
    chain: { id: 1, name: "Ethereum" },
    setHash(hash: `0x${string}`) { sentHash = hash; },
    setReceiptSuccess(value: boolean) { receiptSuccess = value; },
    async getSupportedEntryPoints() { return [entryPointAddress]; },
    async estimateUserOperationGas() {
      return {
        callGasLimit: 100_000n,
        verificationGasLimit: 200_000n,
        preVerificationGas: 50_000n,
        paymasterVerificationGasLimit: 30_000n,
        paymasterPostOpGasLimit: 40_000n,
      };
    },
    async sendUserOperation() {
      if (!sentHash) throw new Error("test hash not set");
      return sentHash;
    },
    async getUserOperationReceipt({ hash }: { hash: `0x${string}` }) {
      return {
        actualGasCost: 1_000_000n,
        actualGasUsed: 320_000n,
        entryPoint: entryPointAddress,
        nonce: 3n,
        paymaster,
        ...(receiptSuccess ? {} : { reason: "account execution reverted" }),
        sender,
        success: receiptSuccess,
        userOpHash: hash,
        receipt: {
          transactionHash: outerTxHash,
          blockHash,
          blockNumber: 100n,
          status: "success" as const,
        },
      };
    },
    async getBlock(args: { blockNumber?: bigint; blockTag?: string }) {
      if (args.blockNumber === 100n) return { number: 100n, hash: blockHash };
      if (args.blockTag === "finalized") return { number: 110n, hash: `0x${"66".repeat(32)}` as `0x${string}` };
      return { number: 101n, hash: `0x${"77".repeat(32)}` as `0x${string}` };
    },
    async getTransactionConfirmations() { return 5n; },
  };
}

async function signed09(paymasterSignature = "0x1234" as `0x${string}`) {
  const client = mockBundler();
  const prepared = await prepareUserOperationWithBundler(client, draft09(paymasterSignature));
  const signed = await attachUserOperationSignature(prepared, {
    signature: "0x9999",
    verifierName: "unit-account-validator",
    verifier: async ({ userOpHash }) => userOpHash === prepared.userOpHash,
  });
  return { client, prepared, signed };
}

test("EntryPoint v0.9 accepts separated paymasterSignature while v0.8 rejects it", () => {
  assert.doesNotThrow(() => draft09());
  assert.throws(
    () => createUserOperationDraft({
      entryPoint: entryPoint08,
      sender,
      nonce: 3n,
      callData: "0x1234",
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      paymaster,
      paymasterSignature: "0x1234",
      signatureStub: "0x01",
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4305",
  );
});

test("paymaster fields without paymaster are rejected", () => {
  assert.throws(
    () => createUserOperationDraft({
      entryPoint: entryPoint09,
      sender,
      nonce: 0n,
      callData: "0x",
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      paymasterData: "0x12",
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4303",
  );
});

test("Bundler gas preparation produces a stable local UserOperation hash", async () => {
  const client = mockBundler();
  const prepared = await prepareUserOperationWithBundler(client, draft09());
  assert.equal(prepared.state, "userop-prepared");
  assert.match(prepared.userOpHash, /^0x[0-9a-f]{64}$/i);
  assert.equal(prepared.paymasterVerificationGasLimit, 30_000n);
  assert.equal(prepared.paymasterPostOpGasLimit, 40_000n);
});

test("account-specific signature verifier is mandatory evidence", async () => {
  const client = mockBundler();
  const prepared = await prepareUserOperationWithBundler(client, draft09());
  await assert.rejects(
    () => attachUserOperationSignature(prepared, {
      signature: "0x9999",
      verifierName: "rejecting-validator",
      verifier: async () => false,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4312",
  );
});

test("v0.9 paymasterSignature changes submission payload hash without changing UserOperation hash", async () => {
  const first = await signed09("0x1111");
  const second = await signed09("0x2222");
  assert.equal(first.prepared.userOpHash, second.prepared.userOpHash);
  assert.notEqual(first.signed.submissionPayloadHash, second.signed.submissionPayloadHash);
});

test("Bundler returned hash must equal locally computed UserOperation hash", async () => {
  const { client, signed } = await signed09();
  client.setHash(`0x${"88".repeat(32)}`);
  await assert.rejects(
    () => submitUserOperationToBundler(client, signed),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4315",
  );
});

test("UserOperation success is tracked independently from outer EntryPoint transaction success", async () => {
  const { client, signed } = await signed09();
  client.setHash(signed.userOpHash);
  const submitted = await submitUserOperationToBundler(client, signed);
  client.setReceiptSuccess(false);
  const failed = await getUserOperationReceiptFromBundler(client, submitted);
  assert.equal(failed.state, "userop-execution-failed");
  if (failed.state === "userop-execution-failed") {
    assert.equal(failed.execution.success, false);
    assert.equal(failed.execution.outerTransactionHash, outerTxHash);
  }
});

test("successful UserOperation can progress through canonical confirmations and finality", async () => {
  const { client, signed } = await signed09();
  client.setHash(signed.userOpHash);
  const submitted = await submitUserOperationToBundler(client, signed);
  const included = await getUserOperationReceiptFromBundler(client, submitted);
  assert.equal(included.state, "userop-included");
  if (included.state !== "userop-included") assert.fail("user operation was not included successfully");
  const confirmed = await confirmUserOperationFromRpc(client, included, 3);
  assert.equal(confirmed.state, "userop-confirmed");
  const finalized = await finalizeUserOperationFromRpc(client, confirmed);
  assert.equal(finalized.state, "userop-finalized");
});
