import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EraDiagnosticError } from "../diagnostics.js";
import type { PrivateKeyRef } from "./secrets.js";
import { signSimulated, type SignedTx, type SimulatedTx } from "./tx.js";
import { typedSignature, type TypedDataEnvelope, type TypedSignature } from "./typed-data.js";
import type { Address, EvmChain } from "./types.js";
import { unwrapGas, unwrapWei, type Wei } from "./values.js";

declare const selectorBrand: unique symbol;
export type FunctionSelector = `0x${string}` & { readonly [selectorBrand]: "FunctionSelector" };

export interface SignerPolicy<C extends EvmChain = EvmChain> {
  readonly chain: C;
  readonly allowedDestinations: readonly Address<C>[];
  readonly allowedSelectors?: readonly FunctionSelector[];
  readonly allowNativeTransfer?: boolean;
  readonly allowContractCreation?: boolean;
  readonly maxValue?: Wei;
  readonly allowStateOverrideSimulation?: boolean;
  readonly allowedTypedDataPrimaryTypes?: readonly string[];
  readonly allowedTypedDataVerifyingContracts?: readonly Address<C>[];
  readonly allowUnboundTypedDataContract?: boolean;
}

export interface SignerCapability<C extends EvmChain = EvmChain> {
  readonly kind: "signer-capability";
  readonly secret: PrivateKeyRef<C>;
  readonly chain: C;
  readonly policy: SignerPolicy<C>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function functionSelector(value: string): FunctionSelector {
  if (!/^0x[0-9a-fA-F]{8}$/.test(value)) fail("ES3802", "InvalidFunctionSelector", "Function selector must be exactly 4 bytes.", { value });
  return value.toLowerCase() as FunctionSelector;
}

export function signerCapability<C extends EvmChain>(secret: PrivateKeyRef<C>, policy: SignerPolicy<C>): SignerCapability<C> {
  if (secret.chain.id !== policy.chain.id) fail("ES3104", "ChainMismatch", "Signer secret and policy are bound to different chains.", { secretChain: secret.chain.name, policyChain: policy.chain.name });
  return { kind: "signer-capability", secret, chain: policy.chain, policy };
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function allowedAddress<C extends EvmChain>(value: Address<C>, allowed: readonly Address<C>[]): boolean {
  return allowed.some((item) => sameAddress(item, value));
}

function calldataSelector(data: string): FunctionSelector | undefined {
  if (data === "0x" || data.length === 0) return undefined;
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length < 10) fail("ES3803", "MalformedCallData", "Contract calldata must contain a complete 4-byte function selector.");
  return functionSelector(data.slice(0, 10));
}

export function assertSignerCapability<C extends EvmChain>(capability: SignerCapability<C>, simulated: SimulatedTx<C>): void {
  if (capability.chain.id !== simulated.intent.chain.id) fail("ES3104", "ChainMismatch", "Signer capability is bound to a different chain.", { capabilityChain: capability.chain.name, transactionChain: simulated.intent.chain.name });
  if (simulated.simulation.stateOverrides && !capability.policy.allowStateOverrideSimulation) fail("ES3804", "HypotheticalSimulationNotAuthorized", "A transaction simulated with state overrides cannot be signed by this capability.");
  if (!simulated.intent.from) fail("ES3805", "MissingSignerAddress", "A transaction must declare its sender before capability signing.");

  if (simulated.intent.to) {
    if (!allowedAddress(simulated.intent.to, capability.policy.allowedDestinations)) fail("ES3806", "DestinationNotAuthorized", "Transaction destination is outside the signer capability allowlist.", { to: simulated.intent.to });
  } else if (!capability.policy.allowContractCreation) {
    fail("ES3807", "ContractCreationNotAuthorized", "Contract creation is disabled by this signer capability.");
  }

  const value = simulated.intent.value === undefined ? 0n : unwrapWei(simulated.intent.value);
  const maxValue = capability.policy.maxValue === undefined ? 0n : unwrapWei(capability.policy.maxValue);
  if (value > maxValue) fail("ES3808", "NativeValueLimitExceeded", "Transaction native value exceeds the signer capability limit.", { value: value.toString(), maxValue: maxValue.toString() });

  const selector = simulated.intent.data ? calldataSelector(simulated.intent.data) : undefined;
  if (selector) {
    const allowed = capability.policy.allowedSelectors ?? [];
    if (!allowed.some((item) => item.toLowerCase() === selector.toLowerCase())) fail("ES3809", "FunctionSelectorNotAuthorized", "Contract function selector is outside the signer capability allowlist.", { selector });
  } else if (simulated.intent.to && !capability.policy.allowNativeTransfer) {
    fail("ES3810", "NativeTransferNotAuthorized", "Plain native transfers are disabled by this signer capability.");
  }
}

function loadPrivateKey<C extends EvmChain>(ref: PrivateKeyRef<C>): Hex {
  const value = process.env[ref.source.name];
  if (!value) fail("ES3811", "MissingSecret", "The referenced private key environment variable is not available.", { env: ref.source.name });
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) fail("ES3812", "InvalidPrivateKey", "The referenced private key must be exactly 32 bytes of hexadecimal.", { env: ref.source.name });
  return value as Hex;
}

