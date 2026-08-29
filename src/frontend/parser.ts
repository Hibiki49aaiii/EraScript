import type {
  EraFunctionKeywordNode,
  EraMutableBindingNode,
  EraNullableTypeNode,
  EraPublicModifierNode,
  EraReturnTypeArrowNode,
  EraSurfaceNode,
} from "./ast.js";
import type { EraToken } from "./lexer.js";

const ignoredForSyntax = new Set(["whitespace", "comment", "template-raw"]);

function isIgnored(token: EraToken): boolean {
  return ignoredForSyntax.has(token.kind);
}

function isToken(token: EraToken | undefined, text: string): boolean {
  return token?.text === text;
}

function isIdentifier(token: EraToken | undefined, text?: string): boolean {
  return token?.kind === "identifier" && (text === undefined || token.text === text);
}

function nextIndex(tokens: readonly EraToken[], index: number): number | undefined {
  const next = index + 1;
  return next < tokens.length ? next : undefined;
}

function previousIndex(tokens: readonly EraToken[], index: number): number | undefined {
  const previous = index - 1;
  return previous >= 0 ? previous : undefined;
}

function findMatching(
  tokens: readonly EraToken[],
  openIndex: number,
  open: string,
  close: string,
): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.text === open) depth += 1;
    if (token.text === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function skipAngleGroup(tokens: readonly EraToken[], index: number): number | undefined {
  if (!isToken(tokens[index], "<")) return index;
  const close = findMatching(tokens, index, "<", ">");
  return close === undefined ? undefined : close + 1;
}

function isMemberAccess(tokens: readonly EraToken[], index: number): boolean {
  const previous = previousIndex(tokens, index);
  return previous !== undefined && (isToken(tokens[previous], ".") || isToken(tokens[previous], "?."));
}

function nearestUnmatchedOpener(
  tokens: readonly EraToken[],
  beforeIndex: number,
): "(" | "[" | "{" | undefined {
  let paren = 0;
  let bracket = 0;
  let brace = 0;

  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.text === ")") {
      paren += 1;
      continue;
    }
    if (token.text === "]") {
      bracket += 1;
      continue;
    }
    if (token.text === "}") {
      brace += 1;
      continue;
    }
    if (token.text === "(") {
      if (paren > 0) {
        paren -= 1;
        continue;
      }
      if (bracket === 0 && brace === 0) return "(";
    }
    if (token.text === "[") {
      if (bracket > 0) {
        bracket -= 1;
        continue;
      }
      if (paren === 0 && brace === 0) return "[";
    }
    if (token.text === "{") {
      if (brace > 0) {
        brace -= 1;
        continue;
      }
      if (paren === 0 && bracket === 0) return "{";
    }
  }

  return undefined;
}

const expressionPrefixIdentifiers = new Set([
  "return",
  "throw",
  "yield",
  "await",
  "case",
  "default",
  "new",
  "void",
  "typeof",
  "delete",
  "instanceof",
  "in",
  "of",
]);

const expressionPrefixPunctuation = new Set([
  "=",
  "(",
  "[",
  ":",
  "?",
  "=>",
  "!",
  "~",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "&&",
  "||",
  "??",
  "&",
  "|",
  "^",
  "==",
  "===",
  "!=",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
]);

function anonymousExpressionPrefix(tokens: readonly EraToken[], fnIndex: number): boolean {
  let previous = previousIndex(tokens, fnIndex);
  if (previous === undefined) return false;

  if (isIdentifier(tokens[previous], "async")) {
    previous = previousIndex(tokens, previous);
    if (previous === undefined) return false;
  }

  const token = tokens[previous]!;
  if (token.kind === "template-expression-start") return true;
  if (token.kind === "identifier") {
    return expressionPrefixIdentifiers.has(token.text);
  }

  if (token.text === ",") {
    const opener = nearestUnmatchedOpener(tokens, previous);
    return opener === "(" || opener === "[";
  }

  return expressionPrefixPunctuation.has(token.text);
}

function namedFunctionPrefix(
  source: string,
  tokens: readonly EraToken[],
  fnIndex: number,
): boolean {
  let previous = previousIndex(tokens, fnIndex);
  if (previous === undefined) return true;

  if (isIdentifier(tokens[previous], "async")) {
    previous = previousIndex(tokens, previous);
    if (previous === undefined) return true;
  }

  const token = tokens[previous]!;
  if (token.kind === "template-expression-start") return true;
  if (token.kind === "identifier") {
    return token.text === "pub" ||
      token.text === "export" ||
      expressionPrefixIdentifiers.has(token.text);
  }

  if (
    new Set(["{", "}", ";"]).has(token.text) ||
    expressionPrefixPunctuation.has(token.text)
  ) {
    return true;
  }

  if (token.text === ",") {
    const opener = nearestUnmatchedOpener(tokens, previous);
    return opener === "(" || opener === "[";
  }

  return /[\r\n]/.test(source.slice(token.end, tokens[fnIndex]!.start));
}

