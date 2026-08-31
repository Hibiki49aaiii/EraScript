# Detached Ed25519 verification attestation

Status: active
Date: 2026-08-31

## Context

Rescue and multichain verification reports contain deterministic hashes, but those hashes prove content integrity rather than issuer authenticity. Changing both report schemas would break historical report hashes and duplicate trust-envelope behavior.

## Decision

Use one versioned detached Ed25519 attestation for both report kinds. Bind the exact report kind/hash, trusted-key fingerprint, issuer, issuance/expiry timestamps, and nonce under a domain-separated canonical payload. Verification requires an explicitly supplied trusted public key. Keep report integrity, claimed-state gating, and authentication as separate outputs.

## Alternatives considered

- Embedded signature fields: rejected because they change two report schemas and canonical hashes.
- HMAC: rejected because verifiers would require the signing secret.
- ECDSA/secp256k1: rejected for this version because it adds encoding/malleability complexity without a report-trust requirement.
- Built-in trust store or KMS: deferred because it imposes operational key policy and secret management.

## Evidence / Rationale

- Current `src/chains/verification.ts` and `src/web3/verification-io.ts` recompute hashes without authenticating an issuer.
- Node 22 documents built-in Ed25519 `sign`/`verify` with a null algorithm and public-key parsing through `createPublicKey`.
- Issue #16 focused tests cover both report kinds, wrong keys, report substitution, signed-field changes, invalid encodings, validity windows, and CLI output semantics.

## Tradeoffs

- Existing report JSON and hashes remain compatible.
- Callers must distribute trusted public keys and detached attestations.
- Offline verification does not provide revocation or nonce-consumption tracking.
- A valid signature authenticates an issuer statement; chain-specific evidence validation remains necessary.

## Consequences

- Unsigned reports are labeled unauthenticated.
- CLI verification never reads a private key.
- A future trust service can add revocation/transparency without changing report hashes.
- Terminal-state constructor restrictions remain a separate API-surface decision.

## Revisit when

- EraScript defines an organization-level trust store, KMS/HSM integration, certificate chain, revocation protocol, or transparency log.
- Report schemas require a breaking version change for other reasons.

## Related code

- `src/verification-attestation.ts`
- `src/cli.ts`
- `test/verification-attestation.test.ts`
- `test/cli-verification-attestation.test.ts`
- GitHub Issue #16
