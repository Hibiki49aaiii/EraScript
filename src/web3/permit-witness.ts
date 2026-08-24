import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { canonicalPermit2 } from "./permit.js";
import { assertRpcChain, type ViemClientLike } from "./rpc.js";
import type { TokenAmount, TokenDefinition } from "./token.js";
import { typedDataEnvelope, type TypedDataEnvelope } from "./typed-data.js";
import { blockHash, bytes32, hash, type Address, type BlockHash, type Bytes32, type EvmChain, type Hash } from "./types.js";

const ERA_TRANSFER_WITNESS_TYPE = "EraTransferWitness(address recipient,uint256 requestedAmount,bytes32 context)";
export const ERA_TRANSFER_WITNESS_TYPE_STRING = `EraTransferWitness witness)${ERA_TRANSFER_WITNESS_TYPE}TokenPermissions(address token,uint256 amount)` as const;

export interface Permit2WitnessSpenderTrust<C extends EvmChain = EvmChain> {
  readonly kind: "permit2-witness-spender-trust";
  readonly chain: C;
  readonly spender: Address<C>;
  readonly expectedCodeHash: Hash<"keccak256">;
  readonly profile: "era-transfer-witness-v1";
}

export interface VerifiedPermit2WitnessSpender<C extends EvmChain = EvmChain> extends Omit<Permit2WitnessSpenderTrust<C>, "kind"> {
  readonly kind: "permit2-witness-spender-verified";
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash<C>;
  readonly observedCodeHash: Hash<"keccak256">;
}

export interface EraTransferWitness<C extends EvmChain = EvmChain, T extends TokenDefinition<string, C, number> = TokenDefinition<string, C, number>> {
  readonly recipient: Address<C>;
  readonly requestedAmount: TokenAmount<T>;
  readonly context: Bytes32;
}

export interface Permit2WitnessTransferAuthorization<C extends EvmChain, T extends TokenDefinition<string, C, number>> {
  readonly kind: "permit2-witness-transfer";
  readonly permit2: Address<C>;
  readonly owner: Address<C>;
  readonly spender: Address<C>;
  readonly permitted: TokenAmount<T>;
  readonly nonce: bigint;
  readonly deadline: bigint;
  readonly witness: EraTransferWitness<C, T>;
  readonly witnessHash: Bytes32;
  readonly witnessTypeString: typeof ERA_TRANSFER_WITNESS_TYPE_STRING;
  readonly enforcement: VerifiedPermit2WitnessSpender<C>;
  readonly typedData: TypedDataEnvelope<C, "PermitWitnessTransferFrom">;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function action<A, R>(client: ViemClientLike, name: string): (args: A) => Promise<R> {
  const value = (client as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") fail("ES4090", "MissingWitnessRpcAction", `The supplied RPC client does not expose '${name}'.`, { action: name });
  return value.bind(client) as (args: A) => Promise<R>;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function unsigned256(value: bigint, field: string): bigint {
  if (value < 0n || value >= (1n << 256n)) fail("ES4091", "WitnessIntegerOutOfRange", `${field} must fit uint256.`, { field, value: value.toString() });
  return value;
}

export function permit2WitnessSpenderTrust<C extends EvmChain>(chain: C, spender: Address<C>, expectedCodeHash: Hash<"keccak256">): Permit2WitnessSpenderTrust<C> {
  return { kind: "permit2-witness-spender-trust", chain, spender, expectedCodeHash, profile: "era-transfer-witness-v1" };
}

/**
 * Checks that the signed Permit2 spender is the exact contract version approved by policy.
 * Code-hash trust is an identity anchor; the caller must only approve hashes whose contract
 * semantics are known to enforce EraTransferWitness against actual transfer details.
 */
export async function verifyPermit2WitnessSpenderFromRpc<C extends EvmChain>(client: ViemClientLike, trust: Permit2WitnessSpenderTrust<C>, blockNumber?: bigint): Promise<VerifiedPermit2WitnessSpender<C>> {
  assertRpcChain(client, trust.chain);
  const getBlock = action<{ blockNumber?: bigint; blockTag?: "latest" }, { number: bigint | null; hash: Hex | null }>(client, "getBlock");
  const anchor = blockNumber === undefined ? await getBlock({ blockTag: "latest" }) : await getBlock({ blockNumber });
  if (anchor.number === null || anchor.hash === null) fail("ES4092", "UnanchoredWitnessSpenderVerification", "Permit2 witness spender verification could not be anchored to a concrete block.");
  const getCode = action<{ address: Hex; blockNumber: bigint }, Hex | undefined>(client, "getCode");
  const code = await getCode({ address: trust.spender, blockNumber: anchor.number });
  if (!code || code === "0x") fail("ES4093", "WitnessSpenderNotContract", "Permit2 witness spender has no deployed bytecode at the verification block.", { spender: trust.spender, blockNumber: anchor.number.toString() });
  const observedCodeHash = hash(keccak256(code), "keccak256");
  if (observedCodeHash.toLowerCase() !== trust.expectedCodeHash.toLowerCase()) fail("ES4094", "WitnessSpenderCodeHashMismatch", "Permit2 witness spender bytecode does not match the approved contract version.", { spender: trust.spender, expected: trust.expectedCodeHash, observed: observedCodeHash, blockNumber: anchor.number.toString() });
  return {
    ...trust,
    kind: "permit2-witness-spender-verified",
    blockNumber: anchor.number,
    blockHash: blockHash(anchor.hash, trust.chain),
    observedCodeHash,
  };
}

export function eraTransferWitnessHash<C extends EvmChain, T extends TokenDefinition<string, C, number>>(witness: EraTransferWitness<C, T>): Bytes32 {
  unsigned256(witness.requestedAmount.raw, "witness.requestedAmount");
  const typeHash = keccak256(stringToHex(ERA_TRANSFER_WITNESS_TYPE));
  return bytes32(keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
    [typeHash, witness.recipient, witness.requestedAmount.raw, witness.context],
  )));
}

export function permit2WitnessTransfer<C extends EvmChain, T extends TokenDefinition<string, C, number>>(input: {
  permit2?: Address<C>;
  owner: Address<C>;
  permitted: TokenAmount<T>;
  nonce: bigint;
  deadline: bigint;
  witness: EraTransferWitness<C, T>;
  enforcement: VerifiedPermit2WitnessSpender<C>;
}): Permit2WitnessTransferAuthorization<C, T> {
  unsigned256(input.permitted.raw, "permitted.amount");
  unsigned256(input.nonce, "nonce");
  unsigned256(input.deadline, "deadline");
  if (input.deadline === 0n) fail("ES3921", "ZeroPermitDeadline", "Permit2 witness deadline cannot be zero.");
  if (input.permitted.token.chain.id !== input.enforcement.chain.id || input.witness.requestedAmount.token.chain.id !== input.permitted.token.chain.id) fail("ES3104", "ChainMismatch", "Permit2 witness token, enforcement, and requested amount must share one chain.");
  if (!sameAddress(input.witness.requestedAmount.token.address, input.permitted.token.address)) fail("ES3905", "TokenIdentityMismatch", "Permit2 witness requested amount does not belong to the permitted token.");
  if (input.witness.requestedAmount.raw > input.permitted.raw) fail("ES3923", "Permit2RequestedAmountExceeded", "Permit2 witness requested transfer exceeds the signed permitted amount.", { permitted: input.permitted.raw.toString(), requested: input.witness.requestedAmount.raw.toString() });

  const token = input.permitted.token;
  const permit2 = input.permit2 ?? canonicalPermit2(token.chain);
  const witnessHash = eraTransferWitnessHash(input.witness);
  const typedData = typedDataEnvelope({
    chain: token.chain,
    domain: { name: "Permit2", chainId: token.chain.id, verifyingContract: permit2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "EraTransferWitness" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      EraTransferWitness: [
        { name: "recipient", type: "address" },
        { name: "requestedAmount", type: "uint256" },
        { name: "context", type: "bytes32" },
      ],
    },
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: { token: token.address, amount: input.permitted.raw },
      spender: input.enforcement.spender,
      nonce: input.nonce,
      deadline: input.deadline,
      witness: {
        recipient: input.witness.recipient,
        requestedAmount: input.witness.requestedAmount.raw,
        context: input.witness.context,
      },
    },
  });

  return {
    kind: "permit2-witness-transfer",
    permit2,
    owner: input.owner,
    spender: input.enforcement.spender,
    permitted: input.permitted,
    nonce: input.nonce,
    deadline: input.deadline,
    witness: input.witness,
    witnessHash,
    witnessTypeString: ERA_TRANSFER_WITNESS_TYPE_STRING,
    enforcement: input.enforcement,
    typedData,
  };
}

export interface Permit2WitnessTransferExecution<C extends EvmChain, T extends TokenDefinition<string, C, number>> {
  readonly authorization: Permit2WitnessTransferAuthorization<C, T>;
  readonly recipient: Address<C>;
  readonly requestedAmount: TokenAmount<T>;
  readonly witness: Bytes32;
  readonly witnessTypeString: typeof ERA_TRANSFER_WITNESS_TYPE_STRING;
}

export function permit2WitnessTransferExecution<C extends EvmChain, T extends TokenDefinition<string, C, number>>(authorization: Permit2WitnessTransferAuthorization<C, T>, recipient: Address<C>, requestedAmount: TokenAmount<T>): Permit2WitnessTransferExecution<C, T> {
  if (!sameAddress(recipient, authorization.witness.recipient)) fail("ES4095", "WitnessRecipientMismatch", "Permit2 transfer recipient does not match the recipient committed in EraTransferWitness.", { signedRecipient: authorization.witness.recipient, requestedRecipient: recipient });
  if (!sameAddress(requestedAmount.token.address, authorization.permitted.token.address) || requestedAmount.token.chain.id !== authorization.permitted.token.chain.id) fail("ES3905", "TokenIdentityMismatch", "Permit2 witness execution amount does not belong to the permitted token.");
  if (requestedAmount.raw !== authorization.witness.requestedAmount.raw) fail("ES4096", "WitnessRequestedAmountMismatch", "Permit2 transfer requested amount does not match the amount committed in EraTransferWitness.", { signedAmount: authorization.witness.requestedAmount.raw.toString(), requestedAmount: requestedAmount.raw.toString() });
  return {
    authorization,
    recipient,
    requestedAmount,
    witness: authorization.witnessHash,
    witnessTypeString: authorization.witnessTypeString,
  };
}
