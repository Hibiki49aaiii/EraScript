import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  lamports,
  solanaAddress,
  solanaBlockhash,
  type Lamports,
  type SolanaAddress,
  type SolanaBlockhash,
} from "./solana.js";

const SYSTEM_PROGRAM = solanaAddress("11111111111111111111111111111111");

export interface SolanaDurableNonceAccountEvidence {
  readonly kind: "solana-durable-nonce-account";
  readonly nonceAccount: SolanaAddress;
  readonly authority: SolanaAddress;
  readonly nonce: SolanaBlockhash;
  readonly lamportsPerSignature: Lamports;
  readonly observedSlot: bigint;
  readonly observedAtMs: number;
  readonly source?: string;
}

export interface SolanaDurableNonceInstructionInspection {
  readonly programId: string;
  readonly kind: "advance-nonce-account";
  readonly nonceAccount: string;
  readonly authority: string;
  readonly nonceAccountWritable: boolean;
}

export interface SolanaDurableNonceTransactionInspection {
  readonly lifetimeToken: string;
  /** Exact Solana message bytes that signers authorize, canonical base64. */
  readonly signingPayloadBase64: string;
  readonly firstInstruction: SolanaDurableNonceInstructionInspection;
}

export type SolanaDurableNonceInspector = (
  serializedTransaction: Uint8Array,
) => SolanaDurableNonceTransactionInspection | Promise<SolanaDurableNonceTransactionInspection>;

export interface SolanaDurableNonceBindingEvidence {
  readonly kind: "solana-durable-nonce-binding";
  readonly account: SolanaDurableNonceAccountEvidence;
  readonly lifetimeToken: SolanaBlockhash;
  readonly firstInstructionVerified: true;
  readonly consumptionSemantics: "advance-on-validation";
  readonly signingPayloadHash: string;
  readonly bindingHash: string;
  readonly verifiedAtMs: number;
}

export interface SolanaDurableNonceReader {
  readonly id?: string;
  read(nonceAccount: SolanaAddress): Promise<{
    readonly authority: string;
    readonly nonce: string;
    readonly lamportsPerSignature: bigint | string;
    readonly observedSlot: bigint;
  }>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function canonicalBase64Bytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    fail("ES4690", "InvalidSolanaDurableNonceTransactionEncoding", "Durable nonce transaction must be canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    fail("ES4690", "InvalidSolanaDurableNonceTransactionEncoding", "Durable nonce transaction base64 is malformed or empty.");
  }
  return bytes;
}

function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [key, normalize(inner)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return `0x${createHash("sha256").update(stable(value)).digest("hex")}`;
}

export function solanaDurableNonceAccount(input: {
  nonceAccount: string;
  authority: string;
  nonce: string;
  lamportsPerSignature: bigint | string;
  observedSlot: bigint;
  observedAtMs?: number;
  source?: string;
}): SolanaDurableNonceAccountEvidence {
  if (input.observedSlot < 0n) fail("ES4691", "InvalidSolanaDurableNonceSlot", "Durable nonce observed slot cannot be negative.");
  return {
    kind: "solana-durable-nonce-account",
    nonceAccount: solanaAddress(input.nonceAccount),
    authority: solanaAddress(input.authority),
    nonce: solanaBlockhash(input.nonce),
    lamportsPerSignature: lamports(input.lamportsPerSignature),
    observedSlot: input.observedSlot,
    observedAtMs: input.observedAtMs ?? Date.now(),
    ...(input.source ? { source: input.source } : {}),
  };
}

