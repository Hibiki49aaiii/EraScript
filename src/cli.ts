#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, unlinkSync, writeFileSync } from "node:fs";
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
import { buildEraProject, EraProjectBuildError } from "./project-build.js";
import {
  EraProjectConfigError,
  requireEraProject,
  requireEraProjectEntry,
  type EraProject,
} from "./project.js";
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
import {
  parseVerificationReportAttestationJson,
  verifyVerificationReportAttestation,
  type VerificationReportAuthentication,
} from "./verification-attestation.js";

const VERSION = "0.19.0-rc.1";
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
  era build [file.era] [-o output.js]
  era run [file.era] [-- <args...>]
  era check [file.era] [--json]
  era verify <report.json> [--require STATE] [--json] [--integrity-only]
             [--attestation FILE --trusted-key PUBLIC_KEY.pem]
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
Report hashes prove content integrity, not issuer authenticity. Supply both --attestation and --trusted-key
to authenticate a detached Ed25519 attestation from an explicitly trusted public key.

EraScript is Node.js/TypeScript compatible and adds AI-first multi-chain Web3 safety checks.
AI agents should prefer structured outputs: era check <file.era> --json`);
  process.exit(exitCode);
}

function requireFile(arg: string | undefined): string {
  if (!arg || arg.startsWith("-")) cliError("An explicit input file is required.");
  return resolve(arg);
}

function resolveOptionalProjectFile(arg: string | undefined): {
  readonly file: string;
  readonly consumed: boolean;
} {
  if (arg && !arg.startsWith("-")) {
    return { file: requireFile(arg), consumed: true };
  }
  try {
    return { file: requireEraProjectEntry(), consumed: false };
  } catch (error) {
    if (error instanceof EraProjectConfigError) {
      cliError(error.message);
    }
    throw error;
  }
}

function requireProjectOrExit(): EraProject {
  try {
    return requireEraProject();
  } catch (error) {
    if (error instanceof EraProjectConfigError) {
      cliError(error.message);
    }
    throw error;
  }
}

function readSource(file: string): string {
  if (extname(file) !== ".era") {
    cliError(`Expected a .era input file: ${file}`);
  }
  return readBoundedText(file);
}

function cliError(message: string): never {
  throw new EraDiagnosticError({ code: "ES4905", severity: "error", kind: "CliInputError", message });
}

function readBoundedText(file: string, limit = 10 * 1024 * 1024): string {
  const fd = openSync(file, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) cliError("Input must be a regular file within the documented size limit.");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > limit || size > stat.size) cliError("Input grew while reading or exceeds the size limit.");
    return buffer.subarray(0, size).toString("utf8");
  } finally { closeSync(fd); }
}

function validateOptions(values: string[], flags: string[], valued: string[] = [], separator = false): void {
  const seen = new Set<string>();
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (separator && value === "--") return;
    if (seen.has(value) || (!flags.includes(value) && !valued.includes(value))) cliError(`Unknown, duplicate or misplaced option: ${value}`);
    seen.add(value);
    if (valued.includes(value)) {
      const next = values[++i];
      if (!next || next.startsWith("-")) cliError(`${value} requires a value.`);
    }
  }
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
  const output = parseOutput(args, file);
  if (output === file || extname(output).toLowerCase() === ".era") cliError("Build output must not overwrite an EraScript source file.");
  const result = compile(source, {
    fileName: file,
    sourceMap: true,
    outputFileName: basename(output),
  });
  if (result.diagnostics.length) failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, result.javascript, "utf8");
  if (result.sourceMap) writeFileSync(`${output}.map`, result.sourceMap, "utf8");
  console.log(`Built ${file} -> ${output}`);
}

function buildProject(project: EraProject): void {
  const source = readSource(project.entry);
  const checked = typecheck(source, project.entry);
  ensureChecked(checked);
  try {
    const result = buildEraProject(project);
    console.log(
      `Built EraScript project ${project.entry} -> ${result.entryOutput} (${result.moduleOutputs.length} modules, ${result.copiedAssets.length} copied assets)`,
    );
  } catch (error) {
    if (error instanceof EraProjectBuildError) {
      console.error(`EraScript: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

function runtimeLoaderBootstrap(): string {
  const loaderUrl = new URL("./runtime-loader.js", import.meta.url).href;
  const registerSource =
    `import { register } from "node:module"; register(${JSON.stringify(loaderUrl)}, import.meta.url);`;
  return `data:text/javascript,${encodeURIComponent(registerSource)}`;
}

