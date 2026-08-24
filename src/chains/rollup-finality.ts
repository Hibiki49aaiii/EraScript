import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import type { IncludedTx, ConfirmedTx, FinalizedTx } from "../web3/tx.js";
import type { EvmChain } from "../web3/types.js";
import type { EvmChainProfile } from "./types.js";

export type RollupSettlementStage = "l2-included" | "l2-final" | "l1-posted" | "l1-proven" | "l1-finalized";

export interface RollupL1Anchor {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly transactionHash?: `0x${string}`;
}

export interface RollupSettlementEvidence {
  readonly kind: "rollup-settlement-evidence";
  readonly profileId: string;
  readonly protocol: string;
  readonly adapter: string;
  readonly l2TransactionHash: `0x${string}`;
  readonly l2BlockNumber: bigint;
  readonly l2BlockHash: `0x${string}`;
  readonly stage: RollupSettlementStage;
  readonly l1Anchor?: RollupL1Anchor;
  readonly proofReference?: string;
  readonly observedAtMs: number;
  readonly evidenceHash: string;
}

export interface RollupSettlementAdapter<C extends EvmChain = EvmChain> {
  readonly id: string;
  readonly protocol: string;
  readonly profileId: string;
  observe(input: {
    readonly profile: EvmChainProfile;
    readonly transaction: IncludedTx<C> | ConfirmedTx<C, number> | FinalizedTx<C>;
  }): Promise<Omit<RollupSettlementEvidence, "kind" | "profileId" | "protocol" | "adapter" | "observedAtMs" | "evidenceHash">>;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, normalize(inner)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}
function sha256(value: unknown): string {
  return `0x${createHash("sha256").update(stable(value)).digest("hex")}`;
}
function validHash(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) fail("ES4590", "InvalidRollupSettlementHash", `${field} must be a 32-byte EVM hash.`, { field, value });
}

export async function observeRollupSettlement<C extends EvmChain>(input: {
  profile: EvmChainProfile;
  transaction: IncludedTx<C> | ConfirmedTx<C, number> | FinalizedTx<C>;
  adapter: RollupSettlementAdapter<C>;
  nowMs?: number;
}): Promise<RollupSettlementEvidence> {
  if (input.profile.finality.kind !== "evm-rollup") fail("ES4591", "RollupSettlementNotApplicable", "L1 settlement evidence can only be attached to a chain profile using the evm-rollup finality model.", { profile: input.profile.id, finality: input.profile.finality.kind });
  if (input.adapter.profileId !== input.profile.id) fail("ES4592", "RollupSettlementProfileMismatch", "Settlement adapter is configured for a different rollup profile.", { adapterProfile: input.adapter.profileId, profile: input.profile.id });
  if (input.transaction.intent.chain.id !== input.profile.chainId) fail("ES4592", "RollupSettlementProfileMismatch", "L2 transaction chain does not match the selected rollup profile.", { transactionChainId: input.transaction.intent.chain.id, profileChainId: input.profile.chainId });
  const observed = await input.adapter.observe({ profile: input.profile, transaction: input.transaction });
  validHash(observed.l2TransactionHash, "l2TransactionHash");
  validHash(observed.l2BlockHash, "l2BlockHash");
  if (observed.l2TransactionHash.toLowerCase() !== input.transaction.receipt.transactionHash.toLowerCase()) fail("ES4593", "RollupSettlementTransactionMismatch", "Settlement evidence belongs to a different L2 transaction.", { expected: input.transaction.receipt.transactionHash, actual: observed.l2TransactionHash });
  if (observed.l2BlockNumber !== input.transaction.receipt.blockNumber || observed.l2BlockHash.toLowerCase() !== input.transaction.receipt.blockHash.toLowerCase()) fail("ES4594", "RollupSettlementBlockMismatch", "Settlement evidence is anchored to a different L2 block than the transaction receipt.", { expectedBlockNumber: input.transaction.receipt.blockNumber.toString(), actualBlockNumber: observed.l2BlockNumber.toString(), expectedBlockHash: input.transaction.receipt.blockHash, actualBlockHash: observed.l2BlockHash });
  if ((observed.stage === "l1-posted" || observed.stage === "l1-proven" || observed.stage === "l1-finalized") && !observed.l1Anchor) fail("ES4595", "MissingRollupL1Anchor", "L1 settlement stage requires a concrete L1 anchor.", { stage: observed.stage });
  if (observed.l1Anchor) {
    if (!Number.isSafeInteger(observed.l1Anchor.chainId) || observed.l1Anchor.chainId <= 0 || observed.l1Anchor.blockNumber < 0n) fail("ES4596", "InvalidRollupL1Anchor", "Rollup L1 anchor chain/block fields are invalid.");
    validHash(observed.l1Anchor.blockHash, "l1Anchor.blockHash");
    if (observed.l1Anchor.transactionHash) validHash(observed.l1Anchor.transactionHash, "l1Anchor.transactionHash");
  }
  const core = {
    profileId: input.profile.id,
    protocol: input.adapter.protocol,
    adapter: input.adapter.id,
    ...observed,
    observedAtMs: input.nowMs ?? Date.now(),
  };
  return { kind: "rollup-settlement-evidence", ...core, evidenceHash: sha256(core) };
}

export function assertRollupL1Finalized(evidence: RollupSettlementEvidence): RollupSettlementEvidence & { readonly stage: "l1-finalized"; readonly l1Anchor: RollupL1Anchor } {
  if (evidence.stage !== "l1-finalized" || !evidence.l1Anchor) fail("ES4597", "RollupNotL1Finalized", "Rollup execution has not reached protocol-specific L1 finalized settlement.", { stage: evidence.stage, profile: evidence.profileId });
  return evidence as RollupSettlementEvidence & { readonly stage: "l1-finalized"; readonly l1Anchor: RollupL1Anchor };
}