function findBodyAfterType(
  tokens: readonly EraToken[],
  startIndex: number,
): number | undefined {
  let angle = 0;
  let bracket = 0;
  let paren = 0;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (token.text === "<") angle += 1;
    else if (token.text === ">" && angle > 0) angle -= 1;
    else if (token.text === "[") bracket += 1;
    else if (token.text === "]" && bracket > 0) bracket -= 1;
    else if (token.text === "(") paren += 1;
    else if (token.text === ")" && paren > 0) paren -= 1;
    else if (token.text === "{" && angle === 0 && bracket === 0 && paren === 0) return index;
    else if (
      angle === 0 &&
      bracket === 0 &&
      paren === 0 &&
      new Set([";", "=", "=>"]).has(token.text)
    ) {
      return undefined;
    }
  }

  return undefined;
}

interface ParsedFunction {
  readonly fnIndex: number;
  readonly closeParenIndex: number;
  readonly arrowIndex?: number;
  readonly bodyIndex: number;
}

function parseFunctionAt(source: string, tokens: readonly EraToken[], fnIndex: number): ParsedFunction | undefined {
  if (!isIdentifier(tokens[fnIndex], "fn") || isMemberAccess(tokens, fnIndex)) return undefined;

  let cursor = nextIndex(tokens, fnIndex);
  if (cursor === undefined) return undefined;

  let named = false;

  if (isIdentifier(tokens[cursor])) {
    named = true;
    cursor = nextIndex(tokens, cursor);
    if (cursor === undefined) return undefined;
  }

  if (isToken(tokens[cursor], "<")) {
    cursor = skipAngleGroup(tokens, cursor);
    if (cursor === undefined || cursor >= tokens.length) return undefined;
  }

  if (!isToken(tokens[cursor], "(")) return undefined;
  if (named) {
    if (!namedFunctionPrefix(source, tokens, fnIndex)) return undefined;
  } else if (!anonymousExpressionPrefix(tokens, fnIndex)) {
    return undefined;
  }

  const closeParenIndex = findMatching(tokens, cursor, "(", ")");
  if (closeParenIndex === undefined) return undefined;

  const afterParen = nextIndex(tokens, closeParenIndex);
  if (afterParen === undefined) return undefined;

  if (isToken(tokens[afterParen], "{")) {
    return { fnIndex, closeParenIndex, bodyIndex: afterParen };
  }

  if (isToken(tokens[afterParen], "->") || isToken(tokens[afterParen], ":")) {
    const bodyIndex = findBodyAfterType(tokens, afterParen + 1);
    if (bodyIndex === undefined) return undefined;
    return {
      fnIndex,
      closeParenIndex,
      ...(isToken(tokens[afterParen], "->") ? { arrowIndex: afterParen } : {}),
      bodyIndex,
    };
  }

  return undefined;
}

function publicModifierForFunction(
  source: string,
  tokens: readonly EraToken[],
  parsed: ParsedFunction,
): EraPublicModifierNode | undefined {
  let candidate = previousIndex(tokens, parsed.fnIndex);
  if (candidate === undefined) return undefined;

  if (isIdentifier(tokens[candidate], "async")) {
    candidate = previousIndex(tokens, candidate);
    if (candidate === undefined) return undefined;
  }

  if (!isIdentifier(tokens[candidate], "pub")) return undefined;

  const beforePub = previousIndex(tokens, candidate);
  if (beforePub !== undefined) {
    const previous = tokens[beforePub]!;
    const boundary = new Set(["{", "}", ";"]).has(previous.text) ||
      previous.kind === "template-expression-start" ||
      /[\r\n]/.test(source.slice(previous.end, tokens[candidate]!.start));
    if (!boundary) return undefined;
  }

  const token = tokens[candidate]!;
  return { kind: "public-modifier", feature: "pub", start: token.start, end: token.end };
}

function returnArrowNode(
  source: string,
  tokens: readonly EraToken[],
  parsed: ParsedFunction,
): EraReturnTypeArrowNode | undefined {
  if (parsed.arrowIndex === undefined) return undefined;

  const closeParen = tokens[parsed.closeParenIndex]!;
  const arrow = tokens[parsed.arrowIndex]!;
  const between = source.slice(closeParen.end, arrow.start);
  const start = /^[ \t]*$/.test(between) ? closeParen.end : arrow.start;

  return {
    kind: "return-type-arrow",
    feature: "return-arrow",
    start,
    end: arrow.end,
  };
}

function mutableDeclarationPrefix(
  source: string,
  tokens: readonly EraToken[],
  index: number,
): boolean {
  const previous = previousIndex(tokens, index);
  if (previous === undefined) return true;

  const token = tokens[previous]!;
  if (token.kind === "template-expression-start") return true;
  if (new Set(["{", "}", ";", "(", ",", ":"]).has(token.text)) return true;

  return /[\r\n]/.test(source.slice(token.end, tokens[index]!.start));
}

