import { transformEraScriptDetailed } from "./frontend/transform.js";

export interface TransformResult {
  code: string;
  features: string[];
}

/**
 * Lowers only EraScript-owned surface syntax into TypeScript.
 *
 * Ordinary TypeScript is preserved byte-for-byte unless the source contains a
 * construct that the EraScript surface parser recognizes unambiguously.
 *
 * The detailed frontend mapping remains internal so the public transform
 * result keeps the exact v0.1-compatible { code, features } shape.
 */
export function transformEraScript(source: string): TransformResult {
  const transformed = transformEraScriptDetailed(source);
  return { code: transformed.code, features: transformed.features };
}
