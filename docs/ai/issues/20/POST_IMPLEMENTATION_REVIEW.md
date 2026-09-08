# Issue #20 Post-Implementation Review

Status: **APPROVED — MERGED AND VERIFIED ON MAIN**

Issue: #20

Pull Request: #21

Base Commit SHA: `2bf73fe79eda59f9bef44ad821fe3cb9b21783cd`

Merged main commit: `ba4930550ebeeeebb18e1a4001239db083a9c43c`

## Scope Reviewed

- terminal-color-sensitive project runtime/build tests
- npm package publish boundary
- installed-tarball package smoke/content gate
- Core CI regression gates

## Root Cause Audit

### 1. Color-sensitive test failures — CONFIRMED

`test/project-build.test.ts` and `test/project-runtime.test.ts` spawned Node/CLI children without an explicit `env`. Therefore children inherited parent terminal variables such as `FORCE_COLOR`, `NO_COLOR`, and `TERM`.

Those tests make exact raw assertions over captured stdout/stderr, including primitive boolean output such as `true` and source-mapped stack frame path/line substrings. With color forced in the parent environment, Node can ANSI-decorate primitive `console.log` output and stack rendering. The raw captured bytes change even though EraScript semantics do not.

Conclusion: the reported four-test failure pattern was a **test harness determinism defect**, not an EraScript runtime/module/source-map correctness regression.

### 2. `dist/test/**` npm payload contamination — CONFIRMED

`tsconfig.json` intentionally uses:

```text
rootDir: .
outDir: dist
include: src/**/*.ts, test/**/*.ts
```

so a real development build emits both:

```text
dist/src/**
dist/test/**
```

The pre-fix package allowlist was:

```json
"files": ["dist", "README.md", "LICENSE"]
```

Therefore compiled tests were publishable after a real build.

Conclusion: the contamination was caused by the **combination of the development build layout and an overly broad npm `files` allowlist**.

## Implementation Review

### Test determinism — PASS

The two affected test files now preserve the parent environment while explicitly overriding only:

```text
NO_COLOR=1
FORCE_COLOR=0
TERM=dumb
```

for spawned test children.

Production CLI/runtime code is unchanged.

### Package boundary — PASS

`package.json` now allowlists:

```json
"files": ["dist/src", "README.md", "LICENSE"]
```

The development build can still emit `dist/test/**` for `node:test`; npm packaging is constrained independently to the supported runtime/declaration subtree.

### Package smoke/content gate — PASS

`scripts/package-smoke.mjs` is Node-standard-library-only and cross-platform in design (`npm.cmd` on Windows).

It:

1. packs the built package with `npm pack --json`,
2. validates required and forbidden package paths,
3. installs the local tarball into a fresh temporary project,
4. validates root and subpath imports,
5. validates installed CLI behavior,
6. validates `era run` can resolve the packaged `dist/src/runtime-loader.js`,
7. validates `era build` and execution of built output,
8. cleans temporary artifacts in `finally`.

### CI regression gates — PASS

Core CI now runs:

- locked install,
- typecheck,
- normal Core suite,
- full Core suite with parent `FORCE_COLOR=1`,
- installed-package smoke/content gate.

This turns both reported defects into permanent regression gates.

## Pull Request Verification

PR #21 was verified at latest PR head before merge.

### Core CI #444

Run ID: `34190336378`

Result: **SUCCESS**

All steps passed, including normal Core tests, forced-color Core tests, and installed package smoke.

### Dependency Audit #10

Run ID: `34190336352`

Result: **SUCCESS**

All production/dev/Waku evidence jobs passed.

## Final Main Verification

Main commit:

`ba4930550ebeeeebb18e1a4001239db083a9c43c`

### Core CI #445

Run ID: `34190609413`

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

Installed package smoke:

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

The content gate separately asserts `dist/src/cli.js` and `dist/src/runtime-loader.js` are packaged and no `dist/test/**` path is packaged.

### Dependency Audit #11

Run ID: `34190609180`

Result: **SUCCESS** — all three jobs passed.

Production high/critical gate:

```text
npm ci --omit=dev --ignore-scripts: PASS
npm audit --omit=dev --audit-level=high: PASS
found 0 vulnerabilities
```

The full maintainer/dev graph still contains the documented upstream RAILGUN-related advisories. They remain separate from the published production dependency boundary.

### Live Network Integration #24

Run ID: `34190609438`

Result: **SUCCESS**.

Both read-only jobs passed:

- Solana RPC / Sui Core API / Jito public-readonly smoke
- isolated RAILGUN/Waku discovery smoke

No transaction, proof, signing, bundle submission, or broadcast behavior was introduced by Issue #20.

## Correctness — PASS

No EraScript runtime/compiler/module semantics changed. The reported local failures were fixed at the test boundary and verified under their actual triggering condition.

## Regression — PASS

Both normal and forced-color 226-test suites pass on main. Package behavior is verified from an installed tarball rather than only from the repository source tree.

## Architecture — PASS

The selected fixes are narrower than a second production tsconfig or global ANSI normalization:

- test-only environment control for test determinism,
- npm allowlist for publish boundary,
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

The new `test:package` script makes package content and installed behavior a repeatable invariant. The forced-parent-color CI step prevents silent reintroduction of the same environment sensitivity.

## Residual / Out-of-Scope Observation

GitHub Actions logs warn that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime and are being forced by GitHub runners onto Node 24.

This is pre-existing CI infrastructure debt, not an Issue #20 regression. It belongs to the separate Issue #15 Actions-hardening workstream after checking current official action majors and immutable SHAs.

## Decision

**APPROVED — COMPLETE.**

Issue #20 is merged, verified on `main`, and may remain closed as completed. The broader Issue #15 roadmap remains open.