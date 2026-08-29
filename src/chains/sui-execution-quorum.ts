import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  assertSuiClientNetwork,
  type SuiClientLike,
  type SuiExecutedTransaction,
} from "./sui-adapter.js";
import {
  suiTransactionDigest,
  type SuiTransactionDigest,
} from "./sui.js";
import type { SuiChainProfile } from "./types.js";

const verifierBrand: unique symbol = Symbol("erascript.sui.execution-verifier");
const observationBrand: unique symbol = Symbol("erascript.sui.execution-quorum-observation");
const quorumBrand: unique symbol = Symbol("erascript.sui.execution-quorum");

export interface SuiExecutionVerifier {
  readonly kind: "sui-execution-verifier";
  readonly providerId: string;
  readonly profileId: string;
  readonly network: string;
  readonly chainIdentifier?: string;
  readonly client: SuiClientLike;
  readonly [verifierBrand]: true;
}

export type SuiObservationAvailability = "observed" | "not-found" | "unavailable";
export type SuiObservedExecution = "success" | "failed" | "unknown";

export interface SuiProviderExecutionObservation {
  readonly kind: "sui-provider-execution-observation";
  readonly providerId: string;
  readonly profileId: string;
  readonly network: string;
  readonly observedAtMs: number;
  readonly digest: SuiTransactionDigest;
  readonly availability: SuiObservationAvailability;
  readonly execution: SuiObservedExecution;
  readonly checkpoint?: bigint;
  readonly effectsDigest?: string;
  readonly failureHash?: string;
  readonly observationHash: string;
  readonly [observationBrand]: true;
}

export interface SuiExecutionQuorumPolicy {
  readonly minimumProviders?: number;
  readonly requireCheckpoint?: boolean;
  readonly requireEffectsIdentity?: boolean;
}

export interface SuiExecutionQuorum {
  readonly kind: "sui-execution-quorum";
  readonly profileId: string;
  readonly network: string;
  readonly digest: SuiTransactionDigest;
  readonly stage: "observed" | "checkpointed";
  readonly minimumProviders: number;
  readonly requireCheckpoint: boolean;
  readonly requireEffectsIdentity: boolean;
  readonly providerIds: readonly string[];
  readonly checkpoint?: bigint;
  readonly effectsDigest?: string;
  readonly observations: readonly SuiProviderExecutionObservation[];
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
    fail("ES4790", "InvalidSuiQuorumPolicy", "Sui verifier providerId must be a stable non-secret label.", {
      providerId: value,
    });
  }
  return value;
}

