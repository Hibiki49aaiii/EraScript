import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  assertSolanaDurableNonceStillCurrent,
  solanaAddressLookupTable,
  solanaDurableNonceAccount,
  verifySolanaAddressLookupReferences,
  verifySolanaDurableNonceTransaction,
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
