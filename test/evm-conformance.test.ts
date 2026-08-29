import assert from "node:assert/strict";
import test from "node:test";
import { avalanche, bsc, gnosis, mainnet, polygon } from "viem/chains";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  assertEvmConformanceRequirements,
  assertEvmProviderRequirements,
  buildEvmConformanceMatrix,
  createEvmProviderConformanceEvidence,
  discoverEvmProviderConformance,
  evaluateEvmConformanceRequirements,
  evmProfileFromViemChain,
  genericEvmProfile,
  providersSupportingEvmCapabilities,
  type EvmCapabilityEvidence,
  type EvmCapabilities,
} from "../src/chains/index.js";

const UNKNOWN_CAPABILITIES: EvmCapabilities = {
  eip1559: "unknown",
  eip2930: "unknown",
  eip4844: "unknown",
  eip7702: "unknown",
  erc4337: "unknown",
  debugTraceCall: "unknown",
  finalizedTag: "unknown",
  safeTag: "unknown",
  privateRpc: "unknown",
  bundleRpc: "unknown",
};

function evidence(input: {
  profileId?: string;
  chainId?: number;
  observedAtMs?: number;
  capabilities?: Partial<EvmCapabilities>;
} = {}): EvmCapabilityEvidence {
  return {
    kind: "evm-capability-evidence",
    profileId: input.profileId ?? "evm.test.777",
    chainId: input.chainId ?? 777,
    observedAtMs: input.observedAtMs ?? 1_000,
    capabilities: {
      ...UNKNOWN_CAPABILITIES,
      ...input.capabilities,
    },
    probes: [],
  };
}

function client(input: {
  chainId?: number;
  trace?: "supported" | "unsupported" | "unknown";
}) {
  return {
    chain: { id: input.chainId ?? 777, name: "Test EVM" },
    async getBlock({ blockTag }: { blockTag: string }) {
      if (blockTag === "latest") {
        return {
          number: 100n,
          hash: `0x${"11".repeat(32)}`,
          baseFeePerGas: 1n,
        };
      }
      return {
        number: 99n,
        hash: `0x${"22".repeat(32)}`,
      };
    },
    async request() {
      if (input.trace === "supported") return {};
      if (input.trace === "unsupported") {
        throw new Error("method not found (-32601)");
      }
      throw new Error("provider policy/rate limit");
    },
  };
}

