import { createHash } from "node:crypto";
import { serializeTransaction, type TransactionSerializable } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { immutableSnapshot } from "../internal/snapshot.js";
import type { ExternalTransactionSigningRequest } from "../web3/external-signer.js";

export interface TransferPolicy {
  readonly chainId: number;
  readonly signer: string;
  readonly recipients: readonly string[];
  readonly maxNativeValue: bigint;
  readonly maxGas: bigint;
  readonly maxTotalFee: bigint;
  readonly tokens: readonly { readonly address: string; readonly maxAmount: bigint }[];
}

export function signingError(kind: "InvalidRequest" | "Denied" | "Consumed" | "Unavailable" | "Expired" | "InvalidSignature"): EraDiagnosticError {
  return new EraDiagnosticError({ code: "ES4910", severity: "error", kind: `SigningAuthority${kind}`, message: `Signing authority: ${kind}.` });
}

export function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw signingError("InvalidRequest");
  const obj = value as Record<string, unknown>;
  if (required.some((k) => !Object.hasOwn(obj, k)) || Object.keys(obj).some((k) => !required.includes(k) && !optional.includes(k))) throw signingError("InvalidRequest");
  return obj;
}

export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}
function address(value: unknown): value is string { return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value); }
function uint(value: unknown): value is bigint { return typeof value === "bigint" && value >= 0n && value < 2n ** 256n; }
function positiveInt(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }

/** Reject unsupported forms before serialization or any provider/device interaction. */
export function validateTransferRequest(value: ExternalTransactionSigningRequest): ExternalTransactionSigningRequest {
  const r = immutableSnapshot(value);
  record(r, ["kind", "chain", "transactionType", "from", "to", "value", "nonce", "gas", "fee", "simulation"], ["data"]);
  record(r.chain, ["id", "name"]);
  record(r.simulation, ["status", "stateOverrides"], ["blockNumber", "blockHash", "provider"]);
  if (r.kind !== "external-transaction-signing-request" || !positiveInt(r.chain.id)
    || typeof r.chain.name !== "string" || r.chain.name.length < 1 || r.chain.name.length > 80
    || !address(r.from) || !address(r.to) || !uint(r.value) || !uint(r.gas) || r.gas === 0n
    || !Number.isSafeInteger(r.nonce) || r.nonce < 0
    || (r.data !== undefined && (typeof r.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(r.data) || r.data.length > 138))
    || r.simulation.status !== "success" || r.simulation.stateOverrides !== false
    || (r.simulation.blockNumber !== undefined && !uint(r.simulation.blockNumber))
    || (r.simulation.blockHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(r.simulation.blockHash))
    || (r.simulation.provider !== undefined && (typeof r.simulation.provider !== "string" || r.simulation.provider.length > 200))) throw signingError("Denied");
  if (r.transactionType === "legacy" && r.fee.type === "legacy") {
    record(r.fee, ["type", "gasPrice"]);
    if (!uint(r.fee.gasPrice)) throw signingError("Denied");
  } else if (r.transactionType === "eip1559" && r.fee.type === "eip1559") {
    record(r.fee, ["type", "maxFeePerGas", "maxPriorityFeePerGas"]);
    if (!uint(r.fee.maxFeePerGas) || !uint(r.fee.maxPriorityFeePerGas) || r.fee.maxPriorityFeePerGas > r.fee.maxFeePerGas) throw signingError("Denied");
  } else throw signingError("Denied");
  return r;
}

export function validateTransferPolicy(value: TransferPolicy): TransferPolicy {
  const p = immutableSnapshot(value);
  record(p, ["chainId", "signer", "recipients", "maxNativeValue", "maxGas", "maxTotalFee", "tokens"]);
  if (!positiveInt(p.chainId) || !address(p.signer) || !Array.isArray(p.recipients) || p.recipients.length < 1 || p.recipients.length > 100
    || !p.recipients.every(address) || !uint(p.maxNativeValue) || !uint(p.maxGas) || p.maxGas === 0n || !uint(p.maxTotalFee)
    || !Array.isArray(p.tokens) || p.tokens.length > 100) throw signingError("Denied");
  for (const t of p.tokens) {
    record(t, ["address", "maxAmount"]);
    if (!address(t.address) || !uint(t.maxAmount)) throw signingError("Denied");
  }
  if (new Set(p.tokens.map((t) => t.address.toLowerCase())).size !== p.tokens.length) throw signingError("Denied");
  return p;
}

export function assertTransferPolicy(r: ExternalTransactionSigningRequest, p: TransferPolicy): void {
  const maxFee = r.fee.type === "legacy" ? r.fee.gasPrice : r.fee.maxFeePerGas;
  if (r.chain.id !== p.chainId || r.from.toLowerCase() !== p.signer.toLowerCase() || r.gas > p.maxGas || r.gas * maxFee > p.maxTotalFee) throw signingError("Denied");
  const data = r.data?.toLowerCase() ?? "0x";
  let recipient = r.to!;
  if (data === "0x") {
    if (r.value > p.maxNativeValue) throw signingError("Denied");
  } else {
    // Exactly transfer(address,uint256), with canonical address padding and no trailing bytes.
    if (!/^0xa9059cbb0{24}[0-9a-f]{104}$/.test(data) || r.value !== 0n) throw signingError("Denied");
    recipient = `0x${data.slice(34, 74)}` as typeof recipient;
    const token = p.tokens.find((t) => t.address.toLowerCase() === r.to!.toLowerCase());
    if (!token || BigInt(`0x${data.slice(74)}`) > token.maxAmount) throw signingError("Denied");
  }
  if (!p.recipients.some((a) => a.toLowerCase() === recipient.toLowerCase())) throw signingError("Denied");
}

export function signingRequestHash(request: ExternalTransactionSigningRequest): string {
  const r = validateTransferRequest(request);
  const canonical = (v: unknown): unknown => {
    if (typeof v === "bigint") return { bigint: v.toString() };
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]));
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(r))).digest("hex");
}

export function serializableTransfer(r: ExternalTransactionSigningRequest): TransactionSerializable {
  const common = { chainId: r.chain.id, nonce: r.nonce, to: r.to!, value: r.value, data: r.data ?? "0x", gas: r.gas } as const;
  return r.fee.type === "legacy"
    ? { ...common, type: "legacy", gasPrice: r.fee.gasPrice }
    : { ...common, type: "eip1559", maxFeePerGas: r.fee.maxFeePerGas, maxPriorityFeePerGas: r.fee.maxPriorityFeePerGas };
}

export function unsignedTransfer(r: ExternalTransactionSigningRequest): `0x${string}` {
  return serializeTransaction(serializableTransfer(validateTransferRequest(r)));
}
