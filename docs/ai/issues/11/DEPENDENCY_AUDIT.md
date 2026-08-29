# Issue #11 Dependency Audit

Status: **TRIAGED — production graph clean at high/critical threshold; residual findings isolated to dev/test RAILGUN SDK graph**

Base Commit SHA: `88f5577d3d3babbd6be0e6f73c6d4db3d8f09cf8`

Lockfile commit: `8c3d219b0efb602b16f0227a2273baecc0a8aef8`

## Evidence

Dependency-capture runs used Node `22.23.2` / npm `10.9.8`.

Full install/audit baseline:

```text
npm install --package-lock-only --ignore-scripts: PASS
npm ci: PASS
npm run check: PASS
npm run test:core: PASS
tests: 206
pass: 206
fail: 0

npm audit (authoritative lockfile):
67 vulnerabilities
16 low
34 moderate
14 high
3 critical
```

Production dependency boundary:

```text
npm audit --omit=dev --audit-level=high
found 0 vulnerabilities
exit status: 0
```

Production-audit workflow run:

- run ID: `33258074119`
- conclusion: `success`

The authoritative lockfile is npm lockfile v3 and contains 1005 package entries. The RAILGUN Wallet SDK and every high/critical package node identified below are marked `dev: true`.

## Runtime reachability boundary

EraScript production dependencies are:

- `typescript`
- `viem`

The real RAILGUN Wallet SDK is intentionally a `devDependency` used to prove package-level compatibility. EraScript runtime source uses a structural adapter and does **not** import `@railgun-community/wallet` directly.

Direct imports of the real Wallet SDK are limited to integration/live test code, including:

- `test/railgun-sdk-real-integration.test.ts`
- `test/live/railgun-waku.live.ts`

Therefore the findings below are:

- **not installed as dependencies of the published EraScript package for normal consumers**, and
- **reachable in maintainer/dev/test environments when the RAILGUN compatibility SDK graph is installed or exercised**.

This is a real development supply-chain risk, but it is not a high/critical vulnerability in EraScript's production dependency graph.

## High/Critical package-node triage

On the authoritative lockfile, npm reports 14 high + 3 critical package-level findings. The audit exposes 17 high/critical package entries in total. A package entry may aggregate multiple underlying advisories.

| Package / resolved version | Severity | Representative dependency path from EraScript root | Disposition |
| --- | --- | --- | --- |
| `@railgun-community/wallet@10.9.0` | high | root (dev) -> Wallet SDK | dev/test-only direct dependency; upstream-owned aggregate finding |
| `axios@1.7.2` | high | root -> Wallet SDK -> axios | dev/test-only; exact version is pinned by Wallet SDK 10.9.0 |
| `@graphql-mesh/graphql@0.34.17` | high | root -> Wallet SDK -> GraphQL Mesh graphql | dev/test-only; upstream Wallet SDK dependency |
| `@graphql-mesh/utils@0.43.23` | high | root -> Wallet SDK -> GraphQL Mesh utils | dev/test-only; upstream Wallet SDK/GraphQL Mesh dependency |
| `@graphql-tools/url-loader@7.17.18` | high | root -> Wallet SDK -> GraphQL Mesh graphql -> url-loader | dev/test-only; transitive upstream |
| `@graphql-tools/executor-graphql-ws@0.0.14` | high | root -> Wallet SDK -> GraphQL Mesh graphql -> url-loader -> executor-graphql-ws | dev/test-only; transitive upstream |
| `@graphql-tools/executor-legacy-ws@0.0.11` | high | root -> Wallet SDK -> GraphQL Mesh graphql -> url-loader -> executor-legacy-ws | dev/test-only; transitive upstream |
| `dset@3.1.2` | high | root -> Wallet SDK -> merger-bare -> merger-stitching -> GraphQL Tools -> dset | dev/test-only; transitive upstream |
| `js-yaml@4.1.0` | high | root -> Wallet SDK -> GraphQL Mesh utils -> js-yaml | dev/test-only; transitive upstream |
| `ws@8.13.0 / 8.17.1` | high | root -> Wallet SDK -> GraphQL executor -> ws; root -> Wallet SDK/engine -> ethers -> ws | dev/test-only; multiple transitive upstream paths |
| `web3@1.10.4` | high | root -> Wallet SDK -> engine -> circomlibjs -> web3 | dev/test-only; legacy web3 chain owned upstream |
| `web3-bzz@1.10.4` | high | root -> Wallet SDK -> engine -> circomlibjs -> web3 -> web3-bzz | dev/test-only; legacy web3 chain |
| `swarm-js@0.1.42` | high | root -> Wallet SDK -> engine -> circomlibjs -> web3 -> web3-bzz -> swarm-js | dev/test-only; deprecated/legacy transitive chain |
| `eth-lib@0.1.29 / 0.2.8` | high | root -> Wallet SDK -> engine -> circomlibjs -> web3 -> web3-bzz -> swarm-js -> eth-lib | dev/test-only; legacy web3 chain |
| `form-data@2.3.3` | **critical** | root -> Wallet SDK -> engine -> circomlibjs -> web3 -> web3-bzz -> swarm-js -> eth-lib -> servify -> request -> form-data | dev/test-only; `request` legacy subtree |
| `request@2.88.2` | **critical** | root -> Wallet SDK -> engine -> circomlibjs -> web3 -> web3-bzz -> swarm-js -> eth-lib -> servify -> request | dev/test-only; deprecated upstream package |
| `tar@4.4.19` | **critical** | root -> Wallet SDK -> engine -> circomlibjs -> web3 -> web3-bzz -> swarm-js -> tar | dev/test-only; deprecated upstream package |

