import { keccak256, stringToHex, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { EraDiagnosticError } from "../diagnostics.js";
import type { SignedEip7702Authorization } from "./eip7702.js";
import { toViemAuthorization } from "./eip7702.js";
import {
  address,
  blockHash,
  hash,
  transactionHash,
  type Address,
  type BlockHash,
  type EvmChain,
  type Hash,
  type TransactionHash,
} from "./types.js";

export type EraEntryPointVersion = "0.8" | "0.9";

declare const userOpBrand: unique symbol;
export type UserOperationHash<C extends EvmChain = EvmChain> = Hash<"erc4337-userop"> & { readonly [userOpBrand]: C["name"] };
export type UserOperationPayloadHash = Hash<"erc4337-submission">;

export interface EntryPointBinding<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion> {
  readonly chain: C;
  readonly address: Address<C>;
  readonly version: V;
}

export interface UserOperationDraft<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion> {
  readonly state: "userop-draft";
  readonly entryPoint: EntryPointBinding<C, V>;
  readonly sender: Address<C>;
  readonly nonce: bigint;
  readonly factory?: Address<C>;
  readonly factoryData?: Hex;
  readonly callData: Hex;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly paymaster?: Address<C>;
  readonly paymasterVerificationGasLimit?: bigint;
  readonly paymasterPostOpGasLimit?: bigint;
  readonly paymasterData?: Hex;
  readonly paymasterSignature?: Hex;
  readonly eip7702Auth?: SignedEip7702Authorization<C>;
  readonly signatureStub: Hex;
}

export interface PreparedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<UserOperationDraft<C, V>, "state"> {
  readonly state: "userop-prepared";
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly userOpHash: UserOperationHash<C>;
  readonly gasEstimatedWithStateOverride: boolean;
}

export interface SignedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<PreparedUserOperation<C, V>, "state"> {
  readonly state: "userop-signed";
  readonly signature: Hex;
  readonly signatureVerifier: string;
  readonly submissionPayloadHash: UserOperationPayloadHash;
}

export interface SubmittedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<SignedUserOperation<C, V>, "state"> {
  readonly state: "userop-submitted";
  readonly submittedAt: number;
}

export interface PendingUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<SubmittedUserOperation<C, V>, "state"> {
  readonly state: "userop-pending";
  readonly observedAt: number;
}

export interface UserOperationExecutionEvidence<C extends EvmChain = EvmChain> {
  readonly userOpHash: UserOperationHash<C>;
  readonly sender: Address<C>;
  readonly nonce: bigint;
  readonly entryPoint: Address<C>;
  readonly paymaster?: Address<C>;
  readonly success: boolean;
  readonly reason?: string;
  readonly actualGasCost: bigint;
  readonly actualGasUsed: bigint;
  readonly outerTransactionHash: TransactionHash<C>;
  readonly blockHash: BlockHash<C>;
  readonly blockNumber: bigint;
}

export interface IncludedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<SubmittedUserOperation<C, V>, "state"> {
  readonly state: "userop-included";
  readonly execution: UserOperationExecutionEvidence<C> & { readonly success: true };
}

export interface FailedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<SubmittedUserOperation<C, V>, "state"> {
  readonly state: "userop-execution-failed";
  readonly execution: UserOperationExecutionEvidence<C> & { readonly success: false };
}

export interface ConfirmedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<IncludedUserOperation<C, V>, "state"> {
  readonly state: "userop-confirmed";
  readonly confirmations: number;
}

export interface FinalizedUserOperation<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion>
  extends Omit<ConfirmedUserOperation<C, V>, "state"> {
  readonly state: "userop-finalized";
}

export interface BundlerClientLike {
  readonly chain?: { readonly id: number; readonly name?: string };
}

export interface UserOperationSignatureVerifierInput<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion> {
  readonly entryPoint: EntryPointBinding<C, V>;
  readonly sender: Address<C>;
  readonly userOpHash: UserOperationHash<C>;
  readonly signature: Hex;
  readonly userOperation: PreparedUserOperation<C, V>;
}

export type UserOperationSignatureVerifier<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion> = (
  input: UserOperationSignatureVerifierInput<C, V>,
) => boolean | Promise<boolean>;

type UserOperationGasEstimate = {
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly paymasterVerificationGasLimit?: bigint;
  readonly paymasterPostOpGasLimit?: bigint;
};

type BundlerReceipt = {
  readonly actualGasCost: bigint;
  readonly actualGasUsed: bigint;
  readonly entryPoint: string;
  readonly nonce: bigint;
  readonly paymaster?: string;
  readonly reason?: string;
  readonly sender: string;
  readonly success: boolean;
  readonly userOpHash: string;
  readonly receipt: {
    readonly transactionHash: string;
    readonly blockHash: string;
    readonly blockNumber: bigint;
    readonly status?: "success" | "reverted";
  };
};

type UserOperationFields<C extends EvmChain, V extends EraEntryPointVersion> = Omit<UserOperationDraft<C, V>, "state"> & {
  readonly callGasLimit?: bigint;
  readonly verificationGasLimit?: bigint;
  readonly preVerificationGas?: bigint;
};

type SignedUserOperationFields<C extends EvmChain, V extends EraEntryPointVersion> = UserOperationFields<C, V> & {
  readonly signature: Hex;
  readonly signatureVerifier: string;
};

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function unsigned(value: bigint, field: string): bigint {
  if (value < 0n) fail("ES4300", "InvalidUserOperationInteger", `ERC-4337 ${field} cannot be negative.`, { field, value: value.toString() });
  return value;
}

function validHex(value: string, field: string): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail("ES4301", "InvalidUserOperationHex", `${field} must be whole-byte 0x-prefixed hexadecimal.`, { field });
  return value as Hex;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function action<A, R>(client: BundlerClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4302", "MissingBundlerAction", `The supplied Bundler client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

function assertBundlerChain<C extends EvmChain>(client: BundlerClientLike, chain: C): void {
  if (client.chain && client.chain.id !== chain.id) fail("ES3104", "ChainMismatch", "Bundler client chain does not match the UserOperation chain.", { expected: chain.id, actual: client.chain.id });
}

function validatePaymasterDraft<C extends EvmChain, V extends EraEntryPointVersion>(draft: UserOperationDraft<C, V>): void {
  if (!draft.paymaster) {
    if (draft.paymasterVerificationGasLimit !== undefined || draft.paymasterPostOpGasLimit !== undefined || draft.paymasterData !== undefined || draft.paymasterSignature !== undefined) {
      fail("ES4303", "UnboundPaymasterFields", "Paymaster fields cannot be present without a paymaster address.");
    }
    return;
  }
  if (draft.paymasterVerificationGasLimit !== undefined) unsigned(draft.paymasterVerificationGasLimit, "paymasterVerificationGasLimit");
  if (draft.paymasterPostOpGasLimit !== undefined) unsigned(draft.paymasterPostOpGasLimit, "paymasterPostOpGasLimit");
  if (draft.paymasterData !== undefined) validHex(draft.paymasterData, "paymasterData");
  if (draft.paymasterSignature !== undefined) {
    if (draft.entryPoint.version !== "0.9") fail("ES4305", "UnsupportedPaymasterSignature", "Separated paymasterSignature requires EntryPoint v0.9.", { version: draft.entryPoint.version });
    validHex(draft.paymasterSignature, "paymasterSignature");
  }
}

export function createUserOperationDraft<C extends EvmChain, V extends EraEntryPointVersion>(input: {
  entryPoint: EntryPointBinding<C, V>;
  sender: Address<C>;
  nonce: bigint;
  factory?: Address<C>;
  factoryData?: Hex;
  callData: Hex;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: Address<C>;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: Hex;
  paymasterSignature?: Hex;
  eip7702Auth?: SignedEip7702Authorization<C>;
  signatureStub?: Hex;
}): UserOperationDraft<C, V> {
  unsigned(input.nonce, "nonce");
  unsigned(input.maxFeePerGas, "maxFeePerGas");
  unsigned(input.maxPriorityFeePerGas, "maxPriorityFeePerGas");
  if (input.maxPriorityFeePerGas > input.maxFeePerGas) fail("ES4306", "InvalidUserOperationFees", "maxPriorityFeePerGas cannot exceed maxFeePerGas.");
  validHex(input.callData, "callData");
  if (input.factoryData !== undefined && !input.factory) fail("ES4307", "FactoryDataWithoutFactory", "factoryData cannot be present without factory.");
  if (input.factoryData !== undefined) validHex(input.factoryData, "factoryData");
  if (input.eip7702Auth) {
    if (!sameAddress(input.eip7702Auth.authority, input.sender)) fail("ES4308", "UserOperationAuthorizationAuthorityMismatch", "EIP-7702 authorization authority must match the UserOperation sender.", { sender: input.sender, authority: input.eip7702Auth.authority });
    if (input.eip7702Auth.chain.id !== input.entryPoint.chain.id) fail("ES3104", "ChainMismatch", "EIP-7702 authorization and UserOperation EntryPoint are bound to different chains.");
    if (input.eip7702Auth.executor !== "relayer") fail("ES4309", "InvalidUserOperationAuthorizationExecutor", "ERC-4337 EIP-7702 authorization must use relayer execution semantics because the bundler submits the outer transaction.");
    if (input.factory) fail("ES4310", "FactoryAndEip7702AuthorizationConflict", "Factory deployment and EIP-7702 authorization cannot be combined in one EraScript UserOperation profile.");
  }
  const draft: UserOperationDraft<C, V> = {
    state: "userop-draft",
    entryPoint: input.entryPoint,
    sender: input.sender,
    nonce: input.nonce,
    ...(input.factory ? { factory: input.factory } : {}),
    ...(input.factoryData !== undefined ? { factoryData: input.factoryData } : {}),
    callData: input.callData,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    ...(input.paymaster ? { paymaster: input.paymaster } : {}),
    ...(input.paymasterVerificationGasLimit !== undefined ? { paymasterVerificationGasLimit: input.paymasterVerificationGasLimit } : {}),
    ...(input.paymasterPostOpGasLimit !== undefined ? { paymasterPostOpGasLimit: input.paymasterPostOpGasLimit } : {}),
    ...(input.paymasterData !== undefined ? { paymasterData: input.paymasterData } : {}),
    ...(input.paymasterSignature !== undefined ? { paymasterSignature: input.paymasterSignature } : {}),
    ...(input.eip7702Auth ? { eip7702Auth: input.eip7702Auth } : {}),
    signatureStub: validHex(input.signatureStub ?? "0x", "signatureStub"),
  };
  validatePaymasterDraft(draft);
  return draft;
}

function viemUserOperation<C extends EvmChain, V extends EraEntryPointVersion>(operation: UserOperationFields<C, V>, signature: Hex): Record<string, unknown> {
  return {
    sender: operation.sender,
    nonce: operation.nonce,
    ...(operation.factory ? { factory: operation.factory } : {}),
    ...(operation.factoryData !== undefined ? { factoryData: operation.factoryData } : {}),
    callData: operation.callData,
    ...(operation.callGasLimit !== undefined ? { callGasLimit: operation.callGasLimit } : {}),
    ...(operation.verificationGasLimit !== undefined ? { verificationGasLimit: operation.verificationGasLimit } : {}),
    ...(operation.preVerificationGas !== undefined ? { preVerificationGas: operation.preVerificationGas } : {}),
    maxFeePerGas: operation.maxFeePerGas,
    maxPriorityFeePerGas: operation.maxPriorityFeePerGas,
    ...(operation.paymaster ? { paymaster: operation.paymaster } : {}),
    ...(operation.paymasterVerificationGasLimit !== undefined ? { paymasterVerificationGasLimit: operation.paymasterVerificationGasLimit } : {}),
    ...(operation.paymasterPostOpGasLimit !== undefined ? { paymasterPostOpGasLimit: operation.paymasterPostOpGasLimit } : {}),
    ...(operation.paymasterData !== undefined ? { paymasterData: operation.paymasterData } : {}),
    ...(operation.paymasterSignature !== undefined ? { paymasterSignature: operation.paymasterSignature } : {}),
    ...(operation.eip7702Auth ? { authorization: toViemAuthorization(operation.eip7702Auth) } : {}),
    signature,
  };
}

function computeUserOperationHash<C extends EvmChain, V extends EraEntryPointVersion>(operation: UserOperationFields<C, V>): UserOperationHash<C> {
  const getHash = getUserOperationHash as unknown as (parameters: {
    chainId: number;
    entryPointAddress: string;
    entryPointVersion: EraEntryPointVersion;
    userOperation: Record<string, unknown>;
  }) => Hex;
  const value = getHash({
    chainId: operation.entryPoint.chain.id,
    entryPointAddress: operation.entryPoint.address,
    entryPointVersion: operation.entryPoint.version,
    userOperation: viemUserOperation(operation, operation.signatureStub),
  });
  return hash(value, "erc4337-userop") as UserOperationHash<C>;
}

export function userOperationHash<C extends EvmChain, V extends EraEntryPointVersion>(operation: PreparedUserOperation<C, V>): UserOperationHash<C> {
  return computeUserOperationHash(operation);
}

export async function prepareUserOperationWithBundler<C extends EvmChain, V extends EraEntryPointVersion>(client: BundlerClientLike, draft: UserOperationDraft<C, V>, options: { stateOverride?: unknown } = {}): Promise<PreparedUserOperation<C, V>> {
  assertBundlerChain(client, draft.entryPoint.chain);
  const estimate = action<Record<string, unknown>, UserOperationGasEstimate>(client, "estimateUserOperationGas");
  const result = await estimate({
    ...viemUserOperation(draft, draft.signatureStub),
    entryPointAddress: draft.entryPoint.address,
    ...(options.stateOverride !== undefined ? { stateOverride: options.stateOverride } : {}),
  });
  unsigned(result.callGasLimit, "callGasLimit");
  unsigned(result.verificationGasLimit, "verificationGasLimit");
  unsigned(result.preVerificationGas, "preVerificationGas");

  let paymasterVerificationGasLimit = draft.paymasterVerificationGasLimit;
  let paymasterPostOpGasLimit = draft.paymasterPostOpGasLimit;
  if (draft.paymaster) {
    if (draft.paymasterVerificationGasLimit !== undefined && result.paymasterVerificationGasLimit !== undefined && result.paymasterVerificationGasLimit !== draft.paymasterVerificationGasLimit) {
      fail("ES4311", "PaymasterGasEstimateMismatch", "Bundler paymasterVerificationGasLimit differs from the declared paymaster value. Rebuild paymaster evidence before signing.", { declared: draft.paymasterVerificationGasLimit.toString(), estimated: result.paymasterVerificationGasLimit.toString() });
    }
    if (draft.paymasterPostOpGasLimit !== undefined && result.paymasterPostOpGasLimit !== undefined && result.paymasterPostOpGasLimit !== draft.paymasterPostOpGasLimit) {
      fail("ES4311", "PaymasterGasEstimateMismatch", "Bundler paymasterPostOpGasLimit differs from the declared paymaster value. Rebuild paymaster evidence before signing.", { declared: draft.paymasterPostOpGasLimit.toString(), estimated: result.paymasterPostOpGasLimit.toString() });
    }
    paymasterVerificationGasLimit ??= result.paymasterVerificationGasLimit;
    paymasterPostOpGasLimit ??= result.paymasterPostOpGasLimit;
    if (paymasterVerificationGasLimit === undefined || paymasterPostOpGasLimit === undefined) {
      fail("ES4304", "IncompletePaymasterGas", "Paymaster-backed UserOperation still lacks verification/postOp gas after Bundler estimation.");
    }
    unsigned(paymasterVerificationGasLimit, "paymasterVerificationGasLimit");
    unsigned(paymasterPostOpGasLimit, "paymasterPostOpGasLimit");
  }

  const fields: UserOperationFields<C, V> = {
    entryPoint: draft.entryPoint,
    sender: draft.sender,
    nonce: draft.nonce,
    ...(draft.factory ? { factory: draft.factory } : {}),
    ...(draft.factoryData !== undefined ? { factoryData: draft.factoryData } : {}),
    callData: draft.callData,
    maxFeePerGas: draft.maxFeePerGas,
    maxPriorityFeePerGas: draft.maxPriorityFeePerGas,
    ...(draft.paymaster ? { paymaster: draft.paymaster } : {}),
    ...(paymasterVerificationGasLimit !== undefined ? { paymasterVerificationGasLimit } : {}),
    ...(paymasterPostOpGasLimit !== undefined ? { paymasterPostOpGasLimit } : {}),
    ...(draft.paymasterData !== undefined ? { paymasterData: draft.paymasterData } : {}),
    ...(draft.paymasterSignature !== undefined ? { paymasterSignature: draft.paymasterSignature } : {}),
    ...(draft.eip7702Auth ? { eip7702Auth: draft.eip7702Auth } : {}),
    signatureStub: draft.signatureStub,
    callGasLimit: result.callGasLimit,
    verificationGasLimit: result.verificationGasLimit,
    preVerificationGas: result.preVerificationGas,
  };

  const userOpHash = computeUserOperationHash(fields);
  return {
    state: "userop-prepared",
    ...fields,
    callGasLimit: result.callGasLimit,
    verificationGasLimit: result.verificationGasLimit,
    preVerificationGas: result.preVerificationGas,
    userOpHash,
    gasEstimatedWithStateOverride: options.stateOverride !== undefined,
  };
}

export async function attachUserOperationSignature<C extends EvmChain, V extends EraEntryPointVersion>(prepared: PreparedUserOperation<C, V>, input: {
  signature: Hex;
  verifier: UserOperationSignatureVerifier<C, V>;
  verifierName: string;
}): Promise<SignedUserOperation<C, V>> {
  validHex(input.signature, "signature");
  const verified = await input.verifier({ entryPoint: prepared.entryPoint, sender: prepared.sender, userOpHash: prepared.userOpHash, signature: input.signature, userOperation: prepared });
  if (!verified) fail("ES4312", "UserOperationSignatureVerificationFailed", "Account-defined UserOperation signature verifier rejected the signature.", { sender: prepared.sender, verifier: input.verifierName });
  const signedBase: SignedUserOperationFields<C, V> = { ...prepared, signature: input.signature, signatureVerifier: input.verifierName };
  return {
    ...prepared,
    state: "userop-signed",
    signature: input.signature,
    signatureVerifier: input.verifierName,
    submissionPayloadHash: userOperationSubmissionPayloadHash(signedBase),
  };
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, item]) => [key, normalizeJsonValue(item)]));
  }
  return value;
}

