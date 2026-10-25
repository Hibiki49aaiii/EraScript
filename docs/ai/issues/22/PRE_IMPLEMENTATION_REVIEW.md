# Issue #22 — Pre-Implementation Review

**Review type:** documentation/specification-only; **baseline:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7`; **branch:** `issue-22-verification-trust-model`.

**Inputs inspected:** Issue #22, parent #15, `AGENTS.md`, `.ai/index.md`, `.ai/decisions/2026-08-31-detached-verification-attestation.md`, `README.md`, `docs/{WEB3_SPEC,MULTICHAIN_ARCHITECTURE,V017_IMPLEMENTATION,V018_IMPLEMENTATION}.md`, package metadata, current verification, rescue, quorum, signer/runtime and privacy modules, and existing named tests.

**Status:** pre-documentation review performed against current source paths; recommendations are incorporated in `docs/VERIFICATION_TRUST_MODEL.md`. This review is *not* an execution of the proposed adversarial tests and is not a security certification.

## Pass 1 — Requirements completeness

| Finding | Evaluation | Decision |
|---|---|---|
| Issue #22 FR-01..FR-11 and TM-01..TM-14 need unambiguous traceability | A generic "verified" flag would not satisfy distinct integrity, authentication and chain-result requirements | **Adopted:** predicate glossary; per-family/path matrix; threat-to-control register |
| Two report kinds must remain separate | Rescue `VERIFIED_RECOVERY` has an application post-state requirement; multichain `VERIFIED_FINALITY` does not imply recovery | **Adopted:** distinct state tables and explicit outcome semantics |
| Direct family adapter outputs and multi-provider quorum outputs differ | Same terminal label can be produced under different provenance assumptions | **Adopted:** distinguish direct/caller-supplied from strict quorum paths |
| Existing source does not enforce all high-assurance MUST conditions | Promising a universal runtime guarantee would conflict with the user's no-behavior-change constraint | **Adopted:** mark actual/conditional/gap/operations; assign future Issue |
| Report signing, public constructor restriction already in #16 and #18 | Duplicative redesign would cause regression and waste | **Rejected:** reimplement attestation or change public exports |
| Unit tests for missing evidence and collusion are not all present | Writing a test plan is different from executing tests | **Adopted:** separate existing test references from proposed negative cases |

**Pass 1 result:** Requirements are satisfiable as **auditable documentation**. No requirement may be reported complete as an executable security control solely on the basis of this PR.

## Pass 2 — Architecture consistency

### Existing design anchors

1. `src/chains/verification.ts`: multichain report schema/parse/hash and internal generic constructor.
2. `src/verification-attestation.ts`, `src/cli.ts`: detached Ed25519 attestation bound to report hash, with explicit trusted public key and honest output fields.
3. `src/chains/index.ts`: restricted package barrel prevents ordinary import of a generic terminal-report constructor; source-tree internal constructor still exists for adapters.
4. `src/chains/evm-execution-quorum.ts`: observed receipt/canonicality/confirmation/finalized-head quorum.
5. `src/chains/{solana-execution-quorum,sui-execution-quorum}.ts`: family-specific multi-provider status/commitment and effects/checkpoint quorums.
6. `src/chains/verification-adapters.ts`: direct as well as strict quorum adapters; strict Jito binds all expected signatures and Solana finalized quorum.
7. `src/privacy/verification.ts`: direct RAILGUN path and strict EVM-quorum + proof-bound private-state path.
8. `src/chains/rollup-finality.ts`: named settlement stages; `l1-finalized` is not interchangeable with L2 inclusion.
9. `src/web3/workflow.ts` / `src/web3/verification.ts`: rescue state invariants and completion report.
10. `src/web3/capabilities.ts`, `src/web3/analyze.ts`, `src/runtime-loader.ts`: policy enforcement when invoked, syntactic source checks, unconfined Node imports.

### Alternatives

| Candidate | Extensibility | Maintenance | Security | Outcome |
|---|---|---|---|---|
| Independent predicates + cross-family mapping | New chain rows fit without schema churn | Single docs contract maintained with source links | Limits overclaim and identifies invalid promotions | **Adopted** |
| One universal `TrustLevel` enum in runtime | Poor at rollup/privacy-specific post-state | API/test changes + versioning | Easy to conflate authenticated false report with true finality | **Rejected** |
| New central trust authority | Can add online revocation | Service/key lifecycle overhead | New concentrated compromise/availability point | **Deferred** |
| Duplicate #16 attestation logic in each adapter | No genuine benefit | Duplication, compatibility risk | Conflicting definitions | **Rejected** |

### Compatibility review

- No changes to `reportHash` canonicalization, attestation schema, parser state flags, package exports, Node/TS runtime, dependencies or diagnostics.
- EVM quorum promotion may internally call `markFinalized`; the critical boundary is the *quorum evidence*, not the name of that function. Conversely a direct call to `markFinalized` is not itself chain proof. The spec explicitly handles both contexts.
- For Sui, `SuiExecutionQuorumPolicy.requireEffectsIdentity` can be false; do not claim effects-digest agreement is universal.
- For Solana, `requireBlockIdentity` can be false; do not claim every quorum independently verifies block identity.
- EVM provider ID uniqueness is not proof that underlying operators are independent.
- Note user-facing documentation can say what high-assurance callers *should* require, but it must also label implementation gaps.

**Pass 2 result:** Selected docs contract reuses existing primitives and avoids duplicate security systems.

## Pass 3 — Security, regression and risk

| ID | Finding / failure mode | Source anchor | Severity* | Decision |
|---|---|---|---|---|
| R-01 | Direct `markFinalized` promotes a caller-supplied `ConfirmedTx`; a direct EVM adapter reads `state === "finalized"` | `src/web3/tx.ts`, `src/chains/verification-adapters.ts` | High | **Adopted** as provenance gap; separate runtime evidence-gate Issue |
| R-02 | Missing `expectedRecoveries` defaults to [] so victim-zero invariants may pass without safe-wallet delta | `src/web3/workflow.ts`, `src/web3/verification.ts` | High | **Adopted** as rescue outcome gap; separate invariant fix Issue |
| R-03 | Token rescue checks transaction's contract destination, but not ABI-decoded transfer recipient/amount | `src/web3/workflow.ts` | High | **Adopted** as semantic transaction-intent gap; separate fix |
| R-04 | Offline Ed25519 attestation authenticates issuer, not RPC proof; no revocation or consumed nonce registry | `src/verification-attestation.ts`, attestation ADR | High if misunderstood | **Adopted** relying-party policy and explicit limitations; online registry deferred |
| R-05 | RPC provider IDs may be aliases over shared node/operator; split-brain/finality reorg | quorum modules | High | **Adopted** operational-independence gap and negative test plan |
| R-06 | Direct Solana/Jito/Sui adapters may accept caller-provided evidence; strict quorum route is distinct | verification adapters | Medium/High | **Adopted** route-class differentiation |
| R-07 | Strict RAILGUN route validates EVM quorum plus private assertions, but private-state observer remains an external trust source | `src/privacy/verification.ts` | High | **Adopted** proof provenance/operational trust statement |
| R-08 | External signer response has a claimed respondedAtMs; no independently recomputed deadline after await in current path | `src/chains/external-signer.ts` | Medium/High | **Adopted** as proposed async-expiry negative test/future code Issue |
| R-09 | Syntactic secret analyzer and ordinary Node execution are not sandbox/capability confinement | `src/web3/analyze.ts`, `src/runtime-loader.ts` | High | **Adopted** as scope boundary; signer isolation deferred |
| R-10 | Docs-only PR is skipped by Core CI configured `paths-ignore`; absence of new CI cannot be treated as PASS | `.github/workflows/ci.yml` | Process | **Adopted** verification reporting rule |
| R-11 | Excessive test claims from historical CI are misleading | historical #20 evidence | Process | **Adopted:** "previously passing on main" vs "executed for this PR" |
| R-12 | Docs becoming stale after a runtime refactor | cross-module mapping | Medium | **Adopted** source references, baseline SHA, child Issue update contract |

*These severities are **risk-triage estimates**, not confirmed exploitable vulnerabilities. No exploit, chain transaction, key operation or adversarial test was run in this review.*

### Explicit exclusions

- **Rejected here:** change `markFinalized`, add ABI decoding gates, require `expectedRecoveries`, implement signer sandbox/taint tracking, change user-facing report schema. All require independent engineering Issues and regression tests.
- **Deferred:** online trust registry, key revocation, anti-replay persistent storage, operator attestation, external security audit, fuzz/mutation implementation.
- **Out of scope:** mainnet writes, real signing, secret handling, deployment/publishing, unrelated dependency upgrades.

### Security invariant checklist for the document

- [x] Integrity is separate from issuer authentication.
- [x] Issuer authentication is separate from truth of RPC evidence.
- [x] Observation/inclusion is separate from finality.
- [x] Rollup L2 status is separate from L1 settlement.
- [x] RAILGUN base EVM finality is separate from shielded post-state.
- [x] Victim balance reduction is separate from safe destination credit.
- [x] Static diagnostics are separate from an enforceable runtime boundary.
- [x] Existing negative tests are not confused with planned adversarial tests.
- [x] All 14 Issue-defined threats retained with residual ownership.

**Pass 3 result:** Proceed with *documentation-only* implementation. Publish a gap register and do not close the corresponding security work merely by documenting it.

## Pre-implementation decision

**APPROVED FOR DOCUMENTATION IMPLEMENTATION ONLY.** This is not approval for real asset movement, signer changes, production verification or a claim that any uncovered security gap has been remediated. Follow-up behavioral/security changes must use their own Issue, plan, review and tests.
