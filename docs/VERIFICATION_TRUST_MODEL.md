# EraScript Verification Trust Model

**Status:** Normative *target assurance contract* and **v0.18 implementation inventory**, not a certification.  
**Issue:** [#22](https://github.com/Hibiki49aaiii/EraScript/issues/22), parent [#15](https://github.com/Hibiki49aaiii/EraScript/issues/15).  
**Audited base:** `a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7` (`erascript-lang@0.18.0`).  
**Scope:** EVM, EVM rollups, Solana, Jito, Sui, RAILGUN and EVM rescue workflows.  
**Conflict order:** current user requirements → Issue #22 → current code/tests → architecture docs → installed SDK primary docs → assumptions (per `AGENTS.md`).

> **Safety boundary:** A consistent report hash, a claimed `VERIFIED_*` state or a valid Ed25519 report attestation does **not** independently prove that a transaction finalized, the observed RPC data was truthful, or assets reached the intended destination. Only the specific evidence-validation path and its stated trust assumptions can support those claims.

## 1. Normative terminology, status and trust predicates

**MUST** / **MUST NOT** define the desired high-assurance contract for a relying party. This text **does not claim** that every MUST is enforced by v0.18. The status annotations below are authoritative:

| Status | Meaning |
|---|---|
| **CURRENT** | Implementation logic is present in the audited source; its assurances are scoped to the actual inputs and checks. This does not mean independently penetration-tested. |
| **CONDITIONAL** | Control exists only on specific adapters, configurations or with explicitly trusted external providers. |
| **GAP** | Required assurance is absent or can be bypassed through a currently supported code path; a follow-up issue is required. |
| **OPERATIONS** | Callers/relying parties/operators, not EraScript v0.18, must provide or verify this condition. |
| **PROPOSED TEST** | Negative regression scenario defined here, **not executed** merely by documentation. |

Trust predicates are **not a total ordering** and MUST NOT be compressed into a universal boolean:

| Symbol | Name | What is established | What is **not** established |
|---|---|---|---|
| **I** | Report integrity | Report schema and deterministic self-contained hash agree with the report's fields | Producer identity; accuracy of inputs; independent evidence authenticity |
| **C** | Claimed state threshold | A report's stated rank meets a requested rank | Proof that the state was correctly derived |
| **A** | Issuer authentication | Detached signed envelope verifies under an explicitly trusted Ed25519 public key for exact report kind/hash/context and current validity window | Issuer honesty; RPC truth; revocation; nonce consumption |
| **E** | Evidence provenance/corroboration | Specific evidence was obtained or checked by an identified, freshness-bounded verifier within stated source and independence assumptions | Immutability beyond source trust; finalized success by itself |
| **F** | Chain/protocol outcome | Required family-specific execution success + finality/settlement checks under stated assumptions | Application's intended asset post-state or RAILGUN shielded state |
| **P** | Post-state objective | Bound before/after state proves configured recipient/token/amount or shielded outcome | Proof outside observed assets/addresses or across unobserved reorgs |

**v0.18 CLI reports I, C and A; it does not recompute E/F/P from raw chain evidence.** Thus the tuple `(I=true, C=true, A=true)` can coexist with `(E=?, F=?, P=?)`. Never infer unknown values to be true. The words "verified finality" in serialized reports are **claims** until the originating verifier's provenance and evidence checks are established.

`multichainEvidenceRef(kind, value, source?)` produces a deterministic hash over a supplied value. `source` is optional *descriptive metadata*, not proof that the named provider supplied that value. `MultichainVerificationCheck.status="pass"` is also report-producer-controlled unless the claim is independently validated. Source: [verification.ts](../src/chains/verification.ts).

## 2. Actors, assets and explicit trust boundaries

**Protected assets:** funds and recovery intent; private keys/signing authority; approved chain, sender, recipient, token, amount and calldata; evidence chain-of-custody and canonical block identity; trusted verifier public keys; RAILGUN proof-bound private state; privacy and secret-safe audit records.

| Boundary | From → to | Threat / data ownership | Required trust assumption |
|---|---|---|---|
| B1 | AI-authored `.era` / Node npm imports → runtime | Arbitrary imported code can read process environment or use independent SDK calls; static analyzer is not a sandbox | **GAP:** isolated secret/signer policy enforcement is a future workstream |
| B2 | Runtime/intent → local capability or external signer | Inputs, payload, amount, role, network and TTL may be caller-controlled | Enforce policy at authority-owning signer, not only a helper chosen by the caller |
| B3 | SDK → RPC, bundler, indexer, Jito, Sui Core API, RAILGUN wallet/broadcaster | Response can be stale, false, unavailable, replayed or shared across nominally distinct URLs | Independently established source identity, failure domain and freshness (**OPERATIONS** absent an attestation) |
| B4 | Provider observations → family verifier/quorum | Synthetic receipts/status/effects, contradictory blocks, post-signature state changes | Exact network/subject binding; per-family evidence and consensus/finality gates |
| B5 | Family verifier → report producer | Report state/checks may be asserted without complete provenance | Distinguish direct adapter, quorum-backed and external asserted outputs |
| B6 | Report JSON → `era verify` | Any author can rewrite JSON and recompute `reportHash` | Report parsing/hash checks I; claimed-state assertion C only |
| B7 | Detached signature + public key → attestation verifier | Attester may sign false facts; key compromised; expired/revoked key; nonce replay | Explicit trusted key, key lifecycle, freshness, revocation registry if required (**OPERATIONS**) |
| B8 | Parsed report → relying party / automation | Automation may treat `authenticated` as recovered funds | Relying party enforces E/F/P policy independently; fail closed on unknown |

```text
B1: UNTRUSTED                                  B2: POLICY / SIGNER AUTHORITY
AI/user-authored .era + native Node/npm  ──→  requested intent + optional capability
      | analyzer: static diagnostics only           | secrets cannot be protected by mere syntax
      v                                              v
B3: EXTERNAL EVIDENCE PRODUCERS               external signer / remote SDK
RPC A, RPC B, sequencer, relayer,            approved exact transaction/payload/role
Jito, Sui API, broadcaster, indexer                 |
      | receipts, status, effects, proofs            v
      +──────────────────────────────────────────────┘
      v
B4/B5: FAMILY-SPECIFIC VERIFIER
observation / quorum / canonicality / settlement / post-state gates
      | evidence-derived outcome (if source assumptions hold)
      v
B6: REPORT (self-consistency) → I / claimed C
      |
B7: DETACHED Ed25519 ATTESTATION → authenticated issuer A
      |
B8: RELYING PARTY evaluates E / F / P + own key/provider policies
      └─ MUST NOT treat (I,C,A) alone as objective recovery/finality proof
```

## 3. Existing report surfaces and state labels

**Rescue report:** `NOT_READY`, `READY_FOR_BROADCAST`, `RECOVERY_OBSERVED`, `VERIFIED_RECOVERY`. [verification.ts](../src/web3/verification.ts), [verification-io.ts](../src/web3/verification-io.ts).

**Multichain report:** `NOT_READY`, `READY_FOR_SUBMISSION`, `EXECUTION_OBSERVED`, `VERIFIED_FINALITY`. [verification.ts](../src/chains/verification.ts).

| Report state | Intended meaning | Minimum desired high-assurance evidence (normative, **not universally enforced**) |
|---|---|---|
| `READY_FOR_BROADCAST` / `READY_FOR_SUBMISSION` | Policy/intent/preparation gate | Valid exact intent, signer authority, nonexpired simulation, network/nonce/fee constraints; no proof of execution |
| `RECOVERY_OBSERVED` | Recovery-related state has been observed | Transaction/asset evidence plus coherent before/after snapshots, but reorg/finality caveat remains |
| `EXECUTION_OBSERVED` | Relevant execution observed | Matching receipt/status/effects, no execution error; no guarantee of settlement/private/recipient outcome |
| `VERIFIED_FINALITY` | Chain/protocol-specific finalized execution | Appropriate family strict verification evidence, replay/reorg/finality policy and rollup L1 settlement where required |
| `VERIFIED_RECOVERY` | Intended rescue outcome met | All F gates **and** safe-address/token/amount before/after evidence P, exact transaction-intent semantics |

**Current parsing behavior:** a hash-matching JSON report can be parsed; `assertMultichainVerificationState` and `assertVerificationRequirement` compare its **claimed** state. The multichain generic report constructor downgrades when any check is marked "fail", but its internal caller supplies both state and checks. v0.18 removes `createMultichainVerificationReport` from normal root/chains package barrels, *not* from repository-internal direct imports. [v0.18](V018_IMPLEMENTATION.md).

### `era verify` relying-party rule

For example:

```sh
era verify report.json --integrity-only
era verify report.json --require VERIFIED_FINALITY --json
era verify report.json --require VERIFIED_FINALITY \
  --attestation report.attestation.json \
  --trusted-key verifier-public.pem --json
```

The JSON fields `integrity`, `stateRequirementMet`, `authenticated` mean I, C, A respectively. In integrity-only mode the state requirement is not evaluated (`stateRequirementMet: null`). `ok: true` denotes that **requested CLI checks passed**, not end-to-end asset finality. Human output intentionally labels unsigned reports `INTEGRITY OK (UNAUTHENTICATED)`. Report authentication binds issuer, key fingerprint, version, report kind/hash, timestamps and nonce; it does not independently validate underlying RPC data. CLI verification reads a public key, not a private signing key. [cli.ts](../src/cli.ts), [verification-attestation.ts](../src/verification-attestation.ts), [attestation ADR](../.ai/decisions/2026-08-31-detached-verification-attestation.md).

**OPERATIONS:** Trust-root distribution and rotation; compromised-key revocation; consumed-nonce registry; report retention and acceptable age must be supplied externally. Offline Ed25519 verification alone cannot provide those properties. Public keys MUST originate in a trusted out-of-band channel when authentication matters.

## 4. Evidence-to-state assurance matrix (current reality vs desired contract)

Rows reflect **specific code paths**, not an unconditional property of a chain family. "Direct" means application-provided typed observations may still need externally established provenance; "quorum" means the current code checks a multi-provider consistency policy but cannot by itself guarantee providers are independent operators.

| Path / state promoted | v0.18 present validation (**CURRENT/CONDITIONAL**) | Additional assurance requirement / explicit limitation | Evidence source, main code |
|---|---|---|---|
| EVM **direct**, `EXECUTION_OBSERVED` | Receipt success, matching chain profile | Caller-provided IncludedTx/receipt provenance and canonical block must be independently corroborated | `evmExecutionVerificationReport` in `src/chains/verification-adapters.ts` |
| EVM **direct**, `VERIFIED_FINALITY` | EVM transaction `state === "finalized"` + success receipt | **GAP:** `markFinalized` can change state without checking finalized head; direct report does not require quorum | `src/web3/tx.ts` → direct adapter |
| EVM **quorum**, promoted finalized tx | Default at least 2 unique provider IDs, matching receipt, canonical block check, confirmations per verifier; finalized head required when `requireFinalized=true` | Finalized evidence MUST be requested; real provider/operator independence remains **OPERATIONS**; quorum promotion is stronger than direct state | `src/chains/evm-execution-quorum.ts` |
| EVM **rollup**, L2 `EXECUTION_OBSERVED` | Successful L2 receipt; optional settlement anchor | L2 finalization is not L1-finalized settlement | `src/chains/verification-adapters.ts`, `src/chains/rollup-finality.ts` |
| EVM **rollup**, `VERIFIED_FINALITY` | Exact L2 tx/block/profile binding and `l1-finalized` settlement *reported* by protocol adapter | Verify L1 evidence provenance and adapter assumptions; state cannot be inferred from L2 receipt or quorum alone | `src/chains/{op-stack-finality,arbitrum-finality,rollup-finality}.ts` |
| Solana **direct**, `VERIFIED_FINALITY` | Successful simulation, supplied signature status found without error and `confirmationStatus === "finalized"` | Trust of the status source is conditional; blockhash expiry/durable nonce/ALT evidence may originate from earlier gates | `solanaSubmissionVerificationReport` in adapters |
| Solana **quorum**, `VERIFIED_FINALITY` | Signature/profile/network/slot consistency, all observed successful and finalized; minimum provider policy | `requireBlockIdentity` defaults to false: do not claim block identity proof universally; independent operator control is external | `src/chains/solana-execution-quorum.ts`, `solanaQuorumVerificationReport` |
| Jito **direct**, `VERIFIED_FINALITY` | Submitted bundle and supplied Jito status marked finalized | Bundle ID, landed status or supplied finalized status are not independent verification that **every expected signature** finalized | `jitoBundleVerificationReport` |
| Jito **strict**, `VERIFIED_FINALITY` | Exact expected signature list and status-set binding, optional landed slot equality, finalized Solana quorum for each expected signature | Source independence and any unrepresented application state remain separate | `jitoBundleVerificationReportWithSolanaQuorum` |
| Sui **direct**, `VERIFIED_FINALITY` | Successful transaction, supplied checkpoint evidence present | Externally sourced checkpoint/digest/effects authenticity and checkpoint match require caller assurance | `suiExecutionVerificationReport` |
| Sui **quorum**, `VERIFIED_FINALITY` | Successful digest/profile/network quorum with checkpoint agreement (default requires checkpoint) | `requireEffectsIdentity` defaults false; do not claim effects-digest identity required in all configurations | `src/chains/sui-execution-quorum.ts`, `suiQuorumVerificationReport` |
| RAILGUN **direct**, `VERIFIED_FINALITY` | Base EVM tx `state === finalized`, success receipt, proof-binding hash and all supplied private assertions passed | Base finality state can be caller promoted; assertions may come from trusted external wallet/indexer; no automatic independent quorum | `railgunVerificationReport` in `src/privacy/verification.ts` |
| RAILGUN **strict**, `VERIFIED_FINALITY` | Finalized successful EVM quorum, matching proof/base tx binding, all private assertions; rollup L1 settlement when profile demands | Private-state source remains conditional; proof binding is not independent proof of balance without trusted observer | `railgunVerificationReportWithEvmQuorum` |
| EVM **rescue**, `VERIFIED_RECOVERY` | Defined victim-zero/native-dust invariants; safe delta **only** for explicitly configured expectedRecoveries; caller `finality === "finalized"` | **GAP:** destination credit not mandatory with default []; caller-supplied finality lacks independent provenance; require exact token recipient/amount ABI semantics, coherent snapshots | `src/web3/{workflow,verification}.ts` |

**EVM quorum nuance:** `buildEvmExecutionQuorum` defaults `requireFinalized=false`. Do not confuse successfully building a quorum at `included`/`confirmed` with having a `finalized` quorum. A transaction marked finalized through `promoteEvmExecutionWithQuorum` is evidence-bound to its preceding quorum; the exported `markFinalized` helper alone is not.

**Sui quorum nuance:** checkpoint evidence is required by the default quorum policy, but optional effects-identity binding must be explicitly requested for an assurance that all providers agreed on an effects digest.

**Privacy nuance:** RAILGUN is an overlay, not an independent consensus chain. A valid proof, Waku submission ID, or base-chain finalized receipt is insufficient alone to prove shielded post-state.

## 5. Evidence provenance contract for high-assurance consumers

For each critical assertion, an evaluator MUST determine:

1. **Identity:** chain family + immutable network/genesis/chainId/profile, execution subject (EVM hash, Solana signature, Sui digest, Jito signature set or RAILGUN proof binding) and, where applicable, recipient/token/amount and nonce.
2. **Origin:** where bytes were observed (RPC client, Sui Core API, Jito, wallet SDK, signer, indexer, local state reader); distinguish independently fetched observations from externally supplied object literals.
3. **Provenance:** who operates this provider; whether endpoints share infra or data feeds; whether the observation came through the intended bound provider. A descriptive `source` string or unique provider ID is insufficient.
4. **Freshness:** observation time, allowed staleness, chain height/slot/checkpoint, expiration and reorg horizon. Local timestamps are not authenticated block time.
5. **Consistency:** exact hash/signature/digest, block identity, network, profile, canonicality and chain/protocol-specific result.
6. **Completeness:** all expected transactions/outputs/private assertions appear; explicitly enumerate missing data. Partial quorum/one failed verifier is not a successful strict quorum.
7. **Artifact binding:** preserve exact payload/hash, attestation provenance and evidence storage necessary for later audit. A hash-only evidence reference without retrievable, trusted underlying bytes is insufficient for independent re-verification.
8. **Data minimization:** redact private keys, raw credentials, customer addresses/data when confidential, provider URL secrets and protected proof material. Never include secrets in reports, issues or CI artifacts.

**Fail-closed target:** Missing, stale, malformed or contradictory required evidence MUST block the requested E/F/P claim (or retain a clearly weaker observed/readiness state). A warning MUST NOT be silently elevated to `VERIFIED_*` by the relying party. What is currently enforced depends on the matrix above; this Issue does **not** add enforcement.

## 6. Rescue outcome and signer contract

**Desired recovery objective:**
- Establish safe destination `safe`, victim `victim`, exact chain, token contract, token decimals/identity and minimum recoverable amounts prior to authorization.
- Before and after snapshots MUST be tied to the same network and canonical chain history with block numbers/hashes and a defined freshness/finality policy.
- For every expected asset, verify an appropriate successful transfer or independently observed **positive safe-wallet balance delta**. A reduction to victim balance zero without safe credit MUST NOT imply `VERIFIED_RECOVERY`.
- Decode actual token transfer calldata and compare recipient and amount to declared `token-rescue` action. A transaction addressed to the token contract is **not** proof that its `transfer` / `transferFrom` recipient equals `safe`.
- Prove nonce, hash, receipt, canonicality and finality using the chosen chain-family evidence path; never trust only the caller string `finality: "finalized"`.
- Account for fees/deflationary tokens, internal contract transfers, rebases, partial recoveries and any other token mechanics explicitly. If a measured delta is incompatible with expected net receipts, report incomplete/unknown rather than success.

**CURRENT/GAP mapping:** `defineRescueWorkflow` defaults `expectedRecoveries` to [], and `rescueFinalStateInvariants` then adds no mandatory safe-delta invariant. `assertActionMatchesTransaction` checks the outer token contract address, not decoded token-recipient calldata. `verifyCompletedRescue` trusts caller-provided `finality`. These are **source-observed assurance gaps**, not empirically exploited findings, and require separate behavioral Issues and negative tests. Existing tests may explicitly configure expectedRecoveries and thus not cover the default gap.

**Signer authority:** `src/web3/capabilities.ts` enforces policy for code paths using `signSimulatedWithCapability`; separate `node:` imports or third-party SDK paths are not sandboxed. `src/chains/external-signer.ts` binds request ID, payload/context, role/signer, challenge and a claimed `respondedAtMs`. The multichain path presently checks the actual clock before awaiting the signer, then validates a *response-supplied* timestamp; an independent post-await wall-clock expiry check is a proposed future gate. A downstream verifier may be caller supplied; the trustworthiness of that verifier MUST be explicit. No real signature operations are authorized by this document.

## 7. Threat register: TM-01–TM-14

"Existing" means **current code control present**, not proof the threat is entirely mitigated. "Owner" is the proposed future workstream from parent #15, not an assigned GitHub user.

| Threat | Adversary / asset / boundary | Existing control and code reference | Residual risk / proposed owner |
|---|---|---|---|
| **TM-01** Forged self-consistent report | Report author changes `state` and hash; B6 | Hash/parser + distinct CLI claim in `src/chains/verification.ts`, `src/cli.ts` | **OPERATIONS:** never accept I/C alone; adversarial verification tests |
| **TM-02** Signed false external evidence | Compromised verifier signs incorrect data; B4–B7 | Ed25519 binds report only (`src/verification-attestation.ts`) | **GAP:** evidence provenance and independent verification; attestation cannot cure lying source |
| **TM-03** Fake provider independence | RPC IDs share malicious operator; B3/B4 | Min provider IDs, consistent observations in quorum modules | **OPERATIONS/GAP:** operator-level independence attestation and Byzantine tests |
| **TM-04** Synthetic finalized lifecycle state | Caller supplies receipt and finalized state; B4/B5 | Strict EVM quorum route exists | **GAP:** direct `markFinalized` / adapter can rely on caller state; finality hardening |
| **TM-05** Reorg / L2-L1 confusion | Reorged L2 success reported as settled; B4 | Rollup settlement stage and binding in `src/chains/rollup-finality.ts` | **CONDITIONAL:** trusted protocol adapter and L1 proof; rollup/reorg testing |
| **TM-06** Funds gone but no safe credit | Victim depleted by attacker or burn; B5 | Configurable safe-delta `expectedRecoveries` invariant | **GAP:** default [] and caller finality; rescue invariant hardening |
| **TM-07** Incorrect token calldata recipient | Transaction targets token contract but transfers elsewhere; B2/B5 | Outer to/from match in workflow action | **GAP:** ABI recipient/amount validation and recovery post-state tests |
| **TM-08** Expired/replayed signing response | External signer returns stale claimed timestamp/context; B2 | Request ID/challenge/context/hash signature verification callback | **GAP:** independent post-await clock check and replay service policy; signer lifecycle |
| **TM-09** Raw Node import bypass | AI/dependency bypasses source analyzer or policy wrappers; B1/B2 | Syntactic `analyzeWeb3Source`; capability helpers | **GAP:** enforce authority outside Node process; secret-flow/runtime isolation |
| **TM-10** Backend ID mistaken for finality | Jito bundle or Sui/Solana response is partial/failing; B3/B4 | Strict Jito signature-set+Solana quorum, Sui/Solana quorum paths | **CONDITIONAL:** direct adapters may trust supplied status; adversarial test suite |
| **TM-11** RAILGUN missing private state | Base EVM succeeded but shielded outcome failed; B4/B5 | Private assertions + strict EVM quorum route | **CONDITIONAL:** trusted private state reader, proof provenance; privacy quality |
| **TM-12** Compromised/stale attestation key | Attacker controls signing key or reuses signed envelope; B7 | Explicit trusted key, expiry, nonce-bound Ed25519 | **OPERATIONS:** key rotation/revocation, nonce consumption, replay policy |
| **TM-13** Cross-chain/stale snapshot replay | Proof from different chain/subject/time; B3–B5 | Profile/subject, block, slot/checkpoint identity checks in strict paths | **CONDITIONAL:** freshness limits and independent canonicality; new negative tests |
| **TM-14** Secret/data leakage | Logs/issues/artifacts reveal key/provider credential; B1/B8 | Some provider URL omission and analyzer checks | **GAP/OPERATIONS:** isolated signing, redaction and secret-safe observability |

Severity guidance: TM-04/06/07/09 and wrong-root trust are potentially high consequence for fund-moving automation, but **no live exploit, exploitability score or funds-loss claim is established by this documentation**.

## 8. Verification traceability and executable negative-case catalog

**Existing test source references** (presence checked against base tree; listed tests not rerun by this doc PR):

| Surface | Existing test files | Coverage interpretation |
|---|---|---|
| CLI report state & attestation | `test/cli-verify.test.ts`, `test/cli-multichain-verify.test.ts`, `test/verification-attestation.test.ts`, `test/cli-verification-attestation.test.ts` | I/C/A behavior, not independent chain truth |
| Public constructor/API surface | `test/public-verification-api.test.ts`, `test/multichain-verification.test.ts` | Public exports and internal fixture parsing |
| EVM finality/quorum/provider binding | `test/evm-execution-quorum.test.ts`, `test/evm-provider-routing.test.ts` | Deterministic observed/provider contract, not proof of operator independence |
| Solana/Jito | `test/solana-execution-quorum.test.ts`, `test/solana-lifetime-alt.test.ts`, `test/multichain-finality-private-state.test.ts` | Family lifecycle and configured constraints |
| Sui | `test/sui-execution-quorum.test.ts`, `test/sui-state.test.ts` | Effects/checkpoint and configured quorum |
| RAILGUN | `test/railgun-quorum-verification.test.ts`, `test/railgun-wallet-sdk-private-state.test.ts` | Proof binding and private-state transitions under fixtures |
| Rescue, diagnostics and signing | `test/web3-workflow.test.ts`, `test/web3-verification.test.ts`, `test/analyze.test.ts`, `test/multichain-signing.test.ts` | Configured invariants/static analysis; not general runtime sandbox |

**Proposed, not executed** test cases for follow-up Issues:

| ID | Fixture / fault injection | Expected high-assurance outcome |
|---|---|---|
| NT-01 (TM-01/02) | Self-consistent forged hash + fake `VERIFIED_FINALITY`; optionally genuine issuer signature on false fixture | I and perhaps A may pass, E/F must remain unknown and relying policy rejects |
| NT-02 (TM-03) | Two provider IDs using the same upstream source; split-brain canonical hashes | Existing quorum checks disagreeing receipts; operational independence policy rejects common control |
| NT-03 (TM-04) | Synthetic receipt → `markConfirmed` → `markFinalized` → direct EVM report without finalized-head query | Strong finality gate rejects; current direct behavior documented as gap |
| NT-04 (TM-05) | Valid L2 inclusion without L1 settlement; mismatched L1 anchor; reorg | No L1-finalized assurance |
| NT-05 (TM-06) | Victim token becomes zero, safe token delta stays zero; `expectedRecoveries` omitted | No `VERIFIED_RECOVERY` in target contract; source currently has gap |
| NT-06 (TM-07) | Token contract `to` matches but ERC-20 decoded recipient != safe / amount mismatch | Reject action/transaction binding; existing outer-only check is gap |
| NT-07 (TM-08) | Delayed signer response after wall-clock expiry with claimed in-window respondedAtMs; request replay | Rejected by future independent TTL/nonce gate |
| NT-08 (TM-09) | Alias `process.env` / imported third-party SDK bypasses analyzer + capability wrapper | Protected execution/signing authority refuses; static-only guard insufficient |
| NT-09 (TM-10) | Jito landed but one expected signature has no finalized Solana quorum | Strict Jito verification rejects `VERIFIED_FINALITY` |
| NT-10 (TM-10/13) | Solana wrong slot/signature/expired nonce/blockhash or Sui failed effects/mismatched checkpoint | Quorum and applicable lifecycle gates refuse finality |
| NT-11 (TM-11) | RAILGUN valid base tx but wrong proof binding/failed shielded-state assertion | Not strict RAILGUN `VERIFIED_FINALITY` |
| NT-12 (TM-12) | Valid signed report under revoked key/consumed nonce outside allowed reuse policy | Operational trust registry rejects despite offline A=true |
| NT-13 (TM-13) | Correct hash from wrong chain/profile or stale canonical block | Evidence provenance/finality gate rejects or returns unknown |
| NT-14 (TM-14) | Fixture contains inert canary values in logs, diagnostics and serialized reports | No canary in emitted artifacts; avoid real secrets |

All test fixtures MUST be deterministic and local/ephemeral. Do not submit network writes, transact real assets, sign with a customer key, or store sensitive provider endpoints. Claims about non-existing test coverage must remain `PROPOSED TEST`.

## 9. Assurance coverage and ownership matrix

The matrix lists normative requirements from [Issue #22](https://github.com/Hibiki49aaiii/EraScript/issues/22); "Current" is bounded by source inspection, not execution here.

| FR | Specification section | Primary code anchor | Current status / owner |
|---|---|---|---|
| FR-01 vocabulary and guarantee contract | 1 | `src/chains/verification.ts` | **CURRENT** I/C/A; **OPERATIONS/GAP** independent E/F/P |
| FR-02 reports / attestations | 1, 3 | `src/{verification-attestation,cli}.ts` | **CURRENT** detached signature and CLI semantics (#16/#18) |
| FR-03 threat model | 2, 7 | all mapped files | **CURRENT docs**, **GAP** follow-up controls |
| FR-04 evidence provenance | 2, 5 | quorum/adapter modules | **CONDITIONAL**, source/operator identity **OPERATIONS** |
| FR-05 state gates | 3, 4 | report builders + `src/web3/verification.ts` | **GAP** direct/caller-defined terminal promotion |
| FR-06 family gates | 4 | EVM/Solana/Sui/Jito/RAILGUN/rollup adapters | **CONDITIONAL**, explicit path/policy dependent |
| FR-07 identities and independence | 2, 5, 6 | `src/chains/external-signer.ts`, quorum modules | **CONDITIONAL/GAP/OPERATIONS** |
| FR-08 AI runtime boundary | 2, 6 | `src/web3/{analyze,capabilities}.ts`, runtime loader | **GAP** sandbox/taint; current helper enforcement conditional |
| FR-09 fail closed | 4, 5, 6 | strict quorum and report adapters | **CONDITIONAL/GAP** where direct claims remain |
| FR-10 compatibility and adoption | 3, 10 | CLI / schemas | **CURRENT docs only**, no API changes |
| FR-11 traceability | 7–9 | existing tests above | **CURRENT docs**; adversarial execution **PROPOSED TEST** |

**Follow-up ownership (deduplicate under #15 before creating new Issues):**
- **P0-02 rescue semantics:** NT-05/06 and canonical receiving-state proof; high consequence.
- **P0-04 finality evidence:** NT-03/04, single-adapter trust claims and unavoidable quorum/provenance gates.
- **P0-05 runtime/signer confinement:** NT-07/08 and external authority.
- **P0-06 source secret-flow analyzer:** alias/dataflow bypass; not a substitute for confinement.
- **P1 adversarial/quorum/quality:** NT-01/02/09/10/11/13, operator independence and family scenarios.
- **OPERATIONS security policy:** NT-12/14, key lifecycle, trusted RPC inventory and audit retention.

## 10. Compatibility, examples and limits

**No code, report JSON, hash, attestation or public-API change is mandated by this Issue.** Existing legitimate `era verify` consumers retain their CLI behavior; human operators should distinguish an authenticated *statement* from an independently validated *event*.

**Unsafe decision:** "The report says `VERIFIED_RECOVERY` and the attestation verifies, so release funds or close the incident."

**Safer decision:** "The report is internally consistent and signed by a trusted issuer. Before accepting completed recovery, independently establish the verifier's provenance, finalized chain observations, transaction semantics, and correct safe-address asset delta; otherwise keep the incident pending."

**Privacy caveat:** Don't require publishing private recipient balances or raw RAILGUN proof content in a public report. Bind a suitably privacy-preserving verification artifact to a controlled auditor while preserving operational confidentiality.

**Known limitations:** provider/operator trust, honest attesters, endpoint reliability, compromised client runtime, token peculiarities, cross-chain bridges and offline revocation cannot be completely solved by static documents. They remain explicit trust assumptions or separate implementation tasks. A green unit test suite also does not establish live production correctness.

**Review/update rule:** On any modification to the source anchors here, the corresponding Issue/PR MUST determine whether the matrices, expected negative cases and residual risk remain accurate. Track actual runtime remediation in separate Issue-based work; do not close security findings because a document describes them.
