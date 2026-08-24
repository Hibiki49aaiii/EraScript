import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "../web3/types.js";
import type { RollupL1Anchor, RollupSettlementAdapter, RollupSettlementStage } from "./rollup-finality.js";
import type { EvmChainProfile } from "./types.js";

export interface OpStackRollupRpcLike {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

interface OpBlockRef {
  readonly hash: `0x${string}`;
  readonly number: bigint;
  readonly l1Origin?: {
    readonly hash: `0x${string}`;
    readonly number: bigint;
  };
}

interface OpSyncStatus {
  readonly safeL1: OpBlockRef;
  readonly finalizedL1: OpBlockRef;
  readonly safeL2: OpBlockRef;
  readonly finalizedL2: OpBlockRef;
}

interface OpOutputAtBlock {
  readonly outputRoot: `0x${string}`;
  readonly blockRef: OpBlockRef;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4660", "MalformedOpStackRpcResponse", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function quantity(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4660", "MalformedOpStackRpcResponse", `${field} must be a non-negative RPC quantity.`, { field, value: String(value) });
}

function hash32(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail("ES4660", "MalformedOpStackRpcResponse", `${field} must be a 32-byte hash.`, { field, value: String(value) });
  return value as `0x${string}`;
}

function field(record: Record<string, unknown>, snake: string, camel: string): unknown {
  return record[snake] ?? record[camel];
}

function blockRef(value: unknown, label: string): OpBlockRef {
  const record = object(value, label);
  const originRaw = field(record, "l1origin", "l1Origin");
  let l1Origin: OpBlockRef["l1Origin"];
  if (originRaw !== undefined && originRaw !== null) {
    const origin = object(originRaw, `${label}.l1Origin`);
    l1Origin = {
      hash: hash32(origin.hash, `${label}.l1Origin.hash`),
      number: quantity(origin.number, `${label}.l1Origin.number`),
    };
  }
  return {
    hash: hash32(record.hash, `${label}.hash`),
    number: quantity(record.number, `${label}.number`),
    ...(l1Origin ? { l1Origin } : {}),
  };
}

function syncStatus(value: unknown): OpSyncStatus {
  const record = object(value, "optimism_syncStatus result");
  return {
    safeL1: blockRef(field(record, "safe_l1", "safeL1"), "safe_l1"),
    finalizedL1: blockRef(field(record, "finalized_l1", "finalizedL1"), "finalized_l1"),
    safeL2: blockRef(field(record, "safe_l2", "safeL2"), "safe_l2"),
    finalizedL2: blockRef(field(record, "finalized_l2", "finalizedL2"), "finalized_l2"),
  };
}

function outputAtBlock(value: unknown): OpOutputAtBlock {
  if (Array.isArray(value)) {
    if (value.length < 3) fail("ES4661", "IncompleteOpStackOutputEvidence", "optimism_outputAtBlock must expose blockRef as well as outputRoot for EraScript finality verification.");
    return {
      outputRoot: hash32(value[1], "outputRoot"),
      blockRef: blockRef(value[2], "blockRef"),
    };
  }
  const record = object(value, "optimism_outputAtBlock result");
  return {
    outputRoot: hash32(record.outputRoot, "outputRoot"),
    blockRef: blockRef(record.blockRef, "blockRef"),
  };
}

function l1Anchor(origin: NonNullable<OpBlockRef["l1Origin"]>): RollupL1Anchor {
  return { chainId: 1, blockNumber: origin.number, blockHash: origin.hash };
}

export function createOpStackSettlementAdapter<C extends EvmChain>(input: {
  profile: EvmChainProfile;
  rpc: OpStackRollupRpcLike;
  id?: string;
  l1ChainId?: number;
}): RollupSettlementAdapter<C> {
  if (input.profile.finality.kind !== "evm-rollup") fail("ES4662", "OpStackProfileNotRollup", "OP Stack settlement adapter requires an evm-rollup profile.", { profile: input.profile.id });
  const l1ChainId = input.l1ChainId ?? 1;
  if (!Number.isSafeInteger(l1ChainId) || l1ChainId <= 0) fail("ES4663", "InvalidOpStackL1ChainId", "OP Stack settlement adapter requires a positive safe L1 chain id.", { l1ChainId });

  return {
    id: input.id ?? "op-stack-sync-status",
    protocol: "op-stack",
    profileId: input.profile.id,
    async observe({ transaction }) {
      const blockNumber = transaction.receipt.blockNumber;
      const [rawSync, rawOutput] = await Promise.all([
        input.rpc.request({ method: "optimism_syncStatus", params: [] }),
        input.rpc.request({ method: "optimism_outputAtBlock", params: [`0x${blockNumber.toString(16)}`] }),
      ]);
      const sync = syncStatus(rawSync);
      const output = outputAtBlock(rawOutput);
      const receiptHash = transaction.receipt.blockHash.toLowerCase();
      if (output.blockRef.number !== blockNumber || output.blockRef.hash.toLowerCase() !== receiptHash) {
        fail("ES4664", "OpStackOutputBlockMismatch", "OP Stack output evidence belongs to a different L2 block than the transaction receipt.", {
          receiptBlockNumber: blockNumber.toString(),
          outputBlockNumber: output.blockRef.number.toString(),
          receiptBlockHash: transaction.receipt.blockHash,
          outputBlockHash: output.blockRef.hash,
        });
      }
      if (!output.blockRef.l1Origin) fail("ES4661", "IncompleteOpStackOutputEvidence", "OP Stack output blockRef is missing its L1 origin.", { blockNumber: blockNumber.toString() });

      const origin = output.blockRef.l1Origin;
      let stage: RollupSettlementStage = "l2-included";
      let anchor: RollupL1Anchor | undefined;
      if (blockNumber <= sync.finalizedL2.number && origin.number <= sync.finalizedL1.number) {
        stage = "l1-finalized";
        anchor = { ...l1Anchor(origin), chainId: l1ChainId };
      } else if (blockNumber <= sync.safeL2.number && origin.number <= sync.safeL1.number) {
        stage = "l1-posted";
        anchor = { ...l1Anchor(origin), chainId: l1ChainId };
      }

      return {
        l2TransactionHash: transaction.receipt.transactionHash,
        l2BlockNumber: blockNumber,
        l2BlockHash: transaction.receipt.blockHash,
        stage,
        ...(anchor ? { l1Anchor: anchor } : {}),
        proofReference: `op-output-root:${output.outputRoot}`,
      };
    },
  };
}
