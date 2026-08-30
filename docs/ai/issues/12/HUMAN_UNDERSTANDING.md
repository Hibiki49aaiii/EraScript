# Issue #12 Human Understanding

## What

v0.15 removes the hidden module-resolution regression introduced by executing generated JavaScript from an OS temporary directory.

EraScript should keep the original project file URL as the runtime identity of a module. Node should continue resolving ordinary JavaScript and npm packages exactly as it normally would, while EraScript only intercepts explicit `.era` modules.

## Why

The v0.14 runtime stack mapping is correct, but the temporary runtime location changes Node's resolution base.

That is unacceptable for a language whose compatibility promise is:

```text
ordinary Node.js / TypeScript project
        +
EraScript safety semantics
```

The correct boundary is therefore a loader, not a copied runtime tree.

## How

```text
era run src/main.era
        |
        v
Node --import loader registration
        |
        v
original file:///project/src/main.era
        |
        +-- .era  -> EraScript loader compile + inline source map
        +-- .js   -> Node default loader
        +-- npm   -> Node default resolver
```

Type checking uses a separate project-aware TypeScript CompilerHost. It virtualizes each explicit `.era` module as TypeScript for the checker but retains a per-file original-source coordinate map.

## Compatibility Invariants

- explicit single-file CLI usage keeps working,
- public `typecheck(source, fileName)` remains source-compatible,
- ordinary JS/npm resolution is delegated to Node/TypeScript,
- only explicit relative `.era` imports are newly intercepted,
- runtime source maps still point to original `.era`,
- no dependency is added,
- execution status and `--` arguments remain unchanged.

## Intentional Boundary

v0.15 stabilizes **run/check module semantics** first.

Standalone multi-file `era build` output is intentionally deferred because it requires a separate emitted module graph, import-specifier rewriting, and output layout contract. Mixing that into the runtime-loader change would make rollback and source-map verification unnecessarily broad.
