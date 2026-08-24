import { EraDiagnosticError } from "../diagnostics.js";
import type { EvmChain } from "./types.js";
import {
  verificationReportHash,
  type RescueVerificationReport,
  type RescueVerificationState,
  type VerificationCheck,
  type VerificationCheckStatus,
} from "./verification.js";

const STATES = new Set<RescueVerificationState>([
  "NOT_READY",
  "READY_FOR_BROADCAST",
  "RECOVERY_OBSERVED",
  "VERIFIED_RECOVERY",
]);
const CHECK_STATUSES = new Set<VerificationCheckStatus>(["pass", "fail", "warning"]);

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("ES4050", "InvalidVerificationReport", `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function parseDetails(value: unknown): VerificationCheck["details"] {
  if (value === undefined || value === null) return undefined;
  const record = object(value, "Verification check details");
  const parsed: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(record)) {
    if (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      parsed[key] = item;
      continue;
    }
    fail("ES4050", "InvalidVerificationReport", "Verification check details may contain only JSON scalar values.", { key });
  }
  return parsed;
}

function parseCheck(value: unknown, index: number): VerificationCheck {
  const record = object(value, `checks[${index}]`);
  if (typeof record.id !== "string" || record.id.length === 0) fail("ES4050", "InvalidVerificationReport", "Verification check id must be a non-empty string.", { index });
  if (typeof record.status !== "string" || !CHECK_STATUSES.has(record.status as VerificationCheckStatus)) fail("ES4050", "InvalidVerificationReport", "Verification check status is invalid.", { index, status: String(record.status) });
  if (typeof record.message !== "string") fail("ES4050", "InvalidVerificationReport", "Verification check message must be a string.", { index });
  const details = parseDetails(record.details);
  return {
    id: record.id,
    status: record.status as VerificationCheckStatus,
    message: record.message,
    ...(details ? { details } : {}),
  };
}

export function parseVerificationReport(value: unknown): RescueVerificationReport {
  const record = object(value, "Verification report");
  if (record.kind !== "rescue-verification-report") fail("ES4050", "InvalidVerificationReport", "Unsupported verification report kind.", { kind: String(record.kind) });

  const chainRecord = object(record.chain, "Verification report chain");
  if (typeof chainRecord.name !== "string" || chainRecord.name.length === 0) fail("ES4050", "InvalidVerificationReport", "Verification report chain.name must be a non-empty string.");
  if (typeof chainRecord.id !== "number" || !Number.isSafeInteger(chainRecord.id) || chainRecord.id < 0) fail("ES4050", "InvalidVerificationReport", "Verification report chain.id must be a non-negative safe integer.");
  const chain: EvmChain = { name: chainRecord.name, id: chainRecord.id };

  if (typeof record.state !== "string" || !STATES.has(record.state as RescueVerificationState)) fail("ES4050", "InvalidVerificationReport", "Verification report state is invalid.", { state: String(record.state) });
  if (!Array.isArray(record.checks)) fail("ES4050", "InvalidVerificationReport", "Verification report checks must be an array.");
  const checks = record.checks.map(parseCheck);
  if (typeof record.reportHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(record.reportHash)) fail("ES4050", "InvalidVerificationReport", "Verification reportHash must be a 32-byte hexadecimal hash.");

  const state = record.state as RescueVerificationState;
  const computed = verificationReportHash(chain, state, checks);
  if (computed.toLowerCase() !== record.reportHash.toLowerCase()) {
    fail("ES4051", "VerificationReportHashMismatch", "Verification report content does not match reportHash.", {
      supplied: record.reportHash,
      computed,
    });
  }

  return {
    kind: "rescue-verification-report",
    chain,
    state,
    reportHash: computed,
    checks,
    readyForBroadcast: state === "READY_FOR_BROADCAST" || state === "RECOVERY_OBSERVED" || state === "VERIFIED_RECOVERY",
    recoveryObserved: state === "RECOVERY_OBSERVED" || state === "VERIFIED_RECOVERY",
    verifiedRecovery: state === "VERIFIED_RECOVERY",
  };
}

export function parseVerificationReportJson(json: string): RescueVerificationReport {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    return fail("ES4050", "InvalidVerificationReport", "Verification report is not valid JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return parseVerificationReport(value);
}

function requirementSatisfied(state: RescueVerificationState, required: RescueVerificationState): boolean {
  if (required === "NOT_READY") return state === "NOT_READY";
  if (required === "READY_FOR_BROADCAST") return state === "READY_FOR_BROADCAST" || state === "RECOVERY_OBSERVED" || state === "VERIFIED_RECOVERY";
  if (required === "RECOVERY_OBSERVED") return state === "RECOVERY_OBSERVED" || state === "VERIFIED_RECOVERY";
  return state === "VERIFIED_RECOVERY";
}

export function assertVerificationRequirement(report: RescueVerificationReport, required: RescueVerificationState): RescueVerificationReport {
  if (!STATES.has(required)) fail("ES4052", "InvalidVerificationRequirement", "Unknown verification state requirement.", { required });
  if (!requirementSatisfied(report.state, required)) {
    fail("ES4053", "VerificationRequirementNotMet", "Verification report does not satisfy the required state.", {
      required,
      actual: report.state,
      reportHash: report.reportHash,
    });
  }
  return report;
}
