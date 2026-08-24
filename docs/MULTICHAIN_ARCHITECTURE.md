# EraScript Multi-chain Architecture

Status: Draft v0.6 foundation

Checked against current public protocol/SDK documentation on 2026-08-24.

## 1. Goal

EraScript must not equate Web3 with Ethereum or Flashbots.

The language must support multiple chain families while preserving family-specific safety semantics. Compatibility is defined as:

1. Node.js/TypeScript interoperability at the host-runtime level.
2. Family-specific address, amount, transaction, signer, simulation, execution and finality types.
3. Provider/execution backends selected by explicit capability rather than assumed globally.
4. Protocol overlays such as RAILGUN modeled separately from the underlying consensus chain.

The architecture is:

```text
EraScript Core
  |
  +-- Chain Family
  |     +-- EVM
  |     +-- Solana
  |     +-- Sui
  |
  +-- Execution Backend
  |     +-- public/private RPC
  |     +-- Flashbots
  |     +-- Jito
  |     +-- Sui RPC
  |     +-- custom provider
  |
  +-- Protocol Overlay
        +-- RAILGUN
        +-- future privacy/account layers
```

## 2. Do not promise "all EVM chains are identical"

EraScript targets generic EVM compatibility, but EVM-compatible chains differ in RPC support, transaction envelopes, fee markets, finality, sequencer behavior, precompiles, debug APIs, account abstraction support, private transaction endpoints and bundle infrastructure.

A custom EVM chain therefore starts with optional capabilities as `unknown`.

```ts
const custom = genericEvmProfile({
  id: "evm.custom.777",
  name: "Custom EVM",
  chainId: 777,
})

custom.capabilities.eip1559   // unknown
custom.capabilities.eip7702   // unknown
custom.capabilities.bundleRpc // unknown
```

EraScript must not use an optional feature until it has been explicitly configured or runtime-discovered.

The generic baseline is ordinary EVM JSON-RPC + chainId binding. Flashbots is an optional backend, not an EVM requirement.

## 3. EVM family

Existing `src/web3/*` remains the EVM implementation layer.

Family-specific evidence includes:

- `Address<EvmChain>`
- EVM chainId
- Wei/Gwei/Ether/Gas/Fee types
- Nonce provenance
- EIP-1559 / EIP-7702 transaction state
- EIP-712
- ERC-4337
- Safe
- ABI/calldata/events
- state-diff and fork simulation
- finality and reorg evidence

Execution backends may include:

- public RPC
- private RPC
- Flashbots-style bundles
- rollup/sequencer-specific RPC
- custom provider adapters

### Rollups

A rollup may require two distinct success/finality concepts:

```text
L2 included/final
       !=
L1 settled/final
```

EraScript must not flatten these into a single confirmation count when the chain profile requires settlement evidence.

## 4. Solana family

Solana is not modeled as EVM with different addresses.

Distinct primitives include:

- `SolanaAddress` — base58 encoding of a 32-byte public key
- `Lamports`
- `SolanaTransactionSignature` — Ed25519 transaction signature
- `SolanaBlockhash`
- `lastValidBlockHeight`
- commitment: `processed | confirmed | finalized`
- transaction version: legacy / v0
- Address Lookup Tables
- durable nonce profile

Current Solana documentation recommends `@solana/kit` for TypeScript. Legacy `@solana/web3.js` is deprecated, although an ecosystem compatibility layer exists.

A recent blockhash is part of the signed transaction and expires. EraScript therefore binds blockhash evidence to `lastValidBlockHeight` and refuses stale signing/submission.

### Solana transaction atomicity

Instructions inside one Solana transaction execute atomically. Cross-transaction atomicity is not part of normal Solana RPC.

For multi-transaction atomic execution EraScript may use a Jito backend when explicitly configured.

### Jito backend

Jito is the Solana analogue of a specialized bundle backend, not part of Solana consensus itself.

Current Jito documentation specifies bundles of up to five transactions executed sequentially and atomically within a slot. Jito also documents skipped/uncled-slot scenarios where transactions may be rebroadcast outside original bundle semantics.

Therefore EraScript requires application-level account/balance invariants even for Jito bundles. A `bundle landed` result alone is not sufficient recovery evidence.

## 5. Sui family

Sui uses an object-centric transaction model and must have its own type system.

Distinct primitives include:

- `SuiAddress` — canonical 32-byte address
- `SuiObjectId`
- `SuiObjectRef { objectId, version, digest }`
- `Mist`
- `SuiTransactionDigest`
- Programmable Transactions / Move calls
- transaction effects
- checkpoint evidence
- sender and gas-owner separation

The TypeScript integration target is the current `@mysten/sui` SDK.

### Sponsored transactions

Sui sponsorship is not modeled as an EVM funding transaction.

The transaction can contain separate sender and gas owner identities. Sender and sponsor signatures authorize the same final transaction bytes. EraScript must preserve this byte identity across both signatures.

