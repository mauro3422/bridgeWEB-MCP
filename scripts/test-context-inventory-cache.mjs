import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildContextInventoryCacheState,
  buildContextInventoryRollingWindow,
  compactWeeklyInventorySummary,
  contextInventoryRefreshDecision,
  latestMaterialContextEventAt,
  loadContextInventoryCacheState,
  persistContextInventoryCacheState,
} from "../dist/context-inventory-cache.js";

const now = new Date("2026-09-25T15:00:00.000Z");
const weeklySummary = {
  scope: "all",
  days: 7,
  since: "2026-09-18T15:00:00.000Z",
  noisyUnrelatedProjection: { shouldNotPersist: true },
  workHistory: {
    scope: "all",
    days: 7,
    since: "2026-09-18T15:00:00.000Z",
    traceCount: 9,
    projectCount: 2,
    projects: [{ name: "bridge-mcp" }, { name: "GitTeach" }],
    openTraces: [{ traceId: "trace-open", project: "bridge-mcp" }],
    daily: [{
      date: "2026-09-24",
      latestAt: "2026-09-24T23:00:00.000Z",
      traceCount: 4,
      projectCount: 2,
      projects: ["bridge-mcp", "GitTeach"],
      workflowKeys: ["context-layer", "gitteach-onboarding"],
      openTraceCount: 2,
      humanOpenTraceCount: 1,
      supportOpenTraceCount: 1,
      needsClosureReviewCount: 1,
      humanNeedsClosureReviewCount: 1,
      supportNeedsClosureReviewCount: 0,
      latestSummaries: [{ project: "bridge-mcp", summary: "P1/P3 adopted live." }],
    }],
  },
};

const recent = {
  recent: [
    { eventType: "skill_loaded", occurredAt: "2026-09-25T12:05:00.000Z" },
    { eventType: "outcome", occurredAt: "2026-09-25T12:00:00.000Z" },
  ],
};

assert.equal(latestMaterialContextEventAt(recent), "2026-09-25T12:00:00.000Z");
assert.equal(contextInventoryRefreshDecision({ state: null, recent, now, maxAgeMs: 3_600_000 }).reason, "missing");

const compact = compactWeeklyInventorySummary(weeklySummary);
assert.equal(compact.noisyUnrelatedProjection, undefined);
assert.equal(compact.scope, "all");
assert.equal(compact.workHistory.traceCount, 9);

const state = buildContextInventoryCacheState({
  weeklySummary,
  weeklyGitStates: [{ project: "bridge-mcp", clean: false }],
  recent,
  now,
  refreshReason: "missing",
});
assert.equal(state.schemaVersion, 1);
assert.equal(state.sourceLatestAt, "2026-09-25T12:00:00.000Z");
assert.equal(state.dailySnapshots.length, 2, "stored history should include observed prior day plus current-day placeholder");
assert.equal(state.dailySnapshots[0].date, "2026-09-25");
assert.equal(state.dailySnapshots[1].humanOpenTraceCount, 1);
assert.equal(state.weeklyGitStates.length, 1);

const rollingDaily = (date, overrides = {}) => ({
  date,
  capturedAt: `${date}T15:00:00.000Z`,
  latestAt: `${date}T14:00:00.000Z`,
  traceCount: 0,
  projectCount: 0,
  projects: [],
  workflowKeys: [],
  openTraceCount: 0,
  humanOpenTraceCount: 0,
  supportOpenTraceCount: 0,
  needsClosureReviewCount: 0,
  humanNeedsClosureReviewCount: 0,
  supportNeedsClosureReviewCount: 0,
  latestSummaries: [],
  ...overrides,
});

