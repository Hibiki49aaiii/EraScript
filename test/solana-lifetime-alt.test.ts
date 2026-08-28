import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  SolanaMainnetProfile,
  assembleAndVerifySolanaSignedTransaction,
  assertSolanaDurableNonceStillCurrent,
  bindSolanaVerifiedSignatures,
  createSolanaSigningPlan,
  createSolanaSigningRequests,
  prepareSolanaDurableNonceSerializedTransaction,
  signWithMultichainExternalSigner,
  simulateSolanaTransaction,
  solanaAddressLookupTable,
  solanaBlockhash,
  solanaDurableNonceAccount,
  submitSolanaTransaction,
  verifySolanaAddressLookupReferences,
  verifySolanaDurableNonceTransaction,
  verifySolanaSerializedTransaction,
  type MultichainExternalSigner,
  type MultichainSigningRequest,
  type VerifiedMultichainSignature,
} from "../src/chains/index.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const NONCE_ACCOUNT = "So11111111111111111111111111111111111111112";
const AUTHORITY = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const NONCE = "1".repeat(32);
const NEXT_NONCE = "So11111111111111111111111111111111111111112";
const ALT = "AddressLookupTab1e1111111111111111111111111";
const ADDRESS_A = SYSTEM_PROGRAM;
const ADDRESS_B = NONCE_ACCOUNT;
const TX_BASE64 = "AQ==";
const MESSAGE_BASE64 = "Ag==";
const SIGNED_TX_BASE64 = "Aw==";
const SOL_TX_SIGNATURE = "1".repeat(64);

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
  return signWithMultichainExternalSigner({
    signer,
    request,
    verifier: async () => true,
    verifierName: "test-verifier",
    nowMs: request.createdAtMs,
  });
}

test("Solana durable nonce binds lifetime token, signed message, first instruction, account and authority", async () => {
  const account = solanaDurableNonceAccount({
    nonceAccount: NONCE_ACCOUNT,
    authority: AUTHORITY,
    nonce: NONCE,
    lamportsPerSignature: 5_000n,
    observedSlot: 100n,
    observedAtMs: 1_000,
  });

  const binding = await verifySolanaDurableNonceTransaction({
    serializedBase64: TX_BASE64,
    account,
    nowMs: 2_000,
    inspector: async () => ({
      lifetimeToken: NONCE,
      signingPayloadBase64: MESSAGE_BASE64,
      firstInstruction: {
        programId: SYSTEM_PROGRAM,
        kind: "advance-nonce-account",
        nonceAccount: NONCE_ACCOUNT,
        authority: AUTHORITY,
        nonceAccountWritable: true,
      },
    }),
  });
  assert.equal(binding.firstInstructionVerified, true);
  assert.equal(binding.consumptionSemantics, "advance-on-validation");
  assert.match(binding.signingPayloadHash, /^0x[0-9a-f]{64}$/);

  await assert.doesNotReject(() => assertSolanaDurableNonceStillCurrent({
    async read() {
      return {
        authority: AUTHORITY,
        nonce: NONCE,
        lamportsPerSignature: 5_000n,
        observedSlot: 101n,
      };
    },
  }, binding));

  await assert.rejects(
    () => assertSolanaDurableNonceStillCurrent({
      async read() {
        return {
          authority: AUTHORITY,
          nonce: NEXT_NONCE,
          lamportsPerSignature: 5_000n,
          observedSlot: 102n,
        };
      },
    }, binding),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4699",
  );
});


