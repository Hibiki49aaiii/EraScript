import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";
import type { EraDiagnostic } from "./diagnostics.js";
import { remapTypeScriptDiagnostics } from "./frontend/diagnostics.js";
import { createOriginalLocationResolver } from "./frontend/source-map.js";
import {
  transformEraScriptDetailed,
  type DetailedTransformResult,
} from "./frontend/transform.js";
import { analyzeWeb3Source } from "./web3/analyze.js";
import type { UnsafeBoundaryAudit } from "./web3/unsafe.js";

export interface CheckResult {
  typescript: string;
  diagnostics: readonly ts.Diagnostic[];
  eraDiagnostics: readonly EraDiagnostic[];
  unsafeBoundaries: readonly UnsafeBoundaryAudit[];
  features: string[];
}

interface EraModuleContext {
  readonly originalFileName: string;
  readonly virtualFileName: string;
  readonly source: string;
  readonly transformed: DetailedTransformResult;
}

const virtualSuffix = ".__erascript__.ts";

function toVirtualFileName(originalFileName: string): string {
  return `${originalFileName}${virtualSuffix}`;
}

function fromVirtualFileName(virtualFileName: string): string | undefined {
  return virtualFileName.endsWith(virtualSuffix)
    ? virtualFileName.slice(0, -virtualSuffix.length)
    : undefined;
}

function isRelativeOrAbsoluteEraSpecifier(specifier: string): boolean {
  return (
    specifier.toLowerCase().endsWith(".era") &&
    (specifier.startsWith(".") || isAbsolute(specifier))
  );
}

export function typecheck(source: string, fileName = "module.era"): CheckResult {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };

  const contexts = new Map<string, EraModuleContext>();

  const registerContext = (
    originalFileName: string,
    moduleSource: string,
  ): EraModuleContext => {
    const virtualFileName = toVirtualFileName(originalFileName);
    const existing = contexts.get(virtualFileName);
    if (existing) return existing;
    const context: EraModuleContext = {
      originalFileName,
      virtualFileName,
      source: moduleSource,
      transformed: transformEraScriptDetailed(moduleSource),
    };
    contexts.set(virtualFileName, context);
    return context;
  };

  const entry = registerContext(fileName, source);

  const loadContext = (virtualFileName: string): EraModuleContext | undefined => {
    const existing = contexts.get(virtualFileName);
    if (existing) return existing;
    const originalFileName = fromVirtualFileName(virtualFileName);
    if (!originalFileName || !existsSync(originalFileName)) return undefined;
    return registerContext(originalFileName, readFileSync(originalFileName, "utf8"));
  };

  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.fileExists = (name) => {
    if (contexts.has(name)) return true;
    const originalFileName = fromVirtualFileName(name);
    return originalFileName
      ? existsSync(originalFileName)
      : originalFileExists(name);
  };

  host.readFile = (name) => {
    const context = loadContext(name);
    return context ? context.transformed.code : originalReadFile(name);
  };

  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const context = loadContext(name);
    if (context) {
      return ts.createSourceFile(
        name,
        context.transformed.code,
        languageVersion,
        true,
        ts.ScriptKind.TS,
      );
    }
    return originalGetSourceFile(
      name,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    );
  };

  host.resolveModuleNames = (moduleNames, containingFile) => {
    const containingOriginal =
      contexts.get(containingFile)?.originalFileName ??
      fromVirtualFileName(containingFile) ??
      containingFile;

    return moduleNames.map((moduleName) => {
      if (isRelativeOrAbsoluteEraSpecifier(moduleName)) {
        const originalFileName = isAbsolute(moduleName)
          ? moduleName
          : resolve(dirname(containingOriginal), moduleName);
        const virtualFileName = toVirtualFileName(originalFileName);
        if (contexts.has(virtualFileName) || existsSync(originalFileName)) {
          loadContext(virtualFileName);
          return {
            resolvedFileName: virtualFileName,
            extension: ts.Extension.Ts,
            isExternalLibraryImport: false,
          };
        }
        return undefined;
      }

      return ts.resolveModuleName(
        moduleName,
        containingFile,
        options,
        host,
      ).resolvedModule;
    });
  };

  const program = ts.createProgram([entry.virtualFileName], options, host);
  let diagnostics: readonly ts.Diagnostic[] = ts.getPreEmitDiagnostics(program);

  for (const context of contexts.values()) {
    diagnostics = remapTypeScriptDiagnostics(diagnostics, {
      map: context.transformed.coordinateMap,
      originalSource: context.source,
      originalFileName: context.originalFileName,
      transformedFileName: context.virtualFileName,
    });
  }

  const eraDiagnostics: EraDiagnostic[] = [];
  const unsafeBoundaries: UnsafeBoundaryAudit[] = [];
  const features = new Set<string>();

  for (const context of contexts.values()) {
    for (const feature of context.transformed.features) features.add(feature);
    const resolveOriginalLocation = createOriginalLocationResolver({
      map: context.transformed.coordinateMap,
      source: context.source,
      fileName: context.originalFileName,
    });
    const analysis = analyzeWeb3Source(
      context.transformed.code,
      context.virtualFileName,
      resolveOriginalLocation,
    );
    eraDiagnostics.push(...analysis.diagnostics);
    unsafeBoundaries.push(...analysis.unsafeBoundaries);
  }

  return {
    typescript: entry.transformed.code,
    diagnostics,
    eraDiagnostics,
    unsafeBoundaries,
    features: [...features].sort(),
  };
}
