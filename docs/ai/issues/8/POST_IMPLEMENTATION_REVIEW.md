# Issue #8 Post-Implementation Review

Issue: v0.12 — Original-source diagnostics and frontend coordinate mapping

Release baseline:

```text
version: 0.12.0
commit: b8c63e0ec0867a6d7870d2df6ebacdc684cd073d
Core CI run: 392
npm install: PASS
npm run check: PASS
npm run test:core: PASS
tests: 197
pass: 197
fail: 0
```

Additional multi-chain regression evidence:

```text
Live Network Integration run: 9
Solana RPC: PASS
Sui Core API: PASS
Jito: PASS
RAILGUN/Waku: PASS
read-only: yes
```

## Requirements review

PASS.

The primary user/AI-facing diagnostic path now reports original EraScript
coordinates instead of generated TypeScript coordinates.

Verified surfaces:

- TypeScript semantic diagnostics,
- transpile/syntactic diagnostics,
- Web3 literal diagnostics,
- direct-secret / hardcoded-key diagnostics,
- unsafe-boundary diagnostics,
- unsafe-boundary audit IDs,
- CLI `era check --json`.

Dependency/library diagnostics remain on their own files and are not falsely
rebound to the primary `.era` source.

## Architecture review

PASS.

One coordinate map is derived from the exact deterministic `SourceEdit[]`
produced by the v0.11 frontend.

The same mapping foundation is consumed by:

```text
SourceEdit[]
  -> transformed TypeScript
  -> EraSourceCoordinateMap
       -> TypeScript diagnostic remapper
       -> Web3 location resolver
       -> unsafe audit location/id
       -> CLI JSON through typecheck()
```

The public `transformEraScript()` API remains exactly
`{ code, features }`; mapping details are exposed only by the detailed
frontend path.

No new runtime dependency was introduced.

## Correctness review

PASS.

Regression coverage includes:

- unchanged spans,
- replacement left/right bias,
- semantic anchors for generated tokens,
- multiple length-changing edits,
- UTF-16/emoji offsets,
- nullable generated text,
- template interpolation,
- diagnostics after earlier lowering,
- related TypeScript diagnostic information,
- dependency-file non-remapping,
- CLI JSON output.

A review finding during implementation showed that return-arrow lowering may
absorb preceding whitespace. Mapping the generated `:` to the full edit range
would incorrectly point diagnostics at whitespace. Replacement segments
therefore support an explicit semantic original anchor, and return-arrow
lowering anchors to the original `->` token.

## Backward-compatibility review

PASS.

- ordinary TypeScript compatibility remains unchanged,
- public transform result shape remains unchanged,
- existing diagnostic codes/kinds/messages remain unchanged apart from
  corrected primary filename/location,
- Web3/multichain runtime semantics are unchanged,
- v0.2-v0.11 regression corpus remains green inside the 197-test release run.

## AI-first safety review

PASS.

`era check --json` now provides stable original-source coordinates suitable
for deterministic repair loops. AI agents no longer need to infer an offset
delta from generated TypeScript.

Unsafe-boundary audit IDs now use the same original source coordinates as their
visible diagnostics, preventing report/audit identity drift caused by frontend
lowering.

## Security review

PASS / no new secret surface.

The source map stores offsets and source ranges only. It does not introduce
secret persistence, network access, signing authority, or runtime execution.

## Out-of-scope confirmation

The following remain intentionally outside v0.12:

- generated JavaScript sourcemap composition back to `.era`,
- debugger/stack-trace remapping,
- multi-file EraScript module-resolution redesign,
- new grammar such as Result/match/postfix-?/rescue DSL.

These are follow-on work, not release defects.

## Final decision

APPROVED.

Issue #8 requirements are satisfied at EraScript v0.12.0 baseline
`b8c63e0ec0867a6d7870d2df6ebacdc684cd073d`, with Core CI run 392 green at
197/197 tests.
