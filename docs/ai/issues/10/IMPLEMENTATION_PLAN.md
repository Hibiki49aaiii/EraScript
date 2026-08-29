# Issue #10 Implementation Plan

## Objective

Use the v0.13 composed JavaScript source map in `era run` so Node runtime stack traces point to the original EraScript source.

## Base

`74b9ad675b52feee9c0ef55788993e6002e0632e`

## Runtime flow

```text
original .era
  -> typecheck
  -> compile(sourceMap: true, outputFileName: main.mjs)
  -> temp/main.mjs
  -> temp/main.mjs.map
  -> node --enable-source-maps temp/main.mjs [user args]
  -> child exits
  -> cleanup temp directory
  -> preserve child status
```

## Implementation decisions

- Use Node's built-in `--enable-source-maps`; do not parse or rewrite stack strings.
- Require the composed map when `era run` requests it; fail closed if absent.
- Write JavaScript and map before spawn.
- Keep both artifacts alive until `spawnSync` returns.
- Put cleanup in `finally`.
- Call `process.exit(status)` only after cleanup.
- Preserve the existing `--` argument separator semantics.

## Verification

- throwing EraScript fixture maps to original absolute `.era` line,
- fixture includes length-changing EraScript syntax before the throw,
- argument passthrough remains exact,
- child non-zero exit code is preserved,
- isolated TMPDIR has no leaked `erascript-*` directory after success/failure,
- `npm run check`,
- `npm run test:core`,
- Core CI green.
