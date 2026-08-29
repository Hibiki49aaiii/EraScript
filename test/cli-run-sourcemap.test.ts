import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function runEra(file: string, runtimeTmp: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [cli, "run", file, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TMPDIR: runtimeTmp,
        TMP: runtimeTmp,
        TEMP: runtimeTmp,
      },
    },
  );
}

function leakedEraRuntimeDirectories(runtimeTmp: string): string[] {
  return readdirSync(runtimeTmp).filter((name) => name.startsWith("erascript-"));
}

test("era run maps runtime throw frames back to the original EraScript line", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-run-map-test-"));
  const runtimeTmp = join(directory, "runtime-tmp");
  mkdirSync(runtimeTmp);
  try {
    const file = join(directory, "mapped.era");
    const source = [
      'const marker = "😀"',
      'const formatter = `value:${fn(x: number) -> number { return x + 1 }}`',
      "fn explode() -> void {",
      '  mut message = "era-runtime-boom"',
      "  throw new Error(message)",
      "}",
      "explode()",
    ].join("\n");
    writeFileSync(file, source);

    const result = runEra(file, runtimeTmp);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /era-runtime-boom/);
    assert.ok(
      result.stderr.includes(`${file}:5:`),
      `expected original EraScript throw line in stderr:\n${result.stderr}`,
    );
    assert.equal(leakedEraRuntimeDirectories(runtimeTmp).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("era run preserves arguments and child exit status while cleaning temp artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "erascript-run-behavior-test-"));
  const runtimeTmp = join(directory, "runtime-tmp");
  mkdirSync(runtimeTmp);
  try {
    const argsFile = join(directory, "args.era");
    writeFileSync(
      argsFile,
      'console.log(process.argv.slice(2).join("|"))',
    );
    const argsResult = runEra(argsFile, runtimeTmp, "--", "alpha", "beta", "gamma");
    assert.equal(argsResult.status, 0, argsResult.stderr || argsResult.stdout);
    assert.equal(argsResult.stdout.trim(), "alpha|beta|gamma");
    assert.equal(leakedEraRuntimeDirectories(runtimeTmp).length, 0);

    const exitFile = join(directory, "exit.era");
    writeFileSync(exitFile, "process.exit(7)");
    const exitResult = runEra(exitFile, runtimeTmp);
    assert.equal(exitResult.status, 7, exitResult.stderr || exitResult.stdout);
    assert.equal(leakedEraRuntimeDirectories(runtimeTmp).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
