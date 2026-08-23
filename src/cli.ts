#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { compile } from "./compiler.js";
import {
  diagnosticsJson,
  formatEraDiagnostic,
  typescriptDiagnosticToEra,
  type EraDiagnostic,
} from "./diagnostics.js";
import { typecheck, type CheckResult } from "./typecheck.js";

const VERSION = "0.2.0";

function usage(): never {
  console.log(`EraScript ${VERSION}

Usage:
  era build <file.era> [-o output.js]
  era run <file.era> [-- <args...>]
  era check <file.era> [--json]
  era transpile <file.era>
  era init [directory]
  era --version

EraScript is Node.js/TypeScript compatible and adds Web3-first safety checks.
AI agents should prefer: era check <file.era> --json`);
  process.exit(0);
}

function requireFile(arg: string | undefined): string {
  if (!arg) usage();
  return resolve(arg);
}

function readSource(file: string): string {
  if (extname(file) !== ".era") {
    console.error(`EraScript: expected a .era file, got ${file}`);
    process.exit(2);
  }
  return readFileSync(file, "utf8");
}

function combinedDiagnostics(checked: CheckResult): EraDiagnostic[] {
  return [
    ...checked.diagnostics.map(typescriptDiagnosticToEra),
    ...checked.eraDiagnostics,
  ];
}

function failDiagnostics(diagnostics: readonly EraDiagnostic[], json = false, extra: Record<string, unknown> = {}): never {
  if (json) {
    console.log(diagnosticsJson(diagnostics, extra));
  } else {
    for (const diagnostic of diagnostics) console.error(formatEraDiagnostic(diagnostic));
  }
  process.exit(1);
}

function ensureChecked(checked: CheckResult, json = false): void {
  const diagnostics = combinedDiagnostics(checked);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) failDiagnostics(diagnostics, json, { features: checked.features });

  if (!json) {
    for (const diagnostic of diagnostics) console.error(formatEraDiagnostic(diagnostic));
  }
}

function parseOutput(args: string[], input: string): string {
  const index = args.indexOf("-o");
  if (index >= 0) {
    const output = args[index + 1];
    if (!output) {
      console.error("EraScript: -o requires a path");
      process.exit(2);
    }
    return resolve(output);
  }
  return join(dirname(input), `${basename(input, ".era")}.js`);
}

function build(file: string, args: string[]): void {
  const source = readSource(file);
  const checked = typecheck(source, file);
  ensureChecked(checked);

  const result = compile(source, { fileName: file, sourceMap: true });
  if (result.diagnostics.length) {
    failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
  }

  const output = parseOutput(args, file);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, result.javascript, "utf8");
  if (result.sourceMap) writeFileSync(`${output}.map`, result.sourceMap, "utf8");
  console.log(`Built ${file} -> ${output}`);
}

function run(file: string, args: string[]): never {
  const source = readSource(file);
  const checked = typecheck(source, file);
  ensureChecked(checked);

  const result = compile(source, { fileName: file, sourceMap: false });
  if (result.diagnostics.length) {
    failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
  }

  const temp = mkdtempSync(join(tmpdir(), "erascript-"));
  const output = join(temp, "main.mjs");
  writeFileSync(output, result.javascript, "utf8");
  const separator = args.indexOf("--");
  const childArgs = separator >= 0 ? args.slice(separator + 1) : [];
  const child = spawnSync(process.execPath, [output, ...childArgs], { stdio: "inherit" });
  rmSync(temp, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

function init(directory: string | undefined): void {
  const root = resolve(directory ?? ".");
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(root, "era.json"), JSON.stringify({ entry: "src/main.era", outDir: "dist" }, null, 2) + "\n");
  writeFileSync(join(src, "main.era"), `fn greet(name: string) -> string {\n  return \`Hello, \${name}!\`\n}\n\nconsole.log(greet("EraScript"))\n`);
  console.log(`Initialized EraScript project in ${root}`);
}

const args = process.argv.slice(2);
const command = args[0];
if (!command || command === "-h" || command === "--help") usage();
if (command === "-v" || command === "--version") {
  console.log(VERSION);
  process.exit(0);
}

switch (command) {
  case "build":
    build(requireFile(args[1]), args.slice(2));
    break;
  case "run":
    run(requireFile(args[1]), args.slice(2));
    break;
  case "check": {
    const file = requireFile(args[1]);
    const json = args.slice(2).includes("--json");
    const checked = typecheck(readSource(file), file);
    const diagnostics = combinedDiagnostics(checked);
    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");

    if (json) {
      console.log(diagnosticsJson(diagnostics, { features: checked.features }));
      process.exit(hasErrors ? 1 : 0);
    }

    if (hasErrors) failDiagnostics(diagnostics);
    for (const diagnostic of diagnostics) console.error(formatEraDiagnostic(diagnostic));
    console.log(`OK ${file}`);
    break;
  }
  case "transpile": {
    const file = requireFile(args[1]);
    const result = compile(readSource(file), { fileName: file, sourceMap: false });
    if (result.diagnostics.length) {
      failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
    }
    process.stdout.write(result.typescript);
    break;
  }
  case "init":
    init(args[1]);
    break;
  default:
    console.error(`EraScript: unknown command '${command}'`);
    usage();
}
