import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import type { ViemClientLike } from "../web3/rpc.js";
import {
  discoverEvmCapabilities,
  type EvmCapabilityEvidence,
  type EvmCapabilityProbe,
} from "./evm-discovery.js";
import type {
  CapabilityStatus,
  EvmCapabilities,
  EvmChainProfile,
} from "./types.js";

export type EvmCapabilityKey = keyof EvmCapabilities;
export type EvmConformanceStatus = CapabilityStatus | "conflict";

export interface EvmProviderConformanceEvidence {
  readonly kind: "evm-provider-conformance-evidence";
  readonly providerId: string;
  readonly profileId: string;
  readonly chainId: number;
  readonly observedAtMs: number;
  readonly capabilities: EvmCapabilities;
  readonly probes: readonly EvmCapabilityProbe[];
}

export interface EvmCapabilityProviderObservation {
  readonly providerId: string;
  readonly status: CapabilityStatus;
}

export interface EvmCapabilityConformance {
  readonly capability: EvmCapabilityKey;
  readonly status: EvmConformanceStatus;
  readonly providers: readonly EvmCapabilityProviderObservation[];
  readonly supportedBy: readonly string[];
  readonly unsupportedBy: readonly string[];
  readonly unknownBy: readonly string[];
}

export interface EvmConformanceMatrix {
  readonly kind: "evm-conformance-matrix";
  readonly profileId: string;
  readonly chainId: number;
  readonly observedAtMs: number;
  readonly providerIds: readonly string[];
  readonly providers: readonly EvmProviderConformanceEvidence[];
  readonly capabilities: Readonly<Record<EvmCapabilityKey, EvmCapabilityConformance>>;
  readonly matrixHash: string;
}

export interface EvmConformanceRequirementCheck {
  readonly capability: EvmCapabilityKey;
  readonly status: EvmConformanceStatus;
  readonly ready: boolean;
  readonly supportedBy: readonly string[];
  readonly unsupportedBy: readonly string[];
  readonly unknownBy: readonly string[];
}

export interface EvmConformanceRequirementEvaluation {
  readonly kind: "evm-conformance-requirement-evaluation";
  readonly profileId: string;
  readonly chainId: number;
  readonly requiredCapabilities: readonly EvmCapabilityKey[];
  readonly globalReady: boolean;
  readonly checks: readonly EvmConformanceRequirementCheck[];
  readonly providerCandidates: readonly string[];
  readonly matrixHash: string;
}

const CAPABILITIES: readonly EvmCapabilityKey[] = [
  "eip1559",
  "eip2930",
  "eip4844",
  "eip7702",
  "erc4337",
  "debugTraceCall",
  "finalizedTag",
  "safeTag",
  "privateRpc",
  "bundleRpc",
];

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

function providerId(value: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)
    || /^(?:https?|wss?|ws)$/i.test(value)
  ) {
    fail(
      "ES4740",
      "InvalidEvmProviderId",
      "EVM providerId must be a stable non-secret label, not a URL or credential-bearing identifier.",
      { providerId: value },
    );
  }
  return value;
}

function observedAt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "ES4748",
      "InvalidEvmProviderObservationTime",
      "EVM provider observation timestamp must be a non-negative safe integer.",
      { observedAtMs: value },
    );
  }
  return value;
}

function sanitizeProbeDetail(value: string): string {
  return value
    .replace(/\b(?:https?|wss?):\/\/[^\s)\]}'"]+/gi, "[redacted-url]")
    .replace(
      /\b(api[_-]?key|apikey|token|authorization|bearer|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      (_match, key: string) => `${key}=[redacted]`,
    );
}

function normalizeProbe(probe: EvmCapabilityProbe): EvmCapabilityProbe {
  return {
    capability: probe.capability,
    status: probe.status,
    source: probe.source,
    ...(probe.detail ? { detail: sanitizeProbeDetail(probe.detail) } : {}),
  };
}

