import assert from "node:assert/strict";
import test from "node:test";
import { applySourceEdits, EraFrontendInvariantError, validateSourceEdits } from "../src/frontend/apply-edits.js";
import { lowerSurfaceNode } from "../src/frontend/ast.js";
import { lexEraScript } from "../src/frontend/lexer.js";
import { parseEraSurface } from "../src/frontend/parser.js";
import { compile } from "../src/compiler.js";
import { transformEraScript } from "../src/transform.js";
import { typecheck } from "../src/typecheck.js";

test("ordinary TypeScript identifiers named fn/mut pass through byte-for-byte", () => {
  const input = String.raw`const fn = () => 1
const mut = 2
const object = {
  fn() { return fn() },
  mut: 3,
}
class Example {
  fn() { return object.fn() }
  mut = object.mut
}
function use(fn: number, mut: number) {
  return fn + mut
}
const called = fn()
const member = object.fn()
const optional = object?.fn()
interface Shape {
  fn: () => number
  mut?: number
}
const re = /fn mut -> User\?/
const text = "fn mut -> value: User?"
`;

  assert.equal(transformEraScript(input).code, input);
});

test("existing Era function/declaration syntax lowers contextually", () => {
  const input = `pub async fn greet(name: string) -> Promise<User>? {
  mut message: string = "hello " + name
  for (mut i = 0; i < 1; i++) {
    message += "!"
  }
  return Promise.resolve({} as User)
}

const twice = fn(value: number) -> number {
  return value * 2
}
`;

  const result = transformEraScript(input);
  assert.match(result.code, /export async function greet\(name: string\): Promise<User> \| null \| undefined/);
  assert.match(result.code, /let message: string/);
  assert.match(result.code, /for \(let i = 0/);
  assert.match(result.code, /const twice = function\(value: number\): number/);
  assert.deepEqual(result.features, ["fn", "mut", "nullable-type", "pub", "return-arrow"]);
});

test("fn call expressions and object/class methods are not mistaken for anonymous Era functions", () => {
  const input = `const fn = (value: number) => value
const result = fn(1)
const object = { fn() { return 2 } }
class C { fn() { return 3 } }
`;
  assert.equal(transformEraScript(input).code, input);
});

test("object methods after commas remain TypeScript while array comma can start an Era function expression", () => {
  const objectInput = `const object = {
  first: 1,
  fn() { return 2 },
  async fn() { return 3 },
}
`;
  assert.equal(transformEraScript(objectInput).code, objectInput);

  const eraInput = `const values = [0, fn(value: number) -> number { return value + 1 }]
`;
  const lowered = transformEraScript(eraInput);
  assert.match(lowered.code, /\[0, function\(value: number\): number \{ return value \+ 1 \}\]/);
});

test("valid Era function expressions remain supported across TypeScript expression prefixes", () => {
  const input = `declare const condition: boolean
const logical = condition && fn(value: number) -> number { return value }
const unary = !fn() -> boolean { return false }
export default fn(value: number) -> number { return value + 1 }
`;
  const result = transformEraScript(input);
  assert.match(result.code, /condition && function\(value: number\): number/);
  assert.match(result.code, /!function\(\): boolean/);
  assert.match(result.code, /export default function\(value: number\): number/);
});

test("template raw text is protected while interpolation bodies are parsed as code", () => {
  const input = "const value = `raw fn mut -> User? :: ${fn(x: number) -> number { return x + 1 }}`";
  const result = transformEraScript(input);
  assert.match(result.code, /`raw fn mut -> User\? :: \$\{function\(x: number\): number \{ return x \+ 1 \}\}`/);
  assert.deepEqual(result.features, ["fn", "return-arrow"]);
});

test("nested template interpolation remains source-preserving outside Era edits", () => {
  const input = "const value = `outer ${`inner ${fn(x: number) -> number { return x }}`}`";
  const result = transformEraScript(input);
  assert.match(result.code, /outer \$\{`inner \$\{function\(x: number\): number \{ return x \}\}`\}/);
});

test("nullable lowering does not inspect strings comments raw templates or optional properties", () => {
  const input = `// value: User?
const text = "value: User?"
const template = \`value: User?\`
interface Example {
  optional?: User
  value: User?
}
const actual: Map<string, User>? = undefined
`;
  const result = transformEraScript(input);
  assert.match(result.code, /\/\/ value: User\?/);
  assert.match(result.code, /"value: User\?"/);
  assert.match(result.code, /`value: User\?`/);
  assert.match(result.code, /optional\?: User/);
  assert.match(result.code, /value: User \| null \| undefined/);
  assert.match(result.code, /Map<string, User> \| null \| undefined/);
});

test("mut-like text inside a control-following regex is never lowered", () => {
  const input = `if (true) /mut x=/.test("mut x=")\n`;
  assert.equal(transformEraScript(input).code, input);
});

test("unrecognized arrow-like syntax is never globally rewritten", () => {
  const input = "const text = a -> b";
  assert.equal(transformEraScript(input).code, input);
});

test("parser edits are deterministic sorted and non-overlapping", () => {
  const source = "pub fn value(input: User?) -> User? { mut result = input; return result }";
  const firstNodes = parseEraSurface(source, lexEraScript(source));
  const secondNodes = parseEraSurface(source, lexEraScript(source));
  assert.deepEqual(firstNodes, secondNodes);

  const edits = firstNodes.map(lowerSurfaceNode);
  const validated = validateSourceEdits(source, edits);
  assert.deepEqual(validated, [...validated].sort((a, b) => a.start - b.start || a.end - b.end));
  assert.equal(applySourceEdits(source, edits), transformEraScript(source).code);
});

test("source edit validator rejects overlapping frontend edits", () => {
  assert.throws(
    () => validateSourceEdits("abcdef", [
      { start: 1, end: 4, replacement: "x", feature: "fn" },
      { start: 3, end: 5, replacement: "y", feature: "mut" },
    ]),
    EraFrontendInvariantError,
  );
});

test("compiler and typecheck use the new frontend without breaking TypeScript members", () => {
  const input = `const object = { fn() { return 2 }, mut: 3 }
fn add(a: number, b: number) -> number { return a + b + object.fn() + object.mut }
console.log(add(1, 2))
`;

  const compiled = compile(input, { sourceMap: false });
  assert.equal(compiled.diagnostics.length, 0);
  assert.match(compiled.javascript, /object\.fn\(\)/);

  const checked = typecheck(input, "frontend.era");
  assert.equal(checked.diagnostics.length, 0);
});
