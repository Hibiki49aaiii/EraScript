# Issue #14 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

## Pass 1 — Requirements

### Finding: Waku must not enter the published/root dependency graph

Disposition: adopted.

The package remains live-test-only under `test/live/waku-deps`.

### Finding: production audit and dev/test audit are different trust boundaries

Disposition: adopted.

Only the production `--omit=dev --audit-level=high` check is blocking. Dev/test and Waku findings are recorded separately.

## Pass 2 — Architecture

### Option A: add Waku as a root devDependency

Rejected.

This would install a large live-only network stack in every Core CI run and mix its supply-chain findings with the existing RAILGUN Wallet SDK compatibility graph.

### Option B: keep `npm install --no-save`

Rejected.

The direct version is pinned but its transitive graph is not reproducible.

### Option C: isolated package root + lockfile

Selected.

It gives npm-native transitive locking while preserving the root package boundary.

## Pass 3 — Risk

### Live package resolver

Use Node's own `createRequire(...).resolve()` from the isolated package root, then dynamic ESM import by file URL. Do not hand-construct package internals.

### Advisory baseline

Do not guess Waku audit severity before generating the lockfile and running npm audit. Record measured results first.

### Network safety

No transaction/proof/signature/bundle submission logic changes. The existing Waku smoke remains discovery/selection only and stops the client in `finally`.

### Secrets

No new secret or credential is created or modified.

## Decision

**APPROVED TO IMPLEMENT.**
