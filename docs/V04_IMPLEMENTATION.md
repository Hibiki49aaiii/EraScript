# EraScript v0.4 — Authorization & Private Execution

v0.4 connects transaction-correctness types to viem RPC evidence, adds default-deny signing capabilities, exact token quantities, typed permit authorization, explicit Merkle schemes, and target-bound Flashbots bundles.

## RPC evidence adapter

`src/web3/rpc.ts` accepts normal chain-bound viem clients and normalizes RPC results into EraScript evidence types.

Implemented flows:

- `readNonceFromRpc()` — `latest`, `pending`, `safe`, or `finalized` nonce provenance
- `estimateGasFromRpc()` — gas estimation with an explicit sender
- `estimateFeeModelFromRpc()` — EIP-1559 or legacy fee evidence
- `prepareDraftWithRpc()` — `DraftTx` -> `PreparedTx`
- `simulatePreparedWithRpc()` — simulation anchored to a concrete block number/hash
- `broadcastSignedWithRpc()` — raw broadcast only from `SignedTx`
- `waitForInclusionFromRpc()` — inclusion and replacement evidence
- `confirmIncludedFromRpc()` — confirmation threshold plus canonical-block check
- `finalizeConfirmedFromRpc()` — finalized block must cover the receipt block

### Reorg handling

Before promotion to `ConfirmedTx` or `FinalizedTx`, EraScript re-fetches the receipt block by number and verifies its hash still matches the original receipt.

```text
ES3707 ReorgDetected
```

A receipt from a non-canonical block cannot be treated as durable evidence.

## Simulation evidence

Simulation is block-anchored and records whether hypothetical state overrides were used.

```ts
simulation: {
  status: "success",
  blockNumber,
  blockHash,
  stateOverrides: false,
}
```

Signer policies reject state-override simulations by default.

## Secret references and signer capabilities

EraScript source can reference a secret without containing its value:

```ts
const victimKey = privateKeyEnv("VICTIM_PRIVATE_KEY", Ethereum, victimAddress)
```

`PrivateKeyRef` contains only metadata. The key is resolved internally only during a permitted signing operation.

A default-deny `SignerCapability` can restrict:

- chain
- destination addresses
- 4-byte selectors
- contract creation
- plain native transfers
- maximum native value
- state-override simulation
- EIP-712 primary types
- EIP-712 verifying contracts

`signSimulatedWithCapability()` accepts only a successful `SimulatedTx`, validates policy, derives and verifies the signer address, then signs locally. The raw private key is never returned.

Static checks reject common bypasses:

```text
ES3820 DirectPrivateSecretAccess
ES3821 HardcodedPrivateKey
```

## Exact token quantities

`TokenDefinition` binds symbol, chain, address and decimals. `TokenAmount<Token>` carries that identity with an exact raw bigint.

```ts
const usdc = defineToken({
  symbol: "USDC",
  chain: Ethereum,
  address: usdcAddress,
  decimals: 6,
})

const amount = tokenAmount(usdc, "100.500001")
```

Operations reject chain/address/decimals mismatches instead of treating all token values as generic `bigint`.

## ERC-2612 and Permit2

EraScript can construct chain-bound EIP-712 envelopes for:

- ERC-2612 `Permit`
- Permit2 `PermitSingle` / AllowanceTransfer
- Permit2 `PermitTransferFrom` / SignatureTransfer

Permit2 widths are enforced (`uint160` amount, `uint48` expiration/nonce for AllowanceTransfer). Maximum `uint160` allowance is rejected by default and requires an explicit `allowUnlimited` decision.

For standard Permit2 SignatureTransfer, EraScript requires:

```ts
recipientBinding: "spender-controlled"
```

This is intentional: the standard signed message binds the token permission, spender, nonce and deadline, but the eventual transfer recipient is supplied separately by the spender. EraScript does not pretend recipient is cryptographically bound when it is not.

## Explicit Merkle schemes

`AbiMerkleScheme` records the leaf ABI schema and hashing policy. The current safe profile uses:

- ABI encoding
- `keccak256`
- sorted/commutative node pairs
- double-hashed leaves by default

A non-double-hashed 64-byte encoded leaf preimage is rejected by default because it can be ambiguous with a concatenated pair of internal nodes.

Proofs are verified against the declared scheme, not merely accepted as `bytes32[]`.

## Flashbots bundle evidence

`FlashbotsBundle` is chain- and block-bound.

EraScript checks:

- future target block
- maximum 100 transactions
- maximum 300,000 encoded bytes
- chain consistency
- same-sender nonce continuity in bundle order
- simulation failure/revert
- simulation target/state block binding
- stale simulation when the chain head changes

`retargetFlashbotsBundle()` deliberately returns a new `bundle-draft`. A bundle cannot reuse simulation evidence after changing its target block.

The direct relay adapter signs `keccak256(JSON body)` as an EIP-191 text message for `X-Flashbots-Signature`. Relay authentication identity is documented and modeled separately from funded transaction signers.

The default bundle policy does not expose `revertingTxHashes`; all transactions are expected to simulate successfully.

## Block-anchored state snapshots

`captureBalanceSnapshotFromRpc()` fixes one concrete block number/hash and reads all requested native and ERC-20 balances at that same block. This provides deterministic evidence for workflow invariants.

## Security boundary

`SecretRef` and `SignerCapability` reduce accidental exposure and constrain AI-generated signing requests, but unrestricted JavaScript in the same operating-system process is not cryptographic isolation.

For high-value execution, the AI/code-generation process SHOULD be separated from the secret-bearing signer process or connected through a restricted signing service / hardware-backed signer.

## Execution model after v0.4

```text
AI intent
  -> EraScript static checks
  -> DraftTx
  -> RPC preparation
  -> block-anchored simulation
  -> SignerCapability policy check
  -> internal secret resolution
  -> SignedTx
  -> optional target-bound Flashbots bundle simulation
  -> broadcast / private submission
  -> receipt / replacement evidence
  -> canonicality / confirmations / finality
  -> block-anchored state verification
```

A transaction hash is not success. A successful simulation is not final recovery proof.

## Next: v0.5 rescue verification

- transaction DAGs and dependency checks
- mandatory asset rescue steps
- mandatory native sweep by default
- final-state invariants
- pre-broadcast rescue-plan verification
- post-execution verified recovery report
- Safe / ERC-4337 / EIP-7702 lifecycle models
