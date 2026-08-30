# Issue #12 Implementation Plan

Base Commit: `2d78349548a14a5562723ef8c544198358c015bd`

## Architecture

### Runtime

Add `src/runtime-loader.ts` implementing the Node ESM `load` hook.

For file URLs ending in `.era`:

1. read original source,
2. compile with the existing v0.13 composed source-map pipeline,
3. reject compile diagnostics,
4. convert the composed map to an inline data-URL source map,
5. return ESM source with `shortCircuit: true`.

For every other URL, call Node's next loader unchanged.

The CLI registers the hook through `node:module.register()` using `--import`, then executes the **original entry `.era` path**.

### Typecheck

Refactor `src/typecheck.ts` to maintain a per-module context:

```text
original file       virtual checker file
main.era      <->    main.era.ts
helper.era    <->    helper.era.ts
```

A custom CompilerHost:

- lazily transforms imported EraScript files,
- resolves explicit relative `.era` specifiers,
- delegates npm/JS/TypeScript resolution to TypeScript,
- collects one coordinate map per EraScript file.

After program diagnostics are produced, apply the existing diagnostic remapper once for every loaded EraScript context.

Web3 analysis is also executed for every loaded EraScript module and aggregated.

### Project config

Add `src/project.ts`:

- discover `era.json` upward from cwd,
- validate `entry`,
- resolve it relative to the config directory,
- expose deterministic project-entry resolution.

CLI `run` and `check` use the project entry only when no explicit file is supplied.

## Expected Files

New:
- `src/runtime-loader.ts`
- `src/project.ts`
- `test/project-runtime.test.ts`

Modified:
- `src/typecheck.ts`
- `src/cli.ts`
- documentation/version files if verification succeeds

## Failure Handling

- bad `era.json` -> explicit CLI error
- missing configured entry -> explicit CLI error
- unresolved `.era` module -> TypeScript diagnostic
- loader compile diagnostic -> loader throws with original-source diagnostic
- non-Era modules -> never handled by the custom loader

## Security

The loader MUST NOT:

- intercept HTTP/data/node/npm modules,
- modify bare package specifiers,
- add search paths,
- persist generated JS,
- expose secret environment variables,
- silently repair invalid source.

## Verification

- unit/project typecheck
- CLI two-module runtime
- imported runtime throw stack
- local JS import
- bare npm import
- era.json implicit entry
- explicit-entry override
- existing argument/exit behavior
- full Core CI
