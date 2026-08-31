import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { EraDiagnosticError } from "../src/diagnostics.js";
import {
  createVerificationReportAttestation,
  parseVerificationReportAttestation,
  verificationAttestationKeyId,
  verifyVerificationReportAttestation,
  type VerificationReportKind,
} from "../src/verification-attestation.js";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const ISSUED_AT = "2026-08-31T11:59:00.000Z";
const EXPIRES_AT = "2026-08-31T12:10:00.000Z";
const NONCE = "ab".repeat(32);
const REPORT_HASH = `0x${"12".repeat(32)}`;

function report(kind: VerificationReportKind = "multichain-verification-report") {
  return { kind, reportHash: REPORT_HASH } as const;
}

function diagnostic(code: string) {
  return (error: unknown) => error instanceof EraDiagnosticError && error.diagnostic.code === code;
}

test("Ed25519 attestation authenticates both verification report kinds", () => {
  for (const kind of ["rescue-verification-report", "multichain-verification-report"] as const) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const attestation = createVerificationReportAttestation({
      privateKey,
      issuer: "era-ci-verifier",
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
      report: report(kind),
    });

    assert.equal(attestation.keyId, verificationAttestationKeyId(publicKey));
    assert.deepEqual(parseVerificationReportAttestation(JSON.parse(JSON.stringify(attestation))), attestation);
    assert.deepEqual(
      verifyVerificationReportAttestation({ attestation, report: report(kind), trustedPublicKey: publicKey, nowMs: NOW }),
      {
        authenticated: true,
        keyId: attestation.keyId,
        issuer: "era-ci-verifier",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        nonce: NONCE,
        algorithm: "ed25519",
        version: 1,
      },
    );
  }
});

test("attestation rejects wrong keys and report substitution", () => {
  const signer = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const attestation = createVerificationReportAttestation({
    privateKey: signer.privateKey,
    issuer: "era-ci-verifier",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    nonce: NONCE,
    report: report(),
  });

  assert.throws(
    () => verifyVerificationReportAttestation({ attestation, report: report(), trustedPublicKey: other.publicKey, nowMs: NOW }),
    diagnostic("ES4814"),
  );
  assert.throws(
    () => verifyVerificationReportAttestation({
      attestation,
      report: { ...report(), reportHash: `0x${"34".repeat(32)}` },
      trustedPublicKey: signer.publicKey,
      nowMs: NOW,
    }),
    diagnostic("ES4815"),
  );
  assert.throws(
    () => verifyVerificationReportAttestation({
      attestation,
      report: report("rescue-verification-report"),
      trustedPublicKey: signer.publicKey,
      nowMs: NOW,
    }),
    diagnostic("ES4815"),
  );
});

test("attestation signature binds issuer, validity window, nonce and report identity", () => {
  const signer = generateKeyPairSync("ed25519");
  const attestation = createVerificationReportAttestation({
    privateKey: signer.privateKey,
    issuer: "era-ci-verifier",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    nonce: NONCE,
    report: report(),
  });

  for (const changed of [
    { ...attestation, issuer: "other-verifier" },
    { ...attestation, expiresAt: "2026-08-31T12:11:00.000Z" },
    { ...attestation, nonce: "cd".repeat(32) },
  ]) {
    assert.throws(
      () => verifyVerificationReportAttestation({ attestation: changed, report: report(), trustedPublicKey: signer.publicKey, nowMs: NOW }),
      diagnostic("ES4818"),
    );
  }
});

test("attestation rejects expired, future and invalid validity windows", () => {
  const signer = generateKeyPairSync("ed25519");
  const expired = createVerificationReportAttestation({
    privateKey: signer.privateKey,
    issuer: "era-ci-verifier",
    issuedAt: "2026-08-31T11:00:00.000Z",
    expiresAt: "2026-08-31T11:30:00.000Z",
    nonce: NONCE,
    report: report(),
  });
  assert.throws(
    () => verifyVerificationReportAttestation({ attestation: expired, report: report(), trustedPublicKey: signer.publicKey, nowMs: NOW }),
    diagnostic("ES4817"),
  );

  const future = createVerificationReportAttestation({
    privateKey: signer.privateKey,
    issuer: "era-ci-verifier",
    issuedAt: "2026-08-31T12:06:00.000Z",
    expiresAt: "2026-08-31T12:20:00.000Z",
    nonce: NONCE,
    report: report(),
  });
  assert.throws(
    () => verifyVerificationReportAttestation({ attestation: future, report: report(), trustedPublicKey: signer.publicKey, nowMs: NOW }),
    diagnostic("ES4816"),
  );

  assert.throws(
    () => createVerificationReportAttestation({
      privateKey: signer.privateKey,
      issuer: "era-ci-verifier",
      issuedAt: EXPIRES_AT,
      expiresAt: ISSUED_AT,
      nonce: NONCE,
      report: report(),
    }),
    diagnostic("ES4819"),
  );
});

test("attestation parser rejects malformed, non-canonical and unsigned fields", () => {
  const signer = generateKeyPairSync("ed25519");
  const attestation = createVerificationReportAttestation({
    privateKey: signer.privateKey,
    issuer: "era-ci-verifier",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    nonce: NONCE,
    report: report(),
  });

  assert.throws(() => parseVerificationReportAttestation({ ...attestation, nonce: "AB".repeat(32) }), diagnostic("ES4810"));
  assert.throws(() => parseVerificationReportAttestation({ ...attestation, issuer: null }), diagnostic("ES4810"));
  assert.throws(() => parseVerificationReportAttestation({ ...attestation, keyId: null }), diagnostic("ES4810"));
  assert.throws(() => parseVerificationReportAttestation({ ...attestation, signature: attestation.signature.replace(/==$/, "") }), diagnostic("ES4810"));
  assert.throws(() => parseVerificationReportAttestation({ ...attestation, unsignedNote: "ignored?" }), diagnostic("ES4810"));
  assert.throws(
    () => verifyVerificationReportAttestation({ attestation, report: report(), trustedPublicKey: signer.privateKey, nowMs: NOW }),
    diagnostic("ES4813"),
  );
});
