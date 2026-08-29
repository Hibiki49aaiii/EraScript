import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SolanaMainnetProfile,
  assertSolanaExecutionQuorumIntegrity,
  bindSolanaExecutionVerifier,
  buildSolanaExecutionQuorum,
  createJitoBundle,
  jitoBundleVerificationReportWithSolanaQuorum,
  jitoTip,
  lamports,
  observeSolanaExecutionWithProvider,
  prepareSolanaSerializedTransaction,
  readJitoBundleStatus,
  readJitoTipAccounts,
  solanaBlockhash,
  solanaQuorumVerificationReport,
  solanaRecentBlockhash,
  solanaTransactionSignature,
  submitJitoBundle,
  verifyJitoBundleTip,
  verifySolanaSerializedTransaction,
  type SolanaExecutionQuorum,
  type SolanaKitClientLike,
  type SolanaSubmittedTransaction,
} from "../src/chains/index.js";

const BLOCKHASH = "1".repeat(32);
const BLOCKHASH_2 = "So11111111111111111111111111111111111111112";
const SIGNATURE = "1".repeat(64);
const TX_BASE64 = "AQ==";

async function submitted(): Promise<SolanaSubmittedTransaction> {
  const recent = solanaRecentBlockhash({
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 500n,
    observedBlockHeight: 100n,
  });
  const prepared = prepareSolanaSerializedTransaction({
    profile: SolanaMainnetProfile,
    serializedBase64: TX_BASE64,
    recentBlockhash: recent,
  });
  const verified = await verifySolanaSerializedTransaction(
    prepared,
    async () => ({
      version: 0,
      recentBlockhash: solanaBlockhash(BLOCKHASH),
      signerCount: 1,
    }),
  );
  const ready = {
    ...verified,
    signatureAssemblyVerified: true as const,
    signatureEvidenceHash: `0x${"aa".repeat(32)}`,
    evidenceBindings: [],
  };
  return {
    state: "solana-submitted",
    simulation: {
      state: "solana-simulated",
      transaction: ready,
      commitment: "confirmed",
      signatureVerification: true,
      success: true,
      logs: [],
      simulatedAtBlockHeight: 101n,
    },
    signature: solanaTransactionSignature(SIGNATURE),
    submittedAtBlockHeight: 102n,
  };
}

type SolanaQuorumTestClient = SolanaKitClientLike & {
  readonly rpc: SolanaKitClientLike["rpc"] & {
    readonly getBlock: (
      slot: bigint,
      config?: Record<string, unknown>,
    ) => { send(): Promise<unknown> };
  };
};

function client(input: {
  slot?: bigint;
  commitment?: "processed" | "confirmed" | "finalized";
  err?: unknown;
  found?: boolean;
  blockhash?: string;
  throwStatus?: boolean;
} = {}): SolanaQuorumTestClient {
  return {
    rpc: {
      getSignatureStatuses: () => ({
        send: async () => {
          if (input.throwStatus) throw new Error("provider secret endpoint failure");
          if (input.found === false) return { value: [null] };
          return {
            value: [{
              slot: input.slot ?? 200n,
              confirmations:
                (input.commitment ?? "finalized") === "finalized" ? null : 1n,
              confirmationStatus: input.commitment ?? "finalized",
              err: input.err ?? null,
            }],
          };
        },
      }),
      getBlock: (slot: bigint) => ({
        send: async () => ({
          blockhash: input.blockhash ?? BLOCKHASH_2,
          blockHeight: slot,
        }),
      }),
    },
  };
}

test("Solana strict quorum is deterministic across provider order and produces finalized report", async () => {
  const source = await submitted();
  const [aVerifier, bVerifier] = await Promise.all([
    bindSolanaExecutionVerifier({
      profile: SolanaMainnetProfile,
      providerId: "solana-a",
      client: client(),
    }),
    bindSolanaExecutionVerifier({
      profile: SolanaMainnetProfile,
      providerId: "solana-b",
      client: client(),
    }),
  ]);
  const [a, b] = await Promise.all([
    observeSolanaExecutionWithProvider(aVerifier, source, {
      observeBlockIdentity: true,
      observedAtMs: 1_000,
    }),
    observeSolanaExecutionWithProvider(bVerifier, source, {
      observeBlockIdentity: true,
      observedAtMs: 1_001,
    }),
  ]);
  const left = buildSolanaExecutionQuorum({
    profile: SolanaMainnetProfile,
    source,
    observations: [a, b],
    policy: { minimumCommitment: "finalized", requireBlockIdentity: true },
  });
  const right = buildSolanaExecutionQuorum({
    profile: SolanaMainnetProfile,
    source,
    observations: [b, a],
    policy: { minimumCommitment: "finalized", requireBlockIdentity: true },
  });

  assert.equal(left.quorumHash, right.quorumHash);
  assert.equal(left.stage, "finalized");
  assert.doesNotThrow(() => assertSolanaExecutionQuorumIntegrity(left));

  const report = solanaQuorumVerificationReport(
    SolanaMainnetProfile,
    source,
    left,
  );
  assert.equal(report.state, "VERIFIED_FINALITY");
});

