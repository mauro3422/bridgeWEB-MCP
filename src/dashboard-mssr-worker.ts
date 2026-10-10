import { readdir } from "node:fs/promises";
import path from "node:path";
import { parentPort } from "node:worker_threads";

import { buildCapabilityInventory, buildHumanCockpitSnapshot, collectCockpitGitStates, collectWeeklyGitStates } from "./dashboard-cockpit.js";
import {
  buildContextInventoryCacheState,
  buildContextInventoryRollingWindow,
  contextInventoryRefreshDecision,
  loadContextInventoryCacheState,
  persistContextInventoryCacheState,
  type ContextInventoryCacheState,
} from "./context-inventory-cache.js";
import { compactMssrSummaryForDashboard } from "./dashboard-snapshot.js";
import {
  getMetricsDashboardSnapshot,
  getMetricsErrors,
  getMetricsOverview,
  getMetricsSummary,
  getMetricsTimeline,
  getRecentMetrics,
} from "./metrics.js";
import { queryMssrObservatory } from "./mssr-observatory.js";
import type { ToolAuditView } from "./tool-audit.js";
import { getSkillHealthReport } from "./skill-health.js";
import { getProjectHealthReport } from "./project-health.js";
import { getRuntimeHealthReport } from "./runtime-health.js";
import { getDefaultToolAudit, getDefaultToolCatalog } from "./tool-registry.js";

const CONTEXT_INVENTORY_STATE_PATH = path.resolve(
  process.env.BRIDGE_MCP_CONTEXT_INVENTORY_STATE
    || path.join(process.env.BRIDGE_MCP_METRICS_DIR || path.join(process.cwd(), "data"), "context-inventory-state.json"),
);
const parsedContextInventoryMaxAgeMs = Number(process.env.BRIDGE_MCP_CONTEXT_INVENTORY_MAX_AGE_MS ?? 60 * 60 * 1000);
const CONTEXT_INVENTORY_MAX_AGE_MS = Number.isFinite(parsedContextInventoryMaxAgeMs)
  ? Math.max(60_000, Math.floor(parsedContextInventoryMaxAgeMs))
  : 60 * 60 * 1000;
let contextInventoryState: ContextInventoryCacheState | null | undefined;

async function getContextInventoryState(): Promise<ContextInventoryCacheState | null> {
  if (contextInventoryState !== undefined) return contextInventoryState;
  contextInventoryState = await loadContextInventoryCacheState(CONTEXT_INVENTORY_STATE_PATH);
  return contextInventoryState;
}

