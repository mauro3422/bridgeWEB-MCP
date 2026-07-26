import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { getMssrObservabilityEpoch } from "./mssr-observability-epoch.js";

type JsonRecord = Record<string, unknown>;
export type BridgeMetricsScope = "active" | "all";
export type BridgeMetricProfile = {
  traceId?: string;
  caller?: string;
  model?: string;
  reasoningEffort?: string;
  clientName?: string;
  sessionKey?: string;
  project?: string;
  routingStatus?: "traced" | "unrouted" | "bootstrap" | "exempt";
};
type StatementSync = {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => JsonRecord | undefined;
  all: (...args: unknown[]) => JsonRecord[];
};
type DatabaseSync = {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementSync;
  close: () => void;
};
type SqliteModule = {
  DatabaseSync: new (filename: string) => DatabaseSync;
};

export type BridgeMetricStart = {
  id: string;
  tool: string;
  startedAtIso: string;
  startedAtMs: number;
  inputKeys: string;
  operationSubject?: string;
  observabilityEpoch: string;
  traceId?: string;
  caller: string;
  model: string;
  reasoningEffort: string;
  clientName: string;
  sessionKey: string;
  project: string;
  routingStatus: "traced" | "unrouted" | "bootstrap" | "exempt";
  mssrEligible: boolean;
};

export type BridgeMetricEnd = BridgeMetricStart & {
  ok: boolean;
  durationMs: number;
  outputChars: number;
  error?: string;
};

const require = createRequire(import.meta.url);
const metricsEnabled = process.env.BRIDGE_MCP_METRICS_ENABLED !== "0";
const metricsDir = path.resolve(process.env.BRIDGE_MCP_METRICS_DIR || path.join(process.cwd(), "data"));
const logsDir = path.resolve(process.env.BRIDGE_MCP_LOG_DIR || path.join(process.cwd(), "logs"));
const sqlitePath = path.resolve(process.env.BRIDGE_MCP_METRICS_SQLITE || path.join(metricsDir, "bridge-metrics.sqlite"));
const OPERATIONAL_METRIC_WHERE = "tool NOT LIKE '__test_%' AND tool <> 'metrics_regression'";
const jsonlPath = path.resolve(process.env.BRIDGE_MCP_EVENTS_JSONL || path.join(logsDir, "bridge-events.jsonl"));

let db: DatabaseSync | null | undefined;
let insertToolCall: StatementSync | null = null;

function tableColumns(database: DatabaseSync, table: string): Set<string> {
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all()
    .flatMap((row) => typeof row.name === "string" ? [row.name] : []));
}

function ensureToolCallProfileColumns(database: DatabaseSync): void {
  const columns = tableColumns(database, "tool_calls");
  const additions = [
    ["observability_epoch", "TEXT"],
    ["trace_id", "TEXT"],
    ["caller", "TEXT"],
    ["model", "TEXT"],
    ["reasoning_effort", "TEXT"],
    ["client_name", "TEXT"],
    ["session_key", "TEXT"],
    ["project", "TEXT"],
    ["routing_status", "TEXT"],
    ["mssr_eligible", "INTEGER"],
    ["operation_subject", "TEXT"],
  ] as const;
  for (const [name, type] of additions) {
    if (!columns.has(name)) database.exec(`ALTER TABLE tool_calls ADD COLUMN ${name} ${type};`);
  }
}

