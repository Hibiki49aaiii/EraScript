# EraScript v0.4 — RPC Evidence & Private Execution

v0.4 connects the transaction-correctness types from v0.3 to real viem clients and adds a default-deny signing capability model for AI-generated Web3 automation.

## Implemented

### RPC evidence adapter

`src/web3/rpc.ts` accepts normal chain-bound viem clients and normalizes RPC results into EraScript evidence types.

Implemented flows:

- `readNonceFromRpc()` — `latest`, `pending`, `safe`, or `finalized` nonce provenance
- `estimateGasFromRpc()` — gas estimation with an explicit sender
- `estimateFeeModelFromRpc()` — EIP-1559 or legacy fee evidence
- `prepareDraftWithRpc()` — converts `DraftTx` to `PreparedTx`
- `simulatePreparedWithRpc()` — anchors simulation to a concrete block number and block hash
- `broadcastSignedWithRpc()` — broadcasts only an already-signed `SignedTx`
- `waitForInclusionFromRpc()` — receipt and replacement detection
- `confirmIncludedFromRpc()` — confirmation threshold plus canonical block check
- `finalizeConfirmedFromRpc()` — requires the transaction block to be at or below the RPC's finalized block

### Reorg handling

Before promotion to `ConfirmedTx` or `FinalizedTx`, EraScript re-fetches the receipt block by number and verifies its hash still matches the original receipt.

A mismatch raises:

```text
ES3707 ReorgDetected
```

This prevents an AI agent from treating a receipt from a non-canonical block as durable execution evidence.

### Simulation evidence

Simulation is bound to a concrete block and records whether state overrides were used.

```ts
simulation: {
  status: "success",
  blockNumber,
  blockHash,
  stateOverrides: false,
  provider: "..."
}
```

State-override simulation is not equivalent to real-state simulation. Signer policies reject it by default.

### Secret references

EraScript source does not need to contain a private key value.

```ts
const victimKey = privateKeyEnv(
  "VICTIM_PRIVATE_KEY",
  Ethereum,
  victimAddress,
)
```

`PrivateKeyRef` stores only metadata such as the environment-variable name, chain binding, and optional expected signer address. The raw key is resolved internally only when a permitted signing operation occurs.

### Signer capabilities

A `SignerCapability` is a default-deny policy.

It can restrict:

- chain
- destination addresses
- 4-byte function selectors
- contract creation
- plain native transfers
- maximum native value
- state-override simulation
- EIP-712 primary types
- EIP-712 verifying contracts

Example:

```ts
const capability = signerCapability(victimKey, {
  chain: Ethereum,
  allowedDestinations: [claimContract, safeWallet],
  allowedSelectors: [functionSelector("0x12345678")],
  maxValue: wei("0"),
})
```

An AI-generated transaction outside that authority is rejected before signing.

### Capability signing

`signSimulatedWithCapability()` requires a successful `SimulatedTx`, validates the capability, resolves the private key internally, derives the signer address, verifies it against the transaction sender, signs locally with viem, and returns `SignedTx`.

The API never returns the raw private key.

`signTypedDataWithCapability()` applies the same model to EIP-712 signatures.

### Static secret diagnostics

The EraScript analyzer now rejects common direct private-secret patterns such as:

```ts
process.env.PRIVATE_KEY
privateKeyToAccount("0x<32-byte-private-key>")
```

Diagnostics:

```text
ES3820 DirectPrivateSecretAccess
ES3821 HardcodedPrivateKey
```

The intended path is `privateKeyEnv()` -> `SignerCapability` -> capability signing.

## Execution model after v0.4

```text
AI intent
  -> DraftTx
  -> RPC preparation
  -> block-anchored simulation
  -> SignerCapability policy check
  -> internal secret resolution
  -> SignedTx
  -> raw transaction broadcast
  -> inclusion / replacement evidence
  -> canonicality check
  -> confirmation threshold
  -> finalized-block check
  -> FinalizedTx
```

A transaction hash is not success, and an included transaction is not finality.

## Security boundary

`SecretRef` and `SignerCapability` reduce accidental exposure and constrain AI-generated signing requests, but JavaScript running with unrestricted access inside the same operating-system process cannot provide cryptographic isolation from a malicious process peer.

For high-value execution, the AI/code-generation process SHOULD be separated from the secret-bearing signer process or connected through a restricted signing service / hardware-backed signer. EraScript's capability model is designed so that this separation can be added without changing transaction intent code.

## Next implementation target

- `TokenAmount<Token, Chain, Decimals>`
- Permit and Permit2 authorization envelopes
- Merkle scheme profiles and proof verification
- Flashbots bundle target-block binding and per-block re-simulation
- transaction DAGs and final-state invariants
- signer service / external capability provider interface
- `era verify`
