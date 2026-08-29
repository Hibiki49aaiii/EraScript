import ts from "typescript";
import type { EraDiagnostic } from "../diagnostics.js";
import type { UnsafeBoundaryAudit } from "./unsafe.js";

export interface Web3SourceAnalysis {
  readonly diagnostics: readonly EraDiagnostic[];
  readonly unsafeBoundaries: readonly UnsafeBoundaryAudit[];
}

export type Web3SourceLocation = Pick<EraDiagnostic, "file" | "line" | "column">;
export type Web3SourceLocationResolver = (transformedOffset: number) => Web3SourceLocation;
type NodeLocationResolver = (node: ts.Node) => Web3SourceLocation;

function literalValue(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  resolver?: Web3SourceLocationResolver,
): Web3SourceLocation {
  const offset = node.getStart(sourceFile);
  if (resolver) return resolver(offset);
  const position = sourceFile.getLineAndCharacterOfPosition(offset);
  return { file: sourceFile.fileName, line: position.line + 1, column: position.character + 1 };
}

function callName(node: ts.CallExpression): string | undefined {
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined;
}

function validateFixedHex(resolveLocation: NodeLocationResolver, node: ts.Node, value: string, expectedDigits: number, code: string, kind: string, label: string): EraDiagnostic | undefined {
  const digits = value.startsWith("0x") ? value.slice(2) : value;
  if (value.startsWith("0x") && /^[0-9a-fA-F]+$/.test(digits) && digits.length === expectedDigits) return undefined;
  return {
    code,
    severity: "error",
    kind,
    message: `Expected ${label} (${expectedDigits} hexadecimal digits), received ${digits.length} digits.`,
    ...resolveLocation(node),
    suggestion: digits.length === expectedDigits - 1
      ? "A leading zero may be missing. Verify the source value before padding."
      : `Provide exactly ${expectedDigits} hexadecimal digits with a 0x prefix.`,
    details: { expectedHexDigits: expectedDigits, actualHexDigits: digits.length },
  };
}

function processEnvName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    const parent = node.expression;
    if (ts.isPropertyAccessExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "process" && parent.name.text === "env") return node.name.text;
  }
  if (ts.isElementAccessExpression(node)) {
    const parent = node.expression;
    const key = literalValue(node.argumentExpression);
    if (key && ts.isPropertyAccessExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "process" && parent.name.text === "env") return key;
  }
  return undefined;
}

function looksLikePrivateSecret(name: string): boolean {
  return /(PRIVATE.*KEY|WALLET.*KEY|MNEMONIC|SEED(?:_PHRASE)?)/i.test(name);
}

function analyzeUnsafeBoundary(node: ts.CallExpression, diagnostics: EraDiagnostic[], unsafeBoundaries: UnsafeBoundaryAudit[], resolveLocation: NodeLocationResolver): void {
  const reasonNode = node.arguments[0];
  const operation = node.arguments[1];
  const reason = literalValue(reasonNode);
  const loc = resolveLocation(node);

  if (!reasonNode || reason === undefined) {
    diagnostics.push({
      code: "ES4081",
      severity: "error",
      kind: "UnsafeBoundaryReasonMustBeLiteral",
      message: "unsafeBoundary requires a static string-literal reason so AI and reviewers can audit why verification was bypassed.",
      ...loc,
      suggestion: "Pass a concrete string literal describing the non-standard protocol or compatibility requirement.",
    });
    return;
  }

  const normalized = reason.trim();
  if (normalized.length < 12) {
    diagnostics.push({
      code: "ES4082",
      severity: "error",
      kind: "UnsafeBoundaryReasonTooShort",
      message: "Unsafe boundary reason is too vague to audit.",
      ...loc,
      details: { actualLength: normalized.length, minimumLength: 12 },
      suggestion: "Describe the exact non-standard behavior that requires leaving EraScript's verified APIs.",
    });
    return;
  }
  if (normalized.length > 240) {
    diagnostics.push({
      code: "ES4084",
      severity: "error",
      kind: "UnsafeBoundaryReasonTooLong",
      message: "Unsafe boundary reason must remain concise enough to audit.",
      ...loc,
      details: { actualLength: normalized.length, maximumLength: 240 },
    });
    return;
  }
  if (!operation || (!ts.isArrowFunction(operation) && !ts.isFunctionExpression(operation))) {
    diagnostics.push({
      code: "ES4083",
      severity: "error",
      kind: "InvalidUnsafeBoundaryOperation",
      message: "unsafeBoundary requires an inline arrow/function callback so the bypass scope is structurally visible.",
      ...loc,
      suggestion: "Wrap only the smallest required compatibility operation in an inline callback.",
    });
    return;
  }

  const audit: UnsafeBoundaryAudit = {
    kind: "unsafe-boundary",
    id: `${sourceFile.fileName}:${loc.line}:${loc.column}`,
    reason: normalized,
    ...loc,
  };
  unsafeBoundaries.push(audit);
  diagnostics.push({
    code: "ES4080",
    severity: "warning",
    kind: "UnsafeBoundary",
    message: `Verification guarantees are explicitly suspended inside this boundary: ${normalized}`,
    ...loc,
    details: { auditId: audit.id, reason: normalized },
    suggestion: "Keep the boundary minimal and require explicit verification-policy authorization before broadcast.",
  });
}

