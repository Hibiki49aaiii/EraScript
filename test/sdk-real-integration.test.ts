import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { isValidTransactionSignature } from "@mysten/sui/verify";
import {
  SUI_SDK_TRANSACTION_VERIFIER_NAME,
  SuiMainnetProfile,
  createMultichainSigningRequest,
  createSolanaKitEraInspectors,
  createSuiSdkTransactionSignatureVerifier,
  signWithMultichainExternalSigner,
  type MultichainExternalSigner,
} from "../src/chains/index.js";

const SOLANA_V0_FIXTURE =
  "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABlyfqJ5qvbi2J5r1hDgkimf7xAsjcGduDtpu9zfTn8MGyAgMBmLTJ6VrW508Eg1xWkND+TiiPuCPuCPuCPuCPugAIBAQMPHmsUIcBKBwQxJlwZxbvuGZK66K/RzQeO+K9wR9wR9y1bQTxlQN4VDJNzFE1RM8pMuDC6D3VnFqzqDlDXlDXlPHmsUIcBKBwQxJlwZxbvuGZK66K/RzQeO+K9wR9wR9wePNYoQ4CUDghiTLgzi3fcMyV10V+jmg8d8V7gj7gj7gECAQEAAA==";

test("@solana/kit 8.1 codecs plug directly into the EraScript inspector bridge", async () => {
  const bridge = createSolanaKitEraInspectors({
    transactionDecoder: getTransactionDecoder(),
    messageDecoder: getCompiledTransactionMessageDecoder(),
  });

  const wire = Buffer.from(SOLANA_V0_FIXTURE, "base64");
  const runtime = await bridge.transactionInspector(wire);
  assert.equal(runtime.version, 0);
  assert.equal(runtime.recentBlockhash, "33333333333333333333333333333333333333333333");
  assert.equal(runtime.signerCount, 2);

  const signing = await bridge.signingInspector(wire);
  assert.equal(signing.feePayer, "22222222222222222222222222222222222222222222");
  assert.deepEqual(signing.requiredSigners, [
    "22222222222222222222222222222222222222222222",
    "44444444444444444444444444444444444444444444",
  ]);
  assert.ok(Buffer.from(signing.signingPayloadBase64, "base64").length > 0);
});

test("@mysten/sui 2.27 verifies an actual TransactionData-intent signature through EraScript", async () => {
  const keypair = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const address = keypair.toSuiAddress();
  const transactionBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const signed = await keypair.signTransaction(transactionBytes);

  assert.equal(
    await isValidTransactionSignature(transactionBytes, signed.signature, { address }),
    true,
  );

  const request = createMultichainSigningRequest({
    profile: SuiMainnetProfile,
    role: "sender",
    signer: address,
    payload: Buffer.from(transactionBytes).toString("base64"),
    payloadEncoding: "base64",
    context: { kind: "real-mysten-sui-2.27-integration" },
    nowMs: 1_000,
    ttlMs: 60_000,
    requestId: "0123456789abcdef",
    challenge: "ab".repeat(32),
  });

  const externalSigner: MultichainExternalSigner = {
    async sign(value) {
      return {
        kind: "multichain-signing-response",
        requestId: value.requestId,
        payloadHash: value.payloadHash,
        contextHash: value.contextHash,
        challenge: value.challenge,
        signer: value.signer,
        signature: signed.signature,
        signedPayload: signed.bytes,
        respondedAtMs: value.createdAtMs,
      };
    },
  };

  const verifier = createSuiSdkTransactionSignatureVerifier({
    isValidTransactionSignature,
  });

  const verified = await signWithMultichainExternalSigner({
    signer: externalSigner,
    request,
    verifier,
    verifierName: SUI_SDK_TRANSACTION_VERIFIER_NAME,
    nowMs: request.createdAtMs,
  });

  assert.equal(verified.verified, true);
  assert.equal(verified.response.signer, address);
});
