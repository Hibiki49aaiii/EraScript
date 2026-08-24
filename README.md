# EraScript

**EraScript is an AI-first, Node.js/TypeScript-compatible language for safer Web3 automation.**

EraScript does not replace Node.js. It compiles to ordinary JavaScript, keeps npm/viem compatibility, and adds Web3-specific types, diagnostics, execution evidence, signing policies, and rescue-workflow verification.

> **AI writes intent. EraScript verifies execution.**

## Why EraScript

A syntactically correct Node.js Web3 script can still use the wrong chain, corrupt a proof, mix token units, sign an unintended authorization, submit a stale bundle, omit a recovery transaction, or treat a transaction hash as success.

EraScript moves those assumptions into machine-checkable types, policies, evidence objects, and state transitions.

The normative design is maintained in [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md).

## Current v0.5 foundation

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
- explicit Permit2 recipient semantics
- ABI-defined Merkle schemes and proof verification
- AI-readable diagnostics

A malformed 63-digit proof node is rejected instead of silently padded:

```text
ES3201 InvalidBytes32
Expected bytes32 (64 hexadecimal digits), received 63 digits.
Suggestion: A leading zero may be missing. Verify the source value before padding.
```

## Transaction evidence instead of `send()`

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

A transaction hash is **not** success. An included transaction is **not** finality.

## AI-safe signing

Generated code can reference a key without receiving its raw value:

```era
const victimKey = privateKeyEnv(
  "VICTIM_PRIVATE_KEY",
  Ethereum,
  victimAddress,
)
```

`SignerPolicy` can restrict:

- chain and signer address
- destination allowlist
- function selector allowlist
- native value
- state-override simulation
- EIP-712 primary type and verifying contract
- EIP-7702 transactions and delegate addresses
- replayable EIP-7702 authorizations
- delegation clearing

For stronger isolation, `ExternalSigner` lets the AI/code-generation process send a normalized signing request to a separate secret-bearing process. The external signer sees the transaction type, authorization list, fee model, and simulation evidence but EraScript does not need to expose a private key to the AI process.

Static analysis also rejects common direct secret patterns such as `process.env.PRIVATE_KEY` and hardcoded private keys.

## EIP-7702

EraScript models the authorization lifecycle explicitly:

```text
Authority + Delegate + Chain + Nonce
  -> Policy check
  -> Signed authorization
  -> Cryptographic authority verification
  -> authorizationList
  -> EIP-7702 transaction preparation
  -> simulation
  -> signing
```

Safety rules include:

- chain-bound authorization by default
- `chainId = 0` replayability is default-deny
- zero-address delegation clearing is default-deny
- delegate allowlists
- self-execution authorization nonce = outer transaction nonce + 1
- relayer and self execution are explicit
- duplicate authority tuples are rejected
- authorization transactions require destination + EIP-1559 fees
- the authorization list is propagated through gas estimation, simulation, local signing, and external signing

## Flashbots

EraScript models bundles as target-bound evidence:

```text
bundle-draft
  -> eth_callBundle
  -> bundle-simulated
  -> eth_sendBundle
  -> bundle-submitted
```

Changing the target block returns the bundle to draft state and forces re-simulation. Bundle checks include chain, ordering, nonce continuity, size/count limits, reverts, target freshness, and state-block binding.

## Rescue DAG and final-state invariants

Rescue operations are modeled as a transaction graph rather than an unstructured array:

```text
fund
  -> claim
  -> token-rescue
  -> native-sweep
```

EraScript can reject:

- a declared recovery asset with no rescue step
- a required native sweep with no sweep transaction
- nonce-contiguous transactions with missing dependency edges
- stale or differently anchored transaction simulations
- a Flashbots bundle whose order differs from the graph

Post-execution state can be checked from block-anchored native/ERC-20 snapshots:

```text
victim.TOKEN == 0
victim.ETH <= dust
safe.TOKEN delta >= expected recovery
```

## Verification states

EraScript deliberately separates planning, observation, and finality:

```text
NOT_READY
READY_FOR_BROADCAST
RECOVERY_OBSERVED
VERIFIED_RECOVERY
```

`VERIFIED_RECOVERY` is reserved for a recovery whose final-state invariants are satisfied with finalized chain evidence.

Verification reports contain a deterministic `reportHash`. The CLI recomputes this hash before trusting a report.

```bash
era verify report.json
era verify report.json --require VERIFIED_RECOVERY --json
era verify report.json --integrity-only
```

By default `era verify` requires `READY_FOR_BROADCAST` or stronger. `--integrity-only` validates only report schema/hash and must be chosen explicitly.

## AI agent workflow

```text
User intent
  -> AI generates .era
  -> era check --json
  -> AI repairs diagnostics
  -> proof / ABI / authorization checks
  -> RPC preparation
  -> block-anchored simulation
  -> signer policy
  -> local or external signing
  -> Flashbots/private execution gate
  -> READY_FOR_BROADCAST
  -> execution
  -> block-anchored post-state verification
  -> RECOVERY_OBSERVED
  -> finality
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

Ordinary TypeScript remains valid EraScript and normal npm packages remain usable.

```era
import { createPublicClient, http } from "viem"
import fs from "node:fs"
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
- [x] ERC-2612 / Permit2
- [x] Merkle scheme profiles and proof verification
- [x] Flashbots target/state binding and re-simulation
- [ ] unsafe-boundary audit trail

### v0.5 — rescue and account verification
- [x] rescue transaction DAG
- [x] nonce/dependency validation across transaction graphs
- [x] final-state invariants
- [x] block-anchored balance snapshots
- [x] verification report hashing
- [x] `era verify`
- [x] EIP-7702 authorization lifecycle and transaction integration
- [ ] Safe lifecycle
- [ ] ERC-4337 UserOperation / bundler / paymaster types
- [ ] fork/state-diff simulation adapters

## Design documents

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md) — normative Web3 specification
- [`docs/AI_FIRST_DESIGN.md`](docs/AI_FIRST_DESIGN.md) — AI-first safety principles
- [`docs/V03_IMPLEMENTATION.md`](docs/V03_IMPLEMENTATION.md) — transaction correctness
- [`docs/V04_IMPLEMENTATION.md`](docs/V04_IMPLEMENTATION.md) — RPC evidence/private execution
- [`docs/V05_IMPLEMENTATION.md`](docs/V05_IMPLEMENTATION.md) — rescue verification, external signing, and EIP-7702

## Status

EraScript is experimental. Successful compilation, simulation, signing, broadcast, or bundle submission alone must not be treated as proof of successful asset recovery.
