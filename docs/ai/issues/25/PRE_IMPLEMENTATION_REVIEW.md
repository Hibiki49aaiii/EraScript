# Issue #25 — PRE_IMPLEMENTATION_REVIEW

**Baseline:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Issue:** [#25](https://github.com/Hibiki49aaiii/EraScript/issues/25) · **Scope:** design-stage documents only.
**Status:** Three-pass review of proposed design; approval to **document**, not to change security-critical runtime behavior or API contracts.

## Pass 1 — Requirements and acceptance review

| Item | Evidence / question | Disposition |
|---|---|---|
| Victim zero is not safe-credit | `src/web3/workflow.ts` has optional `expectedRecoveries ?? []` and only adds `token-delta-gte` for provided entries | **ADOPTED:** mandatory strictly-positive, per-asset expected receiver objective for terminal recovery; note native-only exception requires explicit separate semantics |
| Consistent metadata is insufficient | `assertActionMatchesTransaction` only compares outer transaction sender and ERC-20 contract destination | **ADOPTED:** ABI decode method/recipient/amount and exact serialized transaction binding |
| Finality string is caller controlled | `verifyCompletedRescue` reads `finality: "finalized"` | **ADOPTED:** no high-assurance terminal state from caller string; consumer must use verified finality proof from Issue #26 |
| Multiple assets and redundant entries | Current expected recoveries validated only for membership, not coverage/duplicate/strict >0 | **ADOPTED:** all-asset coverage, uniqueness and no zero minima; add negative cases |
| Real token behavior | Fee-on-transfer/rebase/proxy/unknown methods affect observed amount | **ADOPTED:** net outcome checked, unsupported effect semantics fail closed or explicitly opt out of verified recovery |
| Native sweep only | `assets` may be empty and native sweep is separately required by default | **ADOPTED:** distinct native-account evidence semantics, no blanket token-positive assumption for native-only flows |
| Test compatibility | Current fixtures use `rawTransaction: "0x03"` without ERC-20 data | **ADOPTED:** document and update fixtures in the eventual implementation; current 226 passing tests do **not** prove signed-raw parity |
| Real transfers/private keys | User expressly prohibited them | **OUT OF SCOPE:** no signing, transmission, deployment or production access |

**Pass 1 result:** The proposed high-assurance outcome criteria are traceable. Full runtime criteria cannot be claimed satisfied by a documentation-only change.

## Pass 2 — Architecture and alternatives

- **Reused:** `decodeCall` / viem decoder, `tokenAmountRaw`/exact `bigint`, `BalanceSnapshot`, `rescueFinalStateInvariants`, `EvmExecutionQuorum`, report state machine and Issue #22 trust boundaries.
- **New design seam:** (a) exact signed payload/ABI binding, (b) trusted external post-state/receipt/finality observer, (c) evidence-gated terminal rescue decision. Avoid duplicated quorum/finality models.
- **Option A:** Change current `verifyCompletedRescue` to require objective and verifiable provenance; provides a single correctly constrained terminal report but is breaking to simple existing callers. **Preferred only if compatibility change is explicitly authorized.**
- **Option B:** New strict completion function, legacy function retained but **downgraded** so it cannot claim `VERIFIED_RECOVERY` without verified evidence; more code/API surface but potentially incremental migration. **Viable alternative for explicit human choice**, not chosen here.
- **Option C:** Expose strict function while unchanged legacy can still return the same terminal state; confusable and leaves the security gap. **REJECTED**.
- **Option D:** Document warnings only. **REJECTED** because it fails Issue #25's objective.
- **transferFrom:** Existing outer-sender-is-victim rule conflicts with a relayer execution path; supporting transferFrom requires explicitly checking ABI `from`, delegated authorization, and expected signer, or deferring it. Do **not** claim support merely by adding selector.
- **RawTx:** viem documented `parseTransaction` and `decodeFunctionData`; actual behavior must be pinned to the installed `viem@2.55.x` lock before implementation. `parseTransaction` does not itself establish signer recovery/trust, so separately validate signer identity and chain.
- **Prebroadcast vs poststate:** terminal success requires more than valid calldata, and balance-only assertion can have unrelated deposits. Define proof attribution across receipts/events and safe snapshots; avoid double-counting.
- **Current branch dependency:** Issue #22 PR #23 remains Draft; cross-reference its trust contract without cherry-picking unmerged docs into the Issue #25 branch or assuming its merge.

**Pass 2 result:** A shared evidence and proof-seam design aligns with v0.18. Material API decision remains OPEN; do not implement until resolved.

## Pass 3 — Risk, security, regression and maintainability

| ID | Risk / scenario | Likelihood/impact judgment* | Mitigation / decision |
|---|---|---|---|
| R25-01 | Victim drained elsewhere while no safe credit | High consequence | **ADOPTED:** strict safe/asset delta required, negative fixture; do not claim complete |
| R25-02 | Token `transfer` selector targets token contract but ABI recipient is attacker | High consequence | **ADOPTED:** decode exact recipient/amount, compare against safe and objective |
| R25-03 | Intent `data` matches but actual signed `rawTransaction` differs | High consequence | **ADOPTED:** serialized-transaction parity and signer/chain validation |
| R25-04 | Snapshot not canonical / forged / stale / duplicate entries | High consequence | **ADOPTED:** verified evidence source; block hash required for strict path, no self-authored proof |
| R25-05 | Claimed finalized string with reorged transaction | High consequence | **ADOPTED:** Issue #26 integration; explicitly block independent finality claims before proof |
| R25-06 | Third-party safe deposit makes balance delta positive | High consequence for attribution | **ADOPTED:** receipt/log/state-transition subject binding and reject ambiguous attribution |
| R25-07 | Fee-on-transfer means calldata gross and safe net differ | Medium/high | **ADOPTED:** separately define min gross and min *net* received; reject unexpected net |
| R25-08 | Rebasing/elastic supply changes safe balance independent of transfer | High for attribution | **ADOPTED:** deny unsupported token verification without verified effect adapter |
| R25-09 | Native sweep safe delta negative after gas-funding rescue | Medium/high false negative | **ADOPTED:** distinct native accounting; model input/output attribution |
| R25-10 | Default objective required breaks old users and 0x03 fake tx test fixtures | High migration impact | **ADOPTED:** explicit migration decision and fixture refactor plan |
| R25-11 | Unsupported custom transfer methods silently treated as validated | High | **ADOPTED:** closed selector allowlist/contract ABI, no silent fallback |
| R25-12 | `transferFrom` relayer violates current outer-sender assumption | Medium/high | **ADOPTED:** defer unless authorization model approved; do not silently widen caller policy |
| R25-13 | Multiple configured expectations accidentally pass with repeated/same token | Medium | **ADOPTED:** one uniquely identified objective per asset; totals and zero minima validated |
| R25-14 | Documentation triggers false impression of runtime hardening | Process/security | **ADOPTED:** explicit design-only status, no code/test result claims |

*Severity/likelihood are **triage assessments** based on source reading, **not reproduced exploit findings**.

### Rejected or deferred

- **REJECTED:** keeping unsafe terminal success path without downgrade.
- **DEFERRED:** full handling of reflection/rebase/custom tokens, contract-wallet callback protocols, chain-specific finality internals of #26, operational RPC identity attestation, EIP-7702 authorizations beyond existing policy surface.
- **OUT OF SCOPE:** customer funds, real signing, real private keys, network writes, production deployments, dependency updates, Issue #26/#27 runtime code.

### Three-pass outcome

**PASS — ready for design documentation, NOT approved for security-critical code edits.** An explicit maintainer decision is needed for migration to fail-closed `verifyCompletedRescue`, `transferFrom` support and how Issue #26 terminal evidence will be surfaced. Future implementation PR MUST record separate actual negative test/CI outcomes and independent review.
