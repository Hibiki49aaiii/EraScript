# EraScript v0.17 - Authenticated verification reports

## Purpose

v0.17 separates three concepts that were previously easy to confuse:

1. report integrity,
2. a report's claimed verification state,
3. authentication by an explicitly trusted verifier key.

A deterministic `reportHash` continues to bind report content. It is not a signature and does not identify the report issuer.

## Detached attestation

Both rescue and multichain reports use the same detached envelope:

```text
verification-report-attestation / version 1 / ed25519
  -> trusted public-key fingerprint
  -> issuer
  -> issuedAt / expiresAt
  -> 32-byte nonce
  -> report kind
  -> report hash
  -> Ed25519 signature
```

The signed bytes use a fixed domain prefix and fixed-order canonical JSON. The trusted key ID is SHA-256 over normalized DER SPKI public-key bytes, so PEM whitespace does not change identity.

## CLI trust semantics

Unsigned inspection remains backward-compatible:

```bash
era verify report.json --require VERIFIED_FINALITY
```

It now prints `INTEGRITY OK (UNAUTHENTICATED)` and identifies the state as a claim.

Authenticated verification requires both detached files:

```bash
era verify report.json \
  --require VERIFIED_FINALITY \
  --attestation report.attestation.json \
  --trusted-key verifier-public.pem \
  --json
```

Structured output reports `integrity`, `stateRequirementMet`, and `authenticated` separately. The CLI does not generate, read, or store private keys.

## Fail-closed validation

The verifier rejects:

- malformed or unsupported attestation kind/version/algorithm,
- unknown unsigned fields,
- non-canonical key IDs, hashes, nonces, timestamps, and signatures,
- non-Ed25519 or private trusted-key input,
- trusted-key fingerprint mismatch,
- report kind/hash substitution,
- invalid validity windows,
- issuance beyond bounded future clock skew,
- expired attestations,
- invalid Ed25519 signatures.

Diagnostics `ES4810` through `ES4819` are registry-checked for semantic collisions.

## Security boundary

A valid attestation proves that the holder of the explicitly trusted private key signed the exact report reference and attestation context. It does not independently prove that external RPC/evidence data is true. Chain-specific evidence, quorum, finality, post-state, and private-state checks remain mandatory.

Offline verification also does not provide key revocation or one-time nonce consumption. Those require an operational trust service or caller-owned registry outside v0.17.

## Compatibility

- Existing rescue and multichain report JSON remains unchanged.
- Existing report-hash algorithms remain unchanged.
- Existing claimed-state ranking and family-specific finality logic remain unchanged.
- Human CLI success wording intentionally changes to remove an unauthenticated bare `VERIFIED` claim.

Issue #16 contains the implementation plan, human understanding summary, review record, and verification evidence.
