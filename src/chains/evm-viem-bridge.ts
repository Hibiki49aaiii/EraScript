import { EraDiagnosticError } from "../diagnostics.js";
import { defineEvmChainProfile, genericEvmProfile } from "./types.js";
import type {
  CapabilityStatus,
  EvmCapabilities,
  EvmChainProfile,
  ExecutionBackendKind,
  FinalityModel,
} from "./types.js";

export interface ViemChainLike {
  readonly id: number;
  readonly name: string;
  readonly nativeCurrency?: {
    readonly name?: string;
    readonly symbol?: string;
    readonly decimals?: number;
  };
  readonly testnet?: boolean;
  readonly rpcUrls?: Record<string, { readonly http?: readonly string[]; readonly webSocket?: readonly string[] }>;
  readonly contracts?: Record<string, unknown>;
  readonly fees?: unknown;
  readonly formatters?: unknown;
  readonly serializers?: unknown;
}

export interface EvmViemProfileOverrides {
  readonly id?: string;
  readonly network?: string;
  readonly nativeSymbol?: string;
  readonly finality?: FinalityModel;
  readonly executionBackends?: readonly ExecutionBackendKind[];
  readonly capabilities?: Partial<EvmCapabilities>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) fail("ES4650", "InvalidViemChainName", "Viem chain name cannot be normalized into a stable EraScript profile identifier.", { name: value });
  return normalized;
}

function mergeCapabilities(base: EvmCapabilities, overrides?: Partial<EvmCapabilities>): EvmCapabilities {
  return {
    eip1559: overrides?.eip1559 ?? base.eip1559,
    eip2930: overrides?.eip2930 ?? base.eip2930,
    eip4844: overrides?.eip4844 ?? base.eip4844,
    eip7702: overrides?.eip7702 ?? base.eip7702,
    erc4337: overrides?.erc4337 ?? base.erc4337,
    debugTraceCall: overrides?.debugTraceCall ?? base.debugTraceCall,
    finalizedTag: overrides?.finalizedTag ?? base.finalizedTag,
    safeTag: overrides?.safeTag ?? base.safeTag,
    privateRpc: overrides?.privateRpc ?? base.privateRpc,
    bundleRpc: overrides?.bundleRpc ?? base.bundleRpc,
  };
}

function validateCapability(value: CapabilityStatus, key: keyof EvmCapabilities): void {
  if (value !== "supported" && value !== "unsupported" && value !== "unknown") fail("ES4651", "InvalidEvmCapabilityOverride", "EVM capability override must be supported/unsupported/unknown.", { key, value });
}

/**
 * Converts any viem-compatible Chain object into an EraScript EVM profile.
 * Optional protocol features remain unknown unless explicitly overridden or
 * later promoted by runtime discovery. This is the all-EVM compatibility path:
 * chain metadata is reusable, protocol assumptions are not inferred from name.
 */
export function evmProfileFromViemChain(chain: ViemChainLike, overrides: EvmViemProfileOverrides = {}): EvmChainProfile {
  if (!Number.isSafeInteger(chain.id) || chain.id < 0) fail("ES4652", "InvalidViemChainId", "Viem chain id must be a non-negative safe integer.", { chainId: chain.id });
  if (!chain.name) fail("ES4650", "InvalidViemChainName", "Viem chain definition requires a non-empty name.");
  if (chain.nativeCurrency?.decimals !== undefined && (!Number.isSafeInteger(chain.nativeCurrency.decimals) || chain.nativeCurrency.decimals < 0 || chain.nativeCurrency.decimals > 255)) fail("ES4653", "InvalidViemNativeCurrency", "Viem native currency decimals must be an integer between 0 and 255.", { decimals: chain.nativeCurrency.decimals });

  const baseline = genericEvmProfile({
    id: overrides.id ?? `evm.${slug(chain.name)}.${chain.id}`,
    name: chain.name,
    chainId: chain.id,
    network: overrides.network ?? (chain.testnet ? "testnet" : "mainnet"),
    nativeSymbol: overrides.nativeSymbol ?? chain.nativeCurrency?.symbol ?? "ETH",
    rollup: overrides.finality?.kind === "evm-rollup",
  });
  const capabilities = mergeCapabilities(baseline.capabilities, overrides.capabilities);
  for (const [key, value] of Object.entries(capabilities) as [keyof EvmCapabilities, CapabilityStatus][]) validateCapability(value, key);
  return defineEvmChainProfile({
    ...baseline,
    ...(overrides.finality ? { finality: overrides.finality } : {}),
    ...(overrides.executionBackends ? { executionBackends: [...overrides.executionBackends] } : {}),
    capabilities,
  });
}

export function withEvmCapabilityOverrides(profile: EvmChainProfile, overrides: Partial<EvmCapabilities>): EvmChainProfile {
  const capabilities = mergeCapabilities(profile.capabilities, overrides);
  for (const [key, value] of Object.entries(capabilities) as [keyof EvmCapabilities, CapabilityStatus][]) validateCapability(value, key);
  return defineEvmChainProfile({ ...profile, capabilities });
}
