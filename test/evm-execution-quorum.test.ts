import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  assertEvmExecutionQuorumIntegrity,
  buildEvmExecutionQuorum,
  defineEvmChainProfile,
  discoverEvmExecutionProvider,
  genericEvmProfile,
  observeEvmExecutionWithProvider,
  prepareEvmProviderExecution,
  promoteEvmExecutionWithQuorum,
  signEvmProviderExecution,
  simulateEvmProviderExecution,
  broadcastEvmProviderExecution,
  type EvmBoundExecutionProvider,
  type EvmChainProfile,
  type EvmProviderBroadcastExecution,
} from "../src/chains/index.js";
import { address, draftTransaction } from "../src/web3/index.js";

const TestChain = { name: "Test EVM", id: 777 } as const;
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const TX_HASH: `0x${string}` = `0x${"aa".repeat(32)}`;
const RECEIPT_BLOCK = 100n;
const RECEIPT_HASH: `0x${string}` = `0x${"33".repeat(32)}`;
const OTHER_RECEIPT_HASH: `0x${string}` = `0x${"44".repeat(32)}`;
const FINALIZED_HASH: `0x${string}` = `0x${"55".repeat(32)}`;
const SAFE_HASH: `0x${string}` = `0x${"66".repeat(32)}`;

const profile = genericEvmProfile({
  id: "evm.test.777",
  name: "Test EVM",
  chainId: 777,
});

const rollupProfile = defineEvmChainProfile({
  id: "evm.test.777",
  name: "Test EVM Rollup Semantics",
  family: "evm",
  network: "test",
  nativeSymbol: "ETH",
  chainId: 777,
  finality: {
    kind: "evm-rollup",
    l2Inclusion: true,
    l1Settlement: "supported",
  },
  executionBackends: ["public-rpc"],
  capabilities: profile.capabilities,
});

interface ClientOptions {
  providerId: string;
  receiptAvailable?: boolean;
  receiptBlockHash?: `0x${string}`;
  canonicalBlockHash?: `0x${string}`;
  confirmations?: bigint;
  finalizedNumber?: bigint;
}

function client(options: ClientOptions) {
  const receiptBlockHash = options.receiptBlockHash ?? RECEIPT_HASH;
  const canonicalBlockHash =
    options.canonicalBlockHash ?? receiptBlockHash;
  const confirmations = options.confirmations ?? 6n;
  const finalizedNumber =
    options.finalizedNumber ?? RECEIPT_BLOCK + 10n;

  return {
    chain: { id: 777, name: "Test EVM" },

    async getBlock(input: {
      blockTag?: string;
      blockNumber?: bigint;
    }) {
      if (input.blockNumber !== undefined) {
        return {
          number: input.blockNumber,
          hash: canonicalBlockHash,
        };
      }
      if (input.blockTag === "finalized") {
        return {
          number: finalizedNumber,
          hash: FINALIZED_HASH,
        };
      }
      if (input.blockTag === "safe") {
        return {
          number: RECEIPT_BLOCK + 5n,
          hash: SAFE_HASH,
        };
      }
      if (input.blockTag === "pending") {
        return {
          number: RECEIPT_BLOCK + 2n,
          hash: RECEIPT_HASH,
        };
      }
      return {
        number: RECEIPT_BLOCK + 1n,
        hash: RECEIPT_HASH,
        baseFeePerGas: 1n,
      };
    },

    async request() {
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
      return TX_HASH;
    },

    async getTransactionReceipt() {
      if (options.receiptAvailable === false) {
        throw new Error("receipt unavailable at private endpoint");
      }
      return {
        transactionHash: TX_HASH,
        blockHash: receiptBlockHash,
        blockNumber: RECEIPT_BLOCK,
        status: "success" as const,
        gasUsed: 21_000n,
        effectiveGasPrice: 42n,
      };
    },

    async getTransactionConfirmations() {
      return confirmations;
    },
  };
}

