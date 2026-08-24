import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SolanaMainnetProfile,
  SuiMainnetProfile,
  assembleAndVerifySolanaSignedTransaction,
  bindSolanaVerifiedSignatures,
  bindSuiSponsoredSignatures,
  createSolanaSigningPlan,
  createSolanaSigningRequests,
  createSuiSponsoredSigningPlan,
  createSuiSponsoredSigningRequests,
  prepareSolanaSerializedTransaction,
  prepareSuiTransaction,
  signWithMultichainExternalSigner,
  solanaBlockhash,
  solanaRecentBlockhash,
  verifySolanaSerializedTransaction,
  verifySuiSerializedTransaction,
  type MultichainExternalSigner,
  type MultichainSigningRequest,
  type VerifiedMultichainSignature,
} from "../src/chains/index.js";

const SOL_FEE_PAYER = "11111111111111111111111111111111";
const SOL_SECOND_SIGNER = "So11111111111111111111111111111111111111112";
const SOL_BLOCKHASH = "1".repeat(32);
const SUI_SENDER = `0x${"11".repeat(32)}`;
const SUI_SPONSOR = `0x${"22".repeat(32)}`;
const TX_BASE64 = "AQ==";
const SIGNED_TX_BASE64 = "Aw==";
const MESSAGE_BASE64 = "Ag==";
const TAMPERED_MESSAGE_BASE64 = "BA==";

async function verifiedSignature(request: MultichainSigningRequest): Promise<VerifiedMultichainSignature> {
  const signer: MultichainExternalSigner = {
    async sign(value) {
      return {
        kind: "multichain-signing-response",
        requestId: value.requestId,
        payloadHash: value.payloadHash,
        contextHash: value.contextHash,
        challenge: value.challenge,
        signer: value.signer,
        signature: `sig:${value.signer}`,
        respondedAtMs: value.createdAtMs,
      };
    },
  };
  return signWithMultichainExternalSigner({ signer, request, verifier: async () => true, verifierName: "test-verifier", nowMs: request.createdAtMs });
}

async function solanaFixture() {
  const recent = solanaRecentBlockhash({ blockhash: SOL_BLOCKHASH, lastValidBlockHeight: 150n, observedBlockHeight: 100n });
  const prepared = prepareSolanaSerializedTransaction({ profile: SolanaMainnetProfile, serializedBase64: TX_BASE64, recentBlockhash: recent });
  const verified = await verifySolanaSerializedTransaction(prepared, async () => ({ version: 0, recentBlockhash: solanaBlockhash(SOL_BLOCKHASH), signerCount: 2 }));
  const signingInspector = async () => ({ signingPayloadBase64: MESSAGE_BASE64, requiredSigners: [SOL_FEE_PAYER, SOL_SECOND_SIGNER], feePayer: SOL_FEE_PAYER });
  const plan = await createSolanaSigningPlan(SolanaMainnetProfile, verified, signingInspector);
  const requests = createSolanaSigningRequests(SolanaMainnetProfile, plan, { nowMs: 1_000, ttlMs: 60_000 });
  const signatures = await Promise.all(requests.map((entry) => verifiedSignature(entry.request)));
  const evidence = bindSolanaVerifiedSignatures(plan, requests, signatures);
  return { verified, signingInspector, plan, requests, evidence };
}

test("Solana signing plan binds every required signer to the exact decoded message bytes", async () => {
  const { verified, plan, requests, evidence } = await solanaFixture();
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.role, "fee-payer");
  assert.equal(requests[1]!.role, "transaction-signer");
  assert.equal(requests[0]!.request.payload, MESSAGE_BASE64);
  assert.equal(requests[1]!.request.payload, MESSAGE_BASE64);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.signatures.length, 2);

  await assert.rejects(
    () => createSolanaSigningPlan(SolanaMainnetProfile, verified, async () => ({ signingPayloadBase64: MESSAGE_BASE64, requiredSigners: [SOL_SECOND_SIGNER, SOL_FEE_PAYER], feePayer: SOL_FEE_PAYER })),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4585",
  );
  assert.equal(plan.feePayer, SOL_FEE_PAYER);
});

test("Solana final wire assembly must preserve the exact signed message and signer set", async () => {
  const { verified, signingInspector, evidence } = await solanaFixture();
  const transactionInspector = async () => ({ version: 0 as const, recentBlockhash: solanaBlockhash(SOL_BLOCKHASH), signerCount: 2 });
  const assembled = await assembleAndVerifySolanaSignedTransaction({
    profile: SolanaMainnetProfile,
    source: verified,
    signatureSet: evidence,
    assembler: {
      async assemble({ signatures }) {
        assert.equal(signatures.length, 2);
        return SIGNED_TX_BASE64;
      },
    },
    transactionInspector,
    signingInspector,
  });
  assert.equal(assembled.transaction.inspectionVerified, true);
  assert.equal(assembled.transaction.serializedBase64, SIGNED_TX_BASE64);

  await assert.rejects(
    () => assembleAndVerifySolanaSignedTransaction({
      profile: SolanaMainnetProfile,
      source: verified,
      signatureSet: evidence,
      assembler: { async assemble() { return SIGNED_TX_BASE64; } },
      transactionInspector,
      signingInspector: async () => ({ signingPayloadBase64: TAMPERED_MESSAGE_BASE64, requiredSigners: [SOL_FEE_PAYER, SOL_SECOND_SIGNER], feePayer: SOL_FEE_PAYER }),
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4632",
  );
});

test("Sui sponsorship requires sender and gas owner to authorize identical final transaction bytes", async () => {
  const prepared = prepareSuiTransaction({ profile: SuiMainnetProfile, sender: SUI_SENDER, gasOwner: SUI_SPONSOR, serializedBase64: TX_BASE64 });
  const verified = await verifySuiSerializedTransaction(prepared, async () => ({ sender: SUI_SENDER, gasOwner: SUI_SPONSOR, gasBudget: 1_000n, gasPrice: 1n, commandCount: 1 }));
  const plan = createSuiSponsoredSigningPlan(SuiMainnetProfile, verified);
  const requests = createSuiSponsoredSigningRequests(SuiMainnetProfile, plan, { nowMs: 2_000, ttlMs: 60_000 });
  assert.equal(requests.senderRequest.payload, TX_BASE64);
  assert.equal(requests.sponsorRequest.payload, TX_BASE64);
  const senderSignature = await verifiedSignature(requests.senderRequest);
  const sponsorSignature = await verifiedSignature(requests.sponsorRequest);
  const evidence = bindSuiSponsoredSignatures(requests, { senderSignature, sponsorSignature });
  assert.equal(evidence.exactPayloadMatch, true);
  assert.equal(evidence.plan.sender, SUI_SENDER);
  assert.equal(evidence.plan.sponsor, SUI_SPONSOR);

  assert.throws(
    () => bindSuiSponsoredSignatures(requests, { senderSignature, sponsorSignature: senderSignature }),
    (error: unknown) => error instanceof EraDiagnosticError && (error.diagnostic.code === "ES4572" || error.diagnostic.code === "ES4573"),
  );
});
