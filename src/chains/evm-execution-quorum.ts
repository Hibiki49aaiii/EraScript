import { createHash } from "node:crypto";
import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  markConfirmed,
  markFinalized,
  markIncluded,
  type ConfirmedTx,
  type FinalizedTx,
  type IncludedTx,
  type ReceiptEvidence,
} from "../web3/tx.js";
import {
  blockHash,
  transactionHash,
  type BlockHash,
  type EvmChain,
  type TransactionHash,
} from "../web3/types.js";
import type {
  EvmBoundExecutionProvider,
  EvmProviderBroadcastExecution,
} from "./evm-provider-routing.js";
import type { EvmChainProfile } from "./types.js";

const observationBrand: unique symbol = Symbol(
  "erascript.evm.execution-quorum-observation",
);
const quorumBrand: unique symbol = Symbol(
  "erascript.evm.execution-quorum",
);

export type EvmExecutionQuorumStage =
  | "included"
  | "confirmed"
  | "finalized";

export type EvmExecutionQuorumScope =
  | "execution"
  | "l2-execution";

export type EvmCanonicalityStatus =
  | "canonical"
  | "mismatch"
  | "unavailable";

export type EvmFinalityObservationStatus =
  | "not-requested"
  | "finalized"
  | "not-finalized"
  | "unavailable";

export interface EvmFinalizedHead<C extends EvmChain = EvmChain> {
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash<C>;
}

export interface EvmProviderExecutionObservation<
  C extends EvmChain = EvmChain,
> {
  readonly kind: "evm-provider-execution-observation";
  readonly providerId: string;
  readonly providerBindingHash: string;
  readonly profileId: string;
  readonly chainId: number;
  readonly observedAtMs: number;
  readonly transactionHash: TransactionHash<C>;
  readonly receipt: ReceiptEvidence<C> | null;
  readonly canonicality: EvmCanonicalityStatus;
  readonly canonicalBlockHash?: BlockHash<C>;
  readonly confirmations?: bigint;
  readonly finality: EvmFinalityObservationStatus;
  readonly finalizedHead?: EvmFinalizedHead<C>;
  readonly observationHash: string;
  readonly [observationBrand]: true;
}

export interface EvmExecutionQuorumPolicy {
  readonly minimumProviders?: number;
  readonly minimumConfirmations?: number;
  readonly requireFinalized?: boolean;
}

export interface EvmExecutionQuorum<
  C extends EvmChain = EvmChain,
> {
  readonly kind: "evm-execution-quorum";
  readonly scope: EvmExecutionQuorumScope;
  readonly profileId: string;
  readonly chainId: number;
  readonly transactionHash: TransactionHash<C>;
  readonly stage: EvmExecutionQuorumStage;
  readonly minimumProviders: number;
  readonly minimumConfirmations: number;
  readonly requireFinalized: boolean;
  readonly providerIds: readonly string[];
  readonly observations: readonly EvmProviderExecutionObservation<C>[];
  readonly receipt: ReceiptEvidence<C>;
  readonly observedAtMs: number;
  readonly quorumHash: string;
  readonly [quorumBrand]: true;
}

export type EvmQuorumPromotedExecution<
  C extends EvmChain = EvmChain,
> =
  | {
      readonly state: "quorum-included";
      readonly quorum: EvmExecutionQuorum<C> & {
        readonly stage: "included";
      };
      readonly transaction: IncludedTx<C>;
    }
  | {
      readonly state: "quorum-confirmed";
      readonly quorum: EvmExecutionQuorum<C> & {
        readonly stage: "confirmed";
      };
      readonly transaction: ConfirmedTx<C, number>;
    }
  | {
      readonly state: "quorum-finalized";
      readonly quorum: EvmExecutionQuorum<C> & {
        readonly stage: "finalized";
      };
      readonly transaction: FinalizedTx<C>;
    };

type RpcReceipt = {
  readonly transactionHash: Hex;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  readonly effectiveGasPrice?: bigint;
};

type RpcBlock = {
  readonly number: bigint | null;
  readonly hash: Hex | null;
};

