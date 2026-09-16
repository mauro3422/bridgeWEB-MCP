import { parentPort } from "node:worker_threads";
import { compactMssrSummaryForDashboard } from "./dashboard-snapshot.js";
import { getMetricsDashboardSnapshot, getMetricsErrors, getMetricsTimeline, getRecentMetrics } from "./metrics.js";
import { queryMssrObservatory } from "./mssr-observatory.js";
import { getSkillHealthReport } from "./skill-health.js";
import { getProjectHealthReport } from "./project-health.js";
import { getRuntimeHealthReport } from "./runtime-health.js";
import { getDefaultToolAudit } from "./tool-registry.js";

void (async () => {
  try {
    const metrics = getMetricsDashboardSnapshot(12, "active");
    const value = {
      overview: metrics.overview,
      summary: metrics.summary,
      recent: getRecentMetrics(20, "active"),
      errors: getMetricsErrors(20, "active"),
      timeline: getMetricsTimeline(500, "active"),
      mssr: compactMssrSummaryForDashboard(queryMssrObservatory({ kind: "summary", days: 30, scope: "active" })),
      skillHealth: await getSkillHealthReport(),
      projectHealth: await getProjectHealthReport(),
      runtimeHealth: await getRuntimeHealthReport(),
      toolAudit: getDefaultToolAudit({ view: "all", scope: "active", days: 30, limit: 200 }),
    };
    parentPort?.postMessage({ ok: true, value });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
