# Issue #4 — Human Understanding

## Why this exists

v0.8 fixes the execution-provider substitution problem before broadcast.

After broadcast, however, a single RPC can still say:

> the transaction is in block X, the block is canonical, and it is finalized.

For high-value recovery/automation, that statement should be independently checked.

## What v0.9 means by quorum

EraScript does not vote between providers by default.

If the user selected A, B and C as verification providers, all three must agree on the canonical receipt and all three must satisfy the requested threshold.

```text
A agrees
B agrees
C disagrees
=> NOT verified
```

This is intentionally stricter than majority voting.

## What if one provider is down?

Unavailable is not evidence of failure on-chain, but it is also not evidence of success.

The quorum therefore does not pass.

The caller can deliberately create a new verification set if operational policy allows it; EraScript will not silently drop a disagreeing/unavailable provider from the quorum.

## What gets compared?

The core receipt identity:

- transaction hash
- block number
- block hash
- status
- gas used

Each provider must independently re-read that block number and see the same block hash as canonical.

Confirmation counts may differ due to observation timing, but every provider must meet the requested minimum.

Finalized head numbers may also differ; every one must still be at or beyond the receipt block.

## Rollup boundary

Base/OP/Arbitrum RPC agreement about an L2 transaction does not prove Ethereum L1 settlement.

So v0.9 quorum can strengthen L2 execution evidence, while the existing rollup settlement adapter remains the only path to L1-settled/finalized evidence.

## Why reuse v0.8 bound providers?

A raw RPC client plus a string label would recreate the exact ambiguity v0.8 removed.

By accepting `EvmBoundExecutionProvider`, v0.9 knows each verifier client was capability-discovered against the same bound client object and carries a non-secret provider identity.
