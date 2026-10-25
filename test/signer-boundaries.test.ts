import assert from "node:assert/strict";
import test from "node:test";
import { parseSignature, signatureToCompactSignature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EraDiagnosticError } from "../src/diagnostics.js";
import { createMultichainSigningRequest, signWithMultichainExternalSigner, type MultichainSigningRequest, type MultichainSigningResponse } from "../src/chains/external-signer.js";
import { SolanaMainnetProfile } from "../src/chains/profiles.js";
import { Ethereum, address, externalSignerCapability, signTypedDataWithExternalSigner, signSimulatedWithExternalSigner, typedDataEnvelope, typedDataDigest, gas, nonce, maxFeePerGas, maxPriorityFeePerGas, type ExternalSigner, type SimulatedTx, type WeiPerGas } from "../src/web3/index.js";

const hasCode = (code: string) => (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === code;
const request = () => createMultichainSigningRequest({ profile: SolanaMainnetProfile, role: "transaction-signer", signer: "test-identity", payload: "AQ==", payloadEncoding: "base64", context: { purpose: "offline-test" }, nowMs: 1_000, ttlMs: 60_000 });
const response = (req: MultichainSigningRequest): MultichainSigningResponse => ({ kind: "multichain-signing-response", requestId: req.requestId, payloadHash: req.payloadHash, contextHash: req.contextHash, challenge: req.challenge, signer: req.signer, signature: "inert-test-signature", respondedAtMs: req.createdAtMs });

test("multichain signer rechecks actual clock after signer and verifier awaits", async () => {
  for (const phase of ["sign", "verify"] as const) {
    let now = 1_000;
    const req = request();
    await assert.rejects(signWithMultichainExternalSigner({ request: req, clock: () => now, verifierName: "test", signer: { async sign(r) { if (phase === "sign") now = r.expiresAtMs; return response(r); } }, verifier: async () => { now = req.expiresAtMs; return true; } }), hasCode("ES4535"));
  }
});

test("multichain signer validates expiry, future creation, payload hash and encoding before callback", async () => {
  let called = false;
  const req = request();
  for (const [bad, code] of [
    [{ ...req, expiresAtMs: 1_000 }, "ES4532"],
    [{ ...req, createdAtMs: 2_000 }, "ES4535"],
    [{ ...req, payload: "Ag==" }, "ES4900"],
    [{ ...req, payloadEncoding: "other" }, "ES4530"],
  ] as const) {
    await assert.rejects(signWithMultichainExternalSigner({ request: bad as MultichainSigningRequest, nowMs: 1_000, verifierName: "test", signer: { async sign(r) { called = true; return response(r); } }, verifier: () => true }), hasCode(code));
  }
  assert.equal(called, false);
});

test("request ID and challenge are consumed before callback, including failures", async () => {
  const req = request();
  let release!: (value: MultichainSigningResponse) => void;
  let calls = 0;
  const input = { request: req, nowMs: 1_000, verifierName: "test", signer: { sign() { calls++; return new Promise<MultichainSigningResponse>((resolve) => { release = resolve; }); } }, verifier: () => true };
  const first = signWithMultichainExternalSigner(input);
  await assert.rejects(signWithMultichainExternalSigner(input), hasCode("ES4901"));
  release(response(req));
  assert.equal((await first).verified, true);
  await assert.rejects(signWithMultichainExternalSigner({ ...input, request: { ...request(), challenge: req.challenge } }), hasCode("ES4901"));
  assert.equal(calls, 1);
  const failed = { ...input, request: request(), signer: { async sign(): Promise<MultichainSigningResponse> { throw new Error("inert offline failure"); } } };
  await assert.rejects(signWithMultichainExternalSigner(failed), /inert offline failure/);
  await assert.rejects(signWithMultichainExternalSigner(failed), hasCode("ES4901"));
});

test("mutating caller request/response cannot rewrite the verified result", async () => {
  const req = { ...request() };
  let original!: MultichainSigningResponse;
  const result = await signWithMultichainExternalSigner({ request: req, nowMs: 1_000, verifierName: "test", signer: { async sign(r) { assert.ok(Object.isFrozen(r)); req.payload = "Ag=="; original = response(r); return original; } }, verifier: ({ request: r, response: s }) => { assert.equal(r.payload, "AQ=="); assert.ok(Object.isFrozen(s)); return true; } });
  (original as { signature: string }).signature = "changed";
  assert.equal(result.request.payload, "AQ==");
  assert.equal(result.response.signature, "inert-test-signature");
  assert.ok(Object.isFrozen(result));
});

test("a hanging signer cannot hold a request open beyond its TTL", async () => {
  const req = createMultichainSigningRequest({ profile: SolanaMainnetProfile, role: "sender", signer: "offline-hang", payload: "AQ==", payloadEncoding: "base64", context: {}, ttlMs: 30 });
  await assert.rejects(signWithMultichainExternalSigner({ request: req, signer: { sign: () => new Promise(() => {}) }, verifier: () => true, verifierName: "test" }), hasCode("ES4535"));
});

// Public deterministic test scalars only; these accounts must never receive funds.
const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const other = privateKeyToAccount(`0x${"0".repeat(63)}2`);
const contract = address("0x0000000000000000000000000000000000000003", Ethereum);
const envelope = () => typedDataEnvelope({ chain: Ethereum, domain: { name: "Offline test", version: "1", chainId: 1, verifyingContract: contract }, types: { Audit: [{ name: "value", type: "uint256" }] }, primaryType: "Audit", message: { value: 1n } });
function capability(sign: (digest: Hex) => Promise<Hex>, mutate?: () => void) {
  const signer: ExternalSigner<typeof Ethereum> = { kind: "external-signer", chain: Ethereum, address: address(account.address, Ethereum), async signTransaction() { throw new Error("not used"); }, async signTypedData(r) { assert.ok(Object.isFrozen(r.envelope.message)); mutate?.(); return sign(typedDataDigest(r.envelope)); } };
  return externalSignerCapability(signer, { chain: Ethereum, allowedDestinations: [contract], allowedTypedDataPrimaryTypes: ["Audit"], allowedTypedDataVerifyingContracts: [contract] });
}

test("external typed-data signatures verify the exact signer and support compact signatures", async () => {
  for (const compact of [false, true]) {
    const cap = capability(async (hash) => { const sig = await account.sign({ hash }); if (!compact) return sig; const s = signatureToCompactSignature(parseSignature(sig)); return `${s.r}${s.yParityAndS.slice(2)}` as Hex; });
    const result = await signTypedDataWithExternalSigner(cap, envelope());
    assert.equal(result.signer, account.address);
  }
  await assert.rejects(signTypedDataWithExternalSigner(capability((hash) => other.sign({ hash })), envelope()), hasCode("ES4903"));
  await assert.rejects(signTypedDataWithExternalSigner(capability(async () => `0x${"00".repeat(65)}`), envelope()), hasCode("ES4903"));
});

test("typed data snapshot binds authorization despite mutation of original message or domain", async () => {
  const original = envelope();
  const expectedDigest = typedDataDigest(original);
  const cap = capability((hash) => account.sign({ hash }), () => { original.message.value = 99n; });
  const result = await signTypedDataWithExternalSigner(cap, original);
  assert.equal(result.digest, expectedDigest);
  await assert.rejects(signTypedDataWithExternalSigner(cap, { ...envelope(), domain: { ...envelope().domain, chainId: 10 } }), hasCode("ES4904"));
  await assert.rejects(signTypedDataWithExternalSigner(cap, { ...envelope(), domain: { ...envelope().domain, verifyingContract: other.address } }), hasCode("ES4904"));
});

test("external transaction approval snapshot rejects recipient substitution and unapproved access lists", async () => {
  const tx: SimulatedTx<typeof Ethereum> = { state: "simulated", intent: { chain: Ethereum, from: address(account.address, Ethereum), to: contract }, nonce: nonce(Ethereum, 0, "explicit"), gas: gas(21_000), fees: { type: "legacy", gasPrice: 1n as WeiPerGas }, simulation: { status: "success", stateOverrides: false } };
  const signer: ExternalSigner<typeof Ethereum> = { kind: "external-signer", chain: Ethereum, address: address(account.address, Ethereum), async signTransaction(r) { assert.ok(Object.isFrozen(r)); (tx.intent as { to: string }).to = other.address; return account.signTransaction({ type: "legacy", chainId: 1, nonce: r.nonce, to: r.to!, gas: r.gas, gasPrice: 1n }); } };
  const cap = externalSignerCapability(signer, { chain: Ethereum, allowedDestinations: [contract], allowNativeTransfer: true });
  const signed = await signSimulatedWithExternalSigner(cap, tx);
  assert.equal(signed.intent.to, contract);
  const badSigner = { ...signer, async signTransaction() { return account.signTransaction({ type: "legacy", chainId: 1, nonce: 0, to: other.address, gas: 21_000n, gasPrice: 1n }); } };
  await assert.rejects(signSimulatedWithExternalSigner({ ...cap, signer: badSigner }, { ...tx, intent: { ...tx.intent, to: contract } }), hasCode("ES3835"));
  const accessListSigner = { ...signer, async signTransaction() { return account.signTransaction({ type: "eip1559", chainId: 1, nonce: 0, to: contract, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, accessList: [{ address: contract, storageKeys: [] }] }); } };
  await assert.rejects(signSimulatedWithExternalSigner({ ...cap, signer: accessListSigner }, { ...tx, intent: { ...tx.intent, to: contract }, fees: { type: "eip1559", maxFeePerGas: maxFeePerGas(2n), maxPriorityFeePerGas: maxPriorityFeePerGas(1n) } }), hasCode("ES3835"));
});