function safeInteger(value: number, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("ES4790", "InvalidSuiQuorumPolicy", `${field} must be a safe integer >= ${minimum}.`, {
      field,
      value,
    });
  }
  return value;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function integer(value: unknown): bigint | undefined {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function resultRecord(raw: unknown): {
  readonly availability: SuiObservationAvailability;
  readonly execution: SuiObservedExecution;
  readonly record?: Record<string, unknown>;
  readonly failureHash?: string;
} {
  const root = object(raw);
  if (!root) return { availability: "unavailable", execution: "unknown" };

  if (root.Transaction) {
    const record = object(root.Transaction);
    return record
      ? { availability: "observed", execution: "success", record }
      : { availability: "unavailable", execution: "unknown" };
  }
  if (root.FailedTransaction) {
    const record = object(root.FailedTransaction);
    return record
      ? {
          availability: "observed",
          execution: "failed",
          record,
          failureHash: sha256({
            status: record.status ?? null,
            error: record.error ?? null,
          }),
        }
      : { availability: "unavailable", execution: "unknown" };
  }
  if (root.$kind === "Transaction") {
    return { availability: "observed", execution: "success", record: root };
  }
  if (root.$kind === "FailedTransaction") {
    return {
      availability: "observed",
      execution: "failed",
      record: root,
      failureHash: sha256({
        status: root.status ?? null,
        error: root.error ?? null,
      }),
    };
  }

  const status = object(root.status);
  if (typeof status?.success === "boolean") {
    return status.success
      ? { availability: "observed", execution: "success", record: root }
      : {
          availability: "observed",
          execution: "failed",
          record: root,
          failureHash: sha256({
            status,
            error: status.error ?? root.error ?? null,
          }),
        };
  }

  return { availability: "not-found", execution: "unknown" };
}

function digestFrom(record: Record<string, unknown> | undefined): SuiTransactionDigest | undefined {
  return typeof record?.digest === "string"
    ? suiTransactionDigest(record.digest)
    : undefined;
}

function checkpointFrom(record: Record<string, unknown> | undefined): bigint | undefined {
  if (!record) return undefined;
  const effects = object(record.effects);
  return integer(record.checkpoint ?? effects?.checkpoint);
}

function effectsDigestFrom(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined;
  const effects = object(record.effects);
  const candidate = effects?.digest ?? effects?.effectsDigest ?? record.effectsDigest;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function observationCore(
  observation: Omit<
    SuiProviderExecutionObservation,
    "kind" | "observationHash" | typeof observationBrand
  >,
): unknown {
  return {
    providerId: observation.providerId,
    profileId: observation.profileId,
    network: observation.network,
    observedAtMs: observation.observedAtMs,
    digest: observation.digest,
    availability: observation.availability,
    execution: observation.execution,
    ...(observation.checkpoint !== undefined
      ? { checkpoint: observation.checkpoint }
      : {}),
    ...(observation.effectsDigest
      ? { effectsDigest: observation.effectsDigest }
      : {}),
    ...(observation.failureHash ? { failureHash: observation.failureHash } : {}),
  };
}

function assertObservationIntegrity(observation: SuiProviderExecutionObservation): void {
  const core = {
    providerId: observation.providerId,
    profileId: observation.profileId,
    network: observation.network,
    observedAtMs: observation.observedAtMs,
    digest: observation.digest,
    availability: observation.availability,
    execution: observation.execution,
    ...(observation.checkpoint !== undefined
      ? { checkpoint: observation.checkpoint }
      : {}),
    ...(observation.effectsDigest
      ? { effectsDigest: observation.effectsDigest }
      : {}),
    ...(observation.failureHash ? { failureHash: observation.failureHash } : {}),
  } satisfies Omit<
    SuiProviderExecutionObservation,
    "kind" | "observationHash" | typeof observationBrand
  >;
  const expected = sha256(observationCore(core));
  if (observation[observationBrand] !== true || observation.observationHash !== expected) {
    fail("ES4799", "SuiQuorumIntegrityMismatch", "Sui provider observation integrity check failed.", {
      providerId: observation.providerId,
      expectedObservationHash: expected,
      actualObservationHash: observation.observationHash,
    });
  }
}

function getTransactionMethod(client: SuiClientLike): ((input: Record<string, unknown>) => Promise<unknown>) | undefined {
  if (typeof client.getTransaction === "function") return client.getTransaction.bind(client);
  if (typeof client.core?.getTransaction === "function") return client.core.getTransaction.bind(client.core);
  return undefined;
}

export async function bindSuiExecutionVerifier(input: {
  readonly profile: SuiChainProfile;
  readonly providerId: string;
  readonly client: SuiClientLike;
  readonly expectedChainIdentifier?: string;
}): Promise<SuiExecutionVerifier> {
  const id = providerId(input.providerId);
  const chainIdentifier = input.expectedChainIdentifier
    ? await assertSuiClientNetwork(
        input.client,
        input.profile,
        input.expectedChainIdentifier,
      )
    : undefined;
  return {
    kind: "sui-execution-verifier",
    providerId: id,
    profileId: input.profile.id,
    network: input.profile.network,
    ...(chainIdentifier ? { chainIdentifier } : {}),
    client: input.client,
    [verifierBrand]: true,
  };
}

export async function observeSuiExecutionWithProvider(
  verifier: SuiExecutionVerifier,
  source: SuiExecutedTransaction,
  options: { readonly observedAtMs?: number } = {},
): Promise<SuiProviderExecutionObservation> {
  if (verifier[verifierBrand] !== true || verifier.profileId !== source.simulation.transaction.profileId) {
    fail("ES4791", "SuiQuorumProviderProfileMismatch", "Sui verifier does not match the executed transaction profile.", {
      providerId: verifier.providerId,
      verifierProfileId: verifier.profileId,
      transactionProfileId: source.simulation.transaction.profileId,
    });
  }
  const observedAtMs = safeInteger(options.observedAtMs ?? Date.now(), "observedAtMs", 0);
  const method = getTransactionMethod(verifier.client);
  if (!method) {
    const core = {
      providerId: verifier.providerId,
      profileId: verifier.profileId,
      network: verifier.network,
      observedAtMs,
      digest: source.digest,
      availability: "unavailable",
      execution: "unknown",
    } as const;
    return {
      kind: "sui-provider-execution-observation",
      ...core,
      observationHash: sha256(observationCore(core)),
      [observationBrand]: true,
    };
  }

  let raw: unknown;
  try {
    raw = await method({
      digest: source.digest,
      include: { effects: true, transaction: true },
    });
  } catch {
    const core = {
      providerId: verifier.providerId,
      profileId: verifier.profileId,
      network: verifier.network,
      observedAtMs,
      digest: source.digest,
      availability: "unavailable",
      execution: "unknown",
    } as const;
    return {
      kind: "sui-provider-execution-observation",
      ...core,
      observationHash: sha256(observationCore(core)),
      [observationBrand]: true,
    };
  }

  const parsed = resultRecord(raw);
  const observedDigest = digestFrom(parsed.record) ?? source.digest;
  const checkpoint = checkpointFrom(parsed.record);
  const effectsDigest = effectsDigestFrom(parsed.record);
  const core = {
    providerId: verifier.providerId,
    profileId: verifier.profileId,
    network: verifier.network,
    observedAtMs,
    digest: observedDigest,
    availability: parsed.availability,
    execution: parsed.execution,
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(effectsDigest ? { effectsDigest } : {}),
    ...(parsed.failureHash ? { failureHash: parsed.failureHash } : {}),
  } as const;

  return {
    kind: "sui-provider-execution-observation",
    ...core,
    observationHash: sha256(observationCore(core)),
    [observationBrand]: true,
  };
}

export function buildSuiExecutionQuorum(input: {
  readonly profile: SuiChainProfile;
  readonly source: SuiExecutedTransaction;
  readonly observations: readonly SuiProviderExecutionObservation[];
  readonly policy?: SuiExecutionQuorumPolicy;
}): SuiExecutionQuorum {
  const minimumProviders = safeInteger(
    input.policy?.minimumProviders ?? 2,
    "minimumProviders",
    2,
  );
  const requireCheckpoint = input.policy?.requireCheckpoint ?? true;
  const requireEffectsIdentity = input.policy?.requireEffectsIdentity ?? false;

  if (input.source.simulation.transaction.profileId !== input.profile.id) {
    fail("ES4791", "SuiQuorumProviderProfileMismatch", "Sui quorum profile does not match executed transaction.", {
      profileId: input.profile.id,
      transactionProfileId: input.source.simulation.transaction.profileId,
    });
  }
  if (input.observations.length < minimumProviders) {
    fail("ES4790", "InvalidSuiQuorumPolicy", "Sui quorum does not contain the configured minimum number of providers.", {
      minimumProviders,
      observations: input.observations.length,
    });
  }

  const observations = [...input.observations].sort((a, b) =>
    a.providerId.localeCompare(b.providerId),
  );
  const providerIds = observations.map((entry) => entry.providerId);
  if (new Set(providerIds).size !== providerIds.length) {
    fail("ES4792", "DuplicateSuiQuorumProvider", "Sui quorum cannot count the same provider ID more than once.", {
      providerIds,
    });
  }

  let checkpoint: bigint | undefined;
  let effectsDigest: string | undefined;
  let allCheckpointed = true;

  for (const observation of observations) {
    assertObservationIntegrity(observation);
    if (
      observation.profileId !== input.profile.id
      || observation.network !== input.profile.network
    ) {
      fail("ES4791", "SuiQuorumProviderProfileMismatch", "Sui observation targets a different profile/network.", {
        providerId: observation.providerId,
        observationProfileId: observation.profileId,
        profileId: input.profile.id,
      });
    }
    if (observation.availability !== "observed") {
      fail("ES4793", "SuiQuorumTransactionUnavailable", "A Sui quorum provider did not provide usable transaction evidence.", {
        providerId: observation.providerId,
        availability: observation.availability,
      });
    }
    if (observation.digest !== input.source.digest) {
      fail("ES4794", "SuiQuorumDigestConflict", "Sui quorum observation belongs to a different transaction digest.", {
        providerId: observation.providerId,
        expected: input.source.digest,
        actual: observation.digest,
      });
    }
    if (observation.execution !== "success") {
      fail("ES4795", "SuiQuorumExecutionConflict", "A Sui quorum provider observed transaction failure.", {
        providerId: observation.providerId,
        failureHash: observation.failureHash ?? null,
      });
    }

    if (requireEffectsIdentity && !observation.effectsDigest) {
      fail("ES4796", "SuiQuorumEffectsConflict", "Sui quorum policy requires effects identity from every provider.", {
        providerId: observation.providerId,
      });
    }
    if (observation.effectsDigest) {
      if (effectsDigest === undefined) effectsDigest = observation.effectsDigest;
      else if (effectsDigest !== observation.effectsDigest) {
        fail("ES4796", "SuiQuorumEffectsConflict", "Sui quorum providers disagree on effects identity.", {
          providerId: observation.providerId,
          expectedEffectsDigest: effectsDigest,
          actualEffectsDigest: observation.effectsDigest,
        });
      }
    }

    if (requireCheckpoint && observation.checkpoint === undefined) {
      fail("ES4798", "SuiQuorumNotCheckpointed", "Sui quorum policy requires checkpoint evidence from every provider.", {
        providerId: observation.providerId,
      });
    }
    if (observation.checkpoint === undefined) allCheckpointed = false;
    if (observation.checkpoint !== undefined) {
      if (checkpoint === undefined) checkpoint = observation.checkpoint;
      else if (checkpoint !== observation.checkpoint) {
        fail("ES4797", "SuiQuorumCheckpointConflict", "Sui quorum providers disagree on checkpoint inclusion.", {
          providerId: observation.providerId,
          expectedCheckpoint: checkpoint.toString(),
          actualCheckpoint: observation.checkpoint.toString(),
        });
      }
    }
  }

  const stage =
    allCheckpointed && checkpoint !== undefined
      ? "checkpointed"
      : "observed";
  const observedAtMs = Math.max(...observations.map((entry) => entry.observedAtMs));
  const core = {
    profileId: input.profile.id,
    network: input.profile.network,
    digest: input.source.digest,
    stage,
    minimumProviders,
    requireCheckpoint,
    requireEffectsIdentity,
    providerIds,
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(effectsDigest ? { effectsDigest } : {}),
    observations: observations.map((entry) => ({
      providerId: entry.providerId,
      observedAtMs: entry.observedAtMs,
      observationHash: entry.observationHash,
    })),
    observedAtMs,
  };

  return {
    kind: "sui-execution-quorum",
    profileId: input.profile.id,
    network: input.profile.network,
    digest: input.source.digest,
    stage,
    minimumProviders,
    requireCheckpoint,
    requireEffectsIdentity,
    providerIds,
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(effectsDigest ? { effectsDigest } : {}),
    observations,
    observedAtMs,
    quorumHash: sha256(core),
    [quorumBrand]: true,
  };
}

export function assertSuiExecutionQuorumIntegrity(quorum: SuiExecutionQuorum): void {
  for (const observation of quorum.observations) assertObservationIntegrity(observation);
  const expected = sha256({
    profileId: quorum.profileId,
    network: quorum.network,
    digest: quorum.digest,
    stage: quorum.stage,
    minimumProviders: quorum.minimumProviders,
    requireCheckpoint: quorum.requireCheckpoint,
    requireEffectsIdentity: quorum.requireEffectsIdentity,
    providerIds: quorum.providerIds,
    ...(quorum.checkpoint !== undefined ? { checkpoint: quorum.checkpoint } : {}),
    ...(quorum.effectsDigest ? { effectsDigest: quorum.effectsDigest } : {}),
    observations: quorum.observations.map((entry) => ({
      providerId: entry.providerId,
      observedAtMs: entry.observedAtMs,
      observationHash: entry.observationHash,
    })),
    observedAtMs: quorum.observedAtMs,
  });
  if (quorum[quorumBrand] !== true || quorum.quorumHash !== expected) {
    fail("ES4799", "SuiQuorumIntegrityMismatch", "Sui execution quorum integrity check failed.", {
      expectedQuorumHash: expected,
      actualQuorumHash: quorum.quorumHash,
    });
  }
}
