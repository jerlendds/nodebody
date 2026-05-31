import type { LayoutIntent, LayoutStrength } from "./intents";

export interface ConstraintProvenance {
  sourcePlugin: string;
  sourceTab?: string;
  intentId: string;
  reason: string;
  strength: LayoutStrength;
  satisfied: boolean;
  error?: number;
}

export interface LayoutExplanation {
  targetId: string;
  satisfied: ConstraintProvenance[];
  relaxed: ConstraintProvenance[];
}

export function explainIntents(
  targetId: string,
  intents: readonly LayoutIntent[],
): LayoutExplanation {
  const satisfied = intents
    .filter((intent) => intentMatchesTarget(intent, targetId))
    .map((intent) => ({
      sourcePlugin: intent.source,
      intentId: intent.id,
      reason: intent.reason,
      strength: intent.strength,
      satisfied: true,
    }));

  return { targetId, satisfied, relaxed: [] };
}

function intentMatchesTarget(intent: LayoutIntent, targetId: string): boolean {
  return JSON.stringify(intent).includes(targetId);
}