function run(file: string, args: string[]): never {
  const source = readSource(file);
  const checked = typecheck(source, file);
  ensureChecked(checked);

  const separator = args.indexOf("--");
  const childArgs = separator >= 0 ? args.slice(separator + 1) : [];
  const child = spawnSync(
    process.execPath,
    [
      "--enable-source-maps",
      "--import",
      runtimeLoaderBootstrap(),
      file,
      ...childArgs,
    ],
    { stdio: "inherit" },
  );

  if (child.error) {
    console.error(`EraScript: failed to start Node runtime: ${child.error.message}`);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

function init(directory: string | undefined): void {
  const root = resolve(directory ?? ".");
  const src = join(root, "src");
  const config = join(root, "era.json");
  const entry = join(src, "main.era");
  for (const target of [config, entry]) {
    try { lstatSync(target); cliError(`Initialization would overwrite an existing path: ${target}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  try {
    const stat = lstatSync(src);
    if (stat.isSymbolicLink() || !stat.isDirectory()) cliError("Initialization requires a real src directory, not a link or file.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  mkdirSync(src, { recursive: true });
  const created: string[] = [];
  try {
    for (const [path, contents] of [
      [config, JSON.stringify({ entry: "src/main.era", outDir: "dist" }, null, 2) + "\n"],
      [entry, `fn greet(name: string) -> string {\n  return \`Hello, \${name}!\`\n}\n\nconsole.log(greet("EraScript"))\n`],
    ] as const) {
      const fd = openSync(path, "wx");
      created.push(path);
      try { writeFileSync(fd, contents, "utf8"); } finally { closeSync(fd); }
    }
  } catch (error) {
    for (const path of created) unlinkSync(path);
    throw error;
  }
  console.log(`Initialized EraScript project in ${root}`);
}

function verificationKind(value: unknown): CliVerificationKind {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    cliError("Verification report must be a JSON object.");
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "rescue-verification-report") return "rescue";
  if (kind === "multichain-verification-report") return "multichain";
  cliError("Unsupported verification report kind.");
}

function requiredVerificationState(args: string[], kind: "rescue"): RescueVerificationState;
function requiredVerificationState(args: string[], kind: "multichain"): MultichainVerificationState;
function requiredVerificationState(args: string[], kind: CliVerificationKind): RescueVerificationState | MultichainVerificationState {
  const index = args.indexOf("--require");
  if (index < 0) return kind === "rescue" ? "READY_FOR_BROADCAST" : "READY_FOR_SUBMISSION";
  const value = args[index + 1];
  const states = kind === "rescue" ? RESCUE_STATES : MULTICHAIN_STATES;
  if (!value || !states.has(value as never)) {
    cliError(`--require for ${kind} reports must be one of ${[...states].join(", ")}`);
  }
  return value as RescueVerificationState | MultichainVerificationState;
}

function unsafeBoundaryCount(report: CliVerificationReport): number {
  return "unsafeBoundaries" in report && Array.isArray(report.unsafeBoundaries) ? report.unsafeBoundaries.length : 0;
}

function verificationOption(args: string[], name: "--attestation" | "--trusted-key"): string | undefined {
  const indexes = args.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) {
    console.error(`EraScript: ${name} may be specified only once`);
    process.exit(2);
  }
  const index = indexes[0];
  if (index === undefined) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    console.error(`EraScript: ${name} requires a file path`);
    process.exit(2);
  }
  return resolve(value);
}

