# Issue #13 Pre-Implementation Review

Status: **APPROVED TO IMPLEMENT**

## Requirements review

Project mode is deliberately opt-in via omitted build file, preserving existing CLI behavior.

OutDir must never be used as a path-escape target.

## Architecture review

Selected: emit one `.mjs` + map per EraScript module, preserving project-relative paths.

Rejected: bundling. It would change npm/runtime semantics and add unnecessary dependency/toolchain scope.

Rejected: emitting `.js` plus synthetic package.json. `.mjs` gives an unambiguous ESM contract without mutating project package semantics.

## Source-map review

Only module-specifier extensions are rewritten and `.era` / `.mjs` are equal length. Syntax-aware node positions ensure ordinary string contents are not modified.

## Security review

The graph follows only explicit relative EraScript imports.

Every emitted/copied project-local path is checked to remain under project root and mapped under outDir.

The builder copies referenced assets only, not the entire project.

**APPROVED TO IMPLEMENT.**