function fail(
  code: string,
  kind: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new EraDiagnosticError({
    code,
    severity: "error",
    kind,
    message,
    ...(details ? { details } : {}),
  });
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, inner]) => [key, normalize(inner)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: unknown): string {
  return `0x${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function safeInteger(
  value: number,
  field: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(
      "ES4760",
      "InvalidEvmQuorumPolicy",
      `${field} must be a safe integer >= ${minimum}.`,
      { field, value },
    );
  }
  return value;
}

function action<A, R>(
  provider: EvmBoundExecutionProvider,
  name: string,
): ((args: A) => Promise<R>) | undefined {
  const value = (
    provider.client as unknown as Record<string, unknown>
  )[name];
  return typeof value === "function"
    ? value.bind(provider.client) as (args: A) => Promise<R>
    : undefined;
}

function assertVerifierProfile<C extends EvmChain>(
  source: EvmProviderBroadcastExecution<C>,
  provider: EvmBoundExecutionProvider,
): void {
  if (
    provider.binding.profileId !== source.provider.profileId
    || provider.binding.chainId !== source.provider.chainId
    || provider.binding.chainId !== source.broadcast.intent.chain.id
  ) {
    fail(
      "ES4761",
      "EvmQuorumProviderProfileMismatch",
      "EVM quorum verifier provider targets a different profile or chain than the broadcast execution.",
      {
        broadcastProfileId: source.provider.profileId,
        broadcastChainId: source.provider.chainId,
        verifierProviderId: provider.binding.providerId,
        verifierProfileId: provider.binding.profileId,
        verifierChainId: provider.binding.chainId,
      },
    );
  }
}

function receiptFromRpc<C extends EvmChain>(
  receipt: RpcReceipt,
  chain: C,
): ReceiptEvidence<C> {
  return {
    transactionHash: transactionHash(receipt.transactionHash, chain),
    blockHash: blockHash(receipt.blockHash, chain),
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    ...(receipt.effectiveGasPrice !== undefined
      ? { effectiveGasPrice: receipt.effectiveGasPrice }
      : {}),
  };
}

function observationCore<C extends EvmChain>(
  observation: Omit<
    EvmProviderExecutionObservation<C>,
    "kind" | "observationHash" | typeof observationBrand
  >,
): unknown {
  return {
    providerId: observation.providerId,
    providerBindingHash: observation.providerBindingHash,
    profileId: observation.profileId,
    chainId: observation.chainId,
    observedAtMs: observation.observedAtMs,
    transactionHash: observation.transactionHash,
    receipt: observation.receipt,
    canonicality: observation.canonicality,
    ...(observation.canonicalBlockHash
      ? { canonicalBlockHash: observation.canonicalBlockHash }
      : {}),
    ...(observation.confirmations !== undefined
      ? { confirmations: observation.confirmations }
      : {}),
    finality: observation.finality,
    ...(observation.finalizedHead
      ? { finalizedHead: observation.finalizedHead }
      : {}),
  };
}

export async function observeEvmExecutionWithProvider<
  C extends EvmChain,
>(
  provider: EvmBoundExecutionProvider,
  source: EvmProviderBroadcastExecution<C>,
  options: {
    readonly requireFinalized?: boolean;
    readonly observedAtMs?: number;
  } = {},
): Promise<EvmProviderExecutionObservation<C>> {
  assertVerifierProfile(source, provider);
  const observedAtMs = options.observedAtMs ?? Date.now();
  safeInteger(observedAtMs, "observedAtMs", 0);

  if (
    options.requireFinalized
    && !provider.binding.requiredCapabilities.includes("finalizedTag")
  ) {
    fail(
      "ES4767",
      "EvmQuorumFinalizedCapabilityMissing",
      "Finality quorum requires every verifier provider binding to prove finalizedTag.",
      {
        providerId: provider.binding.providerId,
        requiredCapabilities: provider.binding.requiredCapabilities,
      },
    );
  }

  const expectedHash = source.broadcast.hash;
  const chain = source.broadcast.intent.chain;
  const getReceipt = action<{ hash: Hex }, RpcReceipt>(
    provider,
    "getTransactionReceipt",
  );

  let receipt: ReceiptEvidence<C> | null = null;
  if (getReceipt) {
    try {
      const raw = await getReceipt({ hash: expectedHash as Hex });
      receipt = receiptFromRpc(raw, chain);
    } catch {
      receipt = null;
    }
  }

  if (
    receipt
    && receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()
  ) {
    fail(
      "ES4769",
      "EvmQuorumTransactionMismatch",
      "Verifier provider returned a receipt for a different transaction hash.",
      {
        providerId: provider.binding.providerId,
        expectedTransactionHash: expectedHash,
        actualTransactionHash: receipt.transactionHash,
      },
    );
  }

  let canonicality: EvmCanonicalityStatus = "unavailable";
  let canonicalBlockHash: BlockHash<C> | undefined;
  let confirmations: bigint | undefined;
  let finalizedHead: EvmFinalizedHead<C> | undefined;
  let finality: EvmFinalityObservationStatus =
    options.requireFinalized ? "unavailable" : "not-requested";

  if (receipt) {
    const getBlock = action<
      { blockNumber: bigint } | { blockTag: "finalized" },
      RpcBlock
    >(provider, "getBlock");

    if (getBlock) {
      try {
        const canonical = await getBlock({
          blockNumber: receipt.blockNumber,
        });
        if (canonical.hash) {
          canonicalBlockHash = blockHash(canonical.hash, chain);
          canonicality =
            canonicalBlockHash.toLowerCase()
              === receipt.blockHash.toLowerCase()
              ? "canonical"
              : "mismatch";
        }
      } catch {
        canonicality = "unavailable";
      }
    }

    const getConfirmations = action<{ hash: Hex }, bigint>(
      provider,
      "getTransactionConfirmations",
    );
    if (getConfirmations) {
      try {
        confirmations = await getConfirmations({
          hash: expectedHash as Hex,
        });
      } catch {
        confirmations = undefined;
      }
    }

    if (options.requireFinalized && getBlock) {
      try {
        const finalized = await getBlock({ blockTag: "finalized" });
        if (finalized.number !== null && finalized.hash) {
          finalizedHead = {
            blockNumber: finalized.number,
            blockHash: blockHash(finalized.hash, chain),
          };
          finality =
            finalized.number >= receipt.blockNumber
              ? "finalized"
              : "not-finalized";
        }
      } catch {
        finality = "unavailable";
      }
    }
  }

  const core = {
    providerId: provider.binding.providerId,
    providerBindingHash: provider.binding.bindingHash,
    profileId: provider.binding.profileId,
    chainId: provider.binding.chainId,
    observedAtMs,
    transactionHash: expectedHash,
    receipt,
    canonicality,
    ...(canonicalBlockHash ? { canonicalBlockHash } : {}),
    ...(confirmations !== undefined ? { confirmations } : {}),
    finality,
    ...(finalizedHead ? { finalizedHead } : {}),
  } satisfies Omit<
    EvmProviderExecutionObservation<C>,
    "kind" | "observationHash" | typeof observationBrand
  >;

  return {
    kind: "evm-provider-execution-observation",
    ...core,
    observationHash: sha256(observationCore(core)),
    [observationBrand]: true,
  };
}

function receiptConsensusKey<C extends EvmChain>(
  receipt: ReceiptEvidence<C>,
): string {
  return stableJson({
    transactionHash: receipt.transactionHash.toLowerCase(),
    blockHash: receipt.blockHash.toLowerCase(),
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
  });
}

function canonicalReceipt<C extends EvmChain>(
  receipt: ReceiptEvidence<C>,
): ReceiptEvidence<C> {
  return {
    transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
  };
}

export function buildEvmExecutionQuorum<
  C extends EvmChain,
>(input: {
  readonly profile: EvmChainProfile;
  readonly source: EvmProviderBroadcastExecution<C>;
  readonly observations: readonly EvmProviderExecutionObservation<C>[];
  readonly policy?: EvmExecutionQuorumPolicy;
}): EvmExecutionQuorum<C> {
  const minimumProviders = safeInteger(
    input.policy?.minimumProviders ?? 2,
    "minimumProviders",
    2,
  );
  const minimumConfirmations = safeInteger(
    input.policy?.minimumConfirmations ?? 1,
    "minimumConfirmations",
    1,
  );
  const requireFinalized = input.policy?.requireFinalized ?? false;

  if (
    input.profile.id !== input.source.provider.profileId
    || input.profile.chainId !== input.source.provider.chainId
  ) {
    fail(
      "ES4761",
      "EvmQuorumProviderProfileMismatch",
      "EVM quorum profile does not match the provider-bound broadcast execution.",
      {
        profileId: input.profile.id,
        profileChainId: input.profile.chainId,
        broadcastProfileId: input.source.provider.profileId,
        broadcastChainId: input.source.provider.chainId,
      },
    );
  }

  if (input.observations.length < minimumProviders) {
    fail(
      "ES4760",
      "InvalidEvmQuorumPolicy",
      "EVM execution quorum does not contain the configured minimum number of providers.",
      {
        minimumProviders,
        observations: input.observations.length,
      },
    );
  }

  const observations = [...input.observations].sort((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
  const providerIds = observations.map(
    (observation) => observation.providerId,
  );
  if (new Set(providerIds).size !== providerIds.length) {
    fail(
      "ES4762",
      "DuplicateEvmQuorumProvider",
      "EVM execution quorum cannot count the same provider ID more than once.",
      { providerIds },
    );
  }

  const expectedTxHash = input.source.broadcast.hash;
  for (const observation of observations) {
    if (
      observation.profileId !== input.profile.id
      || observation.chainId !== input.profile.chainId
    ) {
      fail(
        "ES4761",
        "EvmQuorumProviderProfileMismatch",
        "EVM quorum observation targets a different profile or chain.",
        {
          providerId: observation.providerId,
          observationProfileId: observation.profileId,
          observationChainId: observation.chainId,
          profileId: input.profile.id,
          profileChainId: input.profile.chainId,
        },
      );
    }
    if (
      observation.transactionHash.toLowerCase()
      !== expectedTxHash.toLowerCase()
    ) {
      fail(
        "ES4769",
        "EvmQuorumTransactionMismatch",
        "EVM quorum observation belongs to a different transaction.",
        {
          providerId: observation.providerId,
          expectedTransactionHash: expectedTxHash,
          actualTransactionHash: observation.transactionHash,
        },
      );
    }
    if (!observation.receipt) {
      fail(
        "ES4763",
        "EvmQuorumReceiptUnavailable",
        "At least one EVM quorum provider could not supply a transaction receipt.",
        { providerId: observation.providerId },
      );
    }
  }

  const firstReceipt = observations[0]!.receipt!;
  const consensusKey = receiptConsensusKey(firstReceipt);
  for (const observation of observations) {
    if (receiptConsensusKey(observation.receipt!) !== consensusKey) {
      fail(
        "ES4764",
        "EvmQuorumReceiptConflict",
        "EVM quorum providers disagree on the canonical transaction receipt.",
        {
          providerId: observation.providerId,
          expectedReceipt: canonicalReceipt(firstReceipt),
          actualReceipt: canonicalReceipt(observation.receipt!),
        },
      );
    }

    if (
      observation.canonicality !== "canonical"
      || !observation.canonicalBlockHash
      || observation.canonicalBlockHash.toLowerCase()
        !== observation.receipt!.blockHash.toLowerCase()
    ) {
      fail(
        "ES4765",
        "EvmQuorumNonCanonicalReceipt",
        "An EVM quorum provider did not independently confirm the receipt block as canonical.",
        {
          providerId: observation.providerId,
          canonicality: observation.canonicality,
          receiptBlockHash: observation.receipt!.blockHash,
          canonicalBlockHash: observation.canonicalBlockHash ?? null,
        },
      );
    }

    if (
      observation.confirmations === undefined
      || observation.confirmations < BigInt(minimumConfirmations)
    ) {
      fail(
        "ES4766",
        "EvmQuorumInsufficientConfirmations",
        "An EVM quorum provider has not reached the requested confirmation threshold.",
        {
          providerId: observation.providerId,
          minimumConfirmations,
          observedConfirmations:
            observation.confirmations?.toString() ?? null,
        },
      );
    }

    if (requireFinalized) {
      if (observation.finality !== "finalized") {
        fail(
          "ES4768",
          "EvmQuorumNotFinalized",
          "An EVM quorum provider has not proven a finalized head at or beyond the transaction block.",
          {
            providerId: observation.providerId,
            finality: observation.finality,
            receiptBlockNumber: observation.receipt!.blockNumber.toString(),
            finalizedBlockNumber:
              observation.finalizedHead?.blockNumber.toString() ?? null,
          },
        );
      }
      if (
        !observation.finalizedHead
        || observation.finalizedHead.blockNumber
          < observation.receipt!.blockNumber
      ) {
        fail(
          "ES4768",
          "EvmQuorumNotFinalized",
          "An EVM quorum finalized head is behind the transaction block.",
          {
            providerId: observation.providerId,
            receiptBlockNumber: observation.receipt!.blockNumber.toString(),
            finalizedBlockNumber:
              observation.finalizedHead?.blockNumber.toString() ?? null,
          },
        );
      }
    }
  }

  const stage: EvmExecutionQuorumStage = requireFinalized
    ? "finalized"
    : minimumConfirmations > 1
      ? "confirmed"
      : "included";
  const scope: EvmExecutionQuorumScope =
    input.profile.finality.kind === "evm-rollup"
      ? "l2-execution"
      : "execution";
  const receipt = canonicalReceipt(firstReceipt);
  const observedAtMs = Math.max(
    ...observations.map((observation) => observation.observedAtMs),
  );

  const core = {
    scope,
    profileId: input.profile.id,
    chainId: input.profile.chainId,
    transactionHash: expectedTxHash,
    stage,
    minimumProviders,
    minimumConfirmations,
    requireFinalized,
    providerIds,
    observations: observations.map((observation) => ({
      providerId: observation.providerId,
      providerBindingHash: observation.providerBindingHash,
      observedAtMs: observation.observedAtMs,
      observationHash: observation.observationHash,
    })),
    receipt,
    observedAtMs,
  };

  return {
    kind: "evm-execution-quorum",
    scope,
    profileId: input.profile.id,
    chainId: input.profile.chainId,
    transactionHash: expectedTxHash,
    stage,
    minimumProviders,
    minimumConfirmations,
    requireFinalized,
    providerIds,
    observations,
    receipt,
    observedAtMs,
    quorumHash: sha256(core),
    [quorumBrand]: true,
  };
}

export function promoteEvmExecutionWithQuorum<
  C extends EvmChain,
>(
  source: EvmProviderBroadcastExecution<C>,
  quorum: EvmExecutionQuorum<C>,
): EvmQuorumPromotedExecution<C> {
  if (
    quorum.profileId !== source.provider.profileId
    || quorum.chainId !== source.provider.chainId
    || quorum.transactionHash.toLowerCase()
      !== source.broadcast.hash.toLowerCase()
  ) {
    fail(
      "ES4769",
      "EvmQuorumTransactionMismatch",
      "EVM quorum evidence does not belong to the provider-bound broadcast execution.",
      {
        quorumProfileId: quorum.profileId,
        broadcastProfileId: source.provider.profileId,
        quorumChainId: quorum.chainId,
        broadcastChainId: source.provider.chainId,
        quorumTransactionHash: quorum.transactionHash,
        broadcastTransactionHash: source.broadcast.hash,
      },
    );
  }

  const included = markIncluded(source.broadcast, {
    transactionHash: quorum.receipt.transactionHash,
    blockHash: quorum.receipt.blockHash,
    blockNumber: quorum.receipt.blockNumber,
    status: quorum.receipt.status,
    gasUsed: quorum.receipt.gasUsed,
  });

  if (quorum.stage === "included") {
    return {
      state: "quorum-included",
      quorum: quorum as EvmExecutionQuorum<C> & {
        readonly stage: "included";
      },
      transaction: included,
    };
  }

  const confirmed = markConfirmed(
    included,
    quorum.minimumConfirmations,
  );
  if (quorum.stage === "confirmed") {
    return {
      state: "quorum-confirmed",
      quorum: quorum as EvmExecutionQuorum<C> & {
        readonly stage: "confirmed";
      },
      transaction: confirmed,
    };
  }

  return {
    state: "quorum-finalized",
    quorum: quorum as EvmExecutionQuorum<C> & {
      readonly stage: "finalized";
    },
    transaction: markFinalized(confirmed),
  };
}