function parseMutableBindingAt(
  source: string,
  tokens: readonly EraToken[],
  index: number,
): EraMutableBindingNode | undefined {
  const token = tokens[index]!;
  if (
    !isIdentifier(token, "mut") ||
    isMemberAccess(tokens, index) ||
    !mutableDeclarationPrefix(source, tokens, index)
  ) return undefined;

  const bindingIndex = nextIndex(tokens, index);
  if (bindingIndex === undefined) return undefined;
  const binding = tokens[bindingIndex]!;

  let continuationIndex: number | undefined;
  let bindingEnd = binding.end;

  if (binding.kind === "identifier") {
    continuationIndex = nextIndex(tokens, bindingIndex);
  } else if (binding.text === "{" || binding.text === "[") {
    const close = findMatching(tokens, bindingIndex, binding.text, binding.text === "{" ? "}" : "]");
    if (close === undefined) return undefined;
    bindingEnd = tokens[close]!.end;
    continuationIndex = nextIndex(tokens, close);
  } else {
    return undefined;
  }

  if (continuationIndex === undefined) {
    return { kind: "mutable-binding", feature: "mut", start: token.start, end: token.end };
  }

  const continuation = tokens[continuationIndex]!;
  const allowed = new Set(["=", ":", ",", ";", "of", "in"]);
  const separatedByLineBreak = /[\r\n]/.test(
    source.slice(bindingEnd, continuation.start),
  );

  if (!allowed.has(continuation.text) && !separatedByLineBreak) return undefined;

  return { kind: "mutable-binding", feature: "mut", start: token.start, end: token.end };
}

function nullableNodeAfter(
  source: string,
  tokens: readonly EraToken[],
  introducerIndex: number,
): EraNullableTypeNode | undefined {
  const startIndex = nextIndex(tokens, introducerIndex);
  if (startIndex === undefined) return undefined;

  let angle = 0;
  let bracket = 0;
  let paren = 0;

  const finish = (endExclusive: number): EraNullableTypeNode | undefined => {
    const nullableIndex = endExclusive - 1;
    if (nullableIndex < startIndex || !isToken(tokens[nullableIndex], "?")) return undefined;
    if (nullableIndex === startIndex) return undefined;

    const first = tokens[startIndex]!;
    const nullable = tokens[nullableIndex]!;
    const typeText = source.slice(first.start, nullable.start).trim();
    const simpleType = /^[A-Za-z_$][A-Za-z0-9_$.]*(?:\s*<[^;=(){}]+>)?$/;
    if (!simpleType.test(typeText)) return undefined;

    return {
      kind: "nullable-type",
      feature: "nullable-type",
      start: nullable.start,
      end: nullable.end,
    };
  };

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (token.text === "<") angle += 1;
    else if (token.text === ">" && angle > 0) angle -= 1;
    else if (token.text === "[") bracket += 1;
    else if (token.text === "]" && bracket > 0) bracket -= 1;
    else if (token.text === "(") paren += 1;
    else if (token.text === ")" && paren > 0) paren -= 1;

    if (angle !== 0 || bracket !== 0 || paren !== 0) continue;

    if (new Set([",", "=", ";", ")", "{", "}", "=>", ":"]).has(token.text)) {
      return finish(index);
    }
  }

  return finish(tokens.length);
}

export function parseEraSurface(source: string, allTokens: readonly EraToken[]): EraSurfaceNode[] {
  const tokens = allTokens.filter((token) => !isIgnored(token));
  const nodes: EraSurfaceNode[] = [];
  const recognizedArrowIndexes = new Set<number>();

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isIdentifier(tokens[index], "fn")) continue;
    const parsed = parseFunctionAt(source, tokens, index);
    if (!parsed) continue;

    const fn = tokens[index]!;
    const fnNode: EraFunctionKeywordNode = {
      kind: "function-keyword",
      feature: "fn",
      start: fn.start,
      end: fn.end,
    };
    nodes.push(fnNode);

    const pub = publicModifierForFunction(source, tokens, parsed);
    if (pub) nodes.push(pub);

    const arrow = returnArrowNode(source, tokens, parsed);
    if (arrow && parsed.arrowIndex !== undefined) {
      nodes.push(arrow);
      recognizedArrowIndexes.add(parsed.arrowIndex);
      const nullable = nullableNodeAfter(source, tokens, parsed.arrowIndex);
      if (nullable) nodes.push(nullable);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const mutable = parseMutableBindingAt(source, tokens, index);
    if (mutable) nodes.push(mutable);

    if (isToken(tokens[index], ":")) {
      const nullable = nullableNodeAfter(source, tokens, index);
      if (nullable) nodes.push(nullable);
    }

    if (isToken(tokens[index], "->") && !recognizedArrowIndexes.has(index)) {
      // Unrecognized arrows are deliberately passed through unchanged.
    }
  }

  const unique = new Map<string, EraSurfaceNode>();
  for (const node of nodes) {
    unique.set(`${node.kind}:${node.start}:${node.end}`, node);
  }

  return [...unique.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind),
  );
}
