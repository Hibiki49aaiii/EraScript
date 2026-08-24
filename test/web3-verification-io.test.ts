import assert from "node:assert/strict";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  Ethereum,
  assertVerificationRequirement,
  parseVerificationReport,
  parseVerificationReportJson,
  verificationReportHash,
  type RescueVerificationReport,
  type VerificationCheck,
} from "../src/web3/index.js";

const checks: VerificationCheck[] = [
  { id: "graph.complete", status: "pass", message: "Graph is complete.", details: { nodes: 4 } },
  { id: "atomic.bundle-fresh", status: "pass", message: "Bundle simulation is fresh." },
];

function report(state: RescueVerificationReport["state"]): RescueVerificationReport<typeof Ethereum> {
  return {
    kind: "rescue-verification-report",
    chain: Ethereum,
    state,
    reportHash: verificationReportHash(Ethereum, state, checks),
    checks,
    readyForBroadcast: state !== "NOT_READY",
    recoveryObserved: state === "RECOVERY_OBSERVED" || state === "VERIFIED_RECOVERY",
    verifiedRecovery: state === "VERIFIED_RECOVERY",
  };
}

test("verification report parser recomputes and validates report hash", () => {
  const original = report("READY_FOR_BROADCAST");
  const parsed = parseVerificationReportJson(JSON.stringify(original));
  assert.equal(parsed.state, "READY_FOR_BROADCAST");
  assert.equal(parsed.reportHash, original.reportHash);
  assert.equal(parsed.readyForBroadcast, true);
});

test("verification report parser rejects tampered check content", () => {
  const original = report("READY_FOR_BROADCAST");
  const tampered = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  const tamperedChecks = tampered.checks as Array<Record<string, unknown>>;
  tamperedChecks[0]!.message = "Graph is NOT complete.";
  assert.throws(
    () => parseVerificationReport(tampered),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4051",
  );
});

test("verification requirement uses monotonic safety states", () => {
  assert.equal(assertVerificationRequirement(report("VERIFIED_RECOVERY"), "READY_FOR_BROADCAST").verifiedRecovery, true);
  assert.equal(assertVerificationRequirement(report("VERIFIED_RECOVERY"), "RECOVERY_OBSERVED").verifiedRecovery, true);
  assert.throws(
    () => assertVerificationRequirement(report("RECOVERY_OBSERVED"), "VERIFIED_RECOVERY"),
    (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === "ES4053",
  );
});
