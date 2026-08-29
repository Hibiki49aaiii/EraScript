# Issue #9 Implementation Plan

## Objective

Compose TypeScript emitter source maps with the v0.12 transformed-TypeScript -> original-EraScript coordinate map so emitted JavaScript points back to the original `.era` source.

## Base

`8595315c71547cc1be17b9512c8f2c9374caece9`

## Data flow

```text
original .era
  -> SourceEdit[]
  -> transformed TypeScript
  -> EraSourceCoordinateMap

transformed TypeScript
  -> TypeScript emitter
  -> JavaScript + JS->TS Source Map V3

JS->TS map + EraSourceCoordinateMap
  -> source-map composition
  -> JavaScript + JS->EraScript Source Map V3
```

## Implementation

1. Add dependency-free Source Map V3 VLQ decoder/encoder.
2. Decode TypeScript emitter mappings while preserving generated columns and optional names.
3. Convert each mapped transformed TS line/column to a UTF-16 offset.
4. Use `EraSourceCoordinateMap.toOriginal(..., "left")`.
5. Convert the original offset back to zero-based line/column.
6. Re-encode mappings and replace `sources/sourcesContent` with original EraScript metadata.
7. Integrate composition in `compile()`.
8. Make CLI build sourceMappingURL/map `file` agree with custom `-o` output.
9. Add codec, compiler and CLI regressions.

## Compatibility

- no new dependency,
- public `transformEraScript()` result unchanged,
- JavaScript code unchanged except source-map metadata comment when output filename is explicitly supplied,
- source maps disabled => existing behavior,
- diagnostics unchanged.

## Failure policy

Malformed/unsupported TypeScript emitter maps throw deterministically. The compiler must never silently expose a JS->lowered-TS map as if it were a JS->EraScript map.

## Verification

- `npm run check`
- `npm run test:core`
- Core CI green