async function countWorkflowGuides(): Promise<number> {
  try {
    const entries = await readdir(path.join(process.cwd(), "integrations", "workflow-guides"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function buildSnapshot() {
  const metrics = getMetricsDashboardSnapshot(12, "active");
  const mssrSummary = queryMssrObservatory({ kind: "summary", days: 30, scope: "active" });
  const mssrRecent = queryMssrObservatory({ kind: "recent", days: 3, scope: "active", limit: 200 });
  const [projectHealth, skillHealth, runtimeHealth, workflowGuideCount, cachedInventory] = await Promise.all([
    getProjectHealthReport(),
    getSkillHealthReport(),
    getRuntimeHealthReport(),
    countWorkflowGuides(),
    getContextInventoryState(),
  ]);

  const inventoryDecision = contextInventoryRefreshDecision({
    state: cachedInventory,
    recent: mssrRecent,
    maxAgeMs: CONTEXT_INVENTORY_MAX_AGE_MS,
  });
  let inventoryState = cachedInventory;
  if (inventoryDecision.refresh) {
    const rebuiltWeeklySummary = queryMssrObservatory({ kind: "summary", days: 7, scope: "all" });
    const rebuiltWeeklyGitStates = await collectWeeklyGitStates({ projectHealth, weeklySummary: rebuiltWeeklySummary, maxProjects: 12 });
    inventoryState = buildContextInventoryCacheState({
      weeklySummary: rebuiltWeeklySummary,
      weeklyGitStates: rebuiltWeeklyGitStates,
      recent: mssrRecent,
      previous: cachedInventory,
      refreshReason: inventoryDecision.reason,
    });
    contextInventoryState = inventoryState;
    await persistContextInventoryCacheState(CONTEXT_INVENTORY_STATE_PATH, inventoryState);
  }
  if (!inventoryState) throw new Error("context inventory cache unavailable after refresh");

  const weeklySummary = inventoryState.weeklySummary;
  const weeklyGitStates = inventoryState.weeklyGitStates as Awaited<ReturnType<typeof collectWeeklyGitStates>>;
  const gitStates = await collectCockpitGitStates({ projectHealth, observatoryRecent: mssrRecent, maxProjects: 6 });
  const capabilityInventory = buildCapabilityInventory({
    toolCatalog: getDefaultToolCatalog(),
    skillHealth,
    workflowGuideCount,
  });
  const rolling30d = buildContextInventoryRollingWindow({
    dailySnapshots: inventoryState.dailySnapshots,
    days: 30,
  });
  const contextInventory = {
    schemaVersion: 1,
    mode: inventoryDecision.refresh ? "refreshed" : "cached",
    refreshReason: inventoryDecision.refresh ? inventoryDecision.reason : inventoryState.refreshReason,
    refreshedAt: inventoryState.refreshedAt,
    sourceLatestAt: inventoryState.sourceLatestAt,
    maxAgeMs: CONTEXT_INVENTORY_MAX_AGE_MS,
    dailySnapshotCount: inventoryState.dailySnapshots.length,
    oldestDailySnapshot: inventoryState.dailySnapshots.at(-1)?.date ?? null,
    rolling30d,
    newestDailySnapshot: inventoryState.dailySnapshots[0]?.date ?? null,
    recoveryMode: "scope-all-rebuild",
  };

  return {
    overview: metrics.overview,
    summary: metrics.summary,
    recent: getRecentMetrics(20, "active"),
    errors: getMetricsErrors(20, "active"),
    timeline: getMetricsTimeline(500, "active"),
    toolAudit: getDefaultToolAudit({ view: "all", scope: "active", days: 30, limit: 200 }),
    mssr: compactMssrSummaryForDashboard(mssrSummary),
    skillHealth,
    projectHealth,
    runtimeHealth,
    capabilities: capabilityInventory,
    contextInventory,
    cockpit: buildHumanCockpitSnapshot({
      observatoryRecent: mssrRecent,
      projectHealth,
      gitStates,
      weeklySummary,
      weeklyGitStates,
      capabilityInventory,
      contextInventory,
    }),
  };
}

async function handleRequest(
  requestId: string | null,
  type: "snapshot" | "mssr-summary" | "tool-audit" | "metrics-api" = "snapshot",
  args: {
    days?: number;
    scope?: "active" | "all";
    view?: ToolAuditView;
    toolName?: string;
    limit?: number;
    metricsKind?: "overview" | "summary" | "recent" | "errors" | "timeline";
  } = {},
) {
  try {
    const value = type === "mssr-summary"
      ? queryMssrObservatory({ kind: "summary", days: args.days, scope: args.scope }) as Record<string, unknown>
      : type === "tool-audit"
        ? getDefaultToolAudit({
            view: args.view ?? "all",
            ...(args.toolName ? { toolName: args.toolName } : {}),
            scope: args.scope ?? "active",
            days: args.days ?? 30,
            limit: args.limit ?? 127,
          }) as Record<string, unknown>
        : type === "metrics-api"
          ? args.metricsKind === "overview"
            ? getMetricsOverview(args.scope ?? "active") as Record<string, unknown>
            : args.metricsKind === "summary"
              ? getMetricsSummary(args.limit ?? 50, args.scope ?? "active") as Record<string, unknown>
              : args.metricsKind === "recent"
                ? getRecentMetrics(args.limit ?? 25, args.scope ?? "active") as Record<string, unknown>
                : args.metricsKind === "errors"
                  ? getMetricsErrors(args.limit ?? 25, args.scope ?? "active") as Record<string, unknown>
                  : args.metricsKind === "timeline"
                    ? getMetricsTimeline(args.limit ?? 500, args.scope ?? "active") as Record<string, unknown>
                    : (() => { throw new Error("metricsKind must identify a supported metrics read endpoint."); })()
        : await buildSnapshot();
    return { ok: true, requestId, value };
  } catch (error) {
    return { ok: false, requestId, error: error instanceof Error ? error.message : String(error) };
  }
}

if (parentPort) {
  const workerPort = parentPort;
  workerPort.on("message", (message: unknown) => {
    const payload = message && typeof message === "object" ? message as Record<string, unknown> : {};
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    const type = payload.type === "mssr-summary" || payload.type === "tool-audit" || payload.type === "metrics-api" ? payload.type : "snapshot";
    const scope = payload.scope === "all" ? "all" : "active";
    const days = typeof payload.days === "number" && Number.isFinite(payload.days) ? payload.days : undefined;
    const view = typeof payload.view === "string" ? payload.view as ToolAuditView : undefined;
    const toolName = typeof payload.toolName === "string" ? payload.toolName : undefined;
    const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit) ? payload.limit : undefined;
    const metricsKind = payload.metricsKind === "overview" || payload.metricsKind === "summary" || payload.metricsKind === "recent" || payload.metricsKind === "errors" || payload.metricsKind === "timeline"
      ? payload.metricsKind
      : undefined;
    workerPort.postMessage({ type: "dashboard-worker-request-accepted", requestId });
    void handleRequest(requestId, type, { days, scope, view, toolName, limit, metricsKind }).then((result) => workerPort.postMessage(result));
  });
  workerPort.postMessage({ type: "dashboard-worker-ready" });
} else if (typeof process.send === "function") {
  process.on("message", (message: unknown) => {
    const payload = message && typeof message === "object" ? message as Record<string, unknown> : {};
    if (payload.type !== "snapshot" && payload.type !== "mssr-summary" && payload.type !== "tool-audit" && payload.type !== "metrics-api") return;
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    const type = payload.type === "mssr-summary" || payload.type === "tool-audit" || payload.type === "metrics-api" ? payload.type : "snapshot";
    const scope = payload.scope === "all" ? "all" : "active";
    const days = typeof payload.days === "number" && Number.isFinite(payload.days) ? payload.days : undefined;
    const view = typeof payload.view === "string" ? payload.view as ToolAuditView : undefined;
    const toolName = typeof payload.toolName === "string" ? payload.toolName : undefined;
    const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit) ? payload.limit : undefined;
    const metricsKind = payload.metricsKind === "overview" || payload.metricsKind === "summary" || payload.metricsKind === "recent" || payload.metricsKind === "errors" || payload.metricsKind === "timeline"
      ? payload.metricsKind
      : undefined;
    if (typeof process.send === "function") process.send({ type: "dashboard-worker-request-accepted", requestId });
    void handleRequest(requestId, type, { days, scope, view, toolName, limit, metricsKind }).then((result) => {
      if (process.connected && typeof process.send === "function") process.send(result);
    });
  });
  process.send({ type: "dashboard-worker-ready" });
  process.on("disconnect", () => process.exit(0));
} else {
  void handleRequest(null).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}