export function userOperationSubmissionPayloadHash<C extends EvmChain, V extends EraEntryPointVersion>(operation: SignedUserOperationFields<C, V>): UserOperationPayloadHash {
  const normalized = {
    chainId: operation.entryPoint.chain.id,
    entryPoint: operation.entryPoint.address,
    entryPointVersion: operation.entryPoint.version,
    userOperation: normalizeJsonValue(viemUserOperation(operation, operation.signature)),
  };
  return hash(keccak256(stringToHex(JSON.stringify(normalized))), "erc4337-submission") as UserOperationPayloadHash;
}

export async function assertBundlerSupportsEntryPoint<C extends EvmChain, V extends EraEntryPointVersion>(client: BundlerClientLike, entryPoint: EntryPointBinding<C, V>): Promise<void> {
  assertBundlerChain(client, entryPoint.chain);
  const maybe = (client as unknown as Record<string, unknown>).getSupportedEntryPoints;
  if (typeof maybe !== "function") return;
  const supported = await (maybe.bind(client) as () => Promise<readonly string[]>)();
  if (!supported.some((candidate) => sameAddress(candidate, entryPoint.address))) fail("ES4313", "UnsupportedEntryPoint", "Bundler does not advertise support for the bound EntryPoint.", { entryPoint: entryPoint.address, supported });
}

