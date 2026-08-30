# EraScript v0.16 — Multi-file project build

Status: implementation complete; verification complete

Issue: #13

## Goal

v0.16 completes the project workflow introduced by v0.15.

v0.15 established project-aware `run` and `check`. v0.16 makes:

```bash
era build
```

consume `era.json` and emit a plain-Node multi-file ESM graph.

## Project build contract

Given:

```json
{
  "entry": "src/main.era",
  "outDir": "dist"
}
```

and:

```text
src/
  main.era
  helper.era
  local.mjs
```

EraScript emits:

```text
dist/
  src/
    main.mjs
    main.mjs.map
    helper.mjs
    helper.mjs.map
    local.mjs
```

Explicit relative EraScript specifiers are rewritten:

```text
"./helper.era" -> "./helper.mjs"
```

The rewrite is syntax-aware and length-preserving, so existing composed source-map column offsets remain valid.

## Graph semantics

The project emitter:

- starts from `era.json.entry`,
- follows explicit relative `.era` imports/exports/string-literal dynamic imports,
- tracks visited modules to support cycles,
- emits each EraScript module once,
- rejects EraScript paths escaping project root,
- preserves deterministic project-relative output layout.

## Local runtime assets

Direct relative imports ending in:

- `.js`
- `.mjs`
- `.cjs`
- `.json`

are copied into the corresponding project-relative path under `outDir`.

The builder does not copy the entire project tree.

Bare package imports such as `viem` remain unchanged and are resolved by normal Node/npm semantics at runtime.

## Source maps

Every emitted EraScript module is compiled independently through the existing v0.13 source-map composition pipeline.

Each generated `.mjs` receives:

```text
module.mjs
module.mjs.map
```

Running the built project with Node `--enable-source-maps` maps stack frames back to the original imported `.era` source.

## Compatibility

Legacy explicit build remains:

```bash
era build file.era
era build file.era -o output.js
```

Project build mode is selected only when no explicit input file is provided.

## Security boundaries

The project builder fails closed when:

- an EraScript module escapes project root,
- a local dependency is missing,
- a relative local import uses an unsupported extension,
- output mapping would escape `outDir`,
- compilation/source-map generation fails.

No bundler and no new runtime dependency were added.

## Package metadata

```text
EraScript: 0.16.0
Node: >=20.6.0
package-lock version: 3
```

The temporary lock refresh workflow was removed before final verification.

## Final verification

Final non-documentation code baseline:

`61f6a0127421cbff8dcbf4660c1b87f774a864b5`

Core CI:

```text
Run: 430
Run ID: 33287995667
Node: 22.23.2
npm: 10.9.8

npm ci: PASS
npm run check: PASS
npm run test:core: PASS

tests: 216
pass: 216
fail: 0
Conclusion: success
```

New regressions verify:

1. multi-file `.mjs` graph emission
2. project-local asset copying
3. bare npm import preservation
4. plain Node execution
5. imported-module original-source stack mapping
6. cyclic EraScript import handling
7. project-root escape rejection
8. legacy explicit single-file build compatibility
