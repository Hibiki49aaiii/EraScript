import assert from "node:assert/strict";
import test from "node:test";
import { transformEraScriptDetailed } from "../src/frontend/transform.js";
import { transformEraScript } from "../src/transform.js";

test("public transform result keeps the exact code/features shape", () => {
  const result = transformEraScript("fn value() -> number { return 1 }");
  assert.deepEqual(Object.keys(result).sort(), ["code", "features"]);
});

test("coordinate map preserves unchanged spans and explicitly biases replacement interiors", () => {
  const source = "fn value() -> number { return value }";
  const transformed = transformEraScriptDetailed(source);
  assert.match(transformed.code, /^function value\(\): number/);

  const functionStart = transformed.code.indexOf("function");
  assert.equal(transformed.coordinateMap.toOriginal(functionStart, "left"), 0);
  assert.equal(transformed.coordinateMap.toOriginal(functionStart + 4, "left"), 0);
  assert.equal(transformed.coordinateMap.toOriginal(functionStart + 4, "right"), 2);

  const originalName = source.indexOf("value");
  const transformedName = transformed.code.indexOf("value");
  assert.equal(transformed.coordinateMap.toOriginal(transformedName), originalName);
  assert.equal(transformed.coordinateMap.toTransformed(originalName), transformedName);

  const originalArrow = source.indexOf("->");
  const transformedColon = transformed.code.indexOf(":");
  assert.equal(transformed.coordinateMap.toOriginal(transformedColon, "left"), originalArrow);
  assert.equal(transformed.coordinateMap.toOriginal(transformedColon, "right"), originalArrow + 2);
  assert.equal(transformed.coordinateMap.toTransformed(originalArrow, "left"), transformedColon);
});

test("coordinate map accumulates multiple length-changing edits monotonically", () => {
  const source = "pub fn value(input: User?) -> User? { mut result = input; return result }";
  const transformed = transformEraScriptDetailed(source);

  let previousOriginal = -1;
  for (let offset = 0; offset <= transformed.code.length; offset += 1) {
    const mapped = transformed.coordinateMap.toOriginal(offset, "left");
    assert.ok(mapped >= previousOriginal, `map decreased at transformed offset ${offset}`);
    previousOriginal = mapped;
  }

  const originalResult = source.lastIndexOf("result");
  const transformedResult = transformed.code.lastIndexOf("result");
  assert.equal(transformed.coordinateMap.toOriginal(transformedResult), originalResult);
  assert.equal(transformed.coordinateMap.toTransformed(originalResult), transformedResult);

  const generatedNullable = transformed.code.indexOf(" | null | undefined");
  const originalQuestion = source.indexOf("?");
  assert.equal(transformed.coordinateMap.toOriginal(generatedNullable, "left"), originalQuestion);
});

test("coordinate map uses UTF-16 offsets consistently with TypeScript/JavaScript strings", () => {
  const source = 'const marker = "😀"; fn value() -> string { return missing }';
  const transformed = transformEraScriptDetailed(source);
  const originalMissing = source.indexOf("missing");
  const transformedMissing = transformed.code.indexOf("missing");

  assert.ok(originalMissing > 0);
  assert.equal("😀".length, 2);
  assert.equal(transformed.coordinateMap.toOriginal(transformedMissing), originalMissing);
  assert.equal(transformed.coordinateMap.toTransformed(originalMissing), transformedMissing);
});

test("transformed diagnostic ranges map back across generated replacement text", () => {
  const source = "fn value() -> User? { return null }";
  const transformed = transformEraScriptDetailed(source);
  const generatedUnionStart = transformed.code.indexOf(" | null | undefined");
  const generatedUnionLength = " | null | undefined".length;
  const originalQuestion = source.indexOf("?");

  const range = transformed.coordinateMap.transformedRangeToOriginal(
    generatedUnionStart,
    generatedUnionLength,
  );
  assert.ok(range.start <= originalQuestion);
  assert.ok(range.end >= originalQuestion + 1);
});