function ensureDirs() {
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

function loadSqlite(): SqliteModule | null {
  try {
    return require("node:sqlite") as SqliteModule;
  } catch {
    return null;
  }
}

function getDb(): DatabaseSync | null {
  if (!metricsEnabled) return null;
  if (db !== undefined) return db;

  ensureDirs();
  const sqlite = loadSqlite();
  if (!sqlite) {
    db = null;
    return null;
  }

  db = new sqlite.DatabaseSync(sqlitePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      tool TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      input_keys TEXT,
      output_chars INTEGER NOT NULL,
      server_name TEXT NOT NULL,
      server_version TEXT NOT NULL,
      pid INTEGER NOT NULL,
      hostname TEXT NOT NULL,
      platform TEXT NOT NULL,
      cwd TEXT NOT NULL,
      observability_epoch TEXT,
      trace_id TEXT,
      caller TEXT,
      model TEXT,
      reasoning_effort TEXT,
      client_name TEXT,
      session_key TEXT,
      project TEXT,
      routing_status TEXT,
      mssr_eligible INTEGER,
      operation_subject TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_calls_started_at ON tool_calls(started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_started_at ON tool_calls(tool, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_ok ON tool_calls(ok);
    CREATE VIEW IF NOT EXISTS tool_call_summary AS
      SELECT
        tool,
        COUNT(*) AS calls,
        SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_calls,
        SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS error_calls,
        ROUND(AVG(duration_ms), 2) AS avg_duration_ms,
        MAX(duration_ms) AS max_duration_ms,
        MAX(started_at) AS last_started_at
      FROM tool_calls
      GROUP BY tool;
  `);
  ensureToolCallProfileColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_calls_epoch_started_at ON tool_calls(observability_epoch, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_profile ON tool_calls(caller, model, reasoning_effort, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_trace_id ON tool_calls(trace_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_client_name ON tool_calls(client_name, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session_key ON tool_calls(session_key, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls(project, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_routing_status ON tool_calls(routing_status, started_at);
  `);
  insertToolCall = db.prepare(`
    INSERT INTO tool_calls (
      id, started_at, ended_at, duration_ms, tool, ok, error, input_keys,
      output_chars, server_name, server_version, pid, hostname, platform, cwd,
      observability_epoch, trace_id, caller, model, reasoning_effort, client_name,
      session_key, project, routing_status, mssr_eligible, operation_subject
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return db;
}

function redactText(value: string, maxChars = 500): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-REDACTED")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,}\]]+/gi, "$1=REDACTED")
    .slice(0, maxChars);
}

function writeJsonl(event: JsonRecord) {
  if (!metricsEnabled) return;
  ensureDirs();
  fs.appendFileSync(jsonlPath, `${JSON.stringify(event)}\n`, "utf8");
}

function boundedProfileText(value: unknown, fallback: string, maxChars: number): string {
  return typeof value === "string" && value.trim()
    ? redactText(value.trim(), maxChars)
    : fallback;
}

function operationSubject(tool: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const value = (() => {
    if (tool === "skill_load") return record.name;
    if (tool === "project_context_load" && typeof record.projectRoot === "string") {
      return path.basename(path.resolve(record.projectRoot));
    }
    if (tool === "skill_route_plan" || tool === "skill_bootstrap" || tool === "skill_recommend") {
      return record.stage ?? "start";
    }
    if (tool === "mssr_trace_record") return record.eventType;
    if (tool === "bridge_tool_query" || tool === "bridge_tool_action") return record.toolName;
    return undefined;
  })();
  return typeof value === "string" && value.trim() ? redactText(value.trim(), 120) : undefined;
}

export function beginToolMetric(tool: string, args: unknown, profile: BridgeMetricProfile = {}): BridgeMetricStart {
  const now = Date.now();
  const epoch = getMssrObservabilityEpoch();
  const routingStatus = profile.routingStatus ?? (profile.traceId ? "traced" : "unrouted");
  const inputKeys = args && typeof args === "object" && !Array.isArray(args)
    ? Object.keys(args as Record<string, unknown>).sort().join(",")
    : "";

  return {
    id: cryptoRandomId(),
    tool,
    startedAtIso: new Date(now).toISOString(),
    startedAtMs: now,
    inputKeys,
    operationSubject: operationSubject(tool, args),
    observabilityEpoch: epoch.activeEpoch,
    traceId: typeof profile.traceId === "string" ? profile.traceId.slice(0, 128) : undefined,
    caller: boundedProfileText(profile.caller, "other", 80),
    model: boundedProfileText(profile.model, "unknown", 80),
    reasoningEffort: boundedProfileText(profile.reasoningEffort, "unknown", 20),
    clientName: boundedProfileText(profile.clientName, "unknown", 120),
    sessionKey: boundedProfileText(profile.sessionKey, "unknown", 80),
    project: boundedProfileText(profile.project, "unknown", 120),
    routingStatus,
    mssrEligible: routingStatus === "traced" || routingStatus === "unrouted",
  };
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function finishToolMetric(metric: BridgeMetricStart, ok: boolean, outputChars: number, error?: string): BridgeMetricEnd {
  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - metric.startedAtMs);
  const safeError = error ? redactText(error) : null;

  const event: BridgeMetricEnd = {
    ...metric,
    ok,
    durationMs,
    outputChars,
    error: safeError || undefined,
  };

  if (!metricsEnabled) return event;

  writeJsonl({
    type: "tool_call",
    ...event,
    endedAtIso: endedAt.toISOString(),
    server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid },
    host: { hostname: os.hostname(), platform: os.platform(), cwd: process.cwd() },
    observability: {
      epoch: metric.observabilityEpoch,
      traceId: metric.traceId,
      caller: metric.caller,
      model: metric.model,
      reasoningEffort: metric.reasoningEffort,
      clientName: metric.clientName,
      sessionKey: metric.sessionKey,
      project: metric.project,
      routingStatus: metric.routingStatus,
      mssrEligible: metric.mssrEligible,
    },
  });

  const database = getDb();
  if (!database || !insertToolCall) return event;

  try {
    insertToolCall.run(
      metric.id,
      metric.startedAtIso,
      endedAt.toISOString(),
      durationMs,
      metric.tool,
      ok ? 1 : 0,
      safeError,
      metric.inputKeys,
      outputChars,
      SERVER_NAME,
      SERVER_VERSION,
      process.pid,
      os.hostname(),
      os.platform(),
      process.cwd(),
      metric.observabilityEpoch,
      metric.traceId ?? null,
      metric.caller,
      metric.model,
      metric.reasoningEffort,
      metric.clientName,
      metric.sessionKey,
      metric.project,
      metric.routingStatus,
      metric.mssrEligible ? 1 : 0,
      metric.operationSubject ?? null,
    );
  } catch (sqliteError) {
    writeJsonl({
      type: "metrics_sqlite_error",
      at: endedAt.toISOString(),
      error: sqliteError instanceof Error ? redactText(sqliteError.message) : String(sqliteError),
    });
  }
  return event;
}

export function getMetricsStatus() {
  const sqlite = getDb();
  const epoch = getMssrObservabilityEpoch();
  return {
    enabled: metricsEnabled,
    sqliteAvailable: Boolean(sqlite),
    sqlitePath,
    jsonlPath,
    metricsDir,
    logsDir,
    observability: {
      defaultScope: "active",
      activeEpoch: epoch.activeEpoch,
      baselineAt: epoch.baselineAt,
      legacyScope: epoch.legacyScope,
    },
  };
}

function metricsFilter(scope: BridgeMetricsScope): { where: string; params: unknown[] } {
  if (scope === "all") return { where: OPERATIONAL_METRIC_WHERE, params: [] };
  const epoch = getMssrObservabilityEpoch();
  return {
    where: `${OPERATIONAL_METRIC_WHERE} AND observability_epoch = ? AND started_at >= ?`,
    params: [epoch.activeEpoch, epoch.baselineAt],
  };
}

function getMetricsProfiles(database: DatabaseSync, scope: BridgeMetricsScope) {
  const filter = metricsFilter(scope);
  const surfaces = database.prepare(`
    SELECT COALESCE(caller, 'other') AS caller,
      COUNT(*) AS calls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS error_calls,
      ROUND(AVG(duration_ms), 2) AS avg_duration_ms,
      SUM(CASE WHEN mssr_eligible = 1 THEN 1 ELSE 0 END) AS eligible_calls,
      SUM(CASE WHEN mssr_eligible = 1 AND trace_id IS NOT NULL THEN 1 ELSE 0 END) AS traced_calls,
      SUM(CASE WHEN mssr_eligible = 1 AND trace_id IS NULL THEN 1 ELSE 0 END) AS untraced_calls,
      CASE WHEN SUM(CASE WHEN mssr_eligible = 1 THEN 1 ELSE 0 END) > 0
        THEN ROUND(100.0 * SUM(CASE WHEN mssr_eligible = 1 AND trace_id IS NOT NULL THEN 1 ELSE 0 END)
          / SUM(CASE WHEN mssr_eligible = 1 THEN 1 ELSE 0 END), 2)
        ELSE NULL END AS mssr_trace_coverage
    FROM tool_calls
    WHERE ${filter.where}
    GROUP BY COALESCE(caller, 'other')
    ORDER BY calls DESC, caller ASC
  `).all(...filter.params);
  const agentProfiles = database.prepare(`
    SELECT COALESCE(caller, 'other') AS caller,
      COALESCE(model, 'unknown') AS model,
      COALESCE(reasoning_effort, 'unknown') AS reasoning_effort,
      COALESCE(project, 'unknown') AS project,
      COALESCE(session_key, 'unknown') AS session_key,
      COUNT(*) AS calls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS error_calls,
      ROUND(AVG(duration_ms), 2) AS avg_duration_ms,
      SUM(CASE WHEN mssr_eligible = 1 THEN 1 ELSE 0 END) AS eligible_calls,
      SUM(CASE WHEN mssr_eligible = 1 AND trace_id IS NOT NULL THEN 1 ELSE 0 END) AS traced_calls,
      SUM(CASE WHEN mssr_eligible = 1 AND trace_id IS NULL THEN 1 ELSE 0 END) AS untraced_calls,
      CASE WHEN SUM(CASE WHEN mssr_eligible = 1 THEN 1 ELSE 0 END) > 0
        THEN ROUND(100.0 * SUM(CASE WHEN mssr_eligible = 1 AND trace_id IS NOT NULL THEN 1 ELSE 0 END)
          / SUM(CASE WHEN mssr_eligible = 1 THEN 1 ELSE 0 END), 2)
        ELSE NULL END AS mssr_trace_coverage
    FROM tool_calls
    WHERE ${filter.where}
    GROUP BY COALESCE(caller, 'other'), COALESCE(model, 'unknown'), COALESCE(reasoning_effort, 'unknown'),
      COALESCE(project, 'unknown'), COALESCE(session_key, 'unknown')
    ORDER BY calls DESC, caller ASC, model ASC, reasoning_effort ASC, project ASC, session_key ASC
  `).all(...filter.params);
  return { surfaces, agentProfiles };
}

export function getMetricsSummary(limit = 50, scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), scope, summary: [], surfaces: [], agentProfiles: [] };
  const filter = metricsFilter(scope);
  const rows = sqlite.prepare(`
    SELECT tool,
      COUNT(*) AS calls,
      SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_calls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS error_calls,
      ROUND(AVG(duration_ms), 2) AS avg_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      MAX(started_at) AS last_started_at
    FROM tool_calls
    WHERE ${filter.where}
    GROUP BY tool
    ORDER BY calls DESC, tool ASC
    LIMIT ?
  `).all(...filter.params, limit);
  return { ...getMetricsStatus(), scope, summary: rows, ...getMetricsProfiles(sqlite, scope) };
}

export function getRecentMetrics(limit = 25, scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), scope, recent: [] };
  const filter = metricsFilter(scope);
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, ok, error, input_keys, operation_subject, output_chars, pid,
      trace_id, caller, model, reasoning_effort, client_name, session_key, project,
      routing_status, mssr_eligible
    FROM tool_calls
    WHERE ${filter.where}
    ORDER BY started_at DESC
    LIMIT ?
  `).all(...filter.params, limit);
  return { ...getMetricsStatus(), scope, recent: rows };
}

export function getMetricsErrors(limit = 25, scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), scope, errors: [] };
  const filter = metricsFilter(scope);
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, error, input_keys, operation_subject, output_chars, pid,
      trace_id, caller, model, reasoning_effort, client_name, session_key, project,
      routing_status, mssr_eligible
    FROM tool_calls
    WHERE ok = 0 AND ${filter.where}
    ORDER BY started_at DESC
    LIMIT ?
  `).all(...filter.params, limit);
  return { ...getMetricsStatus(), scope, errors: rows };
}

export function getMetricsOverview(scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) {
    return {
      ...getMetricsStatus(),
      scope,
      totals: { calls: 0, okCalls: 0, errorCalls: 0, avgDurationMs: 0, maxDurationMs: 0 },
      slowest: [],
      surfaces: [],
      agentProfiles: [],
    };
  }

  const filter = metricsFilter(scope);
  const totals = sqlite.prepare(`
    SELECT
      COUNT(*) AS calls,
      SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS okCalls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errorCalls,
      ROUND(AVG(duration_ms), 2) AS avgDurationMs,
      MAX(duration_ms) AS maxDurationMs
    FROM tool_calls
    WHERE ${filter.where}
  `).get(...filter.params) ?? { calls: 0, okCalls: 0, errorCalls: 0, avgDurationMs: 0, maxDurationMs: 0 };

  const slowest = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, ok, error, input_keys, operation_subject, output_chars, pid
    FROM tool_calls
    WHERE ${filter.where}
    ORDER BY duration_ms DESC
    LIMIT 10
  `).all(...filter.params);

  return { ...getMetricsStatus(), scope, totals, slowest, ...getMetricsProfiles(sqlite, scope) };
}

