import { parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { sameAddress } from "../web3/capabilities.js";
import type { ExternalTransactionSigningRequest } from "../web3/external-signer.js";
import type { EvmChain } from "../web3/types.js";

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function sameHex(a: unknown, b: unknown): boolean {
  const left = typeof a === "string" ? a.toLowerCase() : a === undefined || a === null ? "0x" : String(a).toLowerCase();
  const right = typeof b === "string" ? b.toLowerCase() : b === undefined || b === null ? "0x" : String(b).toLowerCase();
  return left === right;
}
function integer(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}
function mismatch(field: string, expected: unknown, actual: unknown): never {
  return fail("ES3835", "ExternalSignedTransactionMismatch", "External signer returned a signed transaction that differs from the approved EraScript signing request.", { field, expected: expected === undefined ? null : String(expected), actual: actual === undefined ? null : String(actual) });
}

export async function assertExternalRawTransaction<C extends EvmChain>(request: ExternalTransactionSigningRequest<C>, raw: Hex): Promise<void> {
  let parsed: Record<string, unknown>;
  let recovered: string;
  try {
    parsed = parseTransaction(raw as TransactionSerialized) as unknown as Record<string, unknown>;
    recovered = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized });
  } catch {
    return fail("ES3832", "InvalidExternalSignerResponse", "External signer returned a raw transaction that viem could not parse/recover.");
  }
  if (!sameAddress(recovered, request.from)) mismatch("from", request.from, recovered);
  if (integer(parsed.chainId) !== BigInt(request.chain.id)) mismatch("chainId", request.chain.id, parsed.chainId);
  if (integer(parsed.nonce) !== BigInt(request.nonce)) mismatch("nonce", request.nonce, parsed.nonce);
  if (integer(parsed.gas) !== request.gas) mismatch("gas", request.gas, parsed.gas);
  if (!sameHex(parsed.to, request.to)) mismatch("to", request.to ?? null, parsed.to ?? null);
  if ((integer(parsed.value) ?? 0n) !== request.value) mismatch("value", request.value, parsed.value ?? 0n);
  if (!sameHex(parsed.data, request.data)) mismatch("data", request.data ?? "0x", parsed.data ?? "0x");
  if (parsed.type !== request.transactionType) mismatch("type", request.transactionType, parsed.type);
  if (Array.isArray(parsed.accessList) && parsed.accessList.length > 0) mismatch("accessList", "empty", "nonempty");

  if (request.fee.type === "legacy") {
    if (integer(parsed.gasPrice) !== request.fee.gasPrice) mismatch("gasPrice", request.fee.gasPrice, parsed.gasPrice);
  } else {
    if (integer(parsed.maxFeePerGas) !== request.fee.maxFeePerGas) mismatch("maxFeePerGas", request.fee.maxFeePerGas, parsed.maxFeePerGas);
    if (integer(parsed.maxPriorityFeePerGas) !== request.fee.maxPriorityFeePerGas) mismatch("maxPriorityFeePerGas", request.fee.maxPriorityFeePerGas, parsed.maxPriorityFeePerGas);
  }

  const expectedAuth = request.authorizationList ?? [];
  const rawAuth = parsed.authorizationList;
  const actualAuth = Array.isArray(rawAuth) ? rawAuth as Record<string, unknown>[] : [];
  if (expectedAuth.length !== actualAuth.length) mismatch("authorizationList.length", expectedAuth.length, actualAuth.length);
  for (let index = 0; index < expectedAuth.length; index += 1) {
    const expected = expectedAuth[index]!;
    const actual = actualAuth[index]!;
    if (!sameHex(actual.address, expected.address)) mismatch(`authorizationList[${index}].address`, expected.address, actual.address);
    if (integer(actual.chainId) !== BigInt(expected.chainId)) mismatch(`authorizationList[${index}].chainId`, expected.chainId, actual.chainId);
    if (integer(actual.nonce) !== BigInt(expected.nonce)) mismatch(`authorizationList[${index}].nonce`, expected.nonce, actual.nonce);
    if (integer(actual.yParity) !== BigInt(expected.yParity)) mismatch(`authorizationList[${index}].yParity`, expected.yParity, actual.yParity);
    if (!sameHex(actual.r, expected.r)) mismatch(`authorizationList[${index}].r`, expected.r, actual.r);
    if (!sameHex(actual.s, expected.s)) mismatch(`authorizationList[${index}].s`, expected.s, actual.s);
  }
}

