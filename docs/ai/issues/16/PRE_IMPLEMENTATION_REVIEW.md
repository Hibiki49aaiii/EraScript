# Issue #16 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

Reviewed against Issue #16 and base commit `9b8de65ca2c69208c3a8e0db17a5326648d917ff`.

## Pass 1 - Requirements

### Finding: hash integrity and issuer authenticity must be separate

Disposition: adopted.

The API/CLI result exposes integrity, state gate, and authentication separately. A report cannot become authenticated from a matching hash alone.

### Finding: private-key handling must not enter `era verify`

Disposition: adopted.

The CLI reads an explicitly supplied public key only. Key generation, storage, KMS, and private signing commands are outside scope.

### Finding: existing reports must remain usable

Disposition: adopted.

The attestation is detached. Existing report kinds and report-hash calculations remain unchanged.

## Pass 2 - Architecture

### Option A: embed signatures in both report formats

Rejected. It changes two canonical schemas/hashes and duplicates trust-envelope behavior.

### Option B: HMAC

Rejected. Every verifier would need the signing secret, collapsing signer/verifier separation.

### Option C: detached Ed25519 attestation with explicit trusted key

Selected. It preserves report compatibility, uses Node's stable built-in crypto, and leaves trust-root operations to the caller.

### Finding: terminal-state constructor restriction belongs in the same diff

Rejected for this Issue. It is related but may be a public API break. Issue #16 makes arbitrary self-authored reports visibly unauthenticated; constructor restriction will be handled in a dedicated child Issue.

## Pass 3 - Risk

### Canonicalization ambiguity

Disposition: adopted.

The signed payload uses a fixed field order, fixed UTF-8 JSON representation, fixed domain prefix, strict timestamp format, lowercase nonce/hash/key ID, and canonical base64 signature encoding.

### Key confusion

Disposition: adopted.

The verifier normalizes the key through `createPublicKey`, requires an Ed25519 public key, and computes the key ID from DER SPKI bytes.

### Clock handling

Disposition: adopted.

Library verification receives `nowMs` for deterministic tests and supports a bounded future-skew option. Expiry must be after issuance and after the verification time.

### Replay semantics

Disposition: documented limitation.

The signed nonce prevents substitution but offline verification cannot know whether a nonce was consumed. No replay-prevention claim will be made.

### Misleading success output

Disposition: adopted.

Unsigned human output uses `INTEGRITY OK (UNAUTHENTICATED)`. Authenticated success uses a distinct label. JSON exposes booleans rather than relying on prose.

## Decision

**APPROVED TO IMPLEMENT.**
