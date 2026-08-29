# Issue #2 Implementation Plan — EVM Provider Conformance

Issue: #2  
Base Commit SHA: `78d6d26184f191b12d742a7998c31800a100b08a`  
Target branch: `main`

## Requirements

- Preserve v0.6 three-state `CapabilityStatus`.
- Add provider-scoped capability evidence without storing endpoint URLs/secrets.
- Aggregate multiple providers conservatively.
- Represent provider disagreement explicitly.
- Fail closed for matrix-level unknown/conflict/unsupported requirements.
- Allow provider-specific routing when one provider proves a capability even if chain-global consensus is unknown.
- Prove arbitrary viem-chain compatibility with real viem chain definitions.

## Current architecture

```text
Viem Chain metadata
  -> evmProfileFromViemChain()
       -> EvmChainProfile

Viem-compatible client
  -> discoverEvmCapabilities()
       -> EvmCapabilityEvidence
```

Current discovery has no stable provider identity and no aggregation semantics across providers.

## Target architecture

```text
Viem Chain
  -> EvmChainProfile
        |
provider client
  -> discoverEvmCapabilities()
  -> EvmProviderConformanceEvidence
        |
        + provider-a
        + provider-b
        + provider-c
        |
        v
EvmConformanceMatrix
  + capability consensus
  + provider observations
  + conflict state
  + deterministic matrix hash
        |
        + evaluate global requirements (fail closed)
        + enumerate provider-specific candidates
```

## Data flow

1. Create/reuse an `EvmChainProfile`.
2. Discover existing capability evidence with an explicit observation timestamp.
3. Wrap it with a stable non-secret provider ID.
4. Aggregate one or more provider observations.
5. For each capability:
   - all supported => `supported`
   - all unsupported => `unsupported`
   - any supported + any unsupported => `conflict`
   - every other combination => `unknown`
6. Evaluate required capabilities:
   - global execution gate fails unless every required matrix capability is unanimously supported.
   - provider routing may independently return providers whose own evidence supports all requested capabilities.

## State transitions

This feature is evidence aggregation, not a transaction lifecycle.

```text
CapabilityEvidence
  -> ProviderEvidence
  -> ConformanceMatrix
  -> RequirementEvaluation
```

No matrix result upgrades transaction/finality evidence by itself.

## Files

New:
- `src/chains/evm-conformance.ts`
- `test/evm-conformance.test.ts`
- `docs/V07_IMPLEMENTATION.md`
- `docs/ai/issues/2/HUMAN_UNDERSTANDING.md`

Modify:
- `src/chains/evm-discovery.ts`
- `src/chains/index.ts`
- `README.md`
- `package.json` only if v0.7 version promotion is justified after implementation

## API changes

Backward-compatible:
- `discoverEvmCapabilities(client, profile, options?)` adds optional explicit `observedAtMs`.

New APIs:
- `discoverEvmProviderConformance(...)`
- `createEvmProviderConformanceEvidence(...)`
- `buildEvmConformanceMatrix(...)`
- `evaluateEvmConformanceRequirements(...)`
- `assertEvmConformanceRequirements(...)`
- `providersSupportingEvmCapabilities(...)`

## Database / migration changes

None.

## Error handling

New diagnostics use the unused `ES4740–ES4748` range and remain covered by the diagnostic registry test.

Errors include:
- unsafe/invalid provider identity
- duplicate provider evidence
- mixed chain/profile evidence
- empty matrix
- matrix requirement conflict/unknown/unsupported
- provider-specific requirement failure

## Security considerations

- Provider IDs are labels, never endpoint URLs.
- Reject URL-like/query/auth-like provider identifiers.
- Do not serialize RPC URLs or credentials into evidence.
- Unknown and conflicting evidence fail closed.
- Provider-specific capability routing does not mutate chain-global capability status.
- Provider failures remain subject to existing `discoverEvmCapabilities()` ambiguity rules.

## Testing strategy

Deterministic tests:
- same-chain providers with unanimous support
- support/unsupported conflict
- support + unknown => unknown
- mixed chain/profile rejection
- duplicate provider rejection
- provider-specific candidate routing
- fail-closed global requirement evaluation
- deterministic matrix hash independent of input observation ordering
- real viem chain definitions: Ethereum, BSC, Polygon, Avalanche, Gnosis
- existing discovery compatibility
- diagnostic registry uniqueness

Verification:
- `npm run check`
- `npm run test:core`
- final Core CI run

## Implementation order

1. Extend discovery with optional timestamp.
2. Add provider evidence model.
3. Add matrix aggregation/hash.
4. Add requirement evaluation/routing.
5. Export APIs.
6. Add tests using real viem chains.
7. Add v0.7 docs/README.
8. Run post-implementation review and CI.
9. Update Issue #2.

## Rollback

All v0.7 functionality is additive. Reverting the new module/export/tests/docs returns the repository to v0.6 behavior. The optional discovery parameter is backward compatible.

## Known risks

- Provider capability consensus can be misunderstood as protocol truth. Naming/docs must state it is observed provider conformance.
- Real viem chain catalog changes over time; tests should assert stable metadata fundamentals, not every optional chain field.
- A provider can change behavior after observation; timestamps remain part of provider evidence.
