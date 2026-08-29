import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  buildEvmConformanceMatrix,
  createEvmProviderConformanceEvidence,
  createEvmProviderExecutionBinding,
  discoverEvmExecutionProvider,
  genericEvmProfile,
  prepareEvmProviderExecution,
  rerouteEvmProviderExecution,
  resimulateReroutedEvmProviderExecution,
  signEvmProviderExecution,
  simulateEvmProviderExecution,
  broadcastEvmProviderExecution,
  type EvmCapabilityEvidence,
  type EvmCapabilities,
  type EvmProviderConformanceEvidence,
} from "../src/chains/index.js";
import {
  address,
  draftTransaction,
} from "../src/web3/index.js";

const TestChain = { name: "Test EVM", id: 777 } as const;
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const BLOCK_HASH = `0x${"33".repeat(32)}`;
const SAFE_HASH = `0x${"44".repeat(32)}`;
const FINALIZED_HASH = `0x${"55".repeat(32)}`;
const TX_A = `0x${"aa".repeat(32)}`;
const TX_B = `0x${"bb".repeat(32)}`;

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

function baseEvidence(
  providerId: string,
  observedAtMs = 1_000,
): EvmProviderConformanceEvidence {
  const raw: EvmCapabilityEvidence = {
    kind: "evm-capability-evidence",
    profileId: "evm.test.777",
    chainId: 777,
    observedAtMs,
    capabilities: {
      ...UNKNOWN_CAPABILITIES,
      eip1559: "supported",
      debugTraceCall: "supported",
      finalizedTag: "supported",
      safeTag: "supported",
    },
    probes: [
      {
        capability: "debugTraceCall",
        status: "supported",
        source: "rpc-probe",
      },
      {
        capability: "eip1559",
        status: "supported",
        source: "block-shape",
      },
    ],
  };
  return createEvmProviderConformanceEvidence(raw, { providerId });
}

function client(input: {
  provider: "a" | "b";
  trace?: "supported" | "unsupported";
}) {
  return {
    chain: { id: 777, name: "Test EVM" },

    async getBlock({ blockTag }: { blockTag?: string; blockNumber?: bigint }) {
      if (blockTag === "safe") {
        return { number: 99n, hash: SAFE_HASH };
      }
      if (blockTag === "finalized") {
        return { number: 98n, hash: FINALIZED_HASH };
      }
      if (blockTag === "pending") {
        return { number: 101n, hash: BLOCK_HASH };
      }
      return {
        number: 100n,
        hash: BLOCK_HASH,
        baseFeePerGas: 1n,
      };
    },

    async request({ method }: { method: string }) {
      if (method !== "debug_traceCall") return {};
      if (input.trace === "unsupported") {
        throw new Error("method not found (-32601)");
      }
      return {};
    },

    async getTransactionCount() {
      return 7;
    },

    async estimateGas() {
      return 21_000n;
    },

    async estimateFeesPerGas() {
      return {
        maxFeePerGas: 100n,
        maxPriorityFeePerGas: 2n,
      };
    },

    async call() {
      return { data: "0x" as const };
    },

    async sendRawTransaction() {
      return input.provider === "a" ? TX_A : TX_B;
    },
  };
}

const profile = genericEvmProfile({
  id: "evm.test.777",
  name: "Test EVM",
  chainId: 777,
});

test("provider execution binding is deterministic and normalizes capability order", () => {
  const evidence = baseEvidence("provider-a");
  const reversed: EvmProviderConformanceEvidence = {
    ...evidence,
    probes: [...evidence.probes].reverse(),
  };

  const left = createEvmProviderExecutionBinding(
    evidence,
    ["debugTraceCall", "eip1559", "debugTraceCall"],
  );
  const right = createEvmProviderExecutionBinding(
    reversed,
    ["eip1559", "debugTraceCall"],
  );

  assert.equal(left.bindingHash, right.bindingHash);
  assert.equal(left.providerEvidenceHash, right.providerEvidenceHash);
  assert.deepEqual(left.requiredCapabilities, [
    "debugTraceCall",
    "eip1559",
  ]);
  assert.equal(JSON.stringify(left).includes("http"), false);
  assert.equal(JSON.stringify(left).includes("api_key"), false);
});

test("provider-bound happy path preserves one provider from preparation through broadcast", async () => {
  const providerA = await discoverEvmExecutionProvider(
    client({ provider: "a" }),
    profile,
    {
      providerId: "provider-a",
      requiredCapabilities: ["eip1559", "debugTraceCall"],
      observedAtMs: 1_000,
    },
  );

  const draft = draftTransaction({
    chain: TestChain,
    from: address(FROM, TestChain),
    to: address(TO, TestChain),
  });

  const prepared = await prepareEvmProviderExecution(providerA, draft);
  const simulated = await simulateEvmProviderExecution(
    providerA,
    prepared,
  );
  assert.equal(simulated.state, "provider-simulated");
  if (simulated.state !== "provider-simulated") {
    throw new Error("expected provider simulation success");
  }
  assert.equal(simulated.simulated.simulation.provider, "provider-a");

  const signed = signEvmProviderExecution(simulated, "0x02");
  const broadcast = await broadcastEvmProviderExecution(
    providerA,
    signed,
  );

  assert.equal(broadcast.state, "provider-broadcast");
  assert.equal(broadcast.provider.providerId, "provider-a");
  assert.equal(broadcast.broadcast.hash, TX_A);
});

