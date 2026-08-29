import ts from "typescript";
import type { EraSourceCoordinateMap } from "./source-map.js";

export interface TypeScriptDiagnosticRemapContext {
  readonly map: EraSourceCoordinateMap;
  readonly originalSource: string;
  readonly originalFileName: string;
  readonly transformedFileName: string;
}

function samePrimaryFile(
  diagnostic: ts.DiagnosticRelatedInformation,
  context: TypeScriptDiagnosticRemapContext,
): boolean {
  return diagnostic.file?.fileName === context.transformedFileName;
}

function remapRange(
  start: number,
  length: number | undefined,
  map: EraSourceCoordinateMap,
): { readonly start: number; readonly length?: number } {
  if (length === undefined || length === 0) {
    return {
      start: map.toOriginal(start, "left"),
      ...(length === 0 ? { length: 0 } : {}),
    };
  }

  const range = map.transformedRangeToOriginal(start, length);
  return { start: range.start, length: range.length };
}

function remapRelated(
  diagnostic: ts.DiagnosticRelatedInformation,
  context: TypeScriptDiagnosticRemapContext,
  originalSourceFile: ts.SourceFile,
): ts.DiagnosticRelatedInformation {
  if (
    !samePrimaryFile(diagnostic, context) ||
    diagnostic.start === undefined
  ) {
    return { ...diagnostic };
  }

  const range = remapRange(diagnostic.start, diagnostic.length, context.map);
  return {
    ...diagnostic,
    file: originalSourceFile,
    start: range.start,
    ...(range.length !== undefined ? { length: range.length } : {}),
  };
}

/**
 * Rebinds diagnostics emitted for the transformed primary TypeScript source to
 * the original EraScript SourceFile. Diagnostics belonging to dependencies or
 * the TypeScript standard library are deliberately left on their own files.
 */
export function remapTypeScriptDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  context: TypeScriptDiagnosticRemapContext,
): readonly ts.Diagnostic[] {
  const originalSourceFile = ts.createSourceFile(
    context.originalFileName,
    context.originalSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return diagnostics.map((diagnostic) => {
    if (
      !samePrimaryFile(diagnostic, context) ||
      diagnostic.start === undefined
    ) {
      return {
        ...diagnostic,
        ...(diagnostic.relatedInformation
          ? {
              relatedInformation: diagnostic.relatedInformation.map((related) =>
                remapRelated(related, context, originalSourceFile),
              ),
            }
          : {}),
      };
    }

    const range = remapRange(diagnostic.start, diagnostic.length, context.map);
    return {
      ...diagnostic,
      file: originalSourceFile,
      start: range.start,
      ...(range.length !== undefined ? { length: range.length } : {}),
      ...(diagnostic.relatedInformation
        ? {
            relatedInformation: diagnostic.relatedInformation.map((related) =>
              remapRelated(related, context, originalSourceFile),
            ),
          }
        : {}),
    };
  });
}
