# Issue #26 — IMPLEMENTATION_PLAN: Evidence-backed Finality

**Issue:** [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26) · Parent [#15](https://github.com/Hibiki49aaiii/EraScript/issues/15) · Trust model [#22](https://github.com/Hibiki49aaiii/EraScript/issues/22) / [Draft PR #23](https://github.com/Hibiki49aaiii/EraScript/pull/23) · Rescue integration [#25](https://github.com/Hibiki49aaiii/EraScript/issues/25) / [Draft PR #28](https://github.com/Hibiki49aaiii/EraScript/pull/28).

**Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · package `erascript-lang@0.18.0` · Node >=20.6 / Core CI Node 22 · TS strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
**Branch:** `issue-26-finality-evidence-design`.
**Current authorization:** Documentation and offline specification only; **NO code/security behavior changes**. See [three-pass pre-review](PRE_IMPLEMENTATION_REVIEW.md) and [decision gate](DECISIONS.md).

## 1. Requirements and target invariants

Derived from Issue #26, TM-04/05/10/13 and FR-04/05/06/07/09 of #22:

- R26-01: High-assurance terminal `VERIFIED_FINALITY` and `VERIFIED_RECOVERY` MUST depend on a verifier-generated finality decision with exact chain/profile/subject and source evidence, not merely `FinalizedTx.state`, `markFinalized`, a caller `"finalized"` string, or an artifact/report hash.
- R26-02: Native EVM finality MUST bind exact receipt transaction hash, chain ID, block number/hash, success status, canonicality, and a suitable finalized-head/confirmation policy; current EVM `requireFinalized` default false is insufficient on its own.
- R26-03: Rollups MUST distinguish L2 execution finality and protocol-specific L1 settlement; if `l1-finalized` is required, bind the exact L2 receipt to actual observed L1 anchor and approved protocol adapter.
- R26-04: Solana MUST verify signature/network/profile, successful execution, appropriate finalized commitment and optional explicit block identity. Jito MUST bind every expected signature and its finalized quorum; a landed bundle ID/status is insufficient.
- R26-05: Sui MUST bind exact digest/network/profile, effects success, checkpoint membership and any effects-identity policy; checkpoint metadata alone is insufficient for independent source authenticity.
- R26-06: RAILGUN MUST require finalized base-chain outcome **AND** separate correct proof/private-state claim; this issue owns F only, not the privacy outcome P.
- R26-07: Report I/C/A (integrity, claimed threshold, authenticated issuer) are independent from observed E/F/P; preserve v0.18 report parsing and detached signature unless a separately authorized schema version change occurs.
- R26-08: Missing, malformed, stale, replayed, contradictory or untrusted provider evidence MUST fail closed for a high-assurance terminal decision, with deterministic error/observed downgrade rather than forged certainty.
- R26-09: #25 MUST be able to consume a narrowly scoped **EVM finality decision**, associated with an exact transaction and canonical block, without reconstructing independent consensus logic from a bool/string.
- R26-10: All existing direct/strict adapter paths, public barrels and serializer consumers must be inventoried; no security-relevant path may retain an indistinguishable unsupported terminal claim after eventual migration.

## 2. Re-audited source baseline

| Code path | Current observed behavior and limitation |
|---|---|
| `src/web3/tx.ts::markFinalized` | Exported helper sets `state:"finalized"` on `ConfirmedTx`; it does not perform a chain query. `markConfirmed` accepts caller-provided count. |
| `src/chains/verification-adapters.ts::evmExecutionVerificationReport` | Nonrollup direct path promotes `VERIFIED_FINALITY` from successful receipt + `transaction.state === "finalized"`; the receipt and state are typed caller inputs. Rollup direct route relies on exact L2 binding plus a reported `l1-finalized` settlement. |
| `src/chains/evm-execution-quorum.ts::buildEvmExecutionQuorum` | Default `minimumProviders=2`, `minimumConfirmations=1`, **`requireFinalized=false`**. When `requireFinalized=true`, each observation must have a finalized-head at/beyond receipt block. Quorum hash/brand is an *in-process integrity control*, **not independent RPC provenance or unforgeable authority**. |
| `src/chains/evm-execution-quorum.ts::promoteEvmExecutionWithQuorum` | Converts quorum-backed execution to included/confirmed/finalized typed Tx. A quorum may represent differing stages; `state === "quorum-finalized"` is only meaningful under observation/source assumptions. |
| `src/chains/rollup-finality.ts` | `observeRollupSettlement` binds L2 receipt and checks presence/shape of L1 anchor for relevant stages; adapter `observe()` is an external trust boundary. `assertRollupL1Finalized` checks a **supplied stage/anchor**, not L1 consensus by itself. |
| `src/chains/{op-stack-finality,arbitrum-finality}.ts` | Protocol-specific adapters exist; must preserve protocol-specific L1 reference and observer trust, not infer from generic L2 confirmation. |
| `src/chains/solana-execution-quorum.ts` | Stage `observed/finalized`, strict execution/status/provider consistency; `requireBlockIdentity` defaults false; `minimumCommitment` is configurable. |
| `src/chains/verification-adapters.ts::jitoBundleVerificationReportWithSolanaQuorum` | Stronger path requires submitted expectedSignature list exactly matches observed bundle and finalized Solana quorum for **each** expected signature. Direct Jito report uses supplied backend status. |
| `src/chains/sui-execution-quorum.ts` | Stage `observed/checkpointed`; `requireEffectsIdentity` defaults false; inspect checkpoint/effects identity policy before promising effects-byte agreement. Direct Sui report accepts a checkpoint evidence input. |
| `src/privacy/verification.ts` | Direct RAILGUN and stricter base-EVM-quorum route coexist; private-state proof/assertions are a separate trust predicate. |
| `src/web3/verification.ts::verifyCompletedRescue` | Takes caller `finality` enum and promotes to `VERIFIED_RECOVERY` when post-state invariants pass; #25 owns safe-credit and action semantics, #26 owns F evidence. |
| `src/chains/verification.ts`, `src/verification-attestation.ts`, `src/cli.ts` | Deterministic report hash/state-rank and detached attestation are self-contained I/C/A, not independent chain truth. |

All findings are **source-observed**, not evidence of an actually exploited vulnerability. No new tests executed by this planning document.

## 3. Target architecture and Issue #25 interface

**Selected direction for planning:** a trusted *verifier-led*, family-specific validation step produces a bounded decision; a downstream consumer cannot establish high-assurance terminal status by passing a boolean, string or self-authored report. The exact exported TypeScript API and migration remains **pending material decision**.

```text
Supplied tx hash/status/report JSON (UNTRUSTED)
                   |
           Verified provider binding
                   |
     Chain-specific observation / quorum
       | missing/stale/conflicting -> FAIL CLOSED
       | exact profile/network/subject/block
       v
     Family finality checker (F)
       | EVM: canonical successful receipt + finalized-head policy
       | Rollup: above L2 + required verifiable L1 settlement
       | Solana/Jito: finalized signature set, applicable block identity
       | Sui: successful effects and verified checkpoint
       v
  Authorized finality decision scoped to exact subject, evidence hashes,
  provider/source assumptions, block identity, freshness, policy/profile.
                   |
       +-----------+------------------+
       |                              |
  Multichain terminal report       Issue #25 rescue workflow
       |                              |
  VERIFIED_FINALITY only if F       F + separately validated safe-credit P
       |                              |
  Report I/C/A remain separate     VERIFIED_RECOVERY if F AND P
```

**Proposed non-public conceptual interface** (not a shipped API, no compiler claim):

```ts
type VerifiedEvmFinalityDecision = {
  readonly scope: "evm-l1" | "evm-l2-with-l1-settlement";
  readonly chainId: number;
  readonly profileId: string;
  readonly transactionHash: string;
  readonly receiptBlockNumber: bigint;
  readonly receiptBlockHash: string;
  readonly sourceQuorumHash: string;
  readonly settlementEvidenceHash?: string; // required for settlement scope
  readonly observedAtMs: number;
  readonly policyId: string;
};
// IMPORTANT: a plain object with these fields DOES NOT establish authority.
// Authorized verifier provenance and exact evidence integrity checks are essential.
```

**Provenance decision:** Do not implement "security" by exporting a forgeable interface or a structural `unique symbol` brand alone. Future code must either (A) keep finality decision construction within a trust-enforced verifier closure that validates observations at use time; or (B) accept an externally trusted attestation with authenticated verifier, replay/freshness policy and underlying evidence proof. A report-hash/brand without authorized verifier provenance is **not sufficient**. These are materially different operational models and need explicit decision before implementation.

**Compatibility:** retain current internal typed transaction lifecycle as advisory/process structure where safe, but ensure every **public terminal assurance** requires F. Avoid adding a universal cross-family trust enum. If existing APIs remain for compatibility, their former unproven `VERIFIED_*` returns must be safely downgraded or renamed; do not leave an indistinguishable unsafe terminal route.

**Issue #25 contract:** new finality verifier takes the exact EVM transaction/profile and selected evidence policy; returns F only after validating the transaction hash, canonical receipt block, required finalized-head/settlement and observation freshness. Issue #25 combines that F with recipient/token/amount, receipt/effect and safe-wallet post-state P. It MUST NOT infer P from F; it MUST NOT create an independent finality implementation.

## 4. Alternatives and tradeoffs

| Strategy | Security | Compatibility | Maintenance | Status |
|---|---|---|---|---|
| A. Restrict existing terminal adapter/promoter APIs to invoke trusted family verifiers (or safely downgrade legacy) | Best default fail-closed path | Breaking changes for caller-supplied `FinalizedTx`/status consumers | One terminal assurance policy but cross-family migration | **Preferred target**, not yet authorized |
| B. Add strict verifier-backed terminal API while existing public direct routes are downgraded to `EXECUTION_OBSERVED` | Clear migration path if old states are downgraded | Less abrupt API transition; semantic return changes remain | Two paths, careful labels and tests | **Viable alternative**, needs approval |
| C. Add a generic serialized proof token/hash or TS-only brand and trust it at report boundary | Superficially easy | Easy | **Unsafe:** locally forged structure has no external provenance | **Rejected** |
| D. Docs/warnings only or add strict API without closing existing unproven terminal path | No regression | Maximum | Preserves exploit-prone assurance confusion | **Rejected** |

**Material decision gate:** Select A or B, verifier trust boundary (same process vs isolated/trusted service), caller/migration policy and exact family scope before changing security-critical behavior. #25 may use no provisional arbitrary F token in the meantime.

## 5. Data validation, error handling and state transitions

1. `missing/unavailable` evidence → `NOT_READY` or `EXECUTION_OBSERVED` only when actual successful inclusion was verified; never terminal.
2. `receipt.status="reverted"` → fail the execution requirement; never `VERIFIED_FINALITY`.
3. `confirmed` quorum without required finalized-head observations → nonterminal.
4. Native EVM finality proof bound to a different transaction hash, block number/hash or profile → deterministic failure, not reusable evidence.
5. Rollup finality missing matching L1 finalized anchor → nonterminal even if L2 is finalized.
6. Solana finalized commitment without signature/slot/network/profile quorum → no strict terminal; Jito missing any expected finalized signature → no strict terminal.
7. Sui checkpoint without successful matching effects and digest → fail; optional effects-digest strictness must be declared in policy.
8. RAILGUN base-chain F does not satisfy private-state P.
9. `reportHash`, `quorumHash`, `providerId` metadata and signer attestation are not objective proofs. They may support audit integrity and source policy when independently checked.

Existing diagnostics `ES343x`, `ES459x`, `ES464x`, `ES476x`, `ES478x`, `ES480x` remain source examples. New diagnostic codes must be allocated after checking collisions during implementation, not invented here.

## 6. Planned source/test impact (not changed by this branch)

- EVM/rollups: `src/web3/tx.ts`, `src/chains/evm-execution-quorum.ts`, `src/chains/verification-adapters.ts`, `src/chains/{rollup-finality,op-stack-finality,arbitrum-finality}.ts` as required.
- Solana/Jito/Sui: `src/chains/{solana-execution-quorum,sui-execution-quorum,jito}.ts`, strict/direct verification adapters.
- RAILGUN: `src/privacy/verification.ts`, respecting private outcome proof.
- Rescue cross-Issue: `src/web3/verification.ts` using Issue #25's post-state claims only after agreed F contract.
- Public API: `src/chains/index.ts` and root `src/index.ts` only after approved export/migration policy; preserve existing report/attestation schema unless separately reviewed.
- Tests (future): `test/{evm-execution-quorum,solana-execution-quorum,sui-execution-quorum,multichain-verification,multichain-finality-private-state,railgun-quorum-verification,web3-verification,rollup-provider-fixtures}.test.ts`; add focused test file if justified.
- Docs in this PR: `docs/ai/issues/26/{IMPLEMENTATION_PLAN,PRE_IMPLEMENTATION_REVIEW,HUMAN_UNDERSTANDING,DECISIONS,TEST_MATRIX}.md`.

No DB, migration scripts, workflow, dependencies, live signing, chain configuration or non-test transaction operations in this design stage.

## 7. Verification, rollback and order

1. Source code, AGENTS, Issue #26, #25, #22 and existing tests audited against base commit.
2. Publish a three-pass pre-implementation review; compare A/B/C/D options and residual risks.
3. Specify exact cross-Issue F/P seam and family-specific negative cases (see `TEST_MATRIX.md`).
4. **Gate:** obtain documented maintainer decision for security-critical interface/migration and trust-root architecture, ideally coordinate #25 and #26 decisions together.
5. Only then implement minimal scoped runtime changes and add offline negative tests; no real keys/signatures/transactions or production writes.
6. Execute `npm ci`, `npm run check`, focused `node:test` fixtures, `npm run test:core` (normal + FORCE_COLOR), `npm run test:package`, `git diff --check`; record actual head SHA, logs and failures. GitHub Actions docs-only PRs may skip CI; do not substitute old historical run as proof of implementation.
7. Independently review correctness, regression, architecture, security, maintainability and stale docs; post-review after actual code work.
8. Keep #26 open until actual implementation, tests, independent review and Issue completion.

**Rollback now:** revert only documentation commits. **Rollback of future code:** separately reviewed PR revert/migration with no return to unsupported terminal safety claims.

## 8. Residual risk

- Provider IDs and hashes are not independent operator certification or externally authenticated observations.
- Byzantine RPC, timestamp skew, replay, reorg and rollup protocol differences remain governed by explicitly trusted verifier/protocol evidence.
- Breaking changes to terminal API, in-process forged evidence, old callers relying on `VERIFIED_*`, and cross-Issue provenance collisions.
- Protected signer/private key isolation belongs to #27; this design must not pretend to solve it.
- A signed report remains an attested **assertion** without independent F/P checks.

**Status: Design only; no security-critical behavior implemented or tests executed for Issue #26.**
