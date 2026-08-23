import ts from "typescript";

export type EraSeverity = "error" | "warning" | "info";

export interface EraDiagnostic {
  code: string;
  severity: EraSeverity;
  kind: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  path?: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}

export class EraDiagnosticError extends Error {
  readonly diagnostic: EraDiagnostic;

  constructor(diagnostic: EraDiagnostic) {
    super(diagnostic.message);
    this.name = "EraDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

export function typescriptDiagnosticToEra(diagnostic: ts.Diagnostic): EraDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const severity: EraSeverity = diagnostic.category === ts.DiagnosticCategory.Warning
    ? "warning"
    : diagnostic.category === ts.DiagnosticCategory.Message || diagnostic.category === ts.DiagnosticCategory.Suggestion
      ? "info"
      : "error";

  if (!diagnostic.file || diagnostic.start === undefined) {
    return {
      code: `TS${diagnostic.code}`,
      severity,
      kind: "TypeScript",
      message,
    };
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    code: `TS${diagnostic.code}`,
    severity,
    kind: "TypeScript",
    message,
    file: diagnostic.file.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

export function formatEraDiagnostic(diagnostic: EraDiagnostic): string {
  const location = diagnostic.file
    ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}` : ""} - `
    : "";
  const suggestion = diagnostic.suggestion ? `\nSuggestion: ${diagnostic.suggestion}` : "";
  return `${location}${diagnostic.code} ${diagnostic.kind}: ${diagnostic.message}${suggestion}`;
}

export function diagnosticsJson(diagnostics: readonly EraDiagnostic[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      diagnostics,
      ...extra,
    },
    null,
    2,
  );
}
