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
import { getMetricsDashboardSnapshot, getMetricsErrors, getMetricsTimeline, getRecentMetrics } from "./metrics.js";
import { queryMssrObservatory } from "./mssr-observatory.js";
import { getSkillHealthReport } from "./skill-health.js";
import { getProjectHealthReport } from "./project-health.js";
import { getRuntimeHealthReport } from "./runtime-health.js";
import { getDefaultToolCatalog } from "./tool-registry.js";

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

async function handleRequest(requestId: string | null) {
  try {
    const value = await buildSnapshot();
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
    void handleRequest(requestId).then((result) => workerPort.postMessage(result));
  });
} else if (typeof process.send === "function") {
  process.on("message", (message: unknown) => {
    const payload = message && typeof message === "object" ? message as Record<string, unknown> : {};
    if (payload.type !== "snapshot") return;
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    void handleRequest(requestId).then((result) => {
      if (process.connected && typeof process.send === "function") process.send(result);
    });
  });
  process.on("disconnect", () => process.exit(0));
} else {
  void handleRequest(null).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}
