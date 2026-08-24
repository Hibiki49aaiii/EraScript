import { EraDiagnosticError } from "../diagnostics.js";
import type { Address, EvmChain } from "./types.js";

export type SecretKind = "PrivateKey";

export interface SecretRef<K extends SecretKind, C extends EvmChain = EvmChain> {
  readonly kind: "secret-ref";
  readonly secretType: K;
  readonly source: { readonly type: "env"; readonly name: string };
  readonly chain: C;
  readonly expectedAddress?: Address<C>;
}

export type PrivateKeyRef<C extends EvmChain = EvmChain> = SecretRef<"PrivateKey", C>;

export function privateKeyEnv<C extends EvmChain>(name: string, chain: C, expectedAddress?: Address<C>): PrivateKeyRef<C> {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    throw new EraDiagnosticError({
      code: "ES3801",
      severity: "error",
      kind: "InvalidSecretReference",
      message: "Environment secret references must use a valid environment variable name.",
      details: { name },
    });
  }
  return {
    kind: "secret-ref",
    secretType: "PrivateKey",
    source: { type: "env", name },
    chain,
    ...(expectedAddress ? { expectedAddress } : {}),
  };
}
