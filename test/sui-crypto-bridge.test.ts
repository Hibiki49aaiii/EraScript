import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SUI_SDK_TRANSACTION_VERIFIER_NAME,
  SuiMainnetProfile,
  createMultichainSigningRequest,
  createSuiSdkTransactionSignatureVerifier,
  signWithMultichainExternalSigner,
  type MultichainExternalSigner,
} from "../src/chains/index.js";

const SUI_ADDRESS = `0x${"11".repeat(32)}`;
const TX_BYTES = Uint8Array.from([1, 2, 3, 4]);
const TX_BASE64 = Buffer.from(TX_BYTES).toString("base64");
const SIGNATURE = "serialized-sui-signature";

function request() {
  return createMultichainSigningRequest({
    profile: SuiMainnetProfile,
    role: "sender",
    signer: SUI_ADDRESS,
    payload: TX_BASE64,
    payloadEncoding: "base64",
    context: { kind: "sui-transaction-signature-test" },
    nowMs: 1_000,
    ttlMs: 60_000,
    requestId: "0123456789abcdef",
    challenge: "ab".repeat(32),
  });
}

function signer(signature = SIGNATURE): MultichainExternalSigner {
  return {
    async sign(value) {
      return {
        kind: "multichain-signing-response",
        requestId: value.requestId,
        payloadHash: value.payloadHash,
        contextHash: value.contextHash,
        challenge: value.challenge,
        signer: value.signer,
        signature,
        signedPayload: value.payload,
        respondedAtMs: value.createdAtMs,
      };
    },
  };
}

test("Sui SDK bridge verifies exact transaction bytes and signer address", async () => {
  const signingRequest = request();
  const client = { name: "mock-sui-client" };
  let called = 0;
  const verifier = createSuiSdkTransactionSignatureVerifier({
    client,
    async isValidTransactionSignature(transaction, signature, options) {
      called += 1;
      assert.deepEqual([...transaction], [...TX_BYTES]);
      assert.equal(signature, SIGNATURE);
      assert.equal(options?.address, SUI_ADDRESS);
      assert.equal(options?.client, client);
      return true;
    },
  });

  const verified = await signWithMultichainExternalSigner({
    signer: signer(),
    request: signingRequest,
    verifier,
    verifierName: SUI_SDK_TRANSACTION_VERIFIER_NAME,
    nowMs: signingRequest.createdAtMs,
  });

  assert.equal(called, 1);
  assert.equal(verified.verified, true);
  assert.equal(verified.verifier, SUI_SDK_TRANSACTION_VERIFIER_NAME);
});

test("Sui SDK bridge converts cryptographic false into the common ES4540 gate", async () => {
  const signingRequest = request();
  const verifier = createSuiSdkTransactionSignatureVerifier({
    async isValidTransactionSignature() {
      return false;
    },
  });

  await assert.rejects(
    () => signWithMultichainExternalSigner({
      signer: signer("bad-signature"),
      request: signingRequest,
      verifier,
      verifierName: SUI_SDK_TRANSACTION_VERIFIER_NAME,
      nowMs: signingRequest.createdAtMs,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4540",
  );
});

test("Sui SDK environmental verification failures remain distinguishable from invalid signatures", async () => {
  const signingRequest = request();
  const verifier = createSuiSdkTransactionSignatureVerifier({
    async isValidTransactionSignature() {
      throw new Error("zkLogin JWK lookup unavailable");
    },
  });

  await assert.rejects(
    () => signWithMultichainExternalSigner({
      signer: signer(),
      request: signingRequest,
      verifier,
      verifierName: SUI_SDK_TRANSACTION_VERIFIER_NAME,
      nowMs: signingRequest.createdAtMs,
    }),
    /zkLogin JWK lookup unavailable/,
  );
});
