# Issue #11 Implementation Plan

## Issue

#11 — chore(security): lock dependency graph and triage high/critical npm audit findings

## Base Commit SHA

`88f5577d3d3babbd6be0e6f73c6d4db3d8f09cf8`

## Target Branch

`main`

## Requirements

- make npm dependency resolution reproducible,
- commit an authoritative npm lockfile,
- migrate Core CI from `npm install` to `npm ci`,
- enumerate and disposition every high/critical audit finding,
- avoid blind breaking upgrades,
- preserve EraScript's EVM/Solana/Sui/RAILGUN compatibility,
- keep all deterministic core tests green.

## Current Architecture

```text
package.json
  -> npm install
  -> floating transitive dependency resolution
  -> npm run check
  -> npm run test:core
```

Current direct dependencies:

- runtime: `typescript@^5.9.2`, `viem@^2.55.19`
- dev/integration: `@mysten/sui@2.27.1`, `@solana/kit@8.1.0`, `@railgun-community/wallet@10.9.0`, `@types/node@^22.15.3`

No lockfile exists in the repository.

Core CI is Node 22 and currently runs `npm install`.

## Target Architecture

```text
package.json
  + package-lock.json (npm 10 / lockfile v3)
        |
        v
npm ci
  |
  +--> exact dependency graph
  +--> audit evidence
  +--> typecheck
  +--> deterministic core tests
```

## Data Flow

1. Generate lockfile from the current manifest using the repository CI toolchain baseline.
2. Install exactly from the lockfile with `npm ci`.
3. Capture machine-readable audit output.
4. Resolve audit dependency paths to direct owners.
5. Classify findings:
   - runtime reachable,
   - dev/test only,
   - upstream-only,
   - not applicable to EraScript use,
   - safely remediable.
6. Apply only safe/evidence-backed changes.
7. Recreate/validate lockfile after dependency changes.
8. Run full deterministic verification.

## State Transitions

```text
UNLOCKED
  -> LOCKFILE_GENERATED
  -> CI_USES_NPM_CI
  -> AUDIT_TRIAGED
  -> SAFE_REMEDIATION_APPLIED
  -> VERIFIED
```

The issue does not require audit count to become zero. It requires deterministic ownership, risk disposition, and no silent high/critical findings.

## Files Expected to Change

Expected:

- `package-lock.json` — new authoritative dependency graph
- `.github/workflows/ci.yml` — `npm install` -> `npm ci`
- `docs/ai/issues/11/IMPLEMENTATION_PLAN.md`
- `docs/ai/issues/11/HUMAN_UNDERSTANDING.md`
- `docs/ai/issues/11/PRE_IMPLEMENTATION_REVIEW.md`
- audit/remediation evidence document under `docs/ai/issues/11/`
- `package.json` only if a safe direct-version change is justified

Not expected:

- runtime source files
- chain execution logic
- language grammar

## API Changes

None intended.

## DB / Migration Changes

None.

## Error Handling

- lockfile/manifest mismatch must make `npm ci` fail,
- audit command failure must be recorded rather than treated as clean,
- peer-resolution warnings must be captured,
- unsafe/breaking remediation is not automatically applied.

## Security Considerations

- do not run `npm audit fix --force`,
- do not add registry credentials,
- do not treat severity alone as exploitability,
- do not downgrade chain SDK safety/verification semantics to avoid a vulnerable transitive package,
- preserve exact installed versions once the baseline is accepted,
- capture upstream-only residual risk explicitly.

## Design Options

### Option A — npm lockfile + npm ci + evidence-backed remediation — SELECTED

Advantages:
- consistent with existing package manager,
- smallest architecture change,
- deterministic CI,
- standard npm audit support,
- reversible.

Disadvantages:
- may preserve known upstream findings temporarily,
- lockfile is large.

### Option B — migrate to pnpm/yarn

Advantages:
- potentially stronger workspace/store behavior.

Disadvantages:
- unrelated package-manager migration,
- adds toolchain scope and compatibility risk,
- does not itself solve vulnerable upstream packages.

Decision: rejected for Issue #11.

### Option C — no lockfile; pin only direct versions

Advantages:
- smaller repository diff.

Disadvantages:
- transitive graph still floats,
- CI remains non-reproducible,
- insufficient for a security-sensitive Web3 tool.

Decision: rejected.

## Testing Strategy

- generate/validate lockfile with Node 22 / npm 10-compatible tooling,
- `npm ci`,
- `npm audit --json`,
- `npm run check`,
- `npm run test:core`,
- Core CI final green run,
- compare audit findings before/after any safe remediation.

## Implementation Order

1. Create planning/review docs.
2. Generate lockfile only; no package upgrades.
3. Validate `npm ci`.
4. Capture and triage audit.
5. Update CI to `npm ci`.
6. Apply safe remediation only if supported by evidence.
7. Run deterministic verification.
8. Post-Implementation Review.
9. Update/close Issue #11.

## Rollback

- revert lockfile and CI command together,
- revert any dependency version change independently,
- no persistent runtime/data migration exists.

## Known Risks

- current peer dependency overrides in the RAILGUN tree,
- large/deprecated transitive graph,
- advisories may have no non-breaking upstream fix,
- lockfile generated by a materially different npm major could create avoidable churn.
