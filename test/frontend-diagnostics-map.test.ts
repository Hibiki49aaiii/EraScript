import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { compile } from "../src/compiler.js";
import { remapTypeScriptDiagnostics } from "../src/frontend/diagnostics.js";
import { transformEraScriptDetailed } from "../src/frontend/transform.js";
import { typecheck } from "../src/typecheck.js";

function lineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lines = before.split(/\r\n|\r|\n/);
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

test("TypeScript semantic diagnostics point at original .era coordinates after length-changing syntax", () => {
  const source = "fn value() -> number { return missingValue }";
  const fileName = "semantic-original.era";
  const checked = typecheck(source, fileName);
  const diagnostic = checked.diagnostics.find((item) => item.code === 2304);
  assert.ok(diagnostic);
  assert.equal(diagnostic.file?.fileName, fileName);
  assert.notEqual(diagnostic.start, undefined);

  const expectedOffset = source.indexOf("missingValue");
  assert.equal(diagnostic.start, expectedOffset);
  const position = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
  const expected = lineColumn(source, expectedOffset);
  assert.equal(position.line + 1, expected.line);
  assert.equal(position.character + 1, expected.column);
});

test("transpile diagnostics are rebound to original .era source positions", () => {
  const source = "fn value() -> number { const broken = ; return 1 }";
  const fileName = "syntactic-original.era";
  const result = compile(source, { fileName, sourceMap: false });
  const diagnostic = result.diagnostics.find(
    (item) => item.file?.fileName === fileName && item.start !== undefined,
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.file?.text, source);
  assert.equal(diagnostic.start, source.indexOf(";"));
});

test("Web3 diagnostics after Era lowering use original literal coordinates", () => {
  const source = 'fn value() -> void { bytes32("0x123") }';
  const fileName = "web3-original.era";
  const checked = typecheck(source, fileName);
  const diagnostic = checked.eraDiagnostics.find((item) => item.code === "ES3201");
  assert.ok(diagnostic);
  const expected = lineColumn(source, source.indexOf('"0x123"'));
  assert.equal(diagnostic.file, fileName);
  assert.equal(diagnostic.line, expected.line);
  assert.equal(diagnostic.column, expected.column);
});

test("unsafe boundary audit ids are derived from original EraScript locations", () => {
  const source =
    'fn value() -> void { unsafeBoundary("non-standard legacy adapter", () => 1) }';
  const fileName = "unsafe-original.era";
  const checked = typecheck(source, fileName);
  assert.equal(checked.unsafeBoundaries.length, 1);
  const audit = checked.unsafeBoundaries[0]!;
  const expected = lineColumn(source, source.indexOf("unsafeBoundary"));
  assert.equal(audit.file, fileName);
  assert.equal(audit.line, expected.line);
  assert.equal(audit.column, expected.column);
  assert.equal(audit.id, `${fileName}:${expected.line}:${expected.column}`);

  const warning = checked.eraDiagnostics.find((item) => item.code === "ES4080");
  assert.equal(warning?.details?.auditId, audit.id);
});

test("related diagnostics remap only entries belonging to the transformed primary file", () => {
  const source = "fn value() -> number { return missingValue }";
  const transformed = transformEraScriptDetailed(source);
  const virtual = ts.createSourceFile(
    "primary.ts",
    transformed.code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const dependency = ts.createSourceFile(
    "dependency.ts",
    "export const dependency = 1;",
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const transformedMissing = transformed.code.indexOf("missingValue");
  const primaryRelated: ts.DiagnosticRelatedInformation = {
    category: ts.DiagnosticCategory.Message,
    code: 9001,
    file: virtual,
    start: transformedMissing,
    length: "missingValue".length,
    messageText: "primary related",
  };
  const dependencyRelated: ts.DiagnosticRelatedInformation = {
    category: ts.DiagnosticCategory.Message,
    code: 9002,
    file: dependency,
    start: 0,
    length: 6,
    messageText: "dependency related",
  };
  const diagnostic: ts.Diagnostic = {
    category: ts.DiagnosticCategory.Error,
    code: 9999,
    file: virtual,
    start: transformedMissing,
    length: "missingValue".length,
    messageText: "synthetic primary diagnostic",
    relatedInformation: [primaryRelated, dependencyRelated],
  };

  const [mapped] = remapTypeScriptDiagnostics([diagnostic], {
    map: transformed.coordinateMap,
    originalSource: source,
    originalFileName: "primary.era",
    transformedFileName: "primary.ts",
  });
  assert.ok(mapped);
  assert.equal(mapped.file?.fileName, "primary.era");
  assert.equal(mapped.start, source.indexOf("missingValue"));
  assert.equal(mapped.relatedInformation?.[0]?.file?.fileName, "primary.era");
  assert.equal(
    mapped.relatedInformation?.[0]?.start,
    source.indexOf("missingValue"),
  );
  assert.equal(mapped.relatedInformation?.[1]?.file, dependency);
  assert.equal(mapped.relatedInformation?.[1]?.start, 0);
});

test("era check --json exposes original .era filename and coordinates", () => {
  const root = mkdtempSync(join(tmpdir(), "erascript-original-diagnostic-"));
  try {
    const file = join(root, "main.era");
    const source = "fn value() -> number { return missingValue }";
    writeFileSync(file, source, "utf8");

    const child = spawnSync(
      process.execPath,
      [join(process.cwd(), "dist/src/cli.js"), "check", file, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 1, child.stderr);
    const payload = JSON.parse(child.stdout) as {
      diagnostics: {
        code: string;
        file?: string;
        line?: number;
        column?: number;
      }[];
    };
    const diagnostic = payload.diagnostics.find((item) => item.code === "TS2304");
    assert.ok(diagnostic);
    const expected = lineColumn(source, source.indexOf("missingValue"));
    assert.equal(diagnostic.file, file);
    assert.equal(diagnostic.line, expected.line);
    assert.equal(diagnostic.column, expected.column);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
