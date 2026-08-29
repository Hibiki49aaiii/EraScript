# Issue #5 — Human Understanding

## What

v0.10 adds multi-provider post-execution verification for Solana and Sui, then uses those stronger chain-family proofs to harden Jito and RAILGUN verification.

## Why

v0.9 made EVM robust against one RPC provider being the sole oracle after broadcast.

Without v0.10, the same asymmetry remains elsewhere:

- one Solana RPC can say a signature is finalized,
- one Sui client can say a transaction/effects/checkpoint exists,
- Jito can report a bundle as landed/finalized without an independent Solana RPC quorum,
- RAILGUN can use one base-EVM finality path even though v0.9 now has stronger EVM quorum Evidence.

## How

There will not be one universal quorum type.

```text
EVM     -> receipt/block/finality quorum
Solana  -> signature/slot/commitment quorum
Sui     -> digest/effects/checkpoint quorum
RAILGUN -> EVM quorum + private-state proof
Jito    -> Jito backend evidence + Solana quorum
```

Each family keeps its own native meaning.

## Important Decisions

1. No majority vote. If A/B/C are supplied, all must satisfy policy.
2. Missing/unavailable does not mean on-chain failure, but it cannot prove success.
3. Provider errors/endpoints are not persisted.
4. Solana confirmation-count differences caused by timing do not themselves create conflict; slot/error/finality do.
5. Jito is transport/backend evidence, not independent consensus.
6. RAILGUN remains an EVM privacy overlay, not a chain.
7. Existing single-provider APIs stay available; strict quorum is additive.

## Invariants

- One quorum refers to exactly one transaction/signature/digest.
- Quorum provider IDs are unique.
- Quorum hash is deterministic regardless of input provider order.
- Every observation hash is re-checked before use.
- A strict report cannot upgrade finality from unrelated quorum Evidence.
- Rollup/overlay boundaries remain explicit.

## Failure Modes

Solana:
- one provider cannot find signature -> no quorum
- one provider reports execution error -> no quorum
- providers disagree on slot -> no quorum
- one provider not finalized when finality requested -> no quorum

Sui:
- one provider cannot re-read transaction -> no quorum
- digest mismatch -> no quorum
- effects/success mismatch -> no quorum
- checkpoint mismatch/missing under finality policy -> no quorum

Jito:
- expected bundle transaction signature missing from Solana quorum set -> not strict-finalized

RAILGUN:
- base EVM quorum belongs to another transaction/chain -> reject
- private-state assertion missing/failing -> not strict-finalized

## Change Impact

High-assurance AI-generated code gains a stricter path. Existing applications using current low-level/single-provider APIs are not forced to migrate immediately.
