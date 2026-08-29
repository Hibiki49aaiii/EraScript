# Issue #2 Human Understanding

## What

v0.7 adds an EVM provider conformance matrix above the existing v0.6 capability discovery.

## Why

Two RPC providers connected to the same chain can expose different functionality. EraScript must not infer that a capability observed on one provider is universally available on every provider for that chain.

## How

Each capability observation is attached to a stable provider label. Multiple provider observations are aggregated conservatively:

- all supported => supported
- all unsupported => unsupported
- supported and unsupported => conflict
- any incomplete/mixed-with-unknown result => unknown

A separate provider-routing helper can still identify which individual provider proves all required capabilities.

## Important Decisions

- Keep existing `CapabilityStatus` unchanged.
- Add `conflict` only at conformance-matrix level.
- Never persist endpoint URLs or credentials as provider identity.
- Fail closed at global requirement gates.
- Keep viem as the all-EVM metadata/networking source instead of maintaining an exhaustive EraScript chain catalog.

## Invariants

- One matrix belongs to exactly one profile and chainId.
- One provider ID appears at most once in a matrix.
- Matrix input order does not change its normalized result/hash.
- Provider-specific support never silently upgrades chain-global consensus.
- Unknown is not success.

## Failure Modes

- Provider label looks like a URL/credential => reject.
- Mixed chain/profile evidence => reject.
- Providers disagree => matrix conflict.
- Some providers are unknown => matrix unknown unless all providers give the same conclusive state.
- Required capability is not unanimously supported => execution gate fails.

## Change Impact

Additive v0.7 API. Existing v0.6 discovery and transaction/finality models remain valid.
