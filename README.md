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
- [`docs/V06_COMPLETION_CRITERIA.md`](docs/V06_COMPLETION_CRITERIA.md)
- [`docs/V07_IMPLEMENTATION.md`](docs/V07_IMPLEMENTATION.md)
- [`docs/V08_IMPLEMENTATION.md`](docs/V08_IMPLEMENTATION.md)
- [`docs/V09_IMPLEMENTATION.md`](docs/V09_IMPLEMENTATION.md)
- [`docs/V012_IMPLEMENTATION.md`](docs/V012_IMPLEMENTATION.md)
- [`docs/V013_IMPLEMENTATION.md`](docs/V013_IMPLEMENTATION.md)
- [`docs/V014_IMPLEMENTATION.md`](docs/V014_IMPLEMENTATION.md)
- [`docs/V10_IMPLEMENTATION.md`](docs/V10_IMPLEMENTATION.md)
- [`docs/V11_IMPLEMENTATION.md`](docs/V11_IMPLEMENTATION.md)
- [`docs/V10_IMPLEMENTATION.md`](docs/V10_IMPLEMENTATION.md)
- [`docs/V11_IMPLEMENTATION.md`](docs/V11_IMPLEMENTATION.md)

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

v0.8 binds that provider evidence to actual execution. High-assurance EVM code uses `discoverEvmExecutionProvider()` and carries one deterministic provider binding through preparation, block-anchored simulation, signing, and broadcast. A transaction simulated through provider A cannot be broadcast through provider B by the provider-bound API. Explicit failover invalidates the old simulation/signature, requires provider B to preserve the original capability requirements with equally fresh-or-newer evidence, then forces resimulation and re-signing.

v0.9 extends the same trust model **after broadcast**. `observeEvmExecutionWithProvider()` can independently collect receipt/canonicality/confirmation/finality evidence from multiple provider-bound clients, and `buildEvmExecutionQuorum()` passes only when every configured verifier agrees and meets the requested threshold. There is no implicit majority vote. For rollups the quorum is explicitly `l2-execution`; OP Stack/Arbitrum L1 settlement evidence is still required separately.

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
- [x] final Core CI evidence / Issue #2 closure

### v0.8 — provider-bound EVM execution
- [x] deterministic provider execution binding
- [x] exact viem client + fresh provider evidence binding
- [x] provider-bound prepare/simulate/sign/broadcast wrapper
- [x] block-anchored simulation with exact provider identity
- [x] provider substitution rejection
- [x] explicit reroute invalidates simulation/signature
- [x] reroute requires fresh-or-newer provider evidence
- [x] reroute cannot weaken original capability requirements
- [x] v0.7 conformance-matrix route validation
- [x] provider URL/credential non-persistence retained
- [x] final Core CI evidence / Issue #3 closure

### v0.9 — multi-provider EVM execution quorum
- [x] provider-bound receipt/canonicality observation
- [x] strict unanimous quorum; no majority fallback
- [x] minimum distinct provider-ID gate
- [x] deterministic provider-order-independent quorum hash
- [x] independent canonical receipt verification
- [x] confirmation threshold required from every verifier
- [x] finalizedTag/finalized-head gate for every verifier
- [x] Included/Confirmed/Finalized promotion
- [x] rollup quorum explicitly scoped to L2 execution only
- [x] provider error/endpoint secret non-persistence
- [x] observation/quorum tamper detection
- [x] deterministic regression suite / Issue #4
- [x] final v0.9.0 Core CI evidence / Issue #4 closure

### v0.10 — cross-family execution quorum
- [x] strict Solana multi-provider signature/slot/commitment quorum
- [x] Solana provider-order-independent observation/quorum integrity hashes
- [x] strict Jito binding to the exact expected Solana signature set
- [x] strict Jito landed-slot binding
- [x] finalized Solana quorum required for every expected Jito transaction
- [x] strict Sui multi-provider digest/effects/checkpoint quorum
- [x] Sui provider-order-independent observation/quorum integrity hashes
- [x] strict RAILGUN binding to matching base-EVM execution quorum
- [x] proof-bound private-state Evidence remains independently mandatory
- [x] stable ES4780–ES4800+ diagnostics / registry protection
- [x] existing single-provider APIs preserved
- [x] deterministic regression suite / Issue #5
- [x] final v0.10.0 Core CI evidence / Issue #5 closure

### v0.11 — parser/AST frontend hardening
- [x] source-preserving lexer / protected literal-comment spans
- [x] recursive template-expression code scanning
- [x] explicit Era surface AST nodes + deterministic source edits
- [x] context-aware `fn` / `pub` / `mut` parsing
- [x] recognized-function-only return-arrow lowering
- [x] context-safe simple nullable lowering
- [x] ordinary TypeScript `fn`/`mut` identifiers and members preserved
- [x] valid Era function-expression contexts preserved
- [x] regex literals protected after control headers
- [x] compiler/typecheck compatibility regression
- [x] deterministic edit overlap guard
- [x] Post-Implementation Review regression corpus
- [x] final v0.11.0 Core CI evidence / Issue #7 closure

