# Issue #13 Implementation Plan

Base: `74cbbe0de7bb601ab619d00e55288bf2fb7fcf54`

## Project graph

Add `src/project-build.ts`.

1. Read configured entry.
2. Transform source and parse TypeScript syntax.
3. Collect static import/export and string-literal dynamic-import specifiers.
4. Follow explicit relative `.era` imports with a visited set.
5. Reject EraScript module paths outside project root.

## Output

```text
<root>/<relative>.era -> <outDir>/<relative>.mjs
```

Each EraScript source is compiled independently using existing `compile()` with a composed source map.

The emitted JS AST is inspected for module-specifier string literals. Only specifiers ending in `.era` are rewritten to `.mjs`.

Because the rewrite is equal-length, source map offsets remain valid.

## Local assets

For direct relative imports ending in `.js`, `.mjs`, `.cjs`, or `.json`:

- require the file to remain inside project root,
- copy it to the matching project-relative path under outDir,
- never copy unrelated files.

Bare package imports are untouched.

## CLI

`era build`:
- discover era.json,
- typecheck configured entry graph,
- build project to outDir.

`era build file.era [-o ...]`:
- preserve legacy single-file behavior.

## Verification

- two-module project output
- plain Node execution
- source-mapped imported throw
- relative local MJS copied
- bare viem import retained
- root escape rejection
- explicit build regression
- full Core CI
