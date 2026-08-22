import type { MssrToolFrictionOperationalProjection } from "@mauroprime/mssr";
import type { ToolAuditMetricRow, ToolAuditMetricSnapshot } from "./metrics.js";
import type { BridgeToolFrictionProjection } from "./mssr-tool-friction.js";
import type { BridgeToolMetadata, BridgeToolSchema } from "./tools/types.js";

export const TOOL_AUDIT_VIEWS = ["needs-attention", "tool", "aliases", "fallback-overuse", "unused", "all"] as const;
export type ToolAuditView = typeof TOOL_AUDIT_VIEWS[number];

export type ToolAuditStatus =
  | "protect"
  | "maintain"
  | "clarify"
  | "no-evidence"
  | "fix-ux-schema"
  | "prefer-dedicated"
  | "deprecation-candidate"
  | "repair";

export type ToolAuditArgs = {
  view: ToolAuditView;
  toolName?: string;
  limit: number;
};

type ToolAuditRecommendation = {
  status: ToolAuditStatus;
  recommendation: string;
  reason: string;
  confidence: "low" | "medium" | "high";
};

const DEFAULT_METADATA: BridgeToolMetadata = {
  role: "dedicated",
  family: "unclassified",
  lifecycle: "stable",
};

function metricNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
}

function riskOf(tool: BridgeToolSchema): "read-only" | "destructive" | "neutral" {
  if (tool.annotations?.readOnlyHint) return "read-only";
  if (tool.annotations?.destructiveHint) return "destructive";
  return "neutral";
}

function topErrorCategory(metric: ToolAuditMetricRow | undefined): { name: string; count: number } | null {
  return metric?.errorCategories?.[0] ?? null;
}

function recommendationFor(tool: BridgeToolSchema, metric: ToolAuditMetricRow | undefined): ToolAuditRecommendation {
  const metadata = tool.metadata ?? DEFAULT_METADATA;
  const calls = metricNumber(metric?.calls);
  const okCalls = metricNumber(metric?.okCalls);
  const errorCalls = metricNumber(metric?.errorCalls);
  const errorRate = percentage(errorCalls, calls) ?? 0;
  const topError = topErrorCategory(metric);
  const confidence = calls >= 10 ? "high" : calls >= 3 ? "medium" : "low";

  if (metadata.lifecycle === "deprecated") {
    return {
      status: "deprecation-candidate",
      recommendation: "Review replacement coverage before hiding or removing this tool.",
      reason: "The registry explicitly marks this tool as deprecated.",
      confidence: "high",
    };
  }

  if (metadata.role === "alias") {
    return {
      status: "clarify",
      recommendation: `Keep the alias only when it improves ergonomics; prefer ${metadata.preferredTool ?? metadata.aliasOf ?? "the canonical tool"} in agent guidance.`,
      reason: calls > 0 ? "The alias is being used and should remain visibly linked to its canonical tool." : "The alias has no observed use in the selected window.",
      confidence,
    };
  }

  if (calls === 0) {
    return {
      status: "no-evidence",
      recommendation: "Run a bounded smoke test before changing lifecycle or visibility.",
      reason: "No operational calls were observed in the selected metrics window.",
      confidence: "low",
    };
  }

  if (okCalls === 0 && errorCalls > 0 && calls < 3) {
    return {
      status: "no-evidence",
      recommendation: "Reproduce the failure with a bounded smoke test before changing implementation or lifecycle.",
      reason: `Only ${calls} failed call${calls === 1 ? " was" : "s were"} observed; the sample is too small to declare the tool broken.`,
      confidence: "low",
    };
  }

  if (metadata.role === "fallback" && calls >= 3) {
    return {
      status: "prefer-dedicated",
      recommendation: "Inspect whether dedicated schemas can replace repeated fallback dispatches.",
      reason: `${calls} fallback calls were observed; repeated fallback use usually means catalog or discovery friction.`,
      confidence,
    };
  }

  const callerContractCategories = new Set([
    "schema-validation", "target-not-found", "permission-or-risk-mismatch", "safety-guard", "expected-safety-guard",
    "expected-integrity-mismatch", "stale-file-state", "invalid-image-payload", "source-file-unavailable",
    "missing-upstream", "no-remote-configured",
  ]);
  if (errorRate >= 20 && callerContractCategories.has(topError?.name ?? "")) {
    const category = topError?.name ?? "caller-contract";
    return {
      status: "fix-ux-schema",
      recommendation: category === "target-not-found"
        ? "Improve target discovery, lifecycle visibility, or preflight validation before changing implementation."
        : "Improve the tool description, schema ergonomics, recovery guidance, or preflight validation before changing implementation.",
      reason: `${errorRate}% of calls failed and ${category} is the dominant caller-contract or expected-guard category.`,
      confidence,
    };
  }

  if (errorCalls > 0 && okCalls === 0 && calls >= 3) {
    return {
      status: "repair",
      recommendation: "Reproduce the dominant failure with a focused regression before broader use.",
      reason: `The tool has ${calls} observed calls and no successful execution in the selected window.`,
      confidence,
    };
  }

  if (errorRate >= 20) {
    return {
      status: "repair",
      recommendation: "Investigate the dominant error category and add a focused regression.",
      reason: `${errorRate}% of observed calls failed.`,
      confidence,
    };
  }

  if (metadata.lifecycle === "protected") {
    return {
      status: "protect",
      recommendation: "Preserve the tool contract and require regression coverage for material changes.",
      reason: "The registry marks this capability as protected and current evidence does not show a high error rate.",
      confidence,
    };
  }

  return {
    status: "maintain",
    recommendation: "Keep the current contract and continue collecting operational evidence.",
    reason: errorCalls === 0 ? "Observed calls completed without errors." : `Observed error rate is ${errorRate}%, below the review threshold.`,
    confidence,
  };
}

