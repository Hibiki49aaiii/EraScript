# EraScript Web3 Specification

Status: **Draft v0.3**  
Target runtime: **Node.js**  
Primary interop target: **TypeScript / npm / viem**  
Design target: **AI-generated Web3 automation that can be deterministically checked before execution**

Normative words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used intentionally.

## 1. Purpose

EraScript is not a replacement for Node.js. EraScript compiles to JavaScript and MUST preserve practical interoperability with existing Node.js/TypeScript Web3 libraries.

The language adds a verification layer above ordinary TypeScript for values and workflows where a syntactically correct program can still move assets incorrectly.

The principal rule is:

> **AI may propose execution. EraScript must make the execution assumptions explicit and machine-checkable.**

A transaction hash is not success. A successful simulation is not necessarily executable. A valid ABI encoding is not necessarily the intended call. A valid signature is not necessarily authorized for the intended chain, contract, nonce, amount, or deadline.

---

## 2. Compatibility contract

EraScript MUST support ordinary Node.js module usage and npm packages unless a construct is explicitly rejected by an EraScript security policy.

Examples that remain valid:

```ts
import { createPublicClient, createWalletClient, http } from "viem"
import { mainnet } from "viem/chains"
import fs from "node:fs"
```

The preferred implementation strategy is:

```text
.era source
  -> EraScript transform / AST
  -> EraScript semantic + Web3 analysis
  -> TypeScript semantic analysis
  -> JavaScript
  -> Node.js
```

EraScript SHOULD use audited/mature libraries such as `viem` for EVM ABI and RPC primitives rather than reimplementing them without a security reason.

---

## 3. Mandatory execution lifecycle

EraScript MUST model a state-changing operation as a lifecycle instead of a single `send()` call.

```text
Draft
  -> Checked
  -> Prepared
  -> Simulated
  -> Signed
  -> Broadcast
  -> Pending
  -> Included
  -> Confirmed
  -> Finalized
```

Alternative terminal/intermediate states MUST include:

```text
Reverted
Replaced
Cancelled
Dropped
Expired
InvalidatedByNonce
SimulationFailed
PolicyRejected
```

A compiler/runtime API MUST NOT represent `Broadcast` or the presence of a transaction hash as `Success`.

Recommended nominal types:

```ts
type DraftTx<C>
type PreparedTx<C>
type SimulatedTx<C>
type SignedTx<C>
type PendingTx<C>
type IncludedTx<C>
type ConfirmedTx<C, N extends number>
type FinalizedTx<C>
```

APIs that require a stronger execution state MUST reject weaker states at compile time where possible.

---

## 4. Chain binding

Every asset-moving primitive SHOULD be chain-bound.

```ts
Address<Ethereum>
TransactionHash<Ethereum>
BlockHash<Ethereum>
Rpc<Ethereum>
PreparedTx<Ethereum>
SignedTx<Ethereum>
```

A transaction MUST NOT silently cross a chain boundary.

A wallet/client configured for one chain and a transaction declared for another chain MUST produce a deterministic diagnostic before signing or broadcasting.

Recommended diagnostic:

```text
ES3104 ChainMismatch
```

Chain checks MAY be bypassed only inside an explicit `unsafe` boundary with a machine-readable reason.

---

## 5. Address, bytes, hashes, selectors, and calldata

EraScript MUST distinguish semantically different EVM byte strings even when their runtime representation is identical.

Minimum nominal types:

```ts
Address<C>
Bytes4
Bytes32
FunctionSelector
EventTopic
Hash<Algorithm>
TransactionHash<C>
BlockHash<C>
MerkleRoot<Scheme>
MerkleLeaf<Scheme>
MerkleNode<Scheme>
Calldata<Function>
SignedTransaction<C>
```

### 5.1 Fixed-size bytes

`Bytes32` MUST contain exactly 32 bytes.

A 63-hex-digit input SHOULD emit a specific likely-leading-zero diagnostic and MUST NOT be silently padded.

```text
ES3201 InvalidBytes32
Suggestion: A leading zero may be missing. Verify the source value before padding.
```

Explicit recovery MAY use:

```ts
leftPadBytes32(value)
```

but the operation MUST remain visible in the source and verification report.

