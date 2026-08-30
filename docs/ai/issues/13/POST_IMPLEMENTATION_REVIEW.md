# Issue #13 Post-Implementation Review

Status: **APPROVED**

## Scope reviewed

v0.16 multi-file EraScript project emission from `era.json`.

Base commit:

`74cbbe0de7bb601ab619d00e55288bf2fb7fcf54`

Final verified code baseline:

`61f6a0127421cbff8dcbf4660c1b87f774a864b5`

## Relevant implementation commits

- `94ffd743492dd9f3b084f3cda874a5d6e08ef2b6` — multi-file project emitter
- `221c1220ebc1198fead77f08a2f934e4aeacc317` — validated project config exposure
- `cb1e72a32e226bcd457ee076ded521cfff8df9fd` — CLI project build mode
- `11412b5996011a649de19fc9cb701e5d60262adb` — project build regression suite
- `bdb44204ec3631ad3bd4ca3bbc290e1196b9f1e6` / `a0a89f28a48779a4606ea6cd771d3078674369bf` — v0.16 release metadata
- `33733dd82c9dc3760cf7c9401e2be4a0cf8bf0aa` — npm-generated v0.16 lock metadata
- `61f6a0127421cbff8dcbf4660c1b87f774a864b5` — temporary workflow removal / final code baseline

## Correctness — PASS

The builder emits one `.mjs` file per reachable explicit relative EraScript module and preserves project-relative layout.

Visited-set traversal handles cycles without duplicate emission.

The configured entry is checked with the v0.15 project-aware type checker before emission.

## Runtime compatibility — PASS

Built output runs under plain Node.

Bare npm imports remain unchanged.

Direct project-local runtime assets are copied rather than bundled.

Legacy explicit single-file build remains unchanged.

## Source maps — PASS

Each EraScript module receives its own composed map.

`.era -> .mjs` module-specifier rewriting is syntax-aware and equal-length.

Regression coverage confirms an exception thrown in an imported built module maps back to the original imported `.era` source line.

## Security — PASS

Project-relative module and asset paths are checked against project root.

Output paths are checked against `outDir`.

Root-escaping EraScript imports fail closed before output is emitted.

The builder does not recursively copy the project tree.

## Architecture — PASS

No bundler was introduced.

The implementation reuses:

- existing EraScript frontend transform,
- existing compiler/source-map composition,
- v0.15 project configuration,
- native Node/npm runtime package resolution.

This keeps EraScript as a compiler/runtime layer rather than creating a second package manager or bundler.

## Regression — PASS

Core CI #430 / run ID `33287995667`:

```text
Node: 22.23.2
npm: 10.9.8
npm ci: PASS
npm run check: PASS
npm run test:core: PASS
tests: 216
pass: 216
fail: 0
```

## Maintainability — PASS

Project emission is isolated in `src/project-build.ts`.

CLI orchestration remains thin.

No new runtime dependency was introduced.

## Remaining limitation

Project build currently copies only **direct static local runtime assets referenced from EraScript modules**. It is intentionally not a general JavaScript bundler/copy crawler.

If a copied JavaScript module itself imports additional local JavaScript assets, those remain the user's normal Node project responsibility unless a later issue explicitly broadens the project asset graph.

## Decision

**APPROVED. Issue #13 acceptance criteria are satisfied.**
