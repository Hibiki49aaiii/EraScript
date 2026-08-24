import { EraDiagnosticError } from "../diagnostics.js";
import type { SuiTransactionInspection, SuiTransactionInspector } from "./sui-adapter.js";

export interface SuiTransactionDataLike {
  readonly sender?: string | null;
  readonly gasData?: {
    readonly owner?: string | null;
    readonly budget?: bigint | string | number | null;
    readonly price?: bigint | string | number | null;
  } | null;
  readonly commands?: readonly unknown[];
}

export interface SuiTransactionInstanceLike {
  getData(): SuiTransactionDataLike;
}

export interface SuiTransactionFactoryLike {
  from(serialized: string | Uint8Array): SuiTransactionInstanceLike;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function createSuiSdkTransactionInspector(factory: SuiTransactionFactoryLike): SuiTransactionInspector {
  return (serializedTransaction): SuiTransactionInspection => {
    let data: SuiTransactionDataLike;
    try { data = factory.from(serializedTransaction).getData(); }
    catch (error) { return fail("ES4620", "SuiSdkTransactionDecodeFailed", "@mysten/sui Transaction.from(bytes).getData() failed to decode the final BCS transaction bytes.", { cause: error instanceof Error ? error.message : String(error) }); }
    if (typeof data.sender !== "string" || typeof data.gasData?.owner !== "string") fail("ES4621", "MalformedSuiSdkTransactionData", "Decoded Sui transaction is missing sender or gasData.owner.");
    return {
      sender: data.sender,
      gasOwner: data.gasData.owner,
      ...(data.gasData.budget !== undefined && data.gasData.budget !== null ? { gasBudget: data.gasData.budget } : {}),
      ...(data.gasData.price !== undefined && data.gasData.price !== null ? { gasPrice: data.gasData.price } : {}),
      ...(Array.isArray(data.commands) ? { commandCount: data.commands.length } : {}),
    };
  };
}
