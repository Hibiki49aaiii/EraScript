import { EraDiagnosticError } from "../diagnostics.js";
import type { ViemClientLike } from "../web3/rpc.js";
import type { CapabilityStatus, EvmCapabilities, EvmChainProfile } from "./types.js";

export interface EvmCapabilityProbe {
  readonly capability: keyof EvmCapabilities;
  readonly status: CapabilityStatus;
  readonly source: "profile" | "rpc-probe" | "block-shape";
  readonly detail?: string;
}

export interface EvmCapabilityEvidence {
  readonly kind: "evm-capability-evidence";
  readonly profileId: string;
  readonly chainId: number;
  readonly observedAtMs: number;
  readonly capabilities: EvmCapabilities;
  readonly probes: readonly EvmCapabilityProbe[];
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function isMethodUnavailable(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("method not found") || text.includes("-32601") || text.includes("unsupported method") || text.includes("does not exist/is not available");
}

function action<A, R>(client: ViemClientLike, name: string): ((args: A) => Promise<R>) | undefined {
  const value = (client as unknown as Record<string, unknown>)[name];
  return typeof value === "function" ? value.bind(client) as (args: A) => Promise<R> : undefined;
}

async function probeBlockTag(client: ViemClientLike, tag: "safe" | "finalized"): Promise<{ status: CapabilityStatus; detail?: string }> {
  const getBlock = action<{ blockTag: "safe" | "finalized" }, { readonly number?: bigint | null; readonly hash?: string | null }>(client, "getBlock");
  if (!getBlock) return { status: "unknown", detail: "client has no getBlock action" };
  try {
    const block = await getBlock({ blockTag: tag });
    return block.number !== null && block.number !== undefined && block.hash
      ? { status: "supported" }
      : { status: "unknown", detail: `${tag} returned no concrete block` };
  } catch (error) {
    return isMethodUnavailable(error)
      ? { status: "unsupported", detail: errorText(error) }
      : { status: "unknown", detail: errorText(error) };
  }
}

async function latestBlockShape(client: ViemClientLike): Promise<Record<string, unknown> | undefined> {
  const getBlock = action<{ blockTag: "latest" }, Record<string, unknown>>(client, "getBlock");
  if (!getBlock) return undefined;
  try { return await getBlock({ blockTag: "latest" }); }
  catch { return undefined; }
}

async function probeTraceCall(client: ViemClientLike): Promise<{ status: CapabilityStatus; detail?: string }> {
  const request = action<{ method: string; params: readonly unknown[] }, unknown>(client, "request");
  if (!request) return { status: "unknown", detail: "client has no generic request action" };
  try {
    await request({
      method: "debug_traceCall",
      params: [
        { to: "0x0000000000000000000000000000000000000000", data: "0x" },
        "latest",
        { tracer: "prestateTracer", tracerConfig: { diffMode: true, disableCode: true, disableStorage: true } },
      ],
    });
    return { status: "supported" };
  } catch (error) {
    return isMethodUnavailable(error)
      ? { status: "unsupported", detail: errorText(error) }
      : { status: "unknown", detail: errorText(error) };
  }
}

function choose(discovered: CapabilityStatus, configured: CapabilityStatus): CapabilityStatus {
  if (discovered !== "unknown") return discovered;
  return configured;
}

export async function discoverEvmCapabilities(
  client: ViemClientLike,
  profile: EvmChainProfile,
  options: { readonly observedAtMs?: number } = {},
): Promise<EvmCapabilityEvidence> {
  if (client.chain && client.chain.id !== profile.chainId) fail("ES4450", "EvmDiscoveryChainMismatch", "EVM capability discovery client is connected to a different chain.", {
    expectedChainId: profile.chainId,
    actualChainId: client.chain.id,
    profile: profile.id,
  });

  const probes: EvmCapabilityProbe[] = [];
  const block = await latestBlockShape(client);

  const eip1559Detected: CapabilityStatus = block && block.baseFeePerGas !== undefined && block.baseFeePerGas !== null ? "supported" : "unknown";
  probes.push({ capability: "eip1559", status: eip1559Detected, source: "block-shape", ...(eip1559Detected === "unknown" ? { detail: "latest block did not expose baseFeePerGas" } : {}) });

  const eip4844Detected: CapabilityStatus = block && (block.blobGasUsed !== undefined || block.excessBlobGas !== undefined) ? "supported" : "unknown";
  probes.push({ capability: "eip4844", status: eip4844Detected, source: "block-shape", ...(eip4844Detected === "unknown" ? { detail: "latest block did not expose blob gas fields" } : {}) });

  const finalized = await probeBlockTag(client, "finalized");
  probes.push({ capability: "finalizedTag", status: finalized.status, source: "rpc-probe", ...(finalized.detail ? { detail: finalized.detail } : {}) });
  const safe = await probeBlockTag(client, "safe");
  probes.push({ capability: "safeTag", status: safe.status, source: "rpc-probe", ...(safe.detail ? { detail: safe.detail } : {}) });
  const trace = await probeTraceCall(client);
  probes.push({ capability: "debugTraceCall", status: trace.status, source: "rpc-probe", ...(trace.detail ? { detail: trace.detail } : {}) });

  const capabilities: EvmCapabilities = {
    eip1559: choose(eip1559Detected, profile.capabilities.eip1559),
    eip2930: profile.capabilities.eip2930,
    eip4844: choose(eip4844Detected, profile.capabilities.eip4844),
    eip7702: profile.capabilities.eip7702,
    erc4337: profile.capabilities.erc4337,
    debugTraceCall: choose(trace.status, profile.capabilities.debugTraceCall),
    finalizedTag: choose(finalized.status, profile.capabilities.finalizedTag),
    safeTag: choose(safe.status, profile.capabilities.safeTag),
    privateRpc: profile.capabilities.privateRpc,
    bundleRpc: profile.capabilities.bundleRpc,
  };

  for (const capability of ["eip2930", "eip7702", "erc4337", "privateRpc", "bundleRpc"] as const) {
    probes.push({ capability, status: capabilities[capability], source: "profile", detail: "No safe universal base-RPC probe exists; retain explicit profile/runtime adapter evidence." });
  }

  return {
    kind: "evm-capability-evidence",
    profileId: profile.id,
    chainId: profile.chainId,
    observedAtMs: options.observedAtMs ?? Date.now(),
    capabilities,
    probes,
  };
}

export function assertEvmCapability(evidence: EvmCapabilityEvidence, capability: keyof EvmCapabilities): void {
  const status = evidence.capabilities[capability];
  if (status === "supported") return;
  if (status === "unknown") fail("ES4451", "EvmCapabilityUnknown", "Required EVM capability has not been proven for this RPC/backend.", { capability, profile: evidence.profileId });
  fail("ES4452", "EvmCapabilityUnsupported", "Required EVM capability is unsupported by the selected chain/backend evidence.", { capability, profile: evidence.profileId });
}
