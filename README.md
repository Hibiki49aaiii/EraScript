# EraScript

**EraScript is an AI-first, Node.js/TypeScript-compatible language for safer multi-chain Web3 automation.**

EraScript does not replace Node.js. It compiles to ordinary JavaScript, keeps npm compatibility, and adds chain-specific types, diagnostics, execution evidence, signing policies, privacy overlays, and workflow verification.

> **AI writes intent. EraScript verifies execution.**

## Why EraScript

A syntactically correct Node.js Web3 script can still use the wrong chain, corrupt a proof, mix token units, sign an unintended authorization, submit stale execution data, omit a recovery transaction, or treat a transaction/hash as success.

EraScript moves those assumptions into machine-checkable types, policies, evidence objects, capability profiles, and state transitions.

Normative/current design documents:

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md)
- [`docs/MULTICHAIN_ARCHITECTURE.md`](docs/MULTICHAIN_ARCHITECTURE.md)

## Multi-chain model

EraScript no longer treats Flashbots or Ethereum as the universal execution model.

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
```

Flashbots is an optional EVM execution backend. Jito is an optional Solana execution backend. RAILGUN is an EVM privacy overlay whose consensus/finality remains that of the underlying EVM chain.

### Reliable EVM compatibility

EraScript targets generic EVM compatibility without assuming every EVM chain exposes identical RPC, fee, finality, debug, AA, sequencer, private-RPC, or bundle behavior.

Unknown/custom EVM networks begin with optional capabilities set to `unknown`:

```ts
const chain = genericEvmProfile({
  id: "evm.custom.777",
  name: "Custom EVM",
  chainId: 777,
})

chain.capabilities.eip1559   // unknown
chain.capabilities.eip7702   // unknown
chain.capabilities.bundleRpc // unknown
```

A feature must be explicitly configured or discovered before EraScript relies on it.

### Solana foundation

Current primitives include:

- `SolanaAddress`
- `SolanaBlockhash`
- `SolanaTransactionSignature`
- `Lamports`
- `processed / confirmed / finalized` commitments
- recent blockhash + `lastValidBlockHeight` freshness evidence
- legacy/v0 transaction profile
- Jito backend capability

A stale blockhash is rejected before signing/submission.

### Sui foundation

Current primitives include:

- `SuiAddress`
- `SuiObjectId`
- `SuiObjectRef { objectId, version, digest }`
- `SuiTransactionDigest`
- `Mist`
- transaction-effects evidence
- sponsored transaction capability
- effects/checkpoint finality model

Sui sender/gas-owner semantics are not represented as EVM funding transactions.

### RAILGUN foundation

RAILGUN private execution has its own evidence lifecycle:

```text
PrivateIntent
  -> GasEstimated
  -> BroadcasterFeeQuoted (broadcaster flow)
  -> ProofGenerated
  -> Populated
  -> BroadcasterSubmitted | SelfSubmitted
  -> underlying EVM inclusion/finality
  -> private-state verification
```

Proof evidence is bound to transfer details, gas evidence, broadcaster fee details and expiry. A proof tied to an expired broadcaster quote is rejected instead of silently reused.

## Current EVM/Web3 foundation

### Web3 values and calldata

Current primitives include:

- `Address<Chain>` with EVM address/checksum validation
- Ethereum, BNB Chain, Base, and Arbitrum chain identities
- strict `Bytes32`
- `Hash`, `TransactionHash`, `BlockHash`, `MerkleRoot`, `MerkleLeaf`, `MerkleProof`
- typed `Calldata`
- ABI function/argument encode and decode via viem
- safe 4-byte selector removal for captured calldata
- `Wei`, `Ether`, `Gas`, fee types, and exact `TokenAmount<Token>`
- ERC-2612 Permit and Permit2 authorization envelopes
- Permit2 WitnessTransfer safety profile
- ABI-defined Merkle schemes and proof verification
- AI-readable diagnostics

A malformed 63-digit proof node is rejected instead of silently padded:

```text
ES3201 InvalidBytes32
Expected bytes32 (64 hexadecimal digits), received 63 digits.
Suggestion: A leading zero may be missing. Verify the source value before padding.
```

## Transaction evidence instead of `send()`

EVM example:

```text
DraftTx
  -> PreparedTx
  -> SimulatedTx
  -> SignedTx
  -> BroadcastTx
  -> IncludedTx
  -> ConfirmedTx
  -> FinalizedTx
