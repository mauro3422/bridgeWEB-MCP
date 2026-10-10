import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type UnknownRecord = Record<string, unknown>;

export type ContextInventoryDailySnapshot = {
  date: string;
  capturedAt: string;
  latestAt: string | null;
  traceCount: number;
  projectCount: number;
  projects: string[];
  workflowKeys: string[];
  openTraceCount: number;
  humanOpenTraceCount: number;
  supportOpenTraceCount: number;
  needsClosureReviewCount: number;
  humanNeedsClosureReviewCount: number;
  supportNeedsClosureReviewCount: number;
  latestSummaries: Array<{ project: string; summary: string }>;
};

export type ContextInventoryCacheState = {
  schemaVersion: 1;
  savedAt: string;
  refreshedAt: string;
  refreshReason: string;
  sourceLatestAt: string | null;
  weeklySummary: UnknownRecord;
  weeklyGitStates: unknown[];
  dailySnapshots: ContextInventoryDailySnapshot[];
};

export type ContextInventoryRollingWindow = {
  days: number;
  sinceDate: string;
  untilDate: string;
  snapshotCount: number;
  activityDayCount: number;
  coverageRatio: number;
  coverage: "complete" | "partial";
  traceDayObservations: number;
  projectCount: number;
  projects: Array<{ name: string; activeDays: number; lastSeenDate: string }>;
  workflowCount: number;
  workflowKeys: string[];
  latestSummaries: Array<{ project: string; summary: string; date: string }>;
};

const MATERIAL_EVENT_TYPES = new Set([
  "route_planned",
  "phase_completed",
  "verification",
  "persistence",
  "outcome",
  "replan",
  "friction",
  "project_context_selection",
  "closure_reminder",
]);

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown, limit: number): string[] {
  return asArray(value)
    .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    .slice(0, limit);
}

function finiteCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function localDayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function localDayKeyOffset(now: Date, offsetDays: number): string {
  return localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, 12, 0, 0, 0));
}

function compactDailyRow(value: unknown, capturedAt: string): ContextInventoryDailySnapshot | null {
  const row = asRecord(value);
  const date = stringValue(row.date);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    capturedAt,
    latestAt: stringValue(row.latestAt),
    traceCount: finiteCount(row.traceCount),
    projectCount: finiteCount(row.projectCount),
    projects: stringArray(row.projects, 20),
    workflowKeys: stringArray(row.workflowKeys, 24),
    openTraceCount: finiteCount(row.openTraceCount),
    humanOpenTraceCount: finiteCount(row.humanOpenTraceCount ?? row.openTraceCount),
    supportOpenTraceCount: finiteCount(row.supportOpenTraceCount),
    needsClosureReviewCount: finiteCount(row.needsClosureReviewCount),
    humanNeedsClosureReviewCount: finiteCount(row.humanNeedsClosureReviewCount ?? row.needsClosureReviewCount),
    supportNeedsClosureReviewCount: finiteCount(row.supportNeedsClosureReviewCount),
    latestSummaries: asArray(row.latestSummaries).map(asRecord).flatMap((summary) => {
      const project = stringValue(summary.project);
      const text = stringValue(summary.summary);
      return project && text ? [{ project, summary: text.slice(0, 300) }] : [];
    }).slice(0, 10),
  };
}

export function compactWeeklyInventorySummary(value: unknown): UnknownRecord {
  const root = asRecord(value);
  const history = asRecord(root.workHistory);
  return {
    scope: stringValue(history.scope) ?? stringValue(root.scope) ?? "all",
    days: finiteCount(history.days ?? root.days) || 7,
    since: stringValue(history.since) ?? stringValue(root.since),
    workHistory: history,
  };
}

