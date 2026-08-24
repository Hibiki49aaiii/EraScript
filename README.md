# EraScript

**EraScript is an AI-first, Node.js/TypeScript-compatible language for safer Web3 automation.**

EraScript does not replace Node.js. It compiles to ordinary JavaScript, keeps npm/viem compatibility, and adds Web3-specific types, diagnostics, execution evidence, and signing policies.

> **AI writes intent. EraScript verifies execution.**

## Why EraScript

Web3 scripts routinely represent addresses, hashes, proofs, calldata, token amounts, chain IDs, nonces, transaction state, and signing authority as ordinary strings and numbers. A syntactically correct Node.js script can therefore still claim the wrong proof, use the wrong chain, sign an unintended call, or treat a transaction hash as success.

EraScript moves those assumptions into machine-checkable types and state transitions.

The normative design is maintained in [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md).

## Current v0.4 foundation

### Strict Web3 values

```era
import {
  Ethereum,
  address,
  bytes32,
  proof,
  decodeArgumentsFromCalldata,
} from "erascript-lang/web3"

const safe = address(
  "0x000000000000000000000000000000000000dead",
  Ethereum,
)

const checkedProof = proof([
  bytes32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
])
```

Current primitives include:

- `Address<Chain>` with EVM address/checksum validation
- Ethereum, BNB Chain, Base, and Arbitrum chain identities
- strict `Bytes32`
- `Hash`, `TransactionHash`, `BlockHash`, `MerkleRoot`, `MerkleLeaf`, `MerkleProof`
- typed `Calldata`
- ABI function/argument encode and decode via viem
- safe 4-byte selector removal for captured calldata
- AI-readable JSON diagnostics
- `Wei`, `Ether`, `Gas`, `WeiPerGas`, and EIP-1559 fee types
- chain-bound nonce provenance
- transaction lifecycle types
- EIP-712 domain/signature envelopes
- strict event decoding and event invariants

A malformed 63-digit proof node is rejected instead of silently padded:

```text
ES3201 InvalidBytes32
Expected bytes32 (64 hexadecimal digits), received 63 digits.
Suggestion: A leading zero may be missing. Verify the source value before padding.
```

## RPC evidence instead of `send()`

v0.4 connects EraScript lifecycle types to normal viem clients:

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

The adapter records or checks:

- nonce provenance (`latest`, `pending`, `safe`, `finalized`)
- gas and fee estimation
- chain-bound RPC clients
- simulation block number and block hash
- state-override simulation usage
- raw signed transaction broadcast
- replacement / repricing / cancellation
- reverted receipts
- confirmation threshold
- canonical receipt block hash
- finalized block progress

A transaction hash is **not** success. An included transaction is **not** finality.

## AI-safe signer capabilities

Instead of exposing a raw private key to generated code:

```era
const victimKey = privateKeyEnv(
  "VICTIM_PRIVATE_KEY",
  Ethereum,
  victimAddress,
)

const capability = signerCapability(victimKey, {
  chain: Ethereum,
  allowedDestinations: [claimContract, safeWallet],
  allowedSelectors: [functionSelector("0x12345678")],
  maxValue: wei("0"),
})
```

`signSimulatedWithCapability()` only accepts a successful `SimulatedTx` and can enforce:

- chain
- signer address
- destination allowlist
- 4-byte function selector allowlist
- contract creation permission
- native-transfer permission
- maximum native value
- whether state-override simulation may be signed
- EIP-712 primary type
- EIP-712 verifying contract

The private key value is resolved internally at signing time and is not returned by the API.

EraScript also rejects common bypasses during static checking:

```text
ES3820 DirectPrivateSecretAccess
ES3821 HardcodedPrivateKey
```

For example, `process.env.PRIVATE_KEY` or a literal private key passed directly to `privateKeyToAccount()` is rejected in EraScript source.

## AI agent workflow

```text
User intent
  -> AI generates .era
  -> era check --json
  -> AI repairs diagnostics
  -> RPC preparation
  -> block-anchored simulation
  -> signer capability verification
  -> signing
  -> broadcast
  -> receipt / replacement verification
  -> canonicality / confirmations / finality
  -> workflow invariants
```

Current CLI:

```bash
npm install
npm run build

era build app.era -o app.js
era run app.era
era check app.era
era check app.era --json
era transpile app.era
era init my-app
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

## Architecture

```text
.era source
   |
   +--> EraScript transform
   +--> Web3/static secret analysis
   +--> TypeScript semantic checking
   |
   v
JavaScript / Node.js
   |
   +--> viem RPC evidence
   +--> EraScript signing capabilities
   v
EVM
```

## Roadmap

### v0.2 — Web3 safety foundation
- [x] Node.js/npm/TypeScript compatibility
- [x] Address and chain branding
- [x] Bytes32/hash/proof validation
- [x] ABI encode/decode
- [x] captured-calldata argument decoding
- [x] static Web3 literal diagnostics
- [x] `era check --json`

### v0.3 — transaction correctness
- [x] `Wei`, `Ether`, `Gas`, `WeiPerGas`, EIP-1559 fee types
- [x] nonce provenance
- [x] transaction lifecycle types
- [x] simulation evidence model
- [x] receipt/replacement/confirmation/finality model
- [x] strict event/log decoding
- [x] EIP-712 domain/signature types

### v0.4 — authorization and private execution
- [x] viem RPC evidence adapter
- [x] block-anchored simulation
- [x] reorg/canonicality checks
- [x] finalized-block verification
- [x] `SecretRef<PrivateKey>`
- [x] signer destination/selector/value capabilities
- [x] capability-based local transaction signing
- [x] capability-based EIP-712 signing
- [x] direct/hardcoded private-key diagnostics
- [ ] `TokenAmount<Token, Chain, Decimals>`
- [ ] Permit / Permit2 typed authorizations
- [ ] Merkle scheme profiles and proof verification
- [ ] Flashbots target-block binding and per-block re-simulation
- [ ] unsafe-boundary audit trail

### v0.5 — account and rescue verification
- [ ] Safe lifecycle
- [ ] ERC-4337 UserOperation/bundler/paymaster types
- [ ] EIP-7702 authorization lifecycle
- [ ] sponsor -> claim -> asset rescue -> native sweep transaction DAGs
- [ ] nonce/gas/dependency validation across transaction graphs
- [ ] final-state invariants
- [ ] RPC/fork/bundle simulation gates
- [ ] `era verify`
- [ ] `READY` only when the configured verification policy passes

## Design documents

- [`docs/WEB3_SPEC.md`](docs/WEB3_SPEC.md) — normative Web3 specification
- [`docs/AI_FIRST_DESIGN.md`](docs/AI_FIRST_DESIGN.md) — AI-first safety principles
- [`docs/V03_IMPLEMENTATION.md`](docs/V03_IMPLEMENTATION.md) — transaction correctness implementation
- [`docs/V04_IMPLEMENTATION.md`](docs/V04_IMPLEMENTATION.md) — RPC evidence and private execution implementation

## Status

EraScript is experimental. Successful compilation, simulation, or broadcast alone must not be treated as authorization or proof of successful asset recovery.