export async function submitUserOperationToBundler<C extends EvmChain, V extends EraEntryPointVersion>(client: BundlerClientLike, signed: SignedUserOperation<C, V>): Promise<SubmittedUserOperation<C, V>> {
  await assertBundlerSupportsEntryPoint(client, signed.entryPoint);
  if (signed.gasEstimatedWithStateOverride) fail("ES4314", "HypotheticalUserOperationGasRejected", "UserOperation gas estimated with state override is rejected for submission by default. Re-estimate against real state.");
  const currentPayloadHash = userOperationSubmissionPayloadHash(signed);
  if (currentPayloadHash.toLowerCase() !== signed.submissionPayloadHash.toLowerCase()) fail("ES4316", "UserOperationPayloadMutated", "Signed UserOperation payload changed after signature verification.", { signedPayloadHash: signed.submissionPayloadHash, currentPayloadHash });

  const send = action<Record<string, unknown>, Hex>(client, "sendUserOperation");
  const returned = await send({ ...viemUserOperation(signed, signed.signature), entryPointAddress: signed.entryPoint.address });
  const checked = hash(returned, "erc4337-userop") as UserOperationHash<C>;
  if (checked.toLowerCase() !== signed.userOpHash.toLowerCase()) fail("ES4315", "BundlerUserOperationHashMismatch", "Bundler returned a UserOperation hash different from EraScript's locally computed hash.", { local: signed.userOpHash, returned: checked });
  return { ...signed, state: "userop-submitted", submittedAt: Date.now() };
}