function sortedProbes(probes: readonly EvmCapabilityProbe[]): readonly EvmCapabilityProbe[] {
  return probes
    .map(normalizeProbe)
    .sort((left, right) =>
      left.capability.localeCompare(right.capability)
      || left.source.localeCompare(right.source)
      || left.status.localeCompare(right.status)
      || (left.detail ?? "").localeCompare(right.detail ?? ""),
    );
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
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

function normalizeRequired(
  required: readonly EvmCapabilityKey[],
): readonly EvmCapabilityKey[] {
  return [...new Set(required)].sort();
}

export function createEvmProviderConformanceEvidence(
  evidence: EvmCapabilityEvidence,
  input: { readonly providerId: string },
): EvmProviderConformanceEvidence {
  return {
    kind: "evm-provider-conformance-evidence",
    providerId: providerId(input.providerId),
    profileId: evidence.profileId,
    chainId: evidence.chainId,
    observedAtMs: observedAt(evidence.observedAtMs),
    capabilities: evidence.capabilities,
    probes: sortedProbes(evidence.probes),
  };
}

export async function discoverEvmProviderConformance(
  client: ViemClientLike,
  profile: EvmChainProfile,
  input: {
    readonly providerId: string;
    readonly observedAtMs?: number;
  },
): Promise<EvmProviderConformanceEvidence> {
  const evidence = await discoverEvmCapabilities(client, profile, {
    ...(input.observedAtMs !== undefined
      ? { observedAtMs: observedAt(input.observedAtMs) }
      : {}),
  });
  return createEvmProviderConformanceEvidence(evidence, {
    providerId: input.providerId,
  });
}

function aggregateCapability(
  capability: EvmCapabilityKey,
  providers: readonly EvmProviderConformanceEvidence[],
): EvmCapabilityConformance {
  const observations = providers.map((provider) => ({
    providerId: provider.providerId,
    status: provider.capabilities[capability],
  }));
  const supportedBy = observations
    .filter((entry) => entry.status === "supported")
    .map((entry) => entry.providerId);
  const unsupportedBy = observations
    .filter((entry) => entry.status === "unsupported")
    .map((entry) => entry.providerId);
  const unknownBy = observations
    .filter((entry) => entry.status === "unknown")
    .map((entry) => entry.providerId);

  let status: EvmConformanceStatus;
  if (supportedBy.length === providers.length) status = "supported";
  else if (unsupportedBy.length === providers.length) status = "unsupported";
  else if (supportedBy.length > 0 && unsupportedBy.length > 0) status = "conflict";
  else status = "unknown";

  return {
    capability,
    status,
    providers: observations,
    supportedBy,
    unsupportedBy,
    unknownBy,
  };
}

export function buildEvmConformanceMatrix(
  observations: readonly EvmProviderConformanceEvidence[],
): EvmConformanceMatrix {
  if (observations.length === 0) {
    fail(
      "ES4743",
      "EmptyEvmConformanceMatrix",
      "EVM conformance matrix requires at least one provider observation.",
    );
  }

  const providers = [...observations].sort((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
  const first = providers[0]!;
  const seen = new Set<string>();

  for (const provider of providers) {
    providerId(provider.providerId);
    observedAt(provider.observedAtMs);

    if (seen.has(provider.providerId)) {
      fail(
        "ES4741",
        "DuplicateEvmProviderObservation",
        "EVM conformance matrix contains duplicate providerId evidence.",
        { providerId: provider.providerId },
      );
    }
    seen.add(provider.providerId);

    if (
      provider.profileId !== first.profileId
      || provider.chainId !== first.chainId
    ) {
      fail(
        "ES4742",
        "MixedEvmConformanceProfile",
        "EVM conformance matrix cannot mix provider observations from different profiles or chain IDs.",
        {
          expectedProfileId: first.profileId,
          expectedChainId: first.chainId,
          providerId: provider.providerId,
          actualProfileId: provider.profileId,
          actualChainId: provider.chainId,
        },
      );
    }
  }

  const capabilityEntries = CAPABILITIES.map(
    (capability) =>
      [capability, aggregateCapability(capability, providers)] as const,
  );
  const capabilities = Object.fromEntries(capabilityEntries) as Readonly<
    Record<EvmCapabilityKey, EvmCapabilityConformance>
  >;
  const providerIds = providers.map((provider) => provider.providerId);
  const observedAtMs = Math.max(...providers.map((provider) => provider.observedAtMs));

  const hashInput = {
    profileId: first.profileId,
    chainId: first.chainId,
    providers: providers.map((provider) => ({
      providerId: provider.providerId,
      observedAtMs: provider.observedAtMs,
      capabilities: provider.capabilities,
      probes: sortedProbes(provider.probes),
    })),
    capabilities,
  };

  return {
    kind: "evm-conformance-matrix",
    profileId: first.profileId,
    chainId: first.chainId,
    observedAtMs,
    providerIds,
    providers,
    capabilities,
    matrixHash: sha256(hashInput),
  };
}

export function providersSupportingEvmCapabilities(
  matrix: EvmConformanceMatrix,
  requiredCapabilities: readonly EvmCapabilityKey[],
): readonly string[] {
  const required = normalizeRequired(requiredCapabilities);
  return matrix.providers
    .filter((provider) =>
      required.every(
        (capability) => provider.capabilities[capability] === "supported",
      ),
    )
    .map((provider) => provider.providerId)
    .sort();
}

export function evaluateEvmConformanceRequirements(
  matrix: EvmConformanceMatrix,
  requiredCapabilities: readonly EvmCapabilityKey[],
): EvmConformanceRequirementEvaluation {
  const required = normalizeRequired(requiredCapabilities);
  const checks = required.map((capability): EvmConformanceRequirementCheck => {
    const entry = matrix.capabilities[capability];
    return {
      capability,
      status: entry.status,
      ready: entry.status === "supported",
      supportedBy: entry.supportedBy,
      unsupportedBy: entry.unsupportedBy,
      unknownBy: entry.unknownBy,
    };
  });

  return {
    kind: "evm-conformance-requirement-evaluation",
    profileId: matrix.profileId,
    chainId: matrix.chainId,
    requiredCapabilities: required,
    globalReady: checks.every((check) => check.ready),
    checks,
    providerCandidates: providersSupportingEvmCapabilities(matrix, required),
    matrixHash: matrix.matrixHash,
  };
}

export function assertEvmConformanceRequirements(
  matrix: EvmConformanceMatrix,
  requiredCapabilities: readonly EvmCapabilityKey[],
): EvmConformanceRequirementEvaluation {
  const evaluation = evaluateEvmConformanceRequirements(
    matrix,
    requiredCapabilities,
  );
  const failed = evaluation.checks.find((check) => !check.ready);
  if (!failed) return evaluation;

  const details = {
    capability: failed.capability,
    profileId: matrix.profileId,
    chainId: matrix.chainId,
    supportedBy: failed.supportedBy,
    unsupportedBy: failed.unsupportedBy,
    unknownBy: failed.unknownBy,
    providerCandidates: evaluation.providerCandidates,
  };

  if (failed.status === "conflict") {
    fail(
      "ES4745",
      "EvmConformanceConflict",
      "Required EVM capability has conflicting provider observations.",
      details,
    );
  }
  if (failed.status === "unsupported") {
    fail(
      "ES4746",
      "EvmConformanceUnsupported",
      "Required EVM capability is unanimously unsupported by observed providers.",
      details,
    );
  }
  fail(
    "ES4744",
    "EvmConformanceUnknown",
    "Required EVM capability is not unanimously proven across observed providers.",
    details,
  );
}

export function assertEvmProviderRequirements(
  evidence: EvmProviderConformanceEvidence,
  requiredCapabilities: readonly EvmCapabilityKey[],
): void {
  const required = normalizeRequired(requiredCapabilities);
  const failed = required.filter(
    (capability) => evidence.capabilities[capability] !== "supported",
  );
  if (failed.length === 0) return;

  fail(
    "ES4747",
    "EvmProviderRequirementUnsatisfied",
    "Selected EVM provider does not prove every required capability.",
    {
      providerId: evidence.providerId,
      profileId: evidence.profileId,
      chainId: evidence.chainId,
      failedCapabilities: failed.map((capability) => ({
        capability,
        status: evidence.capabilities[capability],
      })),
    },
  );
}
