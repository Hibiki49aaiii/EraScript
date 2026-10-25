# Security policy

EraScript 0.19.0-rc.1 is a review candidate, not approved for custody of real funds. The supported candidate scope is authorized source review, trusted local execution, offline ABI inspection and verification of report integrity/issuer signatures. See [the trust model](docs/VERIFICATION_TRUST_MODEL.md) and [release blockers](docs/RELEASE.md).

## Reporting a vulnerability

Use [Security → Report a vulnerability](https://github.com/Hibiki49aaiii/EraScript/security/advisories/new), enabled for this repository on 2026-10-25. If unavailable later, open a minimal issue requesting a private reporting channel without exploit details, secrets, signed transactions, customer data or active-target identifiers. Do not publish a working exploit against an active user. Include affected version/commit, a minimal synthetic reproduction, expected/actual behavior and impact through the private channel. No response-time or bounty commitment is currently offered.

## Trust boundaries

- `era run` executes ordinary Node.js and inherits process permissions/environment. Neither typechecking, diagnostics, TypeScript brands nor Node permission flags make it a malicious-code sandbox. Use a disposable environment without credentials for untrusted sources/dependencies; do not execute them with wallet authority.
- A signer policy limits the supplied helper call. Untrusted code in the same process can bypass it. EIP-712 primary-type/contract allowlists do not constrain all message values; transaction destination/selectors do not constrain all decoded token amounts or fees.
- Multichain replay reservations are process-local, bounded and expire. Authorities must independently enforce authorization, exact bytes, expiry and durable replay handling across instances/restarts. A local timeout cannot cancel a remote signature already made. Retry only with a new request/challenge after reconciliation.
- Report hash integrity is not provenance. A valid Ed25519 attestation authenticates the supplied issuer key and report identity, not the truth of the issuer's chain observations. Pin a trusted public key independently of the report sender; manage revocation and issuer scope outside the current CLI.
- Provider IDs do not establish operator independence. Finalized EVM quorum evidence has a 120-second default freshness window at promotion/report generation. It is conditional on trusted clocks and independently configured honest providers; rollup L1 settlement is separate.
- Secret diagnostics are bounded file-local alias checks, not complete interprocedural taint analysis. Dynamically computed imports, reflection, returned aliases and arbitrary encodings can evade them. ES4909 means analysis could not finish within its budget.
- CLI file limits and symlink checks prevent demonstrated accidental overwrites. They do not isolate filesystem races from a hostile process sharing write access to the workspace.

## Dependencies and support

Node.js 22 and 24 on Windows/Linux are the candidate qualification targets. Install the locked development tree with `npm ci --ignore-scripts`. Production distribution includes TypeScript/viem; Sui/Solana/RAILGUN SDKs are development conformance fixtures. Root development and isolated Waku dependency audits are retained separately and currently have unresolved advisories. Do not expose their test fixtures as public services. A zero-advisory audit is a dated database result, not proof of absence of vulnerabilities.

Older pre-1.0 releases do not receive a security-maintenance promise. Use the exact reviewed candidate artifact/commit and its documented limitations. Full signing/recovery assurance remains blocked by #25/#26/#27 and release review #31.