```

EraScript records or checks nonce provenance, gas and fees, block-anchored simulation, replacements, reverted receipts, canonical block hashes, confirmations, and finalized state.

A transaction hash is **not** success. The same principle applies to Solana signatures, Sui digests, SafeTx hashes, UserOperation hashes, bundle IDs, and RAILGUN submission IDs.

## AI-safe signing

Generated EVM code can reference a key without receiving its raw value:

```era
const victimKey = privateKeyEnv(
  "VICTIM_PRIVATE_KEY",
  Ethereum,
  victimAddress,
)
```

`SignerPolicy` can restrict chain, signer, destination, selector, value, simulation assumptions, typed data and EIP-7702 behavior.

For stronger isolation, `ExternalSigner` separates the AI/code-generation process from the secret-bearing signer process.

Static analysis rejects common direct secret patterns such as `process.env.PRIVATE_KEY` and hardcoded private keys.

## EIP-7702 / Safe / ERC-4337

EraScript currently includes:

- chain-bound EIP-7702 authorization lifecycle
- replayable/clear-delegation default-deny policy
- authorization-list transaction integration
- SafeTxHash lifecycle and Safe Transaction Service coordination evidence
- ERC-4337 UserOperation lifecycle
- Bundler evidence
- Paymaster stub/final lifecycle
- EntryPoint execution/finality evidence

These remain EVM-family modules and are not forced onto Solana or Sui.

## Flashbots and Jito

Flashbots bundles are modeled as EVM provider-specific target-bound evidence. Changing target block forces re-simulation.

Jito is modeled separately for Solana. Bundle support must never be inferred merely because a chain is Solana, just as Flashbots support must never be inferred merely because a chain is EVM.

## Rescue DAG, fork simulation, and final-state invariants

EVM rescue operations can be modeled as a transaction DAG:

```text
fund
  -> claim
  -> token-rescue
  -> native-sweep
```

EraScript includes:

- missing rescue/sweep detection
- nonce/dependency validation
- block-anchored RPC simulation
- `debug_traceCall` state-diff evidence
- fork sequence execution
- final-state balance invariants
- Flashbots exact-order verification
- unsafe-boundary audit trail

The same invariant concept is intended to be family-neutral, while state acquisition/execution evidence stays family-specific.

## Verification states

```text
NOT_READY
READY_FOR_BROADCAST
RECOVERY_OBSERVED
VERIFIED_RECOVERY
```

`VERIFIED_RECOVERY` is reserved for a recovery whose final-state invariants are satisfied with the configured chain-family finality evidence.

Verification reports contain a deterministic `reportHash`. The CLI recomputes this hash before trusting a report.

```bash
era verify report.json
era verify report.json --require VERIFIED_RECOVERY --json
era verify report.json --integrity-only
```

## AI agent workflow

```text
User intent
  -> AI declares chain family/profile
  -> AI generates .era
  -> era check --json
  -> AI repairs diagnostics
  -> chain-specific proof/ABI/object/instruction checks
  -> chain-specific preparation + simulation
  -> signer/sponsor/proof policy
  -> execution-backend gate
  -> READY_FOR_BROADCAST
  -> execution
  -> chain-specific effects/receipt/state verification
  -> RECOVERY_OBSERVED
  -> family-specific finality
  -> VERIFIED_RECOVERY
```

## CLI

```bash
npm install
npm run build

