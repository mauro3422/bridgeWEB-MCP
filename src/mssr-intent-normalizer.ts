import {
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_RISKS,
  SKILL_SIGNALS,
  structuredSkillIntentSchema,
} from "./tools/skill-routing.js";

type IntentField = "domains" | "actions" | "artifacts" | "needs" | "signals";
type ScalarField = "risk" | "ambiguity";

type CanonicalIntent = ReturnType<typeof structuredSkillIntentSchema.parse>;

export interface IntentNormalizationChange {
  id: string;
  field: IntentField | ScalarField;
  from: string;
  to: string;
  movedTo?: IntentField;
}

export interface IntentNormalizationIssue {
  field: IntentField | ScalarField | "intent";
  received: string;
  code: "invalid-value" | "missing-required" | "too-many-items" | "invalid-type";
  candidates: string[];
  message: string;
}

export interface IntentNormalizationResult {
  status: "omitted" | "canonical" | "normalized" | "correction-required";
  intent?: CanonicalIntent;
  retryIntent?: Record<string, unknown>;
  changes: IntentNormalizationChange[];
  issues: IntentNormalizationIssue[];
}

const vocabularies = {
  domains: [...SKILL_DOMAINS],
  actions: [...SKILL_ACTIONS],
  artifacts: [...SKILL_ARTIFACTS],
  needs: [...SKILL_NEEDS],
  signals: [...SKILL_SIGNALS],
} as const satisfies Record<IntentField, readonly string[]>;

const fieldLimits: Record<IntentField, number> = {
  domains: 8,
  actions: 12,
  artifacts: 12,
  needs: 12,
  signals: 12,
};

const aliases: Partial<Record<IntentField | ScalarField, Record<string, string>>> = {
  domains: {
    "local-app-development": "coding",
    "app-development": "coding",
    development: "coding",
  },
  actions: {
    inspect: "review",
    inspection: "review",
    analyse: "analyze",
  },
  risk: {
    read: "read-only",
    readonly: "read-only",
    "bounded-write": "write",
  },
};

