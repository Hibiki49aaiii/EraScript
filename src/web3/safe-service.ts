import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import type {
  SafeCreatedTransaction,
  SafeProposedTransaction,
  SafeThresholdReachedTransaction,
  VerifiedSafeConfirmation,
} from "./safe.js";
import { hash, transactionHash, type Address, type EvmChain, type Hash, type TransactionHash } from "./types.js";
import { unwrapWei } from "./values.js";

export interface SafeTransactionServiceLike {
  readonly serviceUrl?: string;
  proposeTransaction?: (...args: any[]) => Promise<any>;
  confirmTransaction?: (...args: any[]) => Promise<any>;
  getTransaction?: (...args: any[]) => Promise<any>;
  getTransactionConfirmations?: (...args: any[]) => Promise<any>;
}

export interface SafeServiceEvidence<C extends EvmChain = EvmChain> {
  readonly kind: "safe-service-evidence";
  readonly service: string;
  readonly chain: C;
  readonly safe: Address<C>;
  readonly safeTxHash: Hash<"safe-tx">;
  readonly nonce: bigint;
  readonly confirmationsSubmitted: number;
  readonly confirmationsRequired: number;
  readonly readyByCount: boolean;
  readonly executedReported: boolean;
  readonly successfulReported?: boolean;
  readonly executionTransactionHash?: TransactionHash<C>;
  readonly serviceTrustedFlag?: boolean;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function action<A, R>(service: SafeTransactionServiceLike, name: string): (args: A) => Promise<R> {
  const value = (service as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4220", "MissingSafeServiceAction", `The supplied Safe Transaction Service client does not expose '${name}'.`, { action: name });
  return value.bind(service) as (args: A) => Promise<R>;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function decimal(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4221", "MalformedSafeServiceRecord", `Safe service field '${field}' must be a non-negative integer.`, { field, value: String(value) });
}

function numberCount(value: unknown, field: string): number {
  const parsed = decimal(value, field);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) fail("ES4221", "MalformedSafeServiceRecord", `Safe service field '${field}' exceeds a safe integer.`, { field, value: parsed.toString() });
  return Number(parsed);
}

function serviceName(service: SafeTransactionServiceLike): string {
  return service.serviceUrl ?? "safe-transaction-service";
}

function txForService<C extends EvmChain>(transaction: SafeCreatedTransaction<C>) {
  return {
    to: transaction.transaction.to,
    value: unwrapWei(transaction.transaction.value).toString(),
    data: transaction.transaction.data,
    operation: transaction.transaction.operation,
    safeTxGas: transaction.transaction.safeTxGas.toString(),
    baseGas: transaction.transaction.baseGas.toString(),
    gasPrice: transaction.transaction.gasPrice.toString(),
    gasToken: transaction.transaction.gasToken,
    refundReceiver: transaction.transaction.refundReceiver,
    nonce: transaction.transaction.nonce.toString(),
  };
}

export async function proposeSafeTransactionToService<C extends EvmChain>(service: SafeTransactionServiceLike, transaction: SafeCreatedTransaction<C>, confirmation: VerifiedSafeConfirmation<C>): Promise<void> {
  if (confirmation.safeTxHash.toLowerCase() !== transaction.safeTxHash.toLowerCase()) fail("ES4210", "SafeConfirmationHashMismatch", "Safe service proposal confirmation belongs to a different SafeTxHash.");
  if (!transaction.config.owners.some((owner) => sameAddress(owner, confirmation.owner))) fail("ES4206", "SafeConfirmationFromNonOwner", "Safe service proposal signer is not a declared Safe owner.", { owner: confirmation.owner });
  const propose = action<Record<string, unknown>, unknown>(service, "proposeTransaction");
  await propose({
    safeAddress: transaction.config.safe,
    safeTransactionData: txForService(transaction),
    safeTxHash: transaction.safeTxHash,
    senderAddress: confirmation.owner,
    senderSignature: confirmation.signature,
  });
}

export async function submitSafeConfirmationToService<C extends EvmChain>(service: SafeTransactionServiceLike, transaction: SafeCreatedTransaction<C> | SafeProposedTransaction<C> | SafeThresholdReachedTransaction<C>, confirmation: VerifiedSafeConfirmation<C>): Promise<void> {
  if (confirmation.safeTxHash.toLowerCase() !== transaction.safeTxHash.toLowerCase()) fail("ES4210", "SafeConfirmationHashMismatch", "Safe service confirmation belongs to a different SafeTxHash.");
  if (!transaction.config.owners.some((owner) => sameAddress(owner, confirmation.owner))) fail("ES4206", "SafeConfirmationFromNonOwner", "Safe service confirmation signer is not a declared Safe owner.", { owner: confirmation.owner });
  const confirm = action<[string, Hex], unknown>(service, "confirmTransaction") as unknown as (safeTxHash: string, signature: Hex) => Promise<unknown>;
  await confirm(transaction.safeTxHash, confirmation.signature);
}

type ServiceTransactionRecord = Record<string, unknown>;
type ServiceConfirmationRecord = { readonly count?: unknown; readonly results?: readonly unknown[] };
type ServiceConfirmationList = ServiceConfirmationRecord | readonly unknown[];

function confirmationCount(value: ServiceConfirmationList): number {
  if (Array.isArray(value)) return value.length;
  const record = value as ServiceConfirmationRecord;
  if (Array.isArray(record.results)) return record.results.length;
  if (record.count !== undefined) return numberCount(record.count, "confirmations.count");
  fail("ES4221", "MalformedSafeServiceRecord", "Safe service confirmation response has no count/results array.");
}

function normalizedNullableAddress(value: unknown, field: string): string {
  if (value === null || value === undefined) return "0x0000000000000000000000000000000000000000";
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail("ES4221", "MalformedSafeServiceRecord", `Safe service field '${field}' must be an EVM address or null.`, { field, value: String(value) });
  return value;
}

function normalizedData(value: unknown): string {
  if (value === null || value === undefined) return "0x";
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail("ES4221", "MalformedSafeServiceRecord", "Safe service data must be whole-byte hexadecimal or null.");
  return value;
}

function payloadMismatch(field: string, expected: string, actual: unknown): never {
  return fail("ES4226", "SafeServicePayloadMismatch", `Safe service transaction '${field}' differs from the locally hashed Safe transaction.`, { field, expected, actual: String(actual) });
}

function assertServiceTransactionMatches<C extends EvmChain>(local: SafeCreatedTransaction<C>, record: ServiceTransactionRecord): void {
  const returnedHash = record.safeTxHash ?? record.safe_tx_hash;
  if (typeof returnedHash !== "string" || returnedHash.toLowerCase() !== local.safeTxHash.toLowerCase()) fail("ES4223", "SafeServiceHashMismatch", "Safe Transaction Service returned a different SafeTxHash.", { expected: local.safeTxHash, actual: String(returnedHash) });
  const safe = record.safe ?? record.safeAddress;
  if (typeof safe !== "string" || !sameAddress(safe, local.config.safe)) fail("ES4224", "SafeServiceAddressMismatch", "Safe Transaction Service record belongs to another Safe.", { expected: local.config.safe, actual: String(safe) });
  if (decimal(record.nonce, "nonce") !== local.transaction.nonce) fail("ES4225", "SafeServiceNonceMismatch", "Safe Transaction Service record nonce differs from the local Safe transaction.", { expected: local.transaction.nonce.toString(), actual: String(record.nonce) });

  if (typeof record.to !== "string" || !sameAddress(record.to, local.transaction.to)) payloadMismatch("to", local.transaction.to, record.to);
  if (decimal(record.value, "value") !== unwrapWei(local.transaction.value)) payloadMismatch("value", unwrapWei(local.transaction.value).toString(), record.value);
  if (normalizedData(record.data).toLowerCase() !== local.transaction.data.toLowerCase()) payloadMismatch("data", local.transaction.data, record.data);
  if (numberCount(record.operation, "operation") !== local.transaction.operation) payloadMismatch("operation", String(local.transaction.operation), record.operation);
  if (decimal(record.safeTxGas, "safeTxGas") !== local.transaction.safeTxGas) payloadMismatch("safeTxGas", local.transaction.safeTxGas.toString(), record.safeTxGas);
  if (decimal(record.baseGas, "baseGas") !== local.transaction.baseGas) payloadMismatch("baseGas", local.transaction.baseGas.toString(), record.baseGas);
  if (decimal(record.gasPrice, "gasPrice") !== local.transaction.gasPrice) payloadMismatch("gasPrice", local.transaction.gasPrice.toString(), record.gasPrice);
  const gasToken = normalizedNullableAddress(record.gasToken, "gasToken");
  if (!sameAddress(gasToken, local.transaction.gasToken)) payloadMismatch("gasToken", local.transaction.gasToken, record.gasToken);
  const refundReceiver = normalizedNullableAddress(record.refundReceiver, "refundReceiver");
  if (!sameAddress(refundReceiver, local.transaction.refundReceiver)) payloadMismatch("refundReceiver", local.transaction.refundReceiver, record.refundReceiver);
}

export async function readSafeServiceEvidence<C extends EvmChain>(service: SafeTransactionServiceLike, transaction: SafeCreatedTransaction<C>): Promise<SafeServiceEvidence<C>> {
  const getTransaction = action<string, ServiceTransactionRecord>(service, "getTransaction") as unknown as (safeTxHash: string) => Promise<ServiceTransactionRecord>;
  const getConfirmations = action<string, ServiceConfirmationList>(service, "getTransactionConfirmations") as unknown as (safeTxHash: string) => Promise<ServiceConfirmationList>;
  const [record, confirmations] = await Promise.all([
    getTransaction(transaction.safeTxHash),
    getConfirmations(transaction.safeTxHash),
  ]);
  assertServiceTransactionMatches(transaction, record);

  const confirmationsSubmitted = confirmationCount(confirmations);
  const confirmationsRequired = record.confirmationsRequired === undefined
    ? transaction.config.threshold
    : numberCount(record.confirmationsRequired, "confirmationsRequired");
  if (confirmationsRequired !== transaction.config.threshold) fail("ES4227", "SafeServiceThresholdMismatch", "Safe service confirmationsRequired differs from the locally declared Safe threshold.", { local: transaction.config.threshold, service: confirmationsRequired });

  const transactionHashValue = record.transactionHash;
  const executionTransactionHash = transactionHashValue === null || transactionHashValue === undefined
    ? undefined
    : typeof transactionHashValue === "string"
      ? transactionHash(transactionHashValue, transaction.config.chain)
      : fail("ES4221", "MalformedSafeServiceRecord", "Safe service transactionHash must be a hash string or null.");
  if (record.isExecuted !== undefined && typeof record.isExecuted !== "boolean") fail("ES4221", "MalformedSafeServiceRecord", "Safe service isExecuted must be boolean when present.");
  if (record.isSuccessful !== undefined && record.isSuccessful !== null && typeof record.isSuccessful !== "boolean") fail("ES4221", "MalformedSafeServiceRecord", "Safe service isSuccessful must be boolean or null when present.");
  const executedReported = record.isExecuted === true;
  if (executedReported && !executionTransactionHash) fail("ES4229", "SafeServiceExecutionHashMissing", "Safe service reports execution but does not provide the Ethereum execution transaction hash.");
  if (!executedReported && executionTransactionHash) fail("ES4230", "SafeServiceExecutionStateMismatch", "Safe service provides an execution transaction hash while isExecuted is false.", { transactionHash: executionTransactionHash });
  const trusted = record.trusted;
  if (trusted !== undefined && typeof trusted !== "boolean") fail("ES4221", "MalformedSafeServiceRecord", "Safe service trusted flag must be boolean when present.");

  return {
    kind: "safe-service-evidence",
    service: serviceName(service),
    chain: transaction.config.chain,
    safe: transaction.config.safe,
    safeTxHash: hash(transaction.safeTxHash, "safe-tx"),
    nonce: transaction.transaction.nonce,
    confirmationsSubmitted,
    confirmationsRequired,
    readyByCount: confirmationsSubmitted >= confirmationsRequired,
    executedReported,
    ...(record.isSuccessful === true || record.isSuccessful === false ? { successfulReported: record.isSuccessful } : {}),
    ...(executionTransactionHash ? { executionTransactionHash } : {}),
    ...(trusted !== undefined ? { serviceTrustedFlag: trusted } : {}),
  };
}

/**
 * Transaction Service evidence is coordination evidence only. It cannot promote a Safe
 * transaction to `executed`; on-chain ExecutionSuccess/ExecutionFailure evidence is required.
 */
export function assertSafeServiceReadyByCount(evidence: SafeServiceEvidence): SafeServiceEvidence {
  if (!evidence.readyByCount) fail("ES4228", "SafeServiceThresholdNotReached", "Safe Transaction Service has not collected the configured number of confirmations.", { submitted: evidence.confirmationsSubmitted, required: evidence.confirmationsRequired });
  return evidence;
}