export function getMetricsTimeline(limit = 500, scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), scope, timeline: [] };
  const filter = metricsFilter(scope);
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, ok
    FROM tool_calls
    WHERE ${filter.where}
    ORDER BY started_at DESC
    LIMIT ?
  `).all(...filter.params, limit);

  const buckets = new Map<string, { bucket: string; calls: number; errors: number; totalDurationMs: number }>();
  for (const row of rows) {
    const startedAt = typeof row.started_at === "string" ? row.started_at : "";
    const date = new Date(startedAt);
    if (Number.isNaN(date.getTime())) continue;
    date.setSeconds(0, 0);
    const minute = date.getMinutes();
    date.setMinutes(minute - (minute % 5));
    const bucket = date.toISOString();
    const existing = buckets.get(bucket) ?? { bucket, calls: 0, errors: 0, totalDurationMs: 0 };
    existing.calls += 1;
    existing.errors += Number(row.ok) === 1 ? 0 : 1;
    existing.totalDurationMs += Number(row.duration_ms ?? 0);
    buckets.set(bucket, existing);
  }

  const timeline = Array.from(buckets.values())
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((bucket) => ({
      ...bucket,
      avgDurationMs: bucket.calls > 0 ? Math.round((bucket.totalDurationMs / bucket.calls) * 100) / 100 : 0,
    }));

  return { ...getMetricsStatus(), scope, timeline };
}

export function closeMetricsForTests(): void {
  if (db) db.close();
  db = undefined;
  insertToolCall = null;
}
