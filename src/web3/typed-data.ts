import { hashTypedData, type Hex } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { address, hash, type Address, type EvmChain, type Hash } from "./types.js";

export interface EraTypedDataDomain {
  readonly name?: string;
  readonly version?: string;
  readonly chainId?: number | bigint;
  readonly verifyingContract?: string;
  readonly salt?: Hex;
}

export interface TypedDataEnvelope<C extends EvmChain = EvmChain, P extends string = string> {
  readonly chain: C;
  readonly domain: EraTypedDataDomain;
  readonly types: Record<string, readonly { name: string; type: string }[]>;
  readonly primaryType: P;
  readonly message: Record<string, unknown>;
  readonly verifyingContract?: Address<C>;
}

export interface TypedSignature<C extends EvmChain = EvmChain, P extends string = string> {
  readonly signature: Hex;
  readonly digest: Hash<"eip712">;
  readonly chain: C;
  readonly primaryType: P;
  readonly signer?: Address<C>;
}

const hashTypedDataLoose = hashTypedData as unknown as (parameters: {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Hex;

function typedError(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function typedDataEnvelope<C extends EvmChain, P extends string>(input: {
  chain: C;
  domain: EraTypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: P;
  message: Record<string, unknown>;
  allowUnboundDomain?: boolean;
}): TypedDataEnvelope<C, P> {
  const chainId = input.domain.chainId;
  if (chainId === undefined && !input.allowUnboundDomain) {
    typedError("ES3601", "UnboundTypedDataDomain", "EIP-712 domain must include chainId by default.", {
      chain: input.chain.name,
    });
  }
  if (chainId !== undefined && BigInt(chainId) !== BigInt(input.chain.id)) {
    typedError("ES3602", "TypedDataChainMismatch", "EIP-712 domain chainId does not match the EraScript chain binding.", {
      expected: input.chain.id,
      actual: String(chainId),
    });
  }

  const verifying = input.domain.verifyingContract !== undefined
    ? address(input.domain.verifyingContract, input.chain, "typedData.domain.verifyingContract")
    : undefined;

  return {
    chain: input.chain,
    domain: input.domain,
    types: input.types,
    primaryType: input.primaryType,
    message: input.message,
    ...(verifying ? { verifyingContract: verifying } : {}),
  };
}

export function typedDataDigest<C extends EvmChain, P extends string>(envelope: TypedDataEnvelope<C, P>): Hash<"eip712"> {
  try {
    return hash(hashTypedDataLoose({
      domain: envelope.domain as Record<string, unknown>,
      types: envelope.types,
      primaryType: envelope.primaryType,
      message: envelope.message,
    }), "eip712");
  } catch (error) {
    return typedError("ES3603", "TypedDataEncodingError", "Failed to hash EIP-712 typed data.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function typedSignature<C extends EvmChain, P extends string>(
  signatureValue: string,
  envelope: TypedDataEnvelope<C, P>,
  signer?: Address<C>,
): TypedSignature<C, P> {
  const digits = signatureValue.startsWith("0x") ? signatureValue.slice(2) : signatureValue;
  if (!signatureValue.startsWith("0x") || !/^[0-9a-fA-F]+$/.test(digits) || (digits.length !== 128 && digits.length !== 130)) {
    typedError("ES3604", "InvalidTypedSignature", "EIP-712 signature must be 64-byte compact or 65-byte canonical hexadecimal.", {
      actualHexDigits: digits.length,
    });
  }
  return {
    signature: signatureValue as Hex,
    digest: typedDataDigest(envelope),
    chain: envelope.chain,
    primaryType: envelope.primaryType,
    ...(signer ? { signer } : {}),
  };
}
