# Issue #9 Pre-Implementation Review

Decision: **APPROVED TO IMPLEMENT**

## Architecture

PASS. v0.12 already provides the authoritative transformed->original coordinate map. v0.13 should compose with it rather than introduce a second lowering/source-position model.

## Dependency choice

PASS. Source Map V3's required subset is small enough to implement internally: Base64 VLQ plus standard mapping segments. Adding a runtime source-map package is unnecessary for compiler output.

## Correctness constraints

- UTF-16 offsets must match TypeScript/JavaScript strings.
- generated columns reset per source-map line; source/original/name deltas do not.
- unmapped segments must remain unmapped.
- replacement interiors use the same left-bias/semantic anchors as v0.12 diagnostics.
- transformed source text must never appear in final `sourcesContent`.

## Compatibility

PASS. No grammar or runtime behavior change. CLI syntax remains unchanged.

## Security

PASS. Source maps contain source text when enabled, matching the existing `inlineSources` behavior. No secret/network/signing surface is added.

## Known non-goals

Stack-trace/debugger remapping, bundler composition and multi-file EraScript resolution remain outside this issue.
