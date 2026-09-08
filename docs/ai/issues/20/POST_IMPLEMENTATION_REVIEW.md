# Issue #20 Post-Implementation Review

Status: **APPROVED FOR MERGE**

Issue: #20

Pull Request: #21

Base Commit SHA: `2bf73fe79eda59f9bef44ad821fe3cb9b21783cd`

Reviewed branch head: `b8a8a6819600c11accd34a004d846da41188c7a6`

## Scope Reviewed

- terminal-color-sensitive project runtime/build tests
- npm package publish boundary
- installed-tarball package smoke/content gate
- Core CI regression gates

## Root Cause Audit

### 1. Color-sensitive test failures — CONFIRMED

`test/project-build.test.ts` and `test/project-runtime.test.ts` spawned Node/CLI children without an explicit `env`. Therefore the children inherited parent terminal variables such as `FORCE_COLOR`, `NO_COLOR`, and `TERM`.

Those tests also make exact assertions over captured stdout/stderr, including:

- primitive boolean output such as `true`, and
- source-mapped stack frame path/line substrings.

With color forced in the parent environment, Node can ANSI-decorate primitive `console.log` output and stack rendering. That changes the raw captured bytes without changing EraScript semantics.

Conclusion: the reported 4-test failure pattern is a **test harness determinism defect**, not an EraScript runtime/module/source-map correctness regression.

### 2. `dist/test/**` npm payload contamination — CONFIRMED

`tsconfig.json` intentionally uses:

```text
rootDir: .
outDir: dist
include: src/**/*.ts, test/**/*.ts
```

so a real build emits both:

```text
dist/src/**
dist/test/**
```

The pre-fix package allowlist was:

```json
"files": ["dist", "README.md", "LICENSE"]
```

Therefore compiled tests were publishable after a real build.

Conclusion: the contamination is caused by the **combination of the development build layout and an overly broad npm `files` allowlist**.

## Implementation Review

### Test determinism — PASS

The two affected test files now preserve the parent environment while explicitly overriding only:

```text
NO_COLOR=1
FORCE_COLOR=0
TERM=dumb
```

for their spawned test children.

Production CLI/runtime code is unchanged.

### Package boundary — PASS

`package.json` now allowlists:

```json
"files": ["dist/src", "README.md", "LICENSE"]
```

The development build remains unchanged and can still emit `dist/test/**` for `node:test`; npm packaging is constrained separately.

### Package smoke/content gate — PASS

`scripts/package-smoke.mjs` is Node-standard-library-only and cross-platform in design (`npm.cmd` on Windows).

It:

1. packs the current built package with `npm pack --json`,
2. validates required and forbidden paths,
3. installs the local tarball into a fresh temporary fixture,
4. validates root and subpath imports,
5. validates installed CLI behavior,
6. validates `era run` can load `dist/src/runtime-loader.js`,
7. validates project build and execution,
8. removes temporary artifacts in `finally`.

### CI regression gates — PASS

Core CI now runs:

- locked install,
- typecheck,
- normal Core suite,
- full Core suite with parent `FORCE_COLOR=1`,
- installed-package smoke/content gate.

This makes both defects continuously testable rather than relying on one-time local inspection.

## Verification Evidence

### Pull Request Core CI

Run: **Core CI #443**

Run ID: `34189949945`

Environment:

```text
Node: 22.23.2
npm: 10.9.8
```

Result:

```text
npm ci: PASS
npm run check: PASS
normal npm run test:core: PASS
FORCE_COLOR=1 npm run test:core: PASS
npm run test:package: PASS
```

Normal Core suite:

```text
tests: 226
pass: 226
fail: 0
```

Forced-color Core suite:

```text
tests: 226
pass: 226
fail: 0
```

Package smoke result:

```json
{
  "ok": true,
  "package": "erascript-lang@0.18.0",
  "fileCount": 267,
  "runtimeIncluded": true,
  "testsExcluded": true,
  "imports": [".", "./web3", "./chains", "./privacy"],
  "cli": ["--version", "check", "run", "build"]
}
```

The smoke script additionally asserts that `dist/src/cli.js` and `dist/src/runtime-loader.js` are in the tarball.

### Dependency Audit

Run: **Dependency Audit #9**

Run ID: `34189949941`

All three jobs passed.

Production high/critical gate:

```text
npm ci --omit=dev --ignore-scripts: PASS
npm audit --omit=dev --audit-level=high: PASS
found 0 vulnerabilities
```

The full maintainer/dev graph still reports known upstream RAILGUN-related advisories; Issue #20 does not conflate that graph with the published production dependency boundary.

## Correctness — PASS

No EraScript runtime/compiler/module semantics changed.

The reported local failures are fixed at the test boundary and verified under their actual triggering condition.

## Regression — PASS

Both the normal and forced-color 226-test suites pass.

Package behavior is tested from an installed tarball, not only from the repository source tree.

## Architecture — PASS

The chosen fixes are narrower than introducing a second production tsconfig or global ANSI normalization:

- test-only environment control for test determinism,
- npm allowlist for package boundary,
- Node package smoke for release qualification.

## Security — PASS

- no runtime dependency added,
- no dependency override,
- no `npm audit fix --force`,
- no secret change,
- no signing/proof/bundle/transaction/network-write behavior added,
- no npm publish or GitHub Release operation.

The narrower package allowlist reduces accidental publication of internal compiled tests.

## Maintainability — PASS

The new `test:package` script makes package content and installed behavior a repeatable invariant.

The color regression has a dedicated forced-parent-color CI step, so future changes cannot silently reintroduce the same environment sensitivity.

## Out-of-Scope Observation

GitHub Actions logs now warn that `actions/checkout@v4` and `actions/setup-node@v4` target deprecated Node 20 action runtimes and are being forced to Node 24 by GitHub runners.

This is pre-existing CI infrastructure debt and is **not** caused by Issue #20. It should be handled as a separate Issue #15 workstream after checking current official action majors/SHAs.

## Decision

**APPROVED FOR MERGE.**

Issue #20 acceptance criteria are satisfied at the PR verification level. After merge, re-run/confirm the same Core CI and production dependency gate on `main`, then close Issue #20 and update umbrella Issue #15 progress.
