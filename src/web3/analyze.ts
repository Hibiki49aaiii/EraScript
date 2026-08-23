import ts from "typescript";
import type { EraDiagnostic } from "../diagnostics.js";

function literalValue(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function location(sourceFile: ts.SourceFile, node: ts.Node): Pick<EraDiagnostic, "file" | "line" | "column"> {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function callName(node: ts.CallExpression): string | undefined {
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined;
}

function validateFixedHex(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: string,
  expectedDigits: number,
  code: string,
  kind: string,
  label: string,
): EraDiagnostic | undefined {
  const digits = value.startsWith("0x") ? value.slice(2) : value;
  const valid = value.startsWith("0x") && /^[0-9a-fA-F]+$/.test(digits) && digits.length === expectedDigits;
  if (valid) return undefined;

  return {
    code,
    severity: "error",
    kind,
    message: `Expected ${label} (${expectedDigits} hexadecimal digits), received ${digits.length} digits.`,
    ...location(sourceFile, node),
    suggestion: digits.length === expectedDigits - 1
      ? "A leading zero may be missing. Verify the source value before padding."
      : `Provide exactly ${expectedDigits} hexadecimal digits with a 0x prefix.`,
    details: {
      expectedHexDigits: expectedDigits,
      actualHexDigits: digits.length,
    },
  };
}

export function analyzeWeb3Literals(source: string, fileName = "module.ts"): EraDiagnostic[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics: EraDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callName(node);

      if (name === "bytes32" || name === "hash" || name === "merkleRoot" || name === "merkleLeaf") {
        const value = literalValue(node.arguments[0]);
        if (value !== undefined) {
          const diagnostic = validateFixedHex(sourceFile, node.arguments[0]!, value, 64, "ES3201", "InvalidBytes32", "bytes32");
          if (diagnostic) diagnostics.push(diagnostic);
        }
      }

      if (name === "address") {
        const value = literalValue(node.arguments[0]);
        if (value !== undefined) {
          const diagnostic = validateFixedHex(sourceFile, node.arguments[0]!, value, 40, "ES3101", "InvalidAddress", "20-byte EVM address");
          if (diagnostic) diagnostics.push(diagnostic);
        }
      }

      if (name === "calldata") {
        const value = literalValue(node.arguments[0]);
        if (value !== undefined) {
          const digits = value.startsWith("0x") ? value.slice(2) : value;
          if (!value.startsWith("0x") || !/^[0-9a-fA-F]*$/.test(digits) || digits.length % 2 !== 0) {
            diagnostics.push({
              code: "ES3300",
              severity: "error",
              kind: "InvalidCalldata",
              message: "Calldata literal must be 0x-prefixed hexadecimal containing whole bytes.",
              ...location(sourceFile, node.arguments[0]!),
              suggestion: "Check for a missing hexadecimal nibble or malformed 0x prefix.",
              details: { actualHexDigits: digits.length },
            });
          }
        }
      }

      if (name === "proof") {
        const first = node.arguments[0];
        if (first && ts.isArrayLiteralExpression(first)) {
          first.elements.forEach((element, index) => {
            const value = literalValue(element as ts.Expression);
            if (value === undefined) return;
            const diagnostic = validateFixedHex(sourceFile, element, value, 64, "ES3201", "InvalidBytes32", "Merkle proof node");
            if (diagnostic) {
              diagnostic.path = `proof[${index}]`;
              diagnostics.push(diagnostic);
            }
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}
