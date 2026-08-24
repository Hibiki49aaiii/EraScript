import { hashTypedData, recoverAddress, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  blockHash,
  hash,
  transactionHash,
  type Address,
  type BlockHash,
  type Calldata,
  type EvmChain,
  type Hash,
  type TransactionHash,
} from "./types.js";
import { unwrapWei, type Wei } from "./values.js";

export type SafeOperation = 0 | 1;
export type SafeSignatureScheme = "eip712" | "eth_sign" | "eip1271" | "prevalidated" | "custom";

declare const safeTxBrand: unique symbol;
export type SafeTxHash<C extends EvmChain = EvmChain> = Hash<"safe-tx"> & { readonly [safeTxBrand]: C["name"] };

export interface SafeConfig<C extends EvmChain = EvmChain> {
  readonly chain: C;
  readonly safe: Address<C>;
  readonly owners: readonly Address<C>[];
  readonly threshold: number;
  readonly nonce: bigint;
}

export interface SafeTransactionData<C extends EvmChain = EvmChain> {
  readonly to: Address<C>;
  readonly value: Wei;
  readonly data: Calldata | Hex;
  readonly operation: SafeOperation;
  readonly safeTxGas: bigint;
  readonly baseGas: bigint;
  readonly gasPrice: bigint;
  readonly gasToken: Address<C>;
  readonly refundReceiver: Address<C>;
  readonly nonce: bigint;
}

export interface SafeCreatedTransaction<C extends EvmChain = EvmChain> {
  readonly state: "created";
  readonly config: SafeConfig<C>;
  readonly transaction: SafeTransactionData<C>;
  readonly safeTxHash: SafeTxHash<C>;
}

export interface VerifiedSafeConfirmation<C extends EvmChain = EvmChain> {
  readonly kind: "safe-confirmation";
  readonly owner: Address<C>;
  readonly safeTxHash: SafeTxHash<C>;
  readonly signature: Hex;
  readonly scheme: SafeSignatureScheme;
  readonly verified: true;
  readonly verifier?: string;
}

export interface SafeProposedTransaction<C extends EvmChain = EvmChain> extends Omit<SafeCreatedTransaction<C>, "state"> {
  readonly state: "proposed";
  readonly confirmations: readonly VerifiedSafeConfirmation<C>[];
}

export interface SafePartiallySignedTransaction<C extends EvmChain = EvmChain> extends Omit<SafeCreatedTransaction<C>, "state"> {
  readonly state: "partially-signed";
  readonly confirmations: readonly VerifiedSafeConfirmation<C>[];
}

export interface SafeThresholdReachedTransaction<C extends EvmChain = EvmChain> extends Omit<SafeCreatedTransaction<C>, "state"> {
  readonly state: "threshold-reached";
  readonly confirmations: readonly VerifiedSafeConfirmation<C>[];
}

export interface SafeExecutableTransaction<C extends EvmChain = EvmChain> extends Omit<SafeThresholdReachedTransaction<C>, "state"> {
  readonly state: "executable";
  readonly observedSafeNonce: bigint;
}

export interface SafeExecutionEvidence<C extends EvmChain = EvmChain> {
  readonly outerTransactionHash: TransactionHash<C>;
  readonly blockHash: BlockHash<C>;
  readonly blockNumber: bigint;
  readonly outerReceiptStatus: "success";
  readonly safeEvent: "ExecutionSuccess" | "ExecutionFailure";
  readonly eventSafeTxHash: SafeTxHash<C>;
}

export interface SafeExecutedTransaction<C extends EvmChain = EvmChain> extends Omit<SafeExecutableTransaction<C>, "state"> {
  readonly state: "executed";
  readonly execution: SafeExecutionEvidence<C> & { readonly safeEvent: "ExecutionSuccess" };
}

export interface SafeExecutionFailedTransaction<C extends EvmChain = EvmChain> extends Omit<SafeExecutableTransaction<C>, "state"> {
  readonly state: "execution-failed";
  readonly execution: SafeExecutionEvidence<C> & { readonly safeEvent: "ExecutionFailure" };
}

export interface SafeConfirmationVerifierInput<C extends EvmChain = EvmChain> {
  readonly owner: Address<C>;
  readonly safeTxHash: SafeTxHash<C>;
  readonly signature: Hex;
  readonly scheme: SafeSignatureScheme;
}

export type SafeConfirmationVerifier<C extends EvmChain = EvmChain> = (
  input: SafeConfirmationVerifierInput<C>,
) => boolean | Promise<boolean>;

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function unsigned(value: bigint, field: string): bigint {
  if (value < 0n) fail("ES4200", "InvalidSafeInteger", `Safe ${field} cannot be negative.`, { field, value: value.toString() });
  return value;
}

