import ts from "typescript";
import { transformEraScript } from "./transform.js";

export interface CompileOptions {
  fileName?: string;
  sourceMap?: boolean;
  target?: ts.ScriptTarget;
  module?: ts.ModuleKind;
}

export interface CompileResult {
  typescript: string;
  javascript: string;
  sourceMap?: string;
  diagnostics: readonly ts.Diagnostic[];
  features: string[];
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const transformed = transformEraScript(source);
  const fileName = options.fileName ?? "module.era";
  const result = ts.transpileModule(transformed.code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: options.target ?? ts.ScriptTarget.ES2022,
      module: options.module ?? ts.ModuleKind.ESNext,
      strict: true,
      sourceMap: options.sourceMap ?? true,
      inlineSources: options.sourceMap ?? true,
    },
  });

  return {
    typescript: transformed.code,
    javascript: result.outputText,
    ...(result.sourceMapText ? { sourceMap: result.sourceMapText } : {}),
    diagnostics: result.diagnostics ?? [],
    features: transformed.features,
  };
}

export function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${pos.line + 1}:${pos.character + 1} - ${message}`;
}
