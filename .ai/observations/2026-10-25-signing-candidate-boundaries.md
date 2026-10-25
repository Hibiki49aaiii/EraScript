---
type: observation
status: candidate
date: 2026-10-25
issue: 31
keywords: [signer, TTL, replay, immutable, package, Windows, audit]
---

# Signing callback boundaries and candidate verification

Evidence: `test/signer-boundaries.test.ts`, `test/cli-safety.test.ts`, `test/evm-execution-quorum.test.ts`, `scripts/package-smoke.mjs`, Issue #31 current verification record.

Async signature handling needs actual deadline checks after signer and verifier awaits, private snapshots before awaits, cryptographic verification of exact digest/signer and reservation before calling an authority. A claimed response time or well-shaped signature alone is insufficient. Process-local replay state and timeout cancellation do not establish remote custody or durable consumption.

On Windows, spawn npm's JS entry point through `process.execPath` using `npm_execpath`; direct `npm.cmd` spawning without a shell failed. Installed artifact checks must execute the packed CLI away from the checkout, not infer usability from TypeScript compilation.

Audit JSON needs complete validated counts: network/schema failure must not be substituted with an empty object. Keep production runtime audit distinct from dev/live SDK evidence. These observations are limited to the reviewed candidate and tests; revalidate against current code and exact CI before reuse. No full isolation/finality/recovery assurance is implied.
