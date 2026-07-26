import { z } from "zod";
import type { MetricsVisualizationKind } from "../visualizations.js";
import { getMetricsStatus, getMetricsSummary, getRecentMetrics, type BridgeMetricsScope } from "../metrics.js";
import { getMetricsVisualization, getVisualizationCatalog } from "../visualizations.js";
import type { BridgeToolModule } from "./types.js";

const metricKinds = ["status", "summary", "recent", "visualization_catalog", "visualize"] as const;
const visualizationKinds = ["calls_by_tool", "avg_duration_by_tool", "errors_by_tool", "activity_timeline", "success_mix"] as const;
const metricScopes = ["active", "all"] as const;

function metricsQuery(kind: typeof metricKinds[number], limit: number, chartKind: MetricsVisualizationKind, scope: BridgeMetricsScope) {
  switch (kind) {
    case "status":
      return getMetricsStatus();
    case "summary":
      return getMetricsSummary(limit, scope);
    case "recent":
      return getRecentMetrics(limit, scope);
    case "visualization_catalog":
      return getVisualizationCatalog();
    case "visualize":
      return getMetricsVisualization(chartKind, Math.min(limit, 20), scope);
  }
}

export const metricsToolModule: BridgeToolModule = {
  name: "metrics",
  tools: [
    { name: "bridge_metrics_query", description: "Compact read-only bridge metrics query. Active scope starts at the shared observability epoch; all preserves history.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: metricKinds, default: "summary" }, scope: { type: "string", enum: metricScopes, default: "active" }, limit: { type: "number", default: 50, minimum: 1, maximum: 200 }, chartKind: { type: "string", enum: visualizationKinds, default: "calls_by_tool" } }, additionalProperties: false } },
    { name: "bridge_metrics_status", description: "Return metrics storage status and paths for bridge tool telemetry.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "bridge_metrics_summary", description: "Return Bridge tool metrics segmented by surface and observable agent profile. Active scope starts at the current epoch; all preserves history.", inputSchema: { type: "object", properties: { scope: { type: "string", enum: metricScopes, default: "active" }, limit: { type: "number", default: 50, minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "bridge_metrics_recent", description: "Return recent Bridge tool calls with trace, surface, model, and reasoning effort when observable.", inputSchema: { type: "object", properties: { scope: { type: "string", enum: metricScopes, default: "active" }, limit: { type: "number", default: 25, minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "bridge_visualization_catalog", description: "Return available bridge visualization cards and chart kinds.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "bridge_visualize_metrics", description: "Use this when the user wants a visual chart/card for active or all-history Bridge metrics.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: visualizationKinds, default: "calls_by_tool" }, scope: { type: "string", enum: metricScopes, default: "active" }, limit: { type: "number", default: 10, minimum: 1, maximum: 20 } }, additionalProperties: false } },
  ],
  handlers: {
    bridge_metrics_query: (args) => {
      const parsed = z.object({ kind: z.enum(metricKinds).default("summary"), scope: z.enum(metricScopes).default("active"), limit: z.number().int().min(1).max(200).default(50), chartKind: z.enum(visualizationKinds).default("calls_by_tool") }).parse(args);
      return metricsQuery(parsed.kind, parsed.limit, parsed.chartKind as MetricsVisualizationKind, parsed.scope);
    },
    bridge_metrics_status: () => getMetricsStatus(),
    bridge_metrics_summary: (args) => {
      const parsed = z.object({ scope: z.enum(metricScopes).default("active"), limit: z.number().int().min(1).max(200).default(50) }).parse(args);
      return getMetricsSummary(parsed.limit, parsed.scope);
    },
    bridge_metrics_recent: (args) => {
      const parsed = z.object({ scope: z.enum(metricScopes).default("active"), limit: z.number().int().min(1).max(200).default(25) }).parse(args);
      return getRecentMetrics(parsed.limit, parsed.scope);
    },
    bridge_visualization_catalog: () => getVisualizationCatalog(),
    bridge_visualize_metrics: (args) => {
      const parsed = z.object({
        kind: z.enum(visualizationKinds).default("calls_by_tool"),
        scope: z.enum(metricScopes).default("active"),
        limit: z.number().int().min(1).max(20).default(10),
      }).parse(args);
      return getMetricsVisualization(parsed.kind as MetricsVisualizationKind, parsed.limit, parsed.scope);
    },
  },
};
