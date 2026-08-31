import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { EraDiagnosticError } from "./diagnostics.js";

export type VerificationReportKind = "rescue-verification-report" | "multichain-verification-report";
export type VerificationAttestationKey = string | Buffer | KeyObject;

export interface VerificationReportReference {
  readonly kind: VerificationReportKind;
  readonly reportHash: string;
}

export interface VerificationReportAttestationPayload {
  readonly kind: "verification-report-attestation";
  readonly version: 1;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly reportKind: VerificationReportKind;
  readonly reportHash: string;
}

export interface VerificationReportAttestation extends VerificationReportAttestationPayload {
  readonly signature: string;
}

export interface VerificationReportAuthentication {
  readonly authenticated: true;
  readonly keyId: string;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly algorithm: "ed25519";
  readonly version: 1;
}

const DOMAIN = "EraScript Verification Report Attestation v1\n";
const HASH = /^0x[0-9a-f]{64}$/;
const KEY_ID = /^sha256:[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PRIVATE_PEM = /-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

function fail(code: string, kind: string, message: string, details?: Record<string, unknown>): never {
  throw new EraDiagnosticError({ code, severity: "error", kind, message, ...(details ? { details } : {}) });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, field: "issuedAt" | "expiresAt"): { readonly value: string; readonly timeMs: number } {
  if (typeof value !== "string" || !ISO_UTC.test(value)) {
    fail("ES4810", "InvalidVerificationAttestation", `Verification attestation ${field} must be a UTC ISO-8601 timestamp with millisecond precision.`);
  }
  const timeMs = Date.parse(value);
  if (!Number.isFinite(timeMs) || new Date(timeMs).toISOString() !== value) {
    fail("ES4810", "InvalidVerificationAttestation", `Verification attestation ${field} is not a valid timestamp.`);
  }
  return { value, timeMs };
}

function publicKeyFrom(input: VerificationAttestationKey): KeyObject {
  if (input instanceof KeyObject && input.type !== "public") {
    fail("ES4813", "InvalidVerificationAttestationKey", "Verification requires a public key; private or secret KeyObjects are not accepted.");
  }
  if (!(input instanceof KeyObject)) {
    const text = typeof input === "string" ? input : input.toString("utf8");
    if (PRIVATE_PEM.test(text)) {
      fail("ES4813", "InvalidVerificationAttestationKey", "Verification requires a public key; private-key PEM input is not accepted.");
    }
  }
  let key: KeyObject;
  try {
    key = input instanceof KeyObject ? input : createPublicKey(input);
  } catch (error) {
    fail("ES4813", "InvalidVerificationAttestationKey", "Trusted verification key could not be parsed as a public key.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    fail("ES4813", "InvalidVerificationAttestationKey", "Trusted verification key must be an Ed25519 public key.", {
      keyType: key.type,
      asymmetricKeyType: key.asymmetricKeyType ?? "unknown",
    });
  }
  return key;
}