test("Solana durable nonce survives signing assembly and is revalidated before simulation and submission", async () => {
  const account = solanaDurableNonceAccount({
    nonceAccount: NONCE_ACCOUNT,
    authority: AUTHORITY,
    nonce: NONCE,
    lamportsPerSignature: 5_000n,
    observedSlot: 100n,
  });
  const durableNonce = await verifySolanaDurableNonceTransaction({
    serializedBase64: TX_BASE64,
    account,
    inspector: async () => ({
      lifetimeToken: NONCE,
      signingPayloadBase64: MESSAGE_BASE64,
      firstInstruction: {
        programId: SYSTEM_PROGRAM,
        kind: "advance-nonce-account",
        nonceAccount: NONCE_ACCOUNT,
        authority: AUTHORITY,
        nonceAccountWritable: true,
      },
    }),
  });
  const prepared = prepareSolanaDurableNonceSerializedTransaction({
    profile: SolanaMainnetProfile,
    serializedBase64: TX_BASE64,
    durableNonce,
  });
  const transactionInspector = async () => ({
    version: 0 as const,
    recentBlockhash: solanaBlockhash(NONCE),
    signerCount: 1,
  });
  const verified = await verifySolanaSerializedTransaction(prepared, async () => ({
    version: 0,
    recentBlockhash: solanaBlockhash(NONCE),
    signerCount: 1,
  }));
  const signingInspector = async () => ({
    signingPayloadBase64: MESSAGE_BASE64,
    requiredSigners: [AUTHORITY],
    feePayer: AUTHORITY,
  });
  const plan = await createSolanaSigningPlan(SolanaMainnetProfile, verified, signingInspector);
  assert.deepEqual(plan.evidenceBindings.map((entry) => entry.kind), ["durable-nonce"]);
  assert.equal(plan.evidenceBindings[0]?.hash, durableNonce.bindingHash);

  const requests = createSolanaSigningRequests(SolanaMainnetProfile, plan, { nowMs: 1_000, ttlMs: 60_000 });
  const signatures = await Promise.all(requests.map((entry) => verifiedSignature(entry.request)));
  const signatureSet = bindSolanaVerifiedSignatures(plan, requests, signatures);
  const assembled = await assembleAndVerifySolanaSignedTransaction({
    profile: SolanaMainnetProfile,
    source: verified,
    signatureSet,
    assembler: { async assemble() { return SIGNED_TX_BASE64; } },
    transactionInspector,
    signingInspector,
  });
  assert.equal(assembled.transaction.lifetimeKind, "durable-nonce");

  let currentNonce = NONCE;
  let observedSlot = 101n;
  const nonceReader = {
    async read() {
      return {
        authority: AUTHORITY,
        nonce: currentNonce,
        lamportsPerSignature: 5_000n,
        observedSlot,
      };
    },
  };
  const client = {
    rpc: {
      getBlockHeight: () => ({ send: async () => 999_999n }),
      simulateTransaction: (_transaction: string, config?: Record<string, unknown>) => ({
        send: async () => {
          assert.equal(config?.sigVerify, true);
          return { value: { err: null, logs: ["durable-ok"], unitsConsumed: 300n } };
        },
      }),
      sendTransaction: () => ({ send: async () => SOL_TX_SIGNATURE }),
    },
  };
  const simulation = await simulateSolanaTransaction(client, assembled.transaction, "confirmed", { durableNonceReader: nonceReader });
  assert.equal(simulation.success, true);
  if (!simulation.success) throw new Error("expected durable nonce simulation to succeed");
  const submitted = await submitSolanaTransaction(client, simulation as typeof simulation & { readonly success: true }, { durableNonceReader: nonceReader });
  assert.equal(submitted.signature, SOL_TX_SIGNATURE);

  currentNonce = NEXT_NONCE;
  observedSlot = 102n;
  await assert.rejects(
    () => submitSolanaTransaction(client, simulation as typeof simulation & { readonly success: true }, { durableNonceReader: nonceReader }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4699",
  );
});

test("Solana durable nonce rejects non-first/mismatched AdvanceNonceAccount semantics", async () => {
  const account = solanaDurableNonceAccount({
    nonceAccount: NONCE_ACCOUNT,
    authority: AUTHORITY,
    nonce: NONCE,
    lamportsPerSignature: 5_000n,
    observedSlot: 100n,
  });

  await assert.rejects(
    () => verifySolanaDurableNonceTransaction({
      serializedBase64: TX_BASE64,
      account,
      inspector: async () => ({
        lifetimeToken: NONCE,
        signingPayloadBase64: MESSAGE_BASE64,
        firstInstruction: {
          programId: AUTHORITY,
          kind: "advance-nonce-account",
          nonceAccount: NONCE_ACCOUNT,
          authority: AUTHORITY,
          nonceAccountWritable: true,
        },
      }),
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4694",
  );
});

test("Solana ALT resolution is v0-only and rejects same-slot warm-up indexes", () => {
  const table = solanaAddressLookupTable({
    table: ALT,
    authority: AUTHORITY,
    deactivationSlot: (1n << 64n) - 1n,
    lastExtendedSlot: 10n,
    lastExtendedSlotStartIndex: 1,
    addresses: [ADDRESS_A, ADDRESS_B],
    status: "active",
    observedSlot: 11n,
    observedAtMs: 1_000,
  });

  const binding = verifySolanaAddressLookupReferences({
    version: 0,
    currentSlot: 11n,
    references: [{
      table: ALT,
      writableIndexes: [1],
      readonlyIndexes: [0],
    }],
    tables: [table],
  });
  assert.deepEqual(binding.resolutions[0]?.writable, [ADDRESS_B]);
  assert.deepEqual(binding.resolutions[0]?.readonly, [ADDRESS_A]);

  assert.throws(
    () => verifySolanaAddressLookupReferences({
      version: "legacy",
      currentSlot: 11n,
      references: [{ table: ALT, writableIndexes: [1], readonlyIndexes: [] }],
      tables: [table],
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4707",
  );

  const warming = solanaAddressLookupTable({
    table: ALT,
    authority: AUTHORITY,
    lastExtendedSlot: 11n,
    lastExtendedSlotStartIndex: 1,
    addresses: [ADDRESS_A, ADDRESS_B],
    status: "active",
    observedSlot: 11n,
  });
  assert.throws(
    () => verifySolanaAddressLookupReferences({
      version: 0,
      currentSlot: 11n,
      references: [{ table: ALT, writableIndexes: [1], readonlyIndexes: [] }],
      tables: [warming],
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4706",
  );
});
