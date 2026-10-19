# Issue #22 — Implementation Plan: Verification Trust Model

- **Issue:** [#22](https://github.com/Hibiki49aaiii/EraScript/issues/22) (parent [#15](https://github.com/Hibiki49aaiii/EraScript/issues/15))
- **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7`
- **Target branch:** `issue-22-verification-trust-model` → `main`
- **Version context:** `erascript-lang@0.18.0`, Node.js >=20.6 / CI Node 22, TypeScript strict
- **Change class:** Documentation/specification only; no code, crypto, key handling, reports, API, CI, chain or runtime modifications.
- **Design status:** Issue-first plan; decisions reviewed separately in `PRE_IMPLEMENTATION_REVIEW.md`.

## 1. Requirements

Implement FR-01–FR-11 and acceptance criteria from Issue #22. Specify actors, assets, boundary crossings, independent trust predicates, family/path-specific state gates, threat TM-01–TM-14, evidence provenance, missing/faulty evidence handling, and a reproducible source-to-contract assurance/gap map. Never label a desired guarantee as already enforced.

## 2. Current architecture

- `src/chains/verification.ts`: multichain report constructor (internal to supported package API), hash creation and parsing; `src/web3/verification-io.ts` parses rescue reports.
- `src/verification-attestation.ts` / `src/cli.ts`: separate report integrity, claimed-state rank and detached Ed25519 attestation verification using a supplied trusted public key (#16).
- `src/chains/index.ts`: no public `createMultichainVerificationReport` export (#18).
- `src/chains/verification-adapters.ts`: direct family-specific adapters *and* strict Solana/Sui/Jito quorum adapters. EVM quorum promotion occurs through `src/chains/evm-execution-quorum.ts` and is not automatically required by the direct EVM adapter.
- `src/privacy/verification.ts`: RAILGUN direct and strict base-EVM-quorum paths.
- `src/web3/workflow.ts`, `src/web3/verification.ts`: rescue planning/post-state, caller-provided finality.
- `src/web3/analyze.ts` and Node `src/runtime-loader.ts`: syntactic diagnostics, conventional Node execution, not OS sandboxing.

**Code-observed gaps:** direct `markFinalized` trusts caller-owned transaction state; absent `expectedRecoveries` defaults to no destination delta invariant; `token-rescue` workflow metadata does not ABI-verify actual recipient; provider IDs do not attest operator independence. These are recorded, not fixed here.

## 3. Target architecture

A **documentation-only assurance contract**:

```text
Untrusted code / signer intent
  → policy boundary (conditional)
  → SDK / RPC / provider claims
  → family verifier / quorum / finality / post-state
  → report hash + claimed state
  → optional detached attestation
  → relying-party trust decision
```

Model trust as a vector, **not an ordered scalar**:
- I = self-contained report schema and hash consistency;
- C = asserted state meets requested rank;
- A = signed attestation authenticated against explicitly trusted key;
- E = provenance/identity/freshness of evidence independently corroborated;
- F = family-specific execution/finality/settlement proven within configured assumptions;
- P = application post-state/outcome proven, for recovery specifically safe address/token/amount evidence.

The `era verify` CLI currently exposes I, C and A, not an independently derived E/F/P proof. No runtime trust-value schema is added by this Issue.

## 4. Data flow, states and transitions

Document both state families without altering state machines:
- Rescue `NOT_READY → READY_FOR_BROADCAST → RECOVERY_OBSERVED → VERIFIED_RECOVERY`.
- Multichain `NOT_READY → READY_FOR_SUBMISSION → EXECUTION_OBSERVED → VERIFIED_FINALITY`.
- The transitions are **reported labels**; their evidentiary strength depends on which adapter and independent observations produced them.
- Submission hash/bundle ID/proof ID cannot be upgraded to execution/finality, nor can finality alone prove recipient credit/private state.
- EVM native finality and OP Stack/Arbitrum L1 settlement remain distinct; Jito and RAILGUN are overlays rather than consensus families.

## 5. Design decisions and tradeoffs

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A. Normative Markdown + assurance matrix + gap register | Compatible, reviewable, versionable, no runtime risk or dependencies | Enforcement requires later Issues; drift risk | **Selected** |
| B. New universal runtime TrustLevel/enum | Could unify programmatic output | Incorrectly collapses independent properties and family semantics; API/schema change | Rejected here |
| C. Central verifier/key registry | Potential centralized revocation and policy | New services, availability/security operations, secret/trust-root management | Deferred |

Avoid duplicating #16 attestations and #18 public API restrictions. Reuse their source behavior and existing attestation ADR.

## 6. Files changed and unchanged

**Proposed documentation changes:**
- new `docs/VERIFICATION_TRUST_MODEL.md`: normative contract, threat model and matrix;
- new `docs/ai/issues/22/IMPLEMENTATION_PLAN.md`;
- new `docs/ai/issues/22/PRE_IMPLEMENTATION_REVIEW.md`;
- new `docs/ai/issues/22/HUMAN_UNDERSTANDING.md`;
- `docs/ai/issues/22/POST_IMPLEMENTATION_REVIEW.md` after verification;
- small reference links in `README.md` and `docs/MULTICHAIN_ARCHITECTURE.md` if they can be added without changing semantics.

**Unchanged:** all `src/**`, `test/**`, `package*.json`, `.github/**`, manifests, key material and chain config.

## 7. API / storage / migration / errors

Public API: **no changes**. Report JSON/hashes/attestations: **no changes**. DB/migrations: **none**. CLI errors/exits: **unchanged**. Desired fail-closed rules are normative specification and must be tracked as *not implemented* where applicable. No new runtime diagnostics may be claimed.

## 8. Security and trust assumptions

Relying parties must distinguish issuer authenticity from source truth; identify operational trust root, independent providers and failure domains, bounded clock skew, report age and contextual identity; treat isolated optimistic JSON/self-attested RPC responses as potentially adversarial. Static analysis cannot confine arbitrary Node code. Do not add or manipulate secrets or sign real transactions.

## 9. Test/verification strategy

1. Static coverage check: FR-01..11; TM-01..14; all required families and states; code/test links; explicit status categories.
2. Manual read-only trace per code path against the SHA; annotate inferred tests as **future proposed tests**.
3. Review accuracy of CLI `integrity`, `stateRequirementMet`, `authenticated` semantics against actual `src/cli.ts`.
4. Record concrete negative-case fixtures + expected fail-closed behavior in the normative document; do not claim to have run those fixtures.
5. When source tree is accessible for execution, use `npm ci`, `npm run check`, `npm run test:core`, `npm run test:package`, `git diff --check`; record actual run evidence and distinguish remote prior CI from current PR CI.
6. Review GitHub PR changed-files list and confirm **docs-only**; compare to main.
7. Core CI config currently ignores `docs/**` and README-only changes, so this PR may have no new Core CI run. Do not call that a pass.

## 10. Implementation order

1. Fetch main HEAD and AGENTS.md, #15/#22, `.ai/index.md`, attestation ADR, package metadata, docs, relevant source and tests.
2. Create `issue-22-verification-trust-model` from exact base commit.
3. Publish this plan.
4. Conduct **three independent pre-implementation passes** (requirements, architecture, security/risk) and record adopted/rejected/deferred decisions.
5. Author normative trust document, matrix and 14-threat register.
6. Author human summary; link from the README and multichain architecture only if accurate.
7. Inspect GitHub diff, source/test references and check static completeness; run executable checks only when a runnable checkout is available.
8. Write post-implementation review using **actual observations**, open PR as draft if executable CI or human review remains unverified, and update Issue #22 without closing it or claiming CI success.

## 11. Rollback

Revert the docs-only commits/PR branch. No persisted chain state, secret/key change, ABI/API or data migration. Keep Issue findings and follow-up tasks for traceability.

## 12. Risks and mitigations

- **Overclaim:** tag each statement `CURRENT`, `CONDITIONAL`, `GAP`, or `OPERATIONS`.
- **Drift:** source paths and baseline SHA in every audit artifact; future security work must reconcile this contract.
- **Improper promotion of asserted state:** differentiate direct adapter and quorum-backed paths, plus operational provenance.
- **Misinterpretation of negative test plan:** label all proposed cases as unexecuted until tested.
- **No executable checkout or skipped CI:** be explicit in post-review/PR and do not mark test acceptance as passed.
- **Scope creep/security breaking changes:** follow-up Issues only, separate reviews.

## 13. Acceptance / evidence checklist

- [ ] All 11 FR and 14 TM items mapped to current implementation, evidence and residual ownership.
- [ ] State/chain-path matrix covers EVM, rollups, Solana, Jito, Sui, RAILGUN and rescue.
- [ ] Trust predicates stay independent; no misleading universal `VERIFIED` implication.
- [ ] Real source/test paths exist in main; gaps flagged without claiming exploit reproduction.
- [ ] Three-pass review and human summary published.
- [ ] No source/API/runtime/signing/network-write changes.
- [ ] Static/available executable verification outcomes recorded with honesty.
- [ ] Post-review documents residual risk; PR links #22 and #15.

## 14. Base revision and implementation contract

```text
Base Commit SHA: a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7
Target branch: issue-22-verification-trust-model
```

All final evidence must identify **which branch SHA** was actually reviewed. No assumption that baseline past CI runs are PR CI results.
