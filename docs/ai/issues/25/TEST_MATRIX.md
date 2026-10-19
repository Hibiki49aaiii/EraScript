# Issue #25 — TEST_MATRIX (proposed, NOT EXECUTED)

**Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Scope:** issue-scoped security regression cases for future implementation.  
**Execution status:** All `R25-Txx` test cases below are **design proposals**; none were run by the design-only PR. The previously observed 226/226 Core CI pass on #22 baseline does not qualify #25 implementation.

Test fixture requirements: deterministic offline, no customer keys, no mainnet signing, no transactions, no external network writes; use local serialized EVM envelope examples or **non-signing** synthetic field fixtures when testing a pure decoder. For signed-transaction parity tests, test inert published/mock signed-bytes as read-only inputs and document provenance. Actual TypeScript fixtures must match exact installed `viem` signatures/SDK versions.

| ID | Risk | Proposed fixture / assertion | Expected **target** behavior | Existing baseline? |
|---|---|---|---|---|
| R25-T01 | Omitted objective | Nonempty `assets`; `expectedRecoveries` omitted; victim zero, safe unchanged | Cannot return `VERIFIED_RECOVERY` | **GAP** |
| R25-T02 | Empty objective | `expectedRecoveries=[]` with nonempty token list | Fail terminal claim | **GAP** |
| R25-T03 | Zero target | `expectedRecoveries` contains `TokenAmount.raw=0n` | Reject zero-positive recovery objective | **GAP** |
| R25-T04 | Missing coverage | Two asset contracts, objective for only one | Reject incomplete objective | **GAP** |
| R25-T05 | Duplicate asset objectives | Two entries for same token/contract/chain/decimals | Reject conflicting/duplicate expected targets | **GAP** |
| R25-T06 | Wrong token | Correct symbol but different contract/chain/decimals | Reject inconsistent identity | Partial `sameToken` |
| R25-T07 | Missing safe credit | Victim token zero, safe delta zero with claimed finalized | `NOT_READY` or explicit incomplete state; never `VERIFIED_RECOVERY` | **GAP** default |
| R25-T08 | Partial safe credit | Safe credited 99 of required 100 raw | Reject terminal objective | Existing configured invariant |
| R25-T09 | Legitimate complete token credit | Explicit 100 raw, verified exact transfer and safe +100 | Terminal only with Issue #26 finality proof | Existing configured balance-only fixture |
| R25-T10 | Wrong ABI recipient | ERC-20 `transfer(attacker,100)` to correct token contract | Reject matching of declared `to:safe` action | **GAP** |
| R25-T11 | Wrong amount | `transfer(safe,1)` expected 100 | Reject insufficient amount/effect | **GAP** |
| R25-T12 | Malformed selector | Calldata less than 4-byte selector / odd hex | Deterministic decode rejection | Decoder exists, workflow no check |
| R25-T13 | Unknown method | `approve`, `permit`, arbitrary selector, zero data | Not accepted as `token-rescue` verified transfer | **GAP** |
| R25-T14 | Intent-vs-signed mismatch | `intent.data` is safe, `rawTransaction` decodes attacker | Reject before readiness or terminal claim | **GAP** |
| R25-T15 | Sender/chain/nonce mismatch | Signed raw bytes' sender/chainId/nonce disagree with intent and plan | Fail signed-byte binding | **GAP** |
| R25-T16 | Misleading serialized raw | Existing `rawTransaction="0x03"` fixture | Parser rejects for strict semantics; replace fixtures | Baseline test uses 0x03 |
| R25-T17 | Delegated transferFrom | ABI from victim, to safe, outer sender relayer | Reject/defer unless approved authorization model | Unsupported current |
| R25-T18 | transferFrom wrong source | ABI from unrelated owner, to safe | Reject regardless of outer sender | Unsupported current |
| R25-T19 | Snapshot missing block hash | before/after block numbers but no verified block identity | Reject high-assurance finality/post-state | **GAP** |
| R25-T20 | Replay/conflicting history | After snapshot older or block hash conflicts with canonical provider | Reject proof | Partial order check |
| R25-T21 | Duplicate snapshot entries | Same safe/token appears twice with different values | Reject ambiguity instead of `.find` first | **GAP** |
| R25-T22 | Forged RPC balance | Caller supplies synthetic safe delta without independently observed provenance | Do not establish E/P trust | **GAP** |
| R25-T23 | Third-party deposit | Unrelated deposit to safe supplies required delta while actual rescue tx fails | No attribution, no `VERIFIED_RECOVERY` | **GAP** |
| R25-T24 | Reverted receipt | Exact transfer tx receipt `status=reverted` | No credited recovery claim | Need evidence binding |
| R25-T25 | Fee-on-transfer | Transfer gross 100; received net 98; policy min net 99 | Reject terminal; exact integer comparison | Target specialized case |
| R25-T26 | Rebase/reflection | Safe balance increases without relevant transfer | Reject unless supported effect-proof adapter | Target specialized case |
| R25-T27 | Native-only | `assets=[]`, required native sweep and funded safe | Govern by explicit native objective, don't fail merely for zero token assets | Design decision pending |
| R25-T28 | Native mixed fees | Safe funds gas and receives native; net safe delta negative | Never infer failed receipt solely from net sign; use attribution | Design decision pending |
| R25-T29 | Caller finalized string | Valid balance objective, no canonical finality, `finality:"finalized"` | No terminal success | Issue #26 integration |
| R25-T30 | Finalized canonical objective | Matching receipt, independent provider/quorum, canonical state, strict safe proof | `VERIFIED_RECOVERY` eligible | Requires #26 |
| R25-T31 | Wrong wallet | `workflow.safe===workflow.victim` or mismatched action recipient | Fail invalid rescue objective | Needs review |
| R25-T32 | Untrusted privacy exposure | Canary secrets in error/log/serialized report fixtures | No secret/canary leaked in public output | Needs secure logging tests |
| R25-T33 | Multiple same-token transfer nodes | Two attempts/partial transfers and one failure | Attribute exact expected successful amounts without double counting | New |
| R25-T34 | ERC-20 Transfer log spoof | Emitted log from unrelated contract, wrong token/address or fake event | Reject unauthenticated contract/receipt event | New |

## Required future verification gates

1. Exact baseline source and `npm ci` locked dependencies.
2. `npm run check`; focused `web3-workflow`, `web3-verification`, `web3-abi` and new rescue evidence tests.
3. `npm run test:core` normal **and** `FORCE_COLOR=1`; `npm run test:package`.
4. `git diff --check`, changed-file/static doc/code audit and source-map/package smoke.
5. Actual GitHub Actions Core CI at the relevant implementation SHA; do not reuse #22's old results.
6. Separate post-implementation correctness, regression, architecture, security, maintainability and stale-doc review.
7. Human decision recorded for fail-closed API migration, transferFrom scope and #26 finality proof seam before security behavior changes.

## Coverage by acceptance criterion

| Acceptance | Tests |
|---|---|
| No absent/empty/zero expectedRecovery terminal success | R25-T01..T05 |
| Victim-zero alone insufficient; safe objective correctness | R25-T06..T09, T23 |
| ABI method/recipient/amount and raw intent binding | R25-T10..T18, T31, T33..T34 |
| Canonical subject, state provenance and block history | R25-T19..T24 |
| Native, net amount, unusual tokens | R25-T25..T28 |
| Finality based on evidence and not caller strings | R25-T29..T30 |
| Secret-safe diagnostics | R25-T32 |

**Do not mark any acceptance criterion completed until the above relevant tests have actually executed and passed.**