### v0.12 — original-source diagnostics
- [x] deterministic original↔transformed UTF-16 coordinate map
- [x] semantic replacement anchors for generated tokens such as `->` → `:`
- [x] public `transformEraScript()` shape preserved
- [x] detailed transform exposes edits + coordinate map internally
- [x] TypeScript semantic/syntactic diagnostic remapping
- [x] same-primary-file related-information remapping
- [x] dependency/library diagnostics remain on their own files
- [x] Web3 diagnostics use original `.era` locations
- [x] unsafe-boundary audit IDs/locations use original `.era` coordinates
- [x] template interpolation mapping regression
- [x] `era check --json` original filename/line/column regression
- [x] final v0.12.0 Core CI evidence / Issue #8 closure

### v0.13 — emitted JavaScript source maps
- [x] dependency-free Source Map V3 Base64 VLQ codec
- [x] mapped/unmapped/named segment preservation
- [x] JS → transformed TypeScript → original EraScript composition
- [x] original `.era` `sourcesContent`
- [x] v0.12 semantic replacement anchors reused for emitted mappings
- [x] UTF-16/emoji and multi-edit mapping regression
- [x] template/nullable lowering followed by later emitted positions
- [x] ordinary TypeScript identity mapping
- [x] CLI `era build -o` sourceMappingURL/map filename consistency
- [x] pre-release Core CI run 397: 203/203 passed
- [x] final v0.13.0 Core CI evidence / Issue #9 closure

### v0.14 — runtime stack trace remapping
- [x] `era run` requests the v0.13 composed source map
- [x] temporary `main.mjs` + `main.mjs.map` runtime lifecycle
- [x] Node built-in `--enable-source-maps`
- [x] original `.era` runtime throw line regression
- [x] emoji/template/return-arrow/`mut` lowering stack regression
- [x] `--` argument passthrough preserved
- [x] custom child exit status preserved
- [x] fail-safe temporary-directory cleanup
- [x] no new runtime dependency
- [x] pre-release Core CI run 404: 206/206 passed
- [ ] final v0.14.0 Core CI evidence / Issue #10 closure

## Design documents

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md)
- [`docs/MULTICHAIN_ARCHITECTURE.md`](docs/MULTICHAIN_ARCHITECTURE.md)
- [`docs/AI_FIRST_DESIGN.md`](docs/AI_FIRST_DESIGN.md)
- [`docs/V03_IMPLEMENTATION.md`](docs/V03_IMPLEMENTATION.md)
- [`docs/V04_IMPLEMENTATION.md`](docs/V04_IMPLEMENTATION.md)
- [`docs/V05_IMPLEMENTATION.md`](docs/V05_IMPLEMENTATION.md)
- [`docs/V06_IMPLEMENTATION.md`](docs/V06_IMPLEMENTATION.md)
- [`docs/V07_IMPLEMENTATION.md`](docs/V07_IMPLEMENTATION.md)
- [`docs/V08_IMPLEMENTATION.md`](docs/V08_IMPLEMENTATION.md)
- [`docs/V09_IMPLEMENTATION.md`](docs/V09_IMPLEMENTATION.md)

## Status

EraScript v0.13.0 emitted-source-map baseline is verified at implementation commit `fbcca7bd620400b61f5a177510480c1a58f1cf86`. Core CI run **401** passed `npm install`, `npm run check`, and `npm run test:core` on Node 22 with **204/204 tests passed and 0 failures**. Issue #9 composes TypeScript emitter JS→lowered-TS Source Map V3 mappings through the v0.12 coordinate map so generated JavaScript maps to original `.era` line/column coordinates and embeds the original EraScript in `sourcesContent`. CLI `era build -o` also aligns map `file` and `sourceMappingURL` with the actual output filename. Runtime stack-trace/debugger remapping remains intentionally outside v0.13 scope.

EraScript v0.12.0 original-source diagnostic baseline is verified at commit `b8c63e0ec0867a6d7870d2df6ebacdc684cd073d`. Core CI run **392** passed `npm install`, `npm run check`, and `npm run test:core` on Node 22 with **197/197 tests passed and 0 failures**. Issue #8 closes transformed-coordinate drift by deriving one UTF-16 source-coordinate map from the exact frontend edits and using it for TypeScript diagnostics, Web3 diagnostics, unsafe audit IDs, and `era check --json`. During v0.12 development, read-only Live Network Integration run **9** also passed Solana RPC, Sui Core API, Jito, and RAILGUN/Waku regression smoke checks. Generated JavaScript sourcemap/debugger composition remains intentionally outside v0.12 scope.

