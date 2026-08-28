import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "../web3/types.js";
import type {
  ArbitrumConfirmedAssertionEvidence,
  ArbitrumConfirmedAssertionReader,
} from "./arbitrum-finality.js";
import type { EvmChainProfile } from "./types.js";

export interface ArbitrumSdkConfirmedAssertionSource<C extends EvmChain = EvmChain> {
  readonly id: string;
  readonly profileId: string;
  /**
   * Implement this with @arbitrum/sdk / Rollup latestConfirmed() evidence.
   * The returned child block must be the child-chain block represented by the
   * latest confirmed Nitro/BOLD assertion.
   */
  readLatestConfirmedAssertion(input: {
    readonly profile: EvmChainProfile;
    readonly targetL2BlockNumber: bigint;
    readonly targetL2BlockHash: `0x${string}`;
  }): Promise<{
    readonly assertionId: string;
    readonly childBlockNumber: bigint;
    readonly childBlockHash: `0x${string}`;
    readonly assertionL1BlockNumber: bigint;
    readonly assertionL1BlockHash?: `0x${string}`;
    readonly assertionL1TransactionHash?: `0x${string}`;
  }>;
}

export interface ArbitrumParentChainClientLike {
  getBlock(input: { readonly blockTag: "finalized" }): Promise<{
    readonly number?: bigint | null;
    readonly hash?: `0x${string}` | null;
  }>;
  getBlock(input: { readonly blockNumber: bigint }): Promise<{
    readonly number?: bigint | null;
    readonly hash?: `0x${string}` | null;
  }>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({
    code,
    severity: "error",
    kind,
    message,
    ...(details ? { details } : {}),
  });
}

function validHash(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("ES4680", "InvalidArbitrumSdkBridgeHash", `${field} must be a 32-byte EVM hash.`, {
      field,
      value,
    });
  }
}

function requireBlock(
  value: { readonly number?: bigint | null; readonly hash?: `0x${string}` | null },
  label: string,
): { readonly number: bigint; readonly hash: `0x${string}` } {
  if (typeof value.number !== "bigint" || value.number < 0n || typeof value.hash !== "string") {
    fail("ES4681", "IncompleteArbitrumParentBlockEvidence", `${label} is missing canonical block number/hash evidence.`);
  }
  validHash(value.hash, `${label}.hash`);
  return { number: value.number, hash: value.hash };
}

/**
 * Creates an EraScript confirmed-assertion reader from an @arbitrum/sdk-like
 * source while independently re-verifying parent-chain canonicality/finality.
 *
 * The SDK/source is trusted only for "which assertion/child block is latest
 * confirmed". The L1 block hash and finalized status are re-derived from the
 * supplied parent-chain client.
 */
export function createArbitrumSdkConfirmedAssertionReader<C extends EvmChain>(input: {
  readonly profile: EvmChainProfile;
  readonly source: ArbitrumSdkConfirmedAssertionSource<C>;
  readonly l1Client: ArbitrumParentChainClientLike;
}): ArbitrumConfirmedAssertionReader<C> {
  if (input.profile.finality.kind !== "evm-rollup") {
    fail("ES4682", "ArbitrumSdkBridgeProfileNotRollup", "Arbitrum SDK bridge requires an evm-rollup profile.", {
      profile: input.profile.id,
    });
  }
  if (input.source.profileId !== input.profile.id) {
    fail("ES4683", "ArbitrumSdkBridgeProfileMismatch", "Arbitrum SDK source is configured for a different profile.", {
      sourceProfile: input.source.profileId,
      profile: input.profile.id,
    });
  }

  return {
    id: `${input.source.id}:canonical-l1`,
    profileId: input.profile.id,
    async readLatestConfirmed({ profile, targetL2BlockNumber, targetL2BlockHash }): Promise<ArbitrumConfirmedAssertionEvidence> {
      const observed = await input.source.readLatestConfirmedAssertion({
        profile,
        targetL2BlockNumber,
        targetL2BlockHash,
      });

      if (!observed.assertionId) {
        fail("ES4684", "MissingArbitrumSdkAssertionId", "Arbitrum SDK confirmed assertion is missing an assertion identifier.");
      }
      if (observed.childBlockNumber < 0n || observed.assertionL1BlockNumber < 0n) {
        fail("ES4685", "InvalidArbitrumSdkAssertionBlock", "Arbitrum SDK assertion block numbers must be non-negative.");
      }
      validHash(observed.childBlockHash, "childBlockHash");
      if (observed.assertionL1BlockHash) validHash(observed.assertionL1BlockHash, "assertionL1BlockHash");
      if (observed.assertionL1TransactionHash) validHash(observed.assertionL1TransactionHash, "assertionL1TransactionHash");

      const canonical = requireBlock(
        await input.l1Client.getBlock({ blockNumber: observed.assertionL1BlockNumber }),
        "assertionL1Block",
      );
      if (canonical.number !== observed.assertionL1BlockNumber) {
        fail("ES4686", "ArbitrumParentBlockNumberMismatch", "Parent-chain RPC returned a different block number for the assertion anchor.", {
          expected: observed.assertionL1BlockNumber.toString(),
          actual: canonical.number.toString(),
        });
      }
      if (
        observed.assertionL1BlockHash
        && canonical.hash.toLowerCase() !== observed.assertionL1BlockHash.toLowerCase()
      ) {
        fail("ES4687", "ArbitrumParentBlockHashMismatch", "SDK assertion anchor is not canonical on the current parent-chain RPC.", {
          sdkBlockHash: observed.assertionL1BlockHash,
          canonicalBlockHash: canonical.hash,
          blockNumber: canonical.number.toString(),
        });
      }

      const finalized = requireBlock(
        await input.l1Client.getBlock({ blockTag: "finalized" }),
        "parentFinalizedBlock",
      );
      const l1Finalized = canonical.number <= finalized.number;

      return {
        assertionId: observed.assertionId,
        childBlockNumber: observed.childBlockNumber,
        childBlockHash: observed.childBlockHash,
        l1BlockNumber: canonical.number,
        l1BlockHash: canonical.hash,
        ...(observed.assertionL1TransactionHash
          ? { l1TransactionHash: observed.assertionL1TransactionHash }
          : {}),
        l1Finalized,
      };
    },
  };
}
