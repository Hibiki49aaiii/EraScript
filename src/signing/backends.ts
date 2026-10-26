import type { Hex } from "viem";
import { immutableSnapshot } from "../internal/snapshot.js";
import type { ExternalSigner, ExternalTransactionSigningRequest } from "../web3/external-signer.js";
import { signingError, unsignedTransfer, validateTransferRequest } from "./policy.js";

export interface SigningBackend {
  readonly kind: "external-service" | "hardware-wallet";
  readonly signer: string;
  readonly chainId: number;
  sign(request: ExternalTransactionSigningRequest, signal: AbortSignal): Promise<Hex>;
}

/** Install only on the trusted authority host; provider credentials stay in this adapter. */
export function serviceSigningBackend(signer: ExternalSigner): SigningBackend {
  const sign = signer.signTransaction.bind(signer);
  return Object.freeze({
    kind: "external-service", signer: signer.address, chainId: signer.chain.id,
    async sign(request: ExternalTransactionSigningRequest, signal: AbortSignal) {
      if (signal.aborted) throw signingError("Expired");
      return sign(validateTransferRequest(request));
    },
  });
}

/** A trusted device-driver integration contract; it is not hardware attestation. */
export interface HardwareWalletBridge {
  displayAddress(signal: AbortSignal): Promise<string>;
  signTransaction(input: {
    readonly request: ExternalTransactionSigningRequest;
    readonly unsignedTransaction: Hex;
    readonly requireClearSigning: true;
    readonly signal: AbortSignal;
  }): Promise<{ readonly approval: "device"; readonly rawTransaction: Hex }>;
}

export function hardwareWalletSigningBackend(input: { signer: string; chainId: number; bridge: HardwareWalletBridge }): SigningBackend {
  const signer = input.signer;
  const chainId = input.chainId;
  const display = input.bridge.displayAddress.bind(input.bridge);
  const sign = input.bridge.signTransaction.bind(input.bridge);
  return Object.freeze({
    kind: "hardware-wallet", signer, chainId,
    async sign(request: ExternalTransactionSigningRequest, signal: AbortSignal) {
      request = validateTransferRequest(request);
      if (signal.aborted) throw signingError("Expired");
      const displayed = await display(signal);
      if (signal.aborted) throw signingError("Expired");
      if (typeof displayed !== "string" || displayed.toLowerCase() !== signer.toLowerCase()) throw signingError("Denied");
      const result = immutableSnapshot(await sign(Object.freeze({ request, unsignedTransaction: unsignedTransfer(request), requireClearSigning: true as const, signal })));
      if (signal.aborted) throw signingError("Expired");
      if (result?.approval !== "device") throw signingError("Denied");
      return result.rawTransaction;
    },
  });
}
