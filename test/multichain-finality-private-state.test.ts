import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRollupL1Finalized,
  defineEvmChainProfile,
  evmExecutionVerificationReport,
  observeRollupSettlement,
  type RollupSettlementAdapter,
} from "../src/chains/index.js";
import {
  captureRailgunPrivateBalance,
  verifyRailgunPrivateBalanceChanges,
  type RailgunPrivateBalanceReader,
} from "../src/privacy/index.js";
import {
  Base,
  Ethereum,
  address,
  draftTransaction,
  gas,
  markBroadcast,
  markConfirmed,
  markFinalized,
  markIncluded,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce,
  prepareTransaction,
  recordSimulation,
  signSimulated,
} from "../src/web3/index.js";

const TX_HASH = `0x${"11".repeat(32)}` as `0x${string}`;
const L2_BLOCK_HASH = `0x${"22".repeat(32)}` as `0x${string}`;
const L1_BLOCK_HASH = `0x${"33".repeat(32)}` as `0x${string}`;
const L1_TX_HASH = `0x${"44".repeat(32)}` as `0x${string}`;
const TOKEN = `0x${"55".repeat(20)}` as `0x${string}`;

test("rollup finality keeps L2 finality separate from protocol-specific L1 settlement", async () => {
  const profile = defineEvmChainProfile({
    id: "evm.base.mainnet-test",
    name: "Base Test Profile",
    family: "evm",
    network: "mainnet",
    nativeSymbol: "ETH",
    chainId: 8453,
    finality: { kind: "evm-rollup", l2Inclusion: true, l1Settlement: "supported" },
    executionBackends: ["public-rpc"],
    capabilities: {
      eip1559: "supported", eip2930: "supported", eip4844: "unknown", eip7702: "unknown", erc4337: "unknown",
      debugTraceCall: "unknown", finalizedTag: "supported", safeTag: "supported", privateRpc: "unknown", bundleRpc: "unknown",
    },
  });
  const from = address(`0x${"66".repeat(20)}`, Base);
  const to = address(`0x${"77".repeat(20)}`, Base);
  const draft = draftTransaction({ chain: Base, from, to });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Base, 1, "explicit"),
    gas: gas(21_000n),
    fees: { type: "eip1559", maxFeePerGas: maxFeePerGas(10n), maxPriorityFeePerGas: maxPriorityFeePerGas(1n) },
  });
  const simulated = recordSimulation(prepared, { status: "success", blockNumber: 100n, blockHash: L2_BLOCK_HASH, stateOverrides: false });
  const signed = signSimulated(simulated, "0x01");
  const broadcast = markBroadcast(signed, TX_HASH, 1_000);
  const included = markIncluded(broadcast, { transactionHash: TX_HASH, blockHash: L2_BLOCK_HASH, blockNumber: 100n, status: "success", gasUsed: 21_000n });
  const finalizedL2 = markFinalized(markConfirmed(included, 1));

  const l2OnlyReport = evmExecutionVerificationReport(profile, finalizedL2);
  assert.equal(l2OnlyReport.state, "EXECUTION_OBSERVED");
  assert.equal(l2OnlyReport.verifiedFinality, false);

  const adapter: RollupSettlementAdapter<typeof Base> = {
    id: "test-op-stack-settlement",
    protocol: "op-stack",
    profileId: profile.id,
    async observe() {
      return {
        l2TransactionHash: TX_HASH,
        l2BlockNumber: 100n,
        l2BlockHash: L2_BLOCK_HASH,
        stage: "l1-finalized",
        l1Anchor: { chainId: 1, blockNumber: 200n, blockHash: L1_BLOCK_HASH, transactionHash: L1_TX_HASH },
        proofReference: "test-output-root",
      };
    },
  };
  const evidence = await observeRollupSettlement({ profile, transaction: finalizedL2, adapter, nowMs: 2_000 });
  assert.equal(assertRollupL1Finalized(evidence).l1Anchor.chainId, 1);
  assert.equal(evidence.stage, "l1-finalized");
  const settledReport = evmExecutionVerificationReport(profile, finalizedL2, evidence);
  assert.equal(settledReport.state, "VERIFIED_FINALITY");
  assert.equal(settledReport.verifiedFinality, true);
});

test("RAILGUN private-state evidence is derived from refreshed before/after balance snapshots", async () => {
  let current = 100n;
  const reader: RailgunPrivateBalanceReader<typeof Ethereum> = {
    id: "test-railgun-balance-cache",
    async refresh() {},
    async read() { return [{ token: TOKEN, amount: current }]; },
  };
  const before = await captureRailgunPrivateBalance({ reader, chain: Ethereum, walletId: "wallet-1", txidVersion: "V2_PoseidonMerkle", observedAtMs: 1_000 });
  current = 150n;
  const after = await captureRailgunPrivateBalance({ reader, chain: Ethereum, walletId: "wallet-1", txidVersion: "V2_PoseidonMerkle", observedAtMs: 2_000 });
  const evidence = verifyRailgunPrivateBalanceChanges({
    proofBindingHash: `0x${"88".repeat(32)}`,
    before,
    after,
    expectations: [{ id: "recipient.token", token: TOKEN, minimumDelta: 50n, maximumDelta: 50n, expectedFinalAmount: 150n, description: "Recipient receives exactly 50 private token units" }],
  });
  assert.equal(evidence.assertions.length, 1);
  assert.equal(evidence.assertions[0]!.passed, true);
});
