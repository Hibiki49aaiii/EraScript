# Issue #3 — Implementation Plan

Base Commit: `49113716d4338a75e1041566f20c2864ecf5f6d0`

## Goal

Close the provider-substitution/TOCTOU gap between v0.7 provider capability evidence and actual EVM execution.

## Design

Add an additive high-safety module:

```text
src/chains/evm-provider-routing.ts
```

The low-level `src/web3/rpc.ts` and transaction state machine remain backward compatible.

### ProviderExecutionBinding

A provider execution binding contains only non-secret evidence:

- providerId
- profileId
- chainId
- requiredCapabilities
- provider observation timestamp
- provider evidence hash
- optional conformance matrix hash
- deterministic bindingHash

No endpoint URL, auth header, API key or raw RPC configuration is persisted.

### Bound execution states

```text
ProviderPrepared
  -> ProviderSimulated
  -> ProviderSigned
  -> ProviderBroadcast

ProviderSimulated / ProviderSigned
  -> reroute(new provider)
  -> ProviderRerouteRequired
  -> resimulate
  -> ProviderSimulated
  -> resign
  -> ProviderSigned
```

Reroute intentionally discards stale simulation/signature state and returns to a prepared transaction.

### Existing API compatibility

Existing low-level APIs remain callable:

- `prepareDraftWithRpc`
- `simulatePreparedWithRpc`
- `signSimulated`
- `broadcastSignedWithRpc`

The provider-bound wrapper becomes the recommended AI/high-assurance execution path.

## Diagnostics

Reserve ES4750–ES4759:

- ES4750 ProviderExecutionProfileMismatch
- ES4751 ProviderExecutionEvidenceMismatch
- ES4752 ProviderExecutionClientMismatch
- ES4753 ProviderExecutionBindingMismatch
- ES4754 ProviderExecutionRerouteRequired
- ES4755 ProviderExecutionNoopReroute
- ES4756 ProviderExecutionMatrixMismatch
- ES4757 ProviderExecutionInvalidBinding
- ES4758 ProviderExecutionSimulationFailed
- ES4759 ProviderExecutionStateMismatch

## Tests

- deterministic provider binding hash
- required capability normalization
- same-provider happy path
- provider B cannot broadcast provider A simulation/signature
- explicit reroute strips simulation/signature
- reroute requires provider B capability proof
- provider matrix mismatch rejected
- provider ID secret/URL restrictions inherited from v0.7
- diagnostics remain collision-free
- existing v0.7 conformance tests remain unchanged
