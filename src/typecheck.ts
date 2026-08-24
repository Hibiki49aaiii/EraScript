import ts from "typescript";
import type { EraDiagnostic } from "./diagnostics.js";
import { transformEraScript } from "./transform.js";
import { analyzeWeb3Source } from "./web3/analyze.js";
import type { UnsafeBoundaryAudit } from "./web3/unsafe.js";

export interface CheckResult {
  typescript: string;
  diagnostics: readonly ts.Diagnostic[];
  eraDiagnostics: readonly EraDiagnostic[];
  unsafeBoundaries: readonly UnsafeBoundaryAudit[];
  features: string[];
}

export function typecheck(source: string, fileName = "module.era"): CheckResult {
  const transformed = transformEraScript(source);
  const virtualName = fileName.replace(/\.era$/i, ".ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };

  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.fileExists = (name) => name === virtualName || originalFileExists(name);
  host.readFile = (name) => name === virtualName ? transformed.code : originalReadFile(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === virtualName) {
      return ts.createSourceFile(name, transformed.code, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram([virtualName], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const analysis = analyzeWeb3Source(transformed.code, virtualName);

  return {
    typescript: transformed.code,
    diagnostics,
    eraDiagnostics: analysis.diagnostics,
    unsafeBoundaries: analysis.unsafeBoundaries,
    features: transformed.features,
  };
}
