#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { compile } from "./compiler.js";
import {
  diagnosticsJson,
  EraDiagnosticError,
  formatEraDiagnostic,
  typescriptDiagnosticToEra,
  type EraDiagnostic,
} from "./diagnostics.js";
import { typecheck, type CheckResult } from "./typecheck.js";
import {
  assertMultichainVerificationState,
  parseMultichainVerificationReport,
  type MultichainVerificationReport,
  type MultichainVerificationState,
} from "./chains/verification.js";
import {
  assertVerificationRequirement,
  parseVerificationReportJson,
} from "./web3/verification-io.js";
import type { RescueVerificationReport, RescueVerificationState } from "./web3/verification.js";

const VERSION = "0.8.0";
const RESCUE_STATES = new Set<RescueVerificationState>([
  "NOT_READY",
  "READY_FOR_BROADCAST",
  "RECOVERY_OBSERVED",
  "VERIFIED_RECOVERY",
]);
const MULTICHAIN_STATES = new Set<MultichainVerificationState>([
  "NOT_READY",
  "READY_FOR_SUBMISSION",
  "EXECUTION_OBSERVED",
  "VERIFIED_FINALITY",
]);

type CliVerificationReport = RescueVerificationReport | MultichainVerificationReport;
type CliVerificationKind = "rescue" | "multichain";

function usage(exitCode = 0): never {
  console.log(`EraScript ${VERSION}

Usage:
  era build <file.era> [-o output.js]
  era run <file.era> [-- <args...>]
  era check <file.era> [--json]
  era verify <report.json> [--require STATE] [--json] [--integrity-only]
  era transpile <file.era>
  era init [directory]
  era --version

Rescue verification states:
  NOT_READY
  READY_FOR_BROADCAST
  RECOVERY_OBSERVED
  VERIFIED_RECOVERY

Multichain verification states:
  NOT_READY
  READY_FOR_SUBMISSION
  EXECUTION_OBSERVED
  VERIFIED_FINALITY

By default, 'era verify' requires READY_FOR_BROADCAST for rescue reports
and READY_FOR_SUBMISSION for multichain reports.
Use --integrity-only only when you intentionally want hash/schema validation without an execution-readiness gate.

EraScript is Node.js/TypeScript compatible and adds AI-first multi-chain Web3 safety checks.
AI agents should prefer structured outputs: era check <file.era> --json`);
  process.exit(exitCode);
}

function requireFile(arg: string | undefined): string {
  if (!arg) usage(2);
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
  return [...checked.diagnostics.map(typescriptDiagnosticToEra), ...checked.eraDiagnostics];
}

function checkExtra(checked: CheckResult): Record<string, unknown> {
  return { features: checked.features, unsafeBoundaries: checked.unsafeBoundaries };
}

function failDiagnostics(diagnostics: readonly EraDiagnostic[], json = false, extra: Record<string, unknown> = {}): never {
  if (json) console.log(diagnosticsJson(diagnostics, extra));
  else for (const diagnostic of diagnostics) console.error(formatEraDiagnostic(diagnostic));
  process.exit(1);
}

function failEra(error: EraDiagnosticError, json = false, extra: Record<string, unknown> = {}): never {
  failDiagnostics([error.diagnostic], json, extra);
}

function ensureChecked(checked: CheckResult, json = false): void {
  const diagnostics = combinedDiagnostics(checked);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) failDiagnostics(diagnostics, json, checkExtra(checked));
  if (!json) for (const diagnostic of diagnostics) console.error(formatEraDiagnostic(diagnostic));
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
  if (result.diagnostics.length) failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
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
  if (result.diagnostics.length) failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
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

function verificationKind(value: unknown): CliVerificationKind {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    console.error("EraScript: verification report must be a JSON object");
    process.exit(2);
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "rescue-verification-report") return "rescue";
  if (kind === "multichain-verification-report") return "multichain";
  console.error(`EraScript: unsupported verification report kind '${String(kind)}'`);
  process.exit(2);
}

function requiredVerificationState(args: string[], kind: "rescue"): RescueVerificationState;
function requiredVerificationState(args: string[], kind: "multichain"): MultichainVerificationState;
function requiredVerificationState(args: string[], kind: CliVerificationKind): RescueVerificationState | MultichainVerificationState {
  const index = args.indexOf("--require");
  if (index < 0) return kind === "rescue" ? "READY_FOR_BROADCAST" : "READY_FOR_SUBMISSION";
  const value = args[index + 1];
  const states = kind === "rescue" ? RESCUE_STATES : MULTICHAIN_STATES;
  if (!value || !states.has(value as never)) {
    console.error(`EraScript: --require for ${kind} reports must be one of ${[...states].join(", ")}`);
    process.exit(2);
  }
  return value as RescueVerificationState | MultichainVerificationState;
}

