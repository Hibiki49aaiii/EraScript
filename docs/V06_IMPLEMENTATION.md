# EraScript v0.6 — Multi-chain Runtime Implementation

Status: experimental implementation

The architectural contract is defined in `MULTICHAIN_ARCHITECTURE.md`. This document records what is implemented in the v0.6 codebase.

## 1. Core rule

EraScript no longer treats Flashbots or Ethereum semantics as the universal Web3 execution model.

```text
Chain family        Execution backend       Optional overlay
------------        -----------------       ----------------
EVM                 public/private RPC      RAILGUN
EVM                 Flashbots
Solana              public RPC
Solana              Jito
Sui                 Sui Core API
```

Every optional capability is `supported`, `unsupported`, or `unknown`. Unknown is not treated as supported.

## 2. EVM runtime discovery

`src/chains/evm-discovery.ts`

Implemented:

- chainId binding
- EIP-1559 evidence from block shape
- EIP-4844 evidence from blob-gas block fields
- `safe` block-tag probing
- `finalized` block-tag probing
- `debug_traceCall` probing
- distinction between method-unavailable and provider/permission ambiguity
- explicit preservation of `unknown` for EIP-7702, ERC-4337, private RPC and bundle RPC when no safe universal probe exists

A provider error is not automatically interpreted as protocol non-support.

## 3. EVM external signer hardening

`src/web3/external-signer.ts`

After an external signer returns a serialized transaction, EraScript now:

1. parses the raw transaction with viem,
2. cryptographically recovers the transaction signer,
3. compares the recovered transaction against the approved signing request.

Compared fields include:

- sender
- chainId
- transaction type
- nonce
- gas
- destination
- value
- calldata
- gasPrice or EIP-1559 fee fields
- EIP-7702 authorization list, including address/chainId/nonce/yParity/r/s

A valid signature over a different transaction is rejected.

## 4. Solana adapter

`src/chains/solana.ts`
`src/chains/solana-adapter.ts`

The adapter is structural: applications can pass a current `@solana/kit` RPC client without making EraScript core depend directly on the SDK package.

Implemented evidence:

```text
recent blockhash + lastValidBlockHeight
    -> prepared serialized transaction
    -> signature-verified simulation
    -> submission
    -> signature status
    -> finalized commitment
```

Safety rules:

- addresses/blockhashes/signatures are base58-decoded to exact byte lengths
- transaction serialization is canonical base64
- blockhash freshness is checked before simulation and again before submission
- simulation uses `sigVerify: true`
- recent blockhash replacement is disabled for verification
- submission does not imply success
- `getSignatureStatuses` execution errors are retained
- final success requires `finalized` commitment

Current v0.6 transaction versions: legacy and v0.

## 5. Jito adapter

`src/chains/jito.ts`

Implemented:

```text
Jito bundle draft
    -> sendBundle
    -> bundle ID
    -> inflight evidence
    -> getBundleStatuses
    -> transaction-set verification
    -> finalized Solana commitment
```

Rules:

- 1–5 transactions
- canonical base64
- explicit positive tip evidence
- tip transaction index must be inside bundle
- optional expected transaction signatures are compared with the landed bundle
- bundle ID is not success evidence
- `Landed` alone is not finality
- a successful report requires the expected transaction set at finalized commitment

Application-level state invariants remain necessary because specialized bundle delivery cannot replace post-state verification.

## 6. Sui v2 adapter

`src/chains/sui.ts`
`src/chains/sui-adapter.ts`

The adapter targets the current `@mysten/sui` Core API style and accepts either top-level compatible methods or `client.core` methods.

Implemented:

- 32-byte Sui address/object IDs
- object refs
- MIST
- transaction/effects evidence
- optional chain-identifier verification
- serialized transaction binding
- sender / gas-owner binding
- checks-enabled simulation
- execution with one or more signatures
- `Transaction` versus `FailedTransaction` discrimination
- digest continuity
- checkpoint evidence

Critical rule:

> A resolved `executeTransaction()` Promise is not interpreted as successful execution.

EraScript inspects the returned result union and only accepts the successful transaction variant.

`checksEnabled=false` simulation is inspection-only and cannot pass the execution gate.

## 7. RAILGUN Wallet SDK adapter

`src/privacy/railgun.ts`
`src/privacy/railgun-adapter.ts`

Implemented state machine:

```text
private transfer intent
    -> gas evidence
    -> broadcaster fee evidence (Broadcaster path)
    -> Wallet SDK proof generation
    -> proved transaction population
    -> submission
```

