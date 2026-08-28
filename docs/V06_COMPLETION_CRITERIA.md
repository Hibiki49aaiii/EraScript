# EraScript v0.6 Completion Criteria

Status: release-candidate gates

v0.6 is complete only when every mandatory gate below is satisfied. Package installation, compilation, a transaction hash, bundle ID, proof ID, signature, checkpoint reference, or L2 inclusion alone is never a completion signal.

## 1. Deterministic core gate

Mandatory:

- [x] Node.js 22 is the CI baseline.
- [x] TypeScript strict build is enabled.
- [x] unit/regression tests are isolated from live-network availability.
- [x] current package-level integrations are type/runtime checked for `@solana/kit`, `@mysten/sui`, and `@railgun-community/wallet`.
- [x] RAILGUN proof-bound before/after private-state transition is covered.
- [x] OP Stack and Arbitrum settlement provider fixtures are deterministic core tests.
- [ ] latest main commit has a green Core CI run after all v0.6 completion changes.

Core CI is authoritative for deterministic correctness. A public RPC outage must not turn this gate red.

## 2. Live-network gate

The live workflow is separate from Core CI and is read-only. It may be started manually, on a schedule, or when the live harness itself changes.

Mandatory smoke targets:

- [ ] Solana mainnet: genesis binding + confirmed recent-blockhash evidence.
- [ ] Sui mainnet: current Core API client + chain-identifier binding + reference gas price.
- [ ] Jito mainnet: Block Engine `getTipAccounts` parsed through the EraScript adapter.
- [ ] RAILGUN/Waku: live peer/topic connectivity + Broadcaster discovery parsed through the EraScript adapter.

No live smoke test may submit a Solana transaction, Jito bundle, Sui transaction, RAILGUN proof/transaction, or EVM transaction.

RAILGUN/Waku's live smoke may run without a trusted fee signer only in read-only discovery mode. Production Broadcaster execution must configure the deployment's trusted fee signer policy before any transaction is built or submitted.

## 3. Chain-family cryptographic gate

Mandatory:

- [x] EVM external signer recovers and compares the exact signed transaction.
- [x] Solana external signer has built-in Ed25519 verification over exact message bytes.
- [x] Sui serialized signatures are verified through current `@mysten/sui/verify` semantics.
- [x] signer envelopes bind chain/profile/network/role/payload/context/request/challenge/TTL.

## 4. Finality and post-state gate

Mandatory:

- [x] Solana signature existence is not treated as finality.
- [x] Jito bundle ID or `Landed` alone is not treated as finality.
- [x] Sui resolved execution RPC is not treated as success without successful effects/result discrimination.
- [x] RAILGUN base-EVM inclusion is not treated as private-state success.
- [x] RAILGUN `VERIFIED_FINALITY` requires base-EVM finality plus proof-bound private-state assertions.
- [x] OP Stack/Arbitrum L2 inclusion is separated from L1 settlement.
- [x] rollup `VERIFIED_FINALITY` requires protocol-specific L1-finalized evidence.

## 5. Production rollup profiles

Mandatory:

- [x] OP Mainnet profile (chain ID 10).
- [x] Base Mainnet profile (chain ID 8453).
- [x] Arbitrum One profile (chain ID 42161).
- [x] optional capabilities remain `unknown` unless configured or proven.
- [x] OP Stack provider fixtures cover snake_case and camelCase response forms.
- [x] Arbitrum confirmed-assertion fixture binds canonical child block and L1 anchor.

## 6. AI-first safety gate

Mandatory:

- [x] stable machine-readable diagnostics exist.
- [x] malformed bytes32/proof values fail rather than being silently repaired.
- [x] signing requests bind semantic context and exact payload.
- [x] secret material is not required in generated source.
- [x] unsafe behavior requires an explicit boundary/audit trail.
- [x] verification reports are integrity-bound and monotonic.
- [x] generated workflows can state required final-state invariants rather than only transaction steps.

## 7. Compatibility gate

Mandatory:

- [x] ordinary TypeScript/Node/npm compatibility remains the baseline.
- [x] EVM runtime uses viem-compatible adapters instead of a custom transport stack.
- [x] Solana adapter accepts current ecosystem codec/RPC shapes.
- [x] Sui adapter targets current Core API semantics.
- [x] RAILGUN adapter targets public Wallet SDK/Waku surfaces without putting those SDKs into EraScript core runtime dependencies.
- [x] live-only Waku/libp2p dependencies are installed only by the RAILGUN live job.

## 8. Documentation gate

Mandatory:

- [x] README describes the multi-chain execution model.
- [x] `V06_IMPLEMENTATION.md` records implemented evidence gates.
- [x] deterministic and live CI responsibilities are documented.
- [ ] README and `V06_IMPLEMENTATION.md` contain the final green Core CI and Live Network Integration run identifiers.

## Release rule

v0.6 may be marked **implementation complete** when:

1. the latest Core CI is green,
2. all four mandatory read-only live smoke targets are green in one Live Network Integration run,
3. the final run identifiers are recorded in README and `V06_IMPLEMENTATION.md`,
4. no mandatory checkbox in this document remains open.

This does **not** mean every provider, every EVM chain, every wallet backend, or every network condition is certified. It means the v0.6 architecture and its supported integration paths have passed their declared deterministic and live evidence gates.