function unsafeBoundaryCount(report: CliVerificationReport): number {
  return "unsafeBoundaries" in report && Array.isArray(report.unsafeBoundaries) ? report.unsafeBoundaries.length : 0;
}

function verifyReport(file: string, args: string[]): never {
  if (extname(file) !== ".json") {
    console.error(`EraScript: era verify expects a .json verification report, got ${file}`);
    process.exit(2);
  }
  const json = args.includes("--json");
  const integrityOnly = args.includes("--integrity-only");
  const text = readFileSync(file, "utf8");
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch (error) {
    console.error(`EraScript: verification report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const kind = verificationKind(raw);
  let report: CliVerificationReport;
  let required: RescueVerificationState | MultichainVerificationState | null = null;
  try {
    if (kind === "rescue") {
      const rescue = parseVerificationReportJson(text);
      required = integrityOnly ? null : requiredVerificationState(args, "rescue");
      if (required) assertVerificationRequirement(rescue, required as RescueVerificationState);
      report = rescue;
    } else {
      const multichain = parseMultichainVerificationReport(raw);
      required = integrityOnly ? null : requiredVerificationState(args, "multichain");
      if (required) assertMultichainVerificationState(multichain, required as MultichainVerificationState);
      report = multichain;
    }
  } catch (error) {
    if (error instanceof EraDiagnosticError) failEra(error, json, { file, kind });
    throw error;
  }

  if (json) {
    console.log(JSON.stringify({
      ok: true,
      kind,
      file,
      state: report.state,
      reportHash: report.reportHash,
      integrityOnly,
      required,
      checks: report.checks,
      unsafeBoundaries: "unsafeBoundaries" in report ? report.unsafeBoundaries ?? [] : [],
      ...(kind === "multichain" ? {
        family: (report as MultichainVerificationReport).family,
        profileId: (report as MultichainVerificationReport).profileId,
        network: (report as MultichainVerificationReport).network,
        backend: (report as MultichainVerificationReport).backend,
        evidence: (report as MultichainVerificationReport).evidence,
      } : {}),
    }, null, 2));
  } else {
    console.log(`VERIFIED ${file}`);
    console.log(`Kind: ${kind}`);
    console.log(`State: ${report.state}`);
    console.log(`Report hash: ${report.reportHash}`);
    if (kind === "rescue") console.log(`Unsafe boundaries: ${unsafeBoundaryCount(report)}`);
    else {
      const multichain = report as MultichainVerificationReport;
      console.log(`Chain: ${multichain.family}/${multichain.profileId}`);
      console.log(`Backend: ${multichain.backend}`);
      console.log(`Evidence refs: ${multichain.evidence.length}`);
    }
    console.log(integrityOnly ? "Gate: integrity only" : `Gate: ${required} or stronger`);
  }
  process.exit(0);
}

const args = process.argv.slice(2);
const command = args[0];
if (!command || command === "-h" || command === "--help") usage();
if (command === "-v" || command === "--version") {
  console.log(VERSION);
  process.exit(0);
}

switch (command) {
  case "build": build(requireFile(args[1]), args.slice(2)); break;
  case "run": run(requireFile(args[1]), args.slice(2)); break;
  case "check": {
    const file = requireFile(args[1]);
    const json = args.slice(2).includes("--json");
    const checked = typecheck(readSource(file), file);
    const diagnostics = combinedDiagnostics(checked);
    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
    if (json) {
      console.log(diagnosticsJson(diagnostics, checkExtra(checked)));
      process.exit(hasErrors ? 1 : 0);
    }
    if (hasErrors) failDiagnostics(diagnostics);
    for (const diagnostic of diagnostics) console.error(formatEraDiagnostic(diagnostic));
    if (checked.unsafeBoundaries.length > 0) console.log(`Unsafe boundaries: ${checked.unsafeBoundaries.length}`);
    console.log(`OK ${file}`);
    break;
  }
  case "verify": verifyReport(requireFile(args[1]), args.slice(2)); break;
  case "transpile": {
    const file = requireFile(args[1]);
    const result = compile(readSource(file), { fileName: file, sourceMap: false });
    if (result.diagnostics.length) failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
    process.stdout.write(result.typescript);
    break;
  }
  case "init": init(args[1]); break;
  default:
    console.error(`EraScript: unknown command '${command}'`);
    usage(2);
}