export async function getUserOperationReceiptFromBundler<C extends EvmChain, V extends EraEntryPointVersion>(client: BundlerClientLike, submitted: SubmittedUserOperation<C, V>): Promise<PendingUserOperation<C, V> | IncludedUserOperation<C, V> | FailedUserOperation<C, V>> {
  assertBundlerChain(client, submitted.entryPoint.chain);
  const getReceipt = action<{ hash: Hex }, BundlerReceipt | null>(client, "getUserOperationReceipt");
  const receipt = await getReceipt({ hash: submitted.userOpHash });
  if (!receipt) return { ...submitted, state: "userop-pending", observedAt: Date.now() };
  if (!sameAddress(receipt.entryPoint, submitted.entryPoint.address)) fail("ES4317", "UserOperationReceiptEntryPointMismatch", "Bundler receipt references another EntryPoint.", { expected: submitted.entryPoint.address, actual: receipt.entryPoint });
  if (!sameAddress(receipt.sender, submitted.sender) || receipt.nonce !== submitted.nonce) fail("ES4318", "UserOperationReceiptIdentityMismatch", "Bundler receipt sender/nonce does not match the submitted UserOperation.", { expectedSender: submitted.sender, actualSender: receipt.sender, expectedNonce: submitted.nonce.toString(), actualNonce: receipt.nonce.toString() });
  const receiptHash = hash(receipt.userOpHash, "erc4337-userop") as UserOperationHash<C>;
  if (receiptHash.toLowerCase() !== submitted.userOpHash.toLowerCase()) fail("ES4319", "UserOperationReceiptHashMismatch", "Bundler receipt references another UserOperation hash.");
  if (receipt.receipt.status === "reverted") fail("ES4320", "EntryPointTransactionReverted", "The outer EntryPoint transaction reverted; UserOperation receipt cannot be accepted as execution evidence.");

  const evidence: UserOperationExecutionEvidence<C> = {
    userOpHash: receiptHash,
    sender: submitted.sender,
    nonce: submitted.nonce,
    entryPoint: submitted.entryPoint.address,
    ...(receipt.paymaster ? { paymaster: address(receipt.paymaster, submitted.entryPoint.chain, "userOperation.receipt.paymaster") } : {}),
    success: receipt.success,
    ...(receipt.reason ? { reason: receipt.reason } : {}),
    actualGasCost: unsigned(receipt.actualGasCost, "actualGasCost"),
    actualGasUsed: unsigned(receipt.actualGasUsed, "actualGasUsed"),
    outerTransactionHash: transactionHash(receipt.receipt.transactionHash, submitted.entryPoint.chain),
    blockHash: blockHash(receipt.receipt.blockHash, submitted.entryPoint.chain),
    blockNumber: unsigned(receipt.receipt.blockNumber, "blockNumber"),
  };
  if (!receipt.success) return { ...submitted, state: "userop-execution-failed", execution: evidence as UserOperationExecutionEvidence<C> & { success: false } };
  return { ...submitted, state: "userop-included", execution: evidence as UserOperationExecutionEvidence<C> & { success: true } };
}