## Upstream verification

As checked during Issue #11, the official `Railgun-Community/wallet` repository's current `main/package.json` still reports:

```text
version: 10.9.0
@graphql-mesh/graphql: ^0.34.16
@graphql-mesh/merger-bare: ^0.96.0
@graphql-mesh/types: ^0.91.14
@graphql-mesh/utils: ^0.43.22
axios: 1.7.2
ethers: 6.14.3
@railgun-community/engine: ^9.6.0
```

The official `Railgun-Community/engine` current main remains version `9.6.0` and still depends on `@railgun-community/circomlibjs@0.0.8`, which is the path that introduces legacy `web3@1.10.4` and its BZZ/Swarm subtree.

There is therefore no newer official Wallet SDK release in the current upstream main manifest that EraScript can simply adopt to eliminate these findings.

## Remediation decisions

### 1. Commit npm lockfile — ADOPTED

The exact dependency graph is now pinned by `package-lock.json`.

Why:
- prevents silent transitive drift,
- gives reproducible audit evidence,
- makes future upstream changes explicit in diffs.

### 2. Core CI `npm install` -> `npm ci` — ADOPTED

The lockfile is now the installation authority.

### 3. `npm audit fix --force` — REJECTED

npm suggests changes that can cross package compatibility boundaries. For the aggregate Wallet SDK finding, npm reports a fix involving `@railgun-community/wallet@10.0.5`, which would be a downgrade from the repository's verified 10.9.0 integration and is not an evidence-backed security migration.

### 4. Root-level `overrides` for axios/GraphQL/ws/tar/request — REJECTED FOR ISSUE #11

The Wallet SDK current upstream manifest intentionally fixes or constrains several of these dependency families and the install already exposes GraphQL Mesh peer-resolution conflicts. Forcing unrelated major/transitive versions from EraScript would create an unverified SDK runtime contract.

An override is only acceptable after upstream compatibility or dedicated integration evidence proves it safe.

### 5. Remove RAILGUN package-level compatibility test — REJECTED

The real SDK integration test is valuable evidence that EraScript's structural adapter remains compatible with the supported Wallet SDK.

Removing the test would reduce assurance merely to make an audit counter smaller.

## Residual risk

Residual high/critical findings remain in the dev/test dependency graph under `@railgun-community/wallet@10.9.0`.

Controls now in place:

- exact lockfile pinning,
- deterministic `npm ci`,
- explicit dependency-path evidence,
- production high/critical boundary independently verified clean,
- no blind forced upgrades,
- real Wallet SDK compatibility remains regression-tested.

Future remediation should occur when RAILGUN upstream updates the affected dependency graph, or in a separately reviewed change that isolates/overrides that graph with complete SDK compatibility evidence.

## Decision

**Issue #11 may proceed without changing direct package versions.**

The safe remediation for this issue is reproducibility + explicit risk ownership. The current evidence does not justify replacing or overriding RAILGUN's upstream dependency graph.
