import ts from "typescript";
import { transformEraScript } from "./transform.js";

export interface CheckResult {
  typescript: string;
  diagnostics: readonly ts.Diagnostic[];
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
  return { typescript: transformed.code, diagnostics, features: transformed.features };
}