function statusPriority(status: ToolAuditStatus): number {
  return {
    repair: 0,
    "fix-ux-schema": 1,
    "prefer-dedicated": 2,
    "deprecation-candidate": 3,
    clarify: 4,
    "no-evidence": 5,
    protect: 6,
    maintain: 7,
  }[status];
}

function publicFrictionCluster(cluster: MssrToolFrictionOperationalProjection) {
  return {
    toolName: cluster.toolName,
    level: cluster.level,
    signal: cluster.signal,
    signature: cluster.signature,
    occurrenceCount: cluster.occurrenceCount,
    distinctWorkflowCount: cluster.distinctWorkflowCount,
    distinctTraceCount: cluster.distinctTraceCount,
    latestObservedAt: cluster.latestObservedAt,
    ageHours: cluster.ageHours,
    severity: cluster.severity,
    priorityScore: cluster.priorityScore,
    reasonCodes: cluster.reasonCodes,
    recommendedActions: cluster.recommendedActions,
    recommendedOwner: cluster.recommendedOwner,
    advisoryOnly: cluster.advisoryOnly,
  };
}

function actionableFrictionLevel(level: MssrToolFrictionOperationalProjection["level"] | undefined): boolean {
  return level === "error" || level === "review";
}

function frictionPriority(level: MssrToolFrictionOperationalProjection["level"] | undefined): number {
  if (level === "error") return 0;
  if (level === "review") return 1;
  return 2;
}

