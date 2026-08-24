import { EraDiagnosticError } from "../diagnostics.js";

export interface UnsafeBoundaryAudit {
  readonly kind: "unsafe-boundary";
  readonly id: string;
  readonly reason: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface UnsafeBoundaryPolicy {
  readonly allow: boolean;
  readonly allowedReasons?: readonly string[];
  readonly maxBoundaries?: number;
}

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

export function validateUnsafeReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length < 12) {
    fail("ES3902", "UnsafeBoundaryReasonTooShort", "Unsafe boundary reasons must describe the concrete compatibility or protocol requirement being bypassed.", { minimumLength: 12, actualLength: normalized.length });
  }
  if (normalized.length > 240) {
    fail("ES3904", "UnsafeBoundaryReasonTooLong", "Unsafe boundary reasons must remain concise enough to audit.", { maximumLength: 240, actualLength: normalized.length });
  }
  return normalized;
}

/**
 * Explicit escape hatch for code that cannot currently be represented by EraScript's
 * verified Web3 APIs. The source analyzer records each call site. This helper does not
 * weaken runtime policy by itself; verification must separately allow the recorded audit.
 */
export function unsafeBoundary<T>(reason: string, operation: () => T): T {
  validateUnsafeReason(reason);
  if (typeof operation !== "function") fail("ES3903", "InvalidUnsafeBoundaryOperation", "unsafeBoundary requires a callback operation.");
  return operation();
}

export function assertUnsafeBoundaryPolicy(boundaries: readonly UnsafeBoundaryAudit[], policy: UnsafeBoundaryPolicy): void {
  if (boundaries.length === 0) return;
  if (!policy.allow) fail("ES3905", "UnsafeBoundariesNotAuthorized", "Unsafe boundaries are present but verification policy does not authorize them.", { count: boundaries.length });
  if (policy.maxBoundaries !== undefined && boundaries.length > policy.maxBoundaries) fail("ES3906", "UnsafeBoundaryLimitExceeded", "Unsafe boundary count exceeds verification policy.", { count: boundaries.length, maxBoundaries: policy.maxBoundaries });
  if (policy.allowedReasons) {
    const denied = boundaries.filter((boundary) => !policy.allowedReasons!.includes(boundary.reason));
    if (denied.length > 0) fail("ES3907", "UnsafeBoundaryReasonNotAuthorized", "One or more unsafe boundary reasons are outside the verification allowlist.", { denied: denied.map((boundary) => boundary.reason) });
  }
}
