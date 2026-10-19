# Issue #25 — IMPLEMENTATION_PLAN (design stage)

**Issue:** [#25](https://github.com/Hibiki49aaiii/EraScript/issues/25) · Parent [#15](https://github.com/Hibiki49aaiii/EraScript/issues/15) · Trust contract [#22](https://github.com/Hibiki49aaiii/EraScript/issues/22) ([draft PR #23](https://github.com/Hibiki49aaiii/EraScript/pull/23))
**Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` (`main`, `erascript-lang@0.18.0`).
**Planning branch:** `issue-25-rescue-evidence-design` · **Change classification:** Design documentation only.
**Security review gate:** **Proposed behavioral design; NOT approved for security-sensitive implementation.** See `PRE_IMPLEMENTATION_REVIEW.md` and `DECISIONS.md`.

## 1. Requirements and operating model

**Goal:** Prevent an EVM rescue workflow from claiming `VERIFIED_RECOVERY` when the victim lost funds but the designated safe wallet did not receive the required funds; bind ERC-20 calldata and actually signed transaction semantics to explicit rescue intent.

- R25-01: A rescue with token assets MUST identify each expected token by chain ID, contract, decimals and explicit **strictly positive** minimum net safe-credit amount (unless a separate explicitly reviewed no-transfer objective applies). No missing, zero, or duplicated expected token entry may satisfy terminal recovery.
- R25-02: For token-rescue transaction actions, require semantic agreement of token contract, `victim` source, `safe` destination, decoded method/amount and the exact signed transaction. Unknown methods, empty/malformed calldata, insufficient evidence or ambiguous actors MUST NOT silently pass.
- R25-03: A victim-zero balance does not substitute for safe-wallet post-state credit. Balance snapshots must bind chain and canonical block identity, with required entries and uniqueness; an unrelated third-party safe-wallet deposit is not automatically attributable to the rescue.
- R25-04: Observe receipt execution success, relevant logs/state transitions and proper transaction/finality evidence. Finality policy and proof types are owned by [Issue #26](https://github.com/Hibiki49aaiii/EraScript/issues/26); design an integration seam instead of a second finality verifier.
- R25-05: Distinguish **observed partial recovery** from completed *finalized* recovery. Fail closed on reorg, missing/conflicting/untrusted evidence, unexpected recipient or amount, and token-specific transfer mechanics.
- R25-06: Preserve pre-broadcast readiness and existing successful supported operations where feasible, but make **security-critical terminal claims** fail closed. Any breaking change requires approved compatibility decision.
- R25-07: Native-only and mixed token/native rescue objectives must be explicit and handled separately from ERC-20 decimals or gross/native gas movements; a safe wallet that funded rescue may have negative net native delta.
- R25-08: Add deterministic offline negative tests and migration coverage in **future implementation**, not in this design PR.

## 2. Current architecture and exact source findings

1. `src/web3/workflow.ts`:
   - `WorkflowAction` `token-rescue` has `token/from/to` only, **no explicit amount**;
   - `assertActionMatchesTransaction` checks outer `tx.intent.from` and `tx.intent.to === token.address`, **does not inspect `tx.intent.data` or `tx.rawTransaction`**;
   - `defineRescueWorkflow` defaults `expectedRecoveries ?? []` and only ensures entries refer to listed assets; does not require one strictly-positive expectation per asset or reject duplicate same-token entries;
   - `rescueFinalStateInvariants` enforces victim zero and optional native dust, adding safe-credit `token-delta-gte` only for configured `expectedRecoveries`.
2. `src/web3/verification.ts`: `verifyCompletedRescue` receives a plain `RecoveryFinality` string and returns `VERIFIED_RECOVERY` when requested invariants pass and `finality === "finalized"`, without independently verifying provenance.
3. `src/web3/tx.ts`: `SignedTx` includes both `intent` and `rawTransaction`; `signSimulated` validates only raw hex shape, not parity between decoded signed bytes and metadata.
4. `src/web3/abi.ts`: existing `decodeCall` wraps viem `decodeFunctionData`, suitable for ERC-20 method-specific decoding; `selectorOf` and `decodeArgumentsFromCalldata` available.
5. `BalanceSnapshot` has optional `blockHash`. `balanceSnapshot` validates token chain/type, but **does not establish independently sourced canonicality**, reject duplicate balance entries, or bind snapshots to a particular execution receipt.
6. `src/web3/token.ts`: `TokenAmount.raw` is bigint with nonnegative constraint, not an enforced strictly-positive recovery objective.
7. Existing `test/web3-workflow.test.ts` and `test/web3-verification.test.ts` use mocked `rawTransaction` values like `0x03` with absent ERC-20 `intent.data`. These validate the existing simplified workflow, **not decoded signed transaction semantics**. Hardened tests need genuine *inert offline* serialized fixtures (never production keys/signing).
8. `src/chains/evm-execution-quorum.ts` already contains canonical receipt and provider observation primitives. Prefer consuming these instead of adding a competing finality subsystem.

## 3. Proposed target architecture (security-critical choice pending)

```text
User/AI-declared rescue objective [victim,safe,assets,minimum net credits]
             |
         Validation: exact token identity, positive amount, uniqueness
             |
SignedTx.rawTransaction -- offline deserialize/recover/bind chain/from/to/value/nonce/data
             |
ABI semantic decoder -- supported ERC-20 transfer / transferFrom only
             | reject unsupported selectors or recipient/amount/source mismatch
             v
Pre-broadcast workflow DAG and signer policy [does not itself establish recovery]
             |
Chain-observed execution: matching receipt/tx hash/canonical block + verified reads/logs
             |
Before/after snapshots [consistent chain, block hash, accounts, token identity]
             |
Per-asset attribution & safe-credit evidence (no double counting)
             |
Issue #26 finality evidence adapter (no caller-only "finalized" for terminal claim)
             |
Observed/partial outcome OR evidence-bound VERIFIED_RECOVERY
```

**Evidence obligations:** signed transaction hash and network, payload identity, ERC-20 transfer semantics, success receipt, expected recipient actual balance or verified effect, block/slot canonicality, provenance/freshness, post-state delta, and finality. Proof by reports/hashes alone is insufficient; `docs/VERIFICATION_TRUST_MODEL.md` defines I/C/A/E/F/P separation.

### Transaction semantics policy

- **Standard `transfer(address,uint256)`:** `tx.intent.from` is victim; outer `to` is token contract; ABI recipient is safe; ABI amount strictly positive and consistent with explicitly configured objective. Reject extra malformed arguments/unknown selector.
- **`transferFrom(address,address,uint256)`:** the ABI `from` argument must be victim and ABI `to` must be safe. Outer executor may be a different address; require explicit authorization/signature/allowance policy before accepting. **Do not retrofit `transferFrom` to assume the original outer-sender==victim rule.** Decide whether to support it in v1 or defer as custom/unsupported.
- **Multicall/custom tokens/delegated transfer/EIP-7702:** unsupported unless a named, separately reviewed semantic adapter validates the complete effect. No permissive fallback to `token-rescue` success.
- **Signed raw bytes vs intent:** parse exact signed `rawTransaction` and compare chain ID, transaction sender (verified against signature if supported), `to`, `value`, `nonce`, `data` and supported envelope fields. Merely checking `intent.data` is insufficient if `rawTransaction` differs. Inert offline fixture generator must be reviewed; NEVER sign user/customer keys.

### Recovery outcome policy

- A positive safe balance delta is **necessary** for ordinary ERC-20 recovery but not always **sufficient to attribute** a particular transaction; require receipt/log or independently verified state transition binding where appropriate.
- Fee-on-transfer: configured target refers to **net observed credit** rather than nominal calldata transfer amount; declare policy for allowed min-net less than gross send and reject unexpected loss. Rebases/reflections/non-standard hooks may make naive balance delta unreliable, so refuse high-assurance claim unless a family/token-specific verified effect model is available.
- Native recovery: distinguish victim sweep, safe account gas/funding outflows, and unrelated receipts; do not infer native transfer from raw `safeAfter - safeBefore` alone.
- Where custody/access cannot be independently checked, outcome remains `RECOVERY_OBSERVED` or `NOT_READY`, not terminal verified.

## 4. Design options and compatibility

| Option | Safety | Compatibility | Maintenance/extensibility | Assessment |
|---|---|---|---|---|
| **A — harden existing `verifyCompletedRescue` and required inputs** | Strong fail-closed terminal guarantees | Breaking for old caller-string finality, implicit empty objective and mocked raw bytes | Single definitive terminal API; migration tests required | **Preferred target, pending explicit security/compatibility review** |
| B — add `verifyCompletedRescueStrict` and retain current `VERIFIED_RECOVERY` from legacy function | Strong only when explicitly opted in | Maintains old APIs | Two paths with indistinguishable terminal label; severe misuse risk | Reject **unless** old path explicitly downgraded and labeled |
| C — add warning/docs only | Existing false terminal claim remains possible | Maximum | Trivial implementation, no meaningful security uplift | Reject for #25 implementation |

**Unresolved material choice:** exact migration strategy for prior `verifyCompletedRescue`, optional objectives and `transferFrom`; changing guarantees is security-critical and should receive user/maintainer approval before executable implementation. This design-stage PR proposes A but **does not make that behavioral change**.

## 5. State transitions and proposed diagnostics

- Workflow construction: malformed/unknown calldata or inconsistent metadata → deterministic failure or diagnostic; no transition to ready.
- Report construction: unmet required objective, missing canonical observations, missing safe delta, partial/mismatched credit → `NOT_READY` or `RECOVERY_OBSERVED` *only when actually observed*.
- Finalized success: only when evidence of both credited recipient P and finalized execution F has been independently corroborated under documented provider assumptions.
- Existing `ES4001`, `ES4012`, `ES4020`, `ES4021`, `ES4022`, `ES3302` are source anchors; new errors should use the repository's diagnostic scheme after checking collisions, **not reserve an unverified code number in this plan**.

## 6. Files and scope

**Expected future source (not modified by planning):** `src/web3/workflow.ts`, `src/web3/verification.ts`, `src/web3/abi.ts`, `src/web3/tx.ts` (only if signed-raw binding helper is needed), `src/chains/evm-execution-quorum.ts` (read/reuse, not necessarily change), `src/web3/token.ts` only for a genuinely shared strict-positive objective type.

**Expected future tests:** `test/web3-workflow.test.ts`, `test/web3-verification.test.ts`, `test/abi.test.ts`, new targeted `test/web3-rescue-evidence.test.ts` and contract compatibility tests.

**Planning-only PR adds:** `docs/ai/issues/25/IMPLEMENTATION_PLAN.md`, `PRE_IMPLEMENTATION_REVIEW.md`, `HUMAN_UNDERSTANDING.md`, `TEST_MATRIX.md`, `DECISIONS.md`. No `src/**`, `test/**`, workflow, CI or dependency changes.

Public report JSON/hashes remain unchanged in this plan. If evidence binding requires schema changes, defer until Issue #26 integration/explicit versioning review. DB/migration: none; library callers may require source/API migration; document exact migration once implementation shape is approved.

## 7. Security and data handling

Never derive E/F/P trust from report integrity or attestation; do not read or manipulate real private keys, execute signatures, broadcast, deploy or submit value. Use local fake deterministic tx objects/viem serialization in future unit tests. Treat proxy/upgradable tokens, malicious `balanceOf` readers, provider collusion, reorgs and replayed snapshots as adversarial. Require state/receipt and provenance checks at the authority-owning verifier, not optional static diagnostics.

## 8. Deterministic verification plan

See [TEST_MATRIX.md](TEST_MATRIX.md). Main required future steps:

1. `npm ci` with locked deps; `npm run check`.
2. New fixture tests: omitted/zero/duplicate expected credits, victim-zero/no safe credit, ERC-20 `transfer` wrong recipient/amount/contract, corrupted/truncated selectors, intent/raw mismatch, fake signed bytes, replay/chain/nonce, partial execution, fee-on-transfer/rebase assumptions, native-only rescue.
3. Negative observation tests: forged safe state/duplicate snapshots, unrelated safe deposit, stale/reorged block, conflicting RPC, unverified receipt, caller `finality:"finalized"` alone.
4. Existing `test/web3-workflow.test.ts` and `test/web3-verification.test.ts` regression; adapt their `0x03` fixture in a way that cannot be mistaken for production signing.
5. `npm run test:core`, including existing full 226-test baseline with additional tests; `FORCE_COLOR=1 npm run test:core`; `npm run test:package`, `git diff --check` and PR CI; actual result and SHA logged.
6. No live-network writes, real signatures, customer keys or funds movement.

**Current planning verification:** GitHub source/Issue inspection only. Prior [Core CI 39227897481](https://github.com/Hibiki49aaiii/EraScript/actions/runs/39227897481) is an existing v0.18 baseline/equivalent-docs test and is **NOT** validation of any future #25 change.

## 9. Implementation order and gated review

1. Confirm #25 Issue-first, main HEAD and shared evidence primitives.
2. Record this plan, [PRE_IMPLEMENTATION_REVIEW.md](PRE_IMPLEMENTATION_REVIEW.md), [HUMAN_UNDERSTANDING.md](HUMAN_UNDERSTANDING.md), [DECISIONS.md](DECISIONS.md), [TEST_MATRIX.md](TEST_MATRIX.md).
3. Obtain explicit decision on Option A vs safe alternative, scope of transferFrom and native rescue, and handoff to Issue #26 proof interface.
4. **Only after approval:** implement strictly scoped logic, adversarial fixture/test updates and compatibility migration.
5. Execute actual checks, request independent security review, create post-implementation review with accurate evidence; update Issue #25 and trust spec with real implementation outcome.

## 10. Risks, rollback, residual concerns

- Breaking existing pre-1.0 usages or tests from implicit objectives and dummy raw bytes.
- Amount attribution and fee-on-transfer/rebasing semantics cannot be proved using snapshots alone; avoid false finality.
- Source/API compatibility with Issue #26 is not yet frozen.
- Misleading trust labels if legacy path retained.
- Incorrect handling of native-only or smart contract wallet flows.
- **Rollback of this planning step:** revert docs-only PR; no runtime/chain state, keys, data or migrations affected.
- **Post-implementation rollback (future):** dedicated PR revert and API/migration review; do not silently restore unsafe terminal promotion.

**Status: DESIGN PROPOSED, CODE NOT IMPLEMENTED, TEST MATRIX NOT EXECUTED.**
