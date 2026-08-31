# Issue #16 Post-Implementation Review

Status: **APPROVED / COMPLETE**

Reviewed on branch `issue-16-authenticated-verification` against base commit `9b8de65ca2c69208c3a8e0db17a5326648d917ff`.

## Correctness

- Rescue and multichain report schemas and report-hash algorithms are unchanged.
- One detached attestation format binds version, algorithm, key ID, issuer, issuance/expiry, nonce, report kind, and report hash.
- Canonical payload bytes use a fixed domain prefix and fixed field order.
- Ed25519 verification uses an explicitly supplied trusted public key.
- CLI structured output separates report integrity, state-gate evaluation, and authentication.
- Unsigned human output is explicitly `INTEGRITY OK (UNAUTHENTICATED)`.

## Regression

- Existing verification parsing and state-gate tests passed during the full local run.
- New tests pass on Node 22.23.2 and the local Node 24.13.1 runtime.
- The complete local Windows run executed 224 tests: 222 passed and 2 existing Windows path-normalization assertions failed. Both failures reproduce individually and no changed file participates in those paths:
  - `frontend-diagnostics-map.test`: forward-slash diagnostic path versus native backslash expectation.
  - `project-runtime.test`: imported diagnostic lookup compares TypeScript-normalized and native Windows paths.
- Linux Core CI run `33391987524` passed 224/224 tests with 0 failures, confirming the Windows-only path assertion diagnosis.

## Architecture

- Detached attestation avoids changing or duplicating historical report schemas.
- Trust-root selection remains explicit caller policy; EraScript does not ship a hidden trust store.
- Private-key signing support exists only as a library helper for controlled producers. `era verify` imports only parse/verify APIs and reads only a public key.
- Restricting arbitrary terminal-state construction remains a separate potentially breaking Issue.

## Security

- Trusted keys are normalized through Node `KeyObject`, restricted to Ed25519 public keys, and fingerprinted from DER SPKI bytes.
- Private `KeyObject` and private-key PEM input are rejected by verification.
- Strict parser rejects unsigned extra fields and non-canonical encodings.
- Wrong key, changed report, changed signed fields, malformed nonce/signature, future issuance, expiration, and invalid validity windows are covered by negative tests.
- No secret, private key, network write, signing operation through CLI, transaction, proof, bundle, or broadcast was introduced.
- Production dependency audit remains at 0 vulnerabilities; no dependency was added.

## Maintainability

- Attestation logic is isolated in `src/verification-attestation.ts` and publicly exported from the root API.
- Stable diagnostics use the existing `EraDiagnosticError` model and collision registry.
- Tests use ephemeral in-memory keys and temporary files cleaned in `finally`.
- Public trust semantics and limitations are documented in README and `docs/V017_IMPLEMENTATION.md`.

## Dead Code / Stale Docs

- No old report parser, state gate, or report hash was replaced or duplicated.
- Bare unsigned `VERIFIED` CLI wording was removed.
- Package and CLI versions are aligned at `0.17.0`.

## Local Verification Evidence

- `npm ci` - completed; 1003 packages installed, known root dev/test audit baseline reported separately.
- `npm run check` - pass.
- `npm run build` - pass.
- Node 22 focused attestation library tests - 5/5 pass.
- Node 22 focused attestation CLI tests - 3/3 pass.
- Node 22 diagnostic registry - 1/1 pass.
- `npm run test:core` on Windows - 222/224 pass; 2 pre-existing path-normalization failures described above.
- `npm audit --omit=dev --audit-level=high` - pass, 0 vulnerabilities.
- `git diff --check` - pass; only Git line-ending conversion warnings.

## CI Evidence

- Core CI run `33391987524` - success.
  - `npm ci` - pass.
  - `npm run check` - pass.
  - `npm run test:core` - 224 tests, 224 pass, 0 fail.
- Dependency Audit run `33391987552` - success, 3/3 jobs.
  - production audit - 0 vulnerabilities.
  - root dev/test evidence - 67 total (16 low, 34 moderate, 14 high, 3 critical).
  - isolated Waku evidence - 71 total (16 low, 37 moderate, 15 high, 3 critical).

## Remaining Issues

- Public terminal-state constructor restriction remains a separate P0 roadmap item.
- Offline key revocation, transparency, and nonce-consumption tracking remain outside Issue #16.
- Existing Windows path-normalization test portability should be handled in a separate Issue; Linux CI is green.
