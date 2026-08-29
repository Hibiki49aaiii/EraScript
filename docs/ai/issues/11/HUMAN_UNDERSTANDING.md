# Issue #11 Human Understanding

## What

Issue #11 makes EraScript's npm dependency graph reproducible and turns the current high/critical audit warning summary into explicit, reviewable security evidence.

## Why

Core CI currently uses `npm install` without a committed lockfile. That means the same EraScript commit can resolve different transitive package versions over time. Core CI #406 also reported 67 audit findings, including 20 high and 3 critical.

For a Web3 execution/safety tool, reproducibility is part of correctness.

## How

EraScript will keep npm, generate a standard `package-lock.json`, switch deterministic Core CI to `npm ci`, capture `npm audit --json`, and classify each high/critical dependency path.

Only safe, evidence-backed upgrades are allowed. Zero audit findings is not pursued by force if it would require an unverified breaking SDK migration.

## Important Decisions

- Keep npm; do not migrate package managers.
- Use the Node 22 / npm 10 CI baseline for lockfile authority.
- Do not use `npm audit fix --force`.
- Treat RAILGUN/Solana/Sui/viem compatibility as stronger constraints than reducing an audit counter.
- Separate runtime risk from dev/test/upstream-only findings.

## Invariants

- no secrets or registry credentials,
- no chain safety semantics weakened,
- no runtime API change unless separately justified,
- `npm ci` must reproduce the accepted graph,
- all deterministic core tests remain green.

## Failure Modes

- lockfile cannot install cleanly,
- peer dependency conflicts become hard failures,
- a critical advisory has no compatible upstream fix,
- a direct dependency upgrade breaks SDK contracts.

These are recorded explicitly; they are not hidden by forced resolution.

## Change Impact

Primary impact is repository/CI dependency management. Runtime behavior should remain unchanged unless a separately justified dependency patch is required.
