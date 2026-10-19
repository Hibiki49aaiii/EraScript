# Issue #26 — PRE_IMPLEMENTATION_REVIEW

**Issue:** [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26) · **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Review kind:** proposed design, not runtime qualification.

This file records three distinct AGENTS.md review passes before any behavior changes. "Adopted" means **included in the design requirement**, not implemented in the current v0.18 runtime.

## Pass 1 — Requirements against acceptance criteria

| Finding | Source / requirement | Disposition |
|---|---|---|
| Caller-provided finalized states are not objective finality proof | `markFinalized` in `src/web3/tx.ts`; direct EVM adapter checks only state + receipt | **ADOPTED:** reject high-assurance terminal promotion without verifier-led observed proof |
| Existing strict quorum exists but finality is a policy choice | `buildEvmExecutionQuorum` default `requireFinalized=false`; stage can be included/confirmed | **ADOPTED:** require explicit finalized-head policy for F proof |
| Rollup L1 settlement is distinct from L2 execution | `rollup-finality.ts` requires supplied adapter stage and matching L2 block | **ADOPTED:** exact L2/L1 source binding and stage provenance; mere `l1-finalized` string insufficient |
| Family contracts differ | Solana finalized signature, Jito complete signature set, Sui checkpoint/effects | **ADOPTED:** family-specific rule and exact subject/policy matrix |
| RAILGUN outcome uses an overlay | `src/privacy/verification.ts` combines base EVM and private assertions | **ADOPTED:** F proof never implies private P |
| EVM rescue #25 requires F only | `verifyCompletedRescue` accepts string; #25 defines safe-credit P | **ADOPTED:** shared EVM F evidence seam, without a duplicate finality engine |
| Report hash and attestation are separate | `src/chains/verification.ts`; attestation ADR (#16) and #22 | **ADOPTED:** preserve I/C/A CLI and serialized hash while making future terminal report policy sound |
| Security changes alter API and test fixtures | Current direct adapters publicly exported, tests assert terminal states from synthetic fixtures | **ADOPTED:** migration and negative-case inventory; no silent breaking changes |

**Pass 1:** Requirements are complete for a **design contract**, not satisfied by existing runtime behavior. Do not check off Issue #26 acceptance criteria until implementation and actual tests pass.

## Pass 2 — Architecture and realistic alternatives

**A. Verifier-led terminal gate in existing adapter functions.** Existing exported functions either derive F from a verifier with chain observations or produce a downgraded report. **Pros:** one canonical safety meaning for `VERIFIED_FINALITY`, no opt-in weakness. **Cons:** breaking parameters/semantics and many test/consumer changes. **Preferred security target, needs explicit approval**.

**B. Introduce a strict verification API; downgrade legacy direct API's terminal outputs to observed/not-ready.** **Pros:** safer migration; some existing callable shapes remain. **Cons:** dual paths and potential confusion, semantic behavior changes. **Viable security alternative, needs explicit approval**.

**C. Accept a serialized `VerifiedFinalityProof` object containing hash, brand or provider IDs.** **REJECTED** as a sufficient trust boundary: caller-originated structured data and self-recomputed hashes do not establish source provenance. Any actual proof format would require verifier authentication and replay/freshness/evidence integrity rules.

**D. Keep old terminal behavior and offer documentation warning.** **REJECTED**: continues unsafe high-assurance labeling under exposed direct functions.

**E. Trusted external verifier service.** **DEFERRED** pending operational trust-root and availability/cost/secret lifecycle analysis (#27). A same-process verifier can only provide conditional protection from caller-provided data if authority and data provenance are genuinely constrained.

**Architecture boundaries reviewed:**
- `src/chains/evm-execution-quorum.ts` exposes observation+quorum and promotion. Reuse checks; do not create duplicate L1 finality implementation for rescue.
- `src/chains/verification-adapters.ts` has both direct and strict adapter paths; reject security claims implied merely by a report label.
- `src/chains/rollup-finality.ts` adapter is trusted input, not independently source-authenticated by a matching `evidenceHash`.
- `solana-execution-quorum.ts` optional block identity and `sui-execution-quorum.ts` optional effects identity are policy-dependent; no blanket identity guarantee.
- Jito strict `expectedSignatures` guard is already implemented, should be retained and not duplicated.
- `railgunVerificationReportWithEvmQuorum` needs both finalized base-chain quorum and private-state evidence; do not replace with base EVM F alone.

**Pass 2:** Selected **design direction** is family-specific verifier-led F; A vs B and authority/isolation model remain open because materially different security/compatibility choices exist.

## Pass 3 — Security, regression and maintenance risks

| Risk | Scenario | Status and mitigation |
|---|---|---|
| R26-01 Caller state spoofing | Synthetic `ConfirmedTx` promoted through `markFinalized` then direct adapter | **ADOPTED:** eliminate direct terminal trust in caller state; negative test |
| R26-02 Unauthenticated "proof" | Caller constructs structural proof, quorum hash or brand-like object | **ADOPTED:** verifier-side observations/authority, not proof-shape-only trust |
| R26-03 Default EVM policy | `minimumProviders=2` but `requireFinalized=false` | **ADOPTED:** explicit finality policy and head comparison for F |
| R26-04 RPC collusion | Distinct provider IDs share operator or corrupted upstream | **ADOPTED:** operator diversity as explicit operational assumption; do not claim independence |
| R26-05 Reorg or stale block | Canonical hash diverges or data age exceeds policy | **ADOPTED:** nonterminal/error and replay/freshness tests |
| R26-06 Rollup L2/L1 confusion | L2 confirmed, no matching verified L1 anchor | **ADOPTED:** protocol/chain/finality-scope binding |
| R26-07 Incorrect rollup proof stage | `l1-finalized` in caller structure without confirmed adapter provenance | **ADOPTED:** trust verifier, not stage string |
| R26-08 Solana commitment ambiguity | `finalized` from one supplied RPC/status, wrong slot or expired lifetime | **ADOPTED:** strict family source and lifetime tests |
| R26-09 Jito partial success | Bundle ID landed but expected signature missing or failed | **ADOPTED:** preserve all signatures' strict quorums |
| R26-10 Sui checkpoint mismatch | Checkpoint exists but digest/effects conflict | **ADOPTED:** explicit checkpoint/effects policy and negative cases |
| R26-11 RAILGUN base-only success | Base tx finalized but private-state assertion false | **ADOPTED:** separate F from privacy P |
| R26-12 Rescue P/F confusion | Safe balance credit checked but F is a caller string | **ADOPTED:** Issue #25 consumes #26 EVM-F verifier result and separately proves P |
| R26-13 API consumers silently regress | Old callers expect terminal outputs from synthetic fixtures | **ADOPTED:** compatibility ledger; no unversioned silent trust meaning change |
| R26-14 Secret/payload disclosure | Evidence logging leaks RPC credentials, raw private data | **ADOPTED:** redact and test with inert canaries |
| R26-15 CI proof overstatement | Docs-only PR skips Core CI, prior test run does not cover new code | **ADOPTED:** actual SHA/run evidence required for runtime PR |

Threat severity: potentially high consequence for assets, **but this review is not proof of an exploit or a security certification**.

### Classification and deferrals

- **ADOPTED:** exact tx/profile/block evidence binding, fail-closed family-specific checks, migration, reuse of chain adapters/quorum and #25 interface.
- **REJECTED:** warning-only remediation; branded/hashed forged object as the sole authority; unchanged legacy terminal routes alongside indistinguishable "strict" status.
- **DEFERRED:** key custody and signer isolation (#27), external trust registry, operating independent provider fleet, RAILGUN private proof semantics outside F, full chain SDK API integration changes until package primary docs and tests reviewed.
- **OUT OF SCOPE:** signing, secrets/credentials, transactions, production deployment, data destruction, live-chain writes, unrelated dependencies.

## Pre-implementation decision

**PASS for design documentation. NOT APPROVED for security-critical implementation.** The human maintainer must decide A/B, verifier authority, versioning and how to combine F with #25 P. The Issue remains Open until implementation+actual CI+independent security review, with new test cases defined in `TEST_MATRIX.md`.
