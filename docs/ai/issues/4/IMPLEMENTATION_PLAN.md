# Issue #4 — Implementation Plan

Base Commit: `7d779ffa145ad27fd04fcb26e973e3f76dc9ddbf`

## Goal

Prevent one post-broadcast RPC provider from becoming the sole oracle of EVM inclusion/canonicality/confirmations/finality.

## Architecture

Add:

```text
src/chains/evm-execution-quorum.ts
```

Inputs are v0.8 `EvmBoundExecutionProvider` wrappers so every verification client is already:

- chain/profile bound,
- provider-ID bound,
- capability-evidence bound.

### Provider observation

Each provider independently observes:

- expected transaction receipt
- receipt block number/hash/status/gas used
- canonical block hash at the receipt block number
- confirmation count
- optional finalized head

Transient RPC exceptions are not persisted with raw error text; the observation is fail-closed/unavailable.

### Strict quorum

Default:

- minimum providers = 2
- provider IDs must be unique
- all supplied providers must produce usable observations
- all receipts must agree
- all providers must agree that the receipt block is canonical
- every provider must meet `minimumConfirmations`
- when `requireFinalized`, every provider must have `finalizedTag` in its bound required-capability set and report a finalized head >= transaction block

No majority voting.

### Promotion

Quorum evidence owns one normalized canonical receipt.

```text
ProviderBroadcast
  + quorum(included)
       -> IncludedTx
  + quorum(confirmed)
       -> ConfirmedTx
  + quorum(finalized)
       -> FinalizedTx
```

Existing generic transaction functions remain unchanged and are reused.

### Rollups

For an `evm-rollup` profile:

- quorum verifies L2 receipt/canonicality/confirmation/finalized-tag evidence only,
- quorum evidence is explicitly marked `scope: "l2-execution"`,
- it never replaces `RollupSettlementEvidence`,
- `VERIFIED_FINALITY` for the rollup remains dependent on protocol-specific L1 settlement.

## Diagnostics

Reserve ES4760–ES4769.

Planned meanings:

- ES4760 InvalidEvmQuorumPolicy
- ES4761 EvmQuorumProviderProfileMismatch
- ES4762 DuplicateEvmQuorumProvider
- ES4763 EvmQuorumReceiptUnavailable
- ES4764 EvmQuorumReceiptConflict
- ES4765 EvmQuorumNonCanonicalReceipt
- ES4766 EvmQuorumInsufficientConfirmations
- ES4767 EvmQuorumFinalizedCapabilityMissing
- ES4768 EvmQuorumNotFinalized
- ES4769 EvmQuorumTransactionMismatch

## Tests

- two-provider included quorum
- confirmed quorum
- finalized quorum
- input-order-independent quorum hash
- duplicate provider reject
- missing receipt reject
- conflicting receipt reject
- non-canonical block reject
- one provider below confirmations reject
- finalized capability missing reject
- finalized head below receipt block reject
- rollup scope remains L2-only
- promotion into existing transaction states
- provider labels only; no endpoint persistence

## Non-goals

- no transaction submission in tests
- no automatic provider discovery/ranking
- no consensus/light client
- no rollup L1 replacement


## Post-Implementation Review Findings

### Adopted — Evidence integrity verification

The original plan required deterministic observation/quorum hashes but did not explicitly require re-validating those hashes before downstream use.

Final implementation adds:

- observation hash re-computation inside quorum construction,
- `assertEvmExecutionQuorumIntegrity()`,
- quorum hash re-computation before promotion,
- `ES4770 EvmQuorumObservationIntegrityMismatch`,
- `ES4771 EvmExecutionQuorumIntegrityMismatch`,
- tamper regression tests.

Reason: TypeScript `readonly` is compile-time only. High-assurance Evidence must reject runtime mutation/forgery before promotion.

### Adopted — BigInt-safe test serialization

Core CI run 331 exposed two test-only failures because raw `JSON.stringify()` cannot serialize bigint fields in Evidence objects.

The tests now use a bigint-safe JSON helper while preserving the original security assertions:

- provider error/endpoint text is not persisted,
- rollup quorum does not contain `l1-finalized` evidence.

No runtime Evidence representation was weakened.

### Retained — Provider independence boundary

The quorum enforces unique stable provider IDs. EraScript intentionally does not persist endpoint URLs/credentials or claim to cryptographically prove physical/provider-operator independence.

Operational deployments that require infrastructure diversity must assign different IDs to genuinely independent provider routes.
