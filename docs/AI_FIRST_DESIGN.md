# EraScript AI-First Web3 Design

EraScript is designed for a workflow where an AI agent writes or modifies Web3 automation and the compiler acts as a deterministic safety boundary before Node.js execution.

## Core loop

```text
User intent
  -> AI generates .era
  -> era check --json
  -> AI repairs structured diagnostics
  -> ABI / proof / transaction verification
  -> simulation
  -> execution
```

A syntactically valid program is not considered ready for execution.

## v0.2 safety primitives

### Chain-branded addresses

```ts
const safe = address("0x...", Ethereum)
const sponsor = address("0x...", BNBChain)
```

The type layer distinguishes `Address<Ethereum>` from `Address<BNBChain>` even though both are 20-byte EVM values.

### Strict bytes32

```ts
const node = bytes32("0x...")
```

`bytes32()` requires exactly 64 hexadecimal digits. A 63-digit value produces `ES3201 InvalidBytes32` with a machine-readable hint that a leading zero may be missing.

EraScript does **not** silently repair the value. Explicit recovery requires `leftPadBytes32()` so an AI cannot accidentally mutate proof material without making that intent visible in code review.

### Merkle proof validation

```ts
const checked = proof(rawProof, "claim.proofs[0]")
```

Every node is validated and failures identify the precise array path, for example `claim.proofs[0][7]`.

### ABI encode/decode

```ts
const data = encodeCall(abi, "batchClaim", args)
const decoded = decodeCall(abi, data)
```

Captured transaction calldata can be decoded without manually slicing selectors:

```ts
const decoded = decodeArgumentsFromCalldata(parameters, capturedCalldata)
```

The helper removes exactly the 4-byte function selector and ABI-decodes the remainder.

### AI-readable diagnostics

```bash
era check rescue.era --json
```

Example shape:

```json
{
  "ok": false,
  "diagnostics": [
    {
      "code": "ES3201",
      "severity": "error",
      "kind": "InvalidBytes32",
      "path": "proof[7]",
      "details": {
        "expectedHexDigits": 64,
        "actualHexDigits": 63
      },
      "suggestion": "A leading zero may be missing. Verify the source value before padding."
    }
  ]
}
```

Agents should consume `code`, `kind`, `path`, `details`, and `suggestion` rather than scraping human-formatted compiler output.

## Design rule

EraScript must prefer **explicit failure over implicit repair** for values that can control asset movement: addresses, calldata, hashes, Merkle proofs, amounts, signers, and destinations.

## Next safety layers

1. `Wei`, `Gwei`, `Ether`, and `TokenAmount<Token>` exact quantity types.
2. ABI-derived contract method types.
3. `Secret<PrivateKey>` non-exfiltration and signer capabilities.
4. Transaction DAGs for sponsor -> claim -> rescue -> native sweep flows.
5. Final-state invariants so omitted recovery steps become compile/verification failures.
6. RPC and fork simulation gates before an execution plan can become `READY`.
