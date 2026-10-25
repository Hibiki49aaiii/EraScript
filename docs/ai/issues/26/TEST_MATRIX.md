# Issue #26 — TEST_MATRIX: Finality evidence (all PROPOSED)

**Issue:** [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26) · **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Status:** test specifications, **NOT RUN** by this design-only PR.

These fixtures are local and deterministic: fake observations/receipts, offline source bindings and no real keys, signatures, broadcasts, paid calls or production state changes. Future implementation shall verify installed SDK versions, diagnostics, exact committed SHA and fixture provenance before calling results "passed."

| ID | Scenario / trust boundary | Future expected high-assurance result |
|---|---|---|
| F26-T01 | Synthetic successful `IncludedTx` → `markConfirmed` → `markFinalized` → direct EVM report with no finalized-head observation | **No `VERIFIED_FINALITY`** |
| F26-T02 | EVM quorum at `confirmed`, default `requireFinalized=false` | Strict F verifier refuses terminal finality |
| F26-T03 | EVM quorum with `requireFinalized=true`, matching successful receipt and finalized-head above receipt from approved sources | F decision eligible (under provider trust assumptions) |
| F26-T04 | EVM finalized-head below receipt block | Refuse terminal F |
| F26-T05 | EVM receipt marked reverted although quorum status seems finalized | Refuse execution success and F |
| F26-T06 | EVM transaction hash mismatched between receipt, source and quorum | Refuse proof / deterministic mismatch error |
| F26-T07 | EVM receipt block hash/canonical hash mismatch (reorg simulation) | Refuse F |
| F26-T08 | Two providers with distinct IDs but mismatched receipts/blocks | Refuse F; no quorum consensus |
| F26-T09 | Two providers share a backend/operator and report consistent false status | Operational independence remains **unknown**, not cryptographically proved |
| F26-T10 | Unavailable/stale provider observation or future timestamp beyond allowed skew | Refuse or require fresh observation; no silent F |
| F26-T11 | Recomputed `quorumHash` with otherwise caller-written fake data | Hash match alone not sufficient to establish authorized verifier provenance |
| F26-T12 | Caller creates a structural/brand-forged F decision | Untrusted structure not accepted as authoritative finality token |
| F26-T13 | EVM proof from different chain ID/profile reused for matching-looking hash | Reject subject/profile mismatch |
| F26-T14 | EVM proof for transaction A reused for B | Reject binding mismatch |
| F26-T15 | EVM minimal confirmed stage without finalized evidence | Report at most observed, not terminal |
| F26-T16 | Rollup matching L2 successful receipt but stage only `l2-included` / `l2-final` | No claim of required L1 finality |
| F26-T17 | Rollup `l1-finalized` string without trustworthy adapter/source proof | Refuse high-assurance F |
| F26-T18 | Rollup L1 anchor is absent or points to wrong L1 chain/block | Fail proof |
| F26-T19 | Rollup settlement L2 hash/block/profile inconsistent with EVM receipt | Reject proof |
| F26-T20 | OP Stack finalized L2 head but L1 origin not finalized | No L1-settled F |
| F26-T21 | Arbitrum L1 assertion not confirmed/finalized for exact L2 block | No L1-settled F |
| F26-T22 | Solana signature found but only `confirmed` | No strict finalized F |
| F26-T23 | Solana finalized but wrong signature/network/profile/slot | Reject proof |
| F26-T24 | Solana finalized status but required block identity absent/mismatched | Reject if strict block-identity policy is required |
| F26-T25 | Solana blockhash/nonce lifecycle stale or authorization invalid | No complete execution/finality decision |
| F26-T26 | Jito backend bundle landed, one expected signature missing finalized Solana quorum | No terminal F |
| F26-T27 | Jito duplicate/mismatched signature set or landed-slot mismatch | Reject proof |
| F26-T28 | Jito all expected signature quorums match and finalize under trusted sources | Eligible under configured F policy |
| F26-T29 | Sui digest checkpointed, effects failed | Never verified successful F |
| F26-T30 | Sui checkpoint matches but wrong digest/network/profile | Reject proof |
| F26-T31 | Sui checkpoint exists but effects identity differs under strict effects-binding policy | Reject F |
| F26-T32 | RAILGUN base EVM quorum finalized but private-state assertion failed | Base F may be true; private outcome P false; no full RAILGUN terminal success |
| F26-T33 | RAILGUN proof binding hash mismatches finalized base transaction | Reject strict privacy verification |
| F26-T34 | Rescue destination credited but `finality:"finalized"` caller string only | #25 must **not** reach `VERIFIED_RECOVERY` |
| F26-T35 | Rescue graph has two distinct execution subjects and only one finalized proof | No full rescue finality; prevent proof reuse/double counting |
| F26-T36 | Rescue F proof subject correct but safe receiver credit P missing | No `VERIFIED_RECOVERY`; F does not imply P |
| F26-T37 | Signed report hash and valid attestation on a self-consistent false terminal claim | I/C/A may pass but external F remains unknown, do not auto-accept |
| F26-T38 | Source URL/token or synthetic auth header in diagnostic output fixture | No secret material leaked; redaction checks |
| F26-T39 | Legacy direct adapter reused under selected API migration mode | Cannot emit indistinguishable high-assurance `VERIFIED_FINALITY` on caller evidence alone |
| F26-T40 | Concurrent/replayed evidence or changed policy between verification and use | Reject stale/mismatched decision, require proper contextual binding |

## Required test suites and actual execution gate (future)

Existing relevant test sources confirmed in base tree:

- `test/evm-execution-quorum.test.ts`
- `test/evm-provider-routing.test.ts`
- `test/rollup-provider-fixtures.test.ts`
- `test/solana-execution-quorum.test.ts`
- `test/sui-execution-quorum.test.ts`
- `test/multichain-verification.test.ts`
- `test/multichain-finality-private-state.test.ts`
- `test/railgun-quorum-verification.test.ts`
- `test/web3-verification.test.ts`
- `test/cli-multichain-verify.test.ts`

Suggested future run order: `npm ci`; `npm run check`; focused EVM/rollup/Solana/Jito/Sui/RAILGUN/rescue tests (after `npm run build`); `npm run test:core`; `FORCE_COLOR=1 npm run test:core`; `npm run test:package`; `git diff --check`; GitHub Actions Core CI on actual implementation SHA; independent PR review.

**Known existing evidence:** Baseline equivalent-tree [Core CI run 39227897481](https://github.com/Hibiki49aaiii/EraScript/actions/runs/39227897481) passed 226/226 tests twice on 2026-10-19. It **does not test** F26-T01..T40 or any future security behavior change.

## Mapping to acceptance criteria

| Issue #26 criterion | Proposed test IDs |
|---|---|
| No synthetic markFinalized/direct promotion | F26-T01, T02, T11, T12, T15, T39 |
| Exact observed per-family finalized evidence | F26-T03..T05, T16..T33 |
| Mismatch, stale, reorg, contradictory providers | F26-T06..T14, T40 |
| Rollup settlement, Jito signature set, RAILGUN private outcome | F26-T16..T21, T26..T28, T32..T33 |
| Rescue integration of F and P | F26-T34..T36 |
| Report I/C/A unchanged; secret hygiene | F26-T37..T38 |
| Migration and actual CI | F26-T39 plus full existing suites |

**No test row is marked passed until a future code PR actually executes and logs it.**