function validateSafeConfig<C extends EvmChain>(config: SafeConfig<C>): void {
  if (!Number.isSafeInteger(config.threshold) || config.threshold < 1 || config.threshold > config.owners.length) {
    fail("ES4201", "InvalidSafeThreshold", "Safe threshold must be between 1 and the number of declared owners.", { threshold: config.threshold, owners: config.owners.length });
  }
  if (config.owners.length === 0) fail("ES4202", "EmptySafeOwners", "Safe must declare at least one owner.");
  const unique = new Set(config.owners.map((owner) => owner.toLowerCase()));
  if (unique.size !== config.owners.length) fail("ES4203", "DuplicateSafeOwner", "Safe owner list contains duplicates.");
  unsigned(config.nonce, "nonce");
}

function validateSafeTransaction<C extends EvmChain>(config: SafeConfig<C>, transaction: SafeTransactionData<C>): void {
  if (transaction.nonce !== config.nonce) fail("ES4204", "SafeNonceMismatch", "Safe transaction nonce does not match the declared Safe configuration snapshot.", { configNonce: config.nonce.toString(), transactionNonce: transaction.nonce.toString() });
  if (transaction.operation !== 0 && transaction.operation !== 1) fail("ES4205", "InvalidSafeOperation", "Safe operation must be CALL (0) or DELEGATECALL (1).");
  unsigned(unwrapWei(transaction.value), "value");
  unsigned(transaction.safeTxGas, "safeTxGas");
  unsigned(transaction.baseGas, "baseGas");
  unsigned(transaction.gasPrice, "gasPrice");
}

export function safeTransactionHash<C extends EvmChain>(config: SafeConfig<C>, transaction: SafeTransactionData<C>): SafeTxHash<C> {
  validateSafeConfig(config);
  validateSafeTransaction(config, transaction);
  const digest = hashTypedData({
    domain: { chainId: config.chain.id, verifyingContract: config.safe },
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: transaction.to,
      value: unwrapWei(transaction.value),
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: transaction.safeTxGas,
      baseGas: transaction.baseGas,
      gasPrice: transaction.gasPrice,
      gasToken: transaction.gasToken,
      refundReceiver: transaction.refundReceiver,
      nonce: transaction.nonce,
    },
  });
  return hash(digest, "safe-tx") as SafeTxHash<C>;
}

export function createSafeTransaction<C extends EvmChain>(config: SafeConfig<C>, transaction: SafeTransactionData<C>): SafeCreatedTransaction<C> {
  return { state: "created", config, transaction, safeTxHash: safeTransactionHash(config, transaction) };
}

export async function verifySafeConfirmation<C extends EvmChain>(input: {
  transaction: Pick<SafeCreatedTransaction<C>, "config" | "safeTxHash">;
  owner: Address<C>;
  signature: Hex;
  scheme: SafeSignatureScheme;
  verifier?: SafeConfirmationVerifier<C>;
  verifierName?: string;
}): Promise<VerifiedSafeConfirmation<C>> {
  if (!input.transaction.config.owners.some((owner) => sameAddress(owner, input.owner))) fail("ES4206", "SafeConfirmationFromNonOwner", "Safe confirmation signer is not an owner in the declared Safe configuration.", { owner: input.owner });
  if (!/^0x[0-9a-fA-F]+$/.test(input.signature) || input.signature.length % 2 !== 0) fail("ES4207", "InvalidSafeSignature", "Safe signature must be whole-byte hexadecimal.");

  let valid = false;
  if (input.verifier) {
    valid = await input.verifier({ owner: input.owner, safeTxHash: input.transaction.safeTxHash, signature: input.signature, scheme: input.scheme });
  } else if (input.scheme === "eip712") {
    try {
      const recovered = await recoverAddress({ hash: input.transaction.safeTxHash, signature: input.signature });
      valid = sameAddress(recovered, input.owner);
    } catch {
      valid = false;
    }
  } else {
    fail("ES4208", "SafeSignatureVerifierRequired", "This Safe signature scheme requires an explicit verifier adapter.", { scheme: input.scheme });
  }

  if (!valid) fail("ES4209", "SafeSignatureVerificationFailed", "Safe confirmation signature did not verify for the declared owner.", { owner: input.owner, scheme: input.scheme });
  return {
    kind: "safe-confirmation",
    owner: input.owner,
    safeTxHash: input.transaction.safeTxHash,
    signature: input.signature,
    scheme: input.scheme,
    verified: true,
    ...(input.verifierName ? { verifier: input.verifierName } : {}),
  };
}

function assertConfirmation<C extends EvmChain>(transaction: SafeCreatedTransaction<C> | SafeProposedTransaction<C> | SafePartiallySignedTransaction<C> | SafeThresholdReachedTransaction<C>, confirmation: VerifiedSafeConfirmation<C>): void {
  if (confirmation.safeTxHash.toLowerCase() !== transaction.safeTxHash.toLowerCase()) fail("ES4210", "SafeConfirmationHashMismatch", "Safe confirmation belongs to a different Safe transaction hash.");
  if (!transaction.config.owners.some((owner) => sameAddress(owner, confirmation.owner))) fail("ES4206", "SafeConfirmationFromNonOwner", "Safe confirmation signer is not a declared owner.");
}

