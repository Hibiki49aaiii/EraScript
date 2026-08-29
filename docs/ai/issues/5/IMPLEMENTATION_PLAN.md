# Issue #5 — Implementation Plan

Issue: #5  
Base Commit SHA: `4a5174b590f648971087091e751b4b91b2aee890`  
Target branch: `main`

## Goal

Bring non-EVM post-execution verification closer to the v0.9 high-assurance trust model without erasing chain-family semantics.

## Current architecture

```text
EVM
  v0.8 provider-bound execution
  -> v0.9 strict multi-provider execution quorum

Solana
  submitted signature
  -> one RPC getSignatureStatuses
  -> family-neutral report

Jito
  bundle submission/status
  -> one Block Engine status
  -> family-neutral report

Sui
  executeTransaction
  -> one Core API result
  -> one waitForTransaction checkpoint
  -> family-neutral report

RAILGUN
  overlay submission
  -> base EVM execution
  + proof-bound private state
  -> family-neutral report
```

## Target architecture

```text
SolanaSubmitted
  + provider A/B/... observations
  -> SolanaExecutionQuorum
  -> strict Solana report

JitoBundle
  + Jito backend status
  + SolanaExecutionQuorum(expected tx signatures)
  -> strict Jito report

SuiExecuted
  + provider A/B/... transaction/effects/checkpoint observations
  -> SuiExecutionQuorum
  -> strict Sui report

RAILGUN
  + matching EvmExecutionQuorum(base tx)
  + proof-bound PrivateStateEvidence
  -> strict RAILGUN report
```

## Design decisions

### 1. No GenericQuorum<T>

Rejected.

Reason:
- Solana commitment/slot semantics are not EVM block confirmation semantics.
- Sui effects/checkpoints are not receipt/block-hash semantics.
- RAILGUN is an overlay and has no independent consensus finality.

Use separate family-specific types/modules and share only conventions.

### 2. Solana slot agreement

For a finalized signature, every provider must agree on:
- signature,
- execution success/error,
- slot,
- finalized commitment.

Providers observed at different wall-clock times may have different `confirmations` values; confirmations are not part of exact consensus identity.

Where available, a provider may additionally return block identity for the observed slot. Strict block-identity policy can require it, but basic finalized quorum does not invent a blockhash requirement for clients that expose only signature status.

### 3. Sui checkpoint agreement

For a successfully executed transaction, every provider must agree on:
- digest,
- success/failure,
- effects status identity used by EraScript,
- checkpoint when finality is required.

The source execution transaction remains the semantic anchor. Provider observations re-read/confirm that digest.

### 4. Jito strict finality

Jito remains backend evidence.

A strict Jito report may only claim `VERIFIED_FINALITY` when:
- Jito status identifies the expected landed transaction set,
- every expected transaction signature has a matching finalized Solana quorum.

No Jito-only finality upgrade.

### 5. RAILGUN strict finality

RAILGUN is an EVM overlay.

Strict RAILGUN verification requires:
- submission/proof binding,
- matching base EVM v0.9 quorum,
- base transaction success/finality,
- proof-bound private-state assertions.

No new RAILGUN consensus quorum.

## Diagnostics

Reserve fresh ranges after ES4771:

### Solana quorum — ES4780–ES4789
- ES4780 InvalidSolanaQuorumPolicy
- ES4781 SolanaQuorumProviderProfileMismatch
- ES4782 DuplicateSolanaQuorumProvider
- ES4783 SolanaQuorumStatusUnavailable
- ES4784 SolanaQuorumStatusConflict
- ES4785 SolanaQuorumNotFinalized
- ES4786 SolanaQuorumSignatureMismatch
- ES4787 SolanaQuorumBlockIdentityConflict
- ES4788 SolanaQuorumObservationIntegrityMismatch
- ES4789 SolanaExecutionQuorumIntegrityMismatch

### Sui quorum — ES4790–ES4799
- ES4790 InvalidSuiQuorumPolicy
- ES4791 SuiQuorumProviderProfileMismatch
- ES4792 DuplicateSuiQuorumProvider
- ES4793 SuiQuorumTransactionUnavailable
- ES4794 SuiQuorumDigestConflict
- ES4795 SuiQuorumExecutionConflict
- ES4796 SuiQuorumCheckpointConflict
- ES4797 SuiQuorumNotCheckpointed
- ES4798 SuiQuorumObservationIntegrityMismatch
- ES4799 SuiExecutionQuorumIntegrityMismatch

### Cross-backend strict binding — ES4800+
- ES4800 JitoSolanaQuorumMismatch
- ES4801 JitoSolanaQuorumMissing
- ES4802 RailgunEvmQuorumMismatch
- ES4803 RailgunEvmQuorumMissing

Exact usage may be narrowed during implementation; registry collision test remains authoritative.

## Changed/new files

New:
- `src/chains/solana-execution-quorum.ts`
- `src/chains/sui-execution-quorum.ts`
- `test/solana-execution-quorum.test.ts`
- `test/sui-execution-quorum.test.ts`
- `docs/V10_IMPLEMENTATION.md`
- `docs/ai/issues/5/HUMAN_UNDERSTANDING.md`

Modified:
- `src/chains/index.ts`
- `src/chains/verification-adapters.ts`
- `src/privacy/verification.ts`
- Jito/RAILGUN verification tests
- `README.md`
- package/CLI only after post-review and green implementation CI

