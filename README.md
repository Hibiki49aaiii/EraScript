# EraScript

**EraScript is an AI-first, Node.js/TypeScript-compatible language for safer multi-chain Web3 automation.**

EraScript does not replace Node.js. It compiles to ordinary JavaScript, keeps npm compatibility, and adds chain-specific types, diagnostics, execution evidence, signing policies, privacy overlays, and workflow verification.

> **AI writes intent. EraScript verifies execution.**

## Why EraScript

A syntactically correct Web3 script can still use the wrong chain, corrupt a proof, mix units, sign an unintended payload, submit stale execution data, omit a recovery step, or treat an ID/hash as success.

EraScript moves those assumptions into machine-checkable types, capability profiles, policies, evidence objects, and state transitions.

Design/implementation documents:

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md)
- [`docs/MULTICHAIN_ARCHITECTURE.md`](docs/MULTICHAIN_ARCHITECTURE.md)
- [`docs/V06_IMPLEMENTATION.md`](docs/V06_IMPLEMENTATION.md)
- [`docs/V07_IMPLEMENTATION.md`](docs/V07_IMPLEMENTATION.md)
- [`docs/V06_COMPLETION_CRITERIA.md`](docs/V06_COMPLETION_CRITERIA.md)
- [`docs/V07_IMPLEMENTATION.md`](docs/V07_IMPLEMENTATION.md)

## Multi-chain model

EraScript does not treat Ethereum or Flashbots as the universal Web3 model.

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
  |     +-- Sui Core API
  |     +-- custom provider
  |
  +-- Protocol Overlay
        +-- RAILGUN
```

Flashbots is an optional EVM backend. Jito is an optional Solana backend. RAILGUN is an EVM privacy overlay whose consensus/finality remains that of its base EVM chain.

### Reliable EVM compatibility

EraScript targets generic EVM compatibility without pretending all EVM networks expose identical RPC, fee, finality, debug, account-abstraction, sequencer, private-RPC, or bundle behavior.

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

Optional features start as `unknown` unless configured or proven. `discoverEvmCapabilities()` can currently gather evidence for EIP-1559/block shape, EIP-4844 block fields, safe/finalized block tags, and `debug_traceCall` while preserving ambiguity when a provider error is not proof of protocol non-support.

v0.7 adds provider-scoped conformance evidence so one RPC provider's behavior is not silently treated as a chain-global guarantee:

```text
provider A -> supported
provider B -> unsupported
             |
             v
matrix status = conflict
global requirement gate = fail
provider-specific candidate = provider A
```

`buildEvmConformanceMatrix()` is deliberately fail-closed: only unanimous support produces matrix-level `supported`. Supported+unknown stays `unknown`; supported+unsupported becomes `conflict`. Provider IDs are non-secret labels rather than endpoint URLs.

### Solana

Current primitives/adapters include:

- `SolanaAddress`
- `SolanaBlockhash`
- `SolanaTransactionSignature`
- `Lamports`
- `processed / confirmed / finalized`
- recent blockhash + `lastValidBlockHeight`
- legacy/v0 serialized transactions
- `@solana/kit` 8.1.0 codec compatibility tested in CI
- built-in Node.js Ed25519 cryptographic verifier for Solana external signatures
- pre-sign simulation separated from signature-verified execution simulation
- exact message/multi-signer/fee-payer binding
- post-signature wire-transaction reinspection
- durable nonce account/authority/fee-snapshot evidence
- durable nonce revalidation immediately before simulation/submission
- Address Lookup Table (ALT) resolution/warm-up/deactivation evidence
- ALT evidence bound into signer context and re-read before execution
- submission/status/finality evidence
- Jito bundle adapter

Recent-blockhash transactions are checked for `lastValidBlockHeight` before simulation and submission. Durable-nonce transactions instead re-read the nonce account before both gates. A transaction signature is not success; finality requires a successful status at `finalized` commitment.

### Jito

Jito is kept separate from normal Solana RPC.

```text
bundle draft
  -> sendBundle
  -> bundle ID
  -> inflight/status evidence
  -> exact transaction-set verification
  -> finalized Solana commitment
```

A bundle ID or `Landed` result alone is not treated as final success.

### Sui

Current primitives/adapters include:

- `SuiAddress`
- `SuiObjectId`
- `SuiObjectRef { objectId, version, digest }`
- `SuiTransactionDigest`
- `Mist`
- sender/gas-owner binding
- exact-byte sender/sponsor signature binding
- sponsored execution helper that only uses Evidence-bound signatures
- `@mysten/sui` 2.27.1 Core-API-compatible structural adapter
- direct `@mysten/sui/verify` transaction-signature bridge
- real Ed25519 TransactionData-intent signature tested in CI
- checks-enabled simulation
- `Transaction` vs `FailedTransaction` discrimination
- transaction effects
- digest continuity
- checkpoint evidence

A resolved `executeTransaction()` Promise is not success by itself. `checksEnabled=false` simulation is inspection-only and cannot pass the execution gate.

### RAILGUN

RAILGUN is a privacy overlay, not a new consensus chain.

```text
PrivateIntent
  -> GasEstimated
  -> BroadcasterFeeQuoted
  -> Wallet SDK ProofGenerated
  -> ProvedTransactionPopulated
  -> Waku BroadcasterSubmitted | SelfSubmitted
  -> Base EVM inclusion/finality
  -> PrivateStateVerified
