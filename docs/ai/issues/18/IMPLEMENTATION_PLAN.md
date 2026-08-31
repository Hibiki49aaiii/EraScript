# Issue #18 Implementation Plan

Base Commit: `6c2c733afd1f5d259e33f5b32a9d096e55e8b813`

Target branch: `issue-18-public-verification-api`

## Requirements

- Remove `createMultichainVerificationReport` from the root and `./chains` public barrels.
- Preserve public verification report/check/evidence/state types and safe parse/hash/assert APIs.
- Preserve internal adapter behavior and report JSON/hash compatibility.
- Prove the runtime and generated declaration public surfaces do not expose the constructor.
- Document the pre-1.0 compatibility change and remaining deep-file/package-content limitation.

## Current Architecture

`src/chains/index.ts` uses `export * from "./verification.js"`, so the low-level constructor becomes part of both `erascript-lang/chains` and the root barrel. It accepts any state including `VERIFIED_FINALITY`.

Internal family-specific adapters already import the same module directly and derive terminal states from their evidence checks.

## Target Architecture

```text
package public barrels
  -> types
  -> evidence reference/hash
  -> report parser
  -> state assertion
  -X createMultichainVerificationReport

repository-internal adapters/tests
  -> direct ./verification.js import
  -> low-level constructor
```

## API Changes

Breaking pre-1.0 change: `createMultichainVerificationReport` is removed from supported package exports. No report schema or serialized artifact changes.

## Security Considerations

- Package consumers can no longer accidentally mint a terminal report through the documented/importable barrel.
- The internal constructor remains a shared implementation detail to prevent duplicated hash/state logic.
- Node package `exports` blocks undeclared deep subpaths, but the compiled internal file may still be present in the tarball until package-content separation is completed under the roadmap.
- Authenticated external reports remain parseable; authenticity and evidence truth remain separate Issue #16 boundaries.

## Testing Strategy

- Runtime import both root and chains barrels and assert the constructor key is absent.
- Assert safe functions remain present.
- Inspect generated `dist/src/chains/index.d.ts` and assert no constructor re-export.
- Run multichain, CLI verification, attestation, full Core CI, and production audit gates.

## Implementation Order

1. Replace star export with explicit safe exports.
2. Move internal fixture imports to the internal module.
3. Add runtime/declaration public API regression tests.
4. Align version and docs.
5. Run checks and post-implementation review.
6. Merge through PR after Core CI and Dependency Audit.

## Rollback

Restore the verification star export and internal test imports. No serialized data migration is involved.

## Known Risks

- Pre-1.0 consumers of the low-level constructor must migrate to strict adapters or keep an internal fork.
- A reviewed third-party terminal-state extension contract does not yet exist.
