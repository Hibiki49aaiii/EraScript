# Issue #16 Human Understanding

## What

EraScript will add a detached Ed25519 attestation for verification reports and will stop describing hash-only checks as trusted verification.

## Why

`reportHash` answers: "Does this file still match the content that was hashed?"

It does not answer: "Did a trusted verifier create or approve this report?"

Anyone can construct different report content and compute a matching hash. A trusted public-key signature is required to authenticate the issuer.

## How

A report remains unchanged. A separate attestation binds the report kind/hash to an issuer, trusted-key fingerprint, validity window, nonce, schema version, and Ed25519 signature. `era verify` authenticates only when both the attestation and an explicit trusted public-key file are supplied.

## Important Decisions

- Detached attestation preserves existing report JSON and hash compatibility.
- Ed25519 uses Node built-in crypto and adds no dependency.
- EraScript does not generate or store private keys in this workflow.
- Trust roots are explicit caller input; there is no hidden built-in trusted key.
- Authentication, content integrity, and claimed verification state are separate results.

## Invariants

- A changed report cannot reuse an attestation for the original report.
- A signature from an untrusted key is not authenticated.
- Expired or implausibly future attestations fail closed.
- Unsigned reports never appear as authenticated.
- Family-specific evidence and finality rules remain unchanged.

## Failure Modes

- Missing one of `--attestation` / `--trusted-key`: CLI usage error.
- Invalid key, key type, key fingerprint, signature, report binding, or validity window: verification failure.
- Valid signature over fabricated evidence: authentication succeeds only as an issuer statement; it does not independently prove the external evidence is true.
- Replayed still-valid attestation: offline verification cannot detect prior use; consumers needing one-time semantics require a separate nonce registry.

## Change Impact

Existing reports still parse and pass integrity/state gates. Human CLI wording becomes explicit about unauthenticated reports. New consumers can require trusted-key authentication without changing report producers immediately.
