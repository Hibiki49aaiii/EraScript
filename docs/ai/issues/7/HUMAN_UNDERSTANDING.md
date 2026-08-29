# Issue #7 — Human Understanding

## What changes

EraScript currently finds words like `fn` and `mut` and replaces them almost everywhere outside basic strings/comments.

v0.11 changes that into a small real frontend.

Instead of asking:

> Does the source contain the text `fn`?

EraScript will ask:

> Is this token actually being used as the EraScript function keyword?

## Why this matters

Ordinary TypeScript allows identifiers such as:

```ts
obj.fn
const fn = 1
const object = { fn() {} }
```

Those are not EraScript syntax and must never be changed.

The same problem applies to `mut`.

This becomes more important as AI writes more code: an AI may use perfectly valid TypeScript identifiers that accidentally collide with EraScript surface keywords.

## New mental model

```text
ordinary TS text
     |
     | no recognized Era construct
     v
passes through unchanged

Era construct
     |
     v
small source edit
     |
     v
valid TypeScript
```

EraScript is not trying to parse all TypeScript itself.

TypeScript still performs the real semantic parse/typecheck/emission after Era-specific surface syntax has been lowered.

## Example

Input:

```era
const object = {
  fn() { return "typescript method" }
}

pub fn greet(name: string) -> string {
  mut message = `hello ${name}`
  return message
}

console.log(object.fn(), greet("Era"))
```

Expected lowering:

```ts
const object = {
  fn() { return "typescript method" }
}

export function greet(name: string): string {
  let message = `hello ${name}`
  return message
}

console.log(object.fn(), greet("Era"))
```

Only the Era-owned syntax changes.

## Template literals

Raw text is never syntax:

```ts
`fn mut -> User?`
```

But interpolation is executable code and must be scanned as code:

```era
`${fn(x: number) -> number { return x }}`
```

The raw template part stays untouched while the expression can lower Era syntax.

## Safety rule

If the frontend is unsure whether a token is EraScript syntax or an ordinary TypeScript identifier, it leaves it alone.

False negatives are preferable to silently corrupting valid TypeScript.

## What v0.11 does not add

It does not yet add:
- `match`,
- `Result`,
- postfix propagation `?`,
- Web3 DSL grammar,
- rescue syntax.

It creates the safe frontend foundation those features require later.
