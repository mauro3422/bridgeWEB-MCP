type UnknownRecord = Record<string, unknown>;

const MAX_SKILL_PRIORS = 40;
const MAX_SELECTION_FEEDBACK = 30;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numericValue(value: unknown, keys: string[]): number {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = Number(record[key]);
    if (Number.isFinite(candidate)) return candidate;
  }
  return 0;
}

function rankedSlice(values: unknown[], limit: number): unknown[] {
  return [...values]
    .sort((left, right) => numericValue(right, ["observations", "count", "calls", "accepted", "score"])
      - numericValue(left, ["observations", "count", "calls", "accepted", "score"]))
    .slice(0, limit);
}

export function compactMssrSummaryForDashboard(input: unknown): UnknownRecord {
  const summary = asRecord(input);
  const intentAnalysis = asRecord(summary.intentAnalysis);
  const learning = asRecord(intentAnalysis.learning);
  const skillPriors = asArray(learning.skillPriors);
  const transitions = asArray(learning.transitions);
  const contextPriors = asArray(learning.contextPriors);
  const selectionFeedback = asArray(learning.selectionFeedback);

  return {
    ...summary,
    intentAnalysis: {
      ...intentAnalysis,
      learning: {
        ...learning,
        skillPriors: rankedSlice(skillPriors, MAX_SKILL_PRIORS),
        selectionFeedback: rankedSlice(selectionFeedback, MAX_SELECTION_FEEDBACK),
        totals: {
          skillPriors: skillPriors.length,
          transitions: transitions.length,
          contextPriors: contextPriors.length,
          selectionFeedback: selectionFeedback.length,
        },
        truncated: skillPriors.length > MAX_SKILL_PRIORS
          || transitions.length > 0
          || contextPriors.length > 0
          || selectionFeedback.length > MAX_SELECTION_FEEDBACK,
        transitions: undefined,
        contextPriors: undefined,
      },
    },
  };
}
