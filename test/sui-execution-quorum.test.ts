import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SuiMainnetProfile,
  assertSuiExecutionQuorumIntegrity,
  bindSuiExecutionVerifier,
  buildSuiExecutionQuorum,
  executeSuiTransaction,
  observeSuiExecutionWithProvider,
  prepareSuiTransaction,
  simulateSuiPreparedTransaction,
  suiQuorumVerificationReport,
  verifySuiSerializedTransaction,
  type SuiClientLike,
  type SuiExecutedTransaction,
  type SuiExecutionQuorum,
} from "../src/chains/index.js";

const DIGEST = "1".repeat(32);
const OTHER_DIGEST = "2".repeat(32);
const ADDRESS = `0x${"11".repeat(32)}`;
const TX_BASE64 = "AQ==";

async function executed(): Promise<SuiExecutedTransaction> {
  const prepared = prepareSuiTransaction({
    profile: SuiMainnetProfile,
    sender: ADDRESS,
    serializedBase64: TX_BASE64,
  });
  const verified = await verifySuiSerializedTransaction(
    prepared,
    async () => ({
      sender: ADDRESS,
      gasOwner: ADDRESS,
      gasBudget: 1_000n,
      gasPrice: 1n,
      commandCount: 1,
    }),
  );
  const sourceClient: SuiClientLike = {
    network: "mainnet",
    async simulateTransaction() {
      return {
        Transaction: {
          digest: DIGEST,
          status: { success: true },
          balanceChanges: [],
          commandResults: [],
        },
      };
    },
    async executeTransaction() {
      return {
        Transaction: {
          digest: DIGEST,
          status: { success: true },
          checkpoint: 77n,
          effects: { digest: "effects-77", checkpoint: 77n },
        },
      };
    },
  };
  const simulation = await simulateSuiPreparedTransaction(sourceClient, verified);
  const result = await executeSuiTransaction(sourceClient, simulation, ["signature"]);
  if (result.state !== "sui-executed") throw new Error("expected Sui execution success");
  return result;
}

function client(input: {
  digest?: string;
  checkpoint?: bigint;
  effectsDigest?: string;
  failed?: boolean;
  unavailable?: boolean;
} = {}): SuiClientLike {
  return {
    network: "mainnet",
    async getTransaction() {
      if (input.unavailable) throw new Error("provider endpoint secret failure");
      if (input.failed) {
        return {
          FailedTransaction: {
            digest: input.digest ?? DIGEST,
            status: { success: false, error: "MoveAbort" },
          },
        };
      }
      return {
        Transaction: {
          digest: input.digest ?? DIGEST,
          status: { success: true },
          checkpoint: input.checkpoint ?? 77n,
          effects: {
            digest: input.effectsDigest ?? "effects-77",
            checkpoint: input.checkpoint ?? 77n,
          },
        },
      };
    },
  };
}

test("Sui strict quorum is deterministic and produces checkpoint finality", async () => {
  const source = await executed();
  const [va, vb] = await Promise.all([
    bindSuiExecutionVerifier({
      profile: SuiMainnetProfile,
      providerId: "sui-a",
      client: client(),
    }),
    bindSuiExecutionVerifier({
      profile: SuiMainnetProfile,
      providerId: "sui-b",
      client: client(),
    }),
  ]);
  const [a, b] = await Promise.all([
    observeSuiExecutionWithProvider(va, source, { observedAtMs: 1_000 }),
    observeSuiExecutionWithProvider(vb, source, { observedAtMs: 1_001 }),
  ]);

  const left = buildSuiExecutionQuorum({
    profile: SuiMainnetProfile,
    source,
    observations: [a, b],
    policy: { requireCheckpoint: true, requireEffectsIdentity: true },
  });
  const right = buildSuiExecutionQuorum({
    profile: SuiMainnetProfile,
    source,
    observations: [b, a],
    policy: { requireCheckpoint: true, requireEffectsIdentity: true },
  });

  assert.equal(left.quorumHash, right.quorumHash);
  assert.equal(left.stage, "checkpointed");
  assert.equal(left.checkpoint, 77n);
  assert.doesNotThrow(() => assertSuiExecutionQuorumIntegrity(left));

  const report = suiQuorumVerificationReport(SuiMainnetProfile, source, left);
  assert.equal(report.state, "VERIFIED_FINALITY");
});

test("Sui quorum fails closed for unavailable, failed, digest, effects and checkpoint disagreement", async () => {
  const source = await executed();
  const okVerifier = await bindSuiExecutionVerifier({
    profile: SuiMainnetProfile,
    providerId: "sui-ok",
    client: client(),
  });
  const ok = await observeSuiExecutionWithProvider(okVerifier, source);

  const cases = [
    [{ unavailable: true }, "ES4793"],
    [{ failed: true }, "ES4795"],
    [{ digest: OTHER_DIGEST }, "ES4794"],
    [{ effectsDigest: "effects-other" }, "ES4796"],
    [{ checkpoint: 78n }, "ES4797"],
  ] as const;

  for (const [options, code] of cases) {
    const verifier = await bindSuiExecutionVerifier({
      profile: SuiMainnetProfile,
      providerId: `sui-${code}`,
      client: client(options),
    });
    const observation = await observeSuiExecutionWithProvider(verifier, source);
    assert.throws(
      () => buildSuiExecutionQuorum({
        profile: SuiMainnetProfile,
        source,
        observations: [ok, observation],
        policy: { requireCheckpoint: true, requireEffectsIdentity: true },
      }),
      (error: unknown) =>
        error instanceof EraDiagnosticError && error.diagnostic.code === code,
    );
  }
});

test("Sui observation and quorum tampering are rejected", async () => {
  const source = await executed();
  const [va, vb] = await Promise.all([
    bindSuiExecutionVerifier({
      profile: SuiMainnetProfile,
      providerId: "sui-a",
      client: client(),
    }),
    bindSuiExecutionVerifier({
      profile: SuiMainnetProfile,
      providerId: "sui-b",
      client: client(),
    }),
  ]);
  const [a, b] = await Promise.all([
    observeSuiExecutionWithProvider(va, source),
    observeSuiExecutionWithProvider(vb, source),
  ]);

  const tamperedObservation = { ...b, checkpoint: 999n };
  assert.throws(
    () => buildSuiExecutionQuorum({
      profile: SuiMainnetProfile,
      source,
      observations: [a, tamperedObservation],
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4799",
  );

  const quorum = buildSuiExecutionQuorum({
    profile: SuiMainnetProfile,
    source,
    observations: [a, b],
  });
  const tamperedQuorum = {
    ...quorum,
    requireCheckpoint: false,
  } as SuiExecutionQuorum;
  assert.throws(
    () => assertSuiExecutionQuorumIntegrity(tamperedQuorum),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4799",
  );
});
