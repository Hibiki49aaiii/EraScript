import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SolanaMainnetProfile,
  assertMultichainVerificationState,
  createMultichainSigningRequest,
  multichainEvidenceRef,
  parseMultichainVerificationReport,
  signWithMultichainExternalSigner,
} from "../src/chains/index.js";
import { createMultichainVerificationReport } from "../src/chains/verification.js";

const SIGNER = "11111111111111111111111111111111";

test("multichain external signer response is bound to request payload, context, challenge and TTL", async () => {
  const request = createMultichainSigningRequest({
    profile: SolanaMainnetProfile,
    role: "transaction-signer",
    signer: SIGNER,
    payload: "AQ==",
    payloadEncoding: "base64",
    context: { recentBlockhash: "blockhash", lastValidBlockHeight: "100" },
    nowMs: 1_000,
    ttlMs: 10_000,
    requestId: "abcdef1234567890",
    challenge: "ab".repeat(32),
  });
  const signer = {
    async sign(input: typeof request) {
      return {
        kind: "multichain-signing-response" as const,
        requestId: input.requestId,
        payloadHash: input.payloadHash,
        contextHash: input.contextHash,
        challenge: input.challenge,
        signer: input.signer,
        signature: "signed",
        respondedAtMs: 2_000,
      };
    },
  };
  const verified = await signWithMultichainExternalSigner({ signer, request, verifier: () => true, verifierName: "mock-ed25519", nowMs: 2_000 });
  assert.equal(verified.verified, true);

  const tampered = {
    ...signer,
    async sign(input: typeof request) {
      const response = await signer.sign(input);
      return { ...response, payloadHash: `0x${"00".repeat(32)}` };
    },
  };
  await assert.rejects(
    () => signWithMultichainExternalSigner({ signer: tampered, request, verifier: () => true, verifierName: "mock-ed25519", nowMs: 2_000 }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4536",
  );
});

test("multichain verification report hash binds chain/backend/checks/evidence", () => {
  const evidence = [multichainEvidenceRef("solana-signature-status", { signature: "sig", confirmationStatus: "finalized" }, "rpc")];
  const report = createMultichainVerificationReport({
    profile: SolanaMainnetProfile,
    backend: "public-rpc",
    subject: "transaction:sig",
    state: "VERIFIED_FINALITY",
    checks: [{ id: "solana.finalized", status: "pass", message: "Finalized commitment observed." }],
    evidence,
  });
  assert.equal(parseMultichainVerificationReport(report).verifiedFinality, true);
  assert.doesNotThrow(() => assertMultichainVerificationState(report, "READY_FOR_SUBMISSION"));

  assert.throws(
    () => parseMultichainVerificationReport({ ...report, backend: "jito-bundle" }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4554",
  );
});

test("failed multichain check always collapses report state to NOT_READY", () => {
  const report = createMultichainVerificationReport({
    profile: SolanaMainnetProfile,
    backend: "public-rpc",
    subject: "transaction:sig",
    state: "VERIFIED_FINALITY",
    checks: [{ id: "state.invariant", status: "fail", message: "Expected balance invariant failed." }],
  });
  assert.equal(report.state, "NOT_READY");
  assert.throws(() => assertMultichainVerificationState(report, "READY_FOR_SUBMISSION"), (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4555");
});