### 5.2 Function selectors

A function selector MUST be represented as exactly 4 bytes and SHOULD be derivable from an ABI function signature.

```ts
FunctionSelector<"transfer(address,uint256)">
```

Manual selector literals SHOULD be checked against the known ABI when an ABI is available.

### 5.3 Calldata

`Calldata<F>` SHOULD retain the ABI/function identity that produced it.

Full calldata decoding MUST remove exactly the 4-byte selector before decoding raw ABI argument bytes.

EraScript MUST provide first-class helpers equivalent to:

```ts
encodeCall(abi, functionName, args)
decodeCall(abi, calldata)
selectorOf(calldata)
stripSelector(calldata)
decodeArgumentsFromCalldata(parameters, calldata)
```

---

## 6. ABI-first contract types

Contract calls SHOULD be derived from `as const` ABIs or equivalent static ABI sources.

Given an ABI, EraScript SHOULD infer:

- available function names,
- argument tuple shape,
- return type,
- mutability,
- custom errors,
- event names and arguments.

An AI SHOULD NOT need to manually reconstruct ABI offsets for standard ABI data.

Recommended types:

```ts
Contract<C, Abi>
ContractFunction<Abi, Name>
ContractCall<C, Abi, Name>
DecodedCall<Abi, Name>
ContractError<Abi>
```

Unknown or raw calldata MUST be visibly marked as less trusted than ABI-derived calldata.

---

## 7. Simulation is mandatory for writes by default

A state-changing ABI call SHOULD require successful simulation before a default policy permits signing/broadcast.

```text
DraftCall
  -> simulate
  -> SimulatedCall
  -> sign/send
```

This follows the practical pattern of pairing `simulateContract` with `writeContract`.

Simulation output SHOULD capture:

```ts
interface SimulationReceipt<C> {
  chain: C
  blockRef: BlockRef<C>
  status: "success" | "failure"
  gasUsed?: Gas
  returnData?: unknown
  revert?: DecodedRevert
  logs?: readonly SimulatedLog[]
  assumptions: readonly SimulationAssumption[]
  trust: SimulationTrust
}
```

### 7.1 State override tainting

A simulation using state overrides MUST NOT be treated as equivalent to a simulation against real chain state.

```ts
type SimulationTrust =
  | "real-state"
  | "state-overridden"
  | "fork-mutated"
```

If an approval, balance, storage value, code, nonce, or other prerequisite is injected through an override, the result MUST be marked **hypothetical**.

A hypothetical simulation MUST NOT satisfy a `READY` gate unless the transaction graph contains the real prerequisite operation or policy explicitly accepts the assumption.

---

## 8. Transaction preparation

Before signing, EraScript SHOULD normalize a transaction into a prepared transaction envelope.

Preparation SHOULD resolve or validate:

- chain,
- sender,
- destination,
- calldata,
- native value,
- nonce,
- gas limit,
- transaction type,
- legacy gas price or EIP-1559 fee fields,
- access list where applicable,
- EIP-7702 authorization list where applicable.

Recommended structure:

```ts
interface PreparedTransaction<C> {
  chain: C
  from: Address<C>
  to?: Address<C>
  nonce: Nonce<C>
  gas: Gas
  fees: LegacyFees | Eip1559Fees
  value: Wei<C>
  data: Calldata | "0x"
  preparedAt: BlockRef<C>
}
```

Raw signing of an unprepared transaction SHOULD require an `unsafe` capability.

---

## 9. Nonce semantics

Nonce handling is sufficiently error-prone to require first-class types.

```ts
Nonce<C>
PendingNonce<C>
ConfirmedNonce<C>
```

Nonce reads SHOULD declare which state is used:

```ts
nonce(address, at: "latest")
nonce(address, at: "pending")
nonce(address, at: "safe")
nonce(address, at: "finalized")
```

EraScript transaction graphs MUST verify nonce continuity for multiple transactions from the same signer.

For a sequence:

```text
Tx A: signer X nonce n
Tx B: signer X nonce n+1
Tx C: signer X nonce n+2
```

missing, duplicate, or out-of-order nonces SHOULD be rejected before signing.

Mixing pre-signed and newly generated transactions MUST decode sender and nonce from each pre-signed transaction before validating the graph.

