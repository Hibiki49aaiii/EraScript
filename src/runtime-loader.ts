import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compile, formatDiagnostic } from "./compiler.js";

interface EraLoaderContext {
  readonly format?: string | null;
  readonly conditions?: readonly string[];
  readonly importAttributes?: Readonly<Record<string, string>>;
}

interface EraLoaderResult {
  readonly format?: string | null;
  readonly source?: string | ArrayBuffer | ArrayBufferView;
  readonly shortCircuit?: boolean;
}

type NextLoad = (
  url: string,
  context: EraLoaderContext,
) => Promise<EraLoaderResult>;

const sourceMapComment = /\/\/# sourceMappingURL=.*(?:\r?\n)?$/;

export async function load(
  url: string,
  context: EraLoaderContext,
  nextLoad: NextLoad,
): Promise<EraLoaderResult> {
  if (!url.startsWith("file:")) return nextLoad(url, context);

  const fileName = fileURLToPath(url);
  if (!fileName.toLowerCase().endsWith(".era")) {
    return nextLoad(url, context);
  }

  const source = await readFile(fileName, "utf8");
  const result = compile(source, {
    fileName,
    sourceMap: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  });

  const errors = result.diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(errors.map(formatDiagnostic).join("\n"));
  }
  if (!result.sourceMap) {
    throw new Error(
      `EraScript loader requested a source map but the compiler did not produce one for ${fileName}.`,
    );
  }

  const javascript = result.javascript.replace(sourceMapComment, "").replace(/\s*$/, "");
  const inlineMap = Buffer.from(result.sourceMap, "utf8").toString("base64");

  return {
    format: "module",
    shortCircuit: true,
    source: `${javascript}\n//# sourceMappingURL=data:application/json;base64,${inlineMap}\n`,
  };
}
