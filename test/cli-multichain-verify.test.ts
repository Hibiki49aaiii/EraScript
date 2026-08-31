import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { SolanaMainnetProfile, type MultichainVerificationState } from "../src/chains/index.js";
import { createMultichainVerificationReport } from "../src/chains/verification.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function writeReport(directory: string, state: MultichainVerificationState): string {
  const report = createMultichainVerificationReport({
    profile: SolanaMainnetProfile,
    backend: "public-rpc",
    subject: "solana:test-signature",
    state,
    checks: state === "NOT_READY"
      ? [{ id: "test", status: "fail", message: "blocked" }]
      : [{ id: "test", status: "pass", message: "verified" }],
  });
  const file = join(directory, `${state}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

function runVerify(file: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, "verify", file, "--json", ...args], { encoding: "utf8" });
}

test("era verify auto-detects multichain reports and uses READY_FOR_SUBMISSION by default", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-multichain-verify-"));
  try {
    const ready = runVerify(writeReport(directory, "READY_FOR_SUBMISSION"));
    assert.equal(ready.status, 0, ready.stderr || ready.stdout);
    const json = JSON.parse(ready.stdout) as { kind: string; state: string; family: string; required: string };
    assert.equal(json.kind, "multichain");
    assert.equal(json.family, "solana");
    assert.equal(json.required, "READY_FOR_SUBMISSION");

    const blocked = runVerify(writeReport(directory, "NOT_READY"));
    assert.equal(blocked.status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("multichain CLI gate can require VERIFIED_FINALITY", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-multichain-verify-"));
  try {
    const observed = runVerify(writeReport(directory, "EXECUTION_OBSERVED"), "--require", "VERIFIED_FINALITY");
    assert.equal(observed.status, 1);
    const finalized = runVerify(writeReport(directory, "VERIFIED_FINALITY"), "--require", "VERIFIED_FINALITY");
    assert.equal(finalized.status, 0, finalized.stderr || finalized.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
