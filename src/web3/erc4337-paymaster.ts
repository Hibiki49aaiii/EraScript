import { keccak256, stringToHex, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import {
  createUserOperationDraft,
  userOperationHash,
  type EraEntryPointVersion,
  type PreparedUserOperation,
  type UserOperationDraft,
} from "./erc4337.js";
import { toViemAuthorization } from "./eip7702.js";
import { address, hash, type Address, type EvmChain, type Hash } from "./types.js";

export interface PaymasterClientLike {
  readonly chain?: { readonly id: number; readonly name?: string };
  readonly serviceUrl?: string;
}

export interface PaymasterStubEvidence<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion> {
  readonly kind: "paymaster-stub-evidence";
  readonly chain: C;
  readonly entryPointVersion: V;
  readonly service: string;
  readonly requestBindingHash: Hash<"paymaster-request">;
  readonly isFinal: boolean;
  readonly paymaster: Address<C>;
  readonly paymasterData: Hex;
  readonly paymasterVerificationGasLimit: bigint;
  readonly paymasterPostOpGasLimit: bigint;
  readonly paymasterSignature?: Hex;
  readonly sponsor?: { readonly name?: string; readonly icon?: string };
}

export interface PaymasterFinalEvidence<C extends EvmChain = EvmChain, V extends EraEntryPointVersion = EraEntryPointVersion> {
  readonly kind: "paymaster-final-evidence";
  readonly chain: C;
  readonly entryPointVersion: V;
  readonly service: string;
  readonly requestBindingHash: Hash<"paymaster-request">;
  readonly paymaster: Address<C>;
  readonly paymasterData: Hex;
  readonly paymasterVerificationGasLimit: bigint;
  readonly paymasterPostOpGasLimit: bigint;
  readonly paymasterSignature?: Hex;
  readonly sponsor?: { readonly name?: string; readonly icon?: string };
}

type PaymasterResponse = {
  readonly isFinal?: boolean;
  readonly paymaster: string;
  readonly paymasterData?: string;
  readonly paymasterVerificationGasLimit: bigint;
  readonly paymasterPostOpGasLimit: bigint;
  readonly paymasterSignature?: string;
  readonly sponsor?: { readonly name?: string; readonly icon?: string };
};

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function action<A, R>(client: PaymasterClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4330", "MissingPaymasterAction", `The supplied Paymaster client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

function assertChain<C extends EvmChain>(client: PaymasterClientLike, chain: C): void {
  if (client.chain && client.chain.id !== chain.id) fail("ES3104", "ChainMismatch", "Paymaster client chain does not match the UserOperation chain.", { expected: chain.id, actual: client.chain.id });
}

function validHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail("ES4331", "MalformedPaymasterResponse", `Paymaster field '${field}' must be whole-byte hexadecimal.`, { field });
  return value as Hex;
}

function unsigned(value: unknown, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n) fail("ES4331", "MalformedPaymasterResponse", `Paymaster field '${field}' must be a non-negative bigint.`, { field, value: String(value) });
  return value;
}

