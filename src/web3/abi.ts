import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  type Abi,
  type AbiParameter,
  type Hex,
} from "viem";
import { EraDiagnosticError } from "../diagnostics.js";
import { calldata, type Calldata } from "./types.js";

const encodeFunction = encodeFunctionData as unknown as (parameters: {
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}) => Hex;

const decodeFunction = decodeFunctionData as unknown as (parameters: {
  abi: Abi;
  data: Hex;
}) => { functionName: string; args?: readonly unknown[] };

const encodeParameters = encodeAbiParameters as unknown as (
  parameters: readonly AbiParameter[],
  values: readonly unknown[],
) => Hex;

const decodeParameters = decodeAbiParameters as unknown as (
  parameters: readonly AbiParameter[],
  data: Hex,
) => readonly unknown[];

function abiError(code: string, kind: string, message: string, cause: unknown): never {
  throw new EraDiagnosticError({
    code,
    severity: "error",
    kind,
    message,
    suggestion: "Verify the ABI, function signature, argument order, array dimensions, and integer widths.",
    details: { cause: cause instanceof Error ? cause.message : String(cause) },
  });
}

export function encodeCall<Signature extends string = string>(
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Calldata<Signature> {
  try {
    return calldata<Signature>(encodeFunction({ abi, functionName, args }));
  } catch (error) {
    return abiError("ES3301", "AbiEncodingError", `Failed to encode ${functionName} calldata.`, error);
  }
}

export interface DecodedCall {
  readonly functionName: string;
  readonly args: readonly unknown[];
}

export function decodeCall(abi: Abi, data: string): DecodedCall {
  try {
    const checked = calldata(data);
    const decoded = decodeFunction({ abi, data: checked as Hex });
    return {
      functionName: decoded.functionName,
      args: decoded.args ?? [],
    };
  } catch (error) {
    return abiError("ES3302", "AbiDecodingError", "Failed to decode function calldata with the supplied ABI.", error);
  }
}

export function encodeArguments(parameters: readonly AbiParameter[], values: readonly unknown[]): Hex {
  try {
    return encodeParameters(parameters, values);
  } catch (error) {
    return abiError("ES3303", "AbiArgumentEncodingError", "Failed to ABI-encode arguments.", error);
  }
}

export function decodeArguments(parameters: readonly AbiParameter[], data: string): readonly unknown[] {
  try {
    const checked = calldata(data);
    return decodeParameters(parameters, checked as Hex);
  } catch (error) {
    return abiError("ES3304", "AbiArgumentDecodingError", "Failed to ABI-decode arguments.", error);
  }
}

export function selectorOf(data: string): Hex {
  const checked = calldata(data);
  if (checked.length < 10) {
    throw new EraDiagnosticError({
      code: "ES3305",
      severity: "error",
      kind: "MissingFunctionSelector",
      message: "Calldata is shorter than the 4-byte EVM function selector.",
    });
  }
  return checked.slice(0, 10) as Hex;
}

export function stripSelector(data: string): Hex {
  const checked = calldata(data);
  selectorOf(checked);
  return `0x${checked.slice(10)}` as Hex;
}

/**
 * Decode ABI arguments from full calldata while safely removing the 4-byte selector.
 * This directly covers captured transaction calldata / proof extraction workflows.
 */
export function decodeArgumentsFromCalldata(
  parameters: readonly AbiParameter[],
  fullCalldata: string,
): readonly unknown[] {
  return decodeArguments(parameters, stripSelector(fullCalldata));
}
