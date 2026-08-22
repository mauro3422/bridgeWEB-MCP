import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { getMssrObservabilityEpoch } from "./mssr-observability-epoch.js";
import { normalizeModelIdentifier, RUNTIME_BOOT_ID, RUNTIME_STARTED_AT } from "./runtime-identity.js";

type JsonRecord = Record<string, unknown>;
export type BridgeMetricsScope = "active" | "all";
export type MssrRoutingStatus = "traced" | "unrouted" | "bootstrap" | "exempt";

export type ToolAuditMetricRow = {
  tool: string;
  calls: number;
  okCalls: number;
  errorCalls: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  uniqueSessions: number;
  uniqueProjects: number;
  errorCategories: Array<{ name: string; count: number }>;
};

export type ToolAuditMetricSnapshot = {
  enabled: boolean;
  sqliteAvailable: boolean;
  scope: BridgeMetricsScope;
  days: number;
  since: string;
  rows: ToolAuditMetricRow[];
};

export type ToolFrictionMetricRow = {
  toolName: string;
  error: string;
  observedAt: string;
  workflowKey?: string;
  traceId?: string;
};

export type ToolFrictionMetricSnapshot = {
  enabled: boolean;
  sqliteAvailable: boolean;
  scope: BridgeMetricsScope;
  days: number;
  since: string;
  rows: ToolFrictionMetricRow[];
};
export type BridgeMetricProfile = {
  traceId?: string;
  workflowKey?: string;
  taskKey?: string;
  caller?: string;
  model?: string;
  reasoningEffort?: string;
  clientName?: string;
  sessionKey?: string;
  parentSessionKey?: string;
  project?: string;
  relatedProject?: string;
  hostAgent?: string;
  hostVariant?: string;
  messageKey?: string;
  callKey?: string;
  projectKey?: string;
  routingStatus?: MssrRoutingStatus;
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
  runtimeBootId: string;
  traceId?: string;
  workflowKey: string;
  taskKey: string;
  caller: string;
  model: string;
  reasoningEffort: string;
  clientName: string;
  sessionKey: string;
  parentSessionKey: string;
  project: string;
  relatedProject: string;
  hostAgent: string;
  hostVariant: string;
  messageKey: string;
  callKey: string;
  projectKey: string;
  routingStatus: MssrRoutingStatus;
  mssrEligible: boolean;
};

export type BridgeMetricResult = {
  resultOk?: boolean;
  resultCode?: number | null;
  resultStatus?: "success" | "failed" | "timeout";
};

