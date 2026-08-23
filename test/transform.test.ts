import assert from "node:assert/strict";
import test from "node:test";
import { transformEraScript } from "../src/transform.js";

test("transforms core EraScript syntax", () => {
  const input = `pub fn greet(name: string) -> string {\n  mut message = "hello"\n  return message + name\n}`;
  const result = transformEraScript(input);
  assert.match(result.code, /export function greet\(name: string\): string/);
  assert.match(result.code, /let message/);
  assert.deepEqual(result.features, ["fn", "mut", "pub", "return-arrow"]);
});

test("does not transform keywords inside strings or comments", () => {
  const input = `// fn mut ->\nconst text = "fn mut ->"\nfn real() -> void {}`;
  const result = transformEraScript(input);
  assert.match(result.code, /\/\/ fn mut ->/);
  assert.match(result.code, /"fn mut ->"/);
  assert.match(result.code, /function real\(\): void/);
});

test("transforms simple nullable annotations", () => {
  const input = `fn find() -> User? { return undefined }\nconst value: User? = undefined`;
  const result = transformEraScript(input);
  assert.match(result.code, /function find\(\): User \| null \| undefined/);
  assert.match(result.code, /value: User \| null \| undefined/);
  assert.ok(result.features.includes("nullable-type"));
});

test("ordinary TypeScript passes through", () => {
  const input = `interface User { id: number }\nconst user: User = { id: 1 }`;
  assert.equal(transformEraScript(input).code, input);
});