---

## 10. Gas and fee types

`bigint` alone is insufficient for monetary semantics.

Required direction:

```ts
Wei<C>
Ether<C>
Gas
WeiPerGas<C>
LegacyGasPrice<C>
MaxFeePerGas<C>
MaxPriorityFeePerGas<C>
```

`Gas` MUST NOT be assignable to `Wei`.

`WeiPerGas` MUST NOT be assignable to a token amount.

Legacy and EIP-1559 fee models SHOULD be distinct tagged unions and incompatible fields SHOULD be rejected.

Fee estimates SHOULD record the block/context at which they were produced so stale estimates can be detected by policy.

---

## 11. Token quantities and decimals

EraScript SHOULD represent ERC-20 amounts as token-aware fixed-point quantities.

```ts
TokenAmount<Token, Chain, Decimals>
```

The compiler/runtime SHOULD know or require:

- token address,
- chain,
- decimals,
- symbol only as display metadata.

Arithmetic between incompatible assets MUST fail.

```text
TokenAmount<USDC, Ethereum, 6>
+
TokenAmount<WETH, Ethereum, 18>
= compile error
```

Conversions MUST be explicit.

---

## 12. Receipt, replacement, confirmation, and finality

EraScript MUST distinguish a transaction hash from a receipt and distinguish inclusion from finality.

The receipt workflow SHOULD support:

- polling timeout,
- replacement detection,
- repricing/replacement,
- cancellation,
- confirmation count,
- `safe` and `finalized` block policies when supported.

Recommended result model:

```ts
type WaitResult<C> =
  | { state: "included"; receipt: Receipt<C> }
  | { state: "replaced"; oldHash: TransactionHash<C>; replacement: Receipt<C> }
  | { state: "cancelled"; replacement: Receipt<C> }
  | { state: "reverted"; receipt: Receipt<C>; error?: DecodedRevert }
  | { state: "timeout" }
```

AI-generated code MUST NOT ignore replacement status by default.

---

## 13. Event and log decoding

Transaction success SHOULD be verifiable through expected state and/or expected events.

EraScript SHOULD expose ABI-derived event types:

```ts
Event<Abi, "Transfer">
DecodedLog<Abi, "Transfer">
```

Strict log decoding MUST be the default.

Partial decoding of malformed/nonconforming logs MUST require an explicit relaxed/unsafe option and MUST be surfaced in the verification report.

Example invariant:

```text
require event ERC20.Transfer {
  from: victim
  to: safe
  value: expected
}
```

---

## 14. Multicall and batch reads

Batch reads SHOULD preserve per-call success/failure.

Silent failure MUST NOT be used for a result that influences an asset-moving decision unless the caller handles every failure branch.

Recommended model:

```ts
type BatchResult<T> =
  | { status: "success"; value: T }
  | { status: "failure"; error: RpcOrContractError }
```

A strict batch mode SHOULD exist:

```ts
multicall(calls, { allowFailure: false })
```

EraScript SHOULD account for RPC calldata/payload limits and MAY automatically chunk batch calls while preserving deterministic result ordering.

---

## 15. EIP-712 typed-data signatures

Typed-data signing MUST preserve the complete domain and primary type identity.

```ts
Eip712Domain<C, VerifyingContract>
TypedDataMessage<Domain, PrimaryType>
TypedSignature<Domain, PrimaryType, Signer>
```

The domain SHOULD include and validate, where applicable:

- `name`,
- `version`,
- `chainId`,
- `verifyingContract`,
- `salt`.

A signature generated for one chain/domain MUST NOT be reusable as a signature for another domain type.

Before a typed signature is used for asset movement, EraScript SHOULD support verification against the expected signer.

Verification SHOULD support both EOAs and smart-contract accounts when the selected backend supports ERC-1271/ERC-6492-style verification.

---

## 16. Permits, Permit2, deadlines, and replay protection

Permits MUST be first-class authorization objects rather than raw signatures.

```ts
Permit<Token, Spender, Amount, Nonce, Deadline, Domain>
Permit2Allowance<...>
Permit2SignatureTransfer<...>
```

The type/policy system SHOULD track:

