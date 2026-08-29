import type { SourceEdit } from "./ast.js";

export class EraFrontendInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EraFrontendInvariantError";
  }
}

export function validateSourceEdits(source: string, edits: readonly SourceEdit[]): SourceEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);

  let previousEnd = -1;
  for (const edit of sorted) {
    if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end)) {
      throw new EraFrontendInvariantError("EraScript source edit offsets must be safe integers.");
    }
    if (edit.start < 0 || edit.end > source.length || edit.start >= edit.end) {
      throw new EraFrontendInvariantError(
        `Invalid EraScript source edit range [${edit.start}, ${edit.end}) for source length ${source.length}.`,
      );
    }
    if (edit.start < previousEnd) {
      throw new EraFrontendInvariantError(
        `Overlapping EraScript source edits detected at offset ${edit.start}.`,
      );
    }
    previousEnd = edit.end;
  }

  return sorted;
}

export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  const sorted = validateSourceEdits(source, edits);
  let result = source;

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const edit = sorted[index]!;
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }

  return result;
}
