import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../src/compiler.js";
import { typecheck } from "../src/typecheck.js";

test("compiles EraScript into runnable JavaScript", () => {
  const input = `fn add(a: number, b: number) -> number { return a + b }\nconsole.log(add(2, 3))`;
  const result = compile(input, { sourceMap: false });
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.javascript, /function add/);
  assert.match(result.javascript, /console\.log\(add\(2, 3\)\)/);
});

test("typecheck catches TypeScript semantic errors after transformation", () => {
  const input = `fn value() -> number { return "wrong" }`;
  const result = typecheck(input, "value.era");
  assert.ok(result.diagnostics.length > 0);
});