export function latestMaterialContextEventAt(recent: unknown): string | null {
  const root = asRecord(recent);
  let latest: string | null = null;
  for (const item of asArray(root.recent)) {
    const event = asRecord(item);
    const eventType = stringValue(event.eventType);
    const occurredAt = stringValue(event.occurredAt);
    if (!eventType || !occurredAt || !MATERIAL_EVENT_TYPES.has(eventType)) continue;
    if (!latest || occurredAt > latest) latest = occurredAt;
  }
  return latest;
}

export function contextInventoryRefreshDecision(input: {
  state: ContextInventoryCacheState | null;
  recent: unknown;
  now?: Date;
  maxAgeMs: number;
}): { refresh: boolean; reason: "missing" | "ttl" | "material-event" | "cached"; sourceLatestAt: string | null } {
  const sourceLatestAt = latestMaterialContextEventAt(input.recent);
  if (!input.state) return { refresh: true, reason: "missing", sourceLatestAt };

  const nowMs = (input.now ?? new Date()).getTime();
  const refreshedMs = Date.parse(input.state.refreshedAt);
  if (!Number.isFinite(refreshedMs) || nowMs - refreshedMs >= Math.max(1_000, input.maxAgeMs)) {
    return { refresh: true, reason: "ttl", sourceLatestAt };
  }
  if (sourceLatestAt && (!input.state.sourceLatestAt || sourceLatestAt > input.state.sourceLatestAt)) {
    return { refresh: true, reason: "material-event", sourceLatestAt };
  }
  return { refresh: false, reason: "cached", sourceLatestAt };
}

export function buildContextInventoryCacheState(input: {
  weeklySummary: unknown;
  weeklyGitStates: unknown[];
  recent: unknown;
  previous?: ContextInventoryCacheState | null;
  now?: Date;
  refreshReason: string;
  maxDailySnapshots?: number;
}): ContextInventoryCacheState {
  const now = input.now ?? new Date();
  const capturedAt = now.toISOString();
  const weeklySummary = compactWeeklyInventorySummary(input.weeklySummary);
  const history = asRecord(weeklySummary.workHistory);
  const dailyByDate = new Map<string, ContextInventoryDailySnapshot>();

  for (const snapshot of input.previous?.dailySnapshots ?? []) dailyByDate.set(snapshot.date, snapshot);
  for (const row of asArray(history.daily)) {
    const snapshot = compactDailyRow(row, capturedAt);
    if (snapshot) dailyByDate.set(snapshot.date, snapshot);
  }

  const today = localDayKey(now);
  if (!dailyByDate.has(today)) {
    dailyByDate.set(today, {
      date: today,
      capturedAt,
      latestAt: null,
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
    });
  }

  const maxDailySnapshots = Math.max(7, Math.min(90, input.maxDailySnapshots ?? 35));
  return {
    schemaVersion: 1,
    savedAt: capturedAt,
    refreshedAt: capturedAt,
    refreshReason: input.refreshReason.slice(0, 80),
    sourceLatestAt: latestMaterialContextEventAt(input.recent),
    weeklySummary,
    weeklyGitStates: input.weeklyGitStates.slice(0, 12),
    dailySnapshots: [...dailyByDate.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, maxDailySnapshots),
  };
}

