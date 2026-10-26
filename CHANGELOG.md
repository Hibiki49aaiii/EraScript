# Changelog

## 0.19.0-rc.1 — unreleased candidate

- Add opt-in `./signing` authority with external-service and hardware-wallet bridge routes, exact EVM transfer grants, pinned HTTPS, persistent grant/nonce consumption and trusted-host revocation. No automatic fallback or production/device qualification is implied; see #27.

- Incorporate trust-model and fail-closed work from #22/#25/#26. Direct finality claims cannot manufacture terminal recovery/finality reports; failed pre-broadcast reports block observed recovery.
- Validate external EIP-712 signatures cryptographically, bind domains, freeze private approval snapshots and reject unexpected transaction access lists.
- Check multichain signing lifetime across async waits, bound hung callbacks and reserve request/challenge before invocation. The replay guard is process-local.
- Tighten EVM receipt/finalized-head consistency, canonicality recheck and freshness at promotion/report generation.
- Preserve existing CLI initialization files, constrain project output paths, bound CLI inputs and return structured argument errors.
- Detect file-local secret aliases/import aliases/constant indirection with bounded work and lexical-shadow handling.
- Qualify installed packages on Windows/Linux and Node22/24; clean production build, pinned least-privilege CI, valid dependency audit evidence, offline white-hat example and local candidate artifacts.
- Compatible dependency maintenance; unresolved live/development SDK advisories remain documented.

See [migration, supported scope and release blockers](docs/RELEASE.md). This is not approval for real-key custody or verified asset recovery.
