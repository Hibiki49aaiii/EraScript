import ts from "typescript";

type Origin = "process" | "env" | "accounts" | "key-factory";

/** File-local, conservative alias analysis. This is a diagnostic aid, not isolation. */
export function secretResolver(source: ts.SourceFile) {
  let remaining = 100_000;
  let truncated = false;
  const withinBudget = (depth: number): boolean => {
    if (--remaining < 0 || depth > 64) { truncated = true; return false; }
    return true;
  };
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowNonTsExtensions: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === source.fileName ? source : undefined;
  host.fileExists = (name) => name === source.fileName;
  host.readFile = () => undefined;
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  const assigned = new Map<ts.Symbol, ts.Expression[]>();
  const collect = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      if (symbol) assigned.set(symbol, [...(assigned.get(symbol) ?? []), node.right]);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const unwrap = (node: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
    return node;
  };
  const literal = (value: ts.Expression | undefined, seen = new Set<ts.Symbol>(), depth = 0): string | undefined => {
    if (!value || !withinBudget(depth)) return undefined;
    const node = unwrap(value);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left, new Set(seen), depth + 1), right = literal(node.right, new Set(seen), depth + 1);
      if ((left?.length ?? 0) + (right?.length ?? 0) > 4096) { truncated = true; return undefined; }
      return left !== undefined && right !== undefined ? left + right : undefined;
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!symbol || seen.has(symbol)) return undefined;
      seen.add(symbol);
      for (const declaration of symbol.declarations ?? []) if (ts.isVariableDeclaration(declaration)) {
        const text = literal(declaration.initializer, seen, depth + 1);
        if (text !== undefined) return text;
      }
    }
    return undefined;
  };
  const property = (node: ts.Node): string | undefined => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) ? literal(node.argumentExpression) : undefined;
  const moduleName = (node: ts.Node): string | undefined => {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) if (ts.isImportDeclaration(parent) && ts.isStringLiteral(parent.moduleSpecifier)) return parent.moduleSpecifier.text;
    return undefined;
  };
  const origin = (value: ts.Expression | undefined, seen = new Set<ts.Symbol>(), depth = 0): Origin | undefined => {
    if (!value || !withinBudget(depth)) return undefined;
    const node = unwrap(value);
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!symbol) return node.text === "process" ? "process" : node.text === "privateKeyToAccount" ? "key-factory" : undefined;
      if (seen.has(symbol)) return undefined;
      seen.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        const module = moduleName(declaration);
        if (module === "node:process" || module === "process") {
          if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text === "env" ? "env" : undefined;
          return "process";
        }
        if (module === "viem/accounts") {
          if (ts.isNamespaceImport(declaration)) return "accounts";
          if (ts.isImportSpecifier(declaration) && (declaration.propertyName ?? declaration.name).text === "privateKeyToAccount") return "key-factory";
        }
        if (ts.isVariableDeclaration(declaration)) {
          const found = origin(declaration.initializer, new Set(seen), depth + 1);
          if (found) return found;
        }
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent) && ts.isVariableDeclaration(declaration.parent.parent)) {
          const parent = origin(declaration.parent.parent.initializer, new Set(seen), depth + 1);
          const key = declaration.propertyName ? declaration.propertyName.getText(source).replace(/^['"]|['"]$/g, "") : declaration.name.getText(source);
          if (parent === "process" && key === "env") return "env";
          if (parent === "accounts" && key === "privateKeyToAccount") return "key-factory";
        }
      }
      for (const assignment of assigned.get(symbol) ?? []) {
        const found = origin(assignment, new Set(seen), depth + 1);
        if (found) return found;
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const parent = origin(node.expression, seen, depth + 1);
      const key = property(node);
      if (parent === "process" && key === "env") return "env";
      if (parent === "accounts" && key === "privateKeyToAccount") return "key-factory";
    }
    return undefined;
  };
  return {
    get truncated() { return truncated; },
    literal,
    isKeyFactory: (node: ts.Expression) => origin(node) === "key-factory",
    envName(node: ts.Node): string | undefined {
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && origin(node.expression) === "env") return property(node);
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ts.isVariableDeclaration(node.parent.parent) && origin(node.parent.parent.initializer) === "env") {
        const key = node.propertyName ?? node.name;
        if (ts.isComputedPropertyName(key)) return literal(key.expression);
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) return key.text;
      }
      return undefined;
    },
  };
}
