# EraScript v0.5 — Rescue Verification Foundation

v0.5 begins the workflow layer that turns individually valid Web3 transactions into a verifiable rescue plan.

The core distinction is:

```text
READY_FOR_BROADCAST != VERIFIED_RECOVERY
```

A plan can be safe enough to submit without already proving the post-execution asset state. A recovery is only verified after the configured final-state invariants are supported by state evidence.

## Transaction DAG

`defineTransactionGraph()` models explicit transaction dependencies rather than relying on array order alone.

Current checks include:

- stable unique node IDs
- chain consistency
- dependency existence
- cycle detection
- action metadata matching the actual transaction sender/target
- same-sender nonce continuity
- explicit dependency from each later nonce to the preceding nonce transaction

Actions currently include:

- `fund`
- `claim`
- `token-rescue`
- `native-sweep`
- `custom`

## Rescue completeness

`defineRescueWorkflow()` binds:

- compromised/victim wallet
- safe destination wallet
- declared assets
- transaction graph
- native dust limit
- expected recovery amounts

Every declared token must have a victim-to-safe `token-rescue` step.

Native balance recovery is required by default. Omitting the final sweep raises:

```text
ES4011 MissingNativeSweepStep
```

This is specifically designed to catch the common workflow mistake where funding, claim and token rescue are implemented but the final native-balance recovery transaction is forgotten.

## Final-state invariants

Current invariant types:

- `native-lte`
- `token-eq`
- `token-delta-gte`

`rescueFinalStateInvariants()` automatically derives the standard rescue expectations:

```text
victim.<declared token> == 0
victim.native <= configured dust
safe.<expected token> delta >= expected recovery
```

`assertRescueFinalState()` rejects a post-state that does not satisfy those expectations.

## Block-anchored evidence

`captureBalanceSnapshotFromRpc()` reads native and ERC-20 balances at one explicit block number/hash. This prevents a verification report from accidentally mixing balances from different chain states.

## Verification states

v0.5 uses the following vocabulary:

### `NOT_READY`

The graph, simulation, policy, bundle evidence, or invariants are insufficient or failed.

### `READY_FOR_BROADCAST`

The transaction graph is complete, transactions are already capability-authorized/signed, and when an atomic Flashbots path is required the exact ordered transaction set has a fresh simulation bound to the current state/target block.

This status means *eligible for submission under the configured policy*. It does not mean assets have been recovered.

### `VERIFIED_RECOVERY`

Post-execution state evidence satisfies the rescue final-state invariants.

This is the only v0.5 state intended to mean the configured recovery objective was actually observed.

## Remaining v0.5 work

- programmatic rescue verification report API
- `era verify` machine-readable output
- external signer/capability provider interface
- Safe lifecycle
- ERC-4337 UserOperation lifecycle
- EIP-7702 authorization lifecycle
- optional provider-specific pre-state/post-state simulation adapters
