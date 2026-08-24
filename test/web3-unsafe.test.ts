import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  analyzeWeb3Source,
  assertUnsafeBoundaryPolicy,
  parseVerificationReport,
  verificationReportHash,
  type UnsafeBoundaryAudit,
  type VerificationCheck,
} from "../src/web3/index.js";

test("unsafeBoundary requires a static auditable reason", () => {
  const valid = analyzeWeb3Source(`
    unsafeBoundary("non-standard claim contract calldata encoding", () => legacyEncode())
  `, "claim.ts");
  assert.equal(valid.unsafeBoundaries.length, 1);
  assert.equal(valid.unsafeBoundaries[0]?.reason, "non-standard claim contract calldata encoding");
  assert.ok(valid.diagnostics.some((diagnostic) => diagnostic.code === "ES4080" && diagnostic.severity === "warning"));

  const dynamic = analyzeWeb3Source(`
    const reason = getReason()
    unsafeBoundary(reason, () => legacyEncode())
  `, "claim.ts");
  assert.ok(dynamic.diagnostics.some((diagnostic) => diagnostic.code === "ES4081" && diagnostic.severity === "error"));
  assert.equal(dynamic.unsafeBoundaries.length, 0);

  const vague = analyzeWeb3Source(`unsafeBoundary("legacy", () => legacyEncode())`, "claim.ts");
  assert.ok(vague.diagnostics.some((diagnostic) => diagnostic.code === "ES4082"));
});

test("unsafe boundary policy default-denies recorded bypasses", () => {
  const boundary: UnsafeBoundaryAudit = {
    kind: "unsafe-boundary",
    id: "claim.ts:10:3",
    reason: "non-standard claim contract calldata encoding",
    file: "claim.ts",
    line: 10,
    column: 3,
  };
  assert.throws(
    () => assertUnsafeBoundaryPolicy([boundary], { allow: false }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4085",
  );
  assert.doesNotThrow(() => assertUnsafeBoundaryPolicy([boundary], {
    allow: true,
    maxBoundaries: 1,
    allowedReasons: [boundary.reason],
  }));
});

test("verification report hash binds unsafe boundary reason and location", () => {
  const checks: VerificationCheck[] = [{ id: "unsafe.boundaries", status: "warning", message: "explicitly allowed" }];
  const unsafeBoundaries: UnsafeBoundaryAudit[] = [{
    kind: "unsafe-boundary",
    id: "claim.ts:10:3",
    reason: "non-standard claim contract calldata encoding",
    file: "claim.ts",
    line: 10,
    column: 3,
  }];
  const reportHash = verificationReportHash(Ethereum, "READY_FOR_BROADCAST", checks, unsafeBoundaries);
  const report = parseVerificationReport({
    kind: "rescue-verification-report",
    chain: Ethereum,
    state: "READY_FOR_BROADCAST",
    reportHash,
    checks,
    unsafeBoundaries,
  });
  assert.equal(report.unsafeBoundaries?.length, 1);

  assert.throws(
    () => parseVerificationReport({
      ...report,
      unsafeBoundaries: [{ ...unsafeBoundaries[0]!, reason: "different bypass reason after approval" }],
    }),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4051",
  );
});
