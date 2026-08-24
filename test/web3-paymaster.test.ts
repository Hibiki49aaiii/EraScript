import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  address,
  applyFinalPaymasterData,
  applyPaymasterStub,
  createUserOperationDraft,
  prepareUserOperationWithBundler,
  requestFinalPaymasterData,
  requestPaymasterStub,
} from "../src/web3/index.js";

const entryPoint = {
  chain: Ethereum,
  address: address("0x0000000000000000000000000000000000001000", Ethereum),
  version: "0.9" as const,
};
const sender = address("0x0000000000000000000000000000000000002000", Ethereum);
const paymaster = address("0x0000000000000000000000000000000000003000", Ethereum);

function draft() {
  return createUserOperationDraft({
    entryPoint,
    sender,
    nonce: 7n,
    callData: "0x1234",
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    signatureStub: "0xaaaa",
  });
}

test("paymaster lifecycle separates estimation stub from final signing data", async () => {
  const base = draft();
  const paymasterClient = {
    chain: { id: 1, name: "Ethereum" },
    serviceUrl: "https://paymaster.example",
    async getPaymasterStubData() {
      return {
        isFinal: false,
        paymaster,
        paymasterData: "0x1111",
        paymasterVerificationGasLimit: 50_000n,
        paymasterPostOpGasLimit: 20_000n,
        sponsor: { name: "Example Sponsor" },
      };
    },
    async getPaymasterData() {
      return {
        paymaster,
        paymasterData: "0x2222",
        paymasterVerificationGasLimit: 50_000n,
        paymasterPostOpGasLimit: 20_000n,
        paymasterSignature: "0x3333",
      };
    },
  };

  const stub = await requestPaymasterStub(paymasterClient, base, { policyId: "rescue" });
  assert.equal(stub.kind, "paymaster-stub-evidence");
  assert.equal(stub.isFinal, false);
  const sponsoredDraft = applyPaymasterStub(base, stub);
  assert.equal(sponsoredDraft.paymaster, paymaster);
  assert.equal(sponsoredDraft.paymasterData, "0x1111");

  const bundler = {
    chain: { id: 1, name: "Ethereum" },
    async estimateUserOperationGas() {
      return {
        callGasLimit: 100_000n,
        verificationGasLimit: 90_000n,
        preVerificationGas: 30_000n,
        paymasterVerificationGasLimit: 50_000n,
        paymasterPostOpGasLimit: 20_000n,
      };
    },
  };
  const prepared = await prepareUserOperationWithBundler(bundler, sponsoredDraft);
  const stubHash = prepared.userOpHash;

  const finalEvidence = await requestFinalPaymasterData(paymasterClient, prepared, { policyId: "rescue" });
  const finalized = applyFinalPaymasterData(prepared, finalEvidence);
  assert.equal(finalized.paymasterData, "0x2222");
  assert.equal(finalized.paymasterSignature, "0x3333");
  assert.notEqual(finalized.userOpHash, stubHash, "final paymasterData must cause UserOpHash recomputation");
});

test("paymaster final data cannot silently change gas after Bundler estimation", async () => {
  const base = draft();
  const stubClient = {
    chain: { id: 1, name: "Ethereum" },
    async getPaymasterStubData() {
      return {
        isFinal: false,
        paymaster,
        paymasterData: "0x1111",
        paymasterVerificationGasLimit: 50_000n,
        paymasterPostOpGasLimit: 20_000n,
      };
    },
  };
  const stub = await requestPaymasterStub(stubClient, base);
  const sponsoredDraft = applyPaymasterStub(base, stub);
  const prepared = await prepareUserOperationWithBundler({
    chain: { id: 1, name: "Ethereum" },
    async estimateUserOperationGas() {
      return {
        callGasLimit: 100_000n,
        verificationGasLimit: 90_000n,
        preVerificationGas: 30_000n,
        paymasterVerificationGasLimit: 50_000n,
        paymasterPostOpGasLimit: 20_000n,
      };
    },
  }, sponsoredDraft);

  const finalEvidence = await requestFinalPaymasterData({
    chain: { id: 1, name: "Ethereum" },
    async getPaymasterData() {
      return {
        paymaster,
        paymasterData: "0x2222",
        paymasterVerificationGasLimit: 50_001n,
        paymasterPostOpGasLimit: 20_000n,
      };
    },
  }, prepared);

  assert.throws(
    () => applyFinalPaymasterData(prepared, finalEvidence),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4336",
  );
});
