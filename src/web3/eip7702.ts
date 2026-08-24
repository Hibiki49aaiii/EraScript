import type { Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { accountForCapability, sameAddress, type SignerCapability, type SignerPolicy } from "./capabilities.js";
import { assertRpcChain, type ViemClientLike } from "./rpc.js";
import { address, type Address, type EvmChain } from "./types.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_AUTH_NONCE = (1n << 64n) - 1n;

export type Eip7702Executor = "self" | "relayer";

export interface Eip7702AuthorizationRequest<C extends EvmChain = EvmChain> {
  readonly kind: "eip7702-authorization-request";
  readonly chain: C;
  readonly authority: Address<C>;
  readonly delegate: Address<C>;
  readonly chainId: number;
  readonly nonce: number;
  readonly executor: Eip7702Executor;
  readonly clearsDelegation: boolean;
  readonly replayable: boolean;
}

export interface SignedEip7702Authorization<C extends EvmChain = EvmChain> extends Eip7702AuthorizationRequest<C> {
  readonly kind: "eip7702-signed-authorization";
  readonly yParity: number;
  readonly r: Hex;
  readonly s: Hex;
}

export interface PreparedEip7702Authorization<C extends EvmChain = EvmChain> {
  readonly request: Eip7702AuthorizationRequest<C>;
  readonly observedPendingNonce: number;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function safeAuthNonce(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) >= MAX_AUTH_NONCE) {
    fail("ES4100", "InvalidEip7702Nonce", "EIP-7702 authorization nonce must be a non-negative safe integer below 2^64-1.", { nonce: value });
  }
  return value;
}

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO_ADDRESS;
}

export function eip7702AuthorizationRequest<C extends EvmChain>(input: {
  chain: C;
  authority: Address<C>;
  delegate: Address<C>;
  nonce: number;
  executor: Eip7702Executor;
  chainId?: number;
  allowReplayable?: boolean;
  allowClearDelegation?: boolean;
}): Eip7702AuthorizationRequest<C> {
  const chainId = input.chainId ?? input.chain.id;
  if (!Number.isSafeInteger(chainId) || chainId < 0) fail("ES4101", "InvalidEip7702ChainId", "EIP-7702 authorization chainId must be a non-negative safe integer.", { chainId });
  if (chainId !== 0 && chainId !== input.chain.id) fail("ES3104", "ChainMismatch", "EIP-7702 authorization chainId must be zero or match the bound chain.", { expected: input.chain.id, actual: chainId });
  const replayable = chainId === 0;
  if (replayable && !input.allowReplayable) fail("ES4102", "ReplayableEip7702AuthorizationRejected", "chainId=0 makes an EIP-7702 authorization replayable across chains and is rejected by default.");

  const clearsDelegation = isZeroAddress(input.delegate);
  if (clearsDelegation && !input.allowClearDelegation) fail("ES4103", "Eip7702ClearDelegationRejected", "Zero-address EIP-7702 delegation clears existing delegation and requires explicit authorization.");

  return {
    kind: "eip7702-authorization-request",
    chain: input.chain,
    authority: input.authority,
    delegate: input.delegate,
    chainId,
    nonce: safeAuthNonce(input.nonce),
    executor: input.executor,
    clearsDelegation,
    replayable,
  };
}

