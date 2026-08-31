# Issue #18 Human Understanding

## What

EraScript stops exporting the low-level multichain report constructor from its supported package API.

## Why

That constructor accepts the final state as input. It is useful inside strict EVM/Solana/Sui/Jito/RAILGUN/rollup adapters, but exposing it publicly makes it too easy to create a report that claims `VERIFIED_FINALITY` without using those adapters.

## How

The chains barrel now lists safe verification exports explicitly. Internal adapters continue to import the implementation module directly. Public consumers retain report types, evidence hashing, parsing, integrity validation, and state assertions.

## Important Decisions

- Restrict the package export surface instead of duplicating constructors across adapters.
- Treat this as an intentional pre-1.0 compatibility break and bump to 0.18.0.
- Keep external report parsing so authenticated reports from trusted systems remain usable.
- Defer a third-party terminal-state plugin contract until its evidence obligations can be specified safely.

## Invariants

- Existing strict adapters still produce the same report JSON/hashes.
- Root and `./chains` barrels do not expose arbitrary state construction.
- Safe parsing and integrity checks remain public.
- Issue #16 authentication semantics remain unchanged.

## Failure Modes

- Existing code importing the constructor from the public barrel fails and must migrate.
- Direct source-tree/internal imports remain technically possible outside normal package exports; they are unsupported.
- A custom chain adapter cannot claim terminal state through a supported generic constructor until a reviewed extension API exists.

## Change Impact

The runtime behavior of strict adapters and `era verify` does not change. Only the supported construction surface is narrowed.