export async function confirmUserOperationFromRpc<C extends EvmChain, V extends EraEntryPointVersion>(client: BundlerClientLike, included: IncludedUserOperation<C, V>, confirmations: number): Promise<ConfirmedUserOperation<C, V>> {
  if (!Number.isSafeInteger(confirmations) || confirmations < 1) fail("ES4321", "InvalidUserOperationConfirmationCount", "UserOperation confirmation count must be a positive safe integer.", { confirmations });
  const canonical = await action<{ blockNumber: bigint }, { number: bigint | null; hash: string | null }>(client, "getBlock")({ blockNumber: included.execution.blockNumber });
  if (!canonical.hash || canonical.hash.toLowerCase() !== included.execution.blockHash.toLowerCase()) fail("ES4322", "UserOperationReorgDetected", "UserOperation execution block is no longer canonical.", { blockNumber: included.execution.blockNumber.toString(), expected: included.execution.blockHash, actual: canonical.hash ?? null });
  const observed = await action<{ hash: Hex }, bigint>(client, "getTransactionConfirmations")({ hash: included.execution.outerTransactionHash });
  if (observed < BigInt(confirmations)) fail("ES4323", "InsufficientUserOperationConfirmations", "UserOperation execution transaction has not reached the required confirmation count.", { required: confirmations, observed: observed.toString() });
  return { ...included, state: "userop-confirmed", confirmations };
}

export async function finalizeUserOperationFromRpc<C extends EvmChain, V extends EraEntryPointVersion>(client: BundlerClientLike, confirmed: ConfirmedUserOperation<C, V>): Promise<FinalizedUserOperation<C, V>> {
  const canonical = await action<{ blockNumber: bigint }, { number: bigint | null; hash: string | null }>(client, "getBlock")({ blockNumber: confirmed.execution.blockNumber });
  if (!canonical.hash || canonical.hash.toLowerCase() !== confirmed.execution.blockHash.toLowerCase()) fail("ES4322", "UserOperationReorgDetected", "UserOperation execution block is no longer canonical.");
  const finalized = await action<{ blockTag: "finalized" }, { number: bigint | null; hash: string | null }>(client, "getBlock")({ blockTag: "finalized" });
  if (finalized.number === null) fail("ES4324", "FinalizedBlockUnavailable", "RPC did not return a concrete finalized block number for UserOperation verification.");
  if (finalized.number < confirmed.execution.blockNumber) fail("ES4325", "UserOperationNotFinalized", "UserOperation execution block has not reached finalized state.", { executionBlock: confirmed.execution.blockNumber.toString(), finalizedBlock: finalized.number.toString() });
  return { ...confirmed, state: "userop-finalized" };
}