function accountForCapability<C extends EvmChain>(capability: SignerCapability<C>, expectedFrom?: Address<C>) {
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount(loadPrivateKey(capability.secret));
  } catch {
    return fail("ES3812", "InvalidPrivateKey", "The private key could not be converted into a secp256k1 account.", { env: capability.secret.source.name });
  }
  if (capability.secret.expectedAddress && !sameAddress(account.address, capability.secret.expectedAddress)) fail("ES3813", "SecretAddressMismatch", "Private key does not derive the expected signer address.", { expected: capability.secret.expectedAddress, derived: account.address });
  if (expectedFrom && !sameAddress(account.address, expectedFrom)) fail("ES3814", "TransactionSignerMismatch", "Private key does not match the transaction sender.", { transactionFrom: expectedFrom, derived: account.address });
  return account;
}

export async function signSimulatedWithCapability<C extends EvmChain>(capability: SignerCapability<C>, simulated: SimulatedTx<C>): Promise<SignedTx<C>> {
  assertSignerCapability(capability, simulated);
  const account = accountForCapability(capability, simulated.intent.from);
  const request: Record<string, unknown> = {
    chainId: simulated.intent.chain.id,
    nonce: simulated.nonce.value,
    gas: unwrapGas(simulated.gas),
    ...(simulated.intent.to ? { to: simulated.intent.to } : {}),
    ...(simulated.intent.value !== undefined ? { value: unwrapWei(simulated.intent.value) } : {}),
    ...(simulated.intent.data !== undefined ? { data: simulated.intent.data as Hex } : {}),
  };
  if (simulated.fees.type === "eip1559") {
    request.maxFeePerGas = unwrapWei(simulated.fees.maxFeePerGas);
    request.maxPriorityFeePerGas = unwrapWei(simulated.fees.maxPriorityFeePerGas);
  } else {
    request.gasPrice = unwrapWei(simulated.fees.gasPrice);
  }
  const rawTransaction = await (account.signTransaction as unknown as (request: Record<string, unknown>) => Promise<Hex>)(request);
  return signSimulated(simulated, rawTransaction);
}

export async function signTypedDataWithCapability<C extends EvmChain, P extends string>(capability: SignerCapability<C>, envelope: TypedDataEnvelope<C, P>): Promise<TypedSignature<C, P>> {
  if (capability.chain.id !== envelope.chain.id) fail("ES3104", "ChainMismatch", "Typed data and signer capability are bound to different chains.");
  const allowedTypes = capability.policy.allowedTypedDataPrimaryTypes ?? [];
  if (!allowedTypes.includes(envelope.primaryType)) fail("ES3815", "TypedDataPrimaryTypeNotAuthorized", "EIP-712 primary type is outside the signer capability allowlist.", { primaryType: envelope.primaryType });
  if (envelope.verifyingContract) {
    const allowedContracts = capability.policy.allowedTypedDataVerifyingContracts ?? [];
    if (!allowedAddress(envelope.verifyingContract, allowedContracts)) fail("ES3816", "TypedDataContractNotAuthorized", "EIP-712 verifying contract is outside the signer capability allowlist.", { verifyingContract: envelope.verifyingContract });
  } else if (!capability.policy.allowUnboundTypedDataContract) {
    fail("ES3817", "UnboundTypedDataNotAuthorized", "EIP-712 data without a verifying contract is disabled by this signer capability.");
  }

  const account = accountForCapability(capability);
  const signTypedData = account.signTypedData as unknown as (request: Record<string, unknown>) => Promise<Hex>;
  const signature = await signTypedData({ domain: envelope.domain, types: envelope.types, primaryType: envelope.primaryType, message: envelope.message });
  return typedSignature(signature, envelope, account.address as Address<C>);
}
