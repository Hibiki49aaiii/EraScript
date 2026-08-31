# Issue #18 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

## Pass 1 - Requirements

### Finding: safe verification APIs must not disappear with the constructor

Disposition: adopted. Types, evidence references, report hashing, parsing, and state assertions are explicitly re-exported.

### Finding: serialized reports must remain compatible

Disposition: adopted. `src/chains/verification.ts` and all report/hash logic remain unchanged.

## Pass 2 - Architecture

### Option A: explicit public allowlist

Selected. It is the smallest boundary change and keeps one internal implementation for all strict adapters.

### Option B: public branded token

Rejected. A public JavaScript token path can be forged unless token creation is hidden, producing more churn than the allowlist.

### Option C: duplicate construction in adapters

Rejected. It risks hash/state divergence and unnecessary maintenance.

## Pass 3 - Risk

### Compatibility break

Disposition: adopted and documented. EraScript is pre-1.0; package and CLI version advance to 0.18.0.

### Declaration/runtime drift

Disposition: adopted. One regression test checks both runtime module keys and generated declaration text.

### Internal deep import

Disposition: documented limitation. The package export map does not expose the internal subpath, while package-content minimization remains a separate roadmap task.

## Decision

**APPROVED TO IMPLEMENT.**
