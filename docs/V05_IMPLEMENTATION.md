# EraScript v0.5 — Rescue Verification, Isolated Signing & EIP-7702

v0.5 extends EraScript from transaction correctness into workflow-level Web3 execution verification.

The core rule is:

> **A transaction hash is not success, and an observed recovery is not finality.**

## Rescue transaction graphs

Rescue transactions are represented as a dependency graph rather than an unstructured list.

```text
fund
  -> claim
  -> token-rescue
  -> native-sweep
```

Graph construction checks transaction ordering, dependency cycles, same-signer nonce continuity, required asset-rescue steps, and required native-sweep steps.

This is designed to catch omissions such as a missing final native-balance recovery transaction before execution.

## Block-anchored state evidence

Native and ERC-20 balances can be read from one concrete block number/hash and stored in a `BalanceSnapshot`.

Final-state invariants can assert, for example:

```text
victim.TOKEN == 0
victim.ETH <= configured dust
safe.TOKEN delta >= expected recovery
```

EraScript does not combine balances read from unrelated chain states into one recovery proof.

## Verification states

v0.5 uses four explicit states:

```text
NOT_READY
READY_FOR_BROADCAST
RECOVERY_OBSERVED
VERIFIED_RECOVERY
```

`READY_FOR_BROADCAST` means the configured pre-broadcast checks pass. It does not mean recovery happened.

`RECOVERY_OBSERVED` means post-execution state satisfies the recovery invariants but has not reached finalized chain state.

`VERIFIED_RECOVERY` is reserved for recovery state supported by finalized evidence.

## Verification report integrity

A rescue verification report contains a deterministic `reportHash` calculated from chain ID, verification state, and its ordered checks.

`parseVerificationReport()` recomputes this hash instead of trusting the supplied value. Changed report contents raise:

```text
ES4051 VerificationReportHashMismatch
```

## `era verify`

v0.5 adds:

```bash
era verify report.json
```

The default requirement is `READY_FOR_BROADCAST` or stronger.

A stricter consumer can require final recovery:

```bash
era verify report.json --require VERIFIED_RECOVERY --json
```

Hash/schema verification without an execution-readiness gate must be explicitly selected:

```bash
era verify report.json --integrity-only
```

## External signer boundary

The AI/code-generation process does not need direct private-key access.

`ExternalSigner` receives a normalized request containing:

- chain
- signer address
- transaction type
- destination/value/calldata
- nonce/gas/fee model
- block-anchored simulation evidence
- EIP-7702 authorization list when present

The signer can live in a separate process, service, HSM integration, or hardware-backed environment. EraScript still applies `SignerPolicy` before invoking it.

## EIP-7702 authorization lifecycle

EraScript models authorization separately from the outer transaction:

```text
Authorization request
  -> signer policy
  -> signature
  -> cryptographic authority verification
  -> signed authorization
  -> authorizationList
  -> EIP-7702 transaction preparation
  -> RPC estimation/simulation
  -> outer signer policy
  -> transaction signing
```

### Chain binding

By default an authorization is bound to the EraScript chain ID.

`chainId = 0` is replayable across compatible chains and is rejected unless both request construction and signer policy explicitly allow it.

### Delegation clearing

The zero delegate address represents delegation clearing. It is rejected by default and requires explicit policy allowance.

### Delegate allowlists

Both the authority signer and the outer transaction signer can restrict allowed delegate addresses.

### Self vs relayer execution

EraScript makes execution mode explicit:

```ts
executor: "self" | "relayer"
```

For self execution the outer transaction consumes the authority account's transaction nonce before the authorization tuple is processed. EraScript therefore enforces:

```text
authorization nonce = outer transaction nonce + 1
```

For relayed execution the authorization is prepared from the authority's pending nonce without that increment.

### Cryptographic response verification

A signer response is not trusted only because it contains valid-looking `r`, `s`, and `yParity` fields.

EraScript verifies the signed authorization against the declared authority before accepting it.

### Type-4 transaction integration

When `TxIntent` contains `authorizationList`, transaction preparation requires:

- a non-empty authorization list
- explicit outer sender
- non-null destination
- EIP-1559 fee fields
- chain-compatible tuples
- no duplicate authority tuples
- correct self/relayer relationship
- correct self-execution nonce relationship

The authorization list is preserved through:

```text
estimateGas
simulation
local signing
external signing
```

Local signing explicitly uses the EIP-7702 transaction type.

## Flashbots and rescue verification

When atomic private execution is required, the verification report can require a simulated Flashbots bundle that exactly matches the rescue graph transaction order.

Changing the target/state pair invalidates the old simulation evidence and forces a new simulation before `READY_FOR_BROADCAST` can be reached.

## Current security boundary

`SecretRef` reduces accidental key exposure but cannot isolate a key from malicious code in the same unrestricted process.

For high-value execution, use `ExternalSigner` and keep key custody in a separate restricted signer process or hardware-backed system.

## Remaining v0.5 targets

- Safe proposal/signature/threshold/execution lifecycle
- ERC-4337 UserOperation/bundler/paymaster lifecycle
- fork/state-diff simulation adapters
- unsafe-boundary audit trail
- hardened external signer protocol profiles
