import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import { solanaAddress, solanaTransactionSignature, type Lamports, type SolanaAddress, type SolanaCommitment, type SolanaTransactionSignature } from "./solana.js";
import type { SolanaChainProfile } from "./types.js";

export interface JitoRelayLike {
  readonly url?: string;
  request<Result>(method: string, params: readonly unknown[]): Promise<Result>;
}

export interface JitoTipEvidence {
  readonly kind: "jito-tip";
  readonly account: SolanaAddress;
  readonly lamports: Lamports;
  readonly transactionIndex: number;
}

export interface JitoTipAccountsEvidence {
  readonly kind: "jito-tip-accounts";
  readonly accounts: readonly SolanaAddress[];
  readonly observedAtMs: number;
  readonly relay?: string;
}

export interface JitoTipTransferInspection {
  readonly recipient: string;
  readonly lamports: bigint | string | number;
  readonly via?: "top-level" | "cpi" | "unknown";
}

export interface JitoTransactionTipInspection {
  readonly tipTransfers: readonly JitoTipTransferInspection[];
  readonly tipAccountResolvedViaAddressLookupTable?: boolean;
}

export type JitoTransactionInspector = (serializedTransaction: Uint8Array, transactionIndex: number) => JitoTransactionTipInspection | Promise<JitoTransactionTipInspection>;

export interface JitoBundleDraft {
  readonly state: "jito-bundle-draft";
  readonly profileId: string;
  readonly transactionsBase64: readonly string[];
  readonly expectedSignatures?: readonly SolanaTransactionSignature[];
  readonly tip: JitoTipEvidence;
  readonly bindingHash: string;
}

export interface JitoVerifiedBundleDraft extends Omit<JitoBundleDraft, "state"> {
  readonly state: "jito-bundle-verified";
  readonly tipAccountsEvidence: JitoTipAccountsEvidence;
  readonly tipInspection: {
    readonly transactionIndex: number;
    readonly recipient: SolanaAddress;
    readonly lamports: bigint;
    readonly via: "top-level" | "cpi" | "unknown";
    readonly tipAccountResolvedViaAddressLookupTable: false;
  };
}

export interface JitoBundleSubmitted extends Omit<JitoVerifiedBundleDraft, "state"> {
  readonly state: "jito-bundle-submitted";
  readonly bundleId: string;
  readonly submittedAtMs: number;
  readonly relay?: string;
}

export type JitoInflightStatus = "Pending" | "Failed" | "Landed" | "Invalid";
export interface JitoInflightEvidence {
  readonly state: "jito-inflight-status";
  readonly bundleId: string;
  readonly status: JitoInflightStatus;
  readonly landedSlot?: bigint;
}

export interface JitoBundleStatusEvidence {
  readonly state: "jito-bundle-status";
  readonly bundleId: string;
  readonly found: boolean;
  readonly slot?: bigint;
  readonly confirmationStatus?: SolanaCommitment;
  readonly transactions: readonly SolanaTransactionSignature[];
  readonly err?: unknown;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function integer(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  fail("ES4470", "MalformedJitoResponse", `Jito field '${field}' must be a non-negative integer.`, { field, value: String(value) });
}
function base64Bytes(value: string, index: number): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) fail("ES4471", "InvalidJitoTransactionEncoding", "Jito bundle transaction must use canonical base64 encoding.", { index });
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) fail("ES4471", "InvalidJitoTransactionEncoding", "Jito bundle transaction base64 is malformed or empty.", { index });
  return bytes;
}
function base64(value: string, index: number): string {
  base64Bytes(value, index);
  return value;
}
function hashBundle(transactions: readonly string[], tip: JitoTipEvidence): string {
  return `0x${createHash("sha256").update(JSON.stringify({ transactions, tip: { account: tip.account, lamports: tip.lamports.toString(), transactionIndex: tip.transactionIndex } })).digest("hex")}`;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4470", "MalformedJitoResponse", `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function resultValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "result" in (value as Record<string, unknown>)) return (value as Record<string, unknown>).result;
  return value;
}

export function jitoTip(input: { account: string; lamports: Lamports; transactionIndex: number }): JitoTipEvidence {
  if (input.lamports < 1_000n) fail("ES4472", "InvalidJitoTip", "Jito bundle tip must be at least 1000 lamports.", { lamports: input.lamports.toString() });
  if (!Number.isSafeInteger(input.transactionIndex) || input.transactionIndex < 0) fail("ES4472", "InvalidJitoTip", "Jito tip transactionIndex must be a non-negative safe integer.", { transactionIndex: input.transactionIndex });
  return { kind: "jito-tip", account: solanaAddress(input.account), lamports: input.lamports, transactionIndex: input.transactionIndex };
}

