import {
  getMetricsErrors,
  getMetricsOverview,
  getMetricsSummary,
  getMetricsTimeline,
} from "./metrics.js";

type ChartType = "bar" | "line" | "pie" | "scatter";
type JsonRecord = Record<string, unknown>;

type ChartSeries = {
  dataKey: string;
  label?: string;
  axisLabel?: string;
  valueFormat?: "compact" | "integer" | "raw";
  valuePrefix?: string;
  valueSuffix?: string;
};

type ChartSpec = {
  chartType: ChartType;
  meta: {
    title: string;
    description: string;
    footer?: string;
  };
  xKey?: string;
  xAxisLabel?: string;
  series?: ChartSeries[];
  layout?: "vertical";
  nameKey?: string;
  valueKey?: string;
  data: JsonRecord[];
};

type VisualizationResult = {
  renderer: "charts_widget_v2";
  language: "recharts-json";
  chartSpec: ChartSpec;
  note: string;
};

export type MetricsVisualizationKind =
  | "calls_by_tool"
  | "avg_duration_by_tool"
  | "errors_by_tool"
  | "activity_timeline"
  | "success_mix";

function asRows(value: unknown, key: string): JsonRecord[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as Record<string, unknown>)[key];
  return Array.isArray(rows) ? rows.filter((row): row is JsonRecord => Boolean(row) && typeof row === "object") : [];
}

function asNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function topRows(rows: JsonRecord[], limit: number): JsonRecord[] {
  return rows.slice(0, Math.max(1, Math.min(limit, 20)));
}

function compactDateLabel(value: unknown): string {
  if (typeof value !== "string") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function makeResult(chartSpec: ChartSpec): VisualizationResult {
  return {
    renderer: "charts_widget_v2",
    language: "recharts-json",
    chartSpec,
    note: "Use chartSpec as the content payload for the ChatGPT charts_widget_v2 renderer when a visual card is useful.",
  };
}

export function getMetricsVisualization(kind: MetricsVisualizationKind, limit = 10): VisualizationResult {
  if (kind === "calls_by_tool") {
    const rows = topRows(asRows(getMetricsSummary(limit), "summary"), limit).map((row) => ({
      tool: String(row.tool ?? "unknown"),
      calls: asNumber(row.calls),
    }));

    return makeResult({
      chartType: "bar",
      meta: {
        title: "Bridge tool calls",
        description: "Cantidad de llamadas por tool registrada en SQLite.",
      },
      xKey: "tool",
      xAxisLabel: "Tool",
      layout: rows.length >= 6 ? "vertical" : undefined,
      series: [{ dataKey: "calls", label: "Calls", axisLabel: "Calls", valueFormat: "integer" }],
      data: rows,
    });
  }

  if (kind === "avg_duration_by_tool") {
    const rows = topRows(asRows(getMetricsSummary(limit), "summary"), limit).map((row) => ({
      tool: String(row.tool ?? "unknown"),
      avgDurationMs: asNumber(row.avg_duration_ms),
    }));

    return makeResult({
      chartType: "bar",
      meta: {
        title: "Average tool duration",
        description: "Duración promedio por tool en milisegundos.",
      },
      xKey: "tool",
      xAxisLabel: "Tool",
      layout: rows.length >= 6 ? "vertical" : undefined,
      series: [{ dataKey: "avgDurationMs", label: "Avg duration", axisLabel: "Milliseconds", valueFormat: "integer", valueSuffix: " ms" }],
      data: rows,
    });
  }

  if (kind === "errors_by_tool") {
    const rows = topRows(asRows(getMetricsSummary(limit), "summary"), limit)
      .map((row) => ({ tool: String(row.tool ?? "unknown"), errors: asNumber(row.error_calls) }))
      .filter((row) => row.errors > 0);

    return makeResult({
      chartType: "bar",
      meta: {
        title: "Bridge errors by tool",
        description: rows.length > 0 ? "Errores registrados por tool." : "No hay errores registrados todavía.",
      },
      xKey: "tool",
      xAxisLabel: "Tool",
      layout: rows.length >= 6 ? "vertical" : undefined,
      series: [{ dataKey: "errors", label: "Errors", axisLabel: "Errors", valueFormat: "integer" }],
      data: rows.length > 0 ? rows : [{ tool: "No errors", errors: 0 }],
    });
  }

  if (kind === "activity_timeline") {
    const rows = asRows(getMetricsTimeline(500), "timeline").map((row) => ({
      time: compactDateLabel(row.bucket),
      calls: asNumber(row.calls),
      errors: asNumber(row.errors),
    }));

    return makeResult({
      chartType: "line",
      meta: {
        title: "Bridge activity timeline",
        description: "Llamadas y errores agrupados en bloques de 5 minutos.",
      },
      xKey: "time",
      xAxisLabel: "Time",
      series: [
        { dataKey: "calls", label: "Calls", axisLabel: "Count", valueFormat: "integer" },
        { dataKey: "errors", label: "Errors", axisLabel: "Count", valueFormat: "integer" },
      ],
      data: rows,
    });
  }

  const overview = getMetricsOverview() as Record<string, unknown>;
  const totals = (overview.totals && typeof overview.totals === "object") ? overview.totals as Record<string, unknown> : {};
  const okCalls = asNumber(totals.okCalls);
  const errorCalls = asNumber(totals.errorCalls);

  return makeResult({
    chartType: "pie",
    meta: {
      title: "Bridge success mix",
      description: "Proporción de llamadas exitosas y fallidas.",
    },
    nameKey: "status",
    valueKey: "calls",
    series: [{ dataKey: "calls", label: "Calls", valueFormat: "integer" }],
    data: [
      { status: "OK", calls: okCalls },
      { status: "Errors", calls: errorCalls },
    ],
  });
}

export function getVisualizationCatalog() {
  return {
    renderer: "charts_widget_v2",
    available: [
      { kind: "calls_by_tool", label: "Tool calls", chartType: "bar" },
      { kind: "avg_duration_by_tool", label: "Average duration", chartType: "bar" },
      { kind: "errors_by_tool", label: "Errors by tool", chartType: "bar" },
      { kind: "activity_timeline", label: "Activity timeline", chartType: "line" },
      { kind: "success_mix", label: "Success mix", chartType: "pie" },
    ],
  };
}