async function boundProvider(
  providerId: string,
  options: Omit<ClientOptions, "providerId"> = {},
  inputProfile: EvmChainProfile = profile,
  requiredCapabilities: readonly (
    | "eip1559"
    | "finalizedTag"
  )[] = ["eip1559"],
): Promise<EvmBoundExecutionProvider> {
  return discoverEvmExecutionProvider(
    client({ providerId, ...options }),
    inputProfile,
    {
      providerId,
      requiredCapabilities,
      observedAtMs:
        providerId === "provider-a" ? 1_000 : 2_000,
    },
  );
}

async function broadcastSource(input: {
  inputProfile?: EvmChainProfile;
  requireFinalized?: boolean;
} = {}): Promise<{
  provider: EvmBoundExecutionProvider;
  source: EvmProviderBroadcastExecution<typeof TestChain>;
}> {
  const inputProfile = input.inputProfile ?? profile;
  const provider = await boundProvider(
    "provider-a",
    {},
    inputProfile,
    input.requireFinalized
      ? ["eip1559", "finalizedTag"]
      : ["eip1559"],
  );

  const draft = draftTransaction({
    chain: TestChain,
    from: address(FROM, TestChain),
    to: address(TO, TestChain),
  });
  const prepared = await prepareEvmProviderExecution(provider, draft);
  const simulated = await simulateEvmProviderExecution(
    provider,
    prepared,
  );
  assert.equal(simulated.state, "provider-simulated");
  if (simulated.state !== "provider-simulated") {
    throw new Error("expected provider simulation success");
  }

  const signed = signEvmProviderExecution(simulated, "0x02");
  const source = await broadcastEvmProviderExecution(
    provider,
    signed,
  );
  return { provider, source };
}

test("two matching providers produce deterministic included quorum and promotion", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b");

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source, {
      observedAtMs: 3_000,
    }),
    observeEvmExecutionWithProvider(providerB, source, {
      observedAtMs: 4_000,
    }),
  ]);

  const left = buildEvmExecutionQuorum({
    profile,
    source,
    observations: [a, b],
  });
  const right = buildEvmExecutionQuorum({
    profile,
    source,
    observations: [b, a],
  });

  assert.equal(left.stage, "included");
  assert.equal(left.scope, "execution");
  assert.deepEqual(left.providerIds, [
    "provider-a",
    "provider-b",
  ]);
  assert.equal(left.quorumHash, right.quorumHash);
  assert.equal(JSON.stringify(left).includes("private endpoint"), false);

  const promoted = promoteEvmExecutionWithQuorum(source, left);
  assert.equal(promoted.state, "quorum-included");
  assert.equal(promoted.transaction.state, "included");
  assert.equal(promoted.transaction.receipt.blockHash, RECEIPT_HASH);
});

test("confirmation quorum requires every provider to meet the threshold", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b", {
    confirmations: 5n,
  });

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source),
    observeEvmExecutionWithProvider(providerB, source),
  ]);

  const quorum = buildEvmExecutionQuorum({
    profile,
    source,
    observations: [a, b],
    policy: { minimumConfirmations: 5 },
  });
  assert.equal(quorum.stage, "confirmed");

  const promoted = promoteEvmExecutionWithQuorum(source, quorum);
  assert.equal(promoted.state, "quorum-confirmed");
  assert.equal(promoted.transaction.confirmations, 5);

  const lowProvider = await boundProvider("provider-c", {
    confirmations: 4n,
  });
  const low = await observeEvmExecutionWithProvider(
    lowProvider,
    source,
  );
  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, low],
        policy: { minimumConfirmations: 5 },
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4766",
  );
});

