import { z } from "zod";
import type { MetricsVisualizationKind } from "../visualizations.js";
import { getMetricsStatus, getMetricsSummary, getRecentMetrics } from "../metrics.js";
import { getMetricsVisualization, getVisualizationCatalog } from "../visualizations.js";
import type { BridgeToolModule } from "./types.js";

const metricKinds = ["status", "summary", "recent", "visualization_catalog", "visualize"] as const;
const visualizationKinds = ["calls_by_tool", "avg_duration_by_tool", "errors_by_tool", "activity_timeline", "success_mix"] as const;

function metricsQuery(kind: typeof metricKinds[number], limit: number, chartKind: MetricsVisualizationKind) {
  switch (kind) {
    case "status":
      return getMetricsStatus();
    case "summary":
      return getMetricsSummary(limit);
    case "recent":
      return getRecentMetrics(limit);
    case "visualization_catalog":
      return getVisualizationCatalog();
    case "visualize":
      return getMetricsVisualization(chartKind, Math.min(limit, 20));
  }
}

export const metricsToolModule: BridgeToolModule = {
  name: "metrics",
  tools: [
    { name: "bridge_metrics_query", description: "Compact read-only bridge metrics query. Use kind=status, summary, recent, visualization_catalog, or visualize.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: metricKinds, default: "summary" }, limit: { type: "number", default: 50, minimum: 1, maximum: 200 }, chartKind: { type: "string", enum: visualizationKinds, default: "calls_by_tool" } }, additionalProperties: false } },
    { name: "bridge_metrics_status", description: "Return metrics storage status and paths for bridge tool telemetry.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "bridge_metrics_summary", description: "Return aggregated bridge tool metrics from SQLite.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 50, minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "bridge_metrics_recent", description: "Return recent bridge tool calls from SQLite.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 25, minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "bridge_visualization_catalog", description: "Return available bridge visualization cards and chart kinds.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "bridge_visualize_metrics", description: "Use this when the user wants a visual chart/card for bridge metrics. Returns a chart spec compatible with ChatGPT chart rendering.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: visualizationKinds, default: "calls_by_tool" }, limit: { type: "number", default: 10, minimum: 1, maximum: 20 } }, additionalProperties: false } },
  ],
  handlers: {
    bridge_metrics_query: (args) => {
      const parsed = z.object({ kind: z.enum(metricKinds).default("summary"), limit: z.number().int().min(1).max(200).default(50), chartKind: z.enum(visualizationKinds).default("calls_by_tool") }).parse(args);
      return metricsQuery(parsed.kind, parsed.limit, parsed.chartKind as MetricsVisualizationKind);
    },
    bridge_metrics_status: () => getMetricsStatus(),
    bridge_metrics_summary: (args) => {
      const parsed = z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(args);
      return getMetricsSummary(parsed.limit);
    },
    bridge_metrics_recent: (args) => {
      const parsed = z.object({ limit: z.number().int().min(1).max(200).default(25) }).parse(args);
      return getRecentMetrics(parsed.limit);
    },
    bridge_visualization_catalog: () => getVisualizationCatalog(),
    bridge_visualize_metrics: (args) => {
      const parsed = z.object({
        kind: z.enum(visualizationKinds).default("calls_by_tool"),
        limit: z.number().int().min(1).max(20).default(10),
      }).parse(args);
      return getMetricsVisualization(parsed.kind as MetricsVisualizationKind, parsed.limit);
    },
  },
};
