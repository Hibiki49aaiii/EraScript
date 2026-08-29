# Issue #1 Implementation Plan

Issue: #1 — chore: Issue-first AI development workflowをリポジトリに定着させる

Base Commit SHA: `0e3c530219af8aebc4ce38e5611cb434c591e9fa`  
Target branch: `main`

## 1. Requirements

このIssueでは、今後のEraScript開発をIssue-firstで追跡できる状態へする。

必須要件:

- Repository Reconnaissanceをコード変更前に行う
- 作業専用Issueを実装前に作る
- Base Commit SHAをIssue/Planへ固定する
- 中規模以上の作業ではIssue配下にImplementation Planを残す
- 設計判断・リスク・レビュー・検証結果を追跡可能にする
- 実装後にIssue checklistと結果を更新する
- 高リスク操作だけ確認を要求し、安全かつ可逆な判断では自律実行する
- Source of Truth順位を明記する
- 既存v0.6完了状態・runtime architecture・CIを変更しない

## 2. Repository Reconnaissance

### Repository
- Repository: `Hibiki49aaiii/EraScript`
- Default branch: `main`
- Base HEAD: `0e3c530219af8aebc4ce38e5611cb434c591e9fa`
- Language: TypeScript
- Package version: `0.6.0`
- License: MIT
- Existing Issues at start: 0
- Existing PRs at start: 0

### Runtime / toolchain
- Node.js CI baseline: 22
- TypeScript: `^5.9.2`
- Module mode: NodeNext
- Core Web3 runtime: `viem ^2.55.19`
- Integration packages:
  - `@solana/kit 8.1.0`
  - `@mysten/sui 2.27.1`
  - `@railgun-community/wallet 10.9.0`
- Test runner: `node:test`
- Type checking:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
- Dedicated linter/formatter: none
- Lockfile: none

### Repository structure
- `src/chains/` — chain-family profiles/adapters/finality/signing
- `src/privacy/` — RAILGUN overlay/private-state/Broadcaster adapters
- `src/web3/` — EVM transaction/types/security/runtime
- `src/compiler.ts`, `src/transform.ts`, `src/typecheck.ts`, `src/cli.ts` — language/compiler/CLI
- `test/` — deterministic tests
- `test/live/` — read-only live-network smoke tests
- `docs/` — architecture and version implementation documents
- `.github/workflows/ci.yml` — deterministic Core CI
- `.github/workflows/live-integration.yml` — isolated live-network CI

### Repository instructions
At Base Revision:
- `AGENTS.md`: absent
- `CLAUDE.md`: absent
- `CONTRIBUTING.md`: absent
- `.github/copilot-instructions.md`: absent

### Current v0.6 state
The code/docs indicate v0.6 mandatory completion gates are already satisfied:
- implementation baseline `524718c2331ce0c2560c8b3313bde05c8235d9e2`
- Core CI run 299: 138/138
- Live Network Integration run 7: success
- CI policy closure `0d3cb10efee46607fc5501f9d247c36bdb976ad4`
- Core CI run 302: 138/138
- latest Base Revision is documentation-only closure `0e3c530219af8aebc4ce38e5611cb434c591e9fa`

No v0.6 runtime blocker is part of this Issue.

## 3. Current Architecture

Current product flow remains unchanged:

```text
EraScript source
  -> compiler / typecheck
  -> chain-family / protocol adapters
  -> evidence / verification state
  -> execution backend
```

Current development flow is implicit:

```text
request
  -> repository inspection
  -> implementation
  -> tests / CI
  -> docs
```

The missing layer is explicit Issue-centered traceability.

## 4. Target Architecture

Development workflow becomes:

```text
Task
  -> Repository Reconnaissance
  -> GitHub Issue + Base SHA
  -> Design / Options / Decision
  -> Implementation Plan (medium+)
  -> Pre-Implementation Review
  -> Implementation
  -> Verification
  -> Post-Implementation Review
  -> Issue Result Update
  -> Final Report
```

Persistent information is split by responsibility:

- `AGENTS.md`: stable repository-wide execution policy
- GitHub Issue: requirements, scope, checklist, acceptance criteria, current status
- `docs/ai/issues/<N>/IMPLEMENTATION_PLAN.md`: medium+ issue-specific architecture and execution plan
- `DECISIONS.md`: only material design choices
- `HUMAN_UNDERSTANDING.md`: compact operational understanding
- source/tests/CI: executable Source of Truth

## 5. Data Flow

No production data flow changes.

Development metadata flow:

```text
User request
 -> repository state
 -> Issue requirements + Base SHA
 -> Plan/Decision records
 -> code/docs changes
 -> machine verification results
 -> Issue implementation result
```

A later AI/human must be able to reconstruct why a change exists from Issue + commit + tests without depending on chat history.

## 6. State Transition

```text
Requested
 -> Reconnoitered
 -> Issue Open
 -> Designed
 -> Reviewed
 -> Implementing
 -> Verified
 -> Post-reviewed
 -> Issue Updated
 -> Complete
```

If implementation reveals an invalid assumption:

```text
Implementing
 -> Issue/Plan update
 -> Reviewed if material
 -> Implementing
```

High-risk irreversible actions stop before execution and require user confirmation.

## 7. Files to Change

### New
- `AGENTS.md`
- `docs/ai/issues/1/IMPLEMENTATION_PLAN.md`
- `docs/ai/issues/1/DECISIONS.md`
- `docs/ai/issues/1/HUMAN_UNDERSTANDING.md`

### Existing
- GitHub Issue #1 body/checklist/result

### No runtime changes
No changes planned to:
- `src/**`
- `test/**`
- package APIs
- database
- migration
- deployment

## 8. API / DB / Migration

- Public EraScript API: unchanged
- CLI API: unchanged
- DB: none
- Migration: none
- Package version: unchanged

## 9. Error Handling

Process failures are handled explicitly:

- Repository/file not found -> record absence; do not invent
- External API/SDK uncertainty -> inspect installed version and primary source
- Test/CI failure -> record failure, investigate, fix, rerun
- Requirement drift -> update Issue/Plan before further code changes
- Missing verification tool (e.g. no linter) -> state explicitly; do not claim it ran

## 10. Security Considerations

Confirmation is mandatory before:
- irreversible production data deletion
- paid operations
- Secret/API key/credential issuance or change
- direct production deployment
- large destructive specification changes
- security-critical choice with materially different viable designs

Never store Secrets in Issue/docs/source.

Routine read-only GitHub inspection, reversible documentation, tests, branches and non-destructive code changes may proceed autonomously.

## 11. Testing Strategy

Because runtime behavior is intentionally unchanged:

1. `npm run check`
2. `npm run test:core`
3. GitHub Core CI for the implementation commit
4. Manual consistency checks:
   - Issue Base SHA == Plan Base SHA
   - AGENTS workflow matches Issue requirements
   - no v0.6 completion claims changed
   - no runtime source/test files unexpectedly changed

No dedicated lint/formatter exists at Base Revision; introducing one is out of scope.

## 12. Implementation Order

1. Persist this Implementation Plan
2. Persist Decisions
3. Persist Human Understanding Summary
4. Implement root `AGENTS.md`
5. Review actual changed files against Issue scope
6. Run `npm run check`
7. Run `npm run test:core`
8. Confirm GitHub Core CI
9. Perform Post-Implementation Review
10. Update Issue #1 with final checklist/results

## 13. Rollback

All changes are documentation/process files only.

Rollback is safe by reverting the commits that add:
- `AGENTS.md`
- `docs/ai/issues/1/**`

No state/data migration is required.

## 14. Known Risks

- Policy becomes too long and is ignored
- Issue/docs duplicate each other and drift
- Small tasks become documentation-heavy
- AI marks checkboxes complete without actual verification
- Chat-specific behavior leaks into persistent repository rules

Mitigations:
- keep `AGENTS.md` concise
- Issue owns requirements/status
- Plan only for medium+ tasks
- actual tests/CI remain authority for machine verification
- no personal/session-specific content in policy

## 15. Pre-Implementation Review

### Pass 1 — Requirements

Findings:
1. The user explicitly requires Issue creation before implementation.
2. The Base Revision must be preserved.
3. Human Understanding must be separate from detailed Plan.
4. Documentation must not become an end in itself.

Triage:
- **Adopted:** Issue-first, Base SHA, separate human summary.
- **Adopted:** medium+ only Plan rule.
- **Out of scope:** adding Lint/Formatter/lockfile.
- **Out of scope:** retroactively creating Issues for all v0.2–v0.6 history.

Result: Plan satisfies Issue #1 without altering product behavior.

### Pass 2 — Architecture

Options:
- A: chat-only policy
- B: CONTRIBUTING-only policy
- C: root AGENTS + Issue-centric records

Decision: **Option C**.

Reasons:
- highest discoverability for AI agents
- avoids forcing all detailed process into README
- issue-specific state stays scoped
- does not couple process docs to runtime modules

Potential duplication:
- AGENTS must not reproduce full Issue template prose.
- Plan must reference Issue rather than copy every changing status field.

Result: no runtime architecture conflict identified.

### Pass 3 — Risk

Security:
- ensure high-risk action confirmation boundaries are explicit.
- prohibit Secrets in Issue/docs.

Regression:
- no runtime file changes planned.
- Core CI still required to prove docs/process changes did not accidentally alter package state.

Maintainability:
- avoid a large template ecosystem.
- one root policy + issue-specific docs only.

Edge cases:
- trivial changes: may use a short Issue without Implementation Plan.
- urgent reversible fix: still create Issue first, but concise.
- invalid initial assumption: Issue/Plan updated before code continuation.

Triage:
- **Adopted:** explicit risk-action boundary.
- **Adopted:** concise path for trivial changes.
- **Adopted:** Plan-update-before-code rule on material drift.
- **Not adopted:** mandatory PR creation for every change; user requested Issue-first, not PR-only workflow.

## 16. Review Conclusion

Pre-Implementation Review: **PASS**

No blocker requires user confirmation. The selected changes are documentation-only, reversible, non-destructive, and within Issue #1 scope.