function privateKeyFrom(input: VerificationAttestationKey): KeyObject {
  let key: KeyObject;
  try {
    key = input instanceof KeyObject ? input : createPrivateKey(input);
  } catch (error) {
    fail("ES4813", "InvalidVerificationAttestationKey", "Attestation signing key could not be parsed as a private key.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
    fail("ES4813", "InvalidVerificationAttestationKey", "Attestation signing key must be an Ed25519 private key.", {
      keyType: key.type,
      asymmetricKeyType: key.asymmetricKeyType ?? "unknown",
    });
  }
  return key;
}

function keyIdFromPublicKey(key: KeyObject): string {
  const der = key.export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

function validatePayload(value: VerificationReportAttestationPayload): {
  readonly payload: VerificationReportAttestationPayload;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
} {
  if (value.kind !== "verification-report-attestation") {
    fail("ES4810", "InvalidVerificationAttestation", "Unsupported verification attestation kind.");
  }
  if (value.version !== 1) {
    fail("ES4811", "UnsupportedVerificationAttestationVersion", "Unsupported verification attestation version.", { version: value.version });
  }
  if (value.algorithm !== "ed25519") {
    fail("ES4812", "UnsupportedVerificationAttestationAlgorithm", "Unsupported verification attestation signature algorithm.", { algorithm: value.algorithm });
  }
  if (typeof value.keyId !== "string" || !KEY_ID.test(value.keyId)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation keyId must be a lowercase SHA-256 public-key fingerprint.");
  }
  if (typeof value.issuer !== "string" || value.issuer.length === 0 || value.issuer.length > 200 || value.issuer !== value.issuer.trim() || /[\u0000-\u001f\u007f]/.test(value.issuer)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation issuer must be a trimmed, non-empty string without control characters (maximum 200 characters).");
  }
  const issuedAt = timestamp(value.issuedAt, "issuedAt");
  const expiresAt = timestamp(value.expiresAt, "expiresAt");
  if (expiresAt.timeMs <= issuedAt.timeMs) {
    fail("ES4819", "InvalidVerificationAttestationWindow", "Verification attestation expiresAt must be later than issuedAt.", {
      issuedAt: issuedAt.value,
      expiresAt: expiresAt.value,
    });
  }
  if (typeof value.nonce !== "string" || !NONCE.test(value.nonce)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation nonce must be 32 bytes encoded as lowercase hexadecimal.");
  }
  if (value.reportKind !== "rescue-verification-report" && value.reportKind !== "multichain-verification-report") {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation reportKind is unsupported.");
  }
  if (typeof value.reportHash !== "string" || !HASH.test(value.reportHash)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation reportHash must be a lowercase 32-byte hexadecimal hash.");
  }
  return { payload: value, issuedAtMs: issuedAt.timeMs, expiresAtMs: expiresAt.timeMs };
}

function reportReference(value: VerificationReportReference): VerificationReportReference {
  if (!value || (value.kind !== "rescue-verification-report" && value.kind !== "multichain-verification-report")) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification report reference kind is unsupported.");
  }
  if (typeof value.reportHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.reportHash)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification report reference hash must be a 32-byte hexadecimal hash.");
  }
  return { kind: value.kind, reportHash: value.reportHash.toLowerCase() };
}

function signatureBytes(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value)) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation signature must be a canonical base64 Ed25519 signature.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation signature must encode exactly 64 bytes in canonical base64.");
  }
  return bytes;
}

function payloadFromRecord(record: Record<string, unknown>): VerificationReportAttestationPayload {
  return {
    kind: record.kind as VerificationReportAttestationPayload["kind"],
    version: record.version as VerificationReportAttestationPayload["version"],
    algorithm: record.algorithm as VerificationReportAttestationPayload["algorithm"],
    keyId: record.keyId as string,
    issuer: record.issuer as string,
    issuedAt: record.issuedAt as string,
    expiresAt: record.expiresAt as string,
    nonce: record.nonce as string,
    reportKind: record.reportKind as VerificationReportKind,
    reportHash: record.reportHash as string,
  };
}

export function verificationAttestationKeyId(publicKey: VerificationAttestationKey): string {
  return keyIdFromPublicKey(publicKeyFrom(publicKey));
}

export function verificationAttestationPayload(value: VerificationReportAttestationPayload): Buffer {
  const { payload } = validatePayload(value);
  const canonical = {
    kind: payload.kind,
    version: payload.version,
    algorithm: payload.algorithm,
    keyId: payload.keyId,
    issuer: payload.issuer,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
    reportKind: payload.reportKind,
    reportHash: payload.reportHash,
  };
  return Buffer.from(`${DOMAIN}${JSON.stringify(canonical)}`, "utf8");
}