- token,
- owner,
- spender,
- amount,
- nonce,
- deadline/expiration,
- chain/domain,
- one-shot vs reusable authorization.

A one-time signature transfer MUST NOT be treated as equivalent to a standing allowance.

Expired permits MUST fail before submission.

Unlimited approvals SHOULD generate a security warning or policy error.

Permit2 unordered nonce/bitmap semantics SHOULD be represented explicitly rather than collapsed into a generic sequential nonce.

---

## 17. Merkle trees and proof schemes

A Merkle proof MUST be parameterized by the scheme that created it.

```ts
MerkleScheme<
  LeafSchema,
  LeafEncoding,
  LeafHash,
  PairOrdering,
  NodeHash
>

MerkleProof<Scheme>
MerkleRoot<Scheme>
MerkleLeaf<Scheme>
```

Proof nodes MUST be `Bytes32` where the scheme requires `bytes32`.

EraScript MUST NOT assume that all Merkle trees:

- use sorted pairs,
- use the same leaf hashing,
- use single hashing rather than double hashing,
- support multiproofs.

For OpenZeppelin Standard Merkle Trees, the standard leaf/node scheme SHOULD be supported as a named built-in profile.

Multiproofs MUST validate their structural preconditions. Empty-leaf edge cases MUST NOT be accepted as proof of a business claim unless policy explicitly allows them.

A proof extraction API SHOULD preserve the ABI path that produced every proof node, e.g.:

```text
claim.proofs[0][7]
```

---

## 18. Flashbots and private bundle execution

Bundles are not ordinary transaction arrays.

Recommended types:

```ts
Bundle<C, TargetBlock>
BundleTx<C, Signer, Nonce>
BundleSimulation<C, TargetBlock>
RelayAuthSigner<C>
FundsSigner<C>
```

The language/runtime MUST distinguish the relay authentication signer from signers that control funds.

A Flashbots-style bundle MUST model:

- strict transaction ordering,
- signer per transaction,
- nonce continuity,
- target block,
- optional timestamps,
- allowed reverting transaction hashes if explicitly configured,
- replacement/cancellation identifier where supported,
- simulation result,
- inclusion status.

A target block MUST be in the future at submission time.

A bundle intended for multiple blocks SHOULD be rebuilt/re-evaluated and re-simulated for each target block because nonce, base fee, state, and competing transactions can change.

A successful simulation for block `N` MUST NOT automatically authorize submission to block `N+1`.

A bundle MAY contain pre-signed transactions, but EraScript MUST decode and inspect sender, nonce, chain, and hash before accepting them into the graph.

---

## 19. Safe smart-account transactions

A Safe transaction hash is semantically different from the Ethereum execution transaction hash.

Required conceptual types:

```ts
SafeAddress<C>
SafeNonce<C>
SafeTxHash<C>
SafeProposal<C>
SafeSignature<C, Owner>
SafeThreshold
SafeExecutableTx<C>
EthereumExecutionHash<C>
```

The Safe lifecycle SHOULD model:

```text
Created
  -> HashComputed
  -> Proposed
  -> PartiallySigned
  -> ThresholdReached
  -> Executable
  -> Executed
```

EraScript MUST NOT treat an off-chain Safe proposal or collected signature as on-chain execution.

The transaction model SHOULD distinguish `CALL` and `DELEGATECALL`, with `DELEGATECALL` requiring a stronger policy capability.

Batch Safe transactions SHOULD retain each sub-transaction's destination/value/calldata for policy inspection.

---

## 20. Account abstraction / ERC-4337

An ERC-4337 UserOperation MUST NOT be typed as an ordinary EOA transaction.

Recommended types:

```ts
UserOperation<C, EntryPoint>
Bundler<C>
Paymaster<C>
PaymasterSponsorship<C>
SmartAccount<C>
UserOperationHash<C>
```

EraScript SHOULD track separately:

- smart account,
- owner/signing authority,
- entry point,
- bundler,
- paymaster/sponsor,
- nonce model,
- gas fields,
- signature,
- sponsorship validity.

A paymaster quote or sponsorship response MUST NOT be interpreted as guaranteed inclusion.

---

## 21. EIP-7702 authorization

EIP-7702 authorization MUST be modeled explicitly because it changes account execution semantics.

Recommended types:

```ts
Authorization7702<C, Account, Delegate>
SignedAuthorization7702<C, Account, Delegate>
AuthorizationList<C>
DelegatedAccount<C, Delegate>
```

The compiler/runtime SHOULD validate:

- chain,
- account,
- delegate/contract address,
- authorization nonce,
- signer,
- whether the intended transaction actually includes the authorization.

Simulation of an authorization list SHOULD be available before broadcasting.

---

## 22. Signer capabilities and secret isolation

AI code SHOULD operate on signer capabilities, not raw private keys.

```ts
Secret<PrivateKey>
Signer<C, CapabilitySet>
FundsSigner<C>
RelayAuthSigner<C>
SafeOwnerSigner<C>
SessionSigner<C>
```

The AI-visible source SHOULD refer to secret handles:

```ts
secret("VICTIM_PRIVATE_KEY")
```

The raw secret SHOULD be resolved only at runtime by a trusted secret provider.

The type/taint system SHOULD prohibit secrets from flowing to:

- logs,
- HTTP request bodies,
- thrown error serialization,
- analytics,
- untrusted child processes,
- generated reports.

---

## 23. Transaction graph and final-state invariants

Multi-transaction Web3 workflows SHOULD be represented as a dependency graph.

Example:

```text
fund victim
  -> claim
  -> transfer recovered token
  -> sweep remaining native asset
```

A graph SHOULD support explicit dependencies:

```ts
step claim after fund
step rescueToken after claim
step sweepNative after rescueToken
```

The verification system MUST support final-state invariants such as:

```text
victim.SOSO == 0
victim.ETH <= dust
safe.SOSO >= previousSafeBalance + claimedAmount
```

If the plan omits a required cleanup step, the invariant should fail even if every individual transaction is otherwise valid.

---

## 24. Intent and destination policies

AI-generated execution SHOULD be constrained by an intent/policy layer.

Example:

```era
intent rescue {
  asset SOSO from VICTIM
  destination SAFE

  deny transfer to *
  allow transfer to SAFE

  require atomicExecution
  require simulationSuccess
}
```

Policy SHOULD be able to constrain:

- destination addresses,
- contract addresses,
- function selectors,
- value limits,
- token limits,
- approvals,
- delegatecalls,
- chains,
- signer capabilities,
- deadlines,
- maximum gas spend.

---

## 25. RPC and transport assumptions

RPC behavior is part of execution correctness.

EraScript SHOULD model:

```ts
Rpc<C, Capabilities>
```

Capabilities MAY include:

```text
filters
websocketSubscriptions
stateOverride
traceCall
batch
multicall
pendingState
safeTag
finalizedTag
```

A script relying on a capability not supported by the configured RPC SHOULD fail during verification instead of falling back silently where that changes semantics.

Fallbacks such as `watchEvent` switching from filters to `getLogs` MAY be allowed when semantics remain equivalent, but SHOULD be reported in verbose/verification output.

---

## 26. AI-facing diagnostics

Every EraScript-specific diagnostic MUST have a stable machine-readable code.

```json
{
  "code": "ES3201",
  "severity": "error",
  "kind": "InvalidBytes32",
  "path": "claim.proofs[0][7]",
  "details": {
    "expectedHexDigits": 64,
    "actualHexDigits": 63
  },
  "suggestion": "A leading zero may be missing. Verify the source value before padding."
}
```

Diagnostics SHOULD include where relevant:

- source location,
- semantic path,
- expected value/type/state,
- actual value/type/state,
- deterministic fix suggestion,
- security impact,
- whether automatic repair is safe.

The AI loop SHOULD consume JSON rather than scrape terminal prose.

---

## 27. `unsafe` boundaries

EraScript MUST provide an escape hatch for unusual protocols, but safety bypasses MUST be explicit and auditable.

```era
unsafe(reason: "non-standard claim encoding") {
  ...
}
```

A reason MUST be required.

The verification report MUST list every unsafe boundary and the guarantees disabled by it.

---

## 28. Verification levels

EraScript SHOULD define progressive verification levels.

### Level 0 — Parse
- syntax valid

### Level 1 — Static
- TypeScript types
- chain types
- bytes/address/hash shapes
- ABI shape
- policy checks
- secret-flow checks

