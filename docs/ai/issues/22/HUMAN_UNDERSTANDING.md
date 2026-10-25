# Issue #22 — Human Understanding: Verification Trust Model

**Issue:** [#22](https://github.com/Hibiki49aaiii/EraScript/issues/22) · **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Type:** Documentation only.

## What / 何を定義したか

The canonical [Verification Trust Model](../../../VERIFICATION_TRUST_MODEL.md) describes what EraScript verification results **do and do not guarantee** for EVM, rollups, Solana, Jito, Sui, RAILGUN and EVM asset rescue.

For independent claims, think **I, C, A, E, F, P**:
- **I (Integrity):** data is internally consistent with its own hash;
- **C (Claim):** state label meets the requested rank;
- **A (Authentication):** trusted public key validates a detached signature on that report;
- **E (Evidence):** external observations' origin, binding and freshness were adequately checked;
- **F (Finality):** the transaction reached the finality/settlement required by its particular chain or protocol;
- **P (Post-state):** the intended balance/recipient/private-state objective was actually reached.

A report can pass **I+C+A while E/F/P remain unknown**. A valid report signature is not a blockchain finality oracle.

## Why / なぜ必要か

Reports are easy to misread because the same `VERIFIED_FINALITY` label can be produced through a direct adapter with caller-supplied status or through a stricter provider quorum. The existing code is strong in many specific cases, but the source review identified high-impact boundaries that a report label alone obscures:

1. `src/web3/tx.ts`: exported `markFinalized` changes transaction state without itself obtaining an independently observed finalized head.
2. `src/web3/workflow.ts`: `expectedRecoveries` defaults to an empty array; victim balance zero does not necessarily prove transfer to the safe address.
3. `src/web3/workflow.ts`: outer token-contract `to` check does not decode actual ERC-20 transfer recipient/amount.
4. `src/web3/verification.ts`: `verifyCompletedRescue` accepts caller-provided `finality`.
5. `src/web3/analyze.ts` and normal Node runtime: syntax diagnostics and capability helpers are **not** a containment boundary for arbitrary imported code.

These are **static code-observed assurance gaps**, not proof of a live exploit.

## How / 処理の流れ

```text
AI/user code → optional analysis/policy → SDK/RPC/external signer
  → family evidence observation/quorum + finality + post-state
  → signed or unsigned report (I, claimed C)
  → detached issuer attestation (optional A)
  → relying party decides whether independent E/F/P policy was met
```

The verifier can inspect an unsigned report. `era verify --require ...` checks **claimed** state rank and `--attestation ... --trusted-key ...` checks a particular trusted issuer's signature; neither command refetches and proves the external chain evidence. Relying parties should never automatically infer recovered funds from those booleans alone.

## Important Decisions

- **No universal numeric trust level:** trust dimensions are not interchangeable and cannot safely be represented as one ordinal.
- **Reuse existing primitives:** no duplicate attestation path (#16), no reversal of the restricted public constructor (#18).
- **Direct path is not strict path:** a single-provider/caller-supplied adapter report and a multi-provider corroboration path have different assumptions.
- **Chain-family semantics are explicit:** EVM canonicality/finalized head, rollup L1 settlement, Solana commitment, exact Jito signature set, Sui checkpoint/effects and RAILGUN proof/private state have distinct proof burdens.
- **Documentation-only:** source/CLI/API/attestation schemas/hashes/diagnostics and execution security have not been changed.

## Invariants

- Submission ID or transaction hash is not proof of successful execution.
- Inclusion is not finalized settlement.
- Finalized base-chain execution alone does not prove shielded private state.
- Victim balance zero does not prove assets arrived at the safe address.
- Hash integrity does not authenticate the producer.
- Issuer signature does not authenticate the underlying external data.
- Nominally unique RPC provider IDs do not prove independent operators.
- Unknown/missing/stale/conflicting mandatory evidence must not be silently promoted to a stronger **high-assurance** decision.
- No secret values or private keys should enter public reports, docs, issues or logs.

## Failure Modes / Residual Risk

- Signed but false report; provider collusion; stale/reorged block; fabricated caller finality; incorrectly bound ERC-20 transfer; wrong or missing safe credit; stale signer response; Node/SDK bypass of static diagnostics; absent RAILGUN private-state proof; compromised attester key.
- Current strict verification adapters mitigate several cases **only when invoked with appropriate source and policy assumptions**.
- Offline attestation does not implement key revocation or consumed-nonce replay prevention; the operator/relying party must supply that policy.
- The issue's **TM-01–TM-14** table maps all 14 attacks to code, existing mitigations and follow-up ownership; its negative tests are **proposed, not executed** by writing documentation.

## Change Impact

Only documentation and its links are added. There is no version bump, package dependency, API contract, runtime code, transaction, signer action, secret manipulation or mainnet operation.

The specification is a prerequisite for separate security fixes under parent #15, notably rescue outcome correctness, finality evidence, signer isolation, static analyzer hardening and adversarial regression tests.

## Review and usage

Read [Implementation Plan](IMPLEMENTATION_PLAN.md) and [Pre-Implementation Review](PRE_IMPLEMENTATION_REVIEW.md) for the rationale and three independent review passes. The precise current/conditional/gap distinction is in [Verification Trust Model](../../../VERIFICATION_TRUST_MODEL.md). A later post-review records exactly what was published and verified. Never treat earlier Core CI runs as evidence of this documentation PR's own tests.
