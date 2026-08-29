# Issue #1 Decisions

Base Commit SHA: `0e3c530219af8aebc4ce38e5611cb434c591e9fa`

## D-001 — Persist the workflow in root AGENTS.md

**Status:** Adopted

### Options considered
- A: chat-only instructions
- B: CONTRIBUTING.md only
- C: root AGENTS.md + Issue-specific docs

### Decision
Use **Option C**.

### Why
- AI agents can discover `AGENTS.md` at repository entry.
- Human-visible requirements/status remain in GitHub Issues.
- Detailed plans remain issue-scoped instead of bloating README.
- No runtime dependency or architecture changes are required.

### Consequences
- `AGENTS.md` must stay concise and stable.
- Issue-specific detail must not be duplicated into `AGENTS.md`.

## D-002 — Issue is the status owner; code/tests are execution truth

**Status:** Adopted

The Issue owns:
- requirements
- scope
- acceptance criteria
- checklist
- implementation result

Code/tests/CI own:
- actual behavior
- buildability
- verification result

If Issue text and code/tests diverge, the discrepancy must be resolved before completion.

## D-003 — Implementation Plan only for medium+ work

**Status:** Adopted

Small, reversible changes may use a concise Issue and skip large Plan files.

Reason: avoid turning documentation into the objective.

## D-004 — Do not add lint/formatter/lockfile in this Issue

**Status:** Adopted

Base repository currently has no dedicated linter/formatter and no lockfile.

Adding them changes toolchain/reproducibility behavior and deserves a separate Issue with explicit tradeoff analysis.

## D-005 — No mandatory PR workflow yet

**Status:** Adopted

The user required Issue-first traceability, not PR-only development.

A future Issue may introduce mandatory feature branches/PR reviews if team workflow requires it.
