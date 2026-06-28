import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";

type JsonRecord = Record<string, unknown>;
type StatementSync = {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => JsonRecord | undefined;
  all: (...args: unknown[]) => JsonRecord[];
};
type DatabaseSync = {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementSync;
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
const jsonlPath = path.resolve(process.env.BRIDGE_MCP_EVENTS_JSONL || path.join(logsDir, "bridge-events.jsonl"));

let db: DatabaseSync | null | undefined;
let insertToolCall: StatementSync | null = null;

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
      cwd TEXT NOT NULL
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
  insertToolCall = db.prepare(`
    INSERT INTO tool_calls (
      id, started_at, ended_at, duration_ms, tool, ok, error, input_keys,
      output_chars, server_name, server_version, pid, hostname, platform, cwd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

export function beginToolMetric(tool: string, args: unknown): BridgeMetricStart {
  const now = Date.now();
  const inputKeys = args && typeof args === "object" && !Array.isArray(args)
    ? Object.keys(args as Record<string, unknown>).sort().join(",")
    : "";

  return {
    id: cryptoRandomId(),
    tool,
    startedAtIso: new Date(now).toISOString(),
    startedAtMs: now,
    inputKeys,
  };
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function finishToolMetric(metric: BridgeMetricStart, ok: boolean, outputChars: number, error?: string) {
  if (!metricsEnabled) return;
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

  writeJsonl({
    type: "tool_call",
    ...event,
    endedAtIso: endedAt.toISOString(),
    server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid },
    host: { hostname: os.hostname(), platform: os.platform(), cwd: process.cwd() },
  });

  const database = getDb();
  if (!database || !insertToolCall) return;

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
    );
  } catch (sqliteError) {
    writeJsonl({
      type: "metrics_sqlite_error",
      at: endedAt.toISOString(),
      error: sqliteError instanceof Error ? redactText(sqliteError.message) : String(sqliteError),
    });
  }
}

export function getMetricsStatus() {
  const sqlite = getDb();
  return {
    enabled: metricsEnabled,
    sqliteAvailable: Boolean(sqlite),
    sqlitePath,
    jsonlPath,
    metricsDir,
    logsDir,
  };
}

export function getMetricsSummary(limit = 50) {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), summary: [] };
  const rows = sqlite.prepare(`
    SELECT tool, calls, ok_calls, error_calls, avg_duration_ms, max_duration_ms, last_started_at
    FROM tool_call_summary
    ORDER BY calls DESC, tool ASC
    LIMIT ?
  `).all(limit);
  return { ...getMetricsStatus(), summary: rows };
}

export function getRecentMetrics(limit = 25) {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), recent: [] };
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, ok, error, input_keys, output_chars, pid
    FROM tool_calls
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);
  return { ...getMetricsStatus(), recent: rows };
}

export function getMetricsErrors(limit = 25) {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), errors: [] };
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, error, input_keys, output_chars, pid
    FROM tool_calls
    WHERE ok = 0
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);
  return { ...getMetricsStatus(), errors: rows };
}

export function getMetricsOverview() {
  const sqlite = getDb();
  if (!sqlite) {
    return {
      ...getMetricsStatus(),
      totals: { calls: 0, okCalls: 0, errorCalls: 0, avgDurationMs: 0, maxDurationMs: 0 },
      slowest: [],
    };
  }

  const totals = sqlite.prepare(`
    SELECT
      COUNT(*) AS calls,
      SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS okCalls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errorCalls,
      ROUND(AVG(duration_ms), 2) AS avgDurationMs,
      MAX(duration_ms) AS maxDurationMs
    FROM tool_calls
  `).get() ?? { calls: 0, okCalls: 0, errorCalls: 0, avgDurationMs: 0, maxDurationMs: 0 };

  const slowest = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, ok, error, input_keys, output_chars, pid
    FROM tool_calls
    ORDER BY duration_ms DESC
    LIMIT 10
  `).all();

  return { ...getMetricsStatus(), totals, slowest };
}

export function getMetricsTimeline(limit = 500) {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), timeline: [] };
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, ok
    FROM tool_calls
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);

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

  return { ...getMetricsStatus(), timeline };
}
