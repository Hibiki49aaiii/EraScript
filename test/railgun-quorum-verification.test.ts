import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  buildEvmExecutionQuorum,
  discoverEvmExecutionProvider,
  genericEvmProfile,
  observeEvmExecutionWithProvider,
  prepareEvmProviderExecution,
  promoteEvmExecutionWithQuorum,
  signEvmProviderExecution,
  simulateEvmProviderExecution,
  broadcastEvmProviderExecution,
  type EvmBoundExecutionProvider,
} from "../src/chains/index.js";
import {
  attachRailgunGasEvidence,
  createRailgunIntent,
  createRailgunProofEvidence,
  markRailgunSubmitted,
  populateRailgunTransaction,
  railgunAddress,
  railgunPrivateStateEvidence,
  railgunVerificationReportWithEvmQuorum,
} from "../src/privacy/index.js";
import {
  Ethereum,
  address,
  draftTransaction,
} from "../src/web3/index.js";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const TX_HASH: `0x${string}` = `0x${"aa".repeat(32)}`;
const BLOCK_HASH: `0x${string}` = `0x${"33".repeat(32)}`;
const FINALIZED_HASH: `0x${string}` = `0x${"55".repeat(32)}`;
const TOKEN = "0x0000000000000000000000000000000000001000";
const validateRailgunAddress = (value: string) => /^0zk1[0-9a-z]+$/i.test(value);

const profile = genericEvmProfile({
  id: "evm.ethereum.railgun-quorum-test",
  name: "Ethereum",
  chainId: Ethereum.id,
});

function client() {
  return {
    chain: { id: Ethereum.id, name: "Ethereum" },
    async getBlock(input: { blockTag?: string; blockNumber?: bigint }) {
      if (input.blockNumber !== undefined) {
        return { number: input.blockNumber, hash: BLOCK_HASH };
      }
      if (input.blockTag === "finalized") {
        return { number: 200n, hash: FINALIZED_HASH };
      }
      return {
        number: 150n,
        hash: BLOCK_HASH,
        baseFeePerGas: 1n,
      };
    },
    async request() { return {}; },
    async getTransactionCount() { return 7; },
    async estimateGas() { return 21_000n; },
    async estimateFeesPerGas() {
      return { maxFeePerGas: 100n, maxPriorityFeePerGas: 2n };
    },
    async call() { return { data: "0x" as const }; },
    async sendRawTransaction() { return TX_HASH; },
    async getTransactionReceipt() {
      return {
        transactionHash: TX_HASH,
        blockHash: BLOCK_HASH,
        blockNumber: 100n,
        status: "success" as const,
        gasUsed: 21_000n,
      };
    },
    async getTransactionConfirmations() { return 8n; },
  };
}

async function provider(id: string): Promise<EvmBoundExecutionProvider> {
  return discoverEvmExecutionProvider(
    client(),
    profile,
    {
      providerId: id,
      requiredCapabilities: ["eip1559", "finalizedTag"],
      observedAtMs: id === "evm-a" ? 1_000 : 2_000,
    },
  );
}

async function baseEvidence() {
  const providerA = await provider("evm-a");
  const providerB = await provider("evm-b");
  const draft = draftTransaction({
    chain: Ethereum,
    from: address(FROM, Ethereum),
    to: address(TO, Ethereum),
  });
  const prepared = await prepareEvmProviderExecution(providerA, draft);
  const simulated = await simulateEvmProviderExecution(providerA, prepared);
  if (simulated.state !== "provider-simulated") throw new Error("expected simulation success");
  const signed = signEvmProviderExecution(simulated, "0x02");
  const source = await broadcastEvmProviderExecution(providerA, signed);
  const observations = await Promise.all([
    observeEvmExecutionWithProvider(providerA, source, {
      requireFinalized: true,
      observedAtMs: 3_000,
    }),
    observeEvmExecutionWithProvider(providerB, source, {
      requireFinalized: true,
      observedAtMs: 4_000,
    }),
  ]);
  const quorum = buildEvmExecutionQuorum({
    profile,
    source,
    observations,
    policy: {
      requireFinalized: true,
      minimumConfirmations: 1,
    },
  });
  const promoted = promoteEvmExecutionWithQuorum(source, quorum);
  if (promoted.state !== "quorum-finalized") {
    throw new Error("expected finalized EVM quorum promotion");
  }
  return { quorum, baseExecution: promoted.transaction };
}

function railgunSubmission() {
  const intent = createRailgunIntent({
    chain: Ethereum,
    txidVersion: "V2_PoseidonMerkle",
    walletId: "wallet-test",
    transfers: [{
      recipient: railgunAddress("0zk1strictrecipient", validateRailgunAddress),
      token: TOKEN,
      amount: 123n,
    }],
    sendWithPublicWallet: true,
  });
  const gas = attachRailgunGasEvidence(intent, {
    gasEstimate: 100_000n,
    overallBatchMinGasPrice: 1n,
  });
  const proof = createRailgunProofEvidence(gas, {
    proofId: "strict-proof",
    generatedAtMs: 1_000,
  });
  const populated = populateRailgunTransaction(proof, "0x1234", 1_100);
  return markRailgunSubmitted(populated, {
    submission: "self",
    submissionId: TX_HASH,
    submittedAtMs: 1_200,
  });
}

test("strict RAILGUN verification requires finalized matching EVM quorum plus proof-bound private state", async () => {
  const submission = railgunSubmission();
  const { quorum, baseExecution } = await baseEvidence();
  const privateState = railgunPrivateStateEvidence({
    proofBindingHash: submission.proof.proofBindingHash,
    source: "wallet-sdk-test",
    assertions: [{
      id: "received-private-token",
      passed: true,
      description: "Expected private balance delta observed.",
    }],
    observedAtMs: 5_000,
  });

  const report = railgunVerificationReportWithEvmQuorum({
    profile,
    submission,
    baseExecution,
    baseQuorum: quorum,
    privateState,
  });
  assert.equal(report.state, "VERIFIED_FINALITY");
  assert.ok(report.evidence.some((entry) => entry.kind === "evm-execution-quorum"));
});

test("strict RAILGUN verification rejects mismatched quorum and failed private-state proof", async () => {
  const submission = railgunSubmission();
  const { quorum, baseExecution } = await baseEvidence();
  const privateState = railgunPrivateStateEvidence({
    proofBindingHash: submission.proof.proofBindingHash,
    source: "wallet-sdk-test",
    assertions: [{
      id: "private-delta",
      passed: true,
      description: "Private state matches.",
    }],
  });

  const wrongQuorum = {
    ...quorum,
    transactionHash: `0x${"bb".repeat(32)}`,
  };
  assert.throws(
    () => railgunVerificationReportWithEvmQuorum({
      profile,
      submission,
      baseExecution,
      baseQuorum: wrongQuorum,
      privateState,
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError
      && (error.diagnostic.code === "ES4771" || error.diagnostic.code === "ES4802"),
  );

  const failingPrivate = railgunPrivateStateEvidence({
    proofBindingHash: submission.proof.proofBindingHash,
    source: "wallet-sdk-test",
    assertions: [{
      id: "private-delta",
      passed: false,
      description: "Private state mismatch.",
    }],
  });
  assert.throws(
    () => railgunVerificationReportWithEvmQuorum({
      profile,
      submission,
      baseExecution,
      baseQuorum: quorum,
      privateState: failingPrivate,
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4562",
  );
});
