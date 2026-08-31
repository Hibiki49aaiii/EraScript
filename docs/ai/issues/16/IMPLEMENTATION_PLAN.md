# Issue #16 Implementation Plan

Base Commit: `9b8de65ca2c69208c3a8e0db17a5326648d917ff`

Target branch: `issue-16-authenticated-verification`

## Requirements

- Preserve the current rescue and multichain report JSON/hash formats.
- Add one detached, versioned Ed25519 attestation format for both report kinds.
- Require an explicitly supplied trusted public key for authentication.
- Bind the signature to the report kind/hash, issuer, validity window, nonce, version, and algorithm.
- Keep unsigned reports inspectable, but describe them as integrity-checked and unauthenticated.
- Keep family-specific state derivation and state-ranking behavior unchanged.
- Never load, generate, log, or persist a private key in the CLI verification path.

## Current Architecture

```text
report JSON
  -> schema parser
  -> deterministic reportHash recomputation
  -> claimed-state minimum gate
  -> CLI prints VERIFIED
```

The report hash detects changed content after hash creation. It does not identify who created the report because a new hash can be computed for newly fabricated content.

## Target Architecture

```text
report JSON ------------------------------+
  -> schema parser                        |
  -> reportHash recomputation             |
  -> claimed-state minimum gate           |
                                            +-> trust result
detached attestation JSON                 |
  -> strict schema/version validation     |
  -> report kind/hash binding ------------+
  -> validity-window validation
  -> explicit trusted Ed25519 public key
  -> key fingerprint match
  -> domain-separated signature verify
```

The result has three separate facts:

1. `integrity=true`: the report schema and deterministic hash are internally consistent.
2. `stateRequirementMet=true`: the report claims a state at or above the requested threshold.
3. `authenticated=true`: a non-expired attestation was signed by the explicitly trusted key for this exact report.

Authentication proves control of the trusted key, not truth of the external RPC/evidence source.

## Attestation Format

```ts
interface VerificationReportAttestation {
  kind: "verification-report-attestation";
  version: 1;
  algorithm: "ed25519";
  keyId: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  reportKind: "rescue-verification-report" | "multichain-verification-report";
  reportHash: string;
  signature: string;
}
```

- Timestamps are strict UTC ISO-8601 strings with millisecond precision.
- `nonce` is 32 bytes encoded as 64 lowercase hexadecimal characters.
- `signature` is canonical base64 for the 64-byte Ed25519 signature.
- `keyId` is `sha256:<lowercase hex>` over the public key's DER SPKI encoding.
- The signed payload is UTF-8 JSON for a fixed-order object prefixed by the domain string `EraScript Verification Report Attestation v1\n`.

## API Changes

New public module exports:

- `verificationAttestationKeyId(publicKey)`
- `verificationAttestationPayload(attestationWithoutSignature)`
- `createVerificationReportAttestation(input)` for library callers that already control a private key
- `parseVerificationReportAttestation(value)`
- `verifyVerificationReportAttestation(options)`

The CLI imports only parse/verify functions and reads only a public key. Private-key signing is a library utility for controlled callers and ephemeral tests; it is not exposed as a CLI command.

## CLI Changes

```text
era verify report.json
era verify report.json --require VERIFIED_FINALITY
era verify report.json --attestation report.attestation.json --trusted-key verifier-public.pem
```

- `--attestation` and `--trusted-key` must appear together.
- Unsigned output says `INTEGRITY OK (UNAUTHENTICATED)`.
- Authenticated output says `AUTHENTICATED REPORT` and identifies issuer/key ID.
- JSON output always includes `integrity`, `stateRequirementMet`, and `authenticated`.

## Data / Migration Changes

No database or migration. Existing report files remain valid and hash-compatible. Authentication uses a separate file.

## Error Handling

New stable diagnostic range `ES4810`-`ES4819` covers malformed attestations, unsupported algorithms/versions, key parsing/type errors, key-ID mismatch, report mismatch, invalid time window, and invalid signatures.

CLI option-shape errors exit with status 2. Verification/authentication failures use the existing Era diagnostic path and exit with status 1.

## Security Considerations

- Use Node's built-in Ed25519 implementation with `algorithm=null` as required by the Node 22 API.
- Convert the provided key to a public `KeyObject` and reject non-Ed25519 keys.
- Compute the key ID from normalized SPKI DER, not from textual PEM formatting.
- Validate every signed field before signature verification.
- Require exact report kind/hash equality.
- Bound future clock skew and reject expiration.
- Do not claim replay prevention: the nonce is signed context, but offline verification has no consumed-nonce registry.
- Do not log key contents or signature bytes.

## Testing Strategy

- Generate ephemeral Ed25519 key pairs inside each test process.
- Positive tests for rescue and multichain report kinds.
- Negative tests for wrong key, changed report hash/kind, changed issuer/time/nonce, malformed fields, expired/future timestamps, and invalid signature encoding.
- CLI tests for unsigned labels, paired option validation, authenticated JSON/human output, and mismatch rejection.
- Existing verification tests remain unchanged except where output wording is intentionally hardened.
- Run diagnostic collision protection through the full core suite.

## Implementation Order

1. Add documentation and approve the three-pass pre-implementation review.
2. Add attestation types, canonical payload, key fingerprinting, parser, signer helper, and verifier.
3. Export the module.
4. Integrate CLI option parsing and trust-result output.
5. Add focused/adversarial tests.
6. Update README trust semantics and examples.
7. Run checks, full core tests, build, smoke test, and post-implementation review.
8. Update Issue #16 with actual evidence; push and observe Core CI before closure.

## Rollback

Remove the detached-attestation module/tests/options and restore the prior CLI wording. Report hashes and report JSON require no migration or rollback.

## Known Risks

- Existing automation may parse the old human string `VERIFIED`; JSON consumers are expected to use structured fields.
- Offline public-key verification does not provide key revocation or nonce consumption.
- The public low-level multichain report constructor remains a separate follow-up because changing it may break API consumers.
