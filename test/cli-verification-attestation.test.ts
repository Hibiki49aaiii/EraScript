import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SolanaMainnetProfile } from "../src/chains/index.js";
import { createMultichainVerificationReport } from "../src/chains/verification.js";
import { createVerificationReportAttestation } from "../src/verification-attestation.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function runVerify(file: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, "verify", file, ...args], { encoding: "utf8" });
}

function fixture(directory: string) {
  const now = Date.now();
  const report = createMultichainVerificationReport({
    profile: SolanaMainnetProfile,
    backend: "public-rpc",
    subject: "solana:test-signature",
    state: "VERIFIED_FINALITY",
    checks: [{ id: "test", status: "pass", message: "Finality evidence passed." }],
  });
  const signer = generateKeyPairSync("ed25519");
  const attestation = createVerificationReportAttestation({
    privateKey: signer.privateKey,
    issuer: "era-cli-test",
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    nonce: "ef".repeat(32),
    report,
  });
  const reportFile = join(directory, "report.json");
  const attestationFile = join(directory, "report.attestation.json");
  const publicKeyFile = join(directory, "verifier-public.pem");
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  writeFileSync(attestationFile, JSON.stringify(attestation, null, 2));
  writeFileSync(publicKeyFile, signer.publicKey.export({ type: "spki", format: "pem" }));
  return { report, signer, reportFile, attestationFile, publicKeyFile };
}

test("era verify labels unsigned reports as integrity-only and unauthenticated", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-attestation-cli-"));
  try {
    const files = fixture(directory);
    const result = runVerify(files.reportFile, "--require", "VERIFIED_FINALITY");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /^INTEGRITY OK \(UNAUTHENTICATED\)/);
    assert.doesNotMatch(result.stdout, /^VERIFIED\b/);
    assert.match(result.stdout, /Authentication: not provided/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era verify emits explicit authenticated JSON for trusted attestation", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-attestation-cli-"));
  try {
    const files = fixture(directory);
    const result = runVerify(
      files.reportFile,
      "--require", "VERIFIED_FINALITY",
      "--attestation", files.attestationFile,
      "--trusted-key", files.publicKeyFile,
      "--json",
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const json = JSON.parse(result.stdout) as {
      integrity: boolean;
      stateRequirementMet: boolean;
      authenticated: boolean;
      attestation: { issuer: string; keyId: string; expiresAt: string };
    };
    assert.equal(json.integrity, true);
    assert.equal(json.stateRequirementMet, true);
    assert.equal(json.authenticated, true);
    assert.equal(json.attestation.issuer, "era-cli-test");
    assert.match(json.attestation.keyId, /^sha256:[0-9a-f]{64}$/);
    assert.match(json.attestation.expiresAt, /Z$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era verify requires paired attestation options and rejects a different key", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-attestation-cli-"));
  try {
    const files = fixture(directory);
    const missingKey = runVerify(files.reportFile, "--attestation", files.attestationFile);
    assert.equal(missingKey.status, 2);
    assert.match(missingKey.stderr, /must be supplied together/);

    const other = generateKeyPairSync("ed25519");
    const otherKeyFile = join(directory, "other-public.pem");
    writeFileSync(otherKeyFile, other.publicKey.export({ type: "spki", format: "pem" }));
    const wrongKey = runVerify(
      files.reportFile,
      "--attestation", files.attestationFile,
      "--trusted-key", otherKeyFile,
      "--json",
    );
    assert.equal(wrongKey.status, 1);
    const json = JSON.parse(wrongKey.stdout) as { diagnostics: Array<{ code: string }> };
    assert.equal(json.diagnostics[0]?.code, "ES4814");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
