# EraScript v0.11 — Parser/AST Frontend

Status: release candidate — final version baseline pending

Issue: #7

Base revision:

```text
edb24a94430171ea2909dc2723a93da5de132b72
```

## 1. Purpose

v0.11 replaces the original v0.1 lexical keyword/regex transformer with a conservative, source-preserving frontend.

Design rule:

> Parse EraScript-owned syntax. Pass ordinary TypeScript through unchanged.

The runtime/security layers had advanced far beyond the language surface. The old transformer could rewrite ordinary TypeScript identifiers such as `obj.fn` and `obj.mut`, globally rewrite `->`, and apply nullable regex logic without syntax-aware protected regions.

## 2. Architecture

```text
.era source
   |
   v
source-preserving lexer
   |
   v
context-aware Era surface parser
   |
   v
surface AST nodes
   |
   v
deterministic original-offset edits
   |
   v
TypeScript-compatible source
   |
   +--> TypeScript semantic checker / Web3 analysis
   |
   v
TypeScript emitter
```

Implementation modules:

- `src/frontend/lexer.ts`
- `src/frontend/ast.ts`
- `src/frontend/parser.ts`
- `src/frontend/apply-edits.ts`
- `src/transform.ts` remains the public compatibility facade.

No new runtime dependency is introduced.

## 3. Source preservation

The lexer records exact source offsets and distinguishes:

- identifiers
- numbers
- punctuation
- whitespace
- comments
- strings
- regex literals
- template raw spans
- template-expression boundaries

Only recognized EraScript surface nodes create edits.

Edits use original-source offsets, are validated as non-overlapping, then applied right-to-left. Ordinary source outside an EraScript edit is not reformatted or reprinted.

## 4. v0.1 syntax retained

The parser recognizes the existing small Era surface:

- `fn name(...)`
- context-valid anonymous `fn(...)` expressions
- `pub fn`
- `pub async fn`
- `mut <binding>`
- Era function return arrow `-> Type`
- simple nullable annotation suffix `T?`

Examples:

```era
pub async fn load(id: string) -> Promise<User>? {
  mut user = await find(id)
  return user
}
```

lowers without whole-file reprinting.

## 5. TypeScript compatibility boundary

The following are deliberately pass-through:

```ts
obj.fn
obj.mut

const fn = () => 1
const mut = 2

const object = {
  fn() {},
  mut: 1,
}

class Example {
  fn() {}
  mut = 1
}

interface Shape {
  fn: () => void
  mut?: number
}
```

Object/class methods are distinguished from Era anonymous functions, including methods appearing after object-property commas.

Valid Era function expressions continue to work in expression positions such as:

- variable initializer RHS
- call arguments
- array elements
- conditional branches
- logical/operator RHS
- unary expression operand
- `return` / `throw` / `yield` / `await`
- `export default fn(...)`

Ambiguous contexts fail closed to TypeScript pass-through.

## 6. Template literals

Template raw text is protected:

```ts
`raw fn mut -> User?`
```

but `${...}` expression bodies are recursively scanned as code:

```era
`value: ${fn(x: number) -> number { return x + 1 }}`
```

Nested template expressions preserve the same rule.

## 7. Regex protection

v0.11 treats regex literals as protected syntax rather than letting Era keywords inside a pattern reach the surface parser.

Post-Implementation Review found an important lexical edge:

```ts
if (condition) /fn(x)->number{1}/.test(input)
```

A slash following a control-header closing parenthesis can begin a regex expression statement even though a generic previous-token heuristic would normally classify slash after `) ` as division.

The lexer now detects `if/while/for/with (...)` control headers and keeps the following regex literal protected. `else` and `do` statement positions are also regex-start contexts.

## 8. Nullable safety

Nullable lowering is limited to supported annotation/return-type contexts.

Protected or incompatible syntax is not rewritten:

- strings
- comments
- template raw text
- regex literals
- optional property marker `name?: T`
- unrelated question/conditional syntax

The v0.1 supported simple-type envelope is retained rather than pretending to parse the full TypeScript type grammar.

## 9. Deterministic edit model

Surface nodes currently include:

- `function-keyword`
- `public-modifier`
- `mutable-binding`
- `return-type-arrow`
- `nullable-type`

Each node lowers to one source edit.

The edit validator rejects:

- unsafe/non-integer offsets
- out-of-range edits
- empty/inverted edits
- overlapping edits

Feature reporting remains deterministic and sorted.

## 10. Compiler/typecheck compatibility

`transformEraScript()` retains:

```ts
{
  code: string
  features: string[]
}
```

The compiler and typechecker continue to consume transformed TypeScript without a new frontend-facing API requirement.

The v0.11 compatibility suite directly runs both `compile()` and `typecheck()` over source containing Era syntax plus ordinary TypeScript members named `fn`/`mut`.

## 11. Verification

Confirmed checkpoint before final Post-Review hardening:

```text
Core CI run 369
npm run check      PASS
npm run test:core  PASS
183 tests / 183 passed / 0 failed
```

Post-Review added two further regression classes after run 369:

1. valid Era function expressions across additional TypeScript expression prefixes,
2. regex literals after control headers containing Era-like text.

Final release CI evidence will be recorded here after those regressions and the v0.11.0 version baseline are green.

## 12. Deliberately out of scope

v0.11 does not add:

- a full independent TypeScript parser
- `match`
- `Result<T,E>`
- postfix `?`
- rescue/contract DSL syntax
- original-source sourcemap remapping
- multi-file `.era` module-resolution redesign

The frontend boundaries introduced here are intended to make those later grammar additions possible without returning to global lexical replacement.
