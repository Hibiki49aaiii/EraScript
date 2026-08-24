import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "../web3/types.js";
import type { RollupSettlementAdapter, RollupSettlementStage } from "./rollup-finality.js";
import type { EvmChainProfile } from "./types.js";

export interface ArbitrumConfirmedAssertionEvidence {
  readonly assertionId: string;
  readonly childBlockNumber: bigint;
  readonly childBlockHash: `0x${string}`;
  readonly l1BlockNumber: bigint;
  readonly l1BlockHash: `0x${string}`;
  readonly l1TransactionHash?: `0x${string}`;
  readonly l1Finalized: boolean;
}

export interface ArbitrumConfirmedAssertionReader<C extends EvmChain = EvmChain> {
  readonly id: string;
  readonly profileId: string;
  /**
   * Implementations should derive this from the Rollup contract's latestConfirmed()
   * assertion (Nitro/BOLD) and the corresponding child block, matching the official
   * @arbitrum/sdk logic rather than trusting a sequencer-only L2 head.
   */
  readLatestConfirmed(input: {
    readonly profile: EvmChainProfile;
    readonly targetL2BlockNumber: bigint;
    readonly targetL2BlockHash: `0x${string}`;
  }): Promise<ArbitrumConfirmedAssertionEvidence>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function validHash(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) fail("ES4670", "InvalidArbitrumAssertionHash", `${field} must be a 32-byte hash.`, { field, value });
}

export function createArbitrumSettlementAdapter<C extends EvmChain>(input: {
  profile: EvmChainProfile;
  reader: ArbitrumConfirmedAssertionReader<C>;
  l1ChainId?: number;
}): RollupSettlementAdapter<C> {
  if (input.profile.finality.kind !== "evm-rollup") fail("ES4671", "ArbitrumProfileNotRollup", "Arbitrum settlement adapter requires an evm-rollup profile.", { profile: input.profile.id });
  if (input.reader.profileId !== input.profile.id) fail("ES4672", "ArbitrumReaderProfileMismatch", "Arbitrum confirmed-assertion reader is configured for a different profile.", { readerProfile: input.reader.profileId, profile: input.profile.id });
  const l1ChainId = input.l1ChainId ?? 1;
  if (!Number.isSafeInteger(l1ChainId) || l1ChainId <= 0) fail("ES4673", "InvalidArbitrumL1ChainId", "Arbitrum settlement adapter requires a positive safe parent-chain id.", { l1ChainId });

  return {
    id: input.reader.id,
    protocol: "arbitrum-nitro-bold",
    profileId: input.profile.id,
    async observe({ transaction }) {
      const targetBlockNumber = transaction.receipt.blockNumber;
      const targetBlockHash = transaction.receipt.blockHash as `0x${string}`;
      const evidence = await input.reader.readLatestConfirmed({
        profile: input.profile,
        targetL2BlockNumber: targetBlockNumber,
        targetL2BlockHash: targetBlockHash,
      });

      if (!evidence.assertionId) fail("ES4674", "MissingArbitrumAssertionId", "Arbitrum confirmed-assertion evidence requires an assertion identifier.");
      if (evidence.childBlockNumber < 0n || evidence.l1BlockNumber < 0n) fail("ES4675", "InvalidArbitrumAssertionBlock", "Arbitrum assertion block numbers must be non-negative.");
      validHash(evidence.childBlockHash, "childBlockHash");
      validHash(evidence.l1BlockHash, "l1BlockHash");
      if (evidence.l1TransactionHash) validHash(evidence.l1TransactionHash, "l1TransactionHash");

      let stage: RollupSettlementStage = "l2-included";
      if (targetBlockNumber <= evidence.childBlockNumber) {
        if (targetBlockNumber === evidence.childBlockNumber && targetBlockHash.toLowerCase() !== evidence.childBlockHash.toLowerCase()) {
          fail("ES4676", "ArbitrumConfirmedChildBlockMismatch", "Latest confirmed Arbitrum assertion resolves to a different child block hash at the target height.", {
            targetBlockNumber: targetBlockNumber.toString(),
            targetBlockHash,
            confirmedChildBlockHash: evidence.childBlockHash,
          });
        }
        stage = evidence.l1Finalized ? "l1-finalized" : "l1-proven";
      }

      return {
        l2TransactionHash: transaction.receipt.transactionHash,
        l2BlockNumber: targetBlockNumber,
        l2BlockHash: transaction.receipt.blockHash,
        stage,
        ...(stage === "l1-proven" || stage === "l1-finalized" ? {
          l1Anchor: {
            chainId: l1ChainId,
            blockNumber: evidence.l1BlockNumber,
            blockHash: evidence.l1BlockHash,
            ...(evidence.l1TransactionHash ? { transactionHash: evidence.l1TransactionHash } : {}),
          },
        } : {}),
        proofReference: `arbitrum-confirmed-assertion:${evidence.assertionId}`,
      };
    },
  };
}