function verifyReport(file: string, args: string[]): never {
  if (extname(file) !== ".json") {
    cliError("era verify expects a .json verification report.");
  }
  const json = args.includes("--json");
  const integrityOnly = args.includes("--integrity-only");
  const attestationFile = verificationOption(args, "--attestation");
  const trustedKeyFile = verificationOption(args, "--trusted-key");
  if ((attestationFile === undefined) !== (trustedKeyFile === undefined)) {
    cliError("--attestation and --trusted-key must be supplied together.");
  }
  const text = readBoundedText(file);
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch (error) {
    cliError("Verification report is not valid JSON.");
  }
  const kind = verificationKind(raw);
  let report: CliVerificationReport;
  let required: RescueVerificationState | MultichainVerificationState | null = null;
  let authentication: VerificationReportAuthentication | null = null;
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
    if (attestationFile && trustedKeyFile) {
      const attestation = parseVerificationReportAttestationJson(readBoundedText(attestationFile, 64 * 1024));
      authentication = verifyVerificationReportAttestation({
        attestation,
        report,
        trustedPublicKey: readBoundedText(trustedKeyFile, 16 * 1024),
      });
    }
  } catch (error) {
    if (error instanceof EraDiagnosticError && error.diagnostic.kind !== "CliInputError") failEra(error, json, { file, kind });
    throw error;
  }

  if (json) {
    console.log(JSON.stringify({
      ok: true,
      kind,
      file,
      state: report.state,
      reportHash: report.reportHash,
      integrity: true,
      stateRequirementMet: required === null ? null : true,
      authenticated: authentication !== null,
      integrityOnly,
      required,
      attestation: authentication,
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
    console.log(authentication ? `AUTHENTICATED REPORT ${file}` : `INTEGRITY OK (UNAUTHENTICATED) ${file}`);
    console.log(`Kind: ${kind}`);
    console.log(`Claimed state: ${report.state}`);
    console.log(`Report hash: ${report.reportHash}`);
    if (kind === "rescue") console.log(`Unsafe boundaries: ${unsafeBoundaryCount(report)}`);
    else {
      const multichain = report as MultichainVerificationReport;
      console.log(`Chain: ${multichain.family}/${multichain.profileId}`);
      console.log(`Backend: ${multichain.backend}`);
      console.log(`Evidence refs: ${multichain.evidence.length}`);
    }
    console.log(integrityOnly ? "Claimed-state gate: not evaluated" : `Claimed-state gate: ${required} or stronger`);
    console.log(authentication
      ? `Authentication: Ed25519 issuer ${authentication.issuer} (${authentication.keyId}), valid until ${authentication.expiresAt}`
      : "Authentication: not provided; report state is an unauthenticated claim");
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

try {
switch (command) {
  case "build": {
    const buildFile = args[1];
    if (buildFile && !buildFile.startsWith("-")) {
      validateOptions(args.slice(2), [], ["-o"]);
      build(requireFile(buildFile), args.slice(2));
    } else {
      if (buildFile) {
        console.error(
          "EraScript: project build uses era.json outDir; build options require an explicit .era file.",
        );
        process.exit(2);
      }
      buildProject(requireProjectOrExit());
    }
    break;
  }
  case "run": {
    const input = resolveOptionalProjectFile(args[1]);
    validateOptions(args.slice(input.consumed ? 2 : 1), [], [], true);
    run(input.file, args.slice(input.consumed ? 2 : 1));
    break;
  }
  case "check": {
    const input = resolveOptionalProjectFile(args[1]);
    validateOptions(args.slice(input.consumed ? 2 : 1), ["--json"]);
    const file = input.file;
    const json = args.slice(input.consumed ? 2 : 1).includes("--json");
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
  case "verify": {
    if (!args[1] || args[1].startsWith("-")) cliError("era verify requires a report file.");
    validateOptions(args.slice(2), ["--json", "--integrity-only"], ["--require", "--attestation", "--trusted-key"]);
    if (args.includes("--integrity-only") && args.includes("--require")) cliError("--integrity-only and --require cannot be combined.");
    verifyReport(requireFile(args[1]), args.slice(2));
    break;
  }
  case "transpile": {
    validateOptions(args.slice(2), []);
    const file = requireFile(args[1]);
    const result = compile(readSource(file), { fileName: file, sourceMap: false });
    if (result.diagnostics.length) failDiagnostics(result.diagnostics.map(typescriptDiagnosticToEra));
    process.stdout.write(result.typescript);
    break;
  }
  case "init":
    if (args[1]?.startsWith("-")) cliError("era init expects a directory.");
    validateOptions(args.slice(2), []);
    init(args[1]); break;
  default:
    cliError(`Unknown command: ${command}`);
}
} catch (error) {
  const diagnostic: EraDiagnostic = error instanceof EraDiagnosticError ? error.diagnostic : {
    code: "ES4906", severity: "error", kind: "CliOperationFailed", message: "EraScript could not complete the operation; check input paths and permissions.",
  };
  if (args.includes("--json")) console.log(diagnosticsJson([diagnostic]));
  else console.error(formatEraDiagnostic(diagnostic));
  process.exit(2);
}