export function buildContextInventoryRollingWindow(input: {
  dailySnapshots: ContextInventoryDailySnapshot[];
  days?: number;
  now?: Date;
}): ContextInventoryRollingWindow {
  const now = input.now ?? new Date();
  const days = Math.max(1, Math.min(90, Math.floor(input.days ?? 30)));
  const untilDate = localDayKey(now);
  const sinceDate = localDayKeyOffset(now, -(days - 1));
  const snapshots = input.dailySnapshots
    .filter((snapshot) => snapshot.date >= sinceDate && snapshot.date <= untilDate)
    .sort((left, right) => right.date.localeCompare(left.date));

  const projectActivity = new Map<string, { name: string; activeDays: number; lastSeenDate: string }>();
  const workflowKeys = new Set<string>();
  const latestSummaries = new Map<string, { project: string; summary: string; date: string }>();
  let activityDayCount = 0;
  let traceDayObservations = 0;

  for (const snapshot of snapshots) {
    const dayProjects = new Map<string, string>();
    for (const project of snapshot.projects) dayProjects.set(project.toLowerCase(), project);
    const dayWorkflows = new Set(snapshot.workflowKeys);
    if (snapshot.traceCount > 0 || dayProjects.size > 0 || dayWorkflows.size > 0) activityDayCount += 1;
    traceDayObservations += snapshot.traceCount;

    for (const [projectKey, project] of dayProjects) {
      const current = projectActivity.get(projectKey);
      projectActivity.set(projectKey, {
        name: current?.name ?? project,
        activeDays: (current?.activeDays ?? 0) + 1,
        lastSeenDate: current?.lastSeenDate && current.lastSeenDate > snapshot.date ? current.lastSeenDate : snapshot.date,
      });
    }
    for (const workflowKey of dayWorkflows) workflowKeys.add(workflowKey);
    for (const summary of snapshot.latestSummaries) {
      const projectKey = summary.project.toLowerCase();
      if (!latestSummaries.has(projectKey)) {
        latestSummaries.set(projectKey, { project: summary.project, summary: summary.summary, date: snapshot.date });
      }
    }
  }

  const coveredDays = new Set(snapshots.map((snapshot) => snapshot.date)).size;
  const coverageRatio = Math.max(0, Math.min(1, coveredDays / days));

  const projects = [...projectActivity.entries()]
    .map(([, value]) => value)
    .sort((left, right) => right.activeDays - left.activeDays
      || right.lastSeenDate.localeCompare(left.lastSeenDate)
      || left.name.localeCompare(right.name))
    .slice(0, 40);
  const workflows = [...workflowKeys].sort().slice(0, 80);

  return {
    days,
    sinceDate,
    untilDate,
    snapshotCount: snapshots.length,
    activityDayCount,
    coverageRatio: Number(coverageRatio.toFixed(3)),
    coverage: coverageRatio >= 1 ? "complete" : "partial",
    traceDayObservations,
    projectCount: projectActivity.size,
    projects,
    workflowCount: workflowKeys.size,
    workflowKeys: workflows,
    latestSummaries: [...latestSummaries.values()].slice(0, 20),
  };
}

export async function loadContextInventoryCacheState(filePath: string): Promise<ContextInventoryCacheState | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as UnknownRecord;
    if (parsed.schemaVersion !== 1) return null;
    const refreshedAt = stringValue(parsed.refreshedAt);
    if (!refreshedAt || !parsed.weeklySummary || typeof parsed.weeklySummary !== "object") return null;
    return {
      schemaVersion: 1,
      savedAt: stringValue(parsed.savedAt) ?? refreshedAt,
      refreshedAt,
      refreshReason: stringValue(parsed.refreshReason) ?? "restored",
      sourceLatestAt: stringValue(parsed.sourceLatestAt),
      weeklySummary: asRecord(parsed.weeklySummary),
      weeklyGitStates: asArray(parsed.weeklyGitStates).slice(0, 12),
      dailySnapshots: asArray(parsed.dailySnapshots)
        .map((row) => compactDailyRow(row, stringValue(asRecord(row).capturedAt) ?? refreshedAt))
        .filter((row): row is ContextInventoryDailySnapshot => Boolean(row))
        .slice(0, 90),
    };
  } catch {
    return null;
  }
}

let contextInventoryCacheWriteTail: Promise<void> = Promise.resolve();

export function persistContextInventoryCacheState(filePath: string, state: ContextInventoryCacheState): Promise<void> {
  const write = contextInventoryCacheWriteTail.then(async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const value = { ...state, savedAt: new Date().toISOString() };
    try {
      await writeFile(tempPath, JSON.stringify(value), "utf8");
      await rename(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  });
  contextInventoryCacheWriteTail = write.catch(() => undefined);
  return write;
}