export async function readJitoTipAccounts(relay: JitoRelayLike, nowMs = Date.now()): Promise<JitoTipAccountsEvidence> {
  const raw = resultValue(await relay.request<unknown>("getTipAccounts", []));
  if (!Array.isArray(raw) || raw.length === 0) fail("ES4480", "JitoTipAccountsUnavailable", "Jito getTipAccounts did not return any tip accounts.");
  const accounts = raw.map((value, index) => {
    if (typeof value !== "string") fail("ES4470", "MalformedJitoResponse", "Jito tip account must be a base58 string.", { index });
    return solanaAddress(value);
  });
  if (new Set(accounts).size !== accounts.length) fail("ES4481", "DuplicateJitoTipAccount", "Jito getTipAccounts returned duplicate accounts.");
  return { kind: "jito-tip-accounts", accounts, observedAtMs: nowMs, ...(relay.url ? { relay: relay.url } : {}) };
}

export function createJitoBundle(input: { profile: SolanaChainProfile; transactionsBase64: readonly string[]; expectedSignatures?: readonly string[]; tip: JitoTipEvidence }): JitoBundleDraft {
  if (input.profile.family !== "solana" || !input.profile.executionBackends.includes("jito-bundle")) fail("ES4473", "JitoBackendNotEnabled", "Selected Solana profile does not enable Jito bundles.", { profile: input.profile.id });
  if (input.transactionsBase64.length < 1 || input.transactionsBase64.length > 5) fail("ES4474", "InvalidJitoBundleSize", "Jito bundles must contain between 1 and 5 signed transactions.", { count: input.transactionsBase64.length });
  const transactionsBase64 = input.transactionsBase64.map(base64);
  if (input.tip.transactionIndex >= transactionsBase64.length) fail("ES4472", "InvalidJitoTip", "Jito tip transactionIndex points outside the bundle.", { transactionIndex: input.tip.transactionIndex, transactions: transactionsBase64.length });
  const expectedSignatures = input.expectedSignatures?.map(solanaTransactionSignature);
  if (expectedSignatures && expectedSignatures.length !== transactionsBase64.length) fail("ES4475", "JitoSignatureCountMismatch", "Expected transaction signature list must have one entry per bundle transaction.", { signatures: expectedSignatures.length, transactions: transactionsBase64.length });
  return { state: "jito-bundle-draft", profileId: input.profile.id, transactionsBase64, ...(expectedSignatures ? { expectedSignatures } : {}), tip: input.tip, bindingHash: hashBundle(transactionsBase64, input.tip) };
}

export async function verifyJitoBundleTip(draft: JitoBundleDraft, tipAccountsEvidence: JitoTipAccountsEvidence, inspector: JitoTransactionInspector): Promise<JitoVerifiedBundleDraft> {
  if (!tipAccountsEvidence.accounts.includes(draft.tip.account)) fail("ES4482", "JitoTipAccountNotOfficial", "Configured Jito tip recipient is not present in the observed getTipAccounts set.", { tipAccount: draft.tip.account });
  let inspection: JitoTransactionTipInspection;
  try { inspection = await inspector(base64Bytes(draft.transactionsBase64[draft.tip.transactionIndex]!, draft.tip.transactionIndex), draft.tip.transactionIndex); }
  catch (error) { return fail("ES4483", "JitoTipInspectionFailed", "Failed to inspect the serialized Jito tip transaction.", { cause: error instanceof Error ? error.message : String(error) }); }
  if (inspection.tipAccountResolvedViaAddressLookupTable === true) fail("ES4484", "JitoTipAddressLookupTableRejected", "Jito tip accounts must not be resolved through an Address Lookup Table.", { transactionIndex: draft.tip.transactionIndex, tipAccount: draft.tip.account });
  const matching = inspection.tipTransfers.map((transfer, index) => ({
    index,
    recipient: solanaAddress(transfer.recipient),
    lamports: integer(transfer.lamports, `tipTransfers[${index}].lamports`),
    via: transfer.via ?? "unknown" as const,
  })).filter((transfer) => transfer.recipient === draft.tip.account);
  if (matching.length === 0) fail("ES4485", "JitoTipTransferMissing", "Serialized Jito bundle does not contain a transfer to the configured official tip account.", { transactionIndex: draft.tip.transactionIndex, tipAccount: draft.tip.account });
  const exact = matching.find((transfer) => transfer.lamports === draft.tip.lamports);
  if (!exact) fail("ES4486", "JitoTipAmountMismatch", "Serialized Jito tip transfer amount differs from the EraScript-bound tip amount.", { expectedLamports: draft.tip.lamports.toString(), observedLamports: matching.map((transfer) => transfer.lamports.toString()) });
  return {
    ...draft,
    state: "jito-bundle-verified",
    tipAccountsEvidence,
    tipInspection: {
      transactionIndex: draft.tip.transactionIndex,
      recipient: exact.recipient,
      lamports: exact.lamports,
      via: exact.via,
      tipAccountResolvedViaAddressLookupTable: false,
    },
  };
}

