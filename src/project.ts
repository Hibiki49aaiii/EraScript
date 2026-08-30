import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import process from "node:process";

export interface EraProject {
  readonly root: string;
  readonly configFile: string;
  readonly entry: string;
  readonly outDir: string;
}

export class EraProjectConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EraProjectConfigError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readProject(configFile: string): EraProject {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configFile, "utf8")) as unknown;
  } catch (error) {
    throw new EraProjectConfigError(
      "InvalidEraProjectConfig",
      `EraScript: failed to parse ${configFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(raw)) {
    throw new EraProjectConfigError(
      "InvalidEraProjectConfig",
      `EraScript: ${configFile} must contain a JSON object.`,
    );
  }

  if (typeof raw.entry !== "string" || raw.entry.trim().length === 0) {
    throw new EraProjectConfigError(
      "MissingEraProjectEntry",
      `EraScript: ${configFile} must define a non-empty string "entry".`,
    );
  }

  if (
    raw.outDir !== undefined &&
    (typeof raw.outDir !== "string" || raw.outDir.trim().length === 0)
  ) {
    throw new EraProjectConfigError(
      "InvalidEraProjectOutDir",
      `EraScript: ${configFile} "outDir" must be a non-empty string when provided.`,
    );
  }

  const root = dirname(configFile);
  const entry = resolve(root, raw.entry);
  if (extname(entry).toLowerCase() !== ".era") {
    throw new EraProjectConfigError(
      "InvalidEraProjectEntryExtension",
      `EraScript: project entry must be a .era file, got ${entry}.`,
    );
  }
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw new EraProjectConfigError(
      "MissingEraProjectEntryFile",
      `EraScript: project entry does not exist: ${entry}`,
    );
  }

  return {
    root,
    configFile,
    entry,
    outDir: resolve(root, typeof raw.outDir === "string" ? raw.outDir : "dist"),
  };
}

export function findEraProject(startDirectory = process.cwd()): EraProject | undefined {
  let directory = resolve(startDirectory);
  for (;;) {
    const configFile = join(directory, "era.json");
    if (existsSync(configFile)) return readProject(configFile);
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function requireEraProjectEntry(startDirectory = process.cwd()): string {
  const project = findEraProject(startDirectory);
  if (!project) {
    throw new EraProjectConfigError(
      "MissingEraProjectConfig",
      `EraScript: no explicit .era file was provided and no era.json was found from ${resolve(startDirectory)} upward.`,
    );
  }
  return project.entry;
}
