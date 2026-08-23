# EraScript

**EraScript is an AI-first, Node.js/TypeScript-compatible language for safer Web3 automation.**

The goal is not to replace Node.js. EraScript compiles to ordinary JavaScript and keeps the npm ecosystem, while adding Web3-specific types, validation, structured diagnostics, and eventually execution verification.

> **AI writes intent. EraScript verifies execution.**

## Why EraScript

Web3 scripts commonly represent addresses, hashes, proofs, calldata, token amounts, and chain IDs as ordinary strings/numbers. Small representation mistakes can become failed claims, broken rescue bundles, or asset loss.

EraScript moves these checks toward the compiler/tooling layer so AI-generated code can be rejected before execution.

## v0.2 Web3 foundation

```era
import {
  Ethereum,
  address,
  bytes32,
  proof,
  decodeArgumentsFromCalldata,
} from "erascript-lang/web3"

const safe = address(
  "0x000000000000000000000000000000000000dEaD",
  Ethereum,
)

const node = bytes32(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
)

const checkedProof = proof([node], "claim.proofs[0]")
```

Current primitives:

- `Address<Chain>` with EVM address validation
- built-in chain identities for Ethereum, BNB Chain, Base, and Arbitrum
- strict `Bytes32`
- branded `Hash`, `TransactionHash`, `BlockHash`, `MerkleRoot`, `MerkleLeaf`, `MerkleProof`
- typed `Calldata`
- ABI function encode/decode backed by `viem`
- ABI argument encode/decode
- `decodeArgumentsFromCalldata()` which removes the 4-byte selector safely
- static checks for literal addresses, bytes32 values, calldata, and proof nodes
- AI-readable JSON diagnostics

### Missing-leading-zero detection

A malformed 63-digit proof node is rejected:

```text
ES3201 InvalidBytes32
Expected bytes32 (64 hexadecimal digits), received 63 digits.
Suggestion: A leading zero may be missing. Verify the source value before padding.
```

EraScript intentionally does **not** repair proof material automatically. `leftPadBytes32()` exists only as an explicit recovery operation.

## AI agent workflow

```bash
npm install
npm run build

# Human-readable diagnostics
era check rescue.era

# Stable machine-readable diagnostics for agents
era check rescue.era --json
```

Example JSON:

```json
{
  "ok": false,
  "diagnostics": [
    {
      "code": "ES3201",
      "severity": "error",
      "kind": "InvalidBytes32",
      "path": "proof[7]",
      "suggestion": "A leading zero may be missing. Verify the source value before padding."
    }
  ]
}
```

Recommended agent loop:

```text
User intent
  -> AI generates .era
  -> era check --json
  -> AI repairs diagnostics
  -> simulation / invariant verification
  -> execution
```

## Node.js / TypeScript compatibility

Ordinary TypeScript remains valid EraScript, and normal npm packages can be used.

```era
import { createPublicClient, http } from "viem"
import fs from "node:fs"
```

EraScript v0.1 syntax sugar also remains available:

| EraScript | TypeScript meaning |
|---|---|
| `fn name()` | `function name()` |
| `pub fn name()` | `export function name()` |
| `mut x = 1` | `let x = 1` |
| `fn f() -> T` | `function f(): T` |
| `T?` | `T | null | undefined` in supported annotations |

## CLI

```bash
era build app.era -o app.js
era run app.era
era check app.era
era check app.era --json
era transpile app.era
era init my-app
```

## Architecture

```text
.era source
   |
   +--> EraScript lexical transform
   |
   +--> Web3 literal/static analysis
   |
   +--> TypeScript semantic checking
   |
   v
TypeScript / JavaScript
   |
   v
Node.js
```

Web3 runtime helpers use `viem` rather than reimplementing EVM ABI primitives.

## Roadmap

### v0.2 — Web3 safety foundation
- [x] Node.js/npm/TypeScript compatibility
- [x] Address and chain branding
- [x] Bytes32/hash/proof validation
- [x] ABI encode/decode
- [x] captured-calldata argument decoding
- [x] static Web3 literal diagnostics
- [x] `era check --json`

### v0.3 — value and contract safety
- `Wei`, `Gwei`, `Ether`
- `TokenAmount<Token>` / decimals-aware exact quantities
- ABI-derived contract method types
- chain-aware transaction types

### v0.4 — AI execution security
- `Secret<PrivateKey>` and secret-flow analysis
- signer capabilities / destination policies
- unsafe-block audit trail
- transaction DAGs

### v0.5 — rescue verification
- sponsor -> claim -> asset rescue -> native sweep plans
- Merkle root/proof verification policies
- nonce/gas/dependency validation
- final-state invariants
- RPC/fork/bundle simulation gates
- `READY` only when the configured verification policy passes

See [`docs/AI_FIRST_DESIGN.md`](docs/AI_FIRST_DESIGN.md) for the design principles.

## Status

EraScript is experimental. Do not treat successful compilation alone as authorization to broadcast an on-chain transaction.
