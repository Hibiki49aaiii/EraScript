import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../src/compiler.js";
import {
  composeTypeScriptSourceMapToEraScript,
  decodeSourceMapMappings,
  encodeSourceMapMappings,
  parseSourceMapV3,
  type DecodedSourceMapSegment,
} from "../src/frontend/source-map-v3.js";
import { transformEraScriptDetailed } from "../src/frontend/transform.js";

function lineColumn(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return { line: lines.length - 1, column: lines.at(-1)!.length };
}

function mappedPosition(
  mapText: string,
  generatedSource: string,
  generatedTokenOffset: number,
): { line: number; column: number } {
  const map = parseSourceMapV3(mapText);
  const mappings = decodeSourceMapMappings(map);
  const generated = lineColumn(generatedSource, generatedTokenOffset);
  const line = mappings[generated.line] ?? [];
  let selected: DecodedSourceMapSegment | undefined;
  for (const segment of line) {
    if (segment.generatedColumn > generated.column) break;
    if (segment.source !== undefined) selected = segment;
  }
  assert.ok(selected, `no mapped segment before generated position ${generated.line}:${generated.column}`);
  assert.notEqual(selected.originalLine, undefined);
  assert.notEqual(selected.originalColumn, undefined);
  return { line: selected.originalLine!, column: selected.originalColumn! };
}

test("Source Map V3 mapping codec round-trips mapped, unmapped and named segments", () => {
  const decoded = [
    [
      { generatedColumn: 0, source: 0, originalLine: 0, originalColumn: 0 },
      { generatedColumn: 4 },
      { generatedColumn: 9, source: 0, originalLine: 0, originalColumn: 3, name: 0 },
    ],
    [
      { generatedColumn: 2, source: 0, originalLine: 1, originalColumn: 5 },
    ],
  ] as const;

  const encoded = encodeSourceMapMappings(decoded);
  const parsed = parseSourceMapV3(JSON.stringify({
    version: 3,
    file: "out.js",
    sources: ["input.ts"],
    names: ["value"],
    mappings: encoded,
  }));

  assert.deepEqual(decodeSourceMapMappings(parsed), decoded);
});

test("compiler source map resolves emitted function name to original EraScript source", () => {
  const source = [
    "fn value() -> number {",
    "  mut result = 1",
    "  return result",
    "}",
    "console.log(value())",
  ].join("\n");
  const result = compile(source, {
    fileName: "value.era",
    outputFileName: "value.js",
    sourceMap: true,
  });

  assert.ok(result.sourceMap);
  const map = parseSourceMapV3(result.sourceMap);
  assert.deepEqual(map.sources, ["value.era"]);
  assert.deepEqual(map.sourcesContent, [source]);
  assert.equal(map.file, "value.js");
  assert.match(result.javascript, /sourceMappingURL=value\.js\.map/);

  const generatedValue = result.javascript.indexOf("value");
  const originalValue = source.indexOf("value");
  assert.ok(generatedValue >= 0 && originalValue >= 0);
  assert.deepEqual(
    mappedPosition(result.sourceMap, result.javascript, generatedValue),
    lineColumn(source, originalValue),
  );
});

test("source map composition uses the v0.12 semantic arrow anchor", () => {
  const source = "fn value() -> number { return 1 }";
  const transformed = transformEraScriptDetailed(source);
  const transformedColon = transformed.code.indexOf(":");
  const originalArrow = source.indexOf("->");
  assert.ok(transformedColon >= 0 && originalArrow >= 0);

  const transformedPosition = lineColumn(transformed.code, transformedColon);
  const emitterMappings = encodeSourceMapMappings([[
    {
      generatedColumn: 0,
      source: 0,
      originalLine: transformedPosition.line,
      originalColumn: transformedPosition.column,
    },
  ]]);

  const composed = composeTypeScriptSourceMapToEraScript({
    emitterSourceMapText: JSON.stringify({
      version: 3,
      file: "value.js",
      sources: ["value.era"],
      names: [],
      mappings: emitterMappings,
      sourcesContent: [transformed.code],
    }),
    transformedSource: transformed.code,
    originalSource: source,
    originalFileName: "value.era",
    coordinateMap: transformed.coordinateMap,
  });
  const decoded = decodeSourceMapMappings(parseSourceMapV3(composed));
  assert.equal(decoded[0]![0]!.originalLine, 0);
  assert.equal(decoded[0]![0]!.originalColumn, originalArrow);
});

test("compiler composed map preserves later coordinates after emoji, nullable and template lowering", () => {
  const source =
    'const marker = "😀"; const tpl = `raw ${fn(x: number) -> number { return x + 1 }}`; pub fn value(input: number?) -> number? { mut result = input; return result }\nconsole.log(value(null))';
  const result = compile(source, {
    fileName: "complex.era",
    outputFileName: "complex.js",
    sourceMap: true,
  });
  assert.ok(result.sourceMap);

  const generatedConsole = result.javascript.indexOf("console.log");
  const originalConsole = source.indexOf("console.log");
  assert.ok(generatedConsole >= 0 && originalConsole >= 0);
  assert.deepEqual(
    mappedPosition(result.sourceMap, result.javascript, generatedConsole),
    lineColumn(source, originalConsole),
  );

  const map = parseSourceMapV3(result.sourceMap);
  assert.deepEqual(map.sourcesContent, [source]);
});

test("ordinary TypeScript remains identity-mapped", () => {
  const source = "const answer: number = 42;\nconsole.log(answer);";
  const result = compile(source, {
    fileName: "plain.era",
    outputFileName: "plain.js",
    sourceMap: true,
  });
  assert.ok(result.sourceMap);

  const generatedConsole = result.javascript.indexOf("console.log");
  const originalConsole = source.indexOf("console.log");
  assert.deepEqual(
    mappedPosition(result.sourceMap, result.javascript, generatedConsole),
    lineColumn(source, originalConsole),
  );
  assert.deepEqual(parseSourceMapV3(result.sourceMap).sourcesContent, [source]);
});