test("provider substitution is rejected and explicit reroute invalidates simulation/signature", async () => {
  const providerA = await discoverEvmExecutionProvider(
    client({ provider: "a" }),
    profile,
    {
      providerId: "provider-a",
      requiredCapabilities: ["eip1559"],
      observedAtMs: 1_000,
    },
  );
  const providerB = await discoverEvmExecutionProvider(
    client({ provider: "b" }),
    profile,
    {
      providerId: "provider-b",
      requiredCapabilities: ["eip1559"],
      observedAtMs: 2_000,
    },
  );

  const draft = draftTransaction({
    chain: TestChain,
    from: address(FROM, TestChain),
    to: address(TO, TestChain),
  });
  const prepared = await prepareEvmProviderExecution(providerA, draft);
  const simulated = await simulateEvmProviderExecution(providerA, prepared);
  assert.equal(simulated.state, "provider-simulated");
  if (simulated.state !== "provider-simulated") {
    throw new Error("expected simulation success");
  }
  const signedA = signEvmProviderExecution(simulated, "0x02");

  await assert.rejects(
    () => broadcastEvmProviderExecution(providerB, signedA),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4753",
  );

  const reroute = rerouteEvmProviderExecution(signedA, providerB);
  assert.equal(reroute.state, "provider-reroute-required");
  assert.equal(reroute.invalidatedSignature, true);
  assert.equal(reroute.previousProvider.providerId, "provider-a");
  assert.equal(reroute.provider.providerId, "provider-b");
  assert.equal(
    "signed" in (reroute as unknown as Record<string, unknown>),
    false,
  );

  const simulatedB = await resimulateReroutedEvmProviderExecution(
    providerB,
    reroute,
  );
  assert.equal(simulatedB.state, "provider-simulated");
  if (simulatedB.state !== "provider-simulated") {
    throw new Error("expected rerouted simulation success");
  }
  assert.equal(simulatedB.simulated.simulation.provider, "provider-b");
  assert.equal(
    simulatedB.reroutedFrom,
    providerA.binding.bindingHash,
  );

  const signedB = signEvmProviderExecution(simulatedB, "0x02");
  const broadcastB = await broadcastEvmProviderExecution(
    providerB,
    signedB,
  );
  assert.equal(broadcastB.broadcast.hash, TX_B);
  assert.equal(broadcastB.provider.providerId, "provider-b");
});


test("reroute rejects provider evidence older than the current route binding", async () => {
  const providerA = await discoverEvmExecutionProvider(
    client({ provider: "a" }),
    profile,
    {
      providerId: "provider-a",
      requiredCapabilities: ["eip1559"],
      observedAtMs: 2_000,
    },
  );
  const staleProviderB = await discoverEvmExecutionProvider(
    client({ provider: "b" }),
    profile,
    {
      providerId: "provider-b",
      requiredCapabilities: ["eip1559"],
      observedAtMs: 1_000,
    },
  );

  const draft = draftTransaction({
    chain: TestChain,
    from: address(FROM, TestChain),
    to: address(TO, TestChain),
  });
  const prepared = await prepareEvmProviderExecution(providerA, draft);
  const simulated = await simulateEvmProviderExecution(providerA, prepared);
  assert.equal(simulated.state, "provider-simulated");
  if (simulated.state !== "provider-simulated") {
    throw new Error("expected simulation success");
  }

  assert.throws(
    () => rerouteEvmProviderExecution(simulated, staleProviderB),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4754",
  );
});

test("reroute provider must freshly prove every required capability", async () => {
  await assert.rejects(
    () =>
      discoverEvmExecutionProvider(
        client({ provider: "b", trace: "unsupported" }),
        profile,
        {
          providerId: "provider-b",
          requiredCapabilities: ["debugTraceCall"],
          observedAtMs: 2_000,
        },
      ),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4747",
  );
});

test("matrix-routed provider must exist in the matrix and prove requested capabilities", async () => {
  const a = baseEvidence("provider-a", 1_000);
  const b = baseEvidence("provider-b", 2_000);
  const matrix = buildEvmConformanceMatrix([b, a]);

  const routed = await discoverEvmExecutionProvider(
    client({ provider: "a" }),
    profile,
    {
      providerId: "provider-a",
      requiredCapabilities: ["eip1559"],
      observedAtMs: 3_000,
      matrix,
    },
  );
  assert.equal(routed.binding.matrixHash, matrix.matrixHash);

  await assert.rejects(
    () =>
      discoverEvmExecutionProvider(
        client({ provider: "a" }),
        profile,
        {
          providerId: "provider-c",
          requiredCapabilities: ["eip1559"],
          observedAtMs: 4_000,
          matrix,
        },
      ),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4756",
  );
});

test("provider binding retains v0.7 endpoint/credential rejection", () => {
  const unsafe: EvmProviderConformanceEvidence = {
    ...baseEvidence("provider-a"),
    providerId: "https://rpc.example/?api_key=super-secret",
  };

  assert.throws(
    () => createEvmProviderExecutionBinding(unsafe, ["eip1559"]),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4740",
  );
});
