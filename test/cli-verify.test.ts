import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  Ethereum,
  verificationReportHash,
  type RescueVerificationState,
  type VerificationCheck,
} from "../src/web3/index.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const checks: VerificationCheck[] = [
  { id: "graph.complete", status: "pass", message: "Graph complete." },
];

function writeReport(directory: string, state: RescueVerificationState): string {
  const report = {
    kind: "rescue-verification-report",
    chain: Ethereum,
    state,
    reportHash: verificationReportHash(Ethereum, state, checks),
    checks,
    readyForBroadcast: state !== "NOT_READY",
    recoveryObserved: state === "RECOVERY_OBSERVED" || state === "VERIFIED_RECOVERY",
    verifiedRecovery: state === "VERIFIED_RECOVERY",
  };
  const file = join(directory, `${state}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

function runVerify(file: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, "verify", file, "--json", ...args], {
    encoding: "utf8",
  });
}

test("era verify passes READY_FOR_BROADCAST and fails NOT_READY by default", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-verify-"));
  try {
    const ready = runVerify(writeReport(directory, "READY_FOR_BROADCAST"));
    assert.equal(ready.status, 0, ready.stderr || ready.stdout);
    const readyJson = JSON.parse(ready.stdout) as { state: string; ok: boolean };
    assert.equal(readyJson.ok, true);
    assert.equal(readyJson.state, "READY_FOR_BROADCAST");

    const notReadyFile = writeReport(directory, "NOT_READY");
    const blocked = runVerify(notReadyFile);
    assert.equal(blocked.status, 1);

    const integrityOnly = runVerify(notReadyFile, "--integrity-only");
    assert.equal(integrityOnly.status, 0, integrityOnly.stderr || integrityOnly.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era verify rejects a tampered report even with integrity-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-verify-"));
  try {
    const file = writeReport(directory, "VERIFIED_RECOVERY");
    const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    (value.checks as Array<Record<string, unknown>>)[0]!.message = "tampered";
    writeFileSync(file, JSON.stringify(value, null, 2));
    const result = runVerify(file, "--integrity-only");
    assert.equal(result.status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
