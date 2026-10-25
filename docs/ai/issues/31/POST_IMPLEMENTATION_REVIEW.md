# Issue #31 — post-implementation review

Base Commit SHA: a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7

## Correctness / regression

Reviewed request lifetime before/after asynchronous signer and verifier calls, atomic process-local reservation before await, immutable private snapshots and exact signature/signer recovery. Tests cover success, compact signature, wrong key, mutation, recipient substitution, access-list injection, replay, expired/future/hash-mismatched input and a hung signer. Existing tests reused synthetic IDs across independent attempts; fixed fixtures while keeping explicit replay denial tests.

Reviewed CLI parse/error paths and project preflight. Existing config/source preservation, linked source/output, root escape, output collision, malformed JSON and conflicting flags have negative tests. Final review found invalid `--require` reached the verification-failure handler; corrected it to argument-error exit2 and added a valid-report/invalid-state regression. Windows tests resolve platform paths rather than forcing POSIX strings.

Reviewed finality hash/height agreement and stale evidence. Added a reorg-during-finalized-read case. Failed, wrong-chain or modified pre-broadcast reports now prevent observed rescue. Terminal positive recovery proof remains absent and is not claimed.

## Architecture / security

Reused viem crypto and existing report/state models. No new runtime dependencies. Bounded file-local secret resolution uses symbols to respect shadows; depth/work/string limits prevent constant expansion from creating unbounded analysis. This is not whole-program taint analysis or isolation. Timers do not cancel remote signing; in-process replay cannot protect separate processes. Policy semantic limits, observer provenance and actual custody remain #25/#26/#27 work.

CI uses immutable official action SHAs, read-only repository permissions, no persisted checkout credentials, lifecycle-disabled installs and a Windows/Linux Node22/24 matrix. Dependency evidence rejects transport/schema failures. Compatible lockfile fixes reduce root audit debt without forced SDK downgrades. Production audit: zero known advisories at local verification; root dev/test:86 (16low/32moderate/35high/3critical), not shipped as runtime dependencies.

## Maintainability / stale documents

Package allowlist, clean production-only build, independent installed-tarball checks, repeat-pack hash and SBOM support review. Added Japanese workflow, migration, rollback, security reporting and explicit publication blockers. Historical trust inventory is labelled and superseded by the current candidate delta. No claim that a local review substitutes for an independent security review. The approval commit is metadata-only so it can refer to a prior reviewed code SHA without self-reference.

## Verification record

Local Windows Node24.13.1: `npm run check` passed; core and forced-color runs passed251/251 before the last argument/reorg regression additions; installed-tarball smoke passed, including all4 exports, offline calldata example, CLI run/build/check/verify and denial of an unproved recovery requirement. Release-script regressions passed2/2. Final candidate results, exact SHA and cross-platform CI links are recorded in Issue #31/its PR after commit. No lint/formatter command exists. Read-only live network evidence is separate; no real keys, wallet operations, network writes or deployment were performed.

## Disposition

Approved for candidate review and reproducible local qualification only. Full production signing/recovery approval remains blocked in `release-status.json`. Keep #25/#26/#27 and overall roadmap #15 open; scoped #31 evidence must not be presented as completion of their positive proof/isolation requirements.
