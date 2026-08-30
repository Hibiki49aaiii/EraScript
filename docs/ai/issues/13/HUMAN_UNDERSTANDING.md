# Issue #13 Human Understanding

v0.15 established the runtime/check module contract. v0.16 makes project builds follow the same explicit module graph.

Project mode is selected only by `era build` with no file. Existing explicit single-file build remains unchanged.

The project build must emit a plain-Node ESM graph under `era.json.outDir` without requiring the EraScript runtime loader.

Key invariant: `.era -> .mjs` is a same-length extension rewrite, so syntax-aware replacement of module specifier text does not shift source-map columns.

Only statically referenced project-local runtime assets are copied. The builder must not copy the whole project tree.
