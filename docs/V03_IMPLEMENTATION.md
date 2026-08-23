# EraScript v0.3 Transaction Correctness Foundation

This implementation turns the Web3 specification's transaction lifecycle into concrete Node.js/TypeScript-compatible APIs.

Implemented in v0.3:

- exact branded value units: `Wei`, `Gwei`, `Ether`, `Gas`, `WeiPerGas`, EIP-1559 fee types
- nonce provenance: `latest`, `pending`, `safe`, `finalized`, `explicit`
- chain-bound transaction lifecycle types from `DraftTx` through `FinalizedTx`
- explicit `SimulationFailedTx`, `PendingTx`, and `ReplacedTx`
- runtime chain/fee/receipt checks with EraScript diagnostic codes
- EIP-712 domain chain binding, digest generation, and signature envelope typing
- strict ABI event decoding and event-argument invariants
- transaction/block hash constructors instead of raw `string` values

A broadcast transaction is deliberately not represented as success. Only a successful included receipt can be promoted to `ConfirmedTx`, and only confirmed transactions can become `FinalizedTx`.

State-override simulation evidence remains attached to the transaction so future policy layers can refuse to treat hypothetical-state simulation as execution-ready evidence.

Next implementation target: RPC adapters that populate these evidence objects from viem clients, signer capabilities/secrets, Permit/Permit2, and workflow-level final-state invariants.
