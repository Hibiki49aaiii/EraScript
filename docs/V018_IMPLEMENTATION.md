# EraScript v0.18 - Terminal verification construction boundary

v0.18 removes `createMultichainVerificationReport` from the supported root and `./chains` public exports.

## Public surface

Public consumers retain:

- verification report/check/evidence/state types,
- `multichainEvidenceRef`,
- `multichainVerificationReportHash`,
- `parseMultichainVerificationReport`,
- `assertMultichainVerificationState`,
- family-specific strict adapters.

The generic constructor remains repository-internal because it accepts the target state directly. Strict adapters continue to use it after applying their family-specific evidence, quorum, finality, settlement, or private-state rules.

## Compatibility

This is an intentional pre-1.0 API restriction. Consumers that imported `createMultichainVerificationReport` from `erascript-lang` or `erascript-lang/chains` must migrate to the appropriate strict adapter. Report JSON, hashes, detached attestations, and `era verify` remain compatible.

## Remaining boundary

The compiled internal module may still exist inside the package tarball while `dist` is published wholesale. Node package exports do not expose that deep subpath as a supported import. Production-only package build/content enforcement remains a separate roadmap item.
