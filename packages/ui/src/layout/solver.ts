import type { LayoutDocument } from "./model";
import type { LayoutIntent } from "./intents";
import type { LayoutPort } from "./ports";
import type { ConstraintProvenance } from "./explain";

export interface SolvedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutSolveSnapshot {
  doc: LayoutDocument;
  viewport: DOMRectReadOnly;
  previousRects?: Record<string, SolvedRect>;
  intents?: readonly LayoutIntent[];
  ports?: readonly LayoutPort[];
}

export interface LayoutSolveResult {
  rects: Record<string, SolvedRect>;
  explanations: Record<string, ConstraintProvenance[]>;
}

export function solveLayout(snapshot: LayoutSolveSnapshot): LayoutSolveResult {
  return {
    rects: snapshot.previousRects ?? {},
    explanations: Object.fromEntries(
      (snapshot.intents ?? []).map((intent) => [
        intent.id,
        [
          {
            sourcePlugin: intent.source,
            intentId: intent.id,
            reason: intent.reason,
            strength: intent.strength,
            satisfied: true,
          },
        ],
      ]),
    ),
  };
}