test("Solana quorum fails closed for missing status, execution error, slot conflict and insufficient commitment", async () => {
  const source = await submitted();
  const make = async (id: string, options: Parameters<typeof client>[0]) =>
    bindSolanaExecutionVerifier({
      profile: SolanaMainnetProfile,
      providerId: id,
      client: client(options),
    });

  const ok = await make("solana-ok", {});
  const missing = await make("solana-missing", { found: false });
  const failed = await make("solana-failed", { err: { InstructionError: [0, "Custom"] } });
  const otherSlot = await make("solana-slot", { slot: 201n });
  const confirmed = await make("solana-confirmed", { commitment: "confirmed" });

  const okObs = await observeSolanaExecutionWithProvider(ok, source);

  for (const [verifier, code] of [
    [missing, "ES4783"],
    [failed, "ES4784"],
  ] as const) {
    const observation = await observeSolanaExecutionWithProvider(verifier, source);
    assert.throws(
      () => buildSolanaExecutionQuorum({
        profile: SolanaMainnetProfile,
        source,
        observations: [okObs, observation],
      }),
      (error: unknown) =>
        error instanceof EraDiagnosticError && error.diagnostic.code === code,
    );
  }

  const slotObs = await observeSolanaExecutionWithProvider(otherSlot, source);
  assert.throws(
    () => buildSolanaExecutionQuorum({
      profile: SolanaMainnetProfile,
      source,
      observations: [okObs, slotObs],
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4787",
  );

  const confirmedObs = await observeSolanaExecutionWithProvider(confirmed, source);
  assert.throws(
    () => buildSolanaExecutionQuorum({
      profile: SolanaMainnetProfile,
      source,
      observations: [okObs, confirmedObs],
      policy: { minimumCommitment: "finalized" },
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4785",
  );
});

test("Solana observation and quorum tampering are rejected", async () => {
  const source = await submitted();
  const [va, vb] = await Promise.all([
    bindSolanaExecutionVerifier({ profile: SolanaMainnetProfile, providerId: "a", client: client() }),
    bindSolanaExecutionVerifier({ profile: SolanaMainnetProfile, providerId: "b", client: client() }),
  ]);
  const [a, b] = await Promise.all([
    observeSolanaExecutionWithProvider(va, source),
    observeSolanaExecutionWithProvider(vb, source),
  ]);
  const tamperedObservation = { ...b, slot: 999n };
  assert.throws(
    () => buildSolanaExecutionQuorum({
      profile: SolanaMainnetProfile,
      source,
      observations: [a, tamperedObservation],
    }),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4789",
  );

  const quorum = buildSolanaExecutionQuorum({
    profile: SolanaMainnetProfile,
    source,
    observations: [a, b],
  });
  const tamperedQuorum = {
    ...quorum,
    minimumProviders: quorum.minimumProviders + 1,
  } as SolanaExecutionQuorum;
  assert.throws(
    () => assertSolanaExecutionQuorumIntegrity(tamperedQuorum),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4789",
  );
});

test("strict Jito finality requires finalized Solana quorum for every expected transaction signature", async () => {
  const source = await submitted();
  const [va, vb] = await Promise.all([
    bindSolanaExecutionVerifier({ profile: SolanaMainnetProfile, providerId: "a", client: client() }),
    bindSolanaExecutionVerifier({ profile: SolanaMainnetProfile, providerId: "b", client: client() }),
  ]);
  const observations = await Promise.all([
    observeSolanaExecutionWithProvider(va, source),
    observeSolanaExecutionWithProvider(vb, source),
  ]);
  const quorum = buildSolanaExecutionQuorum({
    profile: SolanaMainnetProfile,
    source,
    observations,
    policy: { minimumCommitment: "finalized" },
  });

  const tip = jitoTip({
    account: BLOCKHASH,
    lamports: lamports(1_000n),
    transactionIndex: 0,
  });
  const draft = createJitoBundle({
    profile: SolanaMainnetProfile,
    transactionsBase64: [TX_BASE64],
    expectedSignatures: [SIGNATURE],
    tip,
  });
  const relay = {
    async request<Result>(method: string): Promise<Result> {
      if (method === "getTipAccounts") return [BLOCKHASH] as Result;
      if (method === "sendBundle") return "bundle-v10" as Result;
      if (method === "getBundleStatuses") {
        return {
          value: [{
            bundle_id: "bundle-v10",
            slot: 200n,
            confirmation_status: "confirmed",
            transactions: [SIGNATURE],
            err: null,
          }],
        } as Result;
      }
      throw new Error(method);
    },
  };
  const tips = await readJitoTipAccounts(relay);
  const verified = await verifyJitoBundleTip(draft, tips, async () => ({
    tipTransfers: [{ recipient: BLOCKHASH, lamports: 1_000n }],
    tipAccountResolvedViaAddressLookupTable: false,
  }));
  const bundle = await submitJitoBundle(relay, verified);
  const status = await readJitoBundleStatus(relay, bundle);

  const report = jitoBundleVerificationReportWithSolanaQuorum(
    SolanaMainnetProfile,
    bundle,
    status,
    [quorum],
  );
  assert.equal(report.state, "VERIFIED_FINALITY");

  assert.throws(
    () => jitoBundleVerificationReportWithSolanaQuorum(
      SolanaMainnetProfile,
      bundle,
      status,
      [],
    ),
    (error: unknown) =>
      error instanceof EraDiagnosticError && error.diagnostic.code === "ES4801",
  );
});
