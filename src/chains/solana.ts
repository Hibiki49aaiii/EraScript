import { EraDiagnosticError } from "../diagnostics.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
declare const solanaBrand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [solanaBrand]: Name };

export type SolanaAddress = Brand<string, "SolanaAddress">;
export type SolanaBlockhash = Brand<string, "SolanaBlockhash">;
export type SolanaTransactionSignature = Brand<string, "SolanaTransactionSignature">;
export type Lamports = Brand<bigint, "Lamports">;
export type SolanaCommitment = "processed" | "confirmed" | "finalized";
export type SolanaTransactionVersion = "legacy" | 0;

export interface SolanaRecentBlockhashEvidence {
  readonly kind: "solana-recent-blockhash";
  readonly blockhash: SolanaBlockhash;
  readonly lastValidBlockHeight: bigint;
  readonly commitment: SolanaCommitment;
  readonly observedBlockHeight?: bigint;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function decodeBase58(value: string): Uint8Array {
  if (value.length === 0) fail("ES4410", "InvalidSolanaBase58", "Solana base58 value cannot be empty.");
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) fail("ES4410", "InvalidSolanaBase58", "Value contains a character outside the Solana base58 alphabet.", { character });
    number = number * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (number > 0n) {
    body.push(Number(number & 0xffn));
    number >>= 8n;
  }
  body.reverse();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  return Uint8Array.from([...new Array(leadingZeroes).fill(0), ...body]);
}

function fixedBase58(value: string, bytes: number, code: string, kind: string, label: string): string {
  const decoded = decodeBase58(value);
  if (decoded.length !== bytes) fail(code, kind, `${label} must decode to exactly ${bytes} bytes.`, { decodedBytes: decoded.length, expectedBytes: bytes });
  return value;
}

export function solanaAddress(value: string): SolanaAddress {
  return fixedBase58(value, 32, "ES4411", "InvalidSolanaAddress", "Solana address") as SolanaAddress;
}

export function solanaBlockhash(value: string): SolanaBlockhash {
  return fixedBase58(value, 32, "ES4412", "InvalidSolanaBlockhash", "Solana blockhash") as SolanaBlockhash;
}

export function solanaTransactionSignature(value: string): SolanaTransactionSignature {
  return fixedBase58(value, 64, "ES4413", "InvalidSolanaTransactionSignature", "Solana Ed25519 transaction signature") as SolanaTransactionSignature;
}

export function lamports(value: bigint | string): Lamports {
  let parsed: bigint;
  try { parsed = BigInt(value); }
  catch { return fail("ES4414", "InvalidLamports", "Lamports must be an exact integer.", { value: String(value) }); }
  if (parsed < 0n) fail("ES4414", "InvalidLamports", "Lamports cannot be negative.", { value: parsed.toString() });
  return parsed as Lamports;
}

export function solanaRecentBlockhash(input: {
  blockhash: string;
  lastValidBlockHeight: bigint;
  commitment?: SolanaCommitment;
  observedBlockHeight?: bigint;
}): SolanaRecentBlockhashEvidence {
  if (input.lastValidBlockHeight < 0n) fail("ES4415", "InvalidSolanaBlockHeight", "lastValidBlockHeight cannot be negative.");
  if (input.observedBlockHeight !== undefined && input.observedBlockHeight < 0n) fail("ES4415", "InvalidSolanaBlockHeight", "observedBlockHeight cannot be negative.");
  return {
    kind: "solana-recent-blockhash",
    blockhash: solanaBlockhash(input.blockhash),
    lastValidBlockHeight: input.lastValidBlockHeight,
    commitment: input.commitment ?? "confirmed",
    ...(input.observedBlockHeight !== undefined ? { observedBlockHeight: input.observedBlockHeight } : {}),
  };
}

export function assertSolanaBlockhashFresh(evidence: SolanaRecentBlockhashEvidence, currentBlockHeight: bigint): SolanaRecentBlockhashEvidence {
  if (currentBlockHeight < 0n) fail("ES4415", "InvalidSolanaBlockHeight", "Current Solana block height cannot be negative.");
  if (currentBlockHeight > evidence.lastValidBlockHeight) fail("ES4416", "SolanaBlockhashExpired", "Solana transaction blockhash has expired and must be rebuilt before signing/submission.", {
    currentBlockHeight: currentBlockHeight.toString(),
    lastValidBlockHeight: evidence.lastValidBlockHeight.toString(),
  });
  return evidence;
}