```

Current adapters cover the Wallet SDK gas/proof/populate lifecycle, Waku Broadcaster selection/submission, and proof-bound before/after private-balance evidence. Proof evidence is bound to transfer details, gas, selected Broadcaster/fees ID, fee token/amount/recipient, and quote expiry.

A proof tied to an expired quote is rejected. A proof generated for one Broadcaster/fees ID cannot silently be submitted through another.

`VERIFIED_FINALITY` for RAILGUN requires both finalized base-EVM execution and proof-bound private-state assertions; base-chain inclusion alone does not prove expected shielded wallet state.

## EVM/Web3 safety foundation

Current EVM primitives include:

- `Address<Chain>` with checksum validation
- strict `Bytes32`, typed hashes/calldata
- ABI encode/decode and captured-calldata decoding
- exact `Wei`, `Ether`, `Gas`, fee and `TokenAmount<Token>` types
- ERC-2612 / Permit2 / WitnessTransfer safety profile
- ABI-defined Merkle schemes
- EIP-712
- EIP-7702
- Safe + Safe Transaction Service evidence
- ERC-4337 + Bundler + Paymaster lifecycle
- state-diff and fork simulation
- rescue DAG/final-state invariants
- unsafe-boundary audit trail

A malformed proof node is rejected rather than silently repaired:

```text
ES3201 InvalidBytes32
Expected bytes32 (64 hexadecimal digits), received 63 digits.
Suggestion: A leading zero may be missing. Verify the source value before padding.
```

## Transaction evidence instead of `send()`

EVM:

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

The same principle is applied with family-specific evidence to Solana signatures, Jito bundle IDs, Sui digests/effects, SafeTx hashes, UserOperation hashes, and RAILGUN submission IDs.

## AI-safe signing

EVM generated code can reference a key without exposing the raw secret, and signer policies can restrict destination, selector, value, simulation assumptions, typed data and EIP-7702 behavior.

The EVM external signer path additionally parses the returned raw transaction, recovers its signer cryptographically, and compares chainId/type/nonce/gas/to/value/data/fees/EIP-7702 authorization list against the approved request before accepting it.

v0.6 also adds a family-aware external signing envelope containing:

- chain family/profile/network
- signer role/identity
- exact payload + encoding
- payload hash
- semantic context hash
- request ID
- random challenge
- TTL

The actual cryptographic verification remains family-specific. EraScript does not pretend EVM secp256k1, Solana Ed25519 and Sui signatures are one format.

## Verification reports

Legacy EVM rescue reports retain:

```text
NOT_READY
READY_FOR_BROADCAST
RECOVERY_OBSERVED
VERIFIED_RECOVERY
```

v0.6 family-neutral reports use:

```text
NOT_READY
READY_FOR_SUBMISSION
EXECUTION_OBSERVED
VERIFIED_FINALITY
```

A multichain report binds chain family, profile, network, execution backend, optional overlay, subject, checks, evidence hashes and state into a deterministic SHA-256 `reportHash`.

`era verify` auto-detects both report formats:

```bash
era verify rescue-report.json --require VERIFIED_RECOVERY
era verify solana-report.json --require VERIFIED_FINALITY
era verify sui-report.json --require VERIFIED_FINALITY
era verify report.json --integrity-only
```

## AI agent workflow

```text
User intent
  -> AI declares chain family/profile/backend
  -> AI generates .era
  -> era check --json
  -> AI repairs structured diagnostics
  -> family-specific preparation/proof/simulation
  -> signer/sponsor/privacy policy
  -> READY_FOR_SUBMISSION / READY_FOR_BROADCAST
  -> execution backend
  -> family-specific receipt/effects/status/private-state evidence
  -> EXECUTION_OBSERVED / RECOVERY_OBSERVED
  -> family-specific finality
  -> VERIFIED_FINALITY / VERIFIED_RECOVERY
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
era verify report.json --require VERIFIED_FINALITY --json
era transpile app.era
era init my-app
era --version
```

## Node.js / TypeScript compatibility

Ordinary TypeScript remains valid EraScript and normal npm packages remain usable. EraScript adapters target each ecosystem's native TypeScript SDK instead of unnecessarily reimplementing networking and cryptography.

Current adapter direction:

```text
EVM      -> viem
Solana   -> @solana/kit-compatible client
Sui      -> @mysten/sui v2-compatible client
RAILGUN  -> RAILGUN Wallet SDK + Waku Broadcaster
```

The Solana/Sui/RAILGUN integrations are structural adapters, so these SDK packages are not forced into EraScript core as hard runtime dependencies.

## Roadmap

### v0.2 — Web3 safety foundation
- [x] Node.js/npm/TypeScript compatibility
- [x] address/chain/hash/bytes32/calldata types
- [x] ABI encode/decode and captured-calldata decoding
- [x] static Web3 diagnostics / `era check --json`

### v0.3 — transaction correctness
- [x] exact value/gas/fee types
- [x] nonce provenance
- [x] transaction lifecycle/simulation/receipt/replacement/finality
- [x] strict events / EIP-712

### v0.4 — authorization/private execution
- [x] viem RPC evidence
- [x] secret/signer capabilities
- [x] EVM external signer
- [x] TokenAmount / Permit / Permit2 / WitnessTransfer
- [x] Merkle proof profiles
- [x] Flashbots re-simulation binding
- [x] unsafe-boundary audit

### v0.5 — rescue/account verification
- [x] rescue transaction DAG
- [x] final-state invariants
- [x] state snapshots/fork/state-diff
- [x] `era verify`
- [x] EIP-7702
- [x] Safe / Transaction Service
- [x] ERC-4337 / Bundler / Paymaster

### v0.6 — multi-chain runtime
- [x] chain-family/capability model
- [x] generic unknown-by-default EVM profiles
- [x] EVM runtime capability discovery
- [x] Solana native primitives
- [x] `@solana/kit`-compatible RPC adapter
- [x] Jito bundle/status/finality adapter
- [x] Sui native primitives/object refs/effects
- [x] `@mysten/sui` v2-compatible simulation/execution/checkpoint adapter
- [x] RAILGUN overlay/proof/fee lifecycle
- [x] RAILGUN Wallet SDK adapter
- [x] Waku Broadcaster adapter
- [x] family-aware external signing envelope
- [x] family-neutral verification report
- [x] `era verify` multichain report support
- [x] Solana unsigned-message/multi-signer binding + final-wire reinspection
- [x] Solana durable nonce + ALT lifecycle evidence
- [x] Sui sponsored-transaction exact-byte/signature-role verifier
- [x] RAILGUN private-state reader/evidence interface
- [x] rollup L2 inclusion -> L1 settlement evidence (OP Stack + Arbitrum abstractions)
- [x] built-in Solana Ed25519 cryptographic signature verifier
- [x] Sui serialized-signature verifier bridge via current `@mysten/sui/verify`
- [x] package-level integration tests for `@solana/kit` 8.1.0 and `@mysten/sui` 2.27.1
- [x] direct RAILGUN Wallet SDK 10.9.0 private-balance bridge + proof-bound transition helper
- [x] isolated live-network Solana RPC / Sui Core API / Jito / RAILGUN-Waku integration matrix


### v0.7 — EVM provider conformance
- [x] provider-scoped capability evidence
- [x] deterministic multi-provider conformance matrix
- [x] explicit provider conflict state
- [x] fail-closed global capability requirements
- [x] provider-specific capability routing
- [x] input-order-independent matrix hash
- [x] real viem chain fixtures: Ethereum / BSC / Polygon / Avalanche / Gnosis
- [ ] final Core CI evidence / Issue #2 closure

## Design documents

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md)
- [`docs/MULTICHAIN_ARCHITECTURE.md`](docs/MULTICHAIN_ARCHITECTURE.md)
- [`docs/AI_FIRST_DESIGN.md`](docs/AI_FIRST_DESIGN.md)
- [`docs/V03_IMPLEMENTATION.md`](docs/V03_IMPLEMENTATION.md)
- [`docs/V04_IMPLEMENTATION.md`](docs/V04_IMPLEMENTATION.md)
- [`docs/V05_IMPLEMENTATION.md`](docs/V05_IMPLEMENTATION.md)
- [`docs/V06_IMPLEMENTATION.md`](docs/V06_IMPLEMENTATION.md)

## Status

EraScript is experimental. Successful compilation, simulation, proof generation, signing, broadcast, bundle submission, transaction signature, digest, UserOperation hash, SafeTx hash, or Broadcaster submission alone must not be treated as proof of successful execution or asset recovery.

EraScript v0.6 is implementation-complete but remains experimental software. The final implementation baseline is commit `524718c2331ce0c2560c8b3313bde05c8235d9e2`. Core CI run 299 passed on Node 22 with 138/138 tests and 0 failures. Separately isolated Live Network Integration run 7 also passed: Solana mainnet genesis/recent-blockhash evidence, Sui mainnet Core API chain binding/reference gas price, Jito mainnet `getTipAccounts`, and RAILGUN/Waku Ethereum-mainnet peer/Broadcaster discovery all succeeded without submitting transactions or bundles. The RAILGUN live smoke used Waku Broadcaster Client 9.1.1 as a live-only dependency and additionally exposed/fixed current `SelectedBroadcaster.tokenFee` and hexadecimal `feePerUnitGas` compatibility. CI-policy closure commit `0d3cb10efee46607fc5501f9d247c36bdb976ad4` then passed Core CI run 302 with the same 138/138 result; documentation-only README/`docs/**` pushes and pull requests are excluded from Core CI to avoid self-referential run-ID closure loops.
