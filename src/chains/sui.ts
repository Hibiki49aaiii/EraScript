import { EraDiagnosticError } from "../diagnostics.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
declare const suiBrand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [suiBrand]: Name };

export type SuiAddress = Brand<`0x${string}`, "SuiAddress">;
export type SuiObjectId = Brand<`0x${string}`, "SuiObjectId">;
export type SuiTransactionDigest = Brand<string, "SuiTransactionDigest">;
export type SuiObjectDigest = Brand<string, "SuiObjectDigest">;
export type Mist = Brand<bigint, "Mist">;

export interface SuiObjectRef {
  readonly objectId: SuiObjectId;
  readonly version: bigint;
  readonly digest: SuiObjectDigest;
}

export interface SuiEffectsEvidence {
  readonly kind: "sui-effects";
  readonly transactionDigest: SuiTransactionDigest;
  readonly status: "success" | "failure";
  readonly effectsDigest?: string;
  readonly checkpoint?: bigint;
  readonly error?: string;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function canonical32Hex(value: string, code: string, kind: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    const digits = value.startsWith("0x") ? value.slice(2).length : value.length;
    fail(code, kind, `${label} must be canonical 32-byte 0x-prefixed hexadecimal.`, { expectedHexDigits: 64, actualHexDigits: digits });
  }
  return value.toLowerCase() as `0x${string}`;
}

function decodeBase58(value: string): Uint8Array {
  if (value.length === 0) fail("ES4420", "InvalidSuiDigest", "Sui digest cannot be empty.");
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) fail("ES4420", "InvalidSuiDigest", "Sui digest contains a character outside the base58 alphabet.", { character });
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

function suiDigest(value: string, label: string): string {
  const decoded = decodeBase58(value);
  if (decoded.length !== 32) fail("ES4420", "InvalidSuiDigest", `${label} must decode to exactly 32 bytes.`, { decodedBytes: decoded.length });
  return value;
}

export function suiAddress(value: string): SuiAddress {
  return canonical32Hex(value, "ES4421", "InvalidSuiAddress", "Sui address") as SuiAddress;
}

export function suiObjectId(value: string): SuiObjectId {
  return canonical32Hex(value, "ES4422", "InvalidSuiObjectId", "Sui object ID") as SuiObjectId;
}

export function suiTransactionDigest(value: string): SuiTransactionDigest {
  return suiDigest(value, "Sui transaction digest") as SuiTransactionDigest;
}

export function suiObjectDigest(value: string): SuiObjectDigest {
  return suiDigest(value, "Sui object digest") as SuiObjectDigest;
}

export function mist(value: bigint | string): Mist {
  let parsed: bigint;
  try { parsed = BigInt(value); }
  catch { return fail("ES4423", "InvalidMist", "MIST must be an exact integer.", { value: String(value) }); }
  if (parsed < 0n) fail("ES4423", "InvalidMist", "MIST cannot be negative.", { value: parsed.toString() });
  return parsed as Mist;
}

export function suiObjectRef(input: { objectId: string; version: bigint; digest: string }): SuiObjectRef {
  if (input.version < 0n) fail("ES4424", "InvalidSuiObjectVersion", "Sui object version cannot be negative.", { version: input.version.toString() });
  return { objectId: suiObjectId(input.objectId), version: input.version, digest: suiObjectDigest(input.digest) };
}

export function suiEffectsEvidence(input: {
  transactionDigest: string;
  status: "success" | "failure";
  effectsDigest?: string;
  checkpoint?: bigint;
  error?: string;
}): SuiEffectsEvidence {
  if (input.checkpoint !== undefined && input.checkpoint < 0n) fail("ES4425", "InvalidSuiCheckpoint", "Sui checkpoint cannot be negative.");
  if (input.status === "failure" && !input.error) fail("ES4426", "MissingSuiFailureReason", "Failed Sui execution evidence must retain the execution error.");
  return {
    kind: "sui-effects",
    transactionDigest: suiTransactionDigest(input.transactionDigest),
    status: input.status,
    ...(input.effectsDigest ? { effectsDigest: input.effectsDigest } : {}),
    ...(input.checkpoint !== undefined ? { checkpoint: input.checkpoint } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}
