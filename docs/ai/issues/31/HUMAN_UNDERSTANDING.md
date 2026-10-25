# Issue #31 — Human understanding

- What: integrate the pending security work and qualify EraScript's actual researcher workflow and package.
- Why: older green tests do not cover asynchronous signer mutation, signature authenticity, native Windows packaging, or trustworthy terminal recovery claims.
- How: validate concrete boundary inputs/results, preserve immutable approved data, exercise adversarial cases and packaged execution, and bind completion to current CI evidence.
- Important decisions: existing Node compatibility remains; external verifier/provider configuration is a trust assumption; no helper is described as an OS sandbox.
- Invariants: no caller string alone proves finality/recovery; exact approved signed bytes and signer identity must match; no overwrite by initialization; no real credentials or funds used in tests.
- Failure modes: errors reject signing/verification, keep reports nonterminal, and block release qualification rather than silently proceeding.
- Change impact: stricter pre-1.0 validation, documented unsupported guarantees, reproducible packaging/CI and a practical authorized local research guide.
