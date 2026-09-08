#!/usr/bin/env node
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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const childEnv = {
  ...process.env,
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  TERM: "dumb",
};

function run(command, args, { cwd = repositoryRoot } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: childEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed (${result.status ?? "unknown"}): ${command} ${args.join(" ")}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function normalizedPackagePaths(packResult) {
  assert.ok(Array.isArray(packResult.files), "npm pack result is missing files[]");
  return packResult.files.map((entry) => String(entry.path).replaceAll("\\", "/"));
}

const workspace = mkdtempSync(join(tmpdir(), "erascript-package-smoke-"));
const packDirectory = join(workspace, "pack");
const fixture = join(workspace, "fixture");

try {
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(fixture, { recursive: true });

  const packed = run(npmCommand, [
    "pack",
    "--json",
    "--pack-destination",
    packDirectory,
  ]);
  const packResults = JSON.parse(packed.stdout);
  assert.ok(Array.isArray(packResults), "npm pack --json did not return an array");
  assert.equal(packResults.length, 1, "expected exactly one packed artifact");

  const packResult = packResults[0];
  assert.equal(packResult.name, packageJson.name);
  assert.equal(packResult.version, packageJson.version);

  const packagePaths = normalizedPackagePaths(packResult);
  const packagePathSet = new Set(packagePaths);
  const requiredPaths = [
    "dist/src/index.js",
    "dist/src/index.d.ts",
    "dist/src/cli.js",
    "dist/src/runtime-loader.js",
    "dist/src/web3/index.js",
    "dist/src/chains/index.js",
    "dist/src/privacy/index.js",
  ];
  for (const requiredPath of requiredPaths) {
    assert.ok(
      packagePathSet.has(requiredPath),
      `required package file is missing: ${requiredPath}`,
    );
  }
  assert.ok(
    packagePaths.some((path) => path.startsWith("dist/src/")),
    "package does not contain dist/src runtime output",
  );
  assert.equal(
    packagePaths.some((path) => path.startsWith("dist/test/")),
    false,
    "package must not contain compiled test output under dist/test",
  );

  const tarball = join(packDirectory, String(packResult.filename));
  assert.ok(existsSync(tarball), `packed tarball does not exist: ${tarball}`);

  writeFileSync(
    join(fixture, "package.json"),
    `${JSON.stringify(
      {
        name: "erascript-package-smoke-fixture",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );

  run(
    npmCommand,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: fixture },
  );

  const installedRoot = join(fixture, "node_modules", packageJson.name);
  const installedCli = join(installedRoot, "dist", "src", "cli.js");
  const installedRuntimeLoader = join(
    installedRoot,
    "dist",
    "src",
    "runtime-loader.js",
  );
  assert.ok(existsSync(installedCli), "installed package is missing CLI entry");
  assert.ok(
    existsSync(installedRuntimeLoader),
    "installed package is missing runtime loader",
  );

  const imported = run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'await import("erascript-lang");',
        'await import("erascript-lang/web3");',
        'await import("erascript-lang/chains");',
        'await import("erascript-lang/privacy");',
        'console.log("imports-ok");',
      ].join(" "),
    ],
    { cwd: fixture },
  );
  assert.equal(imported.stdout.trim(), "imports-ok");

  const version = run(process.execPath, [installedCli, "--version"], {
    cwd: fixture,
  });
  assert.equal(version.stdout.trim(), packageJson.version);

  const app = join(fixture, "app");
  const appSource = join(app, "src");
  mkdirSync(appSource, { recursive: true });
  writeFileSync(
    join(app, "era.json"),
    `${JSON.stringify({ entry: "src/main.era", outDir: "dist" }, null, 2)}\n`,
  );
  writeFileSync(
    join(appSource, "main.era"),
    [
      'import { isAddress } from "viem"',
      'console.log(isAddress("0x0000000000000000000000000000000000000000"))',
      "",
    ].join("\n"),
  );

  run(process.execPath, [installedCli, "check"], { cwd: app });

  const executed = run(process.execPath, [installedCli, "run"], { cwd: app });
  assert.equal(executed.stdout.trim(), "true");

  run(process.execPath, [installedCli, "build"], { cwd: app });
  const builtOutput = join(app, "dist", "src", "main.mjs");
  assert.ok(existsSync(builtOutput), "installed CLI did not emit project build output");

  const builtExecution = run(
    process.execPath,
    ["--enable-source-maps", builtOutput],
    { cwd: app },
  );
  assert.equal(builtExecution.stdout.trim(), "true");

  console.log(
    JSON.stringify(
      {
        ok: true,
        package: `${packageJson.name}@${packageJson.version}`,
        fileCount: packagePaths.length,
        runtimeIncluded: true,
        testsExcluded: true,
        imports: [".", "./web3", "./chains", "./privacy"],
        cli: ["--version", "check", "run", "build"],
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
