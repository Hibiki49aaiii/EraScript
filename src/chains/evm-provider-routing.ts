import { createHash } from "node:crypto";
import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  broadcastSignedWithRpc,
  prepareDraftWithRpc,
  simulatePreparedWithRpc,
  type RpcFeePreference,
  type RpcNonceSource,
  type SimulationBlockTag,
  type ViemClientLike,
} from "../web3/rpc.js";
import {
  signSimulated,
  type BroadcastTx,
  type DraftTx,
  type PreparedTx,
  type SignedTx,
  type SimulationFailedTx,
  type SimulatedTx,
} from "../web3/tx.js";
import type { EvmChain } from "../web3/types.js";
import {
  assertEvmProviderRequirements,
  buildEvmConformanceMatrix,
  createEvmProviderConformanceEvidence,
  discoverEvmProviderConformance,
  type EvmCapabilityKey,
  type EvmConformanceMatrix,
  type EvmProviderConformanceEvidence,
} from "./evm-conformance.js";
import type { EvmChainProfile } from "./types.js";

const boundProviderBrand: unique symbol = Symbol("erascript.evm.bound-provider");

export interface EvmProviderExecutionBinding {
  readonly kind: "evm-provider-execution-binding";
  readonly providerId: string;
  readonly profileId: string;
  readonly chainId: number;
  readonly observedAtMs: number;
  readonly requiredCapabilities: readonly EvmCapabilityKey[];
  readonly providerEvidenceHash: string;
  readonly matrixHash?: string;
  readonly bindingHash: string;
}

export interface EvmBoundExecutionProvider {
  readonly kind: "evm-bound-execution-provider";
  readonly client: ViemClientLike;
  readonly binding: EvmProviderExecutionBinding;
  readonly [boundProviderBrand]: true;
}

export interface EvmProviderPreparedExecution<C extends EvmChain = EvmChain> {
  readonly state: "provider-prepared";
  readonly provider: EvmProviderExecutionBinding;
  readonly prepared: PreparedTx<C>;
  readonly reroutedFrom?: string;
}

export interface EvmProviderSimulatedExecution<C extends EvmChain = EvmChain> {
  readonly state: "provider-simulated";
  readonly provider: EvmProviderExecutionBinding;
  readonly prepared: PreparedTx<C>;
  readonly simulated: SimulatedTx<C>;
  readonly reroutedFrom?: string;
}

export interface EvmProviderSimulationFailedExecution<C extends EvmChain = EvmChain> {
  readonly state: "provider-simulation-failed";
  readonly provider: EvmProviderExecutionBinding;
  readonly prepared: PreparedTx<C>;
  readonly failed: SimulationFailedTx<C>;
  readonly reroutedFrom?: string;
}

export interface EvmProviderSignedExecution<C extends EvmChain = EvmChain> {
  readonly state: "provider-signed";
  readonly provider: EvmProviderExecutionBinding;
  readonly prepared: PreparedTx<C>;
  readonly simulated: SimulatedTx<C>;
  readonly signed: SignedTx<C>;
  readonly reroutedFrom?: string;
}

export interface EvmProviderBroadcastExecution<C extends EvmChain = EvmChain> {
  readonly state: "provider-broadcast";
  readonly provider: EvmProviderExecutionBinding;
  readonly prepared: PreparedTx<C>;
  readonly simulated: SimulatedTx<C>;
  readonly signed: SignedTx<C>;
  readonly broadcast: BroadcastTx<C>;
  readonly reroutedFrom?: string;
}

export interface EvmProviderRerouteRequired<C extends EvmChain = EvmChain> {
  readonly state: "provider-reroute-required";
  readonly previousProvider: EvmProviderExecutionBinding;
  readonly provider: EvmProviderExecutionBinding;
  readonly prepared: PreparedTx<C>;
  readonly invalidatedSimulation: {
    readonly blockNumber: bigint;
    readonly blockHash: string;
    readonly providerId: string;
  };
  readonly invalidatedSignature: boolean;
}

export type EvmProviderReroutableExecution<C extends EvmChain = EvmChain> =
  | EvmProviderSimulatedExecution<C>
  | EvmProviderSignedExecution<C>;

