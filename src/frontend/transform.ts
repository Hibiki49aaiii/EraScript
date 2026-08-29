import { applySourceEdits } from "./apply-edits.js";
import { lowerSurfaceNode, type SourceEdit } from "./ast.js";
import { lexEraScript } from "./lexer.js";
import { parseEraSurface } from "./parser.js";
import {
  createSourceCoordinateMap,
  type EraSourceCoordinateMap,
} from "./source-map.js";

export interface DetailedTransformResult {
  readonly code: string;
  readonly features: string[];
  readonly edits: readonly SourceEdit[];
  readonly coordinateMap: EraSourceCoordinateMap;
}

export function transformEraScriptDetailed(source: string): DetailedTransformResult {
  const tokens = lexEraScript(source);
  const nodes = parseEraSurface(source, tokens);
  const edits = nodes.map(lowerSurfaceNode);
  const code = applySourceEdits(source, edits);
  const coordinateMap = createSourceCoordinateMap(source, edits);
  const features = [...new Set(edits.map((edit) => edit.feature))].sort();

  if (coordinateMap.transformedLength !== code.length) {
    throw new Error("EraScript coordinate map length does not match transformed source length.");
  }

  return { code, features, edits, coordinateMap };
}
