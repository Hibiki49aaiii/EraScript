import { parseEther, parseGwei } from "viem";
import { EraDiagnosticError } from "../diagnostics.js";

declare const valueBrand: unique symbol;
type ValueBrand<B extends string> = bigint & { readonly [valueBrand]: B };
export type Wei = ValueBrand<"Wei">;
export type Gwei = ValueBrand<"Gwei">;
export type Ether = ValueBrand<"Ether">;
export type Gas = ValueBrand<"Gas">;
export type WeiPerGas = ValueBrand<"WeiPerGas">;
export type MaxFeePerGas = ValueBrand<"MaxFeePerGas">;
export type MaxPriorityFeePerGas = ValueBrand<"MaxPriorityFeePerGas">;

function valueError(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function nonNegative(value: bigint, kind: string): bigint {
  if (value < 0n) valueError("ES3401", "NegativeWeb3Value", `${kind} cannot be negative.`, { value: value.toString() });
  return value;
}

function integerBigInt(value: bigint | string, kind: string): bigint {
  try {
    if (typeof value === "string" && !/^\d+$/.test(value)) {
      valueError("ES3402", "InvalidIntegerValue", `${kind} must be an unsigned integer string or bigint.`, { value });
    }
    return nonNegative(BigInt(value), kind);
  } catch (error) {
    if (error instanceof EraDiagnosticError) throw error;
    return valueError("ES3402", "InvalidIntegerValue", `${kind} could not be converted to an exact integer.`, { value: String(value) });
  }
}

export function wei(value: bigint | string): Wei {
  return integerBigInt(value, "Wei") as Wei;
}

export function ether(value: string): Ether {
  try {
    return nonNegative(parseEther(value), "Ether") as Ether;
  } catch (error) {
    return valueError("ES3403", "InvalidEtherAmount", "Ether amount must be an exact decimal string.", {
      value,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function gwei(value: string): Gwei {
  try {
    return nonNegative(parseGwei(value), "Gwei") as Gwei;
  } catch (error) {
    return valueError("ES3404", "InvalidGweiAmount", "Gwei amount must be an exact decimal string.", {
      value,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function gas(value: bigint | number): Gas {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    valueError("ES3405", "InvalidGas", "Gas must be a non-negative safe integer or bigint.", { value });
  }
  return nonNegative(BigInt(value), "Gas") as Gas;
}

export function toWei(value: Wei | Gwei | Ether): Wei {
  return value as unknown as Wei;
}

export function unwrapWei(value: Wei | Gwei | Ether | WeiPerGas | MaxFeePerGas | MaxPriorityFeePerGas): bigint {
  return value as bigint;
}

export function unwrapGas(value: Gas): bigint {
  return value as bigint;
}

export function weiPerGas(value: Wei | bigint | string): WeiPerGas {
  const raw = typeof value === "bigint" ? value : typeof value === "string" ? integerBigInt(value, "WeiPerGas") : value;
  return nonNegative(raw as bigint, "WeiPerGas") as WeiPerGas;
}

export function maxFeePerGas(value: Wei | bigint | string): MaxFeePerGas {
  return weiPerGas(value) as unknown as MaxFeePerGas;
}

export function maxPriorityFeePerGas(value: Wei | bigint | string): MaxPriorityFeePerGas {
  return weiPerGas(value) as unknown as MaxPriorityFeePerGas;
}