Sponsor policy must validate the exact Programmable Transaction shape, gas budget and value movement before signing.

### Sui success model

EraScript separates:

```text
sponsor accepted
transaction submitted
effects returned
effects.status == success
checkpoint/evidence recorded
```

A sponsor rejection is not equivalent to an on-chain failed transaction. A dry run is not an execution guarantee.

## 6. RAILGUN is an overlay, not a chain family

RAILGUN currently operates as a privacy system on underlying EVM networks. Consensus and finality remain those of the base EVM chain.

EraScript models it as:

```text
EVM chain profile
      +
RAILGUN privacy overlay
      +
Broadcaster or self-submit execution backend
```

The current Wallet SDK flow is modeled as a state machine:

```text
PrivateIntent
   -> GasEstimated
   -> BroadcasterFeeQuoted (when broadcaster path)
   -> ProofGenerated
   -> ProvedTransactionPopulated
   -> BroadcasterSubmitted | SelfSubmitted
   -> BaseEvmIncluded
   -> BaseEvmFinalized
   -> PrivateStateVerified
```

Important RAILGUN-specific bindings:

- Network/chain
- TXID version
- wallet ID / private address
- token and amount recipients
- broadcaster fee token/amount/recipient
- gas details
- overall batch minimum gas price
- proof inputs
- Merkle state
- POI evidence where required by the configured wallet policy
- populated encrypted transaction

A proof is invalidated whenever a parameter that affects proof generation or broadcaster fee validity changes. The Developer Guide explicitly notes that broadcaster fee quotes expire and proof generation may need to be repeated.

Broadcasters are submission/gas intermediaries, not consensus participants. Finality is always inherited from the base EVM chain.

## 7. Common lifecycle vocabulary

EraScript may expose a common high-level vocabulary for AI agents:

```text
DRAFT
PREPARED
SIMULATED
AUTHORIZED
SUBMITTED
OBSERVED
FINALIZED
VERIFIED
```

However each family owns the evidence required for each transition.

Examples:

### EVM

`SIMULATED` requires eth_call/simulation evidence; `FINALIZED` may require finalized tag or configured finality model.

### Solana

`PREPARED` requires a recent blockhash or durable nonce profile; `FINALIZED` requires finalized commitment evidence.

### Sui

`OBSERVED` requires transaction effects; `FINALIZED/VERIFIED` is tied to the Sui effects/checkpoint model, not EVM confirmations.

### RAILGUN

`AUTHORIZED` includes proof-generation state. Base-chain submission and private-state verification are distinct.

## 8. AI-first rule

The AI must generate intent against a declared chain profile.

Forbidden:

```ts
send(address, amount) // family ambiguous
```

Preferred conceptual form:

```ts
chain SolanaMainnet
transfer SOL ...

chain SuiMainnet
transfer SUI ...

chain EthereumMainnet
execute EVM ... via flashbots

chain EthereumMainnet
execute private ... via railgun
```

The compiler/adapter determines which fields and verification evidence are mandatory.

## 9. Execution backend selection

Backends are capabilities, not universal APIs.

```text
Ethereum + Flashbots     valid only when profile/backend configured
Custom EVM + Flashbots   not assumed
Solana + Jito            valid when configured
Sui + Jito               invalid family mismatch
EVM + RAILGUN            valid only on supported RAILGUN deployment
Solana + RAILGUN         not treated as available unless a future official deployment/SDK explicitly supports it
```

`assertBackendCompatible()` enforces the family boundary today. Provider-specific availability will later add runtime discovery.

## 10. Package direction

Planned adapter packages/layers:

```text
@erascript/core
@erascript/evm
@erascript/evm-flashbots
@erascript/solana
@erascript/solana-jito
@erascript/sui
@erascript/railgun
```

During bootstrapping these remain modules in one repository, but dependency boundaries should follow the future package split.

## 11. Next implementation order

1. Keep existing EVM implementation behind `EvmChainProfile`.
2. Add runtime EVM capability discovery and per-chain overrides.
3. Add Solana `@solana/kit` adapter: prepare/simulate/sign/send/confirm/finalize.
4. Add Jito bundle adapter with slot/blockhash/tip and invariant verification.
5. Add Sui `@mysten/sui` adapter: build/dry-run/sponsor/sign/execute/effects/checkpoint.
6. Add RAILGUN Wallet SDK adapter: gas estimate/fee/proof/populate/Broadcaster/base-EVM-finality.
7. Extend external signer protocol to family-specific signatures.
8. Generalize verification reports from `rescue-verification-report` into a family-neutral envelope with family-specific evidence payloads.

## 12. Compatibility principle

EraScript does not claim that every EVM, Solana RPC, Sui RPC, private relay, broadcaster or block engine exposes identical behavior.

Instead it guarantees:

> A feature may only be used after its chain profile and execution backend declare or prove that the feature exists, and the evidence required for that chain family has been verified.

This is the only realistic meaning of reliable multi-chain compatibility.
