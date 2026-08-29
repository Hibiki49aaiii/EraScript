# Issue #10 Post-Implementation Review

Status: **APPROVED**

## Scope reviewed

Issue #10 / EraScript v0.14 remaps `era run` runtime stack traces from generated temporary JavaScript back to the original `.era` source using the composed v0.13 Source Map V3 output and Node's built-in source-map support.

Base commit:

`74b9ad675b52feee9c0ef55788993e6002e0632e`

Verified release baseline:

`0dba932baf25078369aff7cce68e9e3cedf2bc35`

## Implementation evidence

Relevant implementation chain:

- `93e8f41118b22921ac81dd5766d3db53f32ee605` — enable composed runtime source maps in `era run`
- `cae173c8289dc8c328ecedbf7901f336081b7fd6` — fail-safe temporary artifact cleanup
- `859a71e9fce5c75981e071c5002acbcbc3ef572f` — runtime stack/argument/exit/cleanup regressions
- `20cf85e357237513461a6784eaeeb117f9c6146c` — v0.14 implementation documentation
- `0eb65f465edcd4883d1df36452a52621f47fa64e` / `0dba932baf25078369aff7cce68e9e3cedf2bc35` — v0.14 release baseline/version alignment

Runtime behavior now:

```text
original .era
  -> compile(sourceMap: true, outputFileName: main.mjs)
  -> temp/main.mjs + temp/main.mjs.map
  -> node --enable-source-maps temp/main.mjs [args]
  -> original .era runtime frame
  -> child exits
  -> finally cleanup
  -> parent preserves child status
```

## Verification evidence

GitHub Actions Core CI:

- Run: **#406**
- Run ID: `33255938468`
- Head: `0dba932baf25078369aff7cce68e9e3cedf2bc35`
- Node: `22.23.2`
- Conclusion: **success**

Successful steps:

- `npm install` — PASS
- `npm run check` — PASS
- `npm run test:core` — PASS
- TypeScript build — PASS
- tests: **206**
- pass: **206**
- fail: **0**

The new `test/cli-run-sourcemap.test.ts` verifies:

- thrown runtime errors contain the original absolute `.era` path,
- the throw resolves to the original EraScript line after emoji/template/`fn`/return-arrow/`mut` lowering,
- arguments after `--` remain exact,
- normal exit remains successful,
- `process.exit(7)` remains exit status 7,
- temporary `erascript-*` runtime directories do not leak after success or failure.

## Review

### Correctness — PASS

The implementation consumes the existing v0.13 composed map instead of inventing a second remapping path. The map is written before child launch and remains available until the child exits. Missing requested source-map output fails closed.

### Regression — PASS

The full deterministic core suite passes 206/206. CLI argument forwarding and exit-status behavior are covered explicitly.

### Architecture — PASS

Node's built-in `--enable-source-maps` is used. No custom stack parser, runtime mapping dependency, or duplicate source-coordinate implementation was added.

### Security — PASS WITH NON-BLOCKING FOLLOW-UP

Issue #10 adds no dependency and no secret-handling path.

The CI `npm install` output reports **67 existing dependency audit findings (16 low, 28 moderate, 20 high, 3 critical)**, largely within the existing transitive dependency tree. These were not introduced by v0.14 and do not invalidate the runtime-stack implementation, but dependency-security remediation should be tracked separately rather than silently ignored.

### Maintainability — PASS

The runtime lifecycle is localized in `src/cli.ts`, regression behavior is isolated in a dedicated CLI test, and the implementation reuses compiler/source-map contracts already established in v0.13.

### Dead code / stale docs — PASS

No unused runtime abstraction was introduced. v0.14 documentation matches the implemented runtime flow.

## Remaining limitations

Intentionally out of scope:

- Node inspector/debugger protocol integration
- browser DevTools
- custom stack formatting
- bundler source-map composition
- multi-file EraScript module resolution
- source-mapped dynamic/eval-generated modules

## Decision

**APPROVED. Issue #10 acceptance criteria are satisfied on Core CI run #406.**
