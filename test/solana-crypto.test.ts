import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign as signMessage } from "node:crypto";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SOLANA_ED25519_VERIFIER_NAME,
  SolanaMainnetProfile,
  createMultichainSigningRequest,
  signWithMultichainExternalSigner,
  solanaEd25519SignatureVerifier,
  verifySolanaEd25519SigningResponse,
  type MultichainExternalSigner,
} from "../src/chains/index.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);

  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    encoded = BASE58[remainder]! + encoded;
  }

  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + encoded;
}

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const rawPublicKey = spki.subarray(spki.length - 32);
  const signer = encodeBase58(rawPublicKey);
  const message = Buffer.from("EraScript Solana Ed25519 verifier", "utf8");
  const payload = message.toString("base64");
  const request = createMultichainSigningRequest({
    profile: SolanaMainnetProfile,
    role: "fee-payer",
    signer,
    payload,
    payloadEncoding: "base64",
    context: { kind: "solana-ed25519-test" },
    nowMs: 1_000,
    ttlMs: 60_000,
    requestId: "0123456789abcdef",
    challenge: "ab".repeat(32),
  });

  const signature = encodeBase58(signMessage(null, message, privateKey));
  return { request, signature, signer, privateKey, message };
}

test("built-in Solana verifier validates an actual Ed25519 signature over exact message bytes", async () => {
  const { request, signature, signer } = fixture();
  const externalSigner: MultichainExternalSigner = {
    async sign(value) {
      return {
        kind: "multichain-signing-response",
        requestId: value.requestId,
        payloadHash: value.payloadHash,
        contextHash: value.contextHash,
        challenge: value.challenge,
        signer,
        signature,
        signedPayload: value.payload,
        respondedAtMs: value.createdAtMs,
      };
    },
  };

  const verified = await signWithMultichainExternalSigner({
    signer: externalSigner,
    request,
    verifier: solanaEd25519SignatureVerifier,
    verifierName: SOLANA_ED25519_VERIFIER_NAME,
    nowMs: request.createdAtMs,
  });

  assert.equal(verified.verified, true);
  assert.equal(verified.verifier, SOLANA_ED25519_VERIFIER_NAME);
});

test("built-in Solana verifier rejects signature/message and signer mismatches", async () => {
  const { request, signature, privateKey } = fixture();

  const wrongMessage = Buffer.from("different message", "utf8");
  const wrongSignature = encodeBase58(signMessage(null, wrongMessage, privateKey));
  assert.equal(verifySolanaEd25519SigningResponse({
    request,
    response: {
      kind: "multichain-signing-response",
      requestId: request.requestId,
      payloadHash: request.payloadHash,
      contextHash: request.contextHash,
      challenge: request.challenge,
      signer: request.signer,
      signature: wrongSignature,
      respondedAtMs: request.createdAtMs,
    },
  }), false);

  assert.equal(verifySolanaEd25519SigningResponse({
    request,
    response: {
      kind: "multichain-signing-response",
      requestId: request.requestId,
      payloadHash: request.payloadHash,
      contextHash: request.contextHash,
      challenge: request.challenge,
      signer: request.signer,
      signature,
      signedPayload: Buffer.from("tampered", "utf8").toString("base64"),
      respondedAtMs: request.createdAtMs,
    },
  }), false);

  const externalSigner: MultichainExternalSigner = {
    async sign(value) {
      return {
        kind: "multichain-signing-response",
        requestId: value.requestId,
        payloadHash: value.payloadHash,
        contextHash: value.contextHash,
        challenge: value.challenge,
        signer: value.signer,
        signature: wrongSignature,
        respondedAtMs: value.createdAtMs,
      };
    },
  };

  await assert.rejects(
    () => signWithMultichainExternalSigner({
      signer: externalSigner,
      request,
      verifier: solanaEd25519SignatureVerifier,
      verifierName: SOLANA_ED25519_VERIFIER_NAME,
      nowMs: request.createdAtMs,
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4540",
  );
});
