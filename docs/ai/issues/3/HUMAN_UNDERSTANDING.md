# Issue #3 — Human Understanding

## What is being fixed?

v0.7 can prove:

> provider A supports capability X.

But the transaction lifecycle can still later receive another RPC client.

That means this sequence is possible without an explicit safety failure:

```text
provider A -> capability proof
provider A -> simulation succeeds
provider B -> broadcast
```

The transaction bytes may be identical, but provider B may expose different mempool/private-RPC/bundle/debug/finality behavior. For AI-generated automation this is an avoidable substitution risk.

## What changes?

EraScript will create a compact provider binding and carry it beside the transaction lifecycle.

A signed transaction can be broadcast only through the same binding that was used for simulation.

If failover is required, EraScript does not pretend the old simulation remains valid. It returns the transaction to a prepared state, checks the new provider, simulates again, and requires a fresh signing step.

## Why not modify all old transaction APIs?

Node/TypeScript compatibility and incremental adoption are core EraScript requirements. Existing low-level APIs are useful primitives and changing all of their signatures would create avoidable breakage.

Instead, v0.8 adds a stricter wrapper. AI-generated/high-assurance EraScript should use the wrapper by default.

## What is intentionally not stored?

The binding stores a provider label such as:

`primary-mainnet`

It does not store:

- https://... RPC URLs
- API keys
- bearer tokens
- authorization headers

v0.7 provider ID/probe sanitization rules remain the source of truth.

## Reroute rule

Provider failover is not a transparent retry.

```text
old simulation
  X invalid after provider change

new provider evidence
  -> new simulation
  -> new signature
  -> broadcast
```

This makes provider failover explicit and auditable.
