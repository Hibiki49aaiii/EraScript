# EraScript v0.10 — Cross-Family Execution Quorum

Status: release candidate  
Issue: #5  
Base Commit SHA: `4a5174b590f648971087091e751b4b91b2aee890`

## 1. Problem

v0.9 added strict multi-provider post-broadcast receipt/canonicality/confirmation/finality quorum for EVM.

The rest of the supported execution families still had a trust asymmetry:

- Solana finality could be accepted from one RPC signature-status observation.
- Jito bundle status was backend evidence without an explicit independent Solana quorum requirement.
- Sui execution/effects/checkpoint evidence could come from one client.
- RAILGUN strict recovery evidence did not explicitly require the v0.9 base-EVM execution quorum.

For AI-generated or high-value automation, post-execution trust must be strengthened without pretending that EVM receipts, Solana slots, Sui effects/checkpoints, and RAILGUN private-state proofs share one generic consensus model.

## 2. Safety model

v0.10 uses a shared **safety convention** but preserves native chain semantics.

Common rules:

- minimum two distinct provider IDs by default,
- no majority fallback,
- every supplied provider must satisfy policy,
- unavailable evidence cannot prove success,
- provider input order does not affect the quorum hash,
- observation/quorum hashes are verified before downstream use,
- endpoint URLs, credentials, and raw provider errors do not enter Evidence,
- existing low-level/single-provider APIs remain available.

No generic `GenericQuorum<T>` is introduced.

## 3. Architecture

```text
SolanaSubmitted
  -> provider-scoped signature/slot/commitment observations
  -> SolanaExecutionQuorum
  -> strict Solana report

JitoBundle
  -> Jito landed exact signature set / slot
  + finalized SolanaExecutionQuorum for every expected signature
  -> strict Jito VERIFIED_FINALITY

SuiExecuted
  -> provider-scoped digest/effects/checkpoint observations
  -> SuiExecutionQuorum
  -> strict Sui report

RAILGUN submission
  -> matching EvmExecutionQuorum(base transaction)
  + proof-bound PrivateStateEvidence
  -> strict RAILGUN VERIFIED_FINALITY
```

Implementation modules:

- `src/chains/solana-execution-quorum.ts`
- `src/chains/sui-execution-quorum.ts`
- `src/chains/verification-adapters.ts`
- `src/privacy/verification.ts`

## 4. Solana execution quorum

### Provider binding

`bindSolanaExecutionVerifier()` binds:

- stable non-secret provider ID,
- Solana profile/network,
- structural Solana RPC client,
- optional expected genesis hash.

### Observation

`observeSolanaExecutionWithProvider()` records normalized Evidence for one submitted signature:

- provider ID,
- profile/network,
- signature,
- availability,
- execution success/failure/unknown,
- observed slot,
- confirmation status,
- optional block identity,
- deterministic observation hash.

Provider exceptions become `unavailable` Evidence. Raw endpoint/error text is not persisted.

### Quorum

`buildSolanaExecutionQuorum()` is fail-closed.

Default:

- at least two distinct providers,
- minimum finalized commitment,
- unanimous successful observation,
- one exact slot,
- optional strict block-identity agreement,
- no majority fallback.

Confirmation count is deliberately not exact consensus identity because providers may observe the same transaction at slightly different wall-clock times.

The quorum hash is provider-order independent.

### Integrity

`assertSolanaExecutionQuorumIntegrity()` recomputes observation/quorum hashes before strict reporting.

## 5. Jito trust binding

Jito remains an execution backend, not independent consensus/finality.

`jitoBundleVerificationReportWithSolanaQuorum()` can claim `VERIFIED_FINALITY` only when:

1. the bundle was constructed with an exact expected Solana transaction-signature set,
2. Jito status reports that exact set,
3. the observed landed slot matches every supplied Solana quorum,
4. every expected signature has exactly one matching Solana quorum,
5. every matching quorum is finalized.

Diagnostic semantics are intentionally specific:

- unexpected/extra/wrong binding -> `ES4800 JitoSolanaQuorumMismatch`
- missing expected signature quorum -> `ES4801 JitoSolanaQuorumMissing`

A bundle ID, Jito `Landed`, or Jito confirmation label alone never upgrades finality.

## 6. Sui execution quorum

### Provider binding

`bindSuiExecutionVerifier()` binds one provider/client to:

- stable non-secret provider ID,
- Sui profile/network,
- Sui client.

### Observation

`observeSuiExecutionWithProvider()` re-reads the executed digest and normalizes:

- availability,
- digest,
- success/failure semantics,
- effects identity,
- checkpoint,
- deterministic observation hash.

Invalid transaction digests fail at the Sui native 32-byte digest parser rather than being normalized as arbitrary strings.

### Quorum

`buildSuiExecutionQuorum()` requires:

- minimum two distinct provider IDs by default,
- exact digest agreement,
- exact execution success/failure agreement,
- effects identity agreement when policy requires it,
- checkpoint agreement when policy requires checkpoint finality,
- every supplied provider to satisfy the policy.

There is no majority fallback.

`assertSuiExecutionQuorumIntegrity()` re-validates observation/quorum integrity before strict reporting.

## 7. RAILGUN strict binding

RAILGUN remains an EVM privacy overlay.

`railgunVerificationReportWithEvmQuorum()` requires all of:

