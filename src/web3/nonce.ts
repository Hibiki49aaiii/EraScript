import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "./types.js";

export type NonceSource = "latest" | "pending" | "safe" | "finalized" | "explicit";

export interface Nonce<C extends EvmChain = EvmChain, S extends NonceSource = NonceSource> {
  readonly chain: C;
  readonly value: number;
  readonly source: S;
  readonly observedAtBlock?: bigint;
}

export function nonce<C extends EvmChain, S extends NonceSource>(
  chain: C,
  value: number,
  source: S,
  observedAtBlock?: bigint,
): Nonce<C, S> {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EraDiagnosticError({
      code: "ES3410",
      severity: "error",
      kind: "InvalidNonce",
      message: "Nonce must be a non-negative safe integer.",
      details: { value },
    });
  }
  return { chain, value, source, ...(observedAtBlock !== undefined ? { observedAtBlock } : {}) };
}

export function nextNonce<C extends EvmChain, S extends NonceSource>(current: Nonce<C, S>): Nonce<C, "explicit"> {
  return nonce(current.chain, current.value + 1, "explicit", current.observedAtBlock);
}
