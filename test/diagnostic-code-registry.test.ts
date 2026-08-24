import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

interface Assignment {
  code: string;
  kind: string;
  file: string;
}

function files(root: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) result.push(...files(path));
    else if (path.endsWith(".ts")) result.push(path);
  }
  return result;
}

function assignments(file: string): Assignment[] {
  const source = readFileSync(file, "utf8");
  const result: Assignment[] = [];
  const patterns = [
    /(?:fail|txError|invalidHex)\(\s*["'](ES\d{4})["']\s*,\s*["']([^"']+)["']/g,
    /code:\s*["'](ES\d{4})["'][\s\S]{0,180}?kind:\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      result.push({ code: match[1]!, kind: match[2]!, file });
    }
  }
  return result;
}

test("each EraScript diagnostic code maps to one semantic kind", () => {
  const byCode = new Map<string, Map<string, Set<string>>>();
  for (const file of files("src")) {
    for (const assignment of assignments(file)) {
      let kinds = byCode.get(assignment.code);
      if (!kinds) {
        kinds = new Map();
        byCode.set(assignment.code, kinds);
      }
      let locations = kinds.get(assignment.kind);
      if (!locations) {
        locations = new Set();
        kinds.set(assignment.kind, locations);
      }
      locations.add(assignment.file);
    }
  }

  const collisions = [...byCode.entries()]
    .filter(([, kinds]) => kinds.size > 1)
    .map(([code, kinds]) => ({
      code,
      assignments: [...kinds.entries()].map(([kind, locations]) => ({ kind, files: [...locations].sort() })),
    }));

  assert.deepEqual(collisions, [], `Diagnostic code collisions detected:\n${JSON.stringify(collisions, null, 2)}`);
});
