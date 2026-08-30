# Issue #12 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

## Pass 1 — Requirements

### Finding: runtime and checker must agree on explicit `.era` graph semantics

Disposition: adopted.

Both paths support explicit relative `.era` specifiers. Extensionless inference is excluded.

### Finding: project config must never override an explicit CLI file

Disposition: adopted.

Explicit file argument has precedence. `era.json` is only a fallback when the file argument is absent.

### Finding: imported diagnostics need original-file identity, not only correct coordinates

Disposition: adopted.

Each transformed module has its own original filename/source/coordinate map.

## Pass 2 — Architecture

### Option A: keep temp runtime and emulate/copy project modules

Rejected.

It duplicates Node resolution semantics, complicates Windows behavior, and risks copying project files/secrets into staging.

### Option B: write generated files beside original sources

Rejected.

It preserves resolution but mutates the user's working tree and can leak artifacts after process termination.

### Option C: Node ESM loader over original `.era` URLs

Selected.

It preserves native Node module location and delegates all non-Era resolution unchanged.

## Pass 3 — Risk

### Node hook support

Use `module.register()`, available in the supported Node 20+ generation. Core CI on Node 22 is the authoritative verification environment.

### Loader source maps

Use the existing composed Source Map V3 output and inline it. Do not add another mapping implementation.

### Cycles

The loader itself has no custom graph traversal, so Node owns runtime cycles. TypeScript owns checker graph cycles through CompilerHost resolution.

### Security

The loader intercepts file URLs ending only in `.era`. All other loading is delegated unchanged.

## Decision

**APPROVED TO IMPLEMENT.**
