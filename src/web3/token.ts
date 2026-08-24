import { formatUnits, parseUnits } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type { Address, EvmChain } from "./types.js";

export interface TokenDefinition<Symbol extends string = string, C extends EvmChain = EvmChain, Decimals extends number = number> {
  readonly kind: "token";
  readonly symbol: Symbol;
  readonly chain: C;
  readonly address: Address<C>;
  readonly decimals: Decimals;
}

export interface TokenAmount<T extends TokenDefinition = TokenDefinition> {
  readonly kind: "token-amount";
  readonly token: T;
  readonly raw: bigint;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function defineToken<Symbol extends string, C extends EvmChain, D extends number>(input: {
  symbol: Symbol;
  chain: C;
  address: Address<C>;
  decimals: D;
}): TokenDefinition<Symbol, C, D> {
  if (!Number.isSafeInteger(input.decimals) || input.decimals < 0 || input.decimals > 255) {
    fail("ES3901", "InvalidTokenDecimals", "Token decimals must be an integer between 0 and 255.", { decimals: input.decimals });
  }
  return { kind: "token", ...input };
}

function exactUnsigned(value: bigint | string, label: string): bigint {
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    fail("ES3902", "InvalidTokenRawAmount", `${label} must be an unsigned integer string or bigint.`, { value });
  }
  let raw: bigint;
  try { raw = BigInt(value); }
  catch { return fail("ES3902", "InvalidTokenRawAmount", `${label} could not be converted to an exact integer.`, { value: String(value) }); }
  if (raw < 0n) fail("ES3903", "NegativeTokenAmount", "Token amounts cannot be negative.", { value: raw.toString() });
  return raw;
}

export function tokenAmount<T extends TokenDefinition>(token: T, decimalValue: string): TokenAmount<T> {
  if (!/^\d+(?:\.\d+)?$/.test(decimalValue)) {
    fail("ES3904", "InvalidTokenDecimalAmount", "Token amount must be a non-negative exact decimal string.", { value: decimalValue, token: token.symbol });
  }
  try {
    return { kind: "token-amount", token, raw: parseUnits(decimalValue, token.decimals) };
  } catch (error) {
    return fail("ES3904", "InvalidTokenDecimalAmount", "Token amount cannot be represented exactly with the token's declared decimals.", {
      value: decimalValue,
      decimals: token.decimals,
      token: token.symbol,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function tokenAmountRaw<T extends TokenDefinition>(token: T, raw: bigint | string): TokenAmount<T> {
  return { kind: "token-amount", token, raw: exactUnsigned(raw, `${token.symbol} raw amount`) };
}

export function formatTokenAmount<T extends TokenDefinition>(amount: TokenAmount<T>): string {
  return formatUnits(amount.raw, amount.token.decimals);
}

export function sameToken(a: TokenDefinition, b: TokenDefinition): boolean {
  return a.chain.id === b.chain.id &&
    a.address.toLowerCase() === b.address.toLowerCase() &&
    a.decimals === b.decimals;
}

export function assertSameToken(a: TokenDefinition, b: TokenDefinition): void {
  if (!sameToken(a, b)) {
    fail("ES3905", "TokenIdentityMismatch", "Token operation mixes different chain/address/decimals identities.", {
      left: { symbol: a.symbol, chainId: a.chain.id, address: a.address, decimals: a.decimals },
      right: { symbol: b.symbol, chainId: b.chain.id, address: b.address, decimals: b.decimals },
    });
  }
}

export function addTokenAmounts<T extends TokenDefinition>(a: TokenAmount<T>, b: TokenAmount<T>): TokenAmount<T> {
  assertSameToken(a.token, b.token);
  return tokenAmountRaw(a.token, a.raw + b.raw);
}

export function subtractTokenAmounts<T extends TokenDefinition>(a: TokenAmount<T>, b: TokenAmount<T>): TokenAmount<T> {
  assertSameToken(a.token, b.token);
  if (b.raw > a.raw) fail("ES3906", "TokenAmountUnderflow", "Token subtraction would produce a negative amount.", { minuend: a.raw.toString(), subtrahend: b.raw.toString() });
  return tokenAmountRaw(a.token, a.raw - b.raw);
}

export function assertTokenUintWidth<T extends TokenDefinition>(amount: TokenAmount<T>, bits: number, field: string): void {
  if (!Number.isSafeInteger(bits) || bits < 1 || bits > 256) fail("ES3907", "InvalidUintWidth", "Token uint width must be between 1 and 256 bits.", { bits, field });
  const max = (1n << BigInt(bits)) - 1n;
  if (amount.raw > max) fail("ES3908", "TokenAmountWidthOverflow", `Token amount exceeds uint${bits}.`, { field, raw: amount.raw.toString(), max: max.toString(), token: amount.token.symbol });
}