function rpcAction<A, R>(client: ViemClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES3700", "MissingRpcAction", `The supplied viem client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

/**
 * Prepares authorization nonce from pending state.
 * If the authority is also the transaction executor, the outer transaction consumes
 * the authority nonce first, so the authorization must use pendingNonce + 1.
 */
export async function prepareEip7702AuthorizationFromRpc<C extends EvmChain>(client: ViemClientLike, input: {
  chain: C;
  authority: Address<C>;
  delegate: Address<C>;
  executor: Eip7702Executor;
  replayable?: boolean;
  allowClearDelegation?: boolean;
}): Promise<PreparedEip7702Authorization<C>> {
  assertRpcChain(client, input.chain);
  const getCount = rpcAction<{ address: Hex; blockTag: "pending" }, number>(client, "getTransactionCount");
  const observedPendingNonce = await getCount({ address: input.authority, blockTag: "pending" });
  const authorizationNonce = observedPendingNonce + (input.executor === "self" ? 1 : 0);
  const request = eip7702AuthorizationRequest({
    chain: input.chain,
    authority: input.authority,
    delegate: input.delegate,
    nonce: authorizationNonce,
    executor: input.executor,
    ...(input.replayable ? { chainId: 0, allowReplayable: true } : {}),
    ...(input.allowClearDelegation ? { allowClearDelegation: true } : {}),
  });
  return { request, observedPendingNonce };
}

export function assertEip7702Policy<C extends EvmChain>(policy: SignerPolicy<C>, request: Eip7702AuthorizationRequest<C>): void {
  if (policy.chain.id !== request.chain.id) fail("ES3104", "ChainMismatch", "EIP-7702 authorization and signer policy are bound to different chains.");
  if (request.replayable && !policy.allowReplayableEip7702Authorization) fail("ES4104", "ReplayableEip7702AuthorizationNotAuthorized", "Signer policy does not permit replayable EIP-7702 authorizations.");
  if (request.clearsDelegation) {
    if (!policy.allowEip7702ClearDelegation) fail("ES4105", "Eip7702ClearDelegationNotAuthorized", "Signer policy does not permit clearing EIP-7702 delegation.");
    return;
  }
  const allowed = policy.allowedEip7702Delegates ?? [];
  if (!allowed.some((candidate) => sameAddress(candidate, request.delegate))) fail("ES4106", "Eip7702DelegateNotAuthorized", "EIP-7702 delegate is outside the signer policy allowlist.", { delegate: request.delegate });
}

function validateSignedResponse<C extends EvmChain>(request: Eip7702AuthorizationRequest<C>, response: {
  address: string;
  chainId: number;
  nonce: number;
  yParity: number;
  r: string;
  s: string;
}): SignedEip7702Authorization<C> {
  if (!sameAddress(response.address, request.delegate) || response.chainId !== request.chainId || response.nonce !== request.nonce) {
    fail("ES4107", "Eip7702SignerResponseMismatch", "Signed EIP-7702 authorization does not match the requested delegate/chainId/nonce.", {
      requestedDelegate: request.delegate,
      returnedDelegate: response.address,
      requestedChainId: request.chainId,
      returnedChainId: response.chainId,
      requestedNonce: request.nonce,
      returnedNonce: response.nonce,
    });
  }
  if ((response.yParity !== 0 && response.yParity !== 1) || !/^0x[0-9a-fA-F]{64}$/.test(response.r) || !/^0x[0-9a-fA-F]{64}$/.test(response.s)) {
    fail("ES4108", "InvalidEip7702Signature", "EIP-7702 signer returned an invalid secp256k1 signature tuple.");
  }
  return {
    ...request,
    kind: "eip7702-signed-authorization",
    yParity: response.yParity,
    r: response.r as Hex,
    s: response.s as Hex,
  };
}

export async function signEip7702WithCapability<C extends EvmChain>(capability: SignerCapability<C>, request: Eip7702AuthorizationRequest<C>): Promise<SignedEip7702Authorization<C>> {
  assertEip7702Policy(capability.policy, request);
  const account = accountForCapability(capability, request.authority);
  const signAuthorization = account.signAuthorization as unknown as (parameters: {
    contractAddress: Hex;
    chainId: number;
    nonce: number;
  }) => Promise<{ address: Hex; chainId: number; nonce: number; yParity: number; r: Hex; s: Hex }>;
  const signed = await signAuthorization({ contractAddress: request.delegate, chainId: request.chainId, nonce: request.nonce });
  return validateSignedResponse(request, signed);
}

export interface Eip7702ExternalSigner<C extends EvmChain = EvmChain> {
  readonly chain: C;
  readonly address: Address<C>;
  readonly id?: string;
  signEip7702Authorization(request: Eip7702AuthorizationRequest<C>): Promise<{
    address: string;
    chainId: number;
    nonce: number;
    yParity: number;
    r: string;
    s: string;
  }>;
}

export async function signEip7702WithExternalSigner<C extends EvmChain>(signer: Eip7702ExternalSigner<C>, policy: SignerPolicy<C>, request: Eip7702AuthorizationRequest<C>): Promise<SignedEip7702Authorization<C>> {
  if (signer.chain.id !== request.chain.id || policy.chain.id !== request.chain.id) fail("ES3104", "ChainMismatch", "External EIP-7702 signer, policy, and authorization must share one chain binding.");
  if (!sameAddress(signer.address, request.authority)) fail("ES4109", "Eip7702AuthorityMismatch", "External signer address does not match the EIP-7702 authority.", { signer: signer.address, authority: request.authority });
  assertEip7702Policy(policy, request);
  return validateSignedResponse(request, await signer.signEip7702Authorization(request));
}

export function toViemAuthorization<C extends EvmChain>(authorization: SignedEip7702Authorization<C>): {
  address: Address<C>;
  chainId: number;
  nonce: number;
  yParity: number;
  r: Hex;
  s: Hex;
} {
  return {
    address: authorization.delegate,
    chainId: authorization.chainId,
    nonce: authorization.nonce,
    yParity: authorization.yParity,
    r: authorization.r,
    s: authorization.s,
  };
}

export function zeroDelegationAddress<C extends EvmChain>(chain: C): Address<C> {
  return address(ZERO_ADDRESS, chain);
}