export async function verifySolanaDurableNonceTransaction(input: {
  serializedBase64: string;
  account: SolanaDurableNonceAccountEvidence;
  inspector: SolanaDurableNonceInspector;
  nowMs?: number;
}): Promise<SolanaDurableNonceBindingEvidence> {
  let inspection: SolanaDurableNonceTransactionInspection;
  try {
    inspection = await input.inspector(canonicalBase64Bytes(input.serializedBase64));
  } catch (error) {
    if (error instanceof EraDiagnosticError) throw error;
    return fail("ES4692", "SolanaDurableNonceInspectionFailed", "Failed to inspect durable nonce transaction semantics.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const lifetimeToken = solanaBlockhash(inspection.lifetimeToken);
  if (lifetimeToken !== input.account.nonce) {
    fail("ES4693", "SolanaDurableNonceValueMismatch", "Transaction lifetime token does not match the nonce stored in the bound nonce account.", {
      transactionNonce: lifetimeToken,
      accountNonce: input.account.nonce,
      nonceAccount: input.account.nonceAccount,
    });
  }

  const first = inspection.firstInstruction;
  const programId = solanaAddress(first.programId);
  const nonceAccount = solanaAddress(first.nonceAccount);
  const authority = solanaAddress(first.authority);
  if (programId !== SYSTEM_PROGRAM || first.kind !== "advance-nonce-account") {
    fail("ES4694", "MissingSolanaAdvanceNonceInstruction", "Durable nonce transaction must use AdvanceNonceAccount as its first instruction.", {
      programId,
      instructionKind: first.kind,
    });
  }
  if (nonceAccount !== input.account.nonceAccount) {
    fail("ES4695", "SolanaDurableNonceAccountMismatch", "AdvanceNonceAccount targets a different nonce account than the bound nonce evidence.", {
      expected: input.account.nonceAccount,
      actual: nonceAccount,
    });
  }
  if (!first.nonceAccountWritable) {
    fail("ES4696", "SolanaDurableNonceAccountNotWritable", "AdvanceNonceAccount requires the nonce account to be writable.");
  }
  if (authority !== input.account.authority) {
    fail("ES4697", "SolanaDurableNonceAuthorityMismatch", "AdvanceNonceAccount authority differs from the nonce account authority.", {
      expected: input.account.authority,
      actual: authority,
    });
  }

  const verifiedAtMs = input.nowMs ?? Date.now();
  const signingPayloadBytes = canonicalBase64Bytes(inspection.signingPayloadBase64);
  const canonicalSigningPayload = Buffer.from(signingPayloadBytes).toString("base64");
  const signingPayloadHash = `0x${createHash("sha256").update(`solana-signing-payload:${canonicalSigningPayload}`).digest("hex")}`;
  const core = {
    signingPayloadHash,
    nonceAccount: input.account.nonceAccount,
    authority: input.account.authority,
    nonce: input.account.nonce,
    lamportsPerSignature: input.account.lamportsPerSignature,
    observedSlot: input.account.observedSlot,
    lifetimeToken,
    serializedBase64: input.serializedBase64,
    consumptionSemantics: "advance-on-validation",
  } as const;

  return {
    kind: "solana-durable-nonce-binding",
    account: input.account,
    lifetimeToken,
    firstInstructionVerified: true,
    consumptionSemantics: "advance-on-validation",
    signingPayloadHash,
    bindingHash: hash(core),
    verifiedAtMs,
  };
}

/**
 * Re-reads the nonce account immediately before submission. Durable nonces do
 * not expire with block height, but they can be consumed/advanced elsewhere.
 */
export async function assertSolanaDurableNonceStillCurrent(
  reader: SolanaDurableNonceReader,
  binding: SolanaDurableNonceBindingEvidence,
): Promise<SolanaDurableNonceBindingEvidence> {
  const observed = await reader.read(binding.account.nonceAccount);
  const authority = solanaAddress(observed.authority);
  const nonce = solanaBlockhash(observed.nonce);
  if (authority !== binding.account.authority) {
    fail("ES4698", "SolanaDurableNonceAuthorityChanged", "Nonce account authority changed after the transaction was verified.", {
      expected: binding.account.authority,
      actual: authority,
    });
  }
  if (nonce !== binding.account.nonce) {
    fail("ES4699", "SolanaDurableNonceConsumedOrAdvanced", "Durable nonce changed after signing/verification; the transaction must not be submitted.", {
      expected: binding.account.nonce,
      actual: nonce,
      nonceAccount: binding.account.nonceAccount,
    });
  }
  const observedFee = lamports(observed.lamportsPerSignature);
  if (observedFee !== binding.account.lamportsPerSignature) {
    fail("ES4712", "SolanaDurableNonceFeeRateChanged", "Durable nonce fee snapshot changed after verification; rebuild and re-authorize the transaction.", {
      expected: binding.account.lamportsPerSignature.toString(),
      actual: observedFee.toString(),
      nonceAccount: binding.account.nonceAccount,
    });
  }
  if (observed.observedSlot < binding.account.observedSlot) {
    fail("ES4691", "InvalidSolanaDurableNonceSlot", "Nonce re-read came from an older slot than the original evidence.", {
      originalSlot: binding.account.observedSlot.toString(),
      observedSlot: observed.observedSlot.toString(),
    });
  }
  return binding;
}
