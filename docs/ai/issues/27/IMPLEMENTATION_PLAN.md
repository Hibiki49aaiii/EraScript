# Dual signing authority — Issue #27

Base Commit SHA: 1739cddcff6ab18fab8bd54353a8160ee648bb93

Target branch: `issue-27-dual-signing-authority`. User approval on 2026-10-26: adopt both service and hardware custody. This supersedes the earlier exclusive choice. No production deployment, credential provisioning, device signing or funds movement.

## Requirements and current architecture

`era run` is ordinary Node. Existing `ExternalSigner` helpers validate signed bytes but cannot restrict arbitrary imports sharing keys/USB/provider credentials. Authority enforcement must live on a separately trusted host. Preserve existing APIs and all finality/recovery gates.

## Options and decision

| Option | Benefits | Costs / security limits | Decision |
| --- | --- | --- | --- |
| Shared trusted authority with explicit service/device backends | One policy/replay implementation; portable client; extensible providers | Trusted host, store, operator and driver must be protected | Adopt both backends; no fallback |
| Local process under same account | Simple setup | Child processes/files/env/USB can bypass it | Reject as isolation claim |
| OS sandbox for arbitrary Node | Potential broader confinement | Platform-specific policy, compatibility and maintenance | Separate work; do not claim implemented |

## Target architecture and data flow

Trusted operator installs exact, short-lived transfer grants and wallet policies on authority host. A grant binds caller identity, backend ID, full existing transaction request (including simulation context), chain/sender/nonce and time window. Policy independently restricts recipient, native/token amount, token contract, gas and total worst-case fee. Only native and canonical ERC-20 transfer calls using legacy/EIP-1559 are supported; deny other roles/formats.

Untrusted client -> HTTPS pinned authority identity -> bounded authenticated request `{version, grantId, requestId, requestHash, expectedBackend}` -> operator grant lookup -> exact policy -> persistent consumption -> trusted simulation callback -> selected backend -> cryptographic signed-byte verification -> bound response -> client cryptographic verification. `expectedBackend` is a consistency assertion, never a routing override. The client never submits policy, arbitrary backend configuration or simulation trust roots.

Service backend owns its provider adapter/credentials. Hardware backend owns a device bridge on the trusted host, obtains displayed address confirmation, and requires an explicit device approval result. The bridge is an integration contract, not a claim of physical device authenticity. Vendor-specific SDK/firmware qualification follows the chosen hardware model. Neither backend automatically retries, broadcasts or changes routes.

## State transitions and concurrency

Configured -> validated -> permanently reserved -> simulation checked -> signing -> verified response. Rejection, timeout, crash or ambiguous completion after reservation leaves consumption intact. Grant ID and `(chainId, sender, nonce)` are claimed using exclusive local files before any backend call; fsync file content. No automatic expiry cleanup, store reset or retry with a new backend. Partial reservations fail closed. Single local filesystem only, not NFS/distributed consensus; power-loss durability and Windows directory metadata durability require host qualification. Backend stays occupied until a timed-out underlying operation actually settles.

## Changes / API / storage

- Add `src/signing/` with authority policy, replay store, backend adapters, HTTPS boundary and public index; expose `erascript-lang/signing` separately from untrusted convenience APIs.
- Reuse the existing raw transaction verification through a small internal extraction; preserve existing behavior.
- Add focused authority and hostile-client tests, installed-package export checks, `docs/SIGNING_AUTHORITY.md` and a runnable offline sample.
- Update README/white-hat/release references and issue records. No runtime-loader change, no database migration, no SDK/dependency bump.

## Error handling and security

Strict field/size/type validation, immutable grants and function capture, explicit backend/caller binding, monotonic plus wall-clock deadlines around every await, mandatory trusted simulation verification, fixed public errors without provider causes/payloads. HTTPS validates hostname/CA and exact configured certificate identity; bearer credentials only authorize the narrow grant service, never provider access. No redirects/insecure fallback. Bound concurrency, message sizes and timeouts. Protect grant/store directories from untrusted OS accounts; do not load client modules on authority host. Disable hardware blind signing in deployment; device bridge must reject unavailable clear approval.

Signing time limits do not create on-chain transaction expiry. A signed EVM transaction can remain usable after the grant expires until its nonce is consumed. A local timeout cannot retract an already produced signature.

## Verification and order

1. Three-pass design review (below), policy/parser and immutable grants.
2. Persistent consumption and dual backend routing; positive synthetic signatures and adversarial failures.
3. HTTPS client/server and raw hostile requests; verify authentication/trust/deadlines/redaction.
4. Actual typecheck, core tests, installed package and CI on Windows/Linux Node22/24. No configured lint command. Audit production dependencies separately.
5. Post-review and exact evidence in Issue #27. Independent review and real device/host verification remain open production gates.

## Pre-implementation review

Requirements pass: adopted explicit dual routing, default-deny formats and immutable exact grants. Independent review remains unmet; author review is not substituted for it. Safe reversible implementation proceeds under the user's explicit continuation instruction.

Architecture pass: adopted existing ExternalSigner compatibility and raw-byte verification; rejected duplicate signing/crypto implementations and local same-account isolation claims. Hardware vendor selection is not inferred from generic dual support.

Risk pass: adopted nonce consumption across backends, permanent reservations after failure, exact simulation binding, busy quarantine after timeout and sanitization. Reject policy sourced from the client. Out of scope: real-host ACL/USB/network enforcement proof, device authenticity, chain finality/recovery, generalized contract/typed-data/7702 semantics.

## Rollback and remaining risk

Revert additive API/docs/export changes; no production data migration. Preserve consumed records even after rollback. Do not reset nonces/claims to retry. Compromised operator/host/provider/driver, incorrect trusted simulation, filesystem rollback or separately shared keys invalidate the trust assumptions. No production-ready claim until independent review, operational isolation and actual device testing are complete.
