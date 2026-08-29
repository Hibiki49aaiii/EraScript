# EraScript v0.7 — EVM Provider Conformance

Status: implementation complete  
Issue: #2  
Base Commit SHA: `78d6d26184f191b12d742a7998c31800a100b08a`

## 1. Problem

v0.6 could discover EVM capabilities for one viem-compatible client, but a chain-level profile and one provider observation are not the same thing.

Two providers connected to the same chain can disagree on or differently expose:

- `debug_traceCall`
- `safe` / `finalized` tags
- archive/debug functionality
- private submission
- bundle methods
- account-abstraction infrastructure

EraScript must not promote one provider's evidence into a universal chain guarantee.

## 2. Architecture

```text
Viem Chain
  -> evmProfileFromViemChain()
       |
provider A -> discoverEvmCapabilities() -> ProviderEvidence A
provider B -> discoverEvmCapabilities() -> ProviderEvidence B
provider C -> discoverEvmCapabilities() -> ProviderEvidence C
       |
       v
EvmConformanceMatrix
  -> capability consensus
  -> explicit conflict
  -> provider-specific candidates
  -> fail-closed requirement gate
```

## 3. Provider evidence

`EvmProviderConformanceEvidence` binds:

- stable `providerId`
- profile ID
- chain ID
- observation timestamp
- discovered capability states
- normalized probe details

Provider IDs are labels, not endpoints. URL-like/query/auth-bearing values are rejected so RPC URLs/API keys are not serialized into evidence.

Provider-scoped probe details are also sanitized before storage: HTTP/WSS URLs are replaced with a redaction marker and common credential fields such as API keys, tokens, authorization values, secrets, and passwords are removed.

## 4. Matrix semantics

v0.6 `CapabilityStatus` remains unchanged:

```text
supported | unsupported | unknown
```

v0.7 adds a matrix-only state:

```text
supported | unsupported | unknown | conflict
```

Aggregation is conservative:

| Provider observations | Matrix result |
| --- | --- |
| all supported | supported |
| all unsupported | unsupported |
| supported + unsupported | conflict |
| supported + unknown | unknown |
| unsupported + unknown | unknown |
| all unknown | unknown |

There is deliberately no majority vote.

## 5. Global gate vs provider routing

These are separate questions.

### Global conformance

`assertEvmConformanceRequirements()` requires every requested capability to be unanimously `supported`.

- unknown => fail
- conflict => fail
- unsupported => fail

### Provider-specific routing

`providersSupportingEvmCapabilities()` can still return an individual provider that proves all requested capabilities.

Example:

```text
provider-a debug_traceCall = supported
provider-b debug_traceCall = unsupported

matrix = conflict
global execution gate = fail
provider-specific candidates = [provider-a]
```

This lets an AI route to a proven provider without claiming that the chain/provider ecosystem is globally conformant.

## 6. Determinism

Provider observations and probe lists are normalized before hashing.

`matrixHash` is independent of the order in which provider observations are supplied. Explicit observation timestamps remain part of the evidence.

Duplicate provider IDs are rejected rather than silently choosing a latest value.

## 7. Backward compatibility

`discoverEvmCapabilities(client, profile)` remains valid.

v0.7 only adds an optional third argument:

```ts
discoverEvmCapabilities(client, profile, {
  observedAtMs: 1234567890,
})
```

The existing v0.6 capability assertion API is unchanged.

## 8. All-EVM compatibility

The primary compatibility path remains:

```text
arbitrary viem Chain
  -> evmProfileFromViemChain()
  -> unknown-by-default optional capabilities
  -> runtime/provider evidence
```

v0.7 regression fixtures use real viem chain definitions for:

- Ethereum Mainnet
- BNB Smart Chain
- Polygon
- Avalanche C-Chain
- Gnosis Chain

The tests intentionally verify metadata/profile conversion without inferring EIP-7702, private RPC, or bundle support from the chain name.

## 9. Diagnostics

v0.7 uses the dedicated ES4740 range:

- `ES4740 InvalidEvmProviderId`
- `ES4741 DuplicateEvmProviderObservation`
- `ES4742 MixedEvmConformanceProfile`
- `ES4743 EmptyEvmConformanceMatrix`
- `ES4744 EvmConformanceUnknown`
- `ES4745 EvmConformanceConflict`
- `ES4746 EvmConformanceUnsupported`
- `ES4747 EvmProviderRequirementUnsatisfied`
- `ES4748 InvalidEvmProviderObservationTime`

The repository diagnostic registry test remains the collision guard.

## 10. Security invariants

- unknown is never success
- provider conflict is never resolved by majority vote
- provider-specific support does not mutate chain-global support
- provider identifiers do not contain endpoint URLs/credentials
- provider-scoped probe details redact endpoint URLs/common credential forms
- evidence from different profile IDs or chain IDs cannot enter one matrix
- one provider ID can appear only once per matrix
- provider/service-specific APIs still require explicit adapters; they are not guessed from base RPC behavior

## 11. Changed files

New:

- `src/chains/evm-conformance.ts`
- `test/evm-conformance.test.ts`
- `docs/V07_IMPLEMENTATION.md`
- `docs/ai/issues/2/IMPLEMENTATION_PLAN.md`
- `docs/ai/issues/2/HUMAN_UNDERSTANDING.md`

Modified:

- `src/chains/evm-discovery.ts`
- `src/chains/evm-viem-bridge.ts`
- `src/chains/index.ts`
- `package.json`
- `src/cli.ts`
- `README.md`

## 12. Verification

Final verification:

- [x] `npm run check`
- [x] `npm run test:core`
- [x] diagnostic registry remains green
- [x] final GitHub Core CI run is green
- [x] post-implementation review complete

Final release baseline:

```text
EraScript: 0.7.0
commit: 8f9a4b435697be71d23ed855c89fc97d4cf629f0
Core CI run: 316
tests: 144
pass: 144
fail: 0
```

During verification, Core CI caught two real viem structural-type incompatibilities rather than allowing test-side casts:

1. current viem `Chain.testnet` can be `boolean | undefined` under `exactOptionalPropertyTypes`;
2. existing/real viem chain objects contain additional metadata such as `rpcUrls`.

The final `ViemChainLike` contract therefore reads only the metadata EraScript needs while allowing additional SDK-owned chain metadata. This keeps the bridge structural without coupling EraScript to viem's full internal Chain shape.

Post-implementation security review also identified that provider RPC exception strings could carry URLs/API credentials in probe details. Provider-scoped conformance evidence now sanitizes those details before persistence/hashing.