export function buildToolAudit(
  tools: readonly BridgeToolSchema[],
  snapshot: ToolAuditMetricSnapshot,
  args: ToolAuditArgs,
  friction?: BridgeToolFrictionProjection,
) {
  const metricsByTool = new Map(snapshot.rows.map((row) => [row.tool, row]));
  const frictionByTool = new Map<string, MssrToolFrictionOperationalProjection>();
  for (const cluster of friction?.clusters ?? []) {
    if (!frictionByTool.has(cluster.toolName)) frictionByTool.set(cluster.toolName, cluster);
  }
  const allItems = tools.map((tool) => {
    const metric = metricsByTool.get(tool.name);
    const calls = metricNumber(metric?.calls);
    const okCalls = metricNumber(metric?.okCalls);
    const errorCalls = metricNumber(metric?.errorCalls);
    const recommendation = recommendationFor(tool, metric);
    const toolFriction = frictionByTool.get(tool.name);
    return {
      tool: tool.name,
      description: tool.description,
      risk: riskOf(tool),
      metadata: tool.metadata ?? DEFAULT_METADATA,
      status: recommendation.status,
      recommendation: recommendation.recommendation,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
      maintenanceFriction: toolFriction ? publicFrictionCluster(toolFriction) : null,
      evidence: {
        calls,
        okCalls,
        errorCalls,
        successRate: percentage(okCalls, calls),
        errorRate: percentage(errorCalls, calls),
        avgDurationMs: metric?.avgDurationMs ?? null,
        maxDurationMs: metric?.maxDurationMs ?? null,
        lastStartedAt: metric?.lastStartedAt ?? null,
        lastSuccessAt: metric?.lastSuccessAt ?? null,
        lastErrorAt: metric?.lastErrorAt ?? null,
        uniqueSessions: metricNumber(metric?.uniqueSessions),
        uniqueProjects: metricNumber(metric?.uniqueProjects),
        errorCategories: metric?.errorCategories ?? [],
      },
    };
  });

  if (args.view === "tool" && (!args.toolName || !tools.some((tool) => tool.name === args.toolName))) {
    throw new Error("toolName must name one registered Bridge tool when view=tool.");
  }

  const filtered = allItems.filter((item) => {
    if (args.view === "tool") return item.tool === args.toolName;
    if (args.view === "aliases") return item.metadata.role === "alias";
    if (args.view === "fallback-overuse") return item.metadata.role === "fallback" && item.evidence.calls > 0;
    if (args.view === "unused") return item.evidence.calls === 0;
    if (args.view === "needs-attention") {
      return actionableFrictionLevel(item.maintenanceFriction?.level)
        || !["protect", "maintain"].includes(item.status);
    }
    return true;
  });

  if (args.view === "needs-attention") {
    filtered.sort((a, b) => frictionPriority(a.maintenanceFriction?.level) - frictionPriority(b.maintenanceFriction?.level)
      || (b.maintenanceFriction?.priorityScore ?? 0) - (a.maintenanceFriction?.priorityScore ?? 0)
      || statusPriority(a.status) - statusPriority(b.status)
      || b.evidence.errorCalls - a.evidence.errorCalls
      || b.evidence.calls - a.evidence.calls
      || a.tool.localeCompare(b.tool));
  } else {
    filtered.sort((a, b) => statusPriority(a.status) - statusPriority(b.status)
      || b.evidence.errorCalls - a.evidence.errorCalls
      || b.evidence.calls - a.evidence.calls
      || a.tool.localeCompare(b.tool));
  }

  const statusCounts = allItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const registeredToolNames = new Set(tools.map((tool) => tool.name));
  const registeredFrictionClusters = (friction?.clusters ?? []).filter((cluster) => registeredToolNames.has(cluster.toolName));
  const returnedItems = filtered.slice(0, args.limit);
  const returnedToolNames = new Set(returnedItems.map((item) => item.tool));
  const returnedFrictionClusters = registeredFrictionClusters
    .filter((cluster) => returnedToolNames.has(cluster.toolName))
    .map(publicFrictionCluster);

  return {
    view: args.view,
    scope: snapshot.scope,
    days: snapshot.days,
    since: snapshot.since,
    metricsAvailable: snapshot.sqliteAvailable,
    summary: {
      registeredTools: tools.length,
      observedTools: allItems.filter((item) => item.evidence.calls > 0).length,
      toolsWithoutEvidence: allItems.filter((item) => item.evidence.calls === 0).length,
      returned: returnedItems.length,
      actionableRepeatedFrictionClusters: registeredFrictionClusters.filter((cluster) => cluster.signal === "repeated-friction" && actionableFrictionLevel(cluster.level)).length,
      statusCounts,
    },
    maintenanceFriction: {
      metricsAvailable: friction?.metricsAvailable ?? false,
      observedFailures: friction?.observedFailures ?? 0,
      classifiedFailures: friction?.classifiedFailures ?? 0,
      ignoredUnclassifiedFailures: friction?.ignoredUnclassifiedFailures ?? 0,
      clusters: returnedFrictionClusters,
    },
    privacy: {
      rawArgumentsStored: false,
      rawPromptsStored: false,
      rawErrorTextReturned: false,
      evidence: "bounded aggregate metrics, redacted error categories, and sanitized stable failure signatures",
    },
    items: returnedItems,
  };
}
