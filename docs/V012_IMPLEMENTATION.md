# EraScript v0.12 — Original-source diagnostics

Status: implementation complete, final Core CI pending

Issue: #8

## Goal

v0.11 made EraScript surface lowering source-preserving at the edit level, but
TypeScript/Web3 diagnostics still observed transformed TypeScript coordinates.

v0.12 establishes one deterministic source-coordinate map and routes all
primary-source diagnostics through it.

Design rule:

> Generated TypeScript coordinates are an implementation detail. User/AI
> diagnostics for the primary EraScript file must identify the original
> `.era` source.

## Frontend coordinate map

`src/frontend/source-map.ts` derives contiguous monotonic segments from the
same validated `SourceEdit[]` used to lower EraScript.

Properties:

- UTF-16 code-unit offsets, matching JavaScript/TypeScript,
- exact mapping for unchanged spans,
- explicit left/right bias for generated replacement interiors,
- cumulative support for multiple length-changing edits,
- no source-length-sized lookup table,
- invariant checks for contiguous/monotonic segment coverage.

### Semantic replacement anchors

Most generated replacement characters map to the complete original edit range.

Some lowering absorbs formatting that is not the semantic source of the
generated token. The current example is:

```text
original:    value() -> User
lowered:     value(): User
```

The edit absorbs the whitespace before `->` to produce idiomatic TypeScript,
but the generated `:` is semantically anchored to the original `->` token,
not to the removed whitespace.

## Public transform compatibility

The public API remains:

```ts
transformEraScript(source) -> { code, features }
```

Its enumerable/public result shape is unchanged.

`transformEraScriptDetailed()` is the frontend/internal path and additionally
returns:

- deterministic source edits,
- the original/transformed coordinate map.

## TypeScript diagnostic remapping

`src/frontend/diagnostics.ts` remaps diagnostics associated with the
transformed primary virtual file.

It:

- rebinds the diagnostic to an original-source `ts.SourceFile`,
- remaps `start` and non-zero `length`,
- remaps related-information entries that belong to the same primary virtual
  file,
- deliberately leaves dependency/library diagnostics on their own source
  files.

`compile()` and `typecheck()` both use the detailed frontend and the same
coordinate map.

## Web3 diagnostics and unsafe audit

`analyzeWeb3Source()` accepts an optional transformed-offset location resolver.

`typecheck()` supplies a resolver created from the same frontend coordinate
map. Therefore the following diagnostics/audits report original `.era`
locations:

- bytes32/hash/Merkle literal validation,
- EVM address/calldata literal validation,
- direct secret access / hardcoded private key checks,
- unsafe-boundary diagnostics,
- unsafe-boundary `file/line/column`,
- unsafe-boundary audit ID.

The verification semantics of unsafe boundaries are unchanged; only their
source coordinates are corrected.

## CLI behavior

Because `typecheck()` now returns remapped primary diagnostics:

```text
era check file.era
era check file.era --json
```

use the original `.era` file/line/column rather than the internal virtual
`.ts` source.

This preserves `era check --json` as a deterministic AI repair interface.

## Regression coverage

Added/expanded tests cover:

- unchanged span mapping,
- replacement interior left/right bias,
- semantic `->` anchor behavior,
- multiple length-changing edits,
- UTF-16/emoji offsets,
- nullable generated-range mapping,
- template interpolation lowering followed by later coordinates,
- TypeScript semantic diagnostic remapping,
- transpile/syntactic diagnostic remapping,
- Web3 literal original-source location,
- unsafe audit original-source ID/location,
- related-information remapping,
- dependency diagnostic non-remapping,
- CLI JSON original filename/coordinates,
- existing compiler/typecheck/multichain regression corpus.

## Out of scope

v0.12 intentionally does not implement:

- generated JavaScript sourcemap composition back to EraScript,
- debugger/stack-trace remapping,
- multi-file EraScript module-resolution redesign,
- new language grammar.

Those features may consume this coordinate-map foundation later.

## Verification checkpoint

Pending final evidence:

- `npm run check`,
- `npm run test:core`,
- green Core CI on the release baseline,
- version bump to `0.12.0`,
- Issue #8 Post-Implementation Review and closure.