## Error handling

- Provider exceptions become unavailable Evidence, not persisted raw error text.
- Missing provider result never counts toward success.
- No majority fallback.
- Integrity hash mismatch fails before report construction/use.
- Existing low-level single-provider reports remain backward compatible.

## Security

- Provider IDs remain non-secret labels.
- Endpoint/auth material is never included in Evidence.
- Distinct IDs do not prove physical infrastructure independence; deployment policy remains responsible for actual route diversity.
- RAILGUN private-state assertions are not replaced by base-chain quorum.
- Jito backend status is not treated as consensus finality.

## Testing strategy

Solana:
- matching finalized quorum
- missing status
- execution error disagreement
- slot disagreement
- non-finalized provider
- duplicate provider
- provider-order-independent hash
- tamper tests

Jito:
- strict binding to all expected Solana signature quorums
- missing quorum
- wrong signature quorum
- non-finalized quorum

Sui:
- matching successful checkpoint quorum
- digest disagreement
- success/failure disagreement
- checkpoint disagreement/missing
- duplicate provider
- provider-order-independent hash
- tamper tests

RAILGUN:
- matching finalized EVM quorum + private state => strict finality
- wrong chain/tx quorum reject
- missing quorum does not satisfy strict finality
- private state remains mandatory

Regression:
- diagnostic registry
- existing v0.6-v0.9 tests
- `npm run check`
- `npm run test:core`
- final Core CI

## Implementation order

1. Solana observation/quorum.
2. Solana tests.
3. Sui observation/quorum.
4. Sui tests.
5. Strict Jito report binding.
6. Strict RAILGUN report binding.
7. Cross-backend tests.
8. Post-Implementation Review.
9. Documentation.
10. Version promotion to 0.10.0.
11. Final Core CI.
12. Issue closure.

## Rollback

All work is additive. Existing single-provider APIs/report functions remain available. New strict functions can be removed without data migration.

## Known risks

- Upstream SDK response shape drift.
- Provider timing differences being over-constrained.
- Sui effects normalization losing material differences.
- Jito transaction-set/signature binding mistakes.
- RAILGUN submission hash semantics differing by Broadcaster/self-submit mode.

## Pre-Implementation Review

### Pass 1 — Requirements

Adopted:
- family-specific quorum rather than generic abstraction.
- strict fail-closed behavior.
- backward-compatible low-level paths.
- Jito and RAILGUN as bindings to base-family trust, not separate consensus.

No requirement is currently blocked.

### Pass 2 — Architecture

Adopted:
- mirror v0.9 deterministic hashing/integrity conventions.
- reuse `SolanaKitClientLike`, `SuiClientLike`, family-neutral verification reports and v0.9 EVM quorum.
- new modules rather than expanding adapter files into mixed responsibilities.

Rejected:
- changing existing single-provider report functions to silently require quorum; this would break compatibility.

### Pass 3 — Risk

Adopted:
- do not persist raw provider errors.
- do not compare Solana confirmation counts as exact consensus identity.
- require exact slot agreement for one signature.
- require checkpoint agreement for Sui strict finality.
- require every expected Jito transaction signature to be represented by Solana quorum.
- require proof-bound private-state Evidence independently for RAILGUN.

Out of scope:
- proving physical provider independence.
- multi-indexer RAILGUN private-state quorum.


## Post-Implementation Review / Implementation Result

### Implemented

- Solana provider-scoped execution observations and strict unanimous `SolanaExecutionQuorum`.
- Jito strict report binding to exact expected transaction signatures, landed slot, and finalized Solana quorum for every expected signature.
- Sui provider-scoped transaction/effects/checkpoint observations and strict unanimous `SuiExecutionQuorum`.
- RAILGUN strict report binding to matching base-EVM `EvmExecutionQuorum` plus independent proof-bound private-state Evidence.
- Runtime observation/quorum integrity re-validation.
- Family-specific diagnostics and deterministic regression coverage.

### CI hardening findings

The initial implementation exposed strict-TypeScript/test integration issues that were corrected without weakening the architecture:

1. Family-neutral verification `details` intentionally remains scalar-only; quorum provider/hash arrays are deterministically serialized rather than widening the report schema.
2. Intentionally mismatched RAILGUN quorum fixtures now remain type-correct/brand-correct and fail through integrity/binding checks.
3. Solana optional `getBlock` observation is represented as an explicit structural test-client extension.
4. Jito diagnostics distinguish unexpected/wrong quorum (`ES4800`) from a missing expected signature quorum (`ES4801`).
5. Sui conflict tests use valid alternate 32-byte transaction digests so they reach quorum conflict logic rather than parser rejection.

### Verified implementation baseline

```text
commit: 09b6153d55c401962187ce28b35dd57ab18dd3b0
Core CI run: 353
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 171
pass: 171
fail: 0
diagnostic registry: PASS
```

### Review conclusion

- Requirements: satisfied.
- Architecture: family-specific semantics preserved; no GenericQuorum abstraction introduced.
- Security: fail-closed unanimity and evidence-integrity checks preserved.
- Backward compatibility: existing low-level/single-provider APIs remain available.
- Remaining release task: promote package/CLI to `0.10.0`, run final Core CI, record final baseline, close Issue #5.
