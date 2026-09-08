# Issue #20 Implementation Plan

Issue: #20

Base Commit SHA: `2bf73fe79eda59f9bef44ad821fe3cb9b21783cd`

Target branch: `issue-20-package-determinism`

## Requirements

- Project runtime/build test child processes must not inherit ANSI color forcing in a way that changes captured stdout/stderr.
- Production CLI/runtime color behavior must remain untouched.
- npm package payload must include the supported `dist/src/**` runtime/declaration subtree and exclude `dist/test/**`.
- Package smoke must verify the public exports, CLI, runtime loader, `era run`, and `era build` from an installed tarball.
- No publish/release operation is allowed.

## Current Architecture

`tsconfig.json` uses `rootDir: "."`, `outDir: "dist"`, and includes both `src/**/*.ts` and `test/**/*.ts`, so development builds intentionally emit:

```text
dist/src/**
dist/test/**
```

`package.json` currently allowlists the entire `dist` directory.

`test/project-build.test.ts` and `test/project-runtime.test.ts` call `spawnSync()` with `cwd` and `encoding` only. Therefore child processes inherit the full parent environment, including `FORCE_COLOR`, `NO_COLOR`, and terminal metadata.

## Target Architecture

### Deterministic test children

Use a test-local helper returning:

```ts
{
  ...process.env,
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  TERM: "dumb",
}
```

Pass it to every spawned Node/CLI child in the two project test files.

### npm package allowlist

Change:

```json
"files": ["dist", "README.md", "LICENSE"]
```

to:

```json
"files": ["dist/src", "README.md", "LICENSE"]
```

No tsconfig split is required for this scoped fix.

### Package smoke script

Add `scripts/package-smoke.mjs` using Node standard library only.

Flow:

```text
repository
  -> npm run build
  -> npm pack --json
  -> inspect package file list
  -> assert required/forbidden paths
  -> create temp project
  -> npm init/package.json
  -> npm install <local tarball>
  -> import root/web3/chains/privacy
  -> run installed era CLI
      -> --version
      -> check
      -> run
      -> build
  -> run built output
  -> cleanup tarball/temp project in finally
```

The script must avoid relying on shell syntax, POSIX paths, or executable-bit assumptions.

## Data Flow

No application data flow changes.

Only test child environment and packaging qualification flow change.

## State Transitions

None in EraScript runtime.

Package smoke has an internal validation sequence and exits non-zero on first violated invariant.

## Files Changed / Added

Modified:
- `package.json`
- `test/project-build.test.ts`
- `test/project-runtime.test.ts`
- `.github/workflows/ci.yml`

New:
- `scripts/package-smoke.mjs`
- `docs/ai/issues/20/HUMAN_UNDERSTANDING.md`
- `docs/ai/issues/20/IMPLEMENTATION_PLAN.md`
- `docs/ai/issues/20/PRE_IMPLEMENTATION_REVIEW.md`
- `docs/ai/issues/20/POST_IMPLEMENTATION_REVIEW.md`

Potentially modified after verification:
- Issue #15 progress text/checklist

## API Changes

No runtime/library API change.

One new npm development script is planned:

```text
test:package
```

## DB / Migration Changes

None.

## Error Handling

Package smoke throws explicit errors for:
- missing required tarball paths,
- forbidden `dist/test` paths,
- failed public import,
- failed CLI command,
- wrong CLI version,
- failed built-output execution.

Child-process stderr/stdout are included in failure messages where useful, without printing secrets.

## Security Considerations

- No network write, npm publish, GitHub Release, signing, proof, bundle, or transaction operation.
- `npm install` in the temporary package fixture consumes the local tarball and its normal declared runtime dependencies; it does not mutate the repository dependency graph.
- The production high/critical audit boundary remains separately verified with `npm audit --omit=dev --audit-level=high`.
- The packaging gate reduces accidental publication of internal tests and future internal-only compiled files outside `dist/src`.

## Testing Strategy

1. Existing `npm run check`.
2. Existing `npm run test:core`.
3. Forced-color parent environment against the core suite.
4. `npm run test:package`.
5. Production audit.
6. Branch Core CI with the package gate integrated.

## Implementation Order

1. Add deterministic test child environment.
2. Narrow npm files allowlist.
3. Add cross-platform package smoke script and npm script.
4. Add package smoke step to Core CI.
5. Run/review CI.
6. Post-Implementation Review.
7. Update Issues #20 and #15.

## Rollback

Revert the scoped commits on `issue-20-package-determinism`. No runtime schema/data migration is involved.

## Known Risks

- The package smoke script can become slow because it installs the tarball in a fresh fixture. Keep it in CI as a release-quality gate, not inside every individual unit test.
- Windows executable resolution differs from POSIX. Resolve the CLI JavaScript entry directly from the installed package rather than depending only on `.bin` shell wrappers where practical.
- npm pack output shape is npm-version-sensitive; parse the documented JSON output defensively and assert semantic paths, not incidental ordering.
