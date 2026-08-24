import assert from "node:assert/strict";
import test from "node:test";
import { Ethereum, address } from "../src/web3/index.js";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  attachSelectedRailgunBroadcasterFee,
  createRailgunIntent,
  estimateRailgunTransferWithSdk,
  generateRailgunTransferProofWithSdk,
  populateRailgunTransferSessionWithSdk,
  railgunAddress,
  selectRailgunBroadcaster,
  submitRailgunWithBroadcaster,
} from "../src/privacy/index.js";

const TOKEN = "0x0000000000000000000000000000000000001000" as const;
const TO = "0x0000000000000000000000000000000000002000" as const;
const TX_HASH = `0x${"11".repeat(32)}`;
const RAILGUN_ADDRESS = "0zk1-valid-test-address";

function intent() {
  return createRailgunIntent({
    chain: Ethereum,
    txidVersion: "V2_PoseidonMerkle",
    walletId: "wallet-1",
    transfers: [{ recipient: railgunAddress(RAILGUN_ADDRESS, () => true), token: TOKEN, amount: 500n }],
    sendWithPublicWallet: false,
  });
}

const sdkConfig = {
  sdkTxidVersion: "V2_PoseidonMerkle",
  sdkNetwork: "Ethereum",
  encryptionKey: "secret-bearing-process-only",
  originalGasDetails: { gasPrice: 1n },
  overallBatchMinGasPrice: 2n,
  broadcasterFeeERC20AmountRecipient: { tokenAddress: TOKEN, amount: 10n },
  transactionGasDetails: { gasEstimate: 100_000n },
  serializeTransfer: (transfer: { recipient: string; token: string; amount: bigint }) => ({
    recipientAddress: transfer.recipient,
    tokenAddress: transfer.token,
    amount: transfer.amount,
  }),
  serializePopulatedTransaction: () => "0x1234" as const,
};

test("RAILGUN Wallet SDK adapter binds gas, proof, and populated transaction", async () => {
  const calls: string[] = [];
  const sdk = {
    async gasEstimateForUnprovenTransfer(..._args: unknown[]) { calls.push("gas"); return { gasEstimate: 100_000n }; },
    async generateTransferProof(...args: unknown[]) { calls.push("proof"); const cb = args.at(-1); if (typeof cb === "function") (cb as (value: number) => void)(50); },
    async populateProvedTransfer(..._args: unknown[]) { calls.push("populate"); return { to: TO, data: "0x1234" }; },
  };
  const gas = await estimateRailgunTransferWithSdk(sdk, intent(), sdkConfig);
  assert.equal(gas.gasEstimate, 100_000n);

  const selection = await selectRailgunBroadcaster({
    client: { async findBestBroadcaster() { return { railgunAddress: RAILGUN_ADDRESS, feesID: "fee-1", feePerUnitGas: 2n }; } },
    sdkChain: "Ethereum",
    feeToken: TOKEN,
    validateRailgunAddress: () => true,
    nowMs: 1_000,
  });
  const fee = attachSelectedRailgunBroadcasterFee(gas, selection, {
    feeAmount: 10n,
    feeRecipient: railgunAddress(RAILGUN_ADDRESS, () => true),
    expiresAtMs: 10_000,
    nowMs: 1_000,
  });
  const proofSession = await generateRailgunTransferProofWithSdk(sdk, fee, sdkConfig, { generatedAtMs: 2_000, proofId: "proof-1" });
  const populated = await populateRailgunTransferSessionWithSdk(sdk, proofSession, sdkConfig, 3_000);
  assert.deepEqual(calls, ["gas", "proof", "populate"]);
  assert.equal(populated.transaction.proof.proofId, "proof-1");
  assert.equal(populated.transaction.serializedTransaction, "0x1234");
});

test("RAILGUN Broadcaster adapter refuses selection mutation and submits bound proof", async () => {
  const sdk = {
    async gasEstimateForUnprovenTransfer() { return 100_000n; },
    async generateTransferProof() {},
    async populateProvedTransfer() { return { to: TO, data: "0x1234", nullifiers: ["n1"], useRelayAdapt: false, preTransactionPOIs: {} }; },
  };
  const gas = await estimateRailgunTransferWithSdk(sdk, intent(), sdkConfig);
  const selection = await selectRailgunBroadcaster({
    client: { async findBestBroadcaster() { return { railgunAddress: RAILGUN_ADDRESS, feesID: "fee-1" }; } },
    sdkChain: "Ethereum",
    feeToken: TOKEN,
    validateRailgunAddress: () => true,
    nowMs: 1_000,
  });
  const fee = attachSelectedRailgunBroadcasterFee(gas, selection, { feeAmount: 10n, feeRecipient: selection.railgunAddress, expiresAtMs: 10_000, nowMs: 1_000 });
  const proof = await generateRailgunTransferProofWithSdk(sdk, fee, sdkConfig, { generatedAtMs: 2_000, proofId: "proof-1" });
  const populated = await populateRailgunTransferSessionWithSdk(sdk, proof, sdkConfig, 3_000);
  const broadcasterTransaction = {
    async create(...args: unknown[]) { return { args }; },
    async send() { return { txHash: TX_HASH }; },
  };
  const submitted = await submitRailgunWithBroadcaster({
    broadcasterTransaction,
    populated,
    selection,
    sdkChain: "Ethereum",
    toBroadcasterPayload: (raw) => {
      const record = raw as { to: typeof TO; data: "0x1234"; nullifiers: string[]; useRelayAdapt: boolean; preTransactionPOIs: unknown };
      return { to: record.to, data: record.data, nullifiers: record.nullifiers, useRelayAdapt: record.useRelayAdapt, preTransactionPOIs: record.preTransactionPOIs };
    },
    submittedAtMs: 4_000,
  });
  assert.equal(submitted.submission, "broadcaster");
  assert.equal(submitted.submissionId, TX_HASH);

  const changedSelection = { ...selection, broadcasterId: `${selection.railgunAddress}:fee-2`, feesId: "fee-2" };
  await assert.rejects(
    () => submitRailgunWithBroadcaster({
      broadcasterTransaction,
      populated,
      selection: changedSelection,
      sdkChain: "Ethereum",
      toBroadcasterPayload: () => ({ to: TO, data: "0x1234", nullifiers: [], useRelayAdapt: false, preTransactionPOIs: {} }),
      submittedAtMs: 4_000,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4525",
  );
});
