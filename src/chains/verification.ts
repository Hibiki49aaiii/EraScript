import { createHash } from "node:crypto";
import { EraDiagnosticError } from "../diagnostics.js";
import type { ExecutionBackendKind, ChainFamily, ChainProfile } from "./types.js";

export type MultichainVerificationState = "NOT_READY" | "READY_FOR_SUBMISSION" | "EXECUTION_OBSERVED" | "VERIFIED_FINALITY";
export type MultichainVerificationStatus = "pass" | "warning" | "fail";

export interface MultichainVerificationCheck {
  readonly id: string;
  readonly status: MultichainVerificationStatus;
  readonly message: string;
  readonly details?: Record<string, string | number | boolean | null>;
}

export interface MultichainEvidenceRef {
  readonly kind: string;
  readonly hash: string;
  readonly source?: string;
}

export interface MultichainVerificationReport {
  readonly kind: "multichain-verification-report";
  readonly family: ChainFamily;
  readonly profileId: string;
  readonly network: string;
  readonly backend: ExecutionBackendKind;
  readonly subject: string;
  readonly state: MultichainVerificationState;
  readonly checks: readonly MultichainVerificationCheck[];
  readonly evidence: readonly MultichainEvidenceRef[];
  readonly reportHash: string;
  readonly readyForSubmission: boolean;
  readonly executionObserved: boolean;
  readonly verifiedFinality: boolean;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}
function sha256(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex")}`;
}
function stateFlags(state: MultichainVerificationState) {
  return {
    readyForSubmission: state !== "NOT_READY",
    executionObserved: state === "EXECUTION_OBSERVED" || state === "VERIFIED_FINALITY",
    verifiedFinality: state === "VERIFIED_FINALITY",
  };
}

export function multichainEvidenceRef(kind: string, value: unknown, source?: string): MultichainEvidenceRef {
  if (!kind) fail("ES4550", "InvalidEvidenceReference", "Evidence reference kind cannot be empty.");
  return { kind, hash: sha256({ kind, value }), ...(source ? { source } : {}) };
}

export function multichainVerificationReportHash(input: Omit<MultichainVerificationReport, "kind" | "reportHash" | "readyForSubmission" | "executionObserved" | "verifiedFinality">): string {
  return sha256({
    family: input.family,
    profileId: input.profileId,
    network: input.network,
    backend: input.backend,
    subject: input.subject,
    state: input.state,
    checks: input.checks,
    evidence: input.evidence,
  });
}

export function createMultichainVerificationReport(input: {
  profile: ChainProfile;
  backend: ExecutionBackendKind;
  subject: string;
  state: MultichainVerificationState;
  checks: readonly MultichainVerificationCheck[];
  evidence?: readonly MultichainEvidenceRef[];
}): MultichainVerificationReport {
  if (!input.profile.executionBackends.includes(input.backend)) fail("ES4551", "VerificationBackendNotEnabled", "Verification report backend is not enabled by the selected chain profile.", { profile: input.profile.id, backend: input.backend });
  if (!input.subject) fail("ES4552", "MissingVerificationSubject", "Verification report requires a stable subject identifier.");
  const evidence = input.evidence ?? [];
  const failed = input.checks.some((check) => check.status === "fail");
  const state = failed ? "NOT_READY" : input.state;
  const reportCore = { family: input.profile.family, profileId: input.profile.id, network: input.profile.network, backend: input.backend, subject: input.subject, state, checks: input.checks, evidence } as const;
  return { kind: "multichain-verification-report", ...reportCore, reportHash: multichainVerificationReportHash(reportCore), ...stateFlags(state) };
}

export function parseMultichainVerificationReport(value: unknown): MultichainVerificationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ES4553", "InvalidMultichainVerificationReport", "Multichain verification report must be a JSON object.");
  const record = value as Record<string, unknown>;
  if (record.kind !== "multichain-verification-report") fail("ES4553", "InvalidMultichainVerificationReport", "Unsupported multichain verification report kind.");
  if (record.family !== "evm" && record.family !== "solana" && record.family !== "sui") fail("ES4553", "InvalidMultichainVerificationReport", "Verification report has an invalid chain family.");
  if (typeof record.profileId !== "string" || typeof record.network !== "string" || typeof record.backend !== "string" || typeof record.subject !== "string") fail("ES4553", "InvalidMultichainVerificationReport", "Verification report identity fields must be strings.");
  if (record.state !== "NOT_READY" && record.state !== "READY_FOR_SUBMISSION" && record.state !== "EXECUTION_OBSERVED" && record.state !== "VERIFIED_FINALITY") fail("ES4553", "InvalidMultichainVerificationReport", "Verification report has an invalid state.");
  if (!Array.isArray(record.checks) || !Array.isArray(record.evidence) || typeof record.reportHash !== "string") fail("ES4553", "InvalidMultichainVerificationReport", "Verification report checks/evidence/reportHash are malformed.");

  const checks: MultichainVerificationCheck[] = record.checks.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("ES4553", "InvalidMultichainVerificationReport", "Verification check must be an object.", { index });
    const check = item as Record<string, unknown>;
    if (typeof check.id !== "string" || typeof check.message !== "string" || (check.status !== "pass" && check.status !== "warning" && check.status !== "fail")) fail("ES4553", "InvalidMultichainVerificationReport", "Verification check fields are malformed.", { index });
    return { id: check.id, status: check.status, message: check.message, ...(check.details && typeof check.details === "object" && !Array.isArray(check.details) ? { details: check.details as Record<string, string | number | boolean | null> } : {}) };
  });
  const evidence: MultichainEvidenceRef[] = record.evidence.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("ES4553", "InvalidMultichainVerificationReport", "Evidence reference must be an object.", { index });
    const evidenceRecord = item as Record<string, unknown>;
    if (typeof evidenceRecord.kind !== "string" || typeof evidenceRecord.hash !== "string") fail("ES4553", "InvalidMultichainVerificationReport", "Evidence reference fields are malformed.", { index });
    return { kind: evidenceRecord.kind, hash: evidenceRecord.hash, ...(typeof evidenceRecord.source === "string" ? { source: evidenceRecord.source } : {}) };
  });
  const core = {
    family: record.family,
    profileId: record.profileId,
    network: record.network,
    backend: record.backend as ExecutionBackendKind,
    subject: record.subject,
    state: record.state,
    checks,
    evidence,
  } as const;
  const computed = multichainVerificationReportHash(core);
  if (computed.toLowerCase() !== record.reportHash.toLowerCase()) fail("ES4554", "MultichainVerificationHashMismatch", "Multichain verification report content does not match reportHash.", { supplied: record.reportHash, computed });
  return { kind: "multichain-verification-report", ...core, reportHash: computed, ...stateFlags(core.state) };
}

export function assertMultichainVerificationState(report: MultichainVerificationReport, required: MultichainVerificationState): MultichainVerificationReport {
  const rank: Record<MultichainVerificationState, number> = { NOT_READY: 0, READY_FOR_SUBMISSION: 1, EXECUTION_OBSERVED: 2, VERIFIED_FINALITY: 3 };
  if (rank[report.state] < rank[required]) fail("ES4555", "MultichainVerificationRequirementNotMet", "Verification report does not satisfy the required state.", { actual: report.state, required, reportHash: report.reportHash });
  return report;
}