test("finality quorum requires finalizedTag binding and every finalized head to include the receipt", async () => {
  const { provider: providerA, source } = await broadcastSource({
    requireFinalized: true,
  });
  const providerB = await boundProvider(
    "provider-b",
    {},
    profile,
    ["eip1559", "finalizedTag"],
  );

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source, {
      requireFinalized: true,
    }),
    observeEvmExecutionWithProvider(providerB, source, {
      requireFinalized: true,
    }),
  ]);

  const quorum = buildEvmExecutionQuorum({
    profile,
    source,
    observations: [a, b],
    policy: {
      minimumConfirmations: 3,
      requireFinalized: true,
    },
  });
  assert.equal(quorum.stage, "finalized");

  const promoted = promoteEvmExecutionWithQuorum(source, quorum);
  assert.equal(promoted.state, "quorum-finalized");
  assert.equal(promoted.transaction.state, "finalized");

  const unboundFinality = await boundProvider("provider-c");
  await assert.rejects(
    () =>
      observeEvmExecutionWithProvider(
        unboundFinality,
        source,
        { requireFinalized: true },
      ),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4767",
  );

  const behind = await boundProvider(
    "provider-d",
    { finalizedNumber: RECEIPT_BLOCK - 1n },
    profile,
    ["eip1559", "finalizedTag"],
  );
  const behindObservation = await observeEvmExecutionWithProvider(
    behind,
    source,
    { requireFinalized: true },
  );
  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, behindObservation],
        policy: { requireFinalized: true },
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4768",
  );
});

test("quorum rejects a provider that returns no receipt", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b", {
    receiptAvailable: false,
  });

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source),
    observeEvmExecutionWithProvider(providerB, source),
  ]);
  assert.equal(b.receipt, null);
  assert.equal(JSON.stringify(b).includes("private endpoint"), false);

  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, b],
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4763",
  );
});

test("quorum rejects individually canonical but conflicting receipts", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b", {
    receiptBlockHash: OTHER_RECEIPT_HASH,
    canonicalBlockHash: OTHER_RECEIPT_HASH,
  });

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source),
    observeEvmExecutionWithProvider(providerB, source),
  ]);
  assert.equal(a.canonicality, "canonical");
  assert.equal(b.canonicality, "canonical");

  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, b],
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4764",
  );
});

test("quorum rejects a provider whose receipt block is not canonical", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b", {
    canonicalBlockHash: OTHER_RECEIPT_HASH,
  });

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source),
    observeEvmExecutionWithProvider(providerB, source),
  ]);
  assert.equal(b.canonicality, "mismatch");

  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, b],
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4765",
  );
});

test("quorum rejects duplicate providers and too-small provider sets", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const a = await observeEvmExecutionWithProvider(providerA, source);

  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a],
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4760",
  );

  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, a],
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4762",
  );
});

test("rollup quorum is explicitly L2 execution evidence and does not claim L1 settlement", async () => {
  const { provider: providerA, source } = await broadcastSource({
    inputProfile: rollupProfile,
    requireFinalized: true,
  });
  const providerB = await boundProvider(
    "provider-b",
    {},
    rollupProfile,
    ["eip1559", "finalizedTag"],
  );

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source, {
      requireFinalized: true,
    }),
    observeEvmExecutionWithProvider(providerB, source, {
      requireFinalized: true,
    }),
  ]);

  const quorum = buildEvmExecutionQuorum({
    profile: rollupProfile,
    source,
    observations: [a, b],
    policy: { requireFinalized: true },
  });

  assert.equal(quorum.stage, "finalized");
  assert.equal(quorum.scope, "l2-execution");
  assert.equal(
    JSON.stringify(quorum).includes("l1-finalized"),
    false,
  );
});


test("quorum rejects tampered provider observation evidence", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b");

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source),
    observeEvmExecutionWithProvider(providerB, source),
  ]);

  const tampered = {
    ...b,
    confirmations: (b.confirmations ?? 0n) + 100n,
  };

  assert.throws(
    () =>
      buildEvmExecutionQuorum({
        profile,
        source,
        observations: [a, tampered],
      }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4770",
  );
});

test("promotion rejects tampered quorum evidence", async () => {
  const { provider: providerA, source } = await broadcastSource();
  const providerB = await boundProvider("provider-b");

  const [a, b] = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source),
    observeEvmExecutionWithProvider(providerB, source),
  ]);

  const quorum = buildEvmExecutionQuorum({
    profile,
    source,
    observations: [a, b],
  });
  assert.doesNotThrow(() => assertEvmExecutionQuorumIntegrity(quorum));

  const tampered = {
    ...quorum,
    minimumConfirmations: quorum.minimumConfirmations + 1,
  };

  assert.throws(
    () => promoteEvmExecutionWithQuorum(source, tampered),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && error.diagnostic.code === "ES4771",
  );
});
