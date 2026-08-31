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

## Qualification

- Merge baseline: `f015ad1d7f0b82023495e545e2a61d4dbb98ad39` (PR #19).
- Core CI run `33394469400`: 226/226 tests passed on Node 22.
- Dependency Audit run `33394469357`: production high/critical gate passed with 0 production vulnerabilities; root development/test evidence remains 67 and isolated Waku evidence remains 71 vulnerabilities.
- Read-only Live Network Integration run `33394469380`: Solana, Sui, and Jito checks passed (3/3).
- Local Windows full core run: 224/226; the two failures are pre-existing path-normalization assertions, while Linux Core CI is fully green.

The workflows also report that `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4` target the deprecated Node 20 action runtime and are currently forced onto Node 24. Immutable action pinning and action-runtime upgrades remain tracked by Issue #15.