export function createVerificationReportAttestation(input: {
  readonly privateKey: VerificationAttestationKey;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly report: VerificationReportReference;
}): VerificationReportAttestation {
  const privateKey = privateKeyFrom(input.privateKey);
  const publicKey = createPublicKey(privateKey);
  const report = reportReference(input.report);
  const payload: VerificationReportAttestationPayload = {
    kind: "verification-report-attestation",
    version: 1,
    algorithm: "ed25519",
    keyId: keyIdFromPublicKey(publicKey),
    issuer: input.issuer,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    reportKind: report.kind,
    reportHash: report.reportHash,
  };
  const signature = signBytes(null, verificationAttestationPayload(payload), privateKey).toString("base64");
  return { ...payload, signature };
}

export function parseVerificationReportAttestation(value: unknown): VerificationReportAttestation {
  const record = object(value);
  const expected = new Set(["kind", "version", "algorithm", "keyId", "issuer", "issuedAt", "expiresAt", "nonce", "reportKind", "reportHash", "signature"]);
  const unexpected = Object.keys(record).filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation contains unsigned or unsupported fields.", { unexpected });
  }
  const payload = payloadFromRecord(record);
  validatePayload(payload);
  signatureBytes(record.signature);
  return { ...payload, signature: record.signature as string };
}

export function parseVerificationReportAttestationJson(json: string): VerificationReportAttestation {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification attestation is not valid JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return parseVerificationReportAttestation(value);
}

export function verifyVerificationReportAttestation(input: {
  readonly attestation: unknown;
  readonly report: VerificationReportReference;
  readonly trustedPublicKey: VerificationAttestationKey;
  readonly nowMs?: number;
  readonly maxFutureSkewMs?: number;
}): VerificationReportAuthentication {
  const attestation = parseVerificationReportAttestation(input.attestation);
  const report = reportReference(input.report);
  const key = publicKeyFrom(input.trustedPublicKey);
  const keyId = keyIdFromPublicKey(key);
  if (attestation.keyId !== keyId) {
    fail("ES4814", "VerificationAttestationKeyIdMismatch", "Verification attestation was not issued by the supplied trusted public key.", {
      attestationKeyId: attestation.keyId,
      trustedKeyId: keyId,
    });
  }
  if (attestation.reportKind !== report.kind || attestation.reportHash !== report.reportHash) {
    fail("ES4815", "VerificationAttestationReportMismatch", "Verification attestation does not bind the supplied report kind and hash.", {
      attestationReportKind: attestation.reportKind,
      reportKind: report.kind,
      attestationReportHash: attestation.reportHash,
      reportHash: report.reportHash,
    });
  }
  const nowMs = input.nowMs ?? Date.now();
  const maxFutureSkewMs = input.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    fail("ES4810", "InvalidVerificationAttestation", "Verification time and future clock skew must be non-negative safe integers.");
  }
  const { issuedAtMs, expiresAtMs } = validatePayload(attestation);
  if (issuedAtMs - nowMs > maxFutureSkewMs) {
    fail("ES4816", "VerificationAttestationNotYetValid", "Verification attestation issuance time is too far in the future.", {
      issuedAt: attestation.issuedAt,
      nowMs,
      maxFutureSkewMs,
    });
  }
  if (expiresAtMs <= nowMs) {
    fail("ES4817", "VerificationAttestationExpired", "Verification attestation has expired.", {
      expiresAt: attestation.expiresAt,
      nowMs,
    });
  }
  const { signature, ...payload } = attestation;
  let valid = false;
  try {
    valid = verifyBytes(null, verificationAttestationPayload(payload), key, signatureBytes(signature));
  } catch (error) {
    fail("ES4818", "VerificationAttestationSignatureInvalid", "Verification attestation signature could not be verified.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!valid) {
    fail("ES4818", "VerificationAttestationSignatureInvalid", "Verification attestation signature is invalid for the supplied trusted public key.");
  }
  return {
    authenticated: true,
    keyId,
    issuer: attestation.issuer,
    issuedAt: attestation.issuedAt,
    expiresAt: attestation.expiresAt,
    nonce: attestation.nonce,
    algorithm: attestation.algorithm,
    version: attestation.version,
  };
}
