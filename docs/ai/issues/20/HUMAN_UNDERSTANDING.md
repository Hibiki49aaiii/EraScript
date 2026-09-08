# Issue #20 Human Understanding

## What

Issue #20 fixes two release-quality defects independently revalidated against current `main` at `2bf73fe79eda59f9bef44ad821fe3cb9b21783cd`.

1. Project runtime/build tests inherit terminal color state into child Node/CLI processes. If a parent environment forces color, Node can ANSI-decorate primitive `console.log` values and stack output. The tests compare raw stdout/stderr strings, so environmental styling can create false failures.
2. The development TypeScript build intentionally emits both `src/**` and `test/**` under `dist/**`, while npm currently allowlists all of `dist`. After a real build, compiled tests therefore become publishable package files.

## Why

Both defects weaken release qualification rather than EraScript runtime semantics:

- a deterministic test must not pass or fail based on terminal styling state;
- a published package should contain only the supported runtime/declaration surface, not the repository's compiled test suite.

## How

### Test child environment

The affected test helpers will preserve the parent environment but explicitly override only:

```text
NO_COLOR=1
FORCE_COLOR=0
TERM=dumb
```

for spawned test children.

Production CLI/runtime behavior is untouched.

### Package boundary

The npm `files` allowlist will move from:

```text
dist
```

to:

```text
dist/src
```

The development build can continue emitting `dist/test` for `node:test`; npm simply will not package that subtree.

### Package smoke gate

A cross-platform Node script will pack the built package locally, inspect the tarball manifest, install it into a temporary project, and exercise the supported exports and CLI. This converts the packaging boundary from a one-time audit into a repeatable gate.

## Important Decisions

- Do not disable production color output globally.
- Do not create a second production TypeScript build graph merely to solve packaging; the npm allowlist is the smaller enforcement boundary for this Issue.
- Do not use a shell-only smoke script; use Node so Windows/Linux can run the same gate.
- Do not publish to npm or create a GitHub Release.

## Invariants

- Existing EraScript runtime behavior is unchanged.
- Existing package public entry points remain present.
- `dist/src/runtime-loader.js` must remain packaged because `era run` depends on it.
- `dist/test/**` must not be packaged.
- No new runtime dependency is introduced.

## Failure Modes

- Missing required package files: package smoke fails before completion.
- Accidental test packaging: package content gate fails.
- Color leakage from parent process: forced-color verification fails.
- Tarball-installed CLI cannot resolve runtime loader: package smoke fails.

## Change Impact

This is test/release hardening only. It does not change chain execution, signing, finality, verification semantics, live-network behavior, or dependency versions.
