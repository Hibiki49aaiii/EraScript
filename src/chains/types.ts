import { EraDiagnosticError } from "../diagnostics.js";

export type ChainFamily = "evm" | "solana" | "sui";
export type CapabilityStatus = "supported" | "unsupported" | "unknown";

export type ExecutionBackendKind =
  | "public-rpc"
  | "private-rpc"
  | "flashbots-bundle"
  | "jito-bundle"
  | "railgun-broadcaster"
  | "railgun-self-submit"
  | "sui-rpc"
  | "custom";

export type FinalityModel =
  | { readonly kind: "evm-confirmations"; readonly supportsFinalizedTag: CapabilityStatus; readonly supportsSafeTag: CapabilityStatus }
  | { readonly kind: "evm-rollup"; readonly l2Inclusion: true; readonly l1Settlement: CapabilityStatus }
  | { readonly kind: "solana-commitment"; readonly levels: readonly ["processed", "confirmed", "finalized"] }
  | { readonly kind: "sui-effects-checkpoint"; readonly effectsFinality: true; readonly checkpointInclusion: true };

export interface BaseChainProfile<Family extends ChainFamily = ChainFamily> {
  readonly id: string;
  readonly name: string;
  readonly family: Family;
  readonly network: string;
  readonly nativeSymbol: string;
  readonly finality: FinalityModel;
  readonly executionBackends: readonly ExecutionBackendKind[];
}

export interface EvmCapabilities {
  readonly eip1559: CapabilityStatus;
  readonly eip2930: CapabilityStatus;
  readonly eip4844: CapabilityStatus;
  readonly eip7702: CapabilityStatus;
  readonly erc4337: CapabilityStatus;
  readonly debugTraceCall: CapabilityStatus;
  readonly finalizedTag: CapabilityStatus;
  readonly safeTag: CapabilityStatus;
  readonly privateRpc: CapabilityStatus;
  readonly bundleRpc: CapabilityStatus;
}

export interface EvmChainProfile extends BaseChainProfile<"evm"> {
  readonly chainId: number;
  readonly capabilities: EvmCapabilities;
}

export interface SolanaCapabilities {
  readonly versionedTransactions: CapabilityStatus;
  readonly addressLookupTables: CapabilityStatus;
  readonly durableNonce: CapabilityStatus;
  readonly jitoBundles: CapabilityStatus;
  readonly maxTransactionVersion: "legacy" | 0 | 1 | "unknown";
}

export interface SolanaChainProfile extends BaseChainProfile<"solana"> {
  readonly cluster: string;
  readonly capabilities: SolanaCapabilities;
}

export interface SuiCapabilities {
  readonly programmableTransactions: CapabilityStatus;
  readonly sponsoredTransactions: CapabilityStatus;
  readonly addressBalanceGas: CapabilityStatus;
  readonly dryRun: CapabilityStatus;
}

export interface SuiChainProfile extends BaseChainProfile<"sui"> {
  readonly capabilities: SuiCapabilities;
}

export type ChainProfile = EvmChainProfile | SolanaChainProfile | SuiChainProfile;

export interface ExecutionBackendDescriptor {
  readonly id: string;
  readonly kind: ExecutionBackendKind;
  readonly families: readonly ChainFamily[];
  readonly atomicity: "single-transaction" | "multi-transaction" | "none" | "provider-defined";
  readonly privacy: "public" | "private-submission" | "protocol-private" | "provider-defined";
  readonly requires?: readonly string[];
}

export interface ProtocolOverlayDescriptor {
  readonly id: string;
  readonly name: string;
  readonly baseFamilies: readonly ChainFamily[];
  readonly executionBackends: readonly ExecutionBackendKind[];
  readonly privacy: "none" | "shielded" | "confidential";
  readonly proofSystem?: string;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function safeIdentifier(value: string, field: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) fail("ES4400", "InvalidChainProfileIdentifier", `${field} must be a stable identifier.`, { field, value });
  return value;
}

function assertBackends(profile: BaseChainProfile): void {
  if (profile.executionBackends.length === 0) fail("ES4401", "MissingExecutionBackend", "Every chain profile must expose at least one execution backend.", { profile: profile.id });
  const unique = new Set(profile.executionBackends);
  if (unique.size !== profile.executionBackends.length) fail("ES4402", "DuplicateExecutionBackend", "Chain profile contains duplicate execution backend entries.", { profile: profile.id });
}

export function defineEvmChainProfile(input: EvmChainProfile): EvmChainProfile {
  safeIdentifier(input.id, "id");
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 0) fail("ES4403", "InvalidEvmChainId", "EVM chainId must be a non-negative safe integer.", { chainId: input.chainId });
  assertBackends(input);
  return input;
}

export function defineSolanaChainProfile(input: SolanaChainProfile): SolanaChainProfile {
  safeIdentifier(input.id, "id");
  safeIdentifier(input.cluster, "cluster");
  assertBackends(input);
  return input;
}

export function defineSuiChainProfile(input: SuiChainProfile): SuiChainProfile {
  safeIdentifier(input.id, "id");
  assertBackends(input);
  return input;
}

export function assertBackendCompatible(profile: ChainProfile, backend: ExecutionBackendDescriptor): void {
  if (!backend.families.includes(profile.family)) fail("ES4404", "ExecutionBackendFamilyMismatch", "Execution backend does not support this chain family.", { profile: profile.id, family: profile.family, backend: backend.id });
  if (!profile.executionBackends.includes(backend.kind)) fail("ES4405", "ExecutionBackendNotEnabled", "Execution backend is not enabled by this chain profile.", { profile: profile.id, backend: backend.kind });
}

/**
 * Generic EVM profiles intentionally default optional protocol features to `unknown`.
 * EraScript must discover or explicitly configure them before relying on the feature.
 */
export function genericEvmProfile(input: {
  id: string;
  name: string;
  chainId: number;
  network?: string;
  nativeSymbol?: string;
  rollup?: boolean;
}): EvmChainProfile {
  const unknown: CapabilityStatus = "unknown";
  return defineEvmChainProfile({
    id: input.id,
    name: input.name,
    family: "evm",
    network: input.network ?? "mainnet",
    nativeSymbol: input.nativeSymbol ?? "ETH",
    chainId: input.chainId,
    finality: input.rollup
      ? { kind: "evm-rollup", l2Inclusion: true, l1Settlement: unknown }
      : { kind: "evm-confirmations", supportsFinalizedTag: unknown, supportsSafeTag: unknown },
    executionBackends: ["public-rpc", "custom"],
    capabilities: {
      eip1559: unknown,
      eip2930: unknown,
      eip4844: unknown,
      eip7702: unknown,
      erc4337: unknown,
      debugTraceCall: unknown,
      finalizedTag: unknown,
      safeTag: unknown,
      privateRpc: unknown,
      bundleRpc: unknown,
    },
  });
}