function token(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function suggestions(value: string, vocabulary: readonly string[]): string[] {
  return vocabulary
    .map((candidate) => ({ candidate, distance: editDistance(value, candidate) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((item) => item.candidate);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function relocateTarget(field: IntentField, value: string): IntentField | null {
  const matches = (Object.keys(vocabularies) as IntentField[])
    .filter((candidate) => candidate !== field && vocabularies[candidate].includes(value as never));
  return matches.length === 1 ? matches[0] : null;
}

export function normalizeMssrIntent(value: unknown): IntentNormalizationResult {
  if (value === undefined) return { status: "omitted", changes: [], issues: [] };
  const input = objectValue(value);
  if (!input) {
    return {
      status: "correction-required",
      changes: [],
      issues: [{
        field: "intent",
        received: typeof value,
        code: "invalid-type",
        candidates: [],
        message: "intent must be a JSON object.",
      }],
    };
  }

  const retry: Record<string, unknown> = {};
  const changes: IntentNormalizationChange[] = [];
  const issues: IntentNormalizationIssue[] = [];
  const moved = new Map<IntentField, string[]>();

  if (typeof input.summary === "string") retry.summary = input.summary.trim().slice(0, 600);
  if (input.ambiguity !== undefined) {
    const normalized = typeof input.ambiguity === "string" ? token(input.ambiguity) : "";
    if (["low", "medium", "high"].includes(normalized)) retry.ambiguity = normalized;
    else issues.push({
      field: "ambiguity",
      received: String(input.ambiguity),
      code: "invalid-value",
      candidates: ["low", "medium", "high"],
      message: "ambiguity must use the canonical low, medium, or high value.",
    });
  }

  if (input.risk !== undefined) {
    const normalized = typeof input.risk === "string" ? token(input.risk) : "";
    const alias = aliases.risk?.[normalized];
    const resolved = alias ?? normalized;
    if (SKILL_RISKS.includes(resolved as never)) {
      retry.risk = resolved;
      if (alias) changes.push({ id: `risk:${normalized}->${alias}`, field: "risk", from: normalized, to: alias });
    } else {
      issues.push({
        field: "risk",
        received: String(input.risk),
        code: "invalid-value",
        candidates: suggestions(normalized, SKILL_RISKS),
        message: "risk is not part of the canonical MSSR vocabulary.",
      });
    }
  }

  for (const field of Object.keys(vocabularies) as IntentField[]) {
    const raw = input[field];
    if (raw === undefined) {
      if (field === "signals") {
        retry.signals = ["nominal"];
        changes.push({
          id: "signals:missing->nominal",
          field: "signals",
          from: "missing",
          to: "nominal",
        });
        continue;
      }
      if (field === "domains" || field === "actions") {
        issues.push({
          field,
          received: "missing",
          code: "missing-required",
          candidates: [...vocabularies[field]].slice(0, 6),
          message: `${field} is required.`,
        });
      }
      continue;
    }
    if (!Array.isArray(raw)) {
      issues.push({
        field,
        received: typeof raw,
        code: "invalid-type",
        candidates: [],
        message: `${field} must be an array.`,
      });
      continue;
    }

    const resolved: string[] = [];
    for (const item of raw) {
      const normalized = typeof item === "string" ? token(item) : "";
      if (!normalized) {
        issues.push({
          field,
          received: typeof item,
          code: "invalid-type",
          candidates: [],
          message: `${field} entries must be non-empty strings.`,
        });
        continue;
      }
      if (vocabularies[field].includes(normalized as never)) {
        resolved.push(normalized);
        if (normalized !== item) {
          changes.push({ id: `${field}:format->${normalized}`, field, from: String(item), to: normalized });
        }
        continue;
      }
      const alias = aliases[field]?.[normalized];
      if (alias && vocabularies[field].includes(alias as never)) {
        resolved.push(alias);
        changes.push({ id: `${field}:${normalized}->${alias}`, field, from: normalized, to: alias });
        continue;
      }
      const target = relocateTarget(field, normalized);
      if (target) {
        const targetValues = moved.get(target) ?? [];
        targetValues.push(normalized);
        moved.set(target, targetValues);
        changes.push({
          id: `${field}:${normalized}->${target}`,
          field,
          from: normalized,
          to: normalized,
          movedTo: target,
        });
        continue;
      }
      issues.push({
        field,
        received: normalized,
        code: "invalid-value",
        candidates: suggestions(normalized, vocabularies[field]),
        message: `'${normalized}' is not part of the canonical ${field} vocabulary.`,
      });
    }
    retry[field] = unique(resolved);
  }

  for (const [field, values] of moved.entries()) {
    retry[field] = unique([
      ...(Array.isArray(retry[field]) ? retry[field] as string[] : []),
      ...values,
    ]);
  }

  for (const field of Object.keys(vocabularies) as IntentField[]) {
    const values = Array.isArray(retry[field]) ? retry[field] as string[] : [];
    if ((field === "domains" || field === "actions" || field === "signals") && values.length === 0) {
      if (!issues.some((issue) => issue.field === field)) {
        issues.push({
          field,
          received: "empty-after-normalization",
          code: "missing-required",
          candidates: [...vocabularies[field]].slice(0, 6),
          message: `${field} must retain at least one canonical value after normalization.`,
        });
      }
    }
    if (values.length > fieldLimits[field]) {
      issues.push({
        field,
        received: String(values.length),
        code: "too-many-items",
        candidates: values.slice(0, fieldLimits[field]),
        message: `${field} accepts at most ${fieldLimits[field]} distinct values.`,
      });
    }
  }

  if (issues.length > 0) {
    return { status: "correction-required", retryIntent: retry, changes, issues };
  }
  const parsed = structuredSkillIntentSchema.safeParse(retry);
  if (!parsed.success) {
    return {
      status: "correction-required",
      retryIntent: retry,
      changes,
      issues: [{
        field: "intent",
        received: "post-normalization-validation",
        code: "invalid-value",
        candidates: [],
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      }],
    };
  }
  return {
    status: changes.length > 0 ? "normalized" : "canonical",
    intent: parsed.data,
    retryIntent: parsed.data,
    changes,
    issues: [],
  };
}
