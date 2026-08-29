import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  assertSolanaKitNetwork,
  readSolanaSignatureStatus,
  type SolanaKitClientLike,
  type SolanaRpcPending,
  type SolanaSubmittedTransaction,
} from "./solana-adapter.js";
import {
  solanaBlockhash,
  type SolanaBlockhash,
  type SolanaCommitment,
  type SolanaTransactionSignature,
} from "./solana.js";
import type { SolanaChainProfile } from "./types.js";

const verifierBrand: unique symbol = Symbol("erascript.solana.execution-verifier");
const observationBrand: unique symbol = Symbol("erascript.solana.execution-quorum-observation");
const quorumBrand: unique symbol = Symbol("erascript.solana.execution-quorum");

export interface SolanaExecutionVerifier {
  readonly kind: "solana-execution-verifier";
  readonly providerId: string;
  readonly profileId: string;
  readonly network: string;
  readonly genesisHash?: string;
  readonly client: SolanaKitClientLike;
  readonly [verifierBrand]: true;
}

export type SolanaObservationAvailability = "observed" | "not-found" | "unavailable";
export type SolanaObservedExecution = "success" | "failed" | "unknown";

export interface SolanaProviderExecutionObservation {
  readonly kind: "solana-provider-execution-observation";
  readonly providerId: string;
  readonly profileId: string;
  readonly network: string;
  readonly observedAtMs: number;
  readonly signature: SolanaTransactionSignature;
  readonly availability: SolanaObservationAvailability;
  readonly execution: SolanaObservedExecution;
  readonly slot?: bigint;
  readonly confirmationStatus?: SolanaCommitment;
  readonly errorHash?: string;
  readonly blockhash?: SolanaBlockhash;
  readonly observationHash: string;
  readonly [observationBrand]: true;
}

export interface SolanaExecutionQuorumPolicy {
  readonly minimumProviders?: number;
  readonly minimumCommitment?: "confirmed" | "finalized";
  readonly requireBlockIdentity?: boolean;
}

export interface SolanaExecutionQuorum {
  readonly kind: "solana-execution-quorum";
  readonly profileId: string;
  readonly network: string;
  readonly signature: SolanaTransactionSignature;
  readonly stage: "observed" | "finalized";
  readonly minimumProviders: number;
  readonly minimumCommitment: "confirmed" | "finalized";
  readonly requireBlockIdentity: boolean;
  readonly providerIds: readonly string[];
  readonly slot: bigint;
  readonly blockhash?: SolanaBlockhash;
  readonly observations: readonly SolanaProviderExecutionObservation[];
  readonly observedAtMs: number;
  readonly quorumHash: string;
  readonly [quorumBrand]: true;
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

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
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

function providerId(value: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)
    || /^(?:https?|wss?|ws)$/i.test(value)
  ) {
    fail(
      "ES4780",
      "InvalidSolanaQuorumPolicy",
      "Solana verifier providerId must be a stable non-secret label.",
      { providerId: value },
    );
  }
  return value;
}

function safeInteger(value: number, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("ES4780", "InvalidSolanaQuorumPolicy", `${field} must be a safe integer >= ${minimum}.`, {
      field,
      value,
    });
  }
  return value;
}

function commitmentRank(value: SolanaCommitment | undefined): number {
  if (value === "processed") return 0;
  if (value === "confirmed") return 1;
  if (value === "finalized") return 2;
  return -1;
}

function observationCore(
  observation: Omit<
    SolanaProviderExecutionObservation,
    "kind" | "observationHash" | typeof observationBrand
  >,
): unknown {
  return {
    providerId: observation.providerId,
    profileId: observation.profileId,
    network: observation.network,
    observedAtMs: observation.observedAtMs,
    signature: observation.signature,
    availability: observation.availability,
    execution: observation.execution,
    ...(observation.slot !== undefined ? { slot: observation.slot } : {}),
    ...(observation.confirmationStatus
      ? { confirmationStatus: observation.confirmationStatus }
      : {}),
    ...(observation.errorHash ? { errorHash: observation.errorHash } : {}),
    ...(observation.blockhash ? { blockhash: observation.blockhash } : {}),
  };
}

