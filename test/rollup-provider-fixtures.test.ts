import assert from "node:assert/strict";
import test from "node:test";
import type { IncludedTx } from "../src/web3/tx.js";
import type { EvmChain } from "../src/web3/types.js";
import {
  ArbitrumOneProfile,
  BaseMainnetProfile,
  OptimismMainnetProfile,
  createArbitrumSettlementAdapter,
  createOpStackSettlementAdapter,
  observeRollupSettlement,
} from "../src/chains/index.js";

const H = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;

function included<C extends EvmChain>(
  chain: C,
  blockNumber: bigint,
  blockHash: `0x${string}`,
  transactionHash: `0x${string}`,
): IncludedTx<C> {
  return {
    state: "included",
    intent: { chain },
    receipt: {
      transactionHash,
      blockHash,
      blockNumber,
      status: "success",
      gasUsed: 21_000n,
    },
  } as unknown as IncludedTx<C>;
}

test("OP Stack snake_case provider fixture proves L1-finalized settlement", async () => {
  const chain = { name: "Optimism", id: 10 } as const;
  const tx = included(chain, 100n, H("2"), H("3"));
  const adapter = createOpStackSettlementAdapter({
    profile: OptimismMainnetProfile,
    rpc: {
      async request({ method }) {
        if (method === "optimism_syncStatus") {
          return {
            safe_l1: { hash: H("a"), number: "0xc8" },
            finalized_l1: { hash: H("b"), number: "0xc8" },
            safe_l2: { hash: H("c"), number: "0x64" },
            finalized_l2: { hash: H("d"), number: "0x64" },
          };
        }
        if (method === "optimism_outputAtBlock") {
          return {
            outputRoot: H("e"),
            blockRef: {
              hash: H("2"),
              number: "0x64",
              l1origin: { hash: H("f"), number: "0x96" },
            },
          };
        }
        throw new Error(`unexpected method ${method}`);
      },
    },
  });

  const evidence = await observeRollupSettlement({
    profile: OptimismMainnetProfile,
    transaction: tx,
    adapter,
    nowMs: 1_000,
  });

  assert.equal(evidence.stage, "l1-finalized");
  assert.equal(evidence.l1Anchor?.blockNumber, 150n);
  assert.equal(evidence.l1Anchor?.chainId, 1);
});

test("OP Stack camelCase provider fixture distinguishes posted from finalized", async () => {
  const chain = { name: "Base", id: 8453 } as const;
  const tx = included(chain, 100n, H("4"), H("5"));
  const adapter = createOpStackSettlementAdapter({
    profile: BaseMainnetProfile,
    rpc: {
      async request({ method }) {
        if (method === "optimism_syncStatus") {
          return {
            safeL1: { hash: H("a"), number: 150n },
            finalizedL1: { hash: H("b"), number: 120n },
            safeL2: { hash: H("c"), number: 100n },
            finalizedL2: { hash: H("d"), number: 99n },
          };
        }
        if (method === "optimism_outputAtBlock") {
          return {
            outputRoot: H("e"),
            blockRef: {
              hash: H("4"),
              number: 100n,
              l1Origin: { hash: H("f"), number: 140n },
            },
          };
        }
        throw new Error(`unexpected method ${method}`);
      },
    },
  });

  const evidence = await observeRollupSettlement({
    profile: BaseMainnetProfile,
    transaction: tx,
    adapter,
    nowMs: 2_000,
  });

  assert.equal(evidence.stage, "l1-posted");
  assert.equal(evidence.l1Anchor?.blockNumber, 140n);
});

test("Arbitrum confirmed-assertion fixture requires canonical L1-finalized anchor", async () => {
  const chain = { name: "Arbitrum", id: 42161 } as const;
  const tx = included(chain, 500n, H("6"), H("7"));
  const adapter = createArbitrumSettlementAdapter({
    profile: ArbitrumOneProfile,
    reader: {
      id: "fixture-arbitrum-reader",
      profileId: ArbitrumOneProfile.id,
      async readLatestConfirmed(input) {
        assert.equal(input.targetL2BlockNumber, 500n);
        assert.equal(input.targetL2BlockHash, H("6"));
        return {
          assertionId: "assertion-500",
          childBlockNumber: 500n,
          childBlockHash: H("6"),
          l1BlockNumber: 1_000n,
          l1BlockHash: H("8"),
          l1TransactionHash: H("9"),
          l1Finalized: true,
        };
      },
    },
  });

  const evidence = await observeRollupSettlement({
    profile: ArbitrumOneProfile,
    transaction: tx,
    adapter,
    nowMs: 3_000,
  });

  assert.equal(evidence.stage, "l1-finalized");
  assert.equal(evidence.protocol, "arbitrum-nitro-bold");
  assert.equal(evidence.l1Anchor?.blockNumber, 1_000n);
  assert.equal(evidence.proofReference, "arbitrum-confirmed-assertion:assertion-500");
});
