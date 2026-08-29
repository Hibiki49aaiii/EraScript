# EraScript v0.9 — Multi-Provider EVM Execution Quorum

Status: implementation complete  
Issue: #4  
Base Commit SHA: `7d779ffa145ad27fd04fcb26e973e3f76dc9ddbf`

## 1. Problem

v0.8 binds capability discovery, simulation, signing and broadcast to one exact provider route.

After broadcast, however, one RPC provider could still become the sole source for:

- transaction receipt,
- receipt block hash,
- block canonicality,
- confirmation count,
- `finalized` head.

For high-assurance AI-generated execution, one RPC response is not enough to promote a transaction into trusted inclusion/finality evidence.

## 2. Safety model

v0.9 adds a strict, fail-closed multi-provider verification layer.

Default policy:

- minimum two distinct provider IDs,
- no majority voting,
- every supplied provider must return usable receipt evidence,
- every supplied provider must agree on transaction hash/block number/block hash/status/gas used,
- every supplied provider must independently re-read the receipt block and confirm it is canonical,
- every supplied provider must meet the confirmation threshold,
- `requireFinalized=true` requires every verifier binding to prove `finalizedTag`,
- every finalized head must be at or beyond the transaction block.

If any configured verifier is unavailable or disagrees, quorum does not pass.

### Independence boundary

EraScript enforces distinct stable provider IDs and distinct provider-bound verification entries. It deliberately does **not** persist endpoint URLs, credentials, ASN/operator identity, or other secret/network metadata, so it cannot cryptographically prove that two differently named provider IDs ultimately terminate at independent physical infrastructure.

Operational policy must therefore map quorum provider IDs to genuinely independent routes/providers when infrastructure diversity is required.

## 3. Architecture

```text
ProviderBound Broadcast
        |
        +--> verifier A
        |      receipt
        |      canonical block
        |      confirmations
        |      finalized head
        |
        +--> verifier B
        |
        +--> verifier C
               |
               v
       EvmExecutionQuorum
          unanimous receipt
          unanimous canonicality
          all thresholds met
               |
       +-------+--------+
       |                |
    Included         Confirmed
                         |
                      Finalized
```

Implementation:

```text
src/chains/evm-execution-quorum.ts
```

The API consumes v0.8 `EvmBoundExecutionProvider` objects rather than raw clients, preserving provider/profile/chain/capability binding.

## 4. Provider observations

`observeEvmExecutionWithProvider()` produces:

- provider ID,
- provider binding hash,
- profile/chain ID,
- expected transaction hash,
- normalized receipt or `null`,
- canonicality result,
- canonical block hash,
- confirmation count,
- optional finalized head,
- deterministic observation hash.

RPC exception text is deliberately not persisted. Provider endpoint URLs and credentials do not enter evidence.

Unavailable is not interpreted as on-chain failure, but is also not accepted as success.

## 5. Strict quorum construction

`buildEvmExecutionQuorum()` validates:

1. profile/chain continuity,
2. minimum provider count,
3. unique provider IDs,
4. observation integrity hashes,
5. transaction hash continuity,
6. receipt availability,
7. receipt unanimity,
8. independent canonical block confirmation,
9. per-provider confirmation threshold,
10. per-provider finality evidence when requested.

Provider input order does not affect the quorum hash.

The quorum keeps the full individual observations plus one normalized canonical receipt.

## 6. Promotion into the existing transaction lifecycle

`promoteEvmExecutionWithQuorum()` re-validates quorum integrity before using it.

```text
ProviderBroadcast
  + included quorum
      -> IncludedTx

ProviderBroadcast
  + confirmed quorum
      -> ConfirmedTx

ProviderBroadcast
  + finalized quorum
      -> FinalizedTx
```

The existing generic EVM transaction state machine remains unchanged.

## 7. Rollup boundary

For `evm-rollup` profiles, quorum evidence is explicitly:

```text
scope: "l2-execution"
```

A finalized L2 RPC quorum does **not** become L1 settlement evidence.

Existing OP Stack / Arbitrum settlement adapters remain mandatory for rollup `VERIFIED_FINALITY`.

## 8. Evidence integrity hardening

