import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { assertSignerPolicy, assertTypedDataPolicy, sameAddress, type SignerPolicy } from "./capabilities.js";
import { signSimulated, type SignedTx, type SimulatedTx } from "./tx.js";
import { typedSignature, type TypedDataEnvelope, type TypedSignature } from "./typed-data.js";
import type { Address, EvmChain } from "./types.js";
import { unwrapGas, unwrapWei } from "./values.js";

export interface ExternalTransactionSigningRequest<C extends EvmChain = EvmChain> {
  readonly kind: "external-transaction-signing-request";
  readonly chain: C;
  readonly from: Address<C>;
  readonly to?: Address<C>;
  readonly value: bigint;
  readonly data?: Hex;
  readonly nonce: number;
  readonly gas: bigint;
  readonly fee:
    | { readonly type: "legacy"; readonly gasPrice: bigint }
    | { readonly type: "eip1559"; readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint };
  readonly simulation: {
    readonly status: "success";
    readonly blockNumber?: bigint;
    readonly blockHash?: string;
    readonly stateOverrides: boolean;
    readonly provider?: string;
  };
}

export interface ExternalTypedDataSigningRequest<C extends EvmChain = EvmChain, P extends string = string> {
  readonly kind: "external-typed-data-signing-request";
  readonly chain: C;
  readonly signer: Address<C>;
  readonly envelope: TypedDataEnvelope<C, P>;
}

export interface ExternalSigner<C extends EvmChain = EvmChain> {
  readonly kind: "external-signer";
  readonly chain: C;
  readonly address: Address<C>;
  readonly id?: string;
  signTransaction(request: ExternalTransactionSigningRequest<C>): Promise<Hex>;
  signTypedData?<P extends string>(request: ExternalTypedDataSigningRequest<C, P>): Promise<Hex>;
}

export interface ExternalSignerCapability<C extends EvmChain = EvmChain> {
  readonly kind: "external-signer-capability";
  readonly signer: ExternalSigner<C>;
  readonly chain: C;
  readonly policy: SignerPolicy<C>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function externalSignerCapability<C extends EvmChain>(signer: ExternalSigner<C>, policy: SignerPolicy<C>): ExternalSignerCapability<C> {
  if (signer.chain.id !== policy.chain.id) fail("ES3104", "ChainMismatch", "External signer and policy are bound to different chains.", { signerChain: signer.chain.name, policyChain: policy.chain.name });
  return { kind: "external-signer-capability", signer, chain: signer.chain, policy };
}

export function externalTransactionRequest<C extends EvmChain>(simulated: SimulatedTx<C>): ExternalTransactionSigningRequest<C> {
  if (!simulated.intent.from) fail("ES3830", "MissingExternalSignerAddress", "External signing requires an explicit transaction sender.");
  return {
    kind: "external-transaction-signing-request",
    chain: simulated.intent.chain,
    from: simulated.intent.from,
    ...(simulated.intent.to ? { to: simulated.intent.to } : {}),
    value: simulated.intent.value === undefined ? 0n : unwrapWei(simulated.intent.value),
    ...(simulated.intent.data ? { data: simulated.intent.data as Hex } : {}),
    nonce: simulated.nonce.value,
    gas: unwrapGas(simulated.gas),
    fee: simulated.fees.type === "eip1559"
      ? {
          type: "eip1559",
          maxFeePerGas: unwrapWei(simulated.fees.maxFeePerGas),
          maxPriorityFeePerGas: unwrapWei(simulated.fees.maxPriorityFeePerGas),
        }
      : { type: "legacy", gasPrice: unwrapWei(simulated.fees.gasPrice) },
    simulation: {
      status: "success",
      ...(simulated.simulation.blockNumber !== undefined ? { blockNumber: simulated.simulation.blockNumber } : {}),
      ...(simulated.simulation.blockHash !== undefined ? { blockHash: simulated.simulation.blockHash } : {}),
      stateOverrides: simulated.simulation.stateOverrides,
      ...(simulated.simulation.provider !== undefined ? { provider: simulated.simulation.provider } : {}),
    },
  };
}

export async function signSimulatedWithExternalSigner<C extends EvmChain>(capability: ExternalSignerCapability<C>, simulated: SimulatedTx<C>): Promise<SignedTx<C>> {
  assertSignerPolicy(capability.chain, capability.policy, simulated);
  if (!simulated.intent.from) fail("ES3830", "MissingExternalSignerAddress", "External signing requires an explicit transaction sender.");
  if (!sameAddress(capability.signer.address, simulated.intent.from)) fail("ES3831", "ExternalSignerMismatch", "External signer address does not match the transaction sender.", { signer: capability.signer.address, from: simulated.intent.from });

  const raw = await capability.signer.signTransaction(externalTransactionRequest(simulated));
  if (!/^0x[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) fail("ES3832", "InvalidExternalSignerResponse", "External signer returned malformed raw transaction hexadecimal.");
  return signSimulated(simulated, raw);
}

export async function signTypedDataWithExternalSigner<C extends EvmChain, P extends string>(capability: ExternalSignerCapability<C>, envelope: TypedDataEnvelope<C, P>): Promise<TypedSignature<C, P>> {
  assertTypedDataPolicy(capability.chain, capability.policy, envelope);
  if (!capability.signer.signTypedData) fail("ES3833", "ExternalTypedDataSigningUnsupported", "External signer does not expose EIP-712 signing.", { signerId: capability.signer.id ?? null });
  const signature = await capability.signer.signTypedData({
    kind: "external-typed-data-signing-request",
    chain: capability.chain,
    signer: capability.signer.address,
    envelope,
  });
  return typedSignature(signature, envelope, capability.signer.address);
}
