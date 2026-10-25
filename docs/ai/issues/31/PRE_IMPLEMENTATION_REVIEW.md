# Issue #31 — three-pass pre-implementation review

Base Commit SHA: a75e81d5e0e82ee8a0d1f7df946d76a6a1ce0ab7

## Pass 1 — Requirements

Adopted: reconcile pending PRs before new changes; qualify runtime, installed artifact and OS behavior; keep incomplete #25/#26/#27 criteria open. A passing negative test is not proof of successful recovery. Production publication remains outside this preparation task.

## Pass 2 — Architecture

Adopted: reuse existing viem parsing/recovery, adapters and package smoke. Private cloned/frozen values preserve existing caller APIs. Existing report formats and hash semantics remain unchanged. Rejected: treating an in-process brand or Node permission flag as cryptographic provenance or malicious-code isolation.

## Pass 3 — Risk

Adopted: post-await expiry and replay reservations; reject mutated callback data; verify EIP-712 signer against exact digest; preserve initializer files; strip secrets from diagnostics; bounded replay store; platform-specific execution gate. Replay state across processes, actual signer hosting, third-party RPC independence and external security signoff remain explicit unresolved production gates under #27/#26.

Decision: proceed with reversible, scoped implementation and candidate qualification. Do not declare full funds-recovery or signer-isolation release approval from this review.
