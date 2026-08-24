import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRollupL1Finalized,
  createArbitrumSettlementAdapter,
  createOpStackSettlementAdapter,
  defineEvmChainProfile,
  evmExecutionVerificationReport,
  observeRollupSettlement,
} from "../src/chains/index.js";
import {
  captureRailgunPrivateBalance,
  verifyRailgunPrivateBalanceChanges,
  type RailgunPrivateBalanceReader,
} from "../src/privacy/index.js";
import {
  Arbitrum,
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
const L1_ORIGIN_HASH = `0x${"33".repeat(32)}` as `0x${string}`;
const L1_FINALIZED_HASH = `0x${"44".repeat(32)}` as `0x${string}`;
const OUTPUT_ROOT = `0x${"99".repeat(32)}` as `0x${string}`;
const ARB_TX_HASH = `0x${"12".repeat(32)}` as `0x${string}`;
const ARB_L2_BLOCK_HASH = `0x${"23".repeat(32)}` as `0x${string}`;
const ARB_L1_BLOCK_HASH = `0x${"34".repeat(32)}` as `0x${string}`;
const ARB_L1_TX_HASH = `0x${"45".repeat(32)}` as `0x${string}`;
const TOKEN = `0x${"55".repeat(20)}` as `0x${string}`;

test("OP Stack finality keeps L2 finality separate until rollup RPC proves finalized L1 derivation", async () => {
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

  const rpc = {
    async request(input: { method: string; params?: readonly unknown[] }): Promise<unknown> {
      if (input.method === "optimism_syncStatus") {
        return {
          safe_l1: { hash: L1_FINALIZED_HASH, number: 205 },
          finalized_l1: { hash: L1_FINALIZED_HASH, number: 200 },
          safe_l2: { hash: `0x${"aa".repeat(32)}`, number: 110, l1origin: { hash: L1_FINALIZED_HASH, number: 195 } },
          finalized_l2: { hash: `0x${"bb".repeat(32)}`, number: 105, l1origin: { hash: L1_FINALIZED_HASH, number: 192 } },
        };
      }
      if (input.method === "optimism_outputAtBlock") {
        assert.deepEqual(input.params, ["0x64"]);
        return {
          outputRoot: OUTPUT_ROOT,
          blockRef: {
            hash: L2_BLOCK_HASH,
            number: 100,
            l1Origin: { hash: L1_ORIGIN_HASH, number: 190 },
          },
        };
      }
      throw new Error(`unexpected method: ${input.method}`);
    },
  };
  const adapter = createOpStackSettlementAdapter<typeof Base>({ profile, rpc });
  const evidence = await observeRollupSettlement({ profile, transaction: finalizedL2, adapter, nowMs: 2_000 });
  assert.equal(assertRollupL1Finalized(evidence).l1Anchor.chainId, 1);
  assert.equal(evidence.l1Anchor?.blockNumber, 190n);
  assert.equal(evidence.l1Anchor?.blockHash, L1_ORIGIN_HASH);
  assert.equal(evidence.stage, "l1-finalized");
  assert.equal(evidence.proofReference, `op-output-root:${OUTPUT_ROOT}`);

  const settledReport = evmExecutionVerificationReport(profile, finalizedL2, evidence);
  assert.equal(settledReport.state, "VERIFIED_FINALITY");
  assert.equal(settledReport.verifiedFinality, true);
});

test("Arbitrum confirmed assertion is not L1 finality until its parent-chain anchor is finalized", async () => {
  const profile = defineEvmChainProfile({
    id: "evm.arbitrum.mainnet-test",
    name: "Arbitrum Test Profile",
    family: "evm",
    network: "mainnet",
    nativeSymbol: "ETH",
    chainId: 42161,
    finality: { kind: "evm-rollup", l2Inclusion: true, l1Settlement: "supported" },
    executionBackends: ["public-rpc"],
    capabilities: {
      eip1559: "supported", eip2930: "supported", eip4844: "unknown", eip7702: "unknown", erc4337: "supported",
      debugTraceCall: "unknown", finalizedTag: "supported", safeTag: "supported", privateRpc: "unknown", bundleRpc: "unknown",
    },
  });
  const from = address(`0x${"88".repeat(20)}`, Arbitrum);
  const to = address(`0x${"99".repeat(20)}`, Arbitrum);
  const draft = draftTransaction({ chain: Arbitrum, from, to });
  const prepared = prepareTransaction(draft, {
    nonce: nonce(Arbitrum, 2, "explicit"),
    gas: gas(50_000n),
    fees: { type: "eip1559", maxFeePerGas: maxFeePerGas(20n), maxPriorityFeePerGas: maxPriorityFeePerGas(1n) },
  });
  const simulated = recordSimulation(prepared, { status: "success", blockNumber: 350n, blockHash: ARB_L2_BLOCK_HASH, stateOverrides: false });
  const signed = signSimulated(simulated, "0x01");
  const broadcast = markBroadcast(signed, ARB_TX_HASH, 1_000);
  const included = markIncluded(broadcast, { transactionHash: ARB_TX_HASH, blockHash: ARB_L2_BLOCK_HASH, blockNumber: 350n, status: "success", gasUsed: 42_000n });
  const finalizedL2 = markFinalized(markConfirmed(included, 1));

  const createReader = (l1Finalized: boolean) => ({
    id: "arbitrum-sdk-latest-confirmed",
    profileId: profile.id,
    async readLatestConfirmed() {
      return {
        assertionId: "0xassertion-1234",
        childBlockNumber: 350n,
        childBlockHash: ARB_L2_BLOCK_HASH,
        l1BlockNumber: 500n,
        l1BlockHash: ARB_L1_BLOCK_HASH,
        l1TransactionHash: ARB_L1_TX_HASH,
        l1Finalized,
      };
    },
  });

  const provenAdapter = createArbitrumSettlementAdapter<typeof Arbitrum>({ profile, reader: createReader(false) });
  const proven = await observeRollupSettlement({ profile, transaction: finalizedL2, adapter: provenAdapter, nowMs: 3_000 });
  assert.equal(proven.stage, "l1-proven");
  const provenReport = evmExecutionVerificationReport(profile, finalizedL2, proven);
  assert.equal(provenReport.state, "EXECUTION_OBSERVED");
  assert.equal(provenReport.verifiedFinality, false);

  const finalizedAdapter = createArbitrumSettlementAdapter<typeof Arbitrum>({ profile, reader: createReader(true) });
  const finalized = await observeRollupSettlement({ profile, transaction: finalizedL2, adapter: finalizedAdapter, nowMs: 4_000 });
  assert.equal(assertRollupL1Finalized(finalized).l1Anchor.blockNumber, 500n);
  assert.equal(finalized.proofReference, "arbitrum-confirmed-assertion:0xassertion-1234");
  const finalizedReport = evmExecutionVerificationReport(profile, finalizedL2, finalized);
  assert.equal(finalizedReport.state, "VERIFIED_FINALITY");
  assert.equal(finalizedReport.verifiedFinality, true);
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
