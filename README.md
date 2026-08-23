# EraScript

**EraScript is a TypeScript-compatible language that keeps the JavaScript ecosystem while making common code clearer and safer.**

EraScript v0.1 is intentionally small: normal TypeScript is valid EraScript, and a thin compiler adds ergonomic syntax before using the TypeScript compiler pipeline.

## Example

```era
pub fn greet(name: string) -> string {
  mut message = "Hello"
  message += ", " + name + "!"
  return message
}

console.log(greet("EraScript"))
```

EraScript transpiles the extensions to TypeScript:

```ts
export function greet(name: string): string {
  let message = "Hello"
  message += ", " + name + "!"
  return message
}
```

and then emits standard JavaScript.

## v0.1 syntax

| EraScript | TypeScript meaning |
|---|---|
| `fn name()` | `function name()` |
| `pub fn name()` | `export function name()` |
| `mut x = 1` | `let x = 1` |
| `fn f() -> T` | `function f(): T` |
| `T?` in simple annotations | `T \| null \| undefined` |

Everything else can be ordinary TypeScript.

## CLI

```bash
npm install
npm run build

node dist/src/cli.js check examples/hello.era
node dist/src/cli.js transpile examples/hello.era
node dist/src/cli.js build examples/hello.era -o build/hello.js
node dist/src/cli.js run examples/hello.era
```

After linking/installing the package, both commands are available:

```bash
era run app.era
erascript check app.era
```

Create a starter project:

```bash
era init my-app
```

## Design principles

1. **TypeScript compatibility first.** Existing npm packages and TypeScript knowledge remain useful.
2. **No new runtime unless a feature truly needs one.** EraScript should compile to ordinary JavaScript.
3. **Safety features must be machine-checkable.** Future Web3/finance features should reject invalid states at compile time instead of being syntax sugar only.
4. **Incremental language growth.** Stabilize a small grammar before adding match expressions, Result propagation, units, chain-aware addresses, or contract targets.

## Architecture

```text
.era source
   |
   v
EraScript lexical transform (v0.1)
   |
   v
TypeScript source
   |
   +--> TypeScript semantic checking
   |
   v
TypeScript emitter
   |
   v
JavaScript
```

The lexical transformer is deliberate for v0.1. A dedicated lexer/parser/AST can replace it once the surface syntax is stable without breaking TypeScript compatibility.

## Roadmap

### v0.1 — bootstrap
- TypeScript compatibility
- `fn`, `pub fn`, `mut`, return arrows
- simple nullable type syntax
- CLI: `build`, `run`, `check`, `transpile`, `init`
- semantic TypeScript checking
- CI and tests

### v0.2 — real EraScript AST
- source locations and EraScript-native diagnostics
- parser + AST instead of lexical rewriting
- exhaustive `match`
- immutable bindings by default with explicit mutation semantics
- formatter groundwork

### v0.3 — explicit error model
- `Result<T, E>` syntax
- `?` propagation with compile-time validation
- checked async/error effects

### v0.4 — Web3 safety layer
- `Address<Chain>` and `Hash<Chain>`
- chain-aware literals
- `Wei`, token decimals, exact decimal quantities
- compiler diagnostics for cross-chain/cross-unit misuse
- first-class compatibility with viem/ethers-style APIs

## Status

EraScript is experimental and the language grammar is not stable yet.