test("provider conformance exposes disagreement without upgrading chain-global support", async () => {
  const profile = genericEvmProfile({
    id: "evm.test.777",
    name: "Test EVM",
    chainId: 777,
  });

  const providerA = await discoverEvmProviderConformance(
    client({ trace: "supported" }),
    profile,
    { providerId: "provider-a", observedAtMs: 1_000 },
  );
  const providerB = await discoverEvmProviderConformance(
    client({ trace: "unsupported" }),
    profile,
    { providerId: "provider-b", observedAtMs: 2_000 },
  );

  const matrix = buildEvmConformanceMatrix([providerB, providerA]);
  const reversed = buildEvmConformanceMatrix([providerA, providerB]);

  assert.equal(matrix.matrixHash, reversed.matrixHash);
  assert.deepEqual(matrix.providerIds, ["provider-a", "provider-b"]);
  assert.equal(matrix.observedAtMs, 2_000);
  assert.equal(matrix.capabilities.eip1559.status, "supported");
  assert.equal(matrix.capabilities.debugTraceCall.status, "conflict");
  assert.equal(matrix.capabilities.eip7702.status, "unknown");

  const evaluation = evaluateEvmConformanceRequirements(matrix, [
    "eip1559",
    "debugTraceCall",
  ]);
  assert.equal(evaluation.globalReady, false);
  assert.deepEqual(evaluation.providerCandidates, ["provider-a"]);
  assert.deepEqual(
    providersSupportingEvmCapabilities(matrix, ["debugTraceCall"]),
    ["provider-a"],
  );

  assert.doesNotThrow(() =>
    assertEvmProviderRequirements(providerA, ["eip1559", "debugTraceCall"]),
  );
  assert.throws(
    () => assertEvmProviderRequirements(providerB, ["debugTraceCall"]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4747",
  );
  assert.throws(
    () => assertEvmConformanceRequirements(matrix, ["debugTraceCall"]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4745",
  );
});

test("supported plus unknown remains fail-closed unknown at matrix level", async () => {
  const profile = genericEvmProfile({
    id: "evm.test.777",
    name: "Test EVM",
    chainId: 777,
  });
  const supported = await discoverEvmProviderConformance(
    client({ trace: "supported" }),
    profile,
    { providerId: "provider-supported", observedAtMs: 1_000 },
  );
  const unknown = await discoverEvmProviderConformance(
    client({ trace: "unknown" }),
    profile,
    { providerId: "provider-unknown", observedAtMs: 2_000 },
  );

  const matrix = buildEvmConformanceMatrix([supported, unknown]);
  assert.equal(matrix.capabilities.debugTraceCall.status, "unknown");
  assert.deepEqual(matrix.capabilities.debugTraceCall.supportedBy, [
    "provider-supported",
  ]);
  assert.deepEqual(matrix.capabilities.debugTraceCall.unknownBy, [
    "provider-unknown",
  ]);
  assert.deepEqual(
    providersSupportingEvmCapabilities(matrix, ["debugTraceCall"]),
    ["provider-supported"],
  );
  assert.throws(
    () => assertEvmConformanceRequirements(matrix, ["debugTraceCall"]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4744",
  );
});

test("matrix rejects duplicate providers, mixed profiles, and endpoint-like provider identities", () => {
  const one = createEvmProviderConformanceEvidence(
    evidence({ capabilities: { eip1559: "supported" } }),
    { providerId: "provider-a" },
  );
  const duplicate = createEvmProviderConformanceEvidence(
    evidence({ observedAtMs: 2_000 }),
    { providerId: "provider-a" },
  );
  assert.throws(
    () => buildEvmConformanceMatrix([one, duplicate]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4741",
  );

  const otherChain = createEvmProviderConformanceEvidence(
    evidence({
      profileId: "evm.other.888",
      chainId: 888,
      observedAtMs: 3_000,
    }),
    { providerId: "provider-b" },
  );
  assert.throws(
    () => buildEvmConformanceMatrix([one, otherChain]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4742",
  );

  assert.throws(
    () =>
      createEvmProviderConformanceEvidence(evidence(), {
        providerId: "https://rpc.example/?key=secret",
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4740",
  );
});

test("unanimous unsupported requirements produce a distinct fail-closed diagnostic", () => {
  const left = createEvmProviderConformanceEvidence(
    evidence({
      capabilities: { finalizedTag: "unsupported" },
      observedAtMs: 1_000,
    }),
    { providerId: "left" },
  );
  const right = createEvmProviderConformanceEvidence(
    evidence({
      capabilities: { finalizedTag: "unsupported" },
      observedAtMs: 2_000,
    }),
    { providerId: "right" },
  );
  const matrix = buildEvmConformanceMatrix([left, right]);
  assert.equal(matrix.capabilities.finalizedTag.status, "unsupported");
  assert.throws(
    () => assertEvmConformanceRequirements(matrix, ["finalizedTag"]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4746",
  );
});

test("all-EVM path accepts multiple current viem chain definitions without chain-name inference", () => {
  const fixtures = [
    [mainnet, 1],
    [bsc, 56],
    [polygon, 137],
    [avalanche, 43114],
    [gnosis, 100],
  ] as const;

  const profiles = fixtures.map(([chain, expectedId]) => {
    const profile = evmProfileFromViemChain(chain);
    assert.equal(profile.chainId, expectedId);
    assert.equal(profile.name, chain.name);
    assert.equal(profile.family, "evm");
    assert.equal(profile.capabilities.eip7702, "unknown");
    assert.equal(profile.capabilities.bundleRpc, "unknown");
    return profile;
  });

  assert.equal(new Set(profiles.map((profile) => profile.id)).size, fixtures.length);
});