EraScript v0.11.0 frontend baseline is verified at commit `23dd1720f85ad491948c62b1a754abbce939cdc9`. Core CI run **374** passed `npm run check` and `npm run test:core` on Node 22 with **185/185 tests passed and 0 failures**. Issue #7 closes the original v0.1 global lexical transformer risk by moving Era-owned syntax to a source-preserving lexer/parser/AST/edit frontend while preserving ordinary TypeScript identifiers and members.

EraScript is experimental. Successful compilation, simulation, proof generation, signing, broadcast, bundle submission, transaction signature, digest, UserOperation hash, SafeTx hash, or Broadcaster submission alone must not be treated as proof of successful execution or asset recovery.

EraScript v0.6 is implementation-complete but remains experimental software. The final implementation baseline is commit `524718c2331ce0c2560c8b3313bde05c8235d9e2`. Core CI run 299 passed on Node 22 with 138/138 tests and 0 failures. Separately isolated Live Network Integration run 7 also passed: Solana mainnet genesis/recent-blockhash evidence, Sui mainnet Core API chain binding/reference gas price, Jito mainnet `getTipAccounts`, and RAILGUN/Waku Ethereum-mainnet peer/Broadcaster discovery all succeeded without submitting transactions or bundles. The RAILGUN live smoke used Waku Broadcaster Client 9.1.1 as a live-only dependency and additionally exposed/fixed current `SelectedBroadcaster.tokenFee` and hexadecimal `feePerUnitGas` compatibility. CI-policy closure commit `0d3cb10efee46607fc5501f9d247c36bdb976ad4` then passed Core CI run 302 with the same 138/138 result; documentation-only README/`docs/**` pushes and pull requests are excluded from Core CI to avoid self-referential run-ID closure loops.


### v0.7 status

EraScript v0.7.0 adds provider-scoped EVM conformance evidence and a deterministic multi-provider capability matrix. The final code/version baseline is commit `8f9a4b435697be71d23ed855c89fc97d4cf629f0`. Core CI run 316 passed `npm install`, `npm run check`, and `npm run test:core` on Node 22 with **144/144 tests passed and 0 failures**.

The matrix remains deliberately conservative: only unanimous provider support becomes matrix-level `supported`; provider disagreement becomes `conflict`; partial evidence remains `unknown`. Individual providers that prove a requested capability may still be selected explicitly without upgrading chain-global/provider-global conformance.

### v0.8 status

EraScript v0.8.0 closes the provider-substitution/TOCTOU gap between v0.7 capability evidence and EVM execution. The final code/version baseline is commit `7da58eb253d422c676e5df0d9c31258f5b0134a1`. Core CI run 327 passed `npm install`, `npm run check`, and `npm run test:core` on Node 22 with **152/152 tests passed and 0 failures**.

The provider-bound route is additive: existing low-level viem/RPC APIs remain compatible, while AI-generated/high-assurance code can require exact provider continuity. Explicit failover returns to prepared state, discards stale simulation/signature evidence, preserves the original capability requirement set, requires fresh-or-newer evidence from the replacement provider, and then requires resimulation and re-signing.


### v0.9 status

EraScript v0.9.0 adds strict multi-provider EVM receipt/canonicality/confirmation/finality quorum on top of v0.8 provider-bound execution.

Final code/version baseline:

```text
commit: 6603a9eef3bda0a774e7d9874a2c55405bd04539
Core CI run: 336
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 162
pass: 162
fail: 0
```

The quorum is deliberately unanimous rather than majority-based. Every supplied verifier must agree on the canonical receipt and meet the requested threshold. Rollup quorum is explicitly L2-execution evidence and does not replace OP Stack/Arbitrum L1 settlement verification.

Post-implementation hardening also re-validates observation/quorum hashes before construction/promotion so runtime-mutated Evidence is rejected with machine-readable diagnostics.

### v0.10 status

EraScript v0.10.0 extends strict post-execution quorum to Solana and Sui while binding Jito and RAILGUN to the relevant base-family trust Evidence.

Implementation/hardening baseline:

```text
commit: 09b6153d55c401962187ce28b35dd57ab18dd3b0
Core CI run: 353
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 171
pass: 171
fail: 0
diagnostic registry: PASS
```

Solana and Sui keep family-native quorum semantics; there is no generic cross-family quorum abstraction. Jito remains backend evidence and requires finalized Solana quorum for every exact expected landed signature. RAILGUN remains an EVM privacy overlay and strict recovery requires both matching base-EVM execution quorum and proof-bound private-state assertions.

Final release-version baseline:

```text
commit: 3e3f945b6087736eda6f00ca8766d5cea83a88f2
Core CI run: 354
version: 0.10.0
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 171
pass: 171
fail: 0
```

Issue #5 is closed after final requirements/architecture/security/backward-compatibility review. The dedicated review record is `docs/ai/issues/5/POST_IMPLEMENTATION_REVIEW.md`.
