# Issue #26 — DECISIONS (pending approval)

**Issue:** [#26](https://github.com/Hibiki49aaiii/EraScript/issues/26) · **Base Commit SHA:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` · **Status:** design alternatives only.

## D26-01 — Terminal API safety/migration

| Option | Behavior | Pros | Cons | Decision |
|---|---|---|---|---|
| A. Upgrade every existing terminal adapter to require *authorized chain finality verifier* or downgrade | Caller cannot obtain `VERIFIED_FINALITY` from arbitrary finalized state | One safe meaning for terminal state | Breaks existing typed lifecycle/fixtures and possibly external callers | **Preferred design target, requires explicit human authorization** |
| B. Introduce strict finality verifier; existing direct adapters remain callable but cannot produce high-assurance `VERIFIED_FINALITY` | Allows staged migration | Lower source-level churn | Must track two paths and avoid "strict" confusion | **Viable alternative, requires human authorization** |
| C. Add branded finality proof type or report hash and accept it alone | No independently authenticated source; caller can fabricate structural data | Simple | Falsely claims security | **Rejected** |
| D. Leave old terminal logic and add warning/docs only | Preserves source compatibility | No meaningful risk reduction | Does not meet Issue #26 requirements | **Rejected** |

**Status:** not selected for implementation. Agreement must also govern #25's `verifyCompletedRescue`.

## D26-02 — Evidence provenance/authority

**Proposed requirement:** verifier must own or authenticate provider connections/observations; validate policy at use time; retain subject/chain/profile/block, provider identity and failure-domain assumptions. Recomputed `quorumHash` and source labels prove consistency of *supplied data*, not independent correctness or protection from malicious Node code.

- **Model 1:** same-process trusted verifier that exclusively invokes bound SDK/RPC and refuses caller-authored observations; conditional if caller controls arbitrary Node runtime.
- **Model 2:** separately trusted verifier service with authenticated response, freshness/replay policy and independently maintained trust roots; stronger isolation but extra operations.
- **Model 3:** arbitrary caller structure with TypeScript `unique symbol` brand. **Rejected as authority proof**.

**Decision required:** explicitly choose what is meant by trusted verifier, authorized operations and operational control boundary. An application compiled to ordinary Node must not imply that same-process brands prevent malicious code from gaining signing or provider authority (#27).

## D26-03 — EVM proof semantics

- `requireFinalized=true` must be explicit for a finality-level decision; default included/confirmed quorum is only observed/confirmed.
- All providers in quorum must agree on exact receipt hash, block identity, success and observed finalized head beyond receipt. Other source independence is declared and tested operationally; IDs alone do not prove distinct operators.
- Exact subject binding includes chain ID, profile ID, transaction hash, receipt block number/hash and policy identifier.
- For OP Stack/Arbitrum, proof of required L1 settlement from an approved protocol adapter must bind the same L2 execution plus L1 chain and anchor. Do not infer settlement from native L2 stage.

## D26-04 — Non-EVM family policy

- Solana: finalized signature execution plus configured quorum and correct profile/slot; decide whether `requireBlockIdentity=true` should become high-assurance default. Its current default is false.
- Jito: require exact expected signature set and finalized Solana quorum for every expected signature; bundle ID/status is never a replacement.
- Sui: successful effects, checkpoint binding and trusted source; decide if `requireEffectsIdentity=true` is mandatory for high-assurance policies (current default false).
- RAILGUN: F about base EVM and L1 settlement (when applicable) is **not** private-state P, which requires proof-bound private assertions and trustworthy observer.

## D26-05 — Issue #25 interface

**Agreed conceptual boundary for future approval:**

```text
F(subject, chain/profile, canonical receipt, verified source policy, finalized head/L1 settlement)
+
P(exact rescue plan, token/recipient/amount, receipt effects, safe destination delta)
=> high-assurance VERIFIED_RECOVERY only if both pass
```

- The #26 consumer receives a decision from a trusted verifier function/service, **not** a freely constructible boolean/string/type assertion.
- #25 validates signed raw calldata semantics and actual destination credit; #26 must not pretend F proves safe receipt.
- Define a canonical subject identifier to prevent using finality of one transaction to validate recovery from another. Multiple rescue graph transactions may require a set of finalized subjects, not one proof for all.
- Avoid package/schema changes until both #25/#26 design reviews select a shared API, legacy return behavior and versioning.

## D26-06 — Required signoff before implementation

1. Choose terminal API migration **A** versus safe alternative **B**.
2. Choose verifier trust boundary and who can forge/request proof, including hostile npm imports.
3. Agree high-assurance policies for nonrollup EVM, L1 settlement, Solana block identity and Sui effects identity.
4. Agree #25 multi-transaction rescue subject set, evidence age/reorg policy and missing/partial states.
5. Define exact public API/report compatibility and migration tests.
6. Independently review source-level negative fixtures and new diagnostics before merging.

**No real signature/private-key operations, transaction submission, production data or deployment is authorized.**