function serviceName(client: PaymasterClientLike): string {
  return client.serviceUrl ?? "erc7677-paymaster";
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function requestFields<C extends EvmChain, V extends EraEntryPointVersion>(operation: UserOperationDraft<C, V> | PreparedUserOperation<C, V>): Record<string, unknown> {
  return {
    chainId: operation.entryPoint.chain.id,
    entryPointAddress: operation.entryPoint.address,
    sender: operation.sender,
    nonce: operation.nonce,
    ...(operation.factory ? { factory: operation.factory } : {}),
    ...(operation.factoryData !== undefined ? { factoryData: operation.factoryData } : {}),
    callData: operation.callData,
    ...(operation.state === "userop-prepared" ? {
      callGasLimit: operation.callGasLimit,
      verificationGasLimit: operation.verificationGasLimit,
      preVerificationGas: operation.preVerificationGas,
    } : {}),
    maxFeePerGas: operation.maxFeePerGas,
    maxPriorityFeePerGas: operation.maxPriorityFeePerGas,
    ...(operation.paymaster ? { paymaster: operation.paymaster } : {}),
    ...(operation.paymasterVerificationGasLimit !== undefined ? { paymasterVerificationGasLimit: operation.paymasterVerificationGasLimit } : {}),
    ...(operation.paymasterPostOpGasLimit !== undefined ? { paymasterPostOpGasLimit: operation.paymasterPostOpGasLimit } : {}),
    ...(operation.paymasterData !== undefined ? { paymasterData: operation.paymasterData } : {}),
    ...(operation.paymasterSignature !== undefined ? { paymasterSignature: operation.paymasterSignature } : {}),
    ...(operation.eip7702Auth ? { authorization: toViemAuthorization(operation.eip7702Auth) } : {}),
    signature: operation.signatureStub,
  };
}

export function paymasterRequestBindingHash<C extends EvmChain, V extends EraEntryPointVersion>(operation: UserOperationDraft<C, V> | PreparedUserOperation<C, V>): Hash<"paymaster-request"> {
  return hash(keccak256(stringToHex(JSON.stringify(normalize({
    entryPointVersion: operation.entryPoint.version,
    request: requestFields(operation),
  })))), "paymaster-request");
}

function parseResponse<C extends EvmChain, V extends EraEntryPointVersion>(operation: UserOperationDraft<C, V> | PreparedUserOperation<C, V>, response: PaymasterResponse) {
  const paymaster = address(response.paymaster, operation.entryPoint.chain, "paymaster");
  const paymasterData = validHex(response.paymasterData ?? "0x", "paymasterData");
  const paymasterVerificationGasLimit = unsigned(response.paymasterVerificationGasLimit, "paymasterVerificationGasLimit");
  const paymasterPostOpGasLimit = unsigned(response.paymasterPostOpGasLimit, "paymasterPostOpGasLimit");
  let paymasterSignature: Hex | undefined;
  if (response.paymasterSignature !== undefined) {
    if (operation.entryPoint.version !== "0.9") fail("ES4305", "UnsupportedPaymasterSignature", "Separated paymasterSignature requires EntryPoint v0.9.", { version: operation.entryPoint.version });
    paymasterSignature = validHex(response.paymasterSignature, "paymasterSignature");
  }
  return {
    paymaster,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    ...(paymasterSignature ? { paymasterSignature } : {}),
    ...(response.sponsor ? { sponsor: response.sponsor } : {}),
  };
}

export async function requestPaymasterStub<C extends EvmChain, V extends EraEntryPointVersion>(client: PaymasterClientLike, draft: UserOperationDraft<C, V>, context?: unknown): Promise<PaymasterStubEvidence<C, V>> {
  assertChain(client, draft.entryPoint.chain);
  if (draft.paymaster) fail("ES4332", "PaymasterAlreadyBound", "Paymaster stub must be requested before a paymaster is already bound to the UserOperation draft.", { paymaster: draft.paymaster });
  const getStub = action<Record<string, unknown>, PaymasterResponse>(client, "getPaymasterStubData");
  const response = await getStub({ ...requestFields(draft), ...(context !== undefined ? { context } : {}) });
  const parsed = parseResponse(draft, response);
  return {
    kind: "paymaster-stub-evidence",
    chain: draft.entryPoint.chain,
    entryPointVersion: draft.entryPoint.version,
    service: serviceName(client),
    requestBindingHash: paymasterRequestBindingHash(draft),
    isFinal: response.isFinal === true,
    ...parsed,
  };
}

export function applyPaymasterStub<C extends EvmChain, V extends EraEntryPointVersion>(draft: UserOperationDraft<C, V>, evidence: PaymasterStubEvidence<C, V>): UserOperationDraft<C, V> {
  const current = paymasterRequestBindingHash(draft);
  if (current.toLowerCase() !== evidence.requestBindingHash.toLowerCase()) fail("ES4333", "PaymasterEvidenceBindingMismatch", "Paymaster stub was produced for different UserOperation fields.", { expected: current, evidence: evidence.requestBindingHash });
  if (evidence.chain.id !== draft.entryPoint.chain.id || evidence.entryPointVersion !== draft.entryPoint.version) fail("ES3104", "ChainMismatch", "Paymaster stub and UserOperation use different EntryPoint bindings.");
  return createUserOperationDraft({
    entryPoint: draft.entryPoint,
    sender: draft.sender,
    nonce: draft.nonce,
    ...(draft.factory ? { factory: draft.factory } : {}),
    ...(draft.factoryData !== undefined ? { factoryData: draft.factoryData } : {}),
    callData: draft.callData,
    maxFeePerGas: draft.maxFeePerGas,
    maxPriorityFeePerGas: draft.maxPriorityFeePerGas,
    paymaster: evidence.paymaster,
    paymasterVerificationGasLimit: evidence.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: evidence.paymasterPostOpGasLimit,
    paymasterData: evidence.paymasterData,
    ...(evidence.paymasterSignature ? { paymasterSignature: evidence.paymasterSignature } : {}),
    ...(draft.eip7702Auth ? { eip7702Auth: draft.eip7702Auth } : {}),
    signatureStub: draft.signatureStub,
  });
}

export async function requestFinalPaymasterData<C extends EvmChain, V extends EraEntryPointVersion>(client: PaymasterClientLike, prepared: PreparedUserOperation<C, V>, context?: unknown): Promise<PaymasterFinalEvidence<C, V>> {
  assertChain(client, prepared.entryPoint.chain);
  if (!prepared.paymaster) fail("ES4334", "PaymasterNotBound", "Final paymaster data requires a UserOperation prepared with paymaster stub evidence.");
  const getData = action<Record<string, unknown>, PaymasterResponse>(client, "getPaymasterData");
  const response = await getData({ ...requestFields(prepared), ...(context !== undefined ? { context } : {}) });
  const parsed = parseResponse(prepared, response);
  if (parsed.paymaster.toLowerCase() !== prepared.paymaster.toLowerCase()) fail("ES4335", "FinalPaymasterChanged", "Final paymaster address differs from the paymaster used for Bundler gas estimation.", { estimated: prepared.paymaster, final: parsed.paymaster });
  return {
    kind: "paymaster-final-evidence",
    chain: prepared.entryPoint.chain,
    entryPointVersion: prepared.entryPoint.version,
    service: serviceName(client),
    requestBindingHash: paymasterRequestBindingHash(prepared),
    ...parsed,
  };
}

export function applyFinalPaymasterData<C extends EvmChain, V extends EraEntryPointVersion>(prepared: PreparedUserOperation<C, V>, evidence: PaymasterFinalEvidence<C, V>): PreparedUserOperation<C, V> {
  const current = paymasterRequestBindingHash(prepared);
  if (current.toLowerCase() !== evidence.requestBindingHash.toLowerCase()) fail("ES4333", "PaymasterEvidenceBindingMismatch", "Final paymaster evidence was produced for different prepared UserOperation fields.", { expected: current, evidence: evidence.requestBindingHash });
  if (!prepared.paymaster || prepared.paymaster.toLowerCase() !== evidence.paymaster.toLowerCase()) fail("ES4335", "FinalPaymasterChanged", "Final paymaster address differs from the gas-estimation paymaster.");
  if (prepared.paymasterVerificationGasLimit !== evidence.paymasterVerificationGasLimit || prepared.paymasterPostOpGasLimit !== evidence.paymasterPostOpGasLimit) {
    fail("ES4336", "FinalPaymasterGasChanged", "Final paymaster changed verification/postOp gas after Bundler estimation. Re-run gas estimation before account signing.", {
      estimatedVerificationGas: prepared.paymasterVerificationGasLimit?.toString() ?? null,
      finalVerificationGas: evidence.paymasterVerificationGasLimit.toString(),
      estimatedPostOpGas: prepared.paymasterPostOpGasLimit?.toString() ?? null,
      finalPostOpGas: evidence.paymasterPostOpGasLimit.toString(),
    });
  }
  const updated: PreparedUserOperation<C, V> = {
    ...prepared,
    paymasterData: evidence.paymasterData,
    ...(evidence.paymasterSignature ? { paymasterSignature: evidence.paymasterSignature } : {}),
  };
  return { ...updated, userOpHash: userOperationHash(updated) };
}
