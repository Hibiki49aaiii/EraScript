# Release qualification

Candidate: **0.19.0-rc.1**, tracked by [Issue #31](https://github.com/Hibiki49aaiii/EraScript/issues/31). This version is not published or approved for production custody/recovery. `release-status.json` is the machine-readable blocker list. Green deterministic CI does not establish actual network truth, device/hardware behavior or successful asset recovery.

## Scope and evidence

| Capability | Candidate contract | Remaining condition |
|---|---|---|
| Source check / trusted local build and execution | Strict TS, bounded diagnostic alias resolution, file preservation; Windows/Linux Node22/24 matrix | Arbitrary Node code has host authority; no malicious-code sandbox |
| Offline ABI inspection | Installed-package example verifies selector/recipient/amount with no network/key | Does not prove on-chain effects |
| Report verification | Integrity, state requirement and optional Ed25519 issuer authentication remain separate | Issuer trust, revocation and truth of original evidence are operator responsibilities |
| External signing | Existing helpers plus opt-in dual-backend authority for exact EVM native/ERC20 grants, HTTPS identity and persistent nonce consumption | Device/vendor driver, actual host isolation, trusted observer and operational qualification under #27 |
| EVM quorum | Canonical receipt block, finalized head consistency, second canonical lookup and freshness at promotion | Observer independence/authentication and chain-specific settlement under #26 |
| Asset rescue | Failed prerequisites cannot become observed success; direct finality cannot mint VERIFIED_RECOVERY | Raw bytes, exact credit, authenticated finalized post-state positive path under #25 |

## Reproduce and prepare without publication

```sh
npm ci --ignore-scripts
npm run check
npm run test:core
node --test scripts/test/*.test.mjs
npm run test:package
```

Core CI additionally repeats core tests with `FORCE_COLOR=1` and runs on Windows/Linux × Node22/24. Dependency CI gates production high/critical advisories and retains validated root-dev/Waku JSON separately. The local candidate preparation is stricter and requires zero production advisories. Network errors or malformed audit responses fail evidence collection instead of looking like zero advisories.

Commit reviewed changes, then run `npm run release:prepare`. It reruns check/core/package, creates a tarball twice and compares SHA256, and records exact commit/version/Node, production audit, CycloneDX SBOM, packed file list, blockers and `SHA256SUMS` in an ignored `release-artifacts/<version>-<sha>-<time>/` directory. Pack reproducibility means repeated packaging of the same build on that host; it does not claim cross-host compiler reproducibility. A missing/failed artifact is not a release success.

The lifecycle publish guard rejects missing approval, dirty checkouts and code changed after the approved commit. Future approval is a metadata-only commit updating `release-status.json` after all blockers are closed; its `approvedCommit` identifies the reviewed parent code commit, avoiding a self-referential hash. This is an accident-prevention gate, not an access-control substitute: a privileged publisher can bypass npm lifecycle scripts. Actual publication requires explicit release-owner authorization and registry controls.

## Required before real-fund release

1. Complete #25: real serialized transaction sender/chain/nonce/fees/calldata, exact recovery objective and safe-wallet credit, independently sourced finalized before/after state; positive and adversarial tests for supported token semantics.
2. Complete #26: provenance and independently configured observers for each advertised terminal path, stale/reorg/rollback contradictions, L1 settlement where relevant. No caller-constructed status or hash may substitute for these predicates.
3. Complete #27: both external service and hardware custody were selected on 2026-10-26. The opt-in [signing authority](SIGNING_AUTHORITY.md) implements bounded EVM transfer policy, persistent grant/nonce consumption and dual routing. Actual separate-host/device deployment, SDK/firmware qualification, least-privilege credentials, trusted simulation, store crash recovery, audit/revocation operations and independent review remain. A CLI flag or in-process object is insufficient.
4. Disposition remaining development/live SDK advisories with pinned upstream fixes or reviewed isolated replacements; do not force-install breaking downgrades to make audit counts look better. Root dev debt is excluded from the package but remains relevant to development/live runners.
5. Independent security review and operator acceptance of the actual deployment, exact-candidate read-only integration results, protected branch/release permissions and release-owner signoff. No customer keys or fund movement are implied by preparation.

## Migration from 0.18.0

- Direct finality/recovery observations may now remain `EXECUTION_OBSERVED` / `RECOVERY_OBSERVED` or become `NOT_READY`. Update callers to handle these states; do not weaken predicates to restore old labels.
- Each signing attempt needs a fresh request ID and challenge. Ambiguous failures consume the request locally. Reconcile with the authority before a retry; never reuse the old request.
- EIP-712 domains must bind the policy chain and verifying contract. Signatures from another key, malformed signatures and unapproved access lists are rejected.
- Finalized EVM quorum promotion/report generation rejects evidence older than120 seconds or from the future. Collect fresh observations. Honest-clock and provider assumptions remain explicit.
- Use a project outDir inside the project, outside source files, `.git` and `node_modules`. Linked paths and colliding outputs fail before writes. `init` preserves existing files.
- CLI rejects unknown/duplicate flags. Use `--` for arguments forwarded by `run`.
- Node22/24 are the supported qualification targets. Production build emits only source modules; stale generated modules are removed before compilation.

## Rollback and operations

Keep the exact previous reviewed tarball/lockfile and candidate evidence. Roll back an application by reinstalling that approved artifact in a clean environment, then rerun its supported checks. Do not automatically revert fail-closed security behavior or restore old terminal-state assumptions. A Git revert preserves history for code-level rollback. No DB migrations or production state changes are included. External signer incidents require the authority's separate revocation/incident process; this repository cannot reverse a broadcast transaction.
