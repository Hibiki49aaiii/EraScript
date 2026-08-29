import type { SourceEdit } from "./ast.js";
import { validateSourceEdits } from "./apply-edits.js";

export type SourceMapBias = "left" | "right";

export interface SourceCoordinateSegment {
  readonly kind: "unchanged" | "replacement";
  readonly originalStart: number;
  readonly originalEnd: number;
  /**
   * Replacement edits may absorb formatting characters that are not the
   * semantic source of the generated token. Example: " ->" becomes ":" but
   * diagnostics for ":" should point at "->", not the preceding space.
   */
  readonly originalAnchorStart?: number;
  readonly originalAnchorEnd?: number;
  readonly transformedStart: number;
  readonly transformedEnd: number;
}

export interface SourceCoordinateRange {
  readonly start: number;
  readonly end: number;
  readonly length: number;
}

function assertOffset(value: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} offset ${value} is outside [0, ${max}].`);
  }
}

function findSegment(
  segments: readonly SourceCoordinateSegment[],
  offset: number,
  side: "original" | "transformed",
): SourceCoordinateSegment | undefined {
  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const segment = segments[mid]!;
    const start = side === "original" ? segment.originalStart : segment.transformedStart;
    const end = side === "original" ? segment.originalEnd : segment.transformedEnd;

    if (offset < start) {
      high = mid - 1;
      continue;
    }
    if (offset >= end) {
      low = mid + 1;
      continue;
    }
    return segment;
  }

  return undefined;
}

export class EraSourceCoordinateMap {
  readonly originalLength: number;
  readonly transformedLength: number;
  readonly segments: readonly SourceCoordinateSegment[];

  constructor(
    originalLength: number,
    transformedLength: number,
    segments: readonly SourceCoordinateSegment[],
  ) {
    if (!Number.isSafeInteger(originalLength) || originalLength < 0) {
      throw new RangeError("Original source length must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(transformedLength) || transformedLength < 0) {
      throw new RangeError("Transformed source length must be a non-negative safe integer.");
    }

    let previousOriginalEnd = 0;
    let previousTransformedEnd = 0;
    for (const segment of segments) {
      if (
        segment.originalStart !== previousOriginalEnd ||
        segment.transformedStart !== previousTransformedEnd ||
        segment.originalEnd < segment.originalStart ||
        segment.transformedEnd < segment.transformedStart
      ) {
        throw new Error("Source coordinate segments must be contiguous and monotonic.");
      }
      if (
        segment.kind === "unchanged" &&
        segment.originalEnd - segment.originalStart !==
          segment.transformedEnd - segment.transformedStart
      ) {
        throw new Error("Unchanged source coordinate segments must have equal lengths.");
      }
      if (
        segment.originalAnchorStart !== undefined ||
        segment.originalAnchorEnd !== undefined
      ) {
        if (
          segment.kind !== "replacement" ||
          segment.originalAnchorStart === undefined ||
          segment.originalAnchorEnd === undefined ||
          segment.originalAnchorStart < segment.originalStart ||
          segment.originalAnchorEnd > segment.originalEnd ||
          segment.originalAnchorStart >= segment.originalAnchorEnd
        ) {
          throw new Error("Replacement source anchors must be a non-empty range inside the original segment.");
        }
      }
      previousOriginalEnd = segment.originalEnd;
      previousTransformedEnd = segment.transformedEnd;
    }

    if (
      previousOriginalEnd !== originalLength ||
      previousTransformedEnd !== transformedLength
    ) {
      throw new Error("Source coordinate segments do not cover the complete source.");
    }

    this.originalLength = originalLength;
    this.transformedLength = transformedLength;
    this.segments = [...segments];
  }

  toOriginal(offset: number, bias: SourceMapBias = "left"): number {
    assertOffset(offset, this.transformedLength, "Transformed");
    if (offset === this.transformedLength) return this.originalLength;

    const segment = findSegment(this.segments, offset, "transformed");
    if (!segment) {
      // Only zero-length replacement segments can leave no transformed interval.
      // At that boundary, the following segment (if any) represents the original
      // post-edit position. This is the only meaningful generated coordinate.
      const next = this.segments.find((item) => item.transformedStart === offset);
      if (next) return bias === "left" ? next.originalStart : next.originalStart;
      throw new Error(`No source coordinate segment contains transformed offset ${offset}.`);
    }

    if (segment.kind === "unchanged") {
      return segment.originalStart + (offset - segment.transformedStart);
    }
    const anchorStart = segment.originalAnchorStart ?? segment.originalStart;
    const anchorEnd = segment.originalAnchorEnd ?? segment.originalEnd;
    return bias === "left" ? anchorStart : anchorEnd;
  }

  toTransformed(offset: number, bias: SourceMapBias = "left"): number {
    assertOffset(offset, this.originalLength, "Original");
    if (offset === this.originalLength) return this.transformedLength;

    const segment = findSegment(this.segments, offset, "original");
    if (!segment) {
      const next = this.segments.find((item) => item.originalStart === offset);
      if (next) return next.transformedStart;
      throw new Error(`No source coordinate segment contains original offset ${offset}.`);
    }

    if (segment.kind === "unchanged") {
      return segment.transformedStart + (offset - segment.originalStart);
    }
    return bias === "left" ? segment.transformedStart : segment.transformedEnd;
  }

  transformedRangeToOriginal(start: number, length: number): SourceCoordinateRange {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError("Diagnostic/source range length must be a non-negative safe integer.");
    }
    const end = start + length;
    assertOffset(start, this.transformedLength, "Transformed range start");
    assertOffset(end, this.transformedLength, "Transformed range end");
    const mappedStart = this.toOriginal(start, "left");
    const mappedEnd = this.toOriginal(end, "right");
    return {
      start: mappedStart,
      end: Math.max(mappedStart, mappedEnd),
      length: Math.max(0, mappedEnd - mappedStart),
    };
  }
}

export function createSourceCoordinateMap(
  source: string,
  edits: readonly SourceEdit[],
): EraSourceCoordinateMap {
  const sorted = validateSourceEdits(source, edits);
  const segments: SourceCoordinateSegment[] = [];

  let originalCursor = 0;
  let transformedCursor = 0;

  for (const edit of sorted) {
    if (edit.start > originalCursor) {
      const length = edit.start - originalCursor;
      segments.push({
        kind: "unchanged",
        originalStart: originalCursor,
        originalEnd: edit.start,
        transformedStart: transformedCursor,
        transformedEnd: transformedCursor + length,
      });
      transformedCursor += length;
    }

    const originalText = source.slice(edit.start, edit.end);
    const semanticAnchor =
      edit.feature === "return-arrow"
        ? (() => {
            const arrowOffset = originalText.indexOf("->");
            return arrowOffset >= 0
              ? {
                  originalAnchorStart: edit.start + arrowOffset,
                  originalAnchorEnd: edit.start + arrowOffset + 2,
                }
              : {};
          })()
        : {};

    segments.push({
      kind: "replacement",
      originalStart: edit.start,
      originalEnd: edit.end,
      ...semanticAnchor,
      transformedStart: transformedCursor,
      transformedEnd: transformedCursor + edit.replacement.length,
    });

    originalCursor = edit.end;
    transformedCursor += edit.replacement.length;
  }

  if (originalCursor < source.length) {
    const length = source.length - originalCursor;
    segments.push({
      kind: "unchanged",
      originalStart: originalCursor,
      originalEnd: source.length,
      transformedStart: transformedCursor,
      transformedEnd: transformedCursor + length,
    });
    transformedCursor += length;
  }

  if (source.length === 0 && segments.length === 0) {
    return new EraSourceCoordinateMap(0, 0, []);
  }

  return new EraSourceCoordinateMap(source.length, transformedCursor, segments);
}

export interface OriginalSourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13 /* \r */) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (code === 10 /* \n */) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineAndColumn(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = starts[mid]!;
    if (value <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - starts[lineIndex]! + 1,
  };
}

export function createOriginalLocationResolver(input: {
  readonly map: EraSourceCoordinateMap;
  readonly source: string;
  readonly fileName: string;
}): (transformedOffset: number) => OriginalSourceLocation {
  const starts = lineStarts(input.source);
  return (transformedOffset) => {
    const originalOffset = input.map.toOriginal(transformedOffset, "left");
    const position = lineAndColumn(starts, originalOffset);
    return { file: input.fileName, ...position };
  };
}
