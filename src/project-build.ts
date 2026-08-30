import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import ts from "typescript";
import { compile, formatDiagnostic } from "./compiler.js";
import { transformEraScriptDetailed } from "./frontend/transform.js";
import type { EraProject } from "./project.js";

export interface EraProjectBuildResult {
  readonly entryOutput: string;
  readonly moduleOutputs: readonly string[];
  readonly copiedAssets: readonly string[];
}

export class EraProjectBuildError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EraProjectBuildError";
    this.code = code;
  }
}

interface ModuleReference {
  readonly specifier: string;
  readonly start: number;
  readonly end: number;
}

interface EraBuildModule {
  readonly fileName: string;
  readonly source: string;
  readonly references: readonly ModuleReference[];
}

const copiedAssetExtensions = new Set([".js", ".mjs", ".cjs", ".json"]);

function projectRelativePath(project: EraProject, fileName: string): string {
  const relativePath = relative(project.root, fileName);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new EraProjectBuildError(
      "EraProjectPathEscape",
      `EraScript project module escapes project root: ${fileName}`,
    );
  }
  return relativePath;
}

function outputPathForEra(project: EraProject, fileName: string): string {
  const relativePath = projectRelativePath(project, fileName);
  if (!relativePath.toLowerCase().endsWith(".era")) {
    throw new EraProjectBuildError(
      "InvalidEraProjectModuleExtension",
      `EraScript project module must end in .era: ${fileName}`,
    );
  }
  const outputRelative = `${relativePath.slice(0, -4)}.mjs`;
  const output = resolve(project.outDir, outputRelative);
  const relativeOutput = relative(project.outDir, output);
  if (
    relativeOutput === ".." ||
    relativeOutput.startsWith(`..${sep}`) ||
    isAbsolute(relativeOutput)
  ) {
    throw new EraProjectBuildError(
      "EraProjectOutputEscape",
      `EraScript output path escapes outDir: ${output}`,
    );
  }
  return output;
}

function collectModuleReferences(
  code: string,
  fileName: string,
  scriptKind: ts.ScriptKind,
): ModuleReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const references: ModuleReference[] = [];

  const addString = (node: ts.StringLiteralLike): void => {
    const start = node.getStart(sourceFile) + 1;
    const end = node.getEnd() - 1;
    references.push({ specifier: node.text, start, end });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addString(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addString(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      addString(node.arguments[0]!);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

function assertReadableFile(fileName: string, label: string): void {
  if (!existsSync(fileName) || !statSync(fileName).isFile()) {
    throw new EraProjectBuildError(
      "MissingEraProjectDependency",
      `EraScript ${label} does not exist: ${fileName}`,
    );
  }
}

function rewriteEraSpecifiers(
  javascript: string,
  outputFileName: string,
): string {
  const references = collectModuleReferences(
    javascript,
    outputFileName,
    ts.ScriptKind.JS,
  ).filter((reference) =>
    reference.specifier.toLowerCase().endsWith(".era"),
  );

  let rewritten = javascript;
  for (const reference of [...references].sort((a, b) => b.start - a.start)) {
    const replacement =
      `${reference.specifier.slice(0, -4)}.mjs`;
    if (replacement.length !== reference.specifier.length) {
      throw new EraProjectBuildError(
        "NonLengthPreservingEraImportRewrite",
        `EraScript module rewrite must preserve source length: ${reference.specifier}`,
      );
    }
    rewritten =
      rewritten.slice(0, reference.start) +
      replacement +
      rewritten.slice(reference.end);
  }
  return rewritten;
}

export function buildEraProject(project: EraProject): EraProjectBuildResult {
  const modules = new Map<string, EraBuildModule>();
  const assets = new Set<string>();

  const visitEra = (fileName: string): void => {
    const absoluteFileName = resolve(fileName);
    projectRelativePath(project, absoluteFileName);
    if (modules.has(absoluteFileName)) return;
    assertReadableFile(absoluteFileName, "module");

    const source = readFileSync(absoluteFileName, "utf8");
    const transformed = transformEraScriptDetailed(source);
    const references = collectModuleReferences(
      transformed.code,
      `${absoluteFileName}.ts`,
      ts.ScriptKind.TS,
    );
    modules.set(absoluteFileName, {
      fileName: absoluteFileName,
      source,
      references,
    });

    for (const reference of references) {
      const specifier = reference.specifier;
      if (specifier.toLowerCase().endsWith(".era")) {
        if (!specifier.startsWith(".") || isAbsolute(specifier)) {
          throw new EraProjectBuildError(
            "UnsupportedEraProjectModuleSpecifier",
            `EraScript project build requires relative .era imports: ${specifier}`,
          );
        }
        const dependency = resolve(dirname(absoluteFileName), specifier);
        projectRelativePath(project, dependency);
        visitEra(dependency);
        continue;
      }

      if (!specifier.startsWith(".")) continue;
      const extension = extname(specifier).toLowerCase();
      if (!copiedAssetExtensions.has(extension)) {
        throw new EraProjectBuildError(
          "UnsupportedEraProjectLocalImport",
          `EraScript project build cannot emit relative import '${specifier}'. Use explicit .era/.js/.mjs/.cjs/.json modules.`,
        );
      }
      const asset = resolve(dirname(absoluteFileName), specifier);
      projectRelativePath(project, asset);
      assertReadableFile(asset, "local dependency");
      assets.add(asset);
    }
  };

  visitEra(project.entry);

  mkdirSync(project.outDir, { recursive: true });

  const moduleOutputs: string[] = [];
  for (const module of [...modules.values()].sort((a, b) =>
    a.fileName.localeCompare(b.fileName),
  )) {
    const output = outputPathForEra(project, module.fileName);
    const result = compile(module.source, {
      fileName: module.fileName,
      sourceMap: true,
      outputFileName: basename(output),
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    });
    const errors = result.diagnostics.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      throw new EraProjectBuildError(
        "EraProjectCompileFailed",
        errors.map(formatDiagnostic).join("\n"),
      );
    }
    if (!result.sourceMap) {
      throw new EraProjectBuildError(
        "MissingEraProjectSourceMap",
        `EraScript compiler did not produce a source map for ${module.fileName}.`,
      );
    }

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      rewriteEraSpecifiers(result.javascript, output),
      "utf8",
    );
    writeFileSync(`${output}.map`, result.sourceMap, "utf8");
    moduleOutputs.push(output);
  }

  const copiedAssets: string[] = [];
  for (const asset of [...assets].sort()) {
    const output = resolve(
      project.outDir,
      projectRelativePath(project, asset),
    );
    mkdirSync(dirname(output), { recursive: true });
    if (resolve(asset) !== resolve(output)) copyFileSync(asset, output);
    copiedAssets.push(output);
  }

  return {
    entryOutput: outputPathForEra(project, project.entry),
    moduleOutputs,
    copiedAssets,
  };
}
