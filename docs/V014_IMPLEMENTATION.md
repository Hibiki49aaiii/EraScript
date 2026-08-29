# EraScript v0.14 — Runtime Stack Trace Remapping

Status: implementation complete; verification pending

Issue: #10

## Goal

Consume the v0.13 JavaScript -> original EraScript source map in the actual `era run` execution path so Node runtime failures identify the original `.era` source.

## Runtime pipeline

```text
original .era
  -> typecheck
  -> compile(sourceMap: true, outputFileName: main.mjs)
  -> temp/main.mjs
  -> temp/main.mjs.map
  -> node --enable-source-maps temp/main.mjs [user args]
  -> source-mapped stack trace
  -> child exits
  -> temp cleanup
  -> parent preserves child exit status
```

## Implementation

`src/cli.ts` now:

- requests the v0.13 composed source map,
- fails closed if the compiler does not produce the requested map,
- writes `main.mjs` and `main.mjs.map` before child launch,
- invokes the same Node executable with `--enable-source-maps`,
- appends user arguments only after the script path,
- retains map artifacts for the entire child lifetime,
- records the child status,
- removes the temporary directory in `finally`,
- exits with the preserved child status only after cleanup.

The compile/map validation happens before the runtime temporary directory is created, so compile-time failure cannot leak an EraScript runtime directory.

## Why Node built-in source maps

No custom stack parser is introduced.

Node already understands Source Map V3. v0.13 produces an original-EraScript map, so v0.14 only needs to ensure Node can read that map while the temporary JavaScript is running.

No runtime dependency is added.

## Regression coverage

`test/cli-run-sourcemap.test.ts` verifies:

- runtime throw reports the original absolute `.era` path,
- throw line is the original line after emoji/template/function-arrow/`mut` lowering,
- child failure status is visible to the parent,
- arguments after `--` are preserved exactly,
- custom `process.exit(7)` is preserved,
- dedicated runtime TMPDIR contains no leaked `erascript-*` directory after success or failure.

## Compatibility

Unchanged:

- `era run file.era [-- args...]` syntax,
- Node executable selection (`process.execPath`),
- typecheck-before-run gate,
- script argument semantics,
- successful program behavior,
- npm/TypeScript compatibility.

## Out of scope

v0.14 does not implement:

- Node inspector/debugger protocol integration,
- browser DevTools,
- custom stack formatting,
- bundler source-map composition,
- multi-file EraScript module resolution,
- source-mapped generated/eval modules.

## Verification

Final `npm run check`, `npm run test:core`, and Core CI evidence will be recorded after the implementation baseline is green.