Bindings include:

- base EVM chain
- TXID version
- wallet ID
- recipient/token/amount tuples
- gas estimate
- overall batch minimum gas price
- selected Broadcaster/fees ID
- fee token, amount, recipient and expiration
- generated proof ID
- populated transaction bytes

A proof bound to an expired Broadcaster quote is rejected.

## 8. Waku Broadcaster adapter

`src/privacy/railgun-broadcaster.ts`

Implemented structural interfaces for the current RAILGUN Waku Broadcaster flow:

- `findBestBroadcaster`
- selected `railgunAddress`
- `feesID`
- fee-token binding
- `BroadcasterTransaction.create(...)`
- `BroadcasterTransaction.send(...)`

A proof generated for one Broadcaster/fees ID cannot be silently submitted through another selection.

## 9. RAILGUN verification

`src/privacy/verification.ts`

RAILGUN is registered as an overlay in the multichain verification schema.

Verification deliberately separates:

1. RAILGUN proof/submission evidence,
2. base EVM inclusion/finality,
3. private wallet post-state evidence.

Base-chain finality alone does not prove the expected private wallet state.

`VERIFIED_FINALITY` requires both finalized base-EVM execution and proof-bound private-state assertions.

## 10. Family-aware external signer envelope

`src/chains/external-signer.ts`

This is separate from the EVM-specific signer implementation.

The common envelope binds:

- chain family
- chain profile/network
- signer role
- signer identity
- exact payload
- payload encoding
- payload SHA-256
- semantic context SHA-256
- request ID
- random challenge
- creation/expiry timestamps

The external signer response must echo the binding values. A family-specific verifier then verifies the actual signature semantics.

EraScript does **not** attempt to pretend Ed25519, Sui serialized signatures and EVM secp256k1 transactions are one signature format.

## 11. Family-neutral verification report

`src/chains/verification.ts`
`src/chains/verification-adapters.ts`

Generic states:

```text
NOT_READY
READY_FOR_SUBMISSION
EXECUTION_OBSERVED
VERIFIED_FINALITY
```

The report binds:

- chain family
- profile ID
- network
- execution backend
- optional protocol overlay ID
- subject
- checks
- evidence hashes
- state

The complete report has a deterministic SHA-256 `reportHash`.

Built-in report adapters currently exist for:

- Solana public RPC
- Jito
- Sui
- RAILGUN overlay + base EVM finality/private state

`era verify` automatically detects legacy EVM rescue reports versus v0.6 multichain reports.

## 12. CLI

Both report families are accepted:

```bash
era verify rescue-report.json --require VERIFIED_RECOVERY
era verify solana-report.json --require VERIFIED_FINALITY
era verify sui-report.json --require VERIFIED_FINALITY
era verify report.json --integrity-only
```

Defaults:

- rescue report: `READY_FOR_BROADCAST`
- multichain report: `READY_FOR_SUBMISSION`

## 13. Regression coverage added

The v0.6 work adds tests for:

- EVM runtime capability discovery
- Solana recent-blockhash expiry
- Solana simulation/submission/finality
- Jito bundle submission and finality
- Sui success/failure union handling
- Sui checkpoint evidence
- RAILGUN Wallet SDK lifecycle
- RAILGUN Broadcaster selection binding
- family-aware external signer request integrity
- family-neutral verification report hash integrity
- diagnostic code uniqueness

## 14. Remaining work

The following must not yet be advertised as fully complete:

1. Real-network integration tests against current `@solana/kit`, Jito, `@mysten/sui`, RAILGUN Wallet SDK and Waku packages.
2. Solana family-specific signature verifier/injection adapter for unsigned messages and multi-signer transactions.
3. Sui sender/gas-owner/sponsor signature-role verifier with exact transaction-byte identity checks.
4. Durable nonce workflow for Solana.
5. Address Lookup Table lifecycle evidence.
6. Sui sponsored-transaction policy engine.
7. RAILGUN private-state reader/indexer adapter that produces `RailgunPrivateStateEvidence` automatically.
8. Rollup L2 inclusion versus L1 settlement adapters.
9. Additional EVM-chain profiles and provider capability discovery.
10. Full dependency-backed CI confirmation.

## 15. Compatibility promise

EraScript v0.6 does not mean "every chain behaves the same."

It means:

> Chain-specific assumptions are isolated behind typed profiles, adapters and evidence gates. EraScript refuses to use an optional behavior that has not been configured or proven for the selected network/backend.
