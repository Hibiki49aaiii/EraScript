# Post-implementation review — dual authority continuation

Date: 2026-10-26. Reviewer: Codex (implementation author; not independent security approval).

## Correctness

The authority uses operator-installed immutable exact grants. Native/ERC20 semantics, chain/sender, fee bounds and nonce are validated before backend access. Returned raw transactions reuse the pre-existing parse/recover/field-parity verifier. Both routes passed positive synthetic tests; incorrect device address, missing device approval, substituted raw transaction, mismatched request/context/backend and caller spoofing are denied.

Review findings adopted: expected backend must be checked before signing, not just on response; duplicate signer aliases are rejected; grant revocation is persisted and rechecked after awaits; client URL/transport setup failures are sanitized and bounded. The common raw verifier was extracted without changing its existing checks.

## Regression and architecture

New APIs are isolated under `erascript-lang/signing`. Ordinary `.era` execution, existing signer helpers and finality/recovery predicates are unchanged. No SDK/dependency bump. One trusted authority can contain different service and hardware wallets; it never automatically reroutes a request. Hardware vendor driver selection is deferred pending actual hardware details, with a structural bridge contract and synthetic integration tests only.

## Security and failure handling

Exclusive claims for grant and chain/signer/nonce are synced before signer access. Separate processes race for one claim successfully; reconstructed authorities cannot reuse it. Store failure, denied simulation, cancellation, provider failure and invalid signature remain consumed. Timeout quarantines the still-running backend; no implicit cancellation guarantee. Fixed TLS identity, token authentication, strict request fields, message bounds, no redirects and redacted errors were checked using loopback TLS and arbitrary Node clients.

This does not prove OS/USB/provider isolation on a real deployment. A bridge label does not authenticate physical hardware. A simulation callback must implement a trusted observation; a boolean fixture is not a production verifier. Local file persistence is not distributed or rollback-resistant storage, and power-loss durability needs host qualification. Multiple instances must be stopped/reconfigured together for revocation.

## Maintainability and documentation

No new runtime dependency or framework. Provider/device integration is kept on the trusted side; protocol and existing transaction verification are shared. Added operator guide, bounded example, installed-package gate, plan and human summary. No debug/secret output or runtime-loader change. Release gates remain enabled.

## Actual local verification

Windows, Node24.13.1:

- `npm run check` — passed.
- `npm run test:core` — final run 274/274, zero failures/skips.
- Focused authority/HTTPS/existing signer tests — 30/30.
- `node --test scripts/test/*.test.mjs` — 2/2.
- `npm run test:package` — passed; 302 files, five entrypoint imports, both offline authority routes and replay denial executed outside checkout. The first run's informational import list still printed four entries; the actual fifth import was tested, and the printed summary was corrected.
- `npm audit --omit=dev --json` — zero production advisories. Development/live advisories are separate and not waived by this result.
- `git diff --check` — passed. No configured linter/formatter.

Exact commit, final PR CI runs and candidate evidence are recorded in the Issue #27 completion update. No real wallet, production keys, transaction broadcast, deployment or npm publication occurred.

## Remaining work

Issue #27 stays open for independent review, selected device SDK/firmware/UX, actual isolated host and credential/USB/network controls, trusted simulation integration, operational audit/revocation/crash recovery and broader signing formats. #25/#26 positive authenticated recovery/finality and #31 release-owner gates remain open. This continuation delivers a tested bounded authority foundation, not full production custody qualification.
