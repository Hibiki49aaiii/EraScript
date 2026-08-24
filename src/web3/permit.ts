import { EraDiagnosticError } from "../diagnostics.js";
import { assertTokenUintWidth, type TokenAmount, type TokenDefinition } from "./token.js";
import { typedDataEnvelope, type TypedDataEnvelope } from "./typed-data.js";
import { address, type Address, type EvmChain } from "./types.js";

const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const CANONICAL_PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function uint(value: bigint, bits: 48 | 160 | 256, field: string): bigint {
  const max = bits === 48 ? MAX_UINT48 : bits === 160 ? MAX_UINT160 : MAX_UINT256;
  if (value < 0n || value > max) fail("ES3920", "PermitIntegerOutOfRange", `${field} must fit uint${bits}.`, { field, bits, value: value.toString(), max: max.toString() });
  return value;
}

function assertFutureOrExplicit(deadline: bigint, field: string): void {
  uint(deadline, 256, field);
  if (deadline === 0n) fail("ES3921", "ZeroPermitDeadline", `${field} is zero and would normally make the authorization unusable.`, { field });
}

export function canonicalPermit2<C extends EvmChain>(chain: C): Address<C> {
  return address(CANONICAL_PERMIT2, chain);
}

export interface Erc2612PermitAuthorization<C extends EvmChain, T extends TokenDefinition<string, C, number>> {
  readonly kind: "erc2612-permit";
  readonly token: T;
  readonly owner: Address<C>;
  readonly spender: Address<C>;
  readonly amount: TokenAmount<T>;
  readonly nonce: bigint;
  readonly deadline: bigint;
  readonly typedData: TypedDataEnvelope<C, "Permit">;
}