export function analyzeWeb3Source(
  source: string,
  fileName = "module.ts",
  locationResolver?: Web3SourceLocationResolver,
): Web3SourceAnalysis {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics: EraDiagnostic[] = [];
  const unsafeBoundaries: UnsafeBoundaryAudit[] = [];
  const resolveLocation: NodeLocationResolver = (node) =>
    sourceLocation(sourceFile, node, locationResolver);

  const visit = (node: ts.Node): void => {
    const envName = processEnvName(node);
    if (envName && looksLikePrivateSecret(envName)) {
      diagnostics.push({
        code: "ES3820",
        severity: "error",
        kind: "DirectPrivateSecretAccess",
        message: `Direct access to secret-like environment variable '${envName}' bypasses EraScript signer capabilities.`,
        ...resolveLocation(node),
        suggestion: `Use privateKeyEnv("${envName}", chain) and sign through a SignerCapability instead of reading the raw value.`,
      });
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node);

      if (name === "unsafeBoundary") analyzeUnsafeBoundary(node, diagnostics, unsafeBoundaries, resolveLocation);

      if (name === "bytes32" || name === "hash" || name === "merkleRoot" || name === "merkleLeaf") {
        const value = literalValue(node.arguments[0]);
        if (value !== undefined) {
          const diagnostic = validateFixedHex(resolveLocation, node.arguments[0]!, value, 64, "ES3201", "InvalidBytes32", "bytes32");
          if (diagnostic) diagnostics.push(diagnostic);
        }
      }

      if (name === "address") {
        const value = literalValue(node.arguments[0]);
        if (value !== undefined) {
          const diagnostic = validateFixedHex(resolveLocation, node.arguments[0]!, value, 40, "ES3101", "InvalidAddress", "20-byte EVM address");
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
              ...resolveLocation(node.arguments[0]!),
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
            const diagnostic = validateFixedHex(resolveLocation, element, value, 64, "ES3201", "InvalidBytes32", "Merkle proof node");
            if (diagnostic) {
              diagnostic.path = `proof[${index}]`;
              diagnostics.push(diagnostic);
            }
          });
        }
      }

      if (name === "privateKeyToAccount") {
        const value = literalValue(node.arguments[0]);
        if (value && /^0x[0-9a-fA-F]{64}$/.test(value)) {
          diagnostics.push({
            code: "ES3821",
            severity: "error",
            kind: "HardcodedPrivateKey",
            message: "A raw private key literal is embedded in source code.",
            ...resolveLocation(node.arguments[0]!),
            suggestion: "Store the key outside source control and reference it through privateKeyEnv() plus a SignerCapability.",
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { diagnostics, unsafeBoundaries };
}

export function analyzeWeb3Literals(source: string, fileName = "module.ts"): EraDiagnostic[] {
  return [...analyzeWeb3Source(source, fileName).diagnostics];
}
