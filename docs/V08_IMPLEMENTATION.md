# EraScript v0.8 — Provider-Bound EVM Execution Routing

Status: implementation complete  
Issue: #3  
Base Commit SHA: `49113716d4338a75e1041566f20c2864ecf5f6d0`

## 1. Problem

v0.7 made EVM capability evidence provider-scoped, but provider discovery and transaction execution could still be separated.

Without an additional binding layer, an application could:

```text
provider A -> capability evidence
provider A -> simulation
provider B -> raw transaction broadcast
```

That is a provider-substitution/TOCTOU gap. Identical transaction bytes do not imply identical RPC/private-routing/bundle/debug/finality behavior.

## 2. Architecture

v0.8 adds:

```text
src/chains/evm-provider-routing.ts
```

The generic EVM transaction state machine remains provider-agnostic and backward compatible.

High-assurance execution is wrapped as:

```text
fresh provider discovery
  -> EvmProviderExecutionBinding
  -> ProviderPrepared
  -> ProviderSimulated
  -> ProviderSigned
  -> ProviderBroadcast
```

## 3. Provider execution binding

A binding contains:

- stable non-secret `providerId`
- profile ID
- chain ID
- provider observation timestamp
- normalized required capability list
- provider evidence hash
- optional v0.7 conformance matrix hash
- deterministic binding hash

It does not persist RPC URLs, API keys, bearer tokens, auth headers, or transport configuration.

Provider evidence is normalized through the existing v0.7 conformance constructor, preserving provider-ID validation and probe-detail sanitization.

## 4. Exact client binding

The recommended runtime constructor is:

```ts
discoverEvmExecutionProvider(client, profile, {
  providerId,
  requiredCapabilities,
})
```

Capability discovery is executed against the same viem client object stored in the returned bound-provider wrapper.

The runtime wrapper is nominally branded with a private symbol. Applications are not expected to construct it structurally.

## 5. Matrix routing

A v0.7 `EvmConformanceMatrix` may be supplied when routing.

v0.8:

1. rebuilds the matrix from its provider evidence,
2. checks the supplied matrix hash,
3. requires matching profile/chain,
4. requires the selected provider to exist in the matrix,
5. requires that provider to prove every requested capability,
6. performs fresh discovery against the actual bound client again.

Matrix-level conflict can therefore coexist with safe provider-specific routing, without upgrading chain-global conformance.

## 6. Provider continuity

`simulateEvmProviderExecution()` always writes the validated provider ID into simulation evidence and requires a concrete block number/hash anchor.

`broadcastEvmProviderExecution()` requires:

- the same provider ID,
- the same provider binding hash,
- the same profile/chain,
- simulation evidence naming that bound provider.

Provider A execution state cannot be handed to provider B's bound broadcast path.

## 7. Explicit failover

Provider failover is not a transparent retry.

```text
ProviderSimulated / ProviderSigned
  -> rerouteEvmProviderExecution(newProvider)
  -> ProviderRerouteRequired
       old simulation invalidated
       old signature invalidated
  -> resimulateReroutedEvmProviderExecution()
  -> ProviderSimulated
  -> re-sign
  -> broadcast
```

The reroute object carries only the prepared transaction plus audit metadata describing the invalidated simulation.

A reroute target must:

- use the same profile/chain,
- have a different binding,
- have provider evidence at least as recent as the previous route,
- prove all capabilities required by its own binding,
- preserve every capability requirement from the previous route (reroute cannot downgrade assumptions).

## 8. Backward compatibility

Existing low-level APIs remain available and unchanged:

- `prepareDraftWithRpc`
- `simulatePreparedWithRpc`
- `signSimulated`
- `broadcastSignedWithRpc`

v0.8 is additive. AI-generated/high-assurance code should prefer the provider-bound wrapper.

Provider routing does not replace the existing external-signer verification layer. Signature-content verification and provider-continuity verification remain separate safety responsibilities.

## 9. Diagnostics

v0.8 reserves ES4750–ES4759.

Currently exercised:

- `ES4750 ProviderExecutionProfileMismatch`
- `ES4751 ProviderExecutionEvidenceMismatch`
- `ES4752 ProviderExecutionClientMismatch`
- `ES4753 ProviderExecutionBindingMismatch`
- `ES4754 ProviderExecutionStaleRerouteEvidence`
- `ES4755 ProviderExecutionNoopReroute`
- `ES4756 ProviderExecutionMatrixMismatch`
- `ES4759 ProviderExecutionStateMismatch`

The repository diagnostic registry remains the collision guard.

## 10. Tests

New regression coverage:

- deterministic provider binding hash
- capability-order normalization
- same-provider prepare/simulate/sign/broadcast path
- provider substitution rejection
- explicit reroute invalidates simulation/signature
- rerouted provider requires resimulation
- stale reroute evidence rejection
- reroute capability-downgrade rejection
- provider-specific capability proof failure
- conformance matrix membership/routing
- provider URL/credential-ID rejection inherited from v0.7

Existing v0.7 conformance tests remain unchanged.

## 11. Verification

Final release baseline:

- [x] `npm install`
- [x] `npm run check`
- [x] `npm run test:core`
- [x] diagnostic registry green
- [x] post-implementation review
- [x] package/CLI promoted to 0.8.0
- [x] final Core CI run green

```text
EraScript version: 0.8.0
code/version baseline: 7da58eb253d422c676e5df0d9c31258f5b0134a1
Core CI run: 327
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 152
pass: 152
fail: 0
```

## 12. Post-Implementation Review

The review caught two issues before release:

1. **Runtime nominal-brand bug.** A TypeScript-only `declare const ... unique symbol` was accidentally used as a runtime object key. Core CI run 322 exposed the resulting `ReferenceError`. The brand is now backed by a real private `Symbol()`.
2. **Failover capability downgrade.** A replacement provider could initially have been bound with a smaller required-capability set. The final implementation requires the new route to preserve every capability required by the previous route; downgrade attempts fail with `ES4751 ProviderExecutionEvidenceMismatch`.

Additional review conclusions:

- generic `tx.ts` / low-level `rpc.ts` remain backward compatible,
- provider continuity and raw-transaction signature verification remain separate safety responsibilities,
- no RPC endpoint URL/API credential is persisted by provider execution bindings,
- successful provider-bound simulation must be concretely block-anchored and identify the exact bound provider,
- provider reroute evidence must be at least as recent as the prior route,
- diagnostic-code collision protection remains part of the green suite.
