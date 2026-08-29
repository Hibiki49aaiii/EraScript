import type { EraSourceCoordinateMap } from "./source-map.js";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64].map((character, index) => [character, index]));

export interface SourceMapV3 {
  readonly version: 3;
  readonly file?: string;
  readonly sourceRoot?: string;
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
  readonly sourcesContent?: readonly (string | null)[];
}

export interface DecodedSourceMapSegment {
  readonly generatedColumn: number;
  readonly source?: number;
  readonly originalLine?: number;
  readonly originalColumn?: number;
  readonly name?: number;
}

export type DecodedSourceMapMappings = readonly (readonly DecodedSourceMapSegment[])[];

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Source Map V3 ${label} must be a safe integer.`);
  }
  return value as number;
}

function decodeVlq(segment: string): number[] {
  if (!segment) throw new Error("Source Map V3 contains an empty VLQ segment.");
  const values: number[] = [];
  let cursor = 0;

  while (cursor < segment.length) {
    let encoded = 0;
    let factor = 1;
    let continuation = true;

    while (continuation) {
      if (cursor >= segment.length) {
        throw new Error("Source Map V3 VLQ value ended before its continuation bit cleared.");
      }
      const character = segment[cursor++]!;
      const digit = BASE64_VALUES.get(character);
      if (digit === undefined) {
        throw new Error(`Source Map V3 contains invalid Base64 VLQ character '${character}'.`);
      }
      continuation = digit >= 32;
      encoded += (digit % 32) * factor;
      factor *= 32;
      if (!Number.isSafeInteger(encoded) || !Number.isSafeInteger(factor)) {
        throw new Error("Source Map V3 VLQ value exceeds safe integer range.");
      }
    }

    const negative = encoded % 2 === 1;
    const magnitude = Math.floor(encoded / 2);
    values.push(negative ? -magnitude : magnitude);
  }

  return values;
}

function encodeVlqValue(value: number): string {
  integer(value, "VLQ value");
  const encodedSigned = value < 0 ? (-value * 2) + 1 : value * 2;
  if (!Number.isSafeInteger(encodedSigned)) {
    throw new Error("Source Map V3 VLQ signed value exceeds safe integer range.");
  }

  let remaining = encodedSigned;
  let output = "";
  do {
    const payload = remaining % 32;
    remaining = Math.floor(remaining / 32);
    const digit = remaining > 0 ? payload + 32 : payload;
    output += BASE64[digit]!;
  } while (remaining > 0);
  return output;
}

function encodeVlq(values: readonly number[]): string {
  return values.map(encodeVlqValue).join("");
}

export function parseSourceMapV3(text: string): SourceMapV3 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Source Map V3 is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source Map V3 root must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 3) throw new Error("Only Source Map V3 is supported.");
  if (!Array.isArray(record.sources) || record.sources.some((item) => typeof item !== "string")) {
    throw new Error("Source Map V3 sources must be a string array.");
  }
  if (!Array.isArray(record.names) || record.names.some((item) => typeof item !== "string")) {
    throw new Error("Source Map V3 names must be a string array.");
  }
  if (typeof record.mappings !== "string") {
    throw new Error("Source Map V3 mappings must be a string.");
  }
  if (
    record.sourcesContent !== undefined &&
    (!Array.isArray(record.sourcesContent) ||
      record.sourcesContent.some((item) => item !== null && typeof item !== "string"))
  ) {
    throw new Error("Source Map V3 sourcesContent must be an array of strings/null.");
  }
  if (record.file !== undefined && typeof record.file !== "string") {
    throw new Error("Source Map V3 file must be a string when present.");
  }
  if (record.sourceRoot !== undefined && typeof record.sourceRoot !== "string") {
    throw new Error("Source Map V3 sourceRoot must be a string when present.");
  }

  return {
    version: 3,
    ...(typeof record.file === "string" ? { file: record.file } : {}),
    ...(typeof record.sourceRoot === "string" ? { sourceRoot: record.sourceRoot } : {}),
    sources: record.sources as string[],
    names: record.names as string[],
    mappings: record.mappings,
    ...(record.sourcesContent !== undefined
      ? { sourcesContent: record.sourcesContent as (string | null)[] }
      : {}),
  };
}

export function decodeSourceMapMappings(map: SourceMapV3): DecodedSourceMapMappings {
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;

  return map.mappings.split(";").map((line, lineIndex) => {
    if (!line) return [];
    let previousGeneratedColumn = 0;

    return line.split(",").map((encoded, segmentIndex): DecodedSourceMapSegment => {
      const values = decodeVlq(encoded);
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
        throw new Error(
          `Source Map V3 line ${lineIndex + 1} segment ${segmentIndex + 1} has unsupported field count ${values.length}.`,
        );
      }

      const generatedColumn = previousGeneratedColumn + values[0]!;
      if (generatedColumn < previousGeneratedColumn || generatedColumn < 0) {
        throw new Error("Source Map V3 generated columns must be non-negative and monotonic within each line.");
      }
      previousGeneratedColumn = generatedColumn;

      if (values.length === 1) return { generatedColumn };

      previousSource += values[1]!;
      previousOriginalLine += values[2]!;
      previousOriginalColumn += values[3]!;
      if (previousSource < 0 || previousOriginalLine < 0 || previousOriginalColumn < 0) {
        throw new Error("Source Map V3 decoded source/original coordinates must be non-negative.");
      }
      if (previousSource >= map.sources.length) {
        throw new Error(
          `Source Map V3 decoded source index ${previousSource} is outside sources[0..${Math.max(0, map.sources.length - 1)}].`,
        );
      }

      if (values.length === 5) {
        previousName += values[4]!;
        if (previousName < 0) throw new Error("Source Map V3 decoded name index must be non-negative.");
        if (previousName >= map.names.length) {
          throw new Error(
            `Source Map V3 decoded name index ${previousName} is outside names[0..${Math.max(0, map.names.length - 1)}].`,
          );
        }
        return {
          generatedColumn,
          source: previousSource,
          originalLine: previousOriginalLine,
          originalColumn: previousOriginalColumn,
          name: previousName,
        };
      }

      return {
        generatedColumn,
        source: previousSource,
        originalLine: previousOriginalLine,
        originalColumn: previousOriginalColumn,
      };
    });
  });
}

export function encodeSourceMapMappings(lines: DecodedSourceMapMappings): string {
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;

  return lines.map((line) => {
    let previousGeneratedColumn = 0;
    return line.map((segment) => {
      integer(segment.generatedColumn, "generated column");
      if (segment.generatedColumn < previousGeneratedColumn || segment.generatedColumn < 0) {
        throw new Error("Source Map V3 generated columns must be non-negative and monotonic within each line.");
      }
      const generatedDelta = segment.generatedColumn - previousGeneratedColumn;
      previousGeneratedColumn = segment.generatedColumn;

      if (segment.source === undefined) {
        if (
          segment.originalLine !== undefined ||
          segment.originalColumn !== undefined ||
          segment.name !== undefined
        ) {
          throw new Error("Unmapped Source Map V3 segment cannot contain original/name fields.");
        }
        return encodeVlq([generatedDelta]);
      }

      if (segment.originalLine === undefined || segment.originalColumn === undefined) {
        throw new Error("Mapped Source Map V3 segment requires source/original line/original column.");
      }
      integer(segment.source, "source index");
      integer(segment.originalLine, "original line");
      integer(segment.originalColumn, "original column");
      if (segment.source < 0 || segment.originalLine < 0 || segment.originalColumn < 0) {
        throw new Error("Mapped Source Map V3 coordinates must be non-negative.");
      }

      const fields = [
        generatedDelta,
        segment.source - previousSource,
        segment.originalLine - previousOriginalLine,
        segment.originalColumn - previousOriginalColumn,
      ];
      previousSource = segment.source;
      previousOriginalLine = segment.originalLine;
      previousOriginalColumn = segment.originalColumn;

      if (segment.name !== undefined) {
        integer(segment.name, "name index");
        if (segment.name < 0) throw new Error("Source Map V3 name index must be non-negative.");
        fields.push(segment.name - previousName);
        previousName = segment.name;
      }
      return encodeVlq(fields);
    }).join(",");
  }).join(";");
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (code === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetFromLineColumn(
  source: string,
  starts: readonly number[],
  line: number,
  column: number,
): number {
  integer(line, "original line");
  integer(column, "original column");
  if (line < 0 || line >= starts.length || column < 0) {
    throw new Error(`Source Map V3 coordinate ${line}:${column} is outside the transformed source.`);
  }
  const offset = starts[line]! + column;
  const nextLineStart = line + 1 < starts.length ? starts[line + 1]! : source.length;
  if (offset > nextLineStart || offset > source.length) {
    throw new Error(`Source Map V3 coordinate ${line}:${column} exceeds the transformed source line.`);
  }
  return offset;
}

function lineColumnFromOffset(
  starts: readonly number[],
  sourceLength: number,
  offset: number,
): { line: number; column: number } {
  integer(offset, "source offset");
  if (offset < 0 || offset > sourceLength) {
    throw new Error(`Source offset ${offset} is outside [0, ${sourceLength}].`);
  }
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (starts[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const line = Math.max(0, high);
  return { line, column: offset - starts[line]! };
}

export function composeTypeScriptSourceMapToEraScript(input: {
  readonly emitterSourceMapText: string;
  readonly transformedSource: string;
  readonly originalSource: string;
  readonly originalFileName: string;
  readonly coordinateMap: EraSourceCoordinateMap;
  readonly generatedFileName?: string;
}): string {
  const emitter = parseSourceMapV3(input.emitterSourceMapText);
  if (emitter.sources.length !== 1) {
    throw new Error(
      `EraScript transpileModule source-map composition requires exactly one emitter source, received ${emitter.sources.length}.`,
    );
  }

  const transformedStarts = lineStarts(input.transformedSource);
  const originalStarts = lineStarts(input.originalSource);
  const decoded = decodeSourceMapMappings(emitter);

  const composed: DecodedSourceMapSegment[][] = decoded.map((line) =>
    line.map((segment) => {
      if (segment.source === undefined) return { generatedColumn: segment.generatedColumn };
      if (segment.source !== 0) {
        throw new Error(`EraScript source-map composition cannot remap emitter source index ${segment.source}.`);
      }
      if (segment.originalLine === undefined || segment.originalColumn === undefined) {
        throw new Error("Mapped emitter source-map segment is missing original coordinates.");
      }

      const transformedOffset = offsetFromLineColumn(
        input.transformedSource,
        transformedStarts,
        segment.originalLine,
        segment.originalColumn,
      );
      const originalOffset = input.coordinateMap.toOriginal(transformedOffset, "left");
      const original = lineColumnFromOffset(originalStarts, input.originalSource.length, originalOffset);

      return {
        generatedColumn: segment.generatedColumn,
        source: 0,
        originalLine: original.line,
        originalColumn: original.column,
        ...(segment.name !== undefined ? { name: segment.name } : {}),
      };
    }),
  );

  return JSON.stringify({
    version: 3,
    ...(input.generatedFileName !== undefined
      ? { file: input.generatedFileName }
      : emitter.file !== undefined
        ? { file: emitter.file }
        : {}),
    sources: [input.originalFileName],
    names: [...emitter.names],
    mappings: encodeSourceMapMappings(composed),
    sourcesContent: [input.originalSource],
  });
}
