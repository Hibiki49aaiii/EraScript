import type {
  MultichainSignatureVerifier,
  MultichainSigningRequest,
  MultichainSigningResponse,
} from "./external-signer.js";
import { suiAddress } from "./sui.js";

export interface SuiSdkTransactionSignatureVerifierOptions {
  readonly address?: string;
  readonly client?: unknown;
}

export type SuiSdkIsValidTransactionSignature = (
  transaction: Uint8Array,
  signature: string,
  options?: SuiSdkTransactionSignatureVerifierOptions,
) => boolean | Promise<boolean>;

export interface SuiSdkSignatureVerifierBridgeOptions {
  readonly isValidTransactionSignature: SuiSdkIsValidTransactionSignature;
  /**
   * Optional current @mysten/sui client. Required by SDK verification for
   * schemes that need environmental state (for example zkLogin JWK/epoch data).
   */
  readonly client?: unknown;
}

function canonicalBase64Bytes(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) return undefined;
  return bytes;
}

/**
 * Bridges current @mysten/sui/verify isValidTransactionSignature() into the
 * family-neutral EraScript external signer contract.
 *
 * EraScript verifies the signing request/context binding. The Sui SDK remains
 * responsible for scheme parsing, TransactionData intent hashing,
 * cryptographic verification, and deriving/validating the Sui address.
 *
 * SDK environmental failures are intentionally allowed to propagate instead
 * of being converted into false, matching the current SDK contract.
 */
export function createSuiSdkTransactionSignatureVerifier(
  options: SuiSdkSignatureVerifierBridgeOptions,
): MultichainSignatureVerifier {
  return async (input: {
    readonly request: MultichainSigningRequest;
    readonly response: MultichainSigningResponse;
  }): Promise<boolean> => {
    const { request, response } = input;
    if (request.family !== "sui" || request.payloadEncoding !== "base64") return false;
    if (response.signer !== request.signer) return false;
    if (response.signedPayload !== undefined && response.signedPayload !== request.payload) return false;

    try {
      suiAddress(request.signer);
    } catch {
      return false;
    }

    const transaction = canonicalBase64Bytes(request.payload);
    if (!transaction || !response.signature) return false;

    return options.isValidTransactionSignature(
      transaction,
      response.signature,
      {
        address: request.signer,
        ...(options.client !== undefined ? { client: options.client } : {}),
      },
    );
  };
}

export const SUI_SDK_TRANSACTION_VERIFIER_NAME = "mysten-sui-transaction-signature";
