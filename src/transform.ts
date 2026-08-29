import { applySourceEdits } from "./frontend/apply-edits.js";
import { lowerSurfaceNode } from "./frontend/ast.js";
import { lexEraScript } from "./frontend/lexer.js";
import { parseEraSurface } from "./frontend/parser.js";

export interface TransformResult {
  code: string;
  features: string[];
}

/**
 * Lowers only EraScript-owned surface syntax into TypeScript.
 *
 * Ordinary TypeScript is preserved byte-for-byte unless the source contains a
 * construct that the EraScript surface parser recognizes unambiguously.
 */
export function transformEraScript(source: string): TransformResult {
  const tokens = lexEraScript(source);
  const nodes = parseEraSurface(source, tokens);
  const edits = nodes.map(lowerSurfaceNode);
  const code = applySourceEdits(source, edits);
  const features = [...new Set(edits.map((edit) => edit.feature))].sort();

  return { code, features };
}
