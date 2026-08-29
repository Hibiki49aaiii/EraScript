# Issue #9 Post-Implementation Review

Issue: v0.13 — Compose emitted JavaScript source maps back to original EraScript

Status: **APPROVED**

## Release baseline

```text
version: 0.13.0
implementation commit: fbcca7bd620400b61f5a177510480c1a58f1cf86
Core CI run: 401
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 204
pass: 204
fail: 0
```

Pre-release composition/CLI verification also passed Core CI run 397 at 203/203 before the final fail-closed index-bounds regression.

## Requirements review

PASS.

Verified behavior:

- emitted JavaScript Source Map V3 coordinates are composed back to original
  EraScript coordinates,
- original `.era` source is stored in `sourcesContent`,
- lowered TypeScript is not exposed as the final embedded source,
- ordinary TypeScript remains identity-mapped,
- UTF-16/emoji and multiple length-changing edits are covered,
- template interpolation/nullable lowering retain later original coordinates,
- the v0.12 semantic return-arrow anchor is reused,
- CLI `era build -o` writes map metadata matching the actual generated file,
- malformed Source Map V3 source/name indexes fail closed.

## Architecture review

PASS.

One location model remains authoritative:

```text
SourceEdit[]
  -> transformed TypeScript
  -> EraSourceCoordinateMap

TypeScript emitter
  -> JS->transformed-TS Source Map V3

both
  -> dependency-free composition
  -> JS->original-EraScript Source Map V3
```

No alternate parser/lowering location model was introduced.

## Source Map V3 correctness review

PASS.

The codec preserves Source Map V3 state rules:

- generated column deltas reset for each generated line,
- source/original line/original column/name deltas continue across lines,
- one-field unmapped segments remain unmapped,
- four-field mapped segments remain mapped,
- five-field named segments preserve name indexes,
- malformed field counts and out-of-range indexes fail deterministically.

The mapping model was cross-checked against ECMA-426.

## Backward compatibility review

PASS.

- no new runtime dependency,
- public `transformEraScript()` shape unchanged,
- generated JavaScript semantics unchanged,
- source-map-disabled compilation unchanged,
- diagnostics unchanged,
- Node/npm/TypeScript compatibility retained.

The new optional `CompileOptions.outputFileName` affects source-map metadata only.

## CLI review

PASS.

For:

```bash
era build input.era -o nested/custom.js
```

the output is:

```text
nested/custom.js
nested/custom.js.map
```

and the JavaScript references:

```text
//# sourceMappingURL=custom.js.map
```

while the map reports `file: "custom.js"`.

## Security review

PASS / no new execution or signing authority.

Source maps remain source-bearing artifacts. v0.13 changes embedded source content
from lowered TypeScript to the original EraScript source, matching the intended
debugging semantics. Existing secret-analysis policy remains unchanged.

## Out-of-scope confirmation

Still intentionally outside v0.13:

- runtime stack-trace remapping,
- Node inspector/debugger integration,
- bundler source-map composition,
- multi-file EraScript module-resolution redesign,
- new grammar.

## Final decision

**APPROVED.**

Issue #9 requirements are satisfied at EraScript v0.13.0 implementation baseline
`fbcca7bd620400b61f5a177510480c1a58f1cf86`, with Core CI run 401 green at
204/204 tests.