export type BridgeMetricEnd = BridgeMetricStart & BridgeMetricResult & {
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

// These names are intentionally narrow: they identify lifecycle preparation and
// diagnostics, not every read-only tool. Coverage must still include substantive
// inspection such as search_files, while never treating telemetry inspection as
// a missing MSSR route.
export const MSSR_BOOTSTRAP_TOOL_NAMES = new Set([
  "project_context_load",
  "workflow_guide_recommend",
  "workflow_guide_load",
  "skill_catalog",
  "skill_recommend",
  "skill_route_audit",
  "skill_route_vocabulary",
  "skill_route_plan",
  "skill_bootstrap",
  "skill_context_next",
  "skill_load",
  "mssr_trace_record",
  "mssr_trace_working_update",
]);
export const MSSR_DIAGNOSTIC_TOOL_NAMES = new Set([
  "system_info",
  "tunnel_health",
  "bridge_health",
  "bridge_connector_catalog_compare",
  "bridge_self_check",
  "bridge_restart_status",
  "bridge_verify_status",
  "bridge_metrics_status",
  "bridge_metrics_summary",
  "bridge_metrics_recent",
  "bridge_metrics_query",
  "bridge_visualization_catalog",
  "bridge_visualize_metrics",
  "bridge_tool_schema",
  "bridge_tool_audit",
  "mssr_observatory_query",
  "mssr_trace_evidence",
  "bridge_notice_status",
  "bridge_notice_drain",
]);

function normalizedMssrToolName(tool: string): string {
  return tool.trim().toLowerCase().replace(/^(?:mssr_)+/, "");
}

export function classifyMssrRoutingStatus(tool: string, traceId?: string | null): MssrRoutingStatus {
  const raw = tool.trim().toLowerCase();
  const normalized = normalizedMssrToolName(tool);
  if (MSSR_DIAGNOSTIC_TOOL_NAMES.has(raw) || MSSR_DIAGNOSTIC_TOOL_NAMES.has(normalized)) return "exempt";
  if (MSSR_BOOTSTRAP_TOOL_NAMES.has(raw) || MSSR_BOOTSTRAP_TOOL_NAMES.has(normalized)
    || /^(?:skill_)?(?:route_plan|bootstrap|recommend)$/.test(normalized)) return "bootstrap";
  return traceId ? "traced" : "unrouted";
}

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
    ["runtime_boot_id", "TEXT"],
    ["trace_id", "TEXT"],
    ["workflow_key", "TEXT"],
    ["task_key", "TEXT"],
    ["caller", "TEXT"],
    ["model", "TEXT"],
    ["reasoning_effort", "TEXT"],
    ["client_name", "TEXT"],
    ["session_key", "TEXT"],
    ["host_parent_session_key", "TEXT"],
    ["project", "TEXT"],
    ["related_project", "TEXT"],
    ["routing_status", "TEXT"],
    ["mssr_eligible", "INTEGER"],
    ["operation_subject", "TEXT"],
    ["result_ok", "INTEGER"],
    ["result_code", "INTEGER"],
    ["result_status", "TEXT"],
    ["host_agent", "TEXT"],
    ["host_variant", "TEXT"],
    ["message_key", "TEXT"],
    ["call_key", "TEXT"],
    ["project_key", "TEXT"],
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
      runtime_boot_id TEXT,
      trace_id TEXT,
      workflow_key TEXT,
      task_key TEXT,
      caller TEXT,
      model TEXT,
      reasoning_effort TEXT,
      client_name TEXT,
      session_key TEXT,
      host_parent_session_key TEXT,
      project TEXT,
      related_project TEXT,
      routing_status TEXT,
      mssr_eligible INTEGER,
      operation_subject TEXT,
      result_ok INTEGER,
      result_code INTEGER,
      result_status TEXT,
      host_agent TEXT,
      host_variant TEXT,
      message_key TEXT,
      call_key TEXT,
      project_key TEXT
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
    CREATE INDEX IF NOT EXISTS idx_tool_calls_workflow_key ON tool_calls(workflow_key, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_runtime_boot_id ON tool_calls(runtime_boot_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_task_key ON tool_calls(task_key, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_client_name ON tool_calls(client_name, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session_key ON tool_calls(session_key, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_host_parent_session_key ON tool_calls(host_parent_session_key, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_project ON tool_calls(project, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_related_project ON tool_calls(related_project, started_at);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_routing_status ON tool_calls(routing_status, started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_call_key ON tool_calls(call_key) WHERE call_key IS NOT NULL AND call_key <> 'unknown';
    CREATE INDEX IF NOT EXISTS idx_tool_calls_host_agent ON tool_calls(host_agent, started_at);
  `);
  insertToolCall = db.prepare(`
    INSERT INTO tool_calls (
      id, started_at, ended_at, duration_ms, tool, ok, error, input_keys,
      output_chars, server_name, server_version, pid, hostname, platform, cwd,
      observability_epoch, runtime_boot_id, trace_id, workflow_key, caller, model, reasoning_effort, client_name,
      session_key, host_parent_session_key, project, routing_status, mssr_eligible, operation_subject,
      task_key, related_project, result_ok, result_code, result_status,
      host_agent, host_variant, message_key, call_key, project_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    if (tool === "skill_context_next") return record.traceId;
    if (tool === "mssr_trace_record") return record.eventType;
    if (tool === "bridge_tool_query" || tool === "bridge_tool_action") return record.toolName;
    return undefined;
  })();
  return typeof value === "string" && value.trim() ? redactText(value.trim(), 120) : undefined;
}

export function beginToolMetric(tool: string, args: unknown, profile: BridgeMetricProfile = {}): BridgeMetricStart {
  const now = Date.now();
  const epoch = getMssrObservabilityEpoch();
  const routingStatus = profile.routingStatus ?? classifyMssrRoutingStatus(tool, profile.traceId);
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
    runtimeBootId: RUNTIME_BOOT_ID,
    traceId: typeof profile.traceId === "string" ? profile.traceId.slice(0, 128) : undefined,
    workflowKey: boundedProfileText(profile.workflowKey, "unscoped", 80),
    taskKey: boundedProfileText(profile.taskKey, "unknown", 80),
    caller: boundedProfileText(profile.caller, "other", 80),
    model: normalizeModelIdentifier(profile.model),
    reasoningEffort: boundedProfileText(profile.reasoningEffort, "unknown", 20),
    clientName: boundedProfileText(profile.clientName, "unknown", 120),
    sessionKey: boundedProfileText(profile.sessionKey, "unknown", 80),
    parentSessionKey: boundedProfileText(profile.parentSessionKey, "unknown", 80),
    project: boundedProfileText(profile.project, "unknown", 120),
    relatedProject: boundedProfileText(profile.relatedProject, "none", 120),
    hostAgent: boundedProfileText(profile.hostAgent, "unknown", 160),
    hostVariant: boundedProfileText(profile.hostVariant, "unknown", 80),
    messageKey: boundedProfileText(profile.messageKey, "unknown", 80),
    callKey: boundedProfileText(profile.callKey, "unknown", 80),
    projectKey: boundedProfileText(profile.projectKey, "unknown", 80),
    routingStatus,
    mssrEligible: routingStatus === "traced" || routingStatus === "unrouted",
  };
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function extractToolResultMetric(toolName: string, rawData: unknown): BridgeMetricResult {
  const effectiveTool = toolName === "bridge_tool_query" || toolName === "bridge_tool_action"
    ? undefined
    : toolName;
  const outer = rawData && typeof rawData === "object" && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : undefined;
  const delegatedTool = typeof outer?.delegatedTool === "string" ? outer.delegatedTool : undefined;
  const payload = outer?.result && typeof outer.result === "object" && !Array.isArray(outer.result)
    ? outer.result as Record<string, unknown>
    : outer;
  const observedTool = delegatedTool ?? effectiveTool;
  if (!payload || (observedTool !== "run_command" && observedTool !== "work_once")) return {};

  const timedOut = payload.timedOut === true;
  const rawCode = payload.code;
  const resultCode = typeof rawCode === "number" && Number.isInteger(rawCode) ? rawCode : null;
  if (timedOut) return { resultOk: false, resultCode, resultStatus: "timeout" };
  if (resultCode === null) return {};
  return {
    resultOk: resultCode === 0,
    resultCode,
    resultStatus: resultCode === 0 ? "success" : "failed",
  };
}

export function finishToolMetric(
  metric: BridgeMetricStart,
  ok: boolean,
  outputChars: number,
  error?: string,
  result: BridgeMetricResult = {},
  endedAt = new Date(),
): BridgeMetricEnd {
  const durationMs = Math.max(0, endedAt.getTime() - metric.startedAtMs);
  const safeError = error ? redactText(error) : null;

  const event: BridgeMetricEnd = {
    ...metric,
    ok,
    durationMs,
    outputChars,
    error: safeError || undefined,
    ...result,
  };

  if (!metricsEnabled) return event;

  writeJsonl({
    type: "tool_call",
    ...event,
    endedAtIso: endedAt.toISOString(),
    server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid, runtimeBootId: metric.runtimeBootId },
    host: { hostname: os.hostname(), platform: os.platform(), cwd: process.cwd() },
    observability: {
      epoch: metric.observabilityEpoch,
      traceId: metric.traceId,
      workflowKey: metric.workflowKey,
      taskKey: metric.taskKey,
      caller: metric.caller,
      model: metric.model,
      reasoningEffort: metric.reasoningEffort,
      clientName: metric.clientName,
      sessionKey: metric.sessionKey,
      parentSessionKey: metric.parentSessionKey,
      project: metric.project,
      relatedProject: metric.relatedProject,
      hostAgent: metric.hostAgent,
      hostVariant: metric.hostVariant,
      messageKey: metric.messageKey,
      callKey: metric.callKey,
      projectKey: metric.projectKey,
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
      metric.runtimeBootId,
      metric.traceId ?? null,
      metric.workflowKey,
      metric.caller,
      metric.model,
      metric.reasoningEffort,
      metric.clientName,
      metric.sessionKey,
      metric.parentSessionKey,
      metric.project,
      metric.routingStatus,
      metric.mssrEligible ? 1 : 0,
      metric.operationSubject ?? null,
      metric.taskKey,
      metric.relatedProject,
      result.resultOk === undefined ? null : result.resultOk ? 1 : 0,
      result.resultCode ?? null,
      result.resultStatus ?? null,
      metric.hostAgent,
      metric.hostVariant,
      metric.messageKey,
      metric.callKey,
      metric.projectKey,
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

export function hasObservedToolCall(callKey: string): boolean {
  const database = getDb();
  if (!database) return false;
  return Boolean(database.prepare("SELECT id FROM tool_calls WHERE call_key = ? LIMIT 1").get(callKey));
}

export function resolveObservedSessionTrace(sessionKey: string): string | undefined {
  const database = getDb();
  if (!database) return undefined;
  const row = database.prepare(`
    SELECT trace_id FROM tool_calls
    WHERE session_key = ? AND trace_id IS NOT NULL AND trace_id <> ''
    ORDER BY started_at DESC LIMIT 1
  `).get(sessionKey);
  return typeof row?.trace_id === "string" ? row.trace_id : undefined;
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
    runtime: {
      bootId: RUNTIME_BOOT_ID,
      startedAt: RUNTIME_STARTED_AT,
      pid: process.pid,
    },
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

export function classifyToolAuditError(value: string | null | undefined): string {
  const error = String(value ?? "").toLowerCase();
  if (!error) return "unknown";
  const explicit = error.match(/^\[([a-z0-9-]+)\]/)?.[1];
  if (explicit && [
    "expected-integrity-mismatch", "stale-file-state", "invalid-image-payload", "source-file-unavailable",
    "safety-guard", "missing-upstream", "no-remote-configured", "target-not-found", "patch-conflict",
  ].includes(explicit)) return explicit;
  if (/invalid image payload|unsupported image signature|invalid base64|data url.*image/.test(error)) return "invalid-image-payload";
  if (/authorized source.*unavailable|source file unavailable|temporary authorized file.*missing/.test(error)) return "source-file-unavailable";
  if (/sha-?256.*mismatch|hash mismatch|integrity mismatch|head=.*tracking=.*remote=/.test(error)) return "expected-integrity-mismatch";
  if (/head changed|stale file|already exited|worktree changed|excluded paths are already staged/.test(error)) return "stale-file-state";
  if (/remote .*not configured|no remote configured|required git remote/.test(error)) return "no-remote-configured";
  if (/missing upstream|no upstream|has no upstream branch/.test(error)) return "missing-upstream";
  if (/invalid_type|unrecognized_keys|too_big|too_small|zod|required|expected .* received|number must be (less|greater) than or equal|must be a (json object|non-empty string)|invalid .* expected/.test(error)) return "schema-validation";
  if (/confirmtoolname|classified read-only|not classified read-only|destructive action|risk classification/.test(error)) return "permission-or-risk-mismatch";
  if (/process-result:timeout|timed? out|timeout|etimedout/.test(error)) return "timeout";
  if (/process-result:failed:code=/.test(error)) return "process-exit";
  if (/expected \d+ replacement|expected replacement|patch conflict|context mismatch/.test(error)) return "patch-conflict";
  if (/unknown modular tool|unknown (terminal|workspace|upload|snapshot|studio) (session|id|target)|not found|enoent|target .*missing|does not exist/.test(error)) return "target-not-found";
  if (/econnrefused|provider unavailable|connection closed|disconnected|tools\/list returned zero|no last-known tool cache/.test(error)) return "provider-unavailable";
  if (/refusing|not allowed|outside allowed|denied path|escaped|requires exact|truncated snapshot rollback/.test(error)) return "safety-guard";
  if (/internal|sqlite|assertion|unexpected/.test(error)) return "runtime-internal";
  return "unknown";
}

export function getToolAuditMetrics(days = 30, scope: BridgeMetricsScope = "active"): ToolAuditMetricSnapshot {
  const boundedDays = Math.max(1, Math.min(365, Math.trunc(days)));
  const epoch = getMssrObservabilityEpoch();
  const windowSince = new Date(Date.now() - boundedDays * 86_400_000).toISOString();
  const since = scope === "active" && epoch.baselineAt > windowSince ? epoch.baselineAt : windowSince;
  const database = getDb();
  if (!database) {
    return { enabled: metricsEnabled, sqliteAvailable: false, scope, days: boundedDays, since, rows: [] };
  }

  const filter = metricsFilter(scope);
  const rows = database.prepare(`
    WITH projected_calls AS (
      SELECT tool AS audited_tool, started_at, duration_ms, COALESCE(result_ok, ok) AS effective_ok, session_key, project
      FROM tool_calls
      WHERE ${filter.where} AND started_at >= ?
      UNION ALL
      SELECT operation_subject AS audited_tool, started_at, duration_ms, COALESCE(result_ok, ok) AS effective_ok, session_key, project
      FROM tool_calls
      WHERE ${filter.where} AND started_at >= ?
        AND tool IN ('bridge_tool_query', 'bridge_tool_action')
        AND operation_subject IS NOT NULL AND operation_subject <> ''
    )
    SELECT audited_tool AS tool,
      COUNT(*) AS calls,
      SUM(CASE WHEN effective_ok = 1 THEN 1 ELSE 0 END) AS ok_calls,
      SUM(CASE WHEN effective_ok = 0 THEN 1 ELSE 0 END) AS error_calls,
      ROUND(AVG(duration_ms), 2) AS avg_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      MAX(started_at) AS last_started_at,
      MAX(CASE WHEN effective_ok = 1 THEN started_at END) AS last_success_at,
      MAX(CASE WHEN effective_ok = 0 THEN started_at END) AS last_error_at,
      COUNT(DISTINCT CASE WHEN session_key IS NOT NULL AND session_key <> 'unknown' THEN session_key END) AS unique_sessions,
      COUNT(DISTINCT CASE WHEN project IS NOT NULL AND project <> 'unknown' THEN project END) AS unique_projects
    FROM projected_calls
    GROUP BY audited_tool
    ORDER BY calls DESC, audited_tool ASC
  `).all(...filter.params, since, ...filter.params, since);

  const errors = database.prepare(`
    SELECT tool, COALESCE(error, 'process-result:' || COALESCE(result_status, 'failed') || ':code=' || COALESCE(CAST(result_code AS TEXT), 'null')) AS error
    FROM tool_calls
    WHERE COALESCE(result_ok, ok) = 0 AND ${filter.where} AND started_at >= ?
    UNION ALL
    SELECT operation_subject AS tool, COALESCE(error, 'process-result:' || COALESCE(result_status, 'failed') || ':code=' || COALESCE(CAST(result_code AS TEXT), 'null')) AS error
    FROM tool_calls
    WHERE COALESCE(result_ok, ok) = 0 AND ${filter.where} AND started_at >= ?
      AND tool IN ('bridge_tool_query', 'bridge_tool_action')
      AND operation_subject IS NOT NULL AND operation_subject <> ''
  `).all(...filter.params, since, ...filter.params, since);
  const categoriesByTool = new Map<string, Map<string, number>>();
  for (const row of errors) {
    const tool = typeof row.tool === "string" ? row.tool : "unknown";
    const category = classifyToolAuditError(typeof row.error === "string" ? row.error : null);
    const categories = categoriesByTool.get(tool) ?? new Map<string, number>();
    categories.set(category, (categories.get(category) ?? 0) + 1);
    categoriesByTool.set(tool, categories);
  }

  const mapped: ToolAuditMetricRow[] = rows.map((row) => {
    const tool = typeof row.tool === "string" ? row.tool : "unknown";
    const categories = [...(categoriesByTool.get(tool)?.entries() ?? [])]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      tool,
      calls: Number(row.calls ?? 0),
      okCalls: Number(row.ok_calls ?? 0),
      errorCalls: Number(row.error_calls ?? 0),
      avgDurationMs: row.avg_duration_ms === null || row.avg_duration_ms === undefined ? null : Number(row.avg_duration_ms),
      maxDurationMs: row.max_duration_ms === null || row.max_duration_ms === undefined ? null : Number(row.max_duration_ms),
      lastStartedAt: typeof row.last_started_at === "string" ? row.last_started_at : null,
      lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
      lastErrorAt: typeof row.last_error_at === "string" ? row.last_error_at : null,
      uniqueSessions: Number(row.unique_sessions ?? 0),
      uniqueProjects: Number(row.unique_projects ?? 0),
      errorCategories: categories,
    };
  });

  return { enabled: metricsEnabled, sqliteAvailable: true, scope, days: boundedDays, since, rows: mapped };
}

export function getToolFrictionMetrics(
  days = 30,
  scope: BridgeMetricsScope = "active",
  maxRows = 5000,
): ToolFrictionMetricSnapshot {
  const boundedDays = Math.max(1, Math.min(365, Math.trunc(days)));
  const boundedRows = Math.max(1, Math.min(10_000, Math.trunc(maxRows)));
  const epoch = getMssrObservabilityEpoch();
  const windowSince = new Date(Date.now() - boundedDays * 86_400_000).toISOString();
  const since = scope === "active" && epoch.baselineAt > windowSince ? epoch.baselineAt : windowSince;
  const database = getDb();
  if (!database) {
    return { enabled: metricsEnabled, sqliteAvailable: false, scope, days: boundedDays, since, rows: [] };
  }

  const filter = metricsFilter(scope);
  const rows = database.prepare(`
    WITH projected_failures AS (
      SELECT tool AS tool_name, started_at AS observed_at,
        COALESCE(error, 'process-result:' || COALESCE(result_status, 'failed') || ':code=' || COALESCE(CAST(result_code AS TEXT), 'null')) AS failure_error,
        workflow_key, trace_id
      FROM tool_calls
      WHERE COALESCE(result_ok, ok) = 0 AND ${filter.where} AND started_at >= ?
      UNION ALL
      SELECT operation_subject AS tool_name, started_at AS observed_at,
        COALESCE(error, 'process-result:' || COALESCE(result_status, 'failed') || ':code=' || COALESCE(CAST(result_code AS TEXT), 'null')) AS failure_error,
        workflow_key, trace_id
      FROM tool_calls
      WHERE COALESCE(result_ok, ok) = 0 AND ${filter.where} AND started_at >= ?
        AND tool IN ('bridge_tool_query', 'bridge_tool_action')
        AND operation_subject IS NOT NULL AND operation_subject <> ''
    )
    SELECT tool_name, observed_at, failure_error, workflow_key, trace_id
    FROM projected_failures
    ORDER BY observed_at DESC
    LIMIT ?
  `).all(...filter.params, since, ...filter.params, since, boundedRows);

  const mapped: ToolFrictionMetricRow[] = rows.flatMap((row) => {
    const toolName = typeof row.tool_name === "string" ? row.tool_name.trim() : "";
    const error = typeof row.failure_error === "string" ? row.failure_error : "";
    const observedAt = typeof row.observed_at === "string" ? row.observed_at : "";
    if (!toolName || !error || !observedAt) return [];
    return [{
      toolName,
      error,
      observedAt,
      ...(typeof row.workflow_key === "string" && row.workflow_key ? { workflowKey: row.workflow_key } : {}),
      ...(typeof row.trace_id === "string" && row.trace_id ? { traceId: row.trace_id } : {}),
    }];
  });

  return { enabled: metricsEnabled, sqliteAvailable: true, scope, days: boundedDays, since, rows: mapped };
}

type RoutingCoverage = {
  exempt_calls: number;
  bootstrap_calls: number;
  substantive_chains: number;
  routed_chains: number;
  unrouted_chains: number;
  chains_without_route_hook: number;
  mssr_routed_chain_coverage: number | null;
};

function metricProfileKey(row: JsonRecord, detailed: boolean): string {
  const text = (name: string, fallback = "unknown") => typeof row[name] === "string" && row[name]
    ? String(row[name])
    : fallback;
  if (!detailed) return text("caller", "other");
  return [
    text("caller", "other"), text("model"), text("reasoning_effort"), text("host_agent"), text("host_variant"),
    text("project"), text("session_key"), text("task_key"),
  ].join("\u0000");
}

function routingCoverage(rows: JsonRecord[], detailed: boolean): Map<string, RoutingCoverage> {
  const coverage = new Map<string, RoutingCoverage>();
  const chains = new Map<string, Map<string, { hasSubstantiveCall: boolean; hasRouteHook: boolean }>>();
  for (const row of rows) {
    const profileKey = metricProfileKey(row, detailed);
    const current = coverage.get(profileKey) ?? {
      exempt_calls: 0,
      bootstrap_calls: 0,
      substantive_chains: 0,
      routed_chains: 0,
      unrouted_chains: 0,
      chains_without_route_hook: 0,
      mssr_routed_chain_coverage: null,
    };
    const status = typeof row.routing_status === "string"
      ? row.routing_status
      : typeof row.trace_id === "string" && row.trace_id ? "traced" : "unrouted";
    if (status === "exempt") current.exempt_calls += 1;
    if (status === "bootstrap") current.bootstrap_calls += 1;
    coverage.set(profileKey, current);
    if (Number(row.mssr_eligible) !== 1) continue;

    const traceId = typeof row.trace_id === "string" && row.trace_id ? row.trace_id : undefined;
    const chainScope = traceId
      ? `trace:${traceId}`
      : ["unrouted", row.caller ?? "other", row.session_key ?? "unknown", row.task_key ?? "unknown", row.project ?? "unknown", row.workflow_key ?? "unscoped"].join("\u0000");
    const profileChains = chains.get(profileKey) ?? new Map();
    const chain = profileChains.get(chainScope) ?? { hasSubstantiveCall: false, hasRouteHook: false };
    chain.hasSubstantiveCall = true;
    profileChains.set(chainScope, chain);
    chains.set(profileKey, profileChains);
  }
  // Route/bootstrap/hook calls are excluded from the substantive denominator,
  // so inspect them in a second pass and attach their evidence to the same
  // trace or bounded anonymous scope.
  for (const row of rows) {
    const profileKey = metricProfileKey(row, detailed);
    const status = typeof row.routing_status === "string" ? row.routing_status : "";
    if (status !== "bootstrap") continue;
    const traceId = typeof row.trace_id === "string" && row.trace_id ? row.trace_id : undefined;
    const chainScope = traceId
      ? `trace:${traceId}`
      : ["unrouted", row.caller ?? "other", row.session_key ?? "unknown", row.task_key ?? "unknown", row.project ?? "unknown", row.workflow_key ?? "unscoped"].join("\u0000");
    const chain = chains.get(profileKey)?.get(chainScope);
    if (chain) chain.hasRouteHook = true;
  }
  for (const [profileKey, profileChains] of chains) {
    const current = coverage.get(profileKey);
    if (!current) continue;
    for (const chain of profileChains.values()) {
      if (!chain.hasSubstantiveCall) continue;
      current.substantive_chains += 1;
      if (chain.hasRouteHook) current.routed_chains += 1;
      else {
        current.unrouted_chains += 1;
        current.chains_without_route_hook += 1;
      }
    }
    current.mssr_routed_chain_coverage = current.substantive_chains > 0
      ? Math.round((100 * current.routed_chains / current.substantive_chains) * 100) / 100
      : null;
  }
  return coverage;
}

function withRoutingCoverage(rows: JsonRecord[], coverage: Map<string, RoutingCoverage>, detailed: boolean): JsonRecord[] {
  return rows.map((row) => ({
    ...row,
    ...(coverage.get(metricProfileKey(row, detailed)) ?? {
      exempt_calls: 0,
      bootstrap_calls: 0,
      substantive_chains: 0,
      routed_chains: 0,
      unrouted_chains: 0,
      chains_without_route_hook: 0,
      mssr_routed_chain_coverage: null,
    }),
  }));
}

function getMetricsProfiles(database: DatabaseSync, scope: BridgeMetricsScope, agentProfileLimit = 50) {
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
      COALESCE(host_agent, 'unknown') AS host_agent,
      COALESCE(host_variant, 'unknown') AS host_variant,
      COALESCE(project, 'unknown') AS project,
      COALESCE(
        GROUP_CONCAT(DISTINCT CASE
          WHEN related_project IS NOT NULL AND related_project <> 'none' THEN related_project
        END),
        'none'
      ) AS related_project,
      COALESCE(session_key, 'unknown') AS session_key,
      COALESCE(task_key, 'unknown') AS task_key,
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
      COALESCE(host_agent, 'unknown'), COALESCE(host_variant, 'unknown'),
      COALESCE(project, 'unknown'),
      COALESCE(session_key, 'unknown'), COALESCE(task_key, 'unknown')
    ORDER BY calls DESC, caller ASC, model ASC, reasoning_effort ASC, project ASC, session_key ASC, task_key ASC
    LIMIT ?
  `).all(...filter.params, Math.max(1, Math.min(200, agentProfileLimit)));
  const routingRows = database.prepare(`
    SELECT caller, model, reasoning_effort, host_agent, host_variant, project, session_key, task_key, workflow_key,
      trace_id, routing_status, mssr_eligible
    FROM tool_calls
    WHERE ${filter.where}
  `).all(...filter.params);
  return {
    surfaces: withRoutingCoverage(surfaces, routingCoverage(routingRows, false), false),
    agentProfiles: withRoutingCoverage(agentProfiles, routingCoverage(routingRows, true), true),
  };
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
  return { ...getMetricsStatus(), scope, summary: rows, ...getMetricsProfiles(sqlite, scope, limit) };
}

export function getRecentMetrics(limit = 25, scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), scope, recent: [] };
  const filter = metricsFilter(scope);
  const rows = sqlite.prepare(`
    SELECT started_at, duration_ms, tool, ok, error, input_keys, operation_subject, output_chars, pid,
      result_ok, result_code, result_status,
      runtime_boot_id, trace_id, workflow_key, task_key, caller, model, reasoning_effort, client_name, session_key, project, related_project,
      host_parent_session_key, host_agent, host_variant, message_key, call_key, project_key,
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
      runtime_boot_id, trace_id, workflow_key, task_key, caller, model, reasoning_effort, client_name, session_key, project, related_project,
      host_parent_session_key, host_agent, host_variant, message_key, call_key, project_key,
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

  return { ...getMetricsStatus(), scope, totals, slowest, ...getMetricsProfiles(sqlite, scope, 20) };
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

export function getTraceToolEvidence(traceId: string, limit = 500) {
  const normalizedTraceId = traceId.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalizedTraceId)) {
    throw new Error("traceId must contain only letters, numbers, dot, underscore, colon, or hyphen.");
  }
  const boundedLimit = Math.max(1, Math.min(2_000, Math.trunc(limit)));
  const sqlite = getDb();
  if (!sqlite) {
    return {
      ...getMetricsStatus(),
      traceId: normalizedTraceId,
      truncated: false,
      calls: [],
      summary: { calls: 0, okCalls: 0, errorCalls: 0, firstStartedAt: null, lastStartedAt: null },
      toolCounts: [],
      runtimeGenerations: [],
      workflowKeys: [],
      taskKeys: [],
      sessionKeys: [],
      projects: [],
    };
  }
  const calls = sqlite.prepare(`
    SELECT started_at, ended_at, duration_ms, tool, ok, error, operation_subject,
      server_version, pid, runtime_boot_id, trace_id, workflow_key, task_key,
      caller, client_name, session_key, project, related_project, routing_status
      , host_parent_session_key
    FROM tool_calls
    WHERE trace_id = ?
    ORDER BY started_at ASC
    LIMIT ?
  `).all(normalizedTraceId, boundedLimit);
  const distinct = (field: string) => [...new Set(calls.flatMap((row) => {
    const value = row[field];
    return typeof value === "string" && value && value !== "unknown" && value !== "none" && value !== "unscoped" ? [value] : [];
  }))].sort();
  const toolCountMap = new Map<string, { calls: number; okCalls: number; errorCalls: number }>();
  const runtimeMap = new Map<string, { runtimeBootId: string; pid: number | null; serverVersion: string; firstSeenAt: string; lastSeenAt: string; calls: number }>();
  let okCalls = 0;
  let errorCalls = 0;
  for (const row of calls) {
    const tool = typeof row.tool === "string" ? row.tool : "unknown";
    const current = toolCountMap.get(tool) ?? { calls: 0, okCalls: 0, errorCalls: 0 };
    current.calls += 1;
    if (Number(row.ok) === 1) {
      current.okCalls += 1;
      okCalls += 1;
    } else {
      current.errorCalls += 1;
      errorCalls += 1;
    }
    toolCountMap.set(tool, current);

    const runtimeBootId = typeof row.runtime_boot_id === "string" && row.runtime_boot_id
      ? row.runtime_boot_id
      : `legacy-pid-${String(row.pid ?? "unknown")}`;
    const startedAt = typeof row.started_at === "string" ? row.started_at : "";
    const runtime = runtimeMap.get(runtimeBootId) ?? {
      runtimeBootId,
      pid: typeof row.pid === "number" ? row.pid : row.pid === null || row.pid === undefined ? null : Number(row.pid),
      serverVersion: typeof row.server_version === "string" ? row.server_version : "unknown",
      firstSeenAt: startedAt,
      lastSeenAt: startedAt,
      calls: 0,
    };
    runtime.calls += 1;
    if (startedAt && (!runtime.firstSeenAt || startedAt < runtime.firstSeenAt)) runtime.firstSeenAt = startedAt;
    if (startedAt && startedAt > runtime.lastSeenAt) runtime.lastSeenAt = startedAt;
    runtimeMap.set(runtimeBootId, runtime);
  }
  return {
    ...getMetricsStatus(),
    traceId: normalizedTraceId,
    truncated: calls.length >= boundedLimit,
    summary: {
      calls: calls.length,
      okCalls,
      errorCalls,
      firstStartedAt: typeof calls[0]?.started_at === "string" ? calls[0].started_at : null,
      lastStartedAt: typeof calls.at(-1)?.started_at === "string" ? calls.at(-1)?.started_at : null,
    },
    toolCounts: [...toolCountMap.entries()]
      .map(([tool, value]) => ({ tool, ...value }))
      .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)),
    runtimeGenerations: [...runtimeMap.values()].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt)),
    workflowKeys: distinct("workflow_key"),
    taskKeys: distinct("task_key"),
    sessionKeys: distinct("session_key"),
    parentSessionKeys: distinct("host_parent_session_key"),
    projects: distinct("project"),
    calls,
    privacy: {
      rawArgumentsStored: false,
      rawPromptsStored: false,
      transcriptsStored: false,
      gitOutputsStored: false,
    },
  };
}


export function closeMetricsForTests(): void {
  if (db) db.close();
  db = undefined;
  insertToolCall = null;
}
