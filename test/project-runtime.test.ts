import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { typecheck } from "../src/typecheck.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const compiledTestDirectory = dirname(fileURLToPath(import.meta.url));

function createProject(prefix: string): string {
  return mkdtempSync(join(compiledTestDirectory, prefix));
}

function runCli(
  cwd: string,
  args: readonly string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("typecheck follows explicit relative .era imports and remaps imported diagnostics", () => {
  const directory = createProject("erascript-typecheck-project-");
  try {
    const main = join(directory, "main.era");
    const helper = join(directory, "helper.era");
    writeFileSync(
      helper,
      [
        "export const ok = 1",
        'export const broken: number = "not-a-number"',
      ].join("\n"),
    );
    const mainSource = [
      'import { ok, broken } from "./helper.era"',
      "console.log(ok, broken)",
    ].join("\n");
    writeFileSync(main, mainSource);

    const result = typecheck(mainSource, main);
    const importedDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.file?.fileName === helper,
    );

    assert.ok(
      importedDiagnostic,
      `expected diagnostic remapped to imported EraScript file: ${result.diagnostics
        .map((diagnostic) => diagnostic.file?.fileName ?? "<no-file>")
        .join(", ")}`,
    );
    assert.equal(importedDiagnostic.code, 2322);
    assert.notEqual(importedDiagnostic.start, undefined);
    const position = importedDiagnostic.file!.getLineAndCharacterOfPosition(
      importedDiagnostic.start!,
    );
    assert.equal(position.line + 1, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era run executes relative EraScript modules at their original URLs", () => {
  const directory = createProject("erascript-runtime-module-");
  try {
    const helper = join(directory, "helper.era");
    const main = join(directory, "main.era");
    writeFileSync(
      helper,
      'export function greet(name: string): string { return `hello:${name}` }\n',
    );
    writeFileSync(
      main,
      [
        'import { greet } from "./helper.era"',
        'console.log(greet("module"))',
      ].join("\n"),
    );

    const result = runCli(directory, ["run", main]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), "hello:module");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era run preserves relative JavaScript and bare npm package resolution", () => {
  const directory = createProject("erascript-runtime-node-resolution-");
  try {
    const helper = join(directory, "helper.mjs");
    const main = join(directory, "main.era");
    writeFileSync(helper, 'export const localValue = "local-ok"\n');
    writeFileSync(
      main,
      [
        'import { localValue } from "./helper.mjs"',
        'import { isAddress } from "viem"',
        'console.log(localValue)',
        'console.log(isAddress("0x0000000000000000000000000000000000000000"))',
      ].join("\n"),
    );

    const result = runCli(directory, ["run", main]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
      "local-ok",
      "true",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime stack traces from imported EraScript modules keep original file coordinates", () => {
  const directory = createProject("erascript-runtime-import-stack-");
  try {
    const helper = join(directory, "helper.era");
    const main = join(directory, "main.era");
    writeFileSync(
      helper,
      [
        "export function explode(): void {",
        '  const marker = "😀"',
        '  throw new Error("imported-era-boom")',
        "}",
      ].join("\n"),
    );
    writeFileSync(
      main,
      [
        'import { explode } from "./helper.era"',
        "explode()",
      ].join("\n"),
    );

    const result = runCli(directory, ["run", main]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /imported-era-boom/);
    assert.ok(
      result.stderr.includes(`${helper}:3:`),
      `expected imported original EraScript stack frame:\n${result.stderr}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era.json supplies implicit run/check entry while explicit files still win", () => {
  const directory = createProject("erascript-project-config-");
  try {
    const src = join(directory, "src");
    mkdirSync(src, { recursive: true });
    const main = join(src, "main.era");
    const alternate = join(directory, "alternate.era");
    writeFileSync(
      join(directory, "era.json"),
      JSON.stringify({ entry: "src/main.era", outDir: "dist" }, null, 2),
    );
    writeFileSync(main, 'console.log("project-entry")\n');
    writeFileSync(alternate, 'console.log("explicit-entry")\n');

    const implicitRun = runCli(directory, ["run"]);
    assert.equal(
      implicitRun.status,
      0,
      implicitRun.stderr || implicitRun.stdout,
    );
    assert.equal(implicitRun.stdout.trim(), "project-entry");

    const implicitCheck = runCli(directory, ["check", "--json"]);
    assert.equal(
      implicitCheck.status,
      0,
      implicitCheck.stderr || implicitCheck.stdout,
    );
    const checkJson = JSON.parse(implicitCheck.stdout) as {
      diagnostics?: unknown[];
    };
    assert.deepEqual(checkJson.diagnostics ?? [], []);

    const explicitRun = runCli(directory, ["run", alternate]);
    assert.equal(
      explicitRun.status,
      0,
      explicitRun.stderr || explicitRun.stdout,
    );
    assert.equal(explicitRun.stdout.trim(), "explicit-entry");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