function uniqueConfirmations<C extends EvmChain>(confirmations: readonly VerifiedSafeConfirmation<C>[]): VerifiedSafeConfirmation<C>[] {
  const owners = new Set<string>();
  const result: VerifiedSafeConfirmation<C>[] = [];
  for (const confirmation of confirmations) {
    const key = confirmation.owner.toLowerCase();
    if (owners.has(key)) fail("ES4211", "DuplicateSafeConfirmation", "Safe transaction contains multiple confirmations from the same owner.", { owner: confirmation.owner });
    owners.add(key);
    result.push(confirmation);
  }
  return result;
}

export function proposeSafeTransaction<C extends EvmChain>(created: SafeCreatedTransaction<C>, confirmation: VerifiedSafeConfirmation<C>): SafeProposedTransaction<C> | SafeThresholdReachedTransaction<C> {
  assertConfirmation(created, confirmation);
  const confirmations = uniqueConfirmations([confirmation]);
  if (confirmations.length >= created.config.threshold) return { ...created, state: "threshold-reached", confirmations };
  return { ...created, state: "proposed", confirmations };
}

export function addSafeConfirmation<C extends EvmChain>(transaction: SafeProposedTransaction<C> | SafePartiallySignedTransaction<C>, confirmation: VerifiedSafeConfirmation<C>): SafePartiallySignedTransaction<C> | SafeThresholdReachedTransaction<C> {
  assertConfirmation(transaction, confirmation);
  const confirmations = uniqueConfirmations([...transaction.confirmations, confirmation]);
  if (confirmations.length >= transaction.config.threshold) return { ...transaction, state: "threshold-reached", confirmations };
  return { ...transaction, state: "partially-signed", confirmations };
}

export function markSafeExecutable<C extends EvmChain>(transaction: SafeThresholdReachedTransaction<C>, observedSafeNonce: bigint): SafeExecutableTransaction<C> {
  unsigned(observedSafeNonce, "observedSafeNonce");
  if (observedSafeNonce !== transaction.transaction.nonce) {
    const relation = observedSafeNonce > transaction.transaction.nonce ? "stale" : "future";
    fail("ES4212", "SafeExecutionNonceMismatch", "Safe transaction is not executable at the observed Safe nonce.", { transactionNonce: transaction.transaction.nonce.toString(), observedSafeNonce: observedSafeNonce.toString(), relation });
  }
  return { ...transaction, state: "executable", observedSafeNonce };
}

export function safeExecutionEvidence<C extends EvmChain>(transaction: SafeExecutableTransaction<C>, input: {
  outerTransactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  outerReceiptStatus: "success" | "reverted";
  safeEvent: "ExecutionSuccess" | "ExecutionFailure";
  eventSafeTxHash: string;
}): SafeExecutionEvidence<C> {
  if (input.outerReceiptStatus !== "success") fail("ES4213", "SafeOuterTransactionReverted", "Outer Ethereum transaction reverted before Safe execution evidence could be accepted.");
  const eventHash = hash(input.eventSafeTxHash, "safe-tx") as SafeTxHash<C>;
  if (eventHash.toLowerCase() !== transaction.safeTxHash.toLowerCase()) fail("ES4214", "SafeExecutionEventHashMismatch", "Safe execution event refers to a different SafeTxHash.", { expected: transaction.safeTxHash, actual: eventHash });
  return {
    outerTransactionHash: transactionHash(input.outerTransactionHash, transaction.config.chain),
    blockHash: blockHash(input.blockHash, transaction.config.chain),
    blockNumber: unsigned(input.blockNumber, "blockNumber"),
    outerReceiptStatus: "success",
    safeEvent: input.safeEvent,
    eventSafeTxHash: eventHash,
  };
}

export function markSafeExecution<C extends EvmChain>(transaction: SafeExecutableTransaction<C>, evidence: SafeExecutionEvidence<C>): SafeExecutedTransaction<C> | SafeExecutionFailedTransaction<C> {
  if (evidence.eventSafeTxHash.toLowerCase() !== transaction.safeTxHash.toLowerCase()) fail("ES4214", "SafeExecutionEventHashMismatch", "Safe execution evidence refers to another Safe transaction.");
  if (evidence.safeEvent === "ExecutionFailure") return { ...transaction, state: "execution-failed", execution: evidence as SafeExecutionEvidence<C> & { safeEvent: "ExecutionFailure" } };
  return { ...transaction, state: "executed", execution: evidence as SafeExecutionEvidence<C> & { safeEvent: "ExecutionSuccess" } };
}