### Level 2 — Prepared
- nonce resolved
- gas resolved
- fees resolved
- transaction type resolved
- signer capability validated

### Level 3 — Simulated
- write simulation succeeds
- revert/custom error decoded
- state override assumptions identified

### Level 4 — Workflow verified
- transaction DAG valid
- nonce continuity valid
- proof/permit/signature checks valid
- final-state invariants satisfiable in simulation

### Level 5 — Execution-ready
- simulation state fresh enough for policy
- target block/deadline valid
- RPC capabilities available
- signer secrets available without exposure
- bundle/account-abstraction/multisig prerequisites satisfied

Only Level 5 SHOULD render:

```text
READY
```

---

## 29. Immediate implementation priority

### P0 — v0.3

1. `Wei`, `Ether`, `Gas`, `WeiPerGas`, EIP-1559 fee types.
2. `Nonce<C>` with explicit `latest`/`pending` source.
3. `PreparedTx<C>` and transaction lifecycle types.
4. `SimulationReceipt` with `real-state` vs `state-overridden` trust.
5. Receipt/replacement/finality result model.
6. Strict event/log decoding wrappers.
7. EIP-712 domain/signature nominal types.
8. ABI custom-error decoding.

### P1 — v0.4

1. `TokenAmount<Token, Chain, Decimals>`.
2. Permit / Permit2 authorization types.
3. Merkle scheme profiles and verification.
4. Flashbots bundle graph, target-block binding, resimulation rule.
5. signer capability and secret-flow analysis.
6. explicit unsafe-boundary reporting.

### P2 — v0.5

1. Safe proposal/signature/threshold/execution lifecycle.
2. ERC-4337 `UserOperation`/bundler/paymaster types.
3. EIP-7702 authorization lifecycle.
4. transaction DAG verification.
5. final-state invariants.
6. `era verify` and `READY` gate.

---

## 30. Research basis

The requirements above were extracted from recurring patterns in production TypeScript/Node.js Web3 tooling and documentation, especially:

- viem `simulateContract`: simulation before writes, custom revert decoding, state overrides.  
  https://viem.sh/docs/contract/simulateContract
- viem `writeContract`: transaction writes and explicit recommendation to simulate first.  
  https://viem.sh/docs/contract/writeContract
- viem `prepareTransactionRequest`: nonce, gas, fee and transaction-type preparation.  
  https://viem.sh/docs/actions/wallet/prepareTransactionRequest
- viem `waitForTransactionReceipt`: receipt waiting and replacement detection.  
  https://viem.sh/docs/actions/public/waitForTransactionReceipt
- viem `multicall`: per-call failures and RPC calldata batch limits.  
  https://viem.sh/docs/contract/multicall
- viem `parseEventLogs`: strict vs partial event decoding.  
  https://viem.sh/docs/contract/parseEventLogs
- viem `signTypedData` / `verifyTypedData`: EIP-712 domain-aware signing and smart-account verification.  
  https://viem.sh/docs/actions/wallet/signTypedData  
  https://viem.sh/docs/actions/public/verifyTypedData
- Flashbots ethers bundle provider: strict bundle ordering, target blocks, nonce/gas dependency on a normal RPC, bundle simulation, auth signer separation, replacement/cancellation.  
  https://github.com/flashbots/ethers-provider-flashbots-bundle
- Safe Core SDK: TypeScript Safe proposal, transaction hash, signature collection, threshold execution and calldata decoding.  
  https://docs.safe.global/sdk/api-kit/guides/propose-and-confirm-transactions  
  https://docs.safe.global/core-api/transaction-service-guides/data-decoder
- OpenZeppelin cryptography/MerkleProof: proof schemes, sorted pairs, StandardMerkleTree compatibility and multiproof constraints.  
  https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography
- Uniswap Permit2: distinction between reusable AllowanceTransfer and one-time SignatureTransfer authorizations.  
  https://developers.uniswap.org/docs/protocols/permit2/overview
- Pimlico permissionless.js: TypeScript/viem model for ERC-4337 smart accounts, bundlers, paymasters and UserOperations.  
  https://docs.pimlico.io/permissionless

This source list is informative; the normative requirements are the sections above.
