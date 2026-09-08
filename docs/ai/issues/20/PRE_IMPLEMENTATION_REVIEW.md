# Issue #20 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

Base Commit SHA: `2bf73fe79eda59f9bef44ad821fe3cb9b21783cd`

Target branch: `issue-20-package-determinism`

## Pass 1 — Requirements Review

### Finding: the color failure is a test harness determinism defect, not a production CLI defect

Current project tests spawn child Node/CLI processes without an explicit `env`, so they inherit parent `FORCE_COLOR`/terminal settings. The same tests assert exact raw stdout strings and stack-path substrings.

Disposition: **adopted**.

Fix only spawned test children. Do not alter production CLI color behavior.

### Finding: packaging contamination is caused by the combination of build layout and npm allowlist

`tsconfig.json` intentionally includes both `src/**/*.ts` and `test/**/*.ts` under `outDir: "dist"`. `package.json` allowlists all of `dist`.

Disposition: **adopted**.

For this Issue, narrow the npm allowlist to `dist/src`. Do not split the TypeScript build unless evidence shows the allowlist cannot enforce the contract.

### Finding: a one-time `npm pack --dry-run` check is insufficient

The package boundary can regress later.

Disposition: **adopted**.

Add an executable package smoke/content gate to CI.

## Pass 2 — Architecture Review

### Option A: disable colors globally in Core CI

Rejected.

This would make one environment green without making the affected tests intrinsically deterministic. It would also hide the exact dependency on parent terminal state.

### Option B: strip ANSI escape sequences from all captured output

Rejected for this Issue.

The tests are intended to validate plain semantic CLI output and stack locations. Normalizing arbitrary ANSI after the fact broadens the test abstraction and can hide unintended colorization. Constraining the spawned test environment is simpler and more explicit.

### Option C: deterministic env only for spawned test children

Selected.

It preserves production behavior and makes the raw assertions stable.

### Package Option A: separate production and test tsconfig outputs

Viable but broader.

Advantages:
- cleaner production build tree.

Disadvantages:
- changes test/build orchestration,
- larger regression surface,
- not necessary to enforce npm package content.

Disposition: **deferred/out of scope**.

### Package Option B: npm `files` allowlist to `dist/src`

Selected.

It directly controls what npm publishes while preserving current development/test build behavior.

### Package smoke implementation: shell vs Node

Shell-only script rejected because Windows compatibility is part of the repository's real development environment.

Node standard-library script selected.

## Pass 3 — Risk Review

### Security

Narrowing package contents reduces accidental exposure of internal compiled tests. No secrets or runtime trust semantics change.

### Regression

Risk that `dist/src/runtime-loader.js`, declarations, CLI, or subpath exports are omitted is explicitly covered by tarball content and installed-package smoke tests.

### Platform behavior

Use `node:fs`, `node:path`, `node:os`, `node:child_process`, and JSON parsing only. Avoid POSIX shell assumptions.

### npm behavior

`npm pack --json` may produce version-dependent incidental metadata. Assert required/forbidden package paths and the generated tarball filename, not field ordering.

### Performance

A fresh tarball install adds CI time. Acceptable because this is a package/release-quality gate and is not part of every test case.

### Dependency/network risk

The smoke fixture may fetch declared runtime dependencies when installing the local tarball. Core CI already requires npm registry access for `npm ci`; this does not introduce a qualitatively new external dependency.

## Decision

**APPROVED TO IMPLEMENT.**

The proposed fix matches Issue #15's P1 package hardening workstream, keeps production behavior unchanged, and adds repeatable evidence for both reported defects.