export function erc2612Permit<C extends EvmChain, T extends TokenDefinition<string, C, number>>(input: {
  token: T;
  tokenName: string;
  tokenVersion?: string;
  owner: Address<C>;
  spender: Address<C>;
  amount: TokenAmount<T>;
  nonce: bigint;
  deadline: bigint;
}): Erc2612PermitAuthorization<C, T> {
  if (input.amount.token.address.toLowerCase() !== input.token.address.toLowerCase() || input.amount.token.chain.id !== input.token.chain.id) {
    fail("ES3905", "TokenIdentityMismatch", "ERC-2612 permit amount does not belong to the declared token.");
  }
  uint(input.nonce, 256, "nonce");
  assertFutureOrExplicit(input.deadline, "deadline");
  const typedData = typedDataEnvelope({
    chain: input.token.chain,
    domain: {
      name: input.tokenName,
      version: input.tokenVersion ?? "1",
      chainId: input.token.chain.id,
      verifyingContract: input.token.address,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit" as const,
    message: {
      owner: input.owner,
      spender: input.spender,
      value: input.amount.raw,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  });
  return { kind: "erc2612-permit", token: input.token, owner: input.owner, spender: input.spender, amount: input.amount, nonce: input.nonce, deadline: input.deadline, typedData };
}

export interface Permit2AllowanceAuthorization<C extends EvmChain, T extends TokenDefinition<string, C, number>> {
  readonly kind: "permit2-allowance";
  readonly permit2: Address<C>;
  readonly owner: Address<C>;
  readonly spender: Address<C>;
  readonly amount: TokenAmount<T>;
  readonly expiration: bigint;
  readonly nonce: bigint;
  readonly sigDeadline: bigint;
  readonly unlimited: boolean;
  readonly typedData: TypedDataEnvelope<C, "PermitSingle">;
}

export function permit2Allowance<C extends EvmChain, T extends TokenDefinition<string, C, number>>(input: {
  permit2?: Address<C>;
  owner: Address<C>;
  spender: Address<C>;
  amount: TokenAmount<T>;
  expiration: bigint;
  nonce: bigint;
  sigDeadline: bigint;
  allowUnlimited?: boolean;
}): Permit2AllowanceAuthorization<C, T> {
  const token = input.amount.token;
  assertTokenUintWidth(input.amount, 160, "Permit2 PermitDetails.amount");
  uint(input.expiration, 48, "expiration");
  uint(input.nonce, 48, "nonce");
  assertFutureOrExplicit(input.sigDeadline, "sigDeadline");
  const unlimited = input.amount.raw === MAX_UINT160;
  if (unlimited && !input.allowUnlimited) fail("ES3922", "UnlimitedPermit2AllowanceRejected", "Permit2 uint160 maximum allowance is rejected by default.", {
    spender: input.spender,
    token: token.address,
    suggestion: "Use an exact allowance or set allowUnlimited only after an explicit policy decision.",
  });
  const permit2 = input.permit2 ?? canonicalPermit2(token.chain);
  const typedData = typedDataEnvelope({
    chain: token.chain,
    domain: { name: "Permit2", chainId: token.chain.id, verifyingContract: permit2 },
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: {
      details: { token: token.address, amount: input.amount.raw, expiration: input.expiration, nonce: input.nonce },
      spender: input.spender,
      sigDeadline: input.sigDeadline,
    },
  });
  return { kind: "permit2-allowance", permit2, owner: input.owner, spender: input.spender, amount: input.amount, expiration: input.expiration, nonce: input.nonce, sigDeadline: input.sigDeadline, unlimited, typedData };
}

export interface Permit2SignatureTransferAuthorization<C extends EvmChain, T extends TokenDefinition<string, C, number>> {
  readonly kind: "permit2-signature-transfer";
  readonly permit2: Address<C>;
  readonly owner: Address<C>;
  readonly spender: Address<C>;
  readonly permitted: TokenAmount<T>;
  readonly nonce: bigint;
  readonly deadline: bigint;
  readonly recipientBinding: "spender-controlled";
  readonly typedData: TypedDataEnvelope<C, "PermitTransferFrom">;
}

/**
 * Builds the EIP-712 message used by Permit2 SignatureTransfer.
 * The recipient is intentionally NOT part of the standard signed message.
 * Callers must explicitly acknowledge this with recipientBinding="spender-controlled".
 * Use Permit2 witness transfers in a future/explicit profile when recipient or trade data must be cryptographically bound.
 */
export function permit2SignatureTransfer<C extends EvmChain, T extends TokenDefinition<string, C, number>>(input: {
  permit2?: Address<C>;
  owner: Address<C>;
  spender: Address<C>;
  permitted: TokenAmount<T>;
  nonce: bigint;
  deadline: bigint;
  recipientBinding: "spender-controlled";
}): Permit2SignatureTransferAuthorization<C, T> {
  uint(input.permitted.raw, 256, "permitted.amount");
  uint(input.nonce, 256, "nonce");
  assertFutureOrExplicit(input.deadline, "deadline");
  const token = input.permitted.token;
  const permit2 = input.permit2 ?? canonicalPermit2(token.chain);
  const typedData = typedDataEnvelope({
    chain: token.chain,
    domain: { name: "Permit2", chainId: token.chain.id, verifyingContract: permit2 },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "PermitTransferFrom" as const,
    message: {
      permitted: { token: token.address, amount: input.permitted.raw },
      spender: input.spender,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  });
  return { kind: "permit2-signature-transfer", permit2, owner: input.owner, spender: input.spender, permitted: input.permitted, nonce: input.nonce, deadline: input.deadline, recipientBinding: input.recipientBinding, typedData };
}

export interface Permit2TransferExecution<C extends EvmChain, T extends TokenDefinition<string, C, number>> {
  readonly authorization: Permit2SignatureTransferAuthorization<C, T>;
  readonly recipient: Address<C>;
  readonly requestedAmount: TokenAmount<T>;
}

export function permit2TransferExecution<C extends EvmChain, T extends TokenDefinition<string, C, number>>(authorization: Permit2SignatureTransferAuthorization<C, T>, recipient: Address<C>, requestedAmount: TokenAmount<T>): Permit2TransferExecution<C, T> {
  if (requestedAmount.token.address.toLowerCase() !== authorization.permitted.token.address.toLowerCase() || requestedAmount.token.chain.id !== authorization.permitted.token.chain.id) {
    fail("ES3905", "TokenIdentityMismatch", "Permit2 requested transfer amount does not match the permitted token.");
  }
  if (requestedAmount.raw > authorization.permitted.raw) fail("ES3923", "Permit2RequestedAmountExceeded", "Permit2 requested transfer exceeds the signed permitted amount.", {
    permitted: authorization.permitted.raw.toString(),
    requested: requestedAmount.raw.toString(),
  });
  return { authorization, recipient, requestedAmount };
}