era build app.era -o app.js
era run app.era
era check app.era
era check app.era --json
era verify report.json
era verify report.json --require VERIFIED_RECOVERY --json
era transpile app.era
era init my-app
era --version
```

## Node.js / TypeScript compatibility

Ordinary TypeScript remains valid EraScript and normal npm packages remain usable. Chain adapters will target the ecosystem's native TypeScript SDKs rather than reimplementing networking/cryptography unnecessarily.

Current/planned adapter direction:

```text
EVM      -> viem
Solana   -> @solana/kit
Sui      -> @mysten/sui
RAILGUN  -> @railgun-community/wallet + shared models/broadcaster client
```

EraScript v0.1 syntax sugar remains available:

| EraScript | TypeScript meaning |
|---|---|
| `fn name()` | `function name()` |
| `pub fn name()` | `export function name()` |
| `mut x = 1` | `let x = 1` |
| `fn f() -> T` | `function f(): T` |
| `T?` | `T | null | undefined` in supported annotations |

## Roadmap

### v0.2 — Web3 safety foundation
- [x] Node.js/npm/TypeScript compatibility
- [x] address/chain/hash/bytes32/calldata types
- [x] ABI encode/decode and captured-calldata decoding
- [x] static Web3 literal diagnostics
- [x] `era check --json`

### v0.3 — transaction correctness
- [x] exact native value / gas / fee types
- [x] nonce provenance
- [x] transaction lifecycle and simulation evidence
- [x] receipt/replacement/confirmation/finality model
- [x] strict event decoding
- [x] EIP-712 envelopes

### v0.4 — authorization and private execution
- [x] viem RPC evidence adapter
- [x] signer capabilities and secret references
- [x] external signer boundary
- [x] `TokenAmount`
- [x] ERC-2612 / Permit2 / WitnessTransfer safety profile
- [x] Merkle scheme profiles and proof verification
- [x] Flashbots target/state binding and re-simulation
- [x] unsafe-boundary audit trail

### v0.5 — rescue and account verification
- [x] rescue transaction DAG
- [x] final-state invariants
- [x] block-anchored balance snapshots
- [x] verification report hashing / `era verify`
- [x] EIP-7702
- [x] Safe lifecycle + Transaction Service evidence
- [x] ERC-4337 UserOperation / Bundler / Paymaster types
- [x] fork/state-diff simulation adapters

### v0.6 — multi-chain foundation
- [x] chain-family capability model
- [x] generic EVM profile with unknown-by-default optional capabilities
- [x] execution backend abstraction
- [x] Solana typed primitives and blockhash-expiry evidence
- [x] Sui typed primitives/object references/effects foundation
- [x] RAILGUN overlay and proof/fee lifecycle foundation
- [ ] EVM runtime capability discovery/override profiles
- [ ] `@solana/kit` transaction adapter
- [ ] Jito simulation/submission/finality adapter
- [ ] `@mysten/sui` PTB/sponsorship/effects adapter
- [ ] RAILGUN Wallet SDK + Waku Broadcaster adapter
- [ ] family-neutral verification report envelope
- [ ] family-aware external signer protocol

## Design documents

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md) — EVM/Web3 specification
- [`docs/MULTICHAIN_ARCHITECTURE.md`](docs/MULTICHAIN_ARCHITECTURE.md) — EVM/Solana/Sui/RAILGUN architecture
- [`docs/AI_FIRST_DESIGN.md`](docs/AI_FIRST_DESIGN.md) — AI-first safety principles
- [`docs/V03_IMPLEMENTATION.md`](docs/V03_IMPLEMENTATION.md) — transaction correctness
- [`docs/V04_IMPLEMENTATION.md`](docs/V04_IMPLEMENTATION.md) — RPC evidence/private execution
- [`docs/V05_IMPLEMENTATION.md`](docs/V05_IMPLEMENTATION.md) — rescue/account verification

## Status

EraScript is experimental. Successful compilation, simulation, proof generation, signing, broadcast, bundle submission, transaction signature, digest, UserOperation hash, SafeTx hash, or Broadcaster submission alone must not be treated as proof of successful execution or asset recovery.
