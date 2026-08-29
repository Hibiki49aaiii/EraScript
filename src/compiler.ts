import ts from "typescript";
import { remapTypeScriptDiagnostics } from "./frontend/diagnostics.js";
import { composeTypeScriptSourceMapToEraScript } from "./frontend/source-map-v3.js";
import { transformEraScriptDetailed } from "./frontend/transform.js";

export interface CompileOptions {
  fileName?: string;
  sourceMap?: boolean;
  target?: ts.ScriptTarget;
  module?: ts.ModuleKind;
  /** Generated JavaScript filename used only for source-map metadata. */
  outputFileName?: string;
}

export interface CompileResult {
  typescript: string;
  javascript: string;
  sourceMap?: string;
  diagnostics: readonly ts.Diagnostic[];
  features: string[];
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const transformed = transformEraScriptDetailed(source);
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

  const sourceMap = result.sourceMapText
    ? composeTypeScriptSourceMapToEraScript({
        emitterSourceMapText: result.sourceMapText,
        transformedSource: transformed.code,
        originalSource: source,
        originalFileName: fileName,
        coordinateMap: transformed.coordinateMap,
        ...(options.outputFileName ? { generatedFileName: options.outputFileName } : {}),
      })
    : undefined;

  let javascript = result.outputText;
  if (sourceMap && options.outputFileName) {
    const mapName = `${options.outputFileName}.map`;
    const sourceMapComment = /\/\/# sourceMappingURL=.*(?:\r?\n)?$/;
    javascript = sourceMapComment.test(javascript)
      ? javascript.replace(sourceMapComment, `//# sourceMappingURL=${mapName}\n`)
      : `${javascript.replace(/\s*$/, "")}\n//# sourceMappingURL=${mapName}\n`;
  }

  return {
    typescript: transformed.code,
    javascript,
    ...(sourceMap ? { sourceMap } : {}),
    diagnostics: remapTypeScriptDiagnostics(result.diagnostics ?? [], {
      map: transformed.coordinateMap,
      originalSource: source,
      originalFileName: fileName,
      transformedFileName: fileName,
    }),
    features: transformed.features,
  };
}

export function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${pos.line + 1}:${pos.character + 1} - ${message}`;
}