function assertObservationIntegrity(observation: SolanaProviderExecutionObservation): void {
  const core = {
    providerId: observation.providerId,
    profileId: observation.profileId,
    network: observation.network,
    observedAtMs: observation.observedAtMs,
    signature: observation.signature,
    availability: observation.availability,
    execution: observation.execution,
    ...(observation.slot !== undefined ? { slot: observation.slot } : {}),
    ...(observation.confirmationStatus
      ? { confirmationStatus: observation.confirmationStatus }
      : {}),
    ...(observation.errorHash ? { errorHash: observation.errorHash } : {}),
    ...(observation.blockhash ? { blockhash: observation.blockhash } : {}),
  } satisfies Omit<
    SolanaProviderExecutionObservation,
    "kind" | "observationHash" | typeof observationBrand
  >;
  const expected = sha256(observationCore(core));
  if (observation[observationBrand] !== true || observation.observationHash !== expected) {
    fail("ES4789", "SolanaQuorumIntegrityMismatch", "Solana provider observation integrity check failed.", {
      providerId: observation.providerId,
      expectedObservationHash: expected,
      actualObservationHash: observation.observationHash,
    });
  }
}

export async function bindSolanaExecutionVerifier(input: {
  readonly profile: SolanaChainProfile;
  readonly providerId: string;
  readonly client: SolanaKitClientLike;
  readonly expectedGenesisHash?: string;
}): Promise<SolanaExecutionVerifier> {
  const id = providerId(input.providerId);
  const genesisHash = input.expectedGenesisHash
    ? await assertSolanaKitNetwork(
        input.client,
        input.profile,
        input.expectedGenesisHash,
      )
    : undefined;
  return {
    kind: "solana-execution-verifier",
    providerId: id,
    profileId: input.profile.id,
    network: input.profile.network,
    ...(genesisHash ? { genesisHash } : {}),
    client: input.client,
    [verifierBrand]: true,
  };
}

export async function observeSolanaExecutionWithProvider(
  verifier: SolanaExecutionVerifier,
  source: SolanaSubmittedTransaction,
  options: {
    readonly observeBlockIdentity?: boolean;
    readonly observedAtMs?: number;
  } = {},
): Promise<SolanaProviderExecutionObservation> {
  if (verifier[verifierBrand] !== true || verifier.profileId !== source.simulation.transaction.profileId) {
    fail("ES4781", "SolanaQuorumProviderProfileMismatch", "Solana verifier does not match the submitted transaction profile.", {
      verifierProfileId: verifier.profileId,
      transactionProfileId: source.simulation.transaction.profileId,
      providerId: verifier.providerId,
    });
  }
  const observedAtMs = safeInteger(options.observedAtMs ?? Date.now(), "observedAtMs", 0);

  let status;
  try {
    status = await readSolanaSignatureStatus(verifier.client, source.signature);
  } catch {
    const core = {
      providerId: verifier.providerId,
      profileId: verifier.profileId,
      network: verifier.network,
      observedAtMs,
      signature: source.signature,
      availability: "unavailable",
      execution: "unknown",
    } as const;
    return {
      kind: "solana-provider-execution-observation",
      ...core,
      observationHash: sha256(observationCore(core)),
      [observationBrand]: true,
    };
  }

  if (!status.found) {
    const core = {
      providerId: verifier.providerId,
      profileId: verifier.profileId,
      network: verifier.network,
      observedAtMs,
      signature: source.signature,
      availability: "not-found",
      execution: "unknown",
    } as const;
    return {
      kind: "solana-provider-execution-observation",
      ...core,
      observationHash: sha256(observationCore(core)),
      [observationBrand]: true,
    };
  }

  const execution: SolanaObservedExecution =
    status.err === undefined ? "success" : "failed";
  const errorHash =
    status.err === undefined ? undefined : sha256({ err: status.err });

  let observedBlockhash: SolanaBlockhash | undefined;
  if (options.observeBlockIdentity && status.slot !== undefined) {
    const getBlock = (
      verifier.client.rpc as unknown as Record<string, unknown>
    ).getBlock;
    if (typeof getBlock === "function") {
      try {
        const pending = (
          getBlock as (
            slot: bigint,
            config?: Record<string, unknown>,
          ) => SolanaRpcPending<unknown>
        ).call(verifier.client.rpc, status.slot, {
          commitment:
            status.confirmationStatus === "finalized"
              ? "finalized"
              : "confirmed",
          transactionDetails: "none",
          rewards: false,
          maxSupportedTransactionVersion: 0,
        });
        const raw = await pending.send();
        const value =
          raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
            ? (raw as Record<string, unknown>).value
            : raw;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const blockhash = (value as Record<string, unknown>).blockhash;
          if (typeof blockhash === "string") observedBlockhash = solanaBlockhash(blockhash);
        }
      } catch {
        observedBlockhash = undefined;
      }
    }
  }

  const core = {
    providerId: verifier.providerId,
    profileId: verifier.profileId,
    network: verifier.network,
    observedAtMs,
    signature: source.signature,
    availability: "observed",
    execution,
    ...(status.slot !== undefined ? { slot: status.slot } : {}),
    ...(status.confirmationStatus
      ? { confirmationStatus: status.confirmationStatus }
      : {}),
    ...(errorHash ? { errorHash } : {}),
    ...(observedBlockhash ? { blockhash: observedBlockhash } : {}),
  } as const;

  return {
    kind: "solana-provider-execution-observation",
    ...core,
    observationHash: sha256(observationCore(core)),
    [observationBrand]: true,
  };
}

