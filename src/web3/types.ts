import { getAddress, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";

declare const eraBrand: unique symbol;
type Brand<T, B extends string> = T & { readonly [eraBrand]: B };

export interface EvmChain<Name extends string = string, Id extends number = number> {
  readonly name: Name;
  readonly id: Id;
}

export const Ethereum = { name: "Ethereum", id: 1 } as const satisfies EvmChain;
export const BNBChain = { name: "BNBChain", id: 56 } as const satisfies EvmChain;
export const Base = { name: "Base", id: 8453 } as const satisfies EvmChain;
export const Arbitrum = { name: "Arbitrum", id: 42161 } as const satisfies EvmChain;

export type Address<C extends EvmChain = EvmChain> = Brand<`0x${string}`, `Address:${C["name"]}`>;
export type Bytes32 = Brand<Hex, "Bytes32">;
export type Hash<Algorithm extends string = "keccak256"> = Brand<Hex, `Hash:${Algorithm}`>;
export type TransactionHash<C extends EvmChain = EvmChain> = Brand<Hex, `TransactionHash:${C["name"]}`>;
export type BlockHash<C extends EvmChain = EvmChain> = Brand<Hex, `BlockHash:${C["name"]}`>;
export type Calldata<Signature extends string = string> = Brand<Hex, `Calldata:${Signature}`>;
export type MerkleRoot = Brand<Hex, "MerkleRoot">;
export type MerkleLeaf = Brand<Hex, "MerkleLeaf">;
export type MerkleNode = Brand<Hex, "MerkleNode">;
export type MerkleProof = readonly Bytes32[] & { readonly [eraBrand]: "MerkleProof" };

function hexDigits(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function invalidHex(
  code: string,
  kind: string,
  message: string,
  path?: string,
  suggestion?: string,
  details?: Record<string, unknown>,
): never {
  throw new EraDiagnosticError({
    code,
    severity: "error",
    kind,
    message,
    ...(path ? { path } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(details ? { details } : {}),
  });
}

export function address<C extends EvmChain>(value: string, chain: C, path?: string): Address<C> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    const digits = hexDigits(value);
    invalidHex(
      "ES3101",
      "InvalidAddress",
      `Expected a 20-byte EVM address (40 hexadecimal digits), received ${digits.length} digits.`,
      path,
      digits.length === 39 ? "A leading zero may be missing." : "Provide a complete 0x-prefixed EVM address.",
      { chain: chain.name, expectedHexDigits: 40, actualHexDigits: digits.length },
    );
  }

  try {
    return getAddress(value) as Address<C>;
  } catch (error) {
    invalidHex(
      "ES3102",
      "InvalidAddressChecksum",
      "The address has valid length but an invalid mixed-case EVM checksum.",
      path,
      "Verify the source address or provide an all-lowercase address for canonical checksumming.",
      { chain: chain.name, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function bytes32(value: string, path?: string): Bytes32 {
  const digits = hexDigits(value);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    invalidHex(
      "ES3201",
      "InvalidBytes32",
      `Expected bytes32 (64 hexadecimal digits), received ${digits.length} digits.`,
      path,
      digits.length === 63
        ? "A leading zero may be missing. Do not silently pad proofs unless the source encoding is verified."
        : "Provide exactly 32 bytes as a 0x-prefixed hexadecimal value.",
      { expectedBytes: 32, expectedHexDigits: 64, actualHexDigits: digits.length },
    );
  }
  return value as Bytes32;
}

export function hash<Algorithm extends string = "keccak256">(
  value: string,
  algorithm = "keccak256" as Algorithm,
  path?: string,
): Hash<Algorithm> {
  void algorithm;
  bytes32(value, path);
  return value as Hash<Algorithm>;
}

export function transactionHash<C extends EvmChain>(value: string, _chain: C, path?: string): TransactionHash<C> {
  bytes32(value, path);
  return value as TransactionHash<C>;
}

export function blockHash<C extends EvmChain>(value: string, _chain: C, path?: string): BlockHash<C> {
  bytes32(value, path);
  return value as BlockHash<C>;
}

export function merkleRoot(value: string, path?: string): MerkleRoot {
  bytes32(value, path);
  return value as MerkleRoot;
}

export function merkleLeaf(value: string, path?: string): MerkleLeaf {
  bytes32(value, path);
  return value as MerkleLeaf;
}

export function calldata<Signature extends string = string>(value: string, path?: string): Calldata<Signature> {
  const digits = hexDigits(value);
  if (!/^0x[0-9a-fA-F]*$/.test(value) || digits.length % 2 !== 0) {
    invalidHex(
      "ES3300",
      "InvalidCalldata",
      "Calldata must be a 0x-prefixed hexadecimal value containing whole bytes.",
      path,
      "Check for a missing hexadecimal nibble or malformed 0x prefix.",
      { actualHexDigits: digits.length },
    );
  }
  return value as Calldata<Signature>;
}

export function proof(values: readonly string[], path = "proof"): MerkleProof {
  const checked = values.map((value, index) => bytes32(value, `${path}[${index}]`));
  return checked as unknown as MerkleProof;
}

/** Explicit recovery helper. This is intentionally not used by bytes32/proof automatically. */
export function leftPadBytes32(value: string): Bytes32 {
  const digits = hexDigits(value);
  if (!/^[0-9a-fA-F]{1,64}$/.test(digits)) {
    invalidHex(
      "ES3202",
      "CannotPadBytes32",
      "Only hexadecimal values up to 32 bytes can be explicitly left-padded.",
      undefined,
      "Verify the original source before repairing proof material.",
    );
  }
  return `0x${digits.padStart(64, "0")}` as Bytes32;
}
