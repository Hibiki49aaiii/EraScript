import { EraDiagnosticError } from "../diagnostics.js";
import type { SolanaTransactionInspector, SolanaTransactionInspection } from "./solana-adapter.js";
import { solanaBlockhash } from "./solana.js";
import type { SolanaSigningInspection, SolanaSigningInspector } from "./solana-signing.js";

export interface SolanaKitDecoder<T> {
  decode(bytes: Uint8Array): T;
}

export interface SolanaKitReadonlyBytes extends ArrayLike<number> {
  readonly byteLength: number;
}

export interface SolanaKitDecodedTransactionLike {
  readonly messageBytes: SolanaKitReadonlyBytes;
}

export interface SolanaKitCompiledMessageLike {
  readonly version: "legacy" | 0 | 1;
  readonly lifetimeToken: string;
  readonly header: { readonly numSignerAccounts: number };
  readonly staticAccounts: readonly string[];
  readonly addressTableLookups?: readonly {
    readonly lookupTableAddress: string;
    readonly writableIndexes: readonly number[];
    readonly readonlyIndexes: readonly number[];
  }[];
}

export interface SolanaKitCodecBridgeInput {
  readonly transactionDecoder: SolanaKitDecoder<SolanaKitDecodedTransactionLike>;
  readonly messageDecoder: SolanaKitDecoder<SolanaKitCompiledMessageLike>;
}

export interface SolanaKitEraInspectors {
  readonly transactionInspector: SolanaTransactionInspector;
  readonly signingInspector: SolanaSigningInspector;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function readonlyBytes(value: SolanaKitReadonlyBytes, label: string): Uint8Array {
  if (!Number.isSafeInteger(value.length) || value.length <= 0 || value.byteLength !== value.length) {
    fail("ES4610", "MalformedSolanaKitDecodedTransaction", `${label} must be a non-empty byte array.`);
  }
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const byte = value[index];
    if (typeof byte !== "number" || !Number.isSafeInteger(byte) || byte < 0 || byte > 255) {
      fail("ES4610", "MalformedSolanaKitDecodedTransaction", `${label} contains a non-byte value.`, {
        index,
        value: String(byte),
      });
    }
    bytes[index] = byte;
  }
  return bytes;
}

function decode(input: SolanaKitCodecBridgeInput, serializedTransaction: Uint8Array): { transaction: SolanaKitDecodedTransactionLike; message: SolanaKitCompiledMessageLike } {
  let transaction: SolanaKitDecodedTransactionLike;
  let message: SolanaKitCompiledMessageLike;
  try {
    transaction = input.transactionDecoder.decode(serializedTransaction);
    const messageBytes = readonlyBytes(transaction.messageBytes, "Solana Kit transaction messageBytes");
    message = input.messageDecoder.decode(messageBytes);
  } catch (error) {
    if (error instanceof EraDiagnosticError) throw error;
    return fail("ES4611", "SolanaKitDecodeFailed", "Current Solana Kit decoder failed to decode transaction/message bytes.", { cause: error instanceof Error ? error.message : String(error) });
  }
  if (message.version !== "legacy" && message.version !== 0 && message.version !== 1) fail("ES4610", "MalformedSolanaKitDecodedTransaction", "Solana Kit compiled message returned an unknown transaction version.", { version: String(message.version) });
  if (typeof message.lifetimeToken !== "string" || !Number.isSafeInteger(message.header.numSignerAccounts) || message.header.numSignerAccounts < 1) fail("ES4610", "MalformedSolanaKitDecodedTransaction", "Solana Kit compiled message is missing lifetime/signer metadata.");
  if (!Array.isArray(message.staticAccounts) || message.staticAccounts.length < message.header.numSignerAccounts) fail("ES4610", "MalformedSolanaKitDecodedTransaction", "Solana Kit static account list is shorter than numSignerAccounts.", { staticAccounts: message.staticAccounts.length, numSignerAccounts: message.header.numSignerAccounts });
  return { transaction, message };
}

export function createSolanaKitEraInspectors(input: SolanaKitCodecBridgeInput): SolanaKitEraInspectors {
  const transactionInspector: SolanaTransactionInspector = (serializedTransaction): SolanaTransactionInspection => {
    const { message } = decode(input, serializedTransaction);
    if (message.version === 1) fail("ES4612", "UnsupportedSolanaKitTransactionVersion", "EraScript v0.6 runtime gate currently supports Solana legacy/v0 transactions; v1 decoder output is recognized but not execution-enabled.");
    return {
      version: message.version,
      recentBlockhash: solanaBlockhash(message.lifetimeToken),
      signerCount: message.header.numSignerAccounts,
      ...(message.version === 0 && message.addressTableLookups
        ? {
            addressTableLookups: message.addressTableLookups.map((lookup) => ({
              table: lookup.lookupTableAddress,
              writableIndexes: [...lookup.writableIndexes],
              readonlyIndexes: [...lookup.readonlyIndexes],
            })),
          }
        : {}),
    };
  };

  const signingInspector: SolanaSigningInspector = (serializedTransaction): SolanaSigningInspection => {
    const { transaction, message } = decode(input, serializedTransaction);
    if (message.version === 1) fail("ES4612", "UnsupportedSolanaKitTransactionVersion", "EraScript v0.6 signing gate currently supports Solana legacy/v0 transactions only.");
    const requiredSigners = message.staticAccounts.slice(0, message.header.numSignerAccounts);
    return { signingPayloadBase64: Buffer.from(transaction.messageBytes).toString("base64"), requiredSigners, feePayer: requiredSigners[0]! };
  };

  return { transactionInspector, signingInspector };
}