- RAILGUN submission/proof binding,
- explicit base transaction binding,
- matching v0.9 `EvmExecutionQuorum`,
- successful/finalized base-EVM execution according to policy,
- proof-bound private-state Evidence,
- all required private-state assertions passing.

No independent RAILGUN consensus quorum is invented.

Base-EVM quorum does not replace private-state verification, and private-state verification does not replace base-EVM quorum.

## 8. Family-neutral reports

Strict family reports continue using `MultichainVerificationReport`.

Quorum arrays are not placed directly in `details`, whose schema intentionally remains scalar-only. Provider/quorum summaries are serialized deterministically while the complete typed quorum stays in hashed Evidence references.

This preserves:

- stable machine-readable report schema,
- deterministic report hashing,
- compatibility with existing verification consumers.

## 9. Diagnostics

### Solana — ES4780–ES4789

- `ES4780 InvalidSolanaQuorumPolicy`
- `ES4781 SolanaQuorumProviderProfileMismatch`
- `ES4782 DuplicateSolanaQuorumProvider`
- `ES4783 SolanaQuorumStatusUnavailable`
- `ES4784 SolanaQuorumStatusConflict`
- `ES4785 SolanaQuorumNotFinalized`
- `ES4786 SolanaQuorumSignatureMismatch`
- `ES4787 SolanaQuorumBlockIdentityConflict`
- `ES4788 SolanaQuorumObservationIntegrityMismatch`
- `ES4789 SolanaExecutionQuorumIntegrityMismatch`

### Sui — ES4790–ES4799

- `ES4790 InvalidSuiQuorumPolicy`
- `ES4791 SuiQuorumProviderProfileMismatch`
- `ES4792 DuplicateSuiQuorumProvider`
- `ES4793 SuiQuorumTransactionUnavailable`
- `ES4794 SuiQuorumDigestConflict`
- `ES4795 SuiQuorumExecutionConflict`
- `ES4796 SuiQuorumEffectsConflict`
- `ES4797 SuiQuorumCheckpointConflict`
- `ES4798 SuiQuorumObservationIntegrityMismatch`
- `ES4799 SuiExecutionQuorumIntegrityMismatch`

### Strict cross-backend binding — ES4800+

- `ES4800 JitoSolanaQuorumMismatch`
- `ES4801 JitoSolanaQuorumMissing`
- `ES4802 RailgunEvmQuorumMismatch`
- `ES4803 RailgunEvmQuorumMissing`
- additional RAILGUN strict binding diagnostics remain registry-guarded.

The diagnostic registry test remains authoritative for collision protection.

## 10. Regression coverage

Deterministic tests cover:

### Solana

- matching two-provider finalized quorum,
- provider-order-independent quorum hash,
- missing/unavailable status,
- execution disagreement,
- slot disagreement,
- finality disagreement,
- optional block-identity disagreement,
- duplicate provider IDs,
- observation tampering,
- quorum tampering.

### Jito

- exact expected signature-set binding,
- landed-slot binding,
- finalized Solana quorum for every expected signature,
- missing signature quorum,
- unexpected/wrong signature quorum.

### Sui

- matching two-provider checkpoint quorum,
- digest disagreement,
- execution disagreement,
- effects disagreement,
- checkpoint disagreement,
- missing/unavailable provider,
- provider-order-independent quorum hash,
- observation/quorum tampering.

### RAILGUN

- matching EVM execution quorum + private-state Evidence,
- mismatched base transaction/quorum rejection,
- failing private-state assertion rejection,
- explicit base transaction binding.

Existing v0.6-v0.9 regression tests remain in the same deterministic Core CI.

## 11. Post-Implementation Review

### Correctness

- strict unanimity is preserved across each family-specific quorum,
- no backend-only status can masquerade as chain finality,
- missing provider Evidence cannot prove success,
- Jito and RAILGUN are bound to their relevant base-family trust Evidence.

### Architecture

- no generic cross-family quorum type erases native semantics,
- existing single-provider reports remain backward compatible,
- quorum modules are focused family-specific layers,
- family-neutral reports only standardize common reporting conventions.

### Security

- raw provider endpoint/auth/error material is not persisted,
- runtime-mutated Evidence is rejected by integrity re-validation,
- Jito exact signature set and slot are bound before strict finality,
- RAILGUN base-chain trust and private-state trust remain independently mandatory.

### Maintainability

- no new core runtime dependency,
- deterministic hash construction is preserved,
- stable diagnostic ranges are registry-checked,
- strict TypeScript options remain enabled.

## 12. Verification

Implementation/hardening baseline:

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

Release-version baseline will be recorded after package/CLI promotion to `0.10.0` and its final Core CI run.

## 13. Release checklist

- [x] Solana quorum implementation.
- [x] Jito strict Solana-quorum binding.
- [x] Sui quorum implementation.
- [x] RAILGUN strict EVM-quorum/private-state binding.
- [x] Runtime integrity validation.
- [x] Stable diagnostics and registry coverage.
- [x] Deterministic regression suite.
- [x] Backward-compatible low-level/single-provider APIs.
- [x] Implementation Core CI green.
- [ ] package + CLI version -> `0.10.0`.
- [ ] final version Core CI green.
- [ ] README v0.10 status.
- [ ] Issue #5 final update / closure.

Documentation-only closure commits after the final code/version baseline are excluded from Core CI by repository policy.
