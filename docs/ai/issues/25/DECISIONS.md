# Issue #25 — DECISIONS (proposed; no implementation authorization)

**Baseline:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7`  
**Owner:** Issue [#25](https://github.com/Hibiki49aaiii/EraScript/issues/25); related Finality Issue [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26).  
**State:** Pending security-critical migration choice. All proposals below are for future code PRs, **not** behavior currently provided by v0.18.

## D25-01 — Terminal verification API

**Problem:** current `verifyCompletedRescue` can emit `VERIFIED_RECOVERY` with an empty expected asset credit and a caller supplied finality string.

| Option | Advantages | Disadvantages | Effect on security and maintainability |
|---|---|---|---|
| A — require complete corroborated evidence for existing terminal function | Single unequivocal terminal invariant; impossible to retain caller-only `VERIFIED_RECOVERY` | Breaking source-level input changes and existing fixtures | **Preferred fail-closed design**, needs explicit approval and migration |
| B — add strict variant, downgrade legacy output to observed/not-ready | May allow staged migration | Dual API/documentation surface; ambiguity during migration | Acceptable only if legacy **cannot** produce same terminal success unsupported |
| C — add strict variant without changing old terminal promotion | No breaking changes | Existing misinterpretation unchanged | **Rejected** |
| D — documentation/warnings only | Trivial | Does not satisfy #25 acceptance criteria | **Rejected** |

**Proposed selection:** A, conditional on maintainer's confirmation of security/compatibility migration. No runtime code edits in this planning PR.

## D25-02 — Signed-byte and ABI semantics

- Reuse installed `viem` transaction parsing and `decodeFunctionData` through existing `src/web3/abi.ts` utilities where appropriate.
- **Do not equate `SignedTx.intent.data` with the signed raw calldata** without deserialization and exact comparison. In addition to `to/data/value/nonce/chain`, handle sender identity and signed envelope validation; a successful parser by itself is not a trusted signature proof.
- Initial **proposed** allowlist: standard ERC-20 `transfer(address,uint256)`; support `transferFrom(address,address,uint256)` only after approval of relayer and allowance/authorization semantics (outer executor may differ from victim).
- Ignore no unsupported selector: error or explicitly non-verified custom path. Non-standard tokens need a separately reviewed semantics adapter.
- Exact `TokenAmount.raw` bigint and chain/contract/decimals identity; no float conversions.

**Decision status:** Ordinary transfer direction favored; transferFrom/AA/meta-tx breadth unresolved.

## D25-03 — Minimum recipient credit vs gross transfer

- Treat a normal recovery objective as a **minimum observed net safe credit** for exact asset.
- Check on-chain execution and effect/receipt binding so an unrelated deposit to the safe wallet cannot masquerade as recovery.
- Fee-on-transfer token policy must separately define gross attempted transfer and min acceptable net received; if impossible to prove net credit, refuse terminal verification.
- Rebase/reflection tokens may not admit simple delta attribution. Deny unsupported cases instead of estimating.

**Decision status:** Proposed strong receiver proof for terminal state; token-specific extensions deferred.

## D25-04 — Native-only rescue

The existing `requireNativeSweep` is a victim dust invariant and **not** proof that the safe wallet net received ETH when safe paid funding and gas. Native-only workflows may contain no `assets`, so a blanket `expectedRecoveries.length > 0` requirement would incorrectly rule them out.

**Preferred direction:** Explicit native recovery objective and receipt/balance provenance with fee/funding attribution. For mixed workflows, every declared token must satisfy its own required objective; native dust policy remains a separate condition. Exact native proof format is a material implementation choice to review.

## D25-05 — Finality coordination

- Let Issue #26 own the canonical execution/finality evidence contract, including quorum and settlement.
- Issue #25 must consume an evidence-backed proof or verifier result, **not an arbitrary `finality: "finalized"` string**.
- Do not duplicate `EvmExecutionQuorum` in a new rescue-only finality subsystem.
- If #26 API is not ready, stop the implementation of terminal `VERIFIED_RECOVERY` rather than shipping a broken-in-two design.

## D25-06 — Migration and regression

- The current tests `test/web3-{workflow,verification}.test.ts` create fake unsigned raw bytes, e.g. `0x03`, lacking a matching ERC-20 `intent.data`. They MUST be revised when signed raw proof becomes mandatory; reusing these fixtures after strict checks is misleading.
- Migration tests must prove previously insecure default routes no longer emit terminal success, and explicitly supported verified routes do.
- A compatibility layer MUST NOT make an unaudited `VERIFIED_RECOVERY` claim under the same name.
- New diagnostics should be allocated only after actual source search and tests; do not pre-reserve a number.

## Required decisions before modifying code

1. Approve **Option A** breaking/fail-closed `verifyCompletedRescue` contract or **Option B with mandatory legacy downgrade**.
2. Confirm **`transfer` only** first vs reviewed delegated `transferFrom` authorization path.
3. Confirm native-only recovery objective and acceptable proof model.
4. Approve finality proof interface with Issue #26, or sequence #26 first.
5. Approve corresponding migration/test fixture update approach.

**No decision here authorizes real asset transfers, signature operations, customer key access or production deployment.**
