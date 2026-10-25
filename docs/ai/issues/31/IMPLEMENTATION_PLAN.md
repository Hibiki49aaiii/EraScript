# Issue #31 — white-hat release qualification

Base Commit SHA: a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7
Branch: `issue-31-whitehat-release`

## Requirements and architecture

Reconcile PRs #23/#28/#29/#30; repair demonstrated input, signature, evidence and packaging defects; exercise installed CLI workflows on supported platforms. Compiler/runtime remain Node-compatible. Reports continue to distinguish integrity, claimed state and issuer authentication. Conditional chain evidence and unknown source trust cannot be upgraded by documentation.

Data flow: authorized researcher -> source/check/build -> trusted application policy -> external signing request -> immutable approved bytes -> signature verification -> independently configured provider evidence -> report -> explicit relying-party decision.

State transitions: stale/mismatched signing request -> reject before callback or result acceptance; request -> reserved once -> completed/failed (consumed until expiry); direct caller finality -> observed only; invalid rescue prerequisites -> NOT_READY. No generic terminal report constructor is exposed.

## Changes

- Existing pending PR histories incorporated into this branch.
- `src/chains/external-signer.ts`: request shape/hash validation, immutable snapshots, elapsed-time checks across async calls, bounded in-process replay protection.
- `src/web3/external-signer.ts`: immutable approved transaction/envelope snapshot, cryptographic EIP-712 signer verification, raw-transaction field parity.
- `src/cli.ts`: safe initialization and strict option/error behavior.
- `src/project-build.ts`: preflight source/output collisions, directory confinement and links.
- `src/web3/secret-analysis.ts`: bounded file-local symbol/alias resolution with lexical shadowing. This does not claim the separate whole-program analyzer workstream is complete.
- `src/web3/verification.ts`: reject failed/mismatched/tampered pre-broadcast reports before observed recovery.
- EVM observation/finality checks: inspect exact block identity and stale evidence risks; add fixes only with reproductions.
- Tests: negative boundary cases, Windows path handling and actual installed tarball CLI validation.
- Workflows/package/scripts: supported Node/OS gates, immutable official Actions references, least privilege, clean build and release dry-run artifacts.
- Documentation: white-hat workflow guide, security policy, release blockers/support matrix, migration and rollback; targeted `.ai` decision.

No database/migration. Pre-1.0 restrictions are documented. Additive clock/replay configuration must not be advertised as cross-process custody. Public report formats remain compatible.

## Decisions and alternatives

1. Reuse strict adapters and prior fail-closed design. Deleting families would unnecessarily break users; silently preserving false terminal claims is unacceptable.
2. Snapshot callback inputs and verify the result against that snapshot. TypeScript readonly alone is erased; freezing the caller's own object would introduce surprising mutation. Clone then freeze private copies.
3. Replay protection is bounded and atomic within one process; external authorities need durable storage and authorization. An in-process cache cannot prevent malicious same-process code signing independently.
4. Use current official immutable action commits and locked installations. Avoid arbitrary dependency overrides; report upstream live SDK debt separately from the shipped runtime.
5. Full isolated custody requires a deployment trust-boundary decision under #27. Prepare concrete alternatives and enforce truthful release gates; Node permission flags are not a malicious-code sandbox.

## Errors/security

Reject unknown CLI flags and conflicting verify modes. Never overwrite initializer targets; exclusive creation and rollback own partial files only. Avoid echoing malformed signature/raw payloads into diagnostics. Distinguish caller-injected clocks/verifiers from production trust roots. Do not make wallet/network writes.

## Verification and order

1. Review current source and previous branch changes, capture baseline failures.
2. Add focused regression tests for signing expiry/replay/mutation/invalid signature, CLI preservation and finality consistency.
3. Implement scoped fixes; typecheck and run focused tests.
4. Full core, forced color, installed package, production audit, release artifact checks.
5. Cross-platform CI and final post-review at exact candidate SHA; reconcile Issue/PR/roadmap evidence.

Rollback: revert #31 code changes via Git while retaining prior branches/history. Do not undo user changes or downgrade documented trust limitations. No package publication or production deployment in this work.

Known risks: upstream SDK advisories, unsupported token semantics, observer identity/independence, trust-store/revocation operations, actual host isolation and independent security review. The release gate must remain blocked for high-assurance recovery/signing while these required predicates are unproven.

## Implementation review amendments

Adopted after concrete findings: Windows path comparisons use resolved paths; CLI package test invokes npm's JS entry point instead of spawning `npm.cmd`; root compatible audit fixes preserve direct SDK pins; static analysis has depth/work/string limits and fails explicitly when truncated; publish approval refers to a preceding reviewed code commit and permits only the approval-metadata delta. These changes preserve Issue #31 scope. Old signer tests now use distinct requests for distinct attempts, while dedicated replay tests prove request reuse is rejected.
