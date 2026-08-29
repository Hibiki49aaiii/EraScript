export type EraSurfaceFeature =
  | "fn"
  | "mut"
  | "pub"
  | "return-arrow"
  | "nullable-type";

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

interface BaseSurfaceNode extends SourceRange {
  readonly feature: EraSurfaceFeature;
}

export interface EraFunctionKeywordNode extends BaseSurfaceNode {
  readonly kind: "function-keyword";
  readonly feature: "fn";
}

export interface EraPublicModifierNode extends BaseSurfaceNode {
  readonly kind: "public-modifier";
  readonly feature: "pub";
}

export interface EraMutableBindingNode extends BaseSurfaceNode {
  readonly kind: "mutable-binding";
  readonly feature: "mut";
}

export interface EraReturnTypeArrowNode extends BaseSurfaceNode {
  readonly kind: "return-type-arrow";
  readonly feature: "return-arrow";
}

export interface EraNullableTypeNode extends BaseSurfaceNode {
  readonly kind: "nullable-type";
  readonly feature: "nullable-type";
}

export type EraSurfaceNode =
  | EraFunctionKeywordNode
  | EraPublicModifierNode
  | EraMutableBindingNode
  | EraReturnTypeArrowNode
  | EraNullableTypeNode;

export interface SourceEdit extends SourceRange {
  readonly replacement: string;
  readonly feature: EraSurfaceFeature;
}

export function lowerSurfaceNode(node: EraSurfaceNode): SourceEdit {
  switch (node.kind) {
    case "function-keyword":
      return { start: node.start, end: node.end, replacement: "function", feature: node.feature };
    case "public-modifier":
      return { start: node.start, end: node.end, replacement: "export", feature: node.feature };
    case "mutable-binding":
      return { start: node.start, end: node.end, replacement: "let", feature: node.feature };
    case "return-type-arrow":
      return { start: node.start, end: node.end, replacement: ":", feature: node.feature };
    case "nullable-type":
      return {
        start: node.start,
        end: node.end,
        replacement: " | null | undefined",
        feature: node.feature,
      };
  }
}
