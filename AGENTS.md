# EraScript Repository Working Rules

This file defines the default workflow for AI-assisted development in this repository.

The goal is not merely to generate code. The goal is to preserve requirements, design intent, verification evidence, and current state so that a human can understand and continue the work later.

## 1. Source of Truth

When information conflicts, use this order:

1. the user's explicit requirements for the current task
2. the current GitHub Issue for that task
3. current source code and tests
4. repository design documents
5. current official primary documentation for installed SDK/API versions
6. model memory / prior assumptions

If the code contains an apparent bug, record the discrepancy instead of silently treating it as intended behavior.

## 2. Before changing code: Repository Reconnaissance

Inspect the current repository, not only README.

At minimum check:

- default branch and current HEAD SHA
- README and relevant docs
- AGENTS / CLAUDE / CONTRIBUTING / Copilot instructions if present
- package/dependency manifests and lockfiles
- relevant directory structure and existing shared abstractions
- language/framework/runtime versions
- tests
- linter / formatter / type checker
- CI/CD
- existing Issues and PRs
- recent relevant commits
- code directly related to the requested change

Do not invent files, APIs, dependencies, or architecture.

## 3. Issue-first rule

Before implementation, create one GitHub Issue dedicated to the task.

The Issue is the status owner for the work and must contain:

1. Background / 背景
2. Goal / 目的
3. Current State / 現状
4. Scope
5. Out of Scope
6. Functional Requirements
7. Non-Functional Requirements
8. Constraints
9. Architecture / Implementation Strategy
10. Files / Components Expected to Change
11. Risks
12. Acceptance Criteria
13. Verification Plan
14. Base Revision
15. Implementation Checklist

Always record:

```text
Base Commit SHA: <sha>
```

Use GitHub's issue number; do not invent issue IDs.

## 4. Design and planning

For material design choices, compare realistic options and record:

- advantages
- disadvantages
- maintainability
- future extensibility
- security
- consistency with the existing codebase

Record why the selected option was chosen.

For medium or larger work, create:

```text
docs/ai/issues/<ISSUE_NUMBER>/IMPLEMENTATION_PLAN.md
```

Create these only when useful:

```text
DECISIONS.md
CURRENT_STATE.md
HUMAN_UNDERSTANDING.md
```

Do not create large documentation trees for trivial changes.

### Implementation Plan minimum content

- Issue number
- Base Commit SHA
- target branch
- requirements
- current architecture
- target architecture
- data flow
- state transitions
- changed/new/deleted files
- API changes
- DB/migration changes
- error handling
- security considerations
- testing strategy
- implementation order
- rollback
- known risks

## 5. Human Understanding Summary

For medium+ work, provide a short human-oriented summary covering:

- What
- Why
- How
- Important Decisions
- Invariants
- Failure Modes
- Change Impact

A reader should understand the important architecture without reading every source file.

## 6. Pre-Implementation Review

Before implementation, review the plan in three distinct passes.

### Pass 1 — Requirements
Check that the design satisfies the Issue requirements and acceptance criteria.

### Pass 2 — Architecture
Check consistency with existing architecture and shared abstractions. Avoid duplicate systems.

### Pass 3 — Risk
Review security, regression, edge cases, error handling, performance, concurrency, and data integrity.

Triage findings as:

- adopted
- rejected, with reason
- out of scope

If a material assumption changes during implementation, update the Issue/Plan before continuing the affected implementation.

## 7. Implementation rules

- follow existing code style
- reuse existing common abstractions
- avoid unnecessary abstractions and dependencies
- do not leave dead/debug code
- never commit Secrets
- do not implement speculative features only because they may be useful later
- do not silently expand Issue scope
- preserve backward compatibility unless the Issue explicitly changes it

External framework/SDK/API behavior must be checked against the version currently installed in the repository and current primary sources. Do not implement from memory alone.

## 8. Verification

Run the verification actually available in the repository.

Typical checks include:

- unit/integration/E2E tests
- typecheck
- build
- lint / formatter when configured
- dependency checks
- relevant manual/read-only integration checks

Do not claim a check passed unless it actually ran.

If existing tests cannot prove an acceptance criterion, add the necessary test.

Record exact failures, investigate, fix, and rerun.

## 9. Post-Implementation Review

Review completed code separately for:

- Correctness
- Regression
- Architecture
- Security
- Maintainability
- Dead code / stale docs

Fix issues found before completion.

## 10. Issue completion

Before reporting completion, update the original Issue:

- completed checkboxes
- Implementation Result
- actual Files Changed
- Design Changes from the original plan
- Verification Result with actual commands/CI runs
- Remaining Issues, or explicitly `None`

The Issue, actual code/tests, and final report must agree.

## 11. Autonomous execution

Do not stop for unnecessary confirmation.

When a decision is safe, reversible, and within the Issue scope, choose the most reasonable option and record the assumption/decision.

Ask before:

- irreversible deletion of production data
- paid operations
- issuing/changing Secrets, API keys, or credentials
- direct production deployment
- large destructive specification changes
- security-critical changes where materially different viable designs require user choice

Read-only inspection, Issue management, documentation, tests, and reversible scoped implementation may proceed autonomously.

## 12. EraScript-specific verification baseline

Current repository conventions include:

- Node.js 22 CI baseline
- TypeScript strict mode
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- Node `node:test`
- deterministic Core CI separated from read-only Live Network Integration

Do not treat transaction hashes, signatures, bundle IDs, proof IDs, UserOperation hashes, SafeTx hashes, or RPC submission responses alone as proof of successful execution or recovery.

For chain/protocol work, preserve the existing evidence/finality/post-state model.