const rolling30dPartial = buildContextInventoryRollingWindow({
  now,
  days: 30,
  dailySnapshots: [
    rollingDaily("2026-09-25", {
      traceCount: 3,
      projectCount: 1,
      projects: ["bridge-mcp", "bridge-mcp"],
      workflowKeys: ["context-layer"],
      latestSummaries: [{ project: "bridge-mcp", summary: "Latest context-layer checkpoint." }],
    }),
    rollingDaily("2026-09-20", {
      traceCount: 5,
      projectCount: 2,
      projects: ["Bridge-MCP", "GitTeach"],
      workflowKeys: ["context-layer", "gitteach-onboarding"],
      latestSummaries: [{ project: "BRIDGE-MCP", summary: "Older bridge summary." }],
    }),
  ],
});
assert.equal(rolling30dPartial.days, 30);
assert.equal(rolling30dPartial.sinceDate, "2026-08-27");
assert.equal(rolling30dPartial.untilDate, "2026-09-25");
assert.equal(rolling30dPartial.coverage, "partial");
assert.equal(rolling30dPartial.coverageRatio, 0.067);
assert.equal(rolling30dPartial.activityDayCount, 2);
assert.equal(rolling30dPartial.traceDayObservations, 8);
assert.equal(rolling30dPartial.projectCount, 2);
assert.equal(rolling30dPartial.workflowCount, 2);
assert.deepEqual(rolling30dPartial.projects[0], { name: "bridge-mcp", activeDays: 2, lastSeenDate: "2026-09-25" });
assert.equal(rolling30dPartial.latestSummaries[0].summary, "Latest context-layer checkpoint.");

const completeDailySnapshots = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(2026, 8, 25 - index, 12, 0, 0, 0).toISOString().slice(0, 10);
  if (index === 0) return rollingDaily(date, { traceCount: 1, projects: ["bridge-mcp"] });
  if (index === 29) return rollingDaily(date, { traceCount: 1, projects: ["maestro-agua"], workflowKeys: ["water-loop"] });
  return rollingDaily(date);
});
const rolling30dComplete = buildContextInventoryRollingWindow({
  now,
  days: 30,
  dailySnapshots: completeDailySnapshots,
});
assert.equal(rolling30dComplete.coverage, "complete");
assert.equal(rolling30dComplete.coverageRatio, 1);
assert.equal(rolling30dComplete.snapshotCount, 30);

const cachedDecision = contextInventoryRefreshDecision({ state, recent, now: new Date("2026-09-25T15:30:00.000Z"), maxAgeMs: 3_600_000 });
assert.deepEqual(cachedDecision, { refresh: false, reason: "cached", sourceLatestAt: "2026-09-25T12:00:00.000Z" });

const noisyNewerRecent = {
  recent: [{ eventType: "skill_loaded", occurredAt: "2026-09-25T15:40:00.000Z" }],
};
assert.equal(contextInventoryRefreshDecision({ state, recent: noisyNewerRecent, now: new Date("2026-09-25T15:40:00.000Z"), maxAgeMs: 3_600_000 }).reason, "cached");

const materialNewerRecent = {
  recent: [{ eventType: "phase_completed", occurredAt: "2026-09-25T15:41:00.000Z" }],
};
const materialDecision = contextInventoryRefreshDecision({ state, recent: materialNewerRecent, now: new Date("2026-09-25T15:41:00.000Z"), maxAgeMs: 3_600_000 });
assert.equal(materialDecision.refresh, true);
assert.equal(materialDecision.reason, "material-event");

const ttlDecision = contextInventoryRefreshDecision({ state, recent, now: new Date("2026-09-25T16:01:00.000Z"), maxAgeMs: 3_600_000 });
assert.equal(ttlDecision.refresh, true);
assert.equal(ttlDecision.reason, "ttl");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-context-inventory-"));
const statePath = path.join(sandbox, "context-inventory-state.json");
try {
  await persistContextInventoryCacheState(statePath, state);
  const restored = await loadContextInventoryCacheState(statePath);
  assert.ok(restored, "persisted context inventory should restore");
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.dailySnapshots.length, 2);
  assert.equal(restored.weeklySummary.workHistory.traceCount, 9);
  assert.equal(restored.weeklyGitStates.length, 1);
  assert.equal(restored.dailySnapshots[1].latestSummaries[0].summary, "P1/P3 adopted live.");
} finally {
  await fs.promises.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

console.log("context inventory cache tests passed");
