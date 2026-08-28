import { createPublicKey, verify as verifySignature } from "node:crypto";
import type {
  MultichainSignatureVerifier,
  MultichainSigningRequest,
  MultichainSigningResponse,
} from "./external-signer.js";
import { solanaAddress } from "./solana.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeBase58(value: string): Uint8Array | undefined {
  if (!value) return undefined;
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return undefined;
    number = number * 58n + BigInt(digit);
  }

  const body: number[] = [];
  while (number > 0n) {
    body.push(Number(number & 0xffn));
    number >>= 8n;
  }
  body.reverse();

  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  return Uint8Array.from([...new Array(leadingZeroes).fill(0), ...body]);
}

function canonicalBase64Bytes(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) return undefined;
  return bytes;
}

export function verifySolanaEd25519SigningResponse(input: {
  readonly request: MultichainSigningRequest;
  readonly response: MultichainSigningResponse;
}): boolean {
  const { request, response } = input;
  if (request.family !== "solana" || request.payloadEncoding !== "base64") return false;
  if (response.signer !== request.signer) return false;
  if (response.signedPayload !== undefined && response.signedPayload !== request.payload) return false;

  try {
    solanaAddress(request.signer);
  } catch {
    return false;
  }

  const publicKeyBytes = decodeBase58(request.signer);
  const signatureBytes = decodeBase58(response.signature);
  const messageBytes = canonicalBase64Bytes(request.payload);
  if (!publicKeyBytes || publicKeyBytes.length !== 32) return false;
  if (!signatureBytes || signatureBytes.length !== 64) return false;
  if (!messageBytes) return false;

  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]),
      format: "der",
      type: "spki",
    });
    return verifySignature(
      null,
      Buffer.from(messageBytes),
      publicKey,
      Buffer.from(signatureBytes),
    );
  } catch {
    return false;
  }
}

export const solanaEd25519SignatureVerifier: MultichainSignatureVerifier =
  verifySolanaEd25519SigningResponse;

export const SOLANA_ED25519_VERIFIER_NAME = "erascript-solana-ed25519";