Post-Implementation Review identified an additional integrity requirement.

TypeScript `readonly` alone cannot protect runtime evidence from code that deliberately mutates objects through `any`/casts.

v0.9 therefore:

- re-computes every observation hash inside the quorum builder,
- rejects a modified/forged observation,
- exposes `assertEvmExecutionQuorumIntegrity()`,
- re-computes quorum hash before promotion,
- rejects mutated quorum evidence.

Diagnostics:

- `ES4770 EvmQuorumObservationIntegrityMismatch`
- `ES4771 EvmExecutionQuorumIntegrityMismatch`

This is additive to the original ES4760–ES4769 operational diagnostic range.

## 9. Diagnostics

Operational quorum diagnostics:

- `ES4760 InvalidEvmQuorumPolicy`
- `ES4761 EvmQuorumProviderProfileMismatch`
- `ES4762 DuplicateEvmQuorumProvider`
- `ES4763 EvmQuorumReceiptUnavailable`
- `ES4764 EvmQuorumReceiptConflict`
- `ES4765 EvmQuorumNonCanonicalReceipt`
- `ES4766 EvmQuorumInsufficientConfirmations`
- `ES4767 EvmQuorumFinalizedCapabilityMissing`
- `ES4768 EvmQuorumNotFinalized`
- `ES4769 EvmQuorumTransactionMismatch`

Integrity diagnostics:

- `ES4770 EvmQuorumObservationIntegrityMismatch`
- `ES4771 EvmExecutionQuorumIntegrityMismatch`

The repository diagnostic registry remains the collision guard.

## 10. Regression coverage

New deterministic tests cover:

- two matching providers,
- included promotion,
- confirmation threshold,
- finalized quorum,
- missing receipt,
- conflicting canonical receipts,
- non-canonical receipt,
- duplicate provider IDs,
- minimum-provider policy,
- provider-order-independent quorum hash,
- finality capability requirement,
- finalized head behind receipt block,
- rollup L2-only scope,
- provider-error text non-persistence,
- tampered observation rejection,
- tampered quorum rejection.

The v0.7/v0.8 suites remain part of the same deterministic Core CI.

## 11. Post-Implementation Review

### Correctness

- strict unanimity is preserved; there is no implicit 2-of-3 majority fallback,
- receipt disagreement is fail-closed,
- unavailable receipt is fail-closed,
- confirmation/finality thresholds apply to every verifier.

### Architecture

- reuses v0.8 bound-provider wrappers,
- reuses existing Included/Confirmed/Finalized transaction constructors,
- does not add another EVM RPC transport abstraction,
- remains additive to existing low-level APIs.

### Security

- provider IDs remain non-secret labels,
- raw provider error strings are not retained in evidence,
- rollup L2 finality cannot masquerade as L1 settlement,
- evidence hashes are verified before quorum construction/promotion.

### Maintainability

- one new focused runtime module,
- deterministic hashing is centralized,
- operational and integrity diagnostics are machine-readable,
- no new runtime dependency.

## 12. Verification

Implementation code baseline:

```text
commit: 8e20a0b873173723c29fd918397c595952fff87b
Core CI run: 334
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 162
pass: 162
fail: 0
```

Final v0.9.0 code/version baseline:

```text
EraScript version: 0.9.0
commit: 6603a9eef3bda0a774e7d9874a2c55405bd04539
Core CI run: 336
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 162
pass: 162
fail: 0
```

CI findings corrected before release:

1. New quorum test hash literals were initially inferred as plain `string`; they are now explicitly typed as EVM hex strings.
2. Raw `JSON.stringify()` in two tests could not serialize bigint Evidence fields; tests now use bigint-safe serialization without weakening the assertions.
3. Post-Implementation Review added observation/quorum hash re-validation and tamper tests before promotion.

## 13. Release result

- [x] Core CI green for final implementation code.
- [x] package + CLI version -> `0.9.0`.
- [x] final Core CI green for the version baseline.
- [x] README v0.9 status.
- [x] Issue #4 final Implementation Result / Verification Result.
- [x] Issue #4 closure.

Documentation-only closure commits occur after the code/version baseline and are intentionally excluded from Core CI by repository policy.
