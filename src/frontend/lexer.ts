export type EraTokenKind =
  | "identifier"
  | "number"
  | "punctuation"
  | "whitespace"
  | "comment"
  | "string"
  | "regex"
  | "template-raw"
  | "template-expression-start"
  | "template-expression-end"
  | "other";

export interface EraToken {
  readonly kind: EraTokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const isIdentifierStart = (value: string | undefined): boolean =>
  !!value && /[A-Za-z_$]/.test(value);

const isIdentifierPart = (value: string | undefined): boolean =>
  !!value && /[A-Za-z0-9_$]/.test(value);

const isWhitespace = (value: string | undefined): boolean =>
  !!value && /\s/.test(value);

const multiPunctuation = [
  "===",
  "!==",
  "...",
  "?.",
  "=>",
  "->",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "++",
  "--",
  "**",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
] as const;

function previousNonTrivia(tokens: readonly EraToken[]): EraToken | undefined {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.kind !== "whitespace" && token.kind !== "comment" && token.kind !== "template-raw") {
      return token;
    }
  }
  return undefined;
}

function mayStartRegex(previous: EraToken | undefined): boolean {
  if (!previous) return true;

  if (previous.kind === "identifier") {
    return new Set([
      "return",
      "throw",
      "case",
      "delete",
      "void",
      "typeof",
      "new",
      "yield",
      "await",
      "in",
      "of",
    ]).has(previous.text);
  }

  if (previous.kind === "template-expression-start") return true;
  if (previous.kind !== "punctuation") return false;

  return new Set([
    "(",
    "[",
    "{",
    ",",
    ";",
    ":",
    "=",
    "==",
    "===",
    "!=",
    "!==",
    "!",
    "?",
    "??",
    "&&",
    "||",
    "=>",
  ]).has(previous.text);
}

export function lexEraScript(source: string): EraToken[] {
  const tokens: EraToken[] = [];

  const push = (kind: EraTokenKind, start: number, end: number): void => {
    if (end <= start) return;
    tokens.push({ kind, text: source.slice(start, end), start, end });
  };

  const scanQuoted = (start: number, quote: "'" | '"'): number => {
    let index = start + 1;
    while (index < source.length) {
      const current = source[index]!;
      if (current === "\\") {
        index = Math.min(source.length, index + 2);
        continue;
      }
      index += 1;
      if (current === quote) break;
    }
    push("string", start, index);
    return index;
  };

  const scanRegex = (start: number): number => {
    let index = start + 1;
    let inClass = false;

    while (index < source.length) {
      const current = source[index]!;
      if (current === "\\") {
        index = Math.min(source.length, index + 2);
        continue;
      }
      if (current === "[") {
        inClass = true;
        index += 1;
        continue;
      }
      if (current === "]" && inClass) {
        inClass = false;
        index += 1;
        continue;
      }
      if (current === "/" && !inClass) {
        index += 1;
        while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
        push("regex", start, index);
        return index;
      }
      if (current === "\n" || current === "\r") break;
      index += 1;
    }

    push("punctuation", start, start + 1);
    return start + 1;
  };

  const scanTemplate = (start: number): number => {
    let index = start + 1;
    let rawStart = start;

    while (index < source.length) {
      const current = source[index]!;
      if (current === "\\") {
        index = Math.min(source.length, index + 2);
        continue;
      }

      if (current === "`") {
        index += 1;
        push("template-raw", rawStart, index);
        return index;
      }

      if (current === "$" && source[index + 1] === "{") {
        push("template-raw", rawStart, index);
        push("template-expression-start", index, index + 2);
        index = scanCode(index + 2, true);
        rawStart = index;
        continue;
      }

      index += 1;
    }

    push("template-raw", rawStart, index);
    return index;
  };

  const scanCode = (start: number, stopAtTemplateBrace: boolean): number => {
    let index = start;
    let templateBraceDepth = 0;

    while (index < source.length) {
      const current = source[index]!;
      const next = source[index + 1];

      if (stopAtTemplateBrace && current === "}" && templateBraceDepth === 0) {
        push("template-expression-end", index, index + 1);
        return index + 1;
      }

      if (isWhitespace(current)) {
        const tokenStart = index;
        index += 1;
        while (isWhitespace(source[index])) index += 1;
        push("whitespace", tokenStart, index);
        continue;
      }

      if (current === "/" && next === "/") {
        const tokenStart = index;
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        push("comment", tokenStart, index);
        continue;
      }

      if (current === "/" && next === "*") {
        const tokenStart = index;
        index += 2;
        while (index < source.length) {
          if (source[index] === "*" && source[index + 1] === "/") {
            index += 2;
            break;
          }
          index += 1;
        }
        push("comment", tokenStart, index);
        continue;
      }

      if (current === "'" || current === '"') {
        index = scanQuoted(index, current);
        continue;
      }

      if (current === "`") {
        index = scanTemplate(index);
        continue;
      }

      if (current === "/" && next !== "=" && mayStartRegex(previousNonTrivia(tokens))) {
        index = scanRegex(index);
        continue;
      }

      if (isIdentifierStart(current)) {
        const tokenStart = index;
        index += 1;
        while (isIdentifierPart(source[index])) index += 1;
        push("identifier", tokenStart, index);
        continue;
      }

      if (/[0-9]/.test(current)) {
        const tokenStart = index;
        index += 1;
        while (/[A-Za-z0-9_.$]/.test(source[index] ?? "")) index += 1;
        push("number", tokenStart, index);
        continue;
      }

      const punctuation = multiPunctuation.find((value) =>
        source.startsWith(value, index)
      );
      if (punctuation) {
        push("punctuation", index, index + punctuation.length);
        index += punctuation.length;
        continue;
      }

      if (/[][(){}<>.,:;?=+\-*%&|!~^]/.test(current)) {
        if (stopAtTemplateBrace && current === "{") templateBraceDepth += 1;
        if (stopAtTemplateBrace && current === "}" && templateBraceDepth > 0) templateBraceDepth -= 1;
        push("punctuation", index, index + 1);
        index += 1;
        continue;
      }

      push("other", index, index + 1);
      index += 1;
    }

    return index;
  };

  scanCode(0, false);
  return tokens;
}
