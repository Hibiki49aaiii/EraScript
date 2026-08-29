# EraScript v0.13 — Emitted JavaScript Source Maps

Status: implementation complete

Issue: #9

## Goal

v0.12 made diagnostics report original EraScript coordinates. v0.13 extends the same source-of-truth mapping into emitted JavaScript source maps.

The compiler now composes:

```text
generated JavaScript
  -> TypeScript emitter Source Map V3
  -> transformed TypeScript coordinates
  -> EraSourceCoordinateMap
  -> original EraScript coordinates
```

Generated JavaScript tooling no longer receives a map whose filename says `.era` while its line/column data actually describes lowered TypeScript.

## Source Map V3 codec

`src/frontend/source-map-v3.ts`

Implemented without adding a runtime dependency:

- strict JSON/schema validation for the Source Map V3 subset emitted by TypeScript,
- Base64 VLQ decode/encode,
- 1-field unmapped segments,
- 4-field mapped segments,
- 5-field named segments,
- generated-column delta reset per generated line,
- source/original-line/original-column/name delta continuity across lines,
- deterministic rejection of malformed/unsupported segments.

The codec follows the ECMA-426 Source Map V3 mapping model.

## Composition

For every mapped TypeScript emitter segment:

1. transformed TypeScript line/column is converted to a UTF-16 offset,
2. `EraSourceCoordinateMap.toOriginal(offset, "left")` maps the position into the original EraScript source,
3. the original UTF-16 offset is converted back into zero-based line/column,
4. the segment is re-encoded while preserving generated position and optional name index.

The final map:

- has exactly the original EraScript source as its source,
- stores the original EraScript text in `sourcesContent`,
- does not expose lowered TypeScript as embedded source content,
- preserves unmapped generated regions.

## Semantic replacement anchors

v0.13 reuses the v0.12 coordinate map rather than creating a separate mapping model.

Therefore semantic anchors such as:

```text
EraScript: value() -> User
Lowered TS: value(): User
```

continue to map the generated `:` back to the original `->` token instead of absorbed whitespace.

## Compiler behavior

`compile(..., { sourceMap: true })` now returns the composed JavaScript -> original EraScript source map.

A new optional `outputFileName` compile option controls only generated source-map metadata. It does not change TypeScript lowering or runtime JavaScript semantics.

When supplied:

- Source Map `file` is set to the actual generated JavaScript filename,
- the emitted `//# sourceMappingURL=...` comment is normalized to the corresponding map filename.

## CLI behavior

`era build input.era -o nested/custom.js` now writes:

```text
nested/custom.js
nested/custom.js.map
```

with:

```text
//# sourceMappingURL=custom.js.map
```

and Source Map `file: "custom.js"`.

CLI syntax is unchanged.

## Compatibility

Preserved:

- ordinary TypeScript input,
- public `transformEraScript()` result shape,
- compiler diagnostics,
- Web3 diagnostics,
- generated JavaScript semantics,
- source-map-disabled compilation,
- Node/npm compatibility.

No runtime dependency was added.

## Regression coverage

Added tests cover:

- Source Map V3 encode/decode round-trip,
- mapped/unmapped/named segments,
- emitted function-name mapping to original EraScript,
- semantic return-arrow anchor composition,
- UTF-16/emoji plus multiple lowering edits,
- template interpolation and nullable lowering followed by later mapped code,
- ordinary TypeScript identity mapping,
- original `sourcesContent`,
- CLI `-o` JavaScript/map filename consistency.

Pre-release implementation verification:

```text
Core CI run: 397
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 203
pass: 203
fail: 0
```

## Out of scope

v0.13 intentionally does not implement:

- Node runtime stack-trace remapping,
- inspector/debugger protocol integration,
- bundler source-map composition,
- multi-file EraScript module-resolution redesign,
- new language grammar.

These are follow-on consumers of the v0.12/v0.13 source-location foundation.


## Final release verification

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

Issue #9 Post-Implementation Review:
`docs/ai/issues/9/POST_IMPLEMENTATION_REVIEW.md`.