export async function submitJitoBundle(relay: JitoRelayLike, draft: JitoVerifiedBundleDraft): Promise<JitoBundleSubmitted> {
  const bundleId = resultValue(await relay.request<unknown>("sendBundle", [[...draft.transactionsBase64], { encoding: "base64" }]));
  if (typeof bundleId !== "string" || bundleId.length === 0) fail("ES4470", "MalformedJitoResponse", "Jito sendBundle did not return a bundle ID.");
  return { ...draft, state: "jito-bundle-submitted", bundleId, submittedAtMs: Date.now(), ...(relay.url ? { relay: relay.url } : {}) };
}

export async function readJitoInflightStatus(relay: JitoRelayLike, submitted: JitoBundleSubmitted): Promise<JitoInflightEvidence> {
  const raw = resultValue(await relay.request<unknown>("getInflightBundleStatuses", [[submitted.bundleId]]));
  const response = object(raw, "Jito inflight result");
  const first = Array.isArray(response.value) ? response.value[0] : undefined;
  if (!first) return { state: "jito-inflight-status", bundleId: submitted.bundleId, status: "Invalid" };
  const record = object(first, "Jito inflight bundle status");
  if (record.bundle_id !== submitted.bundleId && record.bundleId !== submitted.bundleId) fail("ES4476", "JitoBundleIdMismatch", "Jito inflight status belongs to another bundle.", { expected: submitted.bundleId, actual: String(record.bundle_id ?? record.bundleId) });
  const status = record.status;
  if (status !== "Pending" && status !== "Failed" && status !== "Landed" && status !== "Invalid") fail("ES4470", "MalformedJitoResponse", "Unknown Jito inflight bundle status.", { status: String(status) });
  return { state: "jito-inflight-status", bundleId: submitted.bundleId, status, ...(record.landed_slot !== undefined ? { landedSlot: integer(record.landed_slot, "landed_slot") } : {}) };
}

export async function readJitoBundleStatus(relay: JitoRelayLike, submitted: JitoBundleSubmitted): Promise<JitoBundleStatusEvidence> {
  const raw = resultValue(await relay.request<unknown>("getBundleStatuses", [[submitted.bundleId]]));
  const response = object(raw, "Jito bundle result");
  const first = Array.isArray(response.value) ? response.value[0] : undefined;
  if (!first) return { state: "jito-bundle-status", bundleId: submitted.bundleId, found: false, transactions: [] };
  const record = object(first, "Jito bundle status");
  const id = record.bundle_id ?? record.bundleId;
  if (id !== submitted.bundleId) fail("ES4476", "JitoBundleIdMismatch", "Jito bundle status belongs to another bundle.", { expected: submitted.bundleId, actual: String(id) });
  const confirmationStatus = record.confirmation_status ?? record.confirmationStatus;
  if (confirmationStatus !== undefined && confirmationStatus !== "processed" && confirmationStatus !== "confirmed" && confirmationStatus !== "finalized") fail("ES4470", "MalformedJitoResponse", "Unknown Jito bundle confirmation status.", { confirmationStatus: String(confirmationStatus) });
  const transactions = (Array.isArray(record.transactions) ? record.transactions : []).map((value, index) => {
    if (typeof value !== "string") fail("ES4470", "MalformedJitoResponse", "Jito bundle transaction signature must be a string.", { index });
    return solanaTransactionSignature(value);
  });
  if (submitted.expectedSignatures) {
    const expected = submitted.expectedSignatures.map(String);
    const actual = transactions.map(String);
    if (expected.length !== actual.length || expected.some((signature, index) => signature !== actual[index])) fail("ES4477", "JitoTransactionSetMismatch", "Jito landed bundle transaction signatures do not match the bundle submitted by EraScript.", { expected, actual });
  }
  return { state: "jito-bundle-status", bundleId: submitted.bundleId, found: true, ...(record.slot !== undefined ? { slot: integer(record.slot, "slot") } : {}), ...(confirmationStatus ? { confirmationStatus: confirmationStatus as SolanaCommitment } : {}), transactions, ...(record.err !== null && record.err !== undefined ? { err: record.err } : {}) };
}

export function assertJitoBundleFinalized(status: JitoBundleStatusEvidence): JitoBundleStatusEvidence & { readonly found: true; readonly confirmationStatus: "finalized" } {
  if (!status.found) fail("ES4478", "JitoBundleNotFinalized", "Jito bundle has not yet been observed on-chain.", { bundleId: status.bundleId });
  if (status.err !== undefined) fail("ES4479", "JitoBundleFailed", "Jito bundle status contains an execution error.", { bundleId: status.bundleId, err: status.err });
  if (status.confirmationStatus !== "finalized") fail("ES4478", "JitoBundleNotFinalized", "Jito bundle has not reached finalized Solana commitment.", { bundleId: status.bundleId, confirmationStatus: status.confirmationStatus ?? null });
  return status as JitoBundleStatusEvidence & { readonly found: true; readonly confirmationStatus: "finalized" };
}