export function buildSolanaExecutionQuorum(input: {
  readonly profile: SolanaChainProfile;
  readonly source: SolanaSubmittedTransaction;
  readonly observations: readonly SolanaProviderExecutionObservation[];
  readonly policy?: SolanaExecutionQuorumPolicy;
}): SolanaExecutionQuorum {
  const minimumProviders = safeInteger(
    input.policy?.minimumProviders ?? 2,
    "minimumProviders",
    2,
  );
  const minimumCommitment = input.policy?.minimumCommitment ?? "confirmed";
  const requireBlockIdentity = input.policy?.requireBlockIdentity ?? false;

  if (input.source.simulation.transaction.profileId !== input.profile.id) {
    fail("ES4781", "SolanaQuorumProviderProfileMismatch", "Solana quorum profile does not match submitted transaction.", {
      profileId: input.profile.id,
      transactionProfileId: input.source.simulation.transaction.profileId,
    });
  }
  if (input.observations.length < minimumProviders) {
    fail("ES4780", "InvalidSolanaQuorumPolicy", "Solana quorum does not contain the configured minimum number of providers.", {
      minimumProviders,
      observations: input.observations.length,
    });
  }

  const observations = [...input.observations].sort((a, b) =>
    a.providerId.localeCompare(b.providerId),
  );
  const providerIds = observations.map((entry) => entry.providerId);
  if (new Set(providerIds).size !== providerIds.length) {
    fail("ES4782", "DuplicateSolanaQuorumProvider", "Solana quorum cannot count the same provider ID more than once.", {
      providerIds,
    });
  }

  const minimumRank = commitmentRank(minimumCommitment);
  let slot: bigint | undefined;
  let blockhash: SolanaBlockhash | undefined;
  let allFinalized = true;

  for (const observation of observations) {
    assertObservationIntegrity(observation);
    if (
      observation.profileId !== input.profile.id
      || observation.network !== input.profile.network
    ) {
      fail("ES4781", "SolanaQuorumProviderProfileMismatch", "Solana observation targets a different profile/network.", {
        providerId: observation.providerId,
        observationProfileId: observation.profileId,
        profileId: input.profile.id,
      });
    }
    if (observation.signature !== input.source.signature) {
      fail("ES4786", "SolanaQuorumSignatureMismatch", "Solana observation belongs to a different transaction signature.", {
        providerId: observation.providerId,
        expected: input.source.signature,
        actual: observation.signature,
      });
    }
    if (observation.availability !== "observed" || observation.slot === undefined) {
      fail("ES4783", "SolanaQuorumStatusUnavailable", "A Solana quorum provider did not provide usable signature status evidence.", {
        providerId: observation.providerId,
        availability: observation.availability,
      });
    }
    if (observation.execution !== "success") {
      fail("ES4784", "SolanaQuorumExecutionFailed", "A Solana quorum provider observed transaction execution failure.", {
        providerId: observation.providerId,
        errorHash: observation.errorHash ?? null,
      });
    }
    if (commitmentRank(observation.confirmationStatus) < minimumRank) {
      fail("ES4785", "SolanaQuorumInsufficientCommitment", "A Solana quorum provider has not reached the requested commitment.", {
        providerId: observation.providerId,
        required: minimumCommitment,
        observed: observation.confirmationStatus ?? null,
      });
    }
    if (observation.confirmationStatus !== "finalized") allFinalized = false;

    if (slot === undefined) slot = observation.slot;
    else if (slot !== observation.slot) {
      fail("ES4787", "SolanaQuorumSlotConflict", "Solana quorum providers disagree on the transaction slot.", {
        providerId: observation.providerId,
        expectedSlot: slot.toString(),
        actualSlot: observation.slot.toString(),
      });
    }

    if (requireBlockIdentity && !observation.blockhash) {
      fail("ES4788", "SolanaQuorumBlockIdentityConflict", "Solana quorum policy requires every provider to independently resolve the slot blockhash.", {
        providerId: observation.providerId,
        slot: observation.slot.toString(),
      });
    }
    if (observation.blockhash) {
      if (blockhash === undefined) blockhash = observation.blockhash;
      else if (blockhash !== observation.blockhash) {
        fail("ES4788", "SolanaQuorumBlockIdentityConflict", "Solana quorum providers disagree on the blockhash for the observed slot.", {
          providerId: observation.providerId,
          expectedBlockhash: blockhash,
          actualBlockhash: observation.blockhash,
        });
      }
    }
  }

  if (slot === undefined) {
    fail("ES4783", "SolanaQuorumStatusUnavailable", "Solana quorum did not produce a transaction slot.");
  }

  const stage = allFinalized ? "finalized" : "observed";
  const observedAtMs = Math.max(...observations.map((entry) => entry.observedAtMs));
  const core = {
    profileId: input.profile.id,
    network: input.profile.network,
    signature: input.source.signature,
    stage,
    minimumProviders,
    minimumCommitment,
    requireBlockIdentity,
    providerIds,
    slot,
    ...(blockhash ? { blockhash } : {}),
    observations: observations.map((entry) => ({
      providerId: entry.providerId,
      observedAtMs: entry.observedAtMs,
      observationHash: entry.observationHash,
    })),
    observedAtMs,
  };

  return {
    kind: "solana-execution-quorum",
    profileId: input.profile.id,
    network: input.profile.network,
    signature: input.source.signature,
    stage,
    minimumProviders,
    minimumCommitment,
    requireBlockIdentity,
    providerIds,
    slot,
    ...(blockhash ? { blockhash } : {}),
    observations,
    observedAtMs,
    quorumHash: sha256(core),
    [quorumBrand]: true,
  };
}

export function assertSolanaExecutionQuorumIntegrity(
  quorum: SolanaExecutionQuorum,
): void {
  for (const observation of quorum.observations) assertObservationIntegrity(observation);
  const expected = sha256({
    profileId: quorum.profileId,
    network: quorum.network,
    signature: quorum.signature,
    stage: quorum.stage,
    minimumProviders: quorum.minimumProviders,
    minimumCommitment: quorum.minimumCommitment,
    requireBlockIdentity: quorum.requireBlockIdentity,
    providerIds: quorum.providerIds,
    slot: quorum.slot,
    ...(quorum.blockhash ? { blockhash: quorum.blockhash } : {}),
    observations: quorum.observations.map((entry) => ({
      providerId: entry.providerId,
      observedAtMs: entry.observedAtMs,
      observationHash: entry.observationHash,
    })),
    observedAtMs: quorum.observedAtMs,
  });
  if (quorum[quorumBrand] !== true || quorum.quorumHash !== expected) {
    fail("ES4789", "SolanaQuorumIntegrityMismatch", "Solana execution quorum integrity check failed.", {
      expectedQuorumHash: expected,
      actualQuorumHash: quorum.quorumHash,
    });
  }
}
