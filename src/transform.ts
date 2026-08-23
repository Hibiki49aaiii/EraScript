export interface TransformResult {
  code: string;
  features: string[];
}

type State = "code" | "single" | "double" | "template" | "lineComment" | "blockComment";

const isIdentStart = (c: string | undefined): boolean => !!c && /[A-Za-z_$]/.test(c);
const isIdent = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_$]/.test(c);

/**
 * Transforms EraScript surface syntax into valid TypeScript.
 *
 * EraScript v0.1 intentionally keeps the transform small and lexical. This
 * makes ordinary TypeScript valid EraScript while giving us room to evolve a
 * real parser without locking the language into an unstable grammar.
 */
export function transformEraScript(source: string): TransformResult {
  let out = "";
  let i = 0;
  let state: State = "code";
  const features = new Set<string>();

  while (i < source.length) {
    const c = source[i]!;
    const n = source[i + 1];

    if (state === "lineComment") {
      out += c;
      i += 1;
      if (c === "\n") state = "code";
      continue;
    }

    if (state === "blockComment") {
      out += c;
      if (c === "*" && n === "/") {
        out += "/";
        i += 2;
        state = "code";
      } else {
        i += 1;
      }
      continue;
    }

    if (state === "single" || state === "double") {
      out += c;
      i += 1;
      if (c === "\\" && i < source.length) {
        out += source[i]!;
        i += 1;
        continue;
      }
      if ((state === "single" && c === "'") || (state === "double" && c === '"')) {
        state = "code";
      }
      continue;
    }

    if (state === "template") {
      out += c;
      i += 1;
      if (c === "\\" && i < source.length) {
        out += source[i]!;
        i += 1;
        continue;
      }
      if (c === "`") state = "code";
      continue;
    }

    if (c === "/" && n === "/") {
      out += "//";
      i += 2;
      state = "lineComment";
      continue;
    }
    if (c === "/" && n === "*") {
      out += "/*";
      i += 2;
      state = "blockComment";
      continue;
    }
    if (c === "'") {
      out += c;
      i += 1;
      state = "single";
      continue;
    }
    if (c === '"') {
      out += c;
      i += 1;
      state = "double";
      continue;
    }
    if (c === "`") {
      out += c;
      i += 1;
      state = "template";
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      i += 1;
      while (isIdent(source[i])) i += 1;
      const ident = source.slice(start, i);

      if (ident === "fn") {
        out += "function";
        features.add("fn");
        continue;
      }
      if (ident === "mut") {
        out += "let";
        features.add("mut");
        continue;
      }
      if (ident === "pub") {
        const rest = source.slice(i);
        if (/^\s+(?:async\s+)?fn\b/.test(rest)) {
          out += "export";
          features.add("pub");
          continue;
        }
      }

      out += ident;
      continue;
    }

    // EraScript return type arrow: fn add(a: number) -> number { ... }
    if (c === "-" && n === ">") {
      out = out.replace(/[ \t]+$/, "");
      out += ":";
      i += 2;
      while (source[i] === " " || source[i] === "\t") i += 1;
      if (i < source.length && source[i] !== "\n" && source[i] !== "\r") out += " ";
      features.add("return-arrow");
      continue;
    }

    out += c;
    i += 1;
  }

  return { code: transformNullableTypes(out, features), features: [...features].sort() };
}

function transformNullableTypes(source: string, features: Set<string>): string {
  // v0.1 supports the common simple-type form in annotations and return types:
  //   name: User?     -> name: User | null | undefined
  //   fn f() -> User? -> function f(): User | null | undefined
  // We deliberately do not rewrite optional properties (`name?: string`).
  const rewritten = source.replace(
    /(:\s*)([A-Za-z_$][A-Za-z0-9_$.]*(?:\s*<[^;=(){}]+>)?)\?(?=\s*[,)=;{])/g,
    (_match, prefix: string, type: string) => {
      features.add("nullable-type");
      return `${prefix}${type.trim()} | null | undefined`;
    },
  );
  return rewritten;
}