type SimulationOptions = {
  readonly blockTag?: SimulationBlockTag;
  readonly stateOverride?: unknown;
  readonly assumptions?: readonly string[];
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

function normalizeRequired(
  required: readonly EvmCapabilityKey[],
): readonly EvmCapabilityKey[] {
  return [...new Set(required)].sort();
}

function normalizedProviderEvidence(
  evidence: EvmProviderConformanceEvidence,
): EvmProviderConformanceEvidence {
  return createEvmProviderConformanceEvidence(
    {
      kind: "evm-capability-evidence",
      profileId: evidence.profileId,
      chainId: evidence.chainId,
      observedAtMs: evidence.observedAtMs,
      capabilities: evidence.capabilities,
      probes: evidence.probes,
    },
    { providerId: evidence.providerId },
  );
}

function providerEvidenceHash(
  evidence: EvmProviderConformanceEvidence,
): string {
  const normalized = normalizedProviderEvidence(evidence);
  return sha256({
    providerId: normalized.providerId,
    profileId: normalized.profileId,
    chainId: normalized.chainId,
    observedAtMs: normalized.observedAtMs,
    capabilities: normalized.capabilities,
    probes: normalized.probes,
  });
}

function validateMatrix(
  matrix: EvmConformanceMatrix,
  evidence: EvmProviderConformanceEvidence,
  required: readonly EvmCapabilityKey[],
): EvmConformanceMatrix {
  const rebuilt = buildEvmConformanceMatrix(matrix.providers);
  if (rebuilt.matrixHash !== matrix.matrixHash) {
    fail(
      "ES4756",
      "ProviderExecutionMatrixMismatch",
      "EVM conformance matrix hash does not match its provider evidence.",
      { suppliedMatrixHash: matrix.matrixHash, rebuiltMatrixHash: rebuilt.matrixHash },
    );
  }
  if (
    matrix.profileId !== evidence.profileId
    || matrix.chainId !== evidence.chainId
  ) {
    fail(
      "ES4750",
      "ProviderExecutionProfileMismatch",
      "Provider execution evidence and conformance matrix target different EVM profiles/chains.",
      {
        evidenceProfileId: evidence.profileId,
        evidenceChainId: evidence.chainId,
        matrixProfileId: matrix.profileId,
        matrixChainId: matrix.chainId,
      },
    );
  }

  const matrixProvider = rebuilt.providers.find(
    (provider) => provider.providerId === evidence.providerId,
  );
  if (!matrixProvider) {
    fail(
      "ES4756",
      "ProviderExecutionMatrixMismatch",
      "Selected provider is not present in the supplied EVM conformance matrix.",
      { providerId: evidence.providerId, matrixHash: matrix.matrixHash },
    );
  }

  assertEvmProviderRequirements(matrixProvider, required);
  return rebuilt;
}

export function createEvmProviderExecutionBinding(
  evidence: EvmProviderConformanceEvidence,
  requiredCapabilities: readonly EvmCapabilityKey[],
  options: { readonly matrix?: EvmConformanceMatrix } = {},
): EvmProviderExecutionBinding {
  const normalized = normalizedProviderEvidence(evidence);
  const required = normalizeRequired(requiredCapabilities);
  assertEvmProviderRequirements(normalized, required);

  const matrix = options.matrix
    ? validateMatrix(options.matrix, normalized, required)
    : undefined;
  const evidenceHash = providerEvidenceHash(normalized);

  if (matrix) {
    const matrixProvider = matrix.providers.find(
      (provider) => provider.providerId === normalized.providerId,
    )!;
    const matrixEvidenceHash = providerEvidenceHash(matrixProvider);
    // A matrix may be older than the fresh runtime observation. Capability
    // support must match, but timestamps/probe details can legitimately change.
    for (const capability of required) {
      if (
        matrixProvider.capabilities[capability] !== "supported"
        || normalized.capabilities[capability] !== "supported"
      ) {
        fail(
          "ES4751",
          "ProviderExecutionEvidenceMismatch",
          "Selected provider no longer proves a capability required by the matrix route.",
          {
            providerId: normalized.providerId,
            capability,
            matrixEvidenceHash,
            freshEvidenceHash: evidenceHash,
          },
        );
      }
    }
  }

  const core = {
    providerId: normalized.providerId,
    profileId: normalized.profileId,
    chainId: normalized.chainId,
    observedAtMs: normalized.observedAtMs,
    requiredCapabilities: required,
    providerEvidenceHash: evidenceHash,
    ...(matrix ? { matrixHash: matrix.matrixHash } : {}),
  };

  return {
    kind: "evm-provider-execution-binding",
    ...core,
    bindingHash: sha256(core),
  };
}

export async function discoverEvmExecutionProvider(
  client: ViemClientLike,
  profile: EvmChainProfile,
  input: {
    readonly providerId: string;
    readonly requiredCapabilities?: readonly EvmCapabilityKey[];
    readonly observedAtMs?: number;
    readonly matrix?: EvmConformanceMatrix;
  },
): Promise<EvmBoundExecutionProvider> {
  const required = normalizeRequired(input.requiredCapabilities ?? []);
  const evidence = await discoverEvmProviderConformance(
    client,
    profile,
    {
      providerId: input.providerId,
      ...(input.observedAtMs !== undefined
        ? { observedAtMs: input.observedAtMs }
        : {}),
    },
  );

  const binding = createEvmProviderExecutionBinding(
    evidence,
    required,
    input.matrix ? { matrix: input.matrix } : {},
  );

  if (!client.chain || client.chain.id !== binding.chainId) {
    fail(
      "ES4752",
      "ProviderExecutionClientMismatch",
      "Bound viem client is not connected to the provider binding chain.",
      {
        providerId: binding.providerId,
        expectedChainId: binding.chainId,
        actualChainId: client.chain?.id ?? null,
      },
    );
  }

  return {
    kind: "evm-bound-execution-provider",
    client,
    binding,
    [boundProviderBrand]: true,
  };
}

function assertTransactionChain<C extends EvmChain>(
  binding: EvmProviderExecutionBinding,
  chain: C,
): void {
  if (binding.chainId !== chain.id) {
    fail(
      "ES4750",
      "ProviderExecutionProfileMismatch",
      "Provider execution binding does not match the transaction chain.",
      {
        providerId: binding.providerId,
        bindingChainId: binding.chainId,
        transactionChainId: chain.id,
      },
    );
  }
}

function assertProviderMatch(
  expected: EvmProviderExecutionBinding,
  actual: EvmProviderExecutionBinding,
): void {
  if (
    expected.bindingHash !== actual.bindingHash
    || expected.providerId !== actual.providerId
    || expected.profileId !== actual.profileId
    || expected.chainId !== actual.chainId
  ) {
    fail(
      "ES4753",
      "ProviderExecutionBindingMismatch",
      "Execution state is bound to a different EVM provider/evidence set.",
      {
        expectedProviderId: expected.providerId,
        expectedBindingHash: expected.bindingHash,
        actualProviderId: actual.providerId,
        actualBindingHash: actual.bindingHash,
      },
    );
  }
}

export async function prepareEvmProviderExecution<C extends EvmChain>(
  provider: EvmBoundExecutionProvider,
  draft: DraftTx<C>,
  options: {
    readonly nonceSource?: RpcNonceSource;
    readonly feePreference?: RpcFeePreference;
  } = {},
): Promise<EvmProviderPreparedExecution<C>> {
  assertTransactionChain(provider.binding, draft.intent.chain);
  const prepared = await prepareDraftWithRpc(provider.client, draft, options);
  return {
    state: "provider-prepared",
    provider: provider.binding,
    prepared,
  };
}

export async function simulateEvmProviderExecution<C extends EvmChain>(
  provider: EvmBoundExecutionProvider,
  source: EvmProviderPreparedExecution<C>,
  options: SimulationOptions = {},
): Promise<
  EvmProviderSimulatedExecution<C>
  | EvmProviderSimulationFailedExecution<C>
> {
  assertProviderMatch(source.provider, provider.binding);
  assertTransactionChain(provider.binding, source.prepared.intent.chain);

  const result = await simulatePreparedWithRpc(
    provider.client,
    source.prepared,
    {
      ...(options.blockTag ? { blockTag: options.blockTag } : {}),
      ...(options.stateOverride !== undefined
        ? { stateOverride: options.stateOverride }
        : {}),
      provider: provider.binding.providerId,
      ...(options.assumptions
        ? { assumptions: options.assumptions }
        : {}),
    },
  );

  if (result.state === "simulation-failed") {
    return {
      state: "provider-simulation-failed",
      provider: provider.binding,
      prepared: source.prepared,
      failed: result,
      ...(source.reroutedFrom ? { reroutedFrom: source.reroutedFrom } : {}),
    };
  }

  if (
    result.simulation.blockNumber === undefined
    || result.simulation.blockHash === undefined
    || result.simulation.provider !== provider.binding.providerId
  ) {
    fail(
      "ES4759",
      "ProviderExecutionStateMismatch",
      "Provider-bound simulation must contain a concrete block anchor and the exact bound provider ID.",
      {
        providerId: provider.binding.providerId,
        simulationProvider: result.simulation.provider ?? null,
        blockNumber: result.simulation.blockNumber?.toString() ?? null,
        blockHash: result.simulation.blockHash ?? null,
      },
    );
  }

  return {
    state: "provider-simulated",
    provider: provider.binding,
    prepared: source.prepared,
    simulated: result,
    ...(source.reroutedFrom ? { reroutedFrom: source.reroutedFrom } : {}),
  };
}

export function signEvmProviderExecution<C extends EvmChain>(
  source: EvmProviderSimulatedExecution<C>,
  rawTransaction: Hex,
): EvmProviderSignedExecution<C> {
  const signed = signSimulated(source.simulated, rawTransaction);
  return {
    state: "provider-signed",
    provider: source.provider,
    prepared: source.prepared,
    simulated: source.simulated,
    signed,
    ...(source.reroutedFrom ? { reroutedFrom: source.reroutedFrom } : {}),
  };
}

export async function broadcastEvmProviderExecution<C extends EvmChain>(
  provider: EvmBoundExecutionProvider,
  source: EvmProviderSignedExecution<C>,
): Promise<EvmProviderBroadcastExecution<C>> {
  assertProviderMatch(source.provider, provider.binding);
  assertTransactionChain(provider.binding, source.signed.intent.chain);

  if (source.simulated.simulation.provider !== provider.binding.providerId) {
    fail(
      "ES4753",
      "ProviderExecutionBindingMismatch",
      "Signed transaction simulation evidence does not name the currently bound provider.",
      {
        boundProviderId: provider.binding.providerId,
        simulationProvider: source.simulated.simulation.provider ?? null,
      },
    );
  }

  const broadcast = await broadcastSignedWithRpc(
    provider.client,
    source.signed,
  );
  return {
    state: "provider-broadcast",
    provider: provider.binding,
    prepared: source.prepared,
    simulated: source.simulated,
    signed: source.signed,
    broadcast,
    ...(source.reroutedFrom ? { reroutedFrom: source.reroutedFrom } : {}),
  };
}

export function rerouteEvmProviderExecution<C extends EvmChain>(
  source: EvmProviderReroutableExecution<C>,
  nextProvider: EvmBoundExecutionProvider,
): EvmProviderRerouteRequired<C> {
  if (
    source.provider.profileId !== nextProvider.binding.profileId
    || source.provider.chainId !== nextProvider.binding.chainId
  ) {
    fail(
      "ES4750",
      "ProviderExecutionProfileMismatch",
      "EVM provider reroute cannot cross profile or chain boundaries.",
      {
        previousProfileId: source.provider.profileId,
        previousChainId: source.provider.chainId,
        nextProfileId: nextProvider.binding.profileId,
        nextChainId: nextProvider.binding.chainId,
      },
    );
  }

  if (source.provider.bindingHash === nextProvider.binding.bindingHash) {
    fail(
      "ES4755",
      "ProviderExecutionNoopReroute",
      "EVM provider reroute target is identical to the current provider binding.",
      { providerId: source.provider.providerId },
    );
  }

  if (nextProvider.binding.observedAtMs < source.provider.observedAtMs) {
    fail(
      "ES4754",
      "ProviderExecutionStaleRerouteEvidence",
      "EVM provider reroute requires capability evidence at least as recent as the previous provider binding.",
      {
        previousProviderId: source.provider.providerId,
        previousObservedAtMs: source.provider.observedAtMs,
        nextProviderId: nextProvider.binding.providerId,
        nextObservedAtMs: nextProvider.binding.observedAtMs,
      },
    );
  }

  const blockNumber = source.simulated.simulation.blockNumber;
  const blockHash = source.simulated.simulation.blockHash;
  if (blockNumber === undefined || blockHash === undefined) {
    fail(
      "ES4759",
      "ProviderExecutionStateMismatch",
      "Cannot reroute provider-bound execution whose prior simulation is not block-anchored.",
      { providerId: source.provider.providerId },
    );
  }

  return {
    state: "provider-reroute-required",
    previousProvider: source.provider,
    provider: nextProvider.binding,
    prepared: source.prepared,
    invalidatedSimulation: {
      blockNumber,
      blockHash,
      providerId: source.provider.providerId,
    },
    invalidatedSignature: source.state === "provider-signed",
  };
}

export async function resimulateReroutedEvmProviderExecution<
  C extends EvmChain,
>(
  provider: EvmBoundExecutionProvider,
  reroute: EvmProviderRerouteRequired<C>,
  options: SimulationOptions = {},
): Promise<
  EvmProviderSimulatedExecution<C>
  | EvmProviderSimulationFailedExecution<C>
> {
  assertProviderMatch(reroute.provider, provider.binding);

  return simulateEvmProviderExecution(
    provider,
    {
      state: "provider-prepared",
      provider: reroute.provider,
      prepared: reroute.prepared,
      reroutedFrom: reroute.previousProvider.bindingHash,
    },
    options,
  );
}
