import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const compiledTestDirectory = dirname(fileURLToPath(import.meta.url));

function createWorkspace(prefix: string): string {
  return mkdtempSync(join(compiledTestDirectory, prefix));
}

function runCli(cwd: string, args: readonly string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function runNode(cwd: string, file: string) {
  return spawnSync(
    process.execPath,
    ["--enable-source-maps", file],
    { cwd, encoding: "utf8" },
  );
}

function writeProjectConfig(project: string): void {
  writeFileSync(
    join(project, "era.json"),
    JSON.stringify({ entry: "src/main.era", outDir: "dist" }, null, 2),
  );
}

test("era build emits a multi-file .mjs graph with local assets and bare npm imports", () => {
  const project = createWorkspace("erascript-project-build-");
  try {
    const src = join(project, "src");
    mkdirSync(src, { recursive: true });
    writeProjectConfig(project);
    writeFileSync(
      join(src, "helper.era"),
      'export function greet(value: string): string { return `helper:${value}` }\n',
    );
    writeFileSync(
      join(src, "local.mjs"),
      'export const localValue = "local-built"\n',
    );
    writeFileSync(
      join(src, "local.d.mts"),
      "export declare const localValue: string\n",
    );
    writeFileSync(
      join(src, "main.era"),
      [
        'import { greet } from "./helper.era"',
        'import { localValue } from "./local.mjs"',
        'import { isAddress } from "viem"',
        'console.log(greet(localValue))',
        'console.log(isAddress("0x0000000000000000000000000000000000000000"))',
      ].join("\n"),
    );

    const build = runCli(project, ["build"]);
    assert.equal(build.status, 0, build.stderr || build.stdout);

    const mainOutput = join(project, "dist", "src", "main.mjs");
    const helperOutput = join(project, "dist", "src", "helper.mjs");
    const localOutput = join(project, "dist", "src", "local.mjs");
    assert.ok(existsSync(mainOutput));
    assert.ok(existsSync(`${mainOutput}.map`));
    assert.ok(existsSync(helperOutput));
    assert.ok(existsSync(`${helperOutput}.map`));
    assert.ok(existsSync(localOutput));

    const emittedMain = readFileSync(mainOutput, "utf8");
    assert.match(emittedMain, /\.\/helper\.mjs/);
    assert.doesNotMatch(emittedMain, /\.\/helper\.era/);
    assert.match(emittedMain, /from "viem"/);

    const executed = runNode(project, mainOutput);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/), [
      "helper:local-built",
      "true",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("built imported EraScript stack traces map to the original helper source", () => {
  const project = createWorkspace("erascript-project-build-stack-");
  try {
    const src = join(project, "src");
    mkdirSync(src, { recursive: true });
    writeProjectConfig(project);
    const helper = join(src, "helper.era");
    writeFileSync(
      helper,
      [
        "export function explode(): void {",
        '  const marker = "😀"',
        '  throw new Error("built-project-boom")',
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(src, "main.era"),
      [
        'import { explode } from "./helper.era"',
        "explode()",
      ].join("\n"),
    );

    const build = runCli(project, ["build"]);
    assert.equal(build.status, 0, build.stderr || build.stdout);

    const mainOutput = join(project, "dist", "src", "main.mjs");
    const executed = runNode(project, mainOutput);
    assert.equal(executed.status, 1);
    assert.match(executed.stderr, /built-project-boom/);
    assert.ok(
      executed.stderr.includes(`${helper}:3:`),
      `expected original helper.era frame:\n${executed.stderr}`,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("project build handles cyclic EraScript imports without duplicate emission", () => {
  const project = createWorkspace("erascript-project-build-cycle-");
  try {
    const src = join(project, "src");
    mkdirSync(src, { recursive: true });
    writeProjectConfig(project);
    writeFileSync(
      join(src, "main.era"),
      [
        'import "./other.era"',
        "export const mainValue = 1",
      ].join("\n"),
    );
    writeFileSync(
      join(src, "other.era"),
      [
        'import "./main.era"',
        "export const otherValue = 2",
      ].join("\n"),
    );

    const build = runCli(project, ["build"]);
    assert.equal(build.status, 0, build.stderr || build.stdout);
    assert.ok(existsSync(join(project, "dist", "src", "main.mjs")));
    assert.ok(existsSync(join(project, "dist", "src", "other.mjs")));
    assert.match(build.stdout, /2 modules/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("project build rejects EraScript imports that escape project root", () => {
  const workspace = createWorkspace("erascript-project-build-escape-");
  try {
    const project = join(workspace, "project");
    const src = join(project, "src");
    mkdirSync(src, { recursive: true });
    writeProjectConfig(project);
    writeFileSync(
      join(workspace, "outside.era"),
      "export const outside = 1\n",
    );
    writeFileSync(
      join(src, "main.era"),
      [
        'import { outside } from "../../outside.era"',
        "console.log(outside)",
      ].join("\n"),
    );

    const build = runCli(project, ["build"]);
    assert.equal(build.status, 1);
    assert.match(build.stderr, /escapes project root/);
    assert.equal(existsSync(join(project, "dist", "src", "main.mjs")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("explicit era build file -o keeps legacy single-file output behavior", () => {
  const workspace = createWorkspace("erascript-legacy-build-");
  try {
    const source = join(workspace, "single.era");
    const output = join(workspace, "custom.js");
    writeFileSync(source, 'console.log("legacy-build")\n');

    const build = runCli(workspace, ["build", source, "-o", output]);
    assert.equal(build.status, 0, build.stderr || build.stdout);
    assert.ok(existsSync(output));
    assert.ok(existsSync(`${output}.map`));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
