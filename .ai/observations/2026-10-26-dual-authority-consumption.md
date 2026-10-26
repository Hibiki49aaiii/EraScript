---
type: observation
status: candidate
date: 2026-10-26
issue: 27
keywords: [authority, hardware, service, nonce, replay, revocation, timeout]
---

# Dual custody needs shared nonce consumption and explicit route binding

User decision: external-service and hardware-wallet custody are both adopted, explicitly per wallet. This supersedes the pending exclusive choice from the earlier candidate work.

Evidence: `test/signing-authority.test.ts` covers grant and chain/signer/nonce consumption across reconstructed authorities, different backend/grant IDs and separate Node processes. `test/signing-https.test.ts` covers direct hostile HTTPS requests, exact response bytes, trust pins and no redirect/fallback. Current commands/CI belong to Issue #27.

An expected backend must be checked before calling the selected provider/device, not only after receiving a signature. Claim both the exact grant and signer nonce before any signing callback. Failed/partial reservations remain consumed; ambiguous timeouts must keep the underlying backend busy until it actually settles. Fresh request IDs alone must not enable a second signature.

Limits: these are local synthetic protocol/crypto tests, not device authenticity or OS isolation evidence. File sync and ordinary restart tests do not prove Windows directory metadata/power-loss durability; no NFS/distributed claim. Grant expiry cannot revoke an already signed EVM transaction. Independent review and actual host/device integration remain release gates.

Windows portability observation: `realpath` string inequality does not prove a symlink. Windows 8.3 names can resolve to a different long-name string while `lstat` reports an ordinary directory. Initial CI 40285749694 exposed this and a local short-name probe reproduced it. Inspect each path component for symbolic links/junctions, then pin its canonical path; tests cover accepted short names and denied linked parents.
