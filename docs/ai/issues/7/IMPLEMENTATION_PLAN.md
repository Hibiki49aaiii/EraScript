# Issue #7 — Implementation Plan

Issue: #7  
Release target: EraScript `0.11.0`  
Base Commit SHA: `edb24a94430171ea2909dc2723a93da5de132b72`  
Target branch: `main`

## Goal

Replace the v0.1 global lexical transformer with a conservative source-preserving frontend that recognizes only EraScript-owned syntax and leaves ordinary TypeScript untouched.

## Current failure surface

The current implementation rewrites identifier text without syntax context.

Examples that must stop changing:

```ts
obj.fn
obj.mut
const fn = 1
function use(mut: number) {}
const value = { fn() {}, mut: 1 }
class C { fn() {} mut = 1 }
```

The current nullable regex also operates after lexical transformation rather than from syntax-aware code spans.

Template literal raw text is protected, but EraScript inside `${...}` is not recursively transformed.

## Selected architecture

```text
source
  -> lexer/protected-span scanner
  -> surface parser
  -> EraSurfaceNode[]
  -> SourceEdit[]
  -> validate non-overlap
  -> apply edits right-to-left
  -> TypeScript source
```

The TypeScript compiler remains the semantic parser/checker/emitter after EraScript surface lowering.

### Why source edits

Rejected: reprinting a complete custom AST.

Reasons:
- formatting would change ordinary TypeScript,
- comments/trivia would be harder to preserve,
- source mapping drift would worsen,
- EraScript currently owns only a small surface grammar.

Selected:
- original offsets remain authoritative,
- only recognized Era constructs generate edits,
- no edit means byte-for-byte pass-through.

## Lexer responsibilities

`src/frontend/lexer.ts`

Produce source-preserving tokens/segments with offsets.

Required categories:

- identifier,
- punctuation/operator,
- whitespace,
- number/other code token,
- line comment,
- block comment,
- single/double quoted string,
- template raw segment,
- template interpolation boundary.

Template interpolation bodies are recursively lexed as code, including nested templates.

Protected text never generates Era syntax tokens.

## Surface AST

`src/frontend/ast.ts`

Minimal nodes only:

- `EraFunctionKeywordNode`
- `EraPublicModifierNode`
- `EraMutableBindingNode`
- `EraReturnTypeArrowNode`
- `EraNullableTypeNode`

Each node records original source range and enough context for one lowering edit.

No runtime/Web3 AST belongs here.

## Parser rules

`src/frontend/parser.ts`

### fn

Recognize:

```era
fn name(...)
async fn name(...)
pub fn name(...)
pub async fn name(...)
const f = fn(...)
return fn(...)
```

Do not recognize:

```ts
obj.fn
obj?.fn
const fn = 1
{ fn() {} }
class C { fn() {} }
function f(fn: number) {}
```

Conservative rule:
- named form `fn IDENT (` can be recognized unless member-access/property context proves it is ordinary TS,
- anonymous form `fn (` is recognized only in expression-prefix contexts such as `=`, `(`, `[`, `,`, `return`, `=>`,
- object/class method-shaped `fn(` after body/member boundaries is passed through.

### pub

Recognize only when it directly modifies a recognized Era function declaration with optional `async`.

### mut

Recognize only declaration-shaped `mut <binding>`.

Supported:
- `mut x =`
- `mut { a } =`
- `mut [a] =`
- `for (mut i = ...)`

Do not transform identifier/property/parameter use.

### return arrow

Transform `->` only after the closing parameter paren belonging to a recognized Era function node.

### nullable suffix

Recognize the existing simple nullable type feature only in a type span introduced by:
- a TypeScript annotation colon, or
- a recognized Era return arrow.

Do not treat optional property marker `name?:` as nullable.

The v0.11 parser is intentionally conservative; new type grammar is out of scope.

## Edit model

`src/frontend/apply-edits.ts`

```ts
interface SourceEdit {
  start: number
  end: number
  replacement: string
  feature: string
}
```

Rules:
- ranges are original-source offsets,
- zero/negative/overlapping invalid edits throw internal frontend errors,
- stable sort by start/end,
- apply right-to-left,
- feature set is deduplicated + sorted.

Expected lowerings:
- `fn` -> `function`
- `pub` -> `export`
- `mut` -> `let`
- `->` -> `:`
- nullable `?` -> ` | null | undefined`

## Compatibility strategy

The compatibility contract is tested before adding future syntax.

Corpus includes:
- property/member names,
- object/class methods,
- parameter/local names,
- strings/comments,
- raw template text,
- template interpolation code,
- arrow functions,
- optional properties,
- nested generic nullable types,
- ordinary TypeScript source byte equality.

## Pre-Implementation Review

### Requirements — PASS

The scope is correctly limited to existing v0.1 syntax plus compatibility hardening.

No new language semantics are required.

### Architecture — PASS

A source-edit frontend is preferable to:
- regex expansion,
- global keyword rewriting,
- full AST pretty-printing,
- a duplicate TypeScript parser.

TypeScript remains semantic Source of Truth after lowering.

### Risk — PASS with safeguards

Highest risks:
1. template interpolation nesting,
2. object/class method false positives,
3. nullable ambiguity,
4. overlapping edits.

Required safeguards:
- recursive template code scanning,
- conservative `fn` recognition,
- explicit nullable annotation context,
- edit overlap validator,
- adversarial regression suite,
- full Core CI before version promotion.

## Implementation order

1. AST/edit types.
2. edit validator/applier.
3. lexer/protected spans.
4. parser for `fn/pub/mut/->`.
5. nullable parser.
6. transform facade migration.
7. compatibility tests.
8. compiler/typecheck tests.
9. post-implementation review.
10. documentation + `0.11.0` promotion.
11. final Core CI.
12. Issue #7 closure.

## Rollback

`transformEraScript()` remains the public boundary.

If the new frontend fails validation, the commit can be reverted without Web3/runtime state migration.

No persisted data format changes are involved.
