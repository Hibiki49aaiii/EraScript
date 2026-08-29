# Issue #11 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

Base Commit SHA: `88f5577d3d3babbd6be0e6f73c6d4db3d8f09cf8`

## Pass 1 — Requirements

### Finding 1: deterministic install must be independently testable

Disposition: **adopted**

Plan requires an authoritative lockfile plus `npm ci`, not merely pinning direct versions.

### Finding 2: "fix vulnerabilities" is too ambiguous

Disposition: **adopted**

Acceptance is based on enumerating and dispositioning every high/critical finding. Zero vulnerabilities is not mandatory when upstream-compatible fixes do not exist.

### Finding 3: audit evidence must be machine-readable

Disposition: **adopted**

Use `npm audit --json` for triage evidence, with a human summary committed separately.

## Pass 2 — Architecture

### Finding 1: do not introduce another package manager

Disposition: **adopted**

The repository already uses npm scripts and GitHub Actions npm installation. Standard `package-lock.json` + `npm ci` is the lowest-risk path.

### Finding 2: chain SDKs are compatibility boundaries

Disposition: **adopted**

Dependency remediation must not bypass package-level integration tests for `@solana/kit`, `@mysten/sui`, RAILGUN Wallet SDK, or viem-facing code.

### Finding 3: runtime source changes are not expected

Disposition: **adopted**

If audit remediation appears to require runtime-source edits, update the Issue/Plan before implementing that expansion.

## Pass 3 — Risk

### Finding 1: npm audit severity is not exploitability

Disposition: **adopted**

Each high/critical item will be classified by dependency path and EraScript reachability.

### Finding 2: blind force-fix can create a larger security regression

Disposition: **adopted**

`npm audit fix --force` is prohibited in this issue.

### Finding 3: lockfile toolchain version matters

Disposition: **adopted**

Generate against Node 22 / npm 10-compatible tooling, matching Core CI run #406 (`node 22.23.2`, `npm 10.9.8`).

### Finding 4: lifecycle scripts are a supply-chain surface

Disposition: **adopted**

Initial lockfile reconstruction should avoid unnecessary script execution. Final verification must still use the real `npm ci` path that CI will execute.

## Review Decision

The plan is consistent with repository architecture, narrows remediation to reversible evidence-backed changes, and preserves existing Web3 adapter safety boundaries.

**APPROVED TO IMPLEMENT.**
