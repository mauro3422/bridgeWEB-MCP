import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { getMssrObservabilityEpoch } from "./mssr-observability-epoch.js";
import { closeMetricsWalMaintenanceForTests, getMetricsWalMaintenanceStatus } from "./metrics-wal-maintenance.js";
import {
  closeObservabilityPersistenceForTests,
  enqueueObservabilityPersistence,
  getObservabilityPersistenceStatus,
  onObservabilityPersistenceAck,
} from "./observability-persistence.js";
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
const recentToolMetricOverlay: BridgeMetricEnd[] = [];
const RECENT_TOOL_METRIC_OVERLAY_LIMIT = 2_000;

function rememberRecentToolMetric(event: BridgeMetricEnd): void {
  recentToolMetricOverlay.push(event);
  if (recentToolMetricOverlay.length > RECENT_TOOL_METRIC_OVERLAY_LIMIT) {
    recentToolMetricOverlay.splice(0, recentToolMetricOverlay.length - RECENT_TOOL_METRIC_OVERLAY_LIMIT);
  }
}

onObservabilityPersistenceAck((timing) => {
  if (timing.kind !== "metric" || !timing.ok) return;
  const index = recentToolMetricOverlay.findIndex((event) => event.id === timing.id);
  if (index >= 0) recentToolMetricOverlay.splice(index, 1);
});

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
    PRAGMA busy_timeout = 100;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA wal_autocheckpoint = 0;
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
  rememberRecentToolMetric(event);

  // Initialize the read-side schema once. Durable JSONL/SQLite writes are
  // delegated to the shared single-writer worker so transport liveness never
  // waits on disk or a SQLite writer lock.
  const database = getDb();
  if (!database || !insertToolCall) return event;
  const endedAtIso = endedAt.toISOString();
  enqueueObservabilityPersistence({
    kind: "metric",
    id: metric.id,
    eventType: metric.tool,
    sqlitePath,
    jsonlPath,
    jsonLine: JSON.stringify({
      type: "tool_call",
      ...event,
      endedAtIso,
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
    }),
    values: [
      metric.id,
      metric.startedAtIso,
      endedAtIso,
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
    ],
  });
  return event;
}

export function hasObservedToolCall(callKey: string): boolean {
  if (recentToolMetricOverlay.some((event) => event.callKey === callKey)) return true;
  const database = getDb();
  if (!database) return false;
  return Boolean(database.prepare("SELECT id FROM tool_calls WHERE call_key = ? LIMIT 1").get(callKey));
}

export function resolveObservedSessionTrace(sessionKey: string): string | undefined {
  const recent = [...recentToolMetricOverlay].reverse().find((event) => event.sessionKey === sessionKey && event.traceId);
  if (recent?.traceId) return recent.traceId;
  const database = getDb();
  if (!database) return undefined;
  const row = database.prepare(`
    SELECT trace_id FROM tool_calls
    WHERE session_key = ? AND trace_id IS NOT NULL AND trace_id <> ''
    ORDER BY started_at DESC LIMIT 1
  `).get(sessionKey);
  return typeof row?.trace_id === "string" ? row.trace_id : undefined;
}

export function resolveObservedTraceContext(traceId: string): {
  sessionKey?: string;
  project?: string;
  workflowKey?: string;
} {
  const recent = [...recentToolMetricOverlay].reverse().find((event) => event.traceId === traceId);
  if (recent) {
    return {
      sessionKey: recent.sessionKey !== "unknown" ? recent.sessionKey : undefined,
      project: recent.project !== "unknown" ? recent.project : undefined,
      workflowKey: recent.workflowKey !== "unscoped" && recent.workflowKey !== "unknown" ? recent.workflowKey : undefined,
    };
  }
  const database = getDb();
  if (!database) return {};
  const row = database.prepare(`
    SELECT session_key, project, workflow_key
    FROM tool_calls
    WHERE trace_id = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(traceId);
  return {
    sessionKey: typeof row?.session_key === "string" && row.session_key !== "unknown" ? row.session_key : undefined,
    project: typeof row?.project === "string" && row.project !== "unknown" ? row.project : undefined,
    workflowKey: typeof row?.workflow_key === "string" && row.workflow_key !== "unscoped" && row.workflow_key !== "unknown" ? row.workflow_key : undefined,
  };
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
    persistence: {
      ...getObservabilityPersistenceStatus(),
      recent: getObservabilityPersistenceStatus().recent.filter((item) => item.kind === "metric").slice(-12),
      recentOverlayCalls: recentToolMetricOverlay.length,
    },
    walMaintenance: getMetricsWalMaintenanceStatus(),
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
      SUM(duration_ms) AS total_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      MAX(started_at) AS last_started_at,
      MAX(CASE WHEN effective_ok = 1 THEN started_at END) AS last_success_at,
      MAX(CASE WHEN effective_ok = 0 THEN started_at END) AS last_error_at,
      COUNT(DISTINCT CASE WHEN session_key IS NOT NULL AND session_key <> 'unknown' THEN session_key END) AS unique_sessions,
      COUNT(DISTINCT CASE WHEN project IS NOT NULL AND project <> 'unknown' THEN project END) AS unique_projects,
      GROUP_CONCAT(DISTINCT CASE WHEN session_key IS NOT NULL AND session_key <> 'unknown' THEN session_key END) AS session_keys,
      GROUP_CONCAT(DISTINCT CASE WHEN project IS NOT NULL AND project <> 'unknown' THEN project END) AS project_keys
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
  const rememberErrorCategory = (tool: string, error: string | null) => {
    const category = classifyToolAuditError(error);
    const categories = categoriesByTool.get(tool) ?? new Map<string, number>();
    categories.set(category, (categories.get(category) ?? 0) + 1);
    categoriesByTool.set(tool, categories);
  };
  for (const row of errors) {
    rememberErrorCategory(typeof row.tool === "string" ? row.tool : "unknown", typeof row.error === "string" ? row.error : null);
  }

  type AuditAccumulator = {
    tool: string;
    calls: number;
    okCalls: number;
    errorCalls: number;
    totalDurationMs: number;
    maxDurationMs: number | null;
    lastStartedAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    sessions: Set<string>;
    projects: Set<string>;
  };
  const accumulated = new Map<string, AuditAccumulator>();
  for (const row of rows) {
    const tool = typeof row.tool === "string" ? row.tool : "unknown";
    const calls = Number(row.calls ?? 0);
    accumulated.set(tool, {
      tool,
      calls,
      okCalls: Number(row.ok_calls ?? 0),
      errorCalls: Number(row.error_calls ?? 0),
      totalDurationMs: Number(row.total_duration_ms ?? 0),
      maxDurationMs: row.max_duration_ms === null || row.max_duration_ms === undefined ? null : Number(row.max_duration_ms),
      lastStartedAt: typeof row.last_started_at === "string" ? row.last_started_at : null,
      lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
      lastErrorAt: typeof row.last_error_at === "string" ? row.last_error_at : null,
      sessions: new Set(typeof row.session_keys === "string" ? row.session_keys.split(",").filter(Boolean) : []),
      projects: new Set(typeof row.project_keys === "string" ? row.project_keys.split(",").filter(Boolean) : []),
    });
  }
  const addPending = (tool: string, event: BridgeMetricEnd) => {
    if (!tool) return;
    const effectiveOk = event.resultOk ?? event.ok;
    const current = accumulated.get(tool) ?? {
      tool,
      calls: 0,
      okCalls: 0,
      errorCalls: 0,
      totalDurationMs: 0,
      maxDurationMs: null,
      lastStartedAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      sessions: new Set<string>(),
      projects: new Set<string>(),
    };
    current.calls += 1;
    if (effectiveOk) current.okCalls += 1;
    else current.errorCalls += 1;
    current.totalDurationMs += event.durationMs;
    current.maxDurationMs = current.maxDurationMs === null ? event.durationMs : Math.max(current.maxDurationMs, event.durationMs);
    if (!current.lastStartedAt || event.startedAtIso > current.lastStartedAt) current.lastStartedAt = event.startedAtIso;
    if (effectiveOk && (!current.lastSuccessAt || event.startedAtIso > current.lastSuccessAt)) current.lastSuccessAt = event.startedAtIso;
    if (!effectiveOk && (!current.lastErrorAt || event.startedAtIso > current.lastErrorAt)) current.lastErrorAt = event.startedAtIso;
    if (event.sessionKey && event.sessionKey !== "unknown") current.sessions.add(event.sessionKey);
    if (event.project && event.project !== "unknown") current.projects.add(event.project);
    accumulated.set(tool, current);
    if (!effectiveOk) {
      const fallback = event.resultOk === false
        ? `process-result:${event.resultStatus ?? "failed"}:code=${event.resultCode ?? "null"}`
        : null;
      rememberErrorCategory(tool, event.error ?? fallback);
    }
  };
  for (const event of pendingMetricEvents(scope)) {
    if (event.startedAtIso < since) continue;
    addPending(event.tool, event);
    if ((event.tool === "bridge_tool_query" || event.tool === "bridge_tool_action") && event.operationSubject) {
      addPending(event.operationSubject, event);
    }
  }

  const mapped: ToolAuditMetricRow[] = [...accumulated.values()]
    .map((value) => ({
      tool: value.tool,
      calls: value.calls,
      okCalls: value.okCalls,
      errorCalls: value.errorCalls,
      avgDurationMs: value.calls > 0 ? Math.round((value.totalDurationMs / value.calls) * 100) / 100 : null,
      maxDurationMs: value.maxDurationMs,
      lastStartedAt: value.lastStartedAt,
      lastSuccessAt: value.lastSuccessAt,
      lastErrorAt: value.lastErrorAt,
      uniqueSessions: value.sessions.size,
      uniqueProjects: value.projects.size,
      errorCategories: [...(categoriesByTool.get(value.tool)?.entries() ?? [])]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

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
function metricProfileIdentityFromEvent(event: BridgeMetricEnd, detailed: boolean): JsonRecord {
  return detailed ? {
    caller: event.caller || "other",
    model: event.model || "unknown",
    reasoning_effort: event.reasoningEffort || "unknown",
    host_agent: event.hostAgent || "unknown",
    host_variant: event.hostVariant || "unknown",
    project: event.project || "unknown",
    related_project: event.relatedProject || "none",
    session_key: event.sessionKey || "unknown",
    task_key: event.taskKey || "unknown",
  } : { caller: event.caller || "other" };
}

function emptyRoutingCoverage(): RoutingCoverage {
  return {
    exempt_calls: 0,
    bootstrap_calls: 0,
    substantive_chains: 0,
    routed_chains: 0,
    unrouted_chains: 0,
    chains_without_route_hook: 0,
    mssr_routed_chain_coverage: null,
  };
}

function metricRoutingChainKey(event: BridgeMetricEnd): string {
  if (event.traceId) return `trace:${event.traceId}`;
  return [
    "unrouted",
    event.caller || "other",
    event.sessionKey || "unknown",
    event.taskKey || "unknown",
    event.project || "unknown",
    event.workflowKey || "unscoped",
  ].join("\u0000");
}


function routingCoverageFromDatabase(database: DatabaseSync, scope: BridgeMetricsScope, detailed: boolean): Map<string, RoutingCoverage> {
  const filter = metricsFilter(scope);
  const profileColumns = detailed
    ? ["caller", "model", "reasoning_effort", "host_agent", "host_variant", "project", "session_key", "task_key"]
    : ["caller"];
  const profileSql = profileColumns.join(", ");
  const prefixedProfileSql = (prefix: string) => profileColumns.map((column) => `${prefix}.${column}`).join(", ");
  const profileJoinSql = profileColumns.map((column) => `h.${column} = s.${column}`).join(" AND ");
  const baseSql = `
    SELECT
      COALESCE(caller, 'other') AS caller,
      COALESCE(model, 'unknown') AS model,
      COALESCE(reasoning_effort, 'unknown') AS reasoning_effort,
      COALESCE(host_agent, 'unknown') AS host_agent,
      COALESCE(host_variant, 'unknown') AS host_variant,
      COALESCE(project, 'unknown') AS project,
      COALESCE(session_key, 'unknown') AS session_key,
      COALESCE(task_key, 'unknown') AS task_key,
      COALESCE(workflow_key, 'unscoped') AS workflow_key,
      trace_id,
      COALESCE(routing_status, CASE WHEN trace_id IS NOT NULL AND trace_id <> '' THEN 'traced' ELSE 'unrouted' END) AS routing_status,
      COALESCE(mssr_eligible, 0) AS mssr_eligible,
      CASE
        WHEN trace_id IS NOT NULL AND trace_id <> '' THEN 'trace:' || trace_id
        ELSE 'unrouted' || char(0) || COALESCE(caller, 'other') || char(0) || COALESCE(session_key, 'unknown') || char(0)
          || COALESCE(task_key, 'unknown') || char(0) || COALESCE(project, 'unknown') || char(0) || COALESCE(workflow_key, 'unscoped')
      END AS chain_key
    FROM tool_calls
    WHERE ${filter.where}
  `;

  const coverage = new Map<string, RoutingCoverage>();
  const countRows = database.prepare(`
    WITH base AS (${baseSql})
    SELECT ${profileSql},
      SUM(CASE WHEN routing_status = 'exempt' THEN 1 ELSE 0 END) AS exempt_calls,
      SUM(CASE WHEN routing_status = 'bootstrap' THEN 1 ELSE 0 END) AS bootstrap_calls
    FROM base
    GROUP BY ${profileSql}
  `).all(...filter.params);
  for (const row of countRows) {
    coverage.set(metricProfileKey(row, detailed), {
      exempt_calls: Number(row.exempt_calls ?? 0),
      bootstrap_calls: Number(row.bootstrap_calls ?? 0),
      substantive_chains: 0,
      routed_chains: 0,
      unrouted_chains: 0,
      chains_without_route_hook: 0,
      mssr_routed_chain_coverage: null,
    });
  }

  const chainRows = database.prepare(`
    WITH base AS (${baseSql}),
    substantive AS (
      SELECT ${profileSql}, chain_key
      FROM base
      WHERE mssr_eligible = 1
      GROUP BY ${profileSql}, chain_key
    ),
    hooks AS (
      SELECT ${profileSql}, chain_key
      FROM base
      WHERE routing_status = 'bootstrap'
      GROUP BY ${profileSql}, chain_key
    )
    SELECT ${prefixedProfileSql("s")},
      COUNT(*) AS substantive_chains,
      SUM(CASE WHEN h.chain_key IS NOT NULL THEN 1 ELSE 0 END) AS routed_chains
    FROM substantive s
    LEFT JOIN hooks h ON h.chain_key = s.chain_key AND ${profileJoinSql}
    GROUP BY ${prefixedProfileSql("s")}
  `).all(...filter.params);
  for (const row of chainRows) {
    const key = metricProfileKey(row, detailed);
    const current = coverage.get(key) ?? {
      exempt_calls: 0,
      bootstrap_calls: 0,
      substantive_chains: 0,
      routed_chains: 0,
      unrouted_chains: 0,
      chains_without_route_hook: 0,
      mssr_routed_chain_coverage: null,
    };
    current.substantive_chains = Number(row.substantive_chains ?? 0);
    current.routed_chains = Number(row.routed_chains ?? 0);
    current.unrouted_chains = Math.max(0, current.substantive_chains - current.routed_chains);
    current.chains_without_route_hook = current.unrouted_chains;
    current.mssr_routed_chain_coverage = current.substantive_chains > 0
      ? Math.round((100 * current.routed_chains / current.substantive_chains) * 100) / 100
      : null;
    coverage.set(key, current);
  }
  return coverage;
}
function routingCoverageWithPending(
  database: DatabaseSync,
  scope: BridgeMetricsScope,
  detailed: boolean,
  pendingSnapshot: BridgeMetricEnd[],
): Map<string, RoutingCoverage> {
  const coverage = routingCoverageFromDatabase(database, scope, detailed);
  const pending = pendingUnpersistedMetricEvents(database, scope, pendingSnapshot);
  if (pending.length === 0) return coverage;

  const filter = metricsFilter(scope);
  const traceDetailedSql = detailed ? `
      AND COALESCE(model, 'unknown') = ?
      AND COALESCE(reasoning_effort, 'unknown') = ?
      AND COALESCE(host_agent, 'unknown') = ?
      AND COALESCE(host_variant, 'unknown') = ?
      AND COALESCE(project, 'unknown') = ?
      AND COALESCE(session_key, 'unknown') = ?
      AND COALESCE(task_key, 'unknown') = ?` : "";
  const untracedDetailedSql = detailed ? `
      AND COALESCE(model, 'unknown') = ?
      AND COALESCE(reasoning_effort, 'unknown') = ?
      AND COALESCE(host_agent, 'unknown') = ?
      AND COALESCE(host_variant, 'unknown') = ?` : "";
  const stateProjectionSql = `
      MAX(CASE WHEN COALESCE(mssr_eligible, 0) = 1 THEN 1 ELSE 0 END) AS substantive,
      MAX(CASE WHEN COALESCE(
        routing_status,
        CASE WHEN trace_id IS NOT NULL AND trace_id <> '' THEN 'traced' ELSE 'unrouted' END
      ) = 'bootstrap' THEN 1 ELSE 0 END) AS hook`;
  const traceState = database.prepare(`
    SELECT ${stateProjectionSql}
    FROM tool_calls
    WHERE ${filter.where}
      AND trace_id = ?
      AND COALESCE(caller, 'other') = ?${traceDetailedSql}
  `);
  const untracedState = database.prepare(`
    SELECT ${stateProjectionSql}
    FROM tool_calls
    WHERE ${filter.where}
      AND (trace_id IS NULL OR trace_id = '')
      AND COALESCE(caller, 'other') = ?
      AND COALESCE(session_key, 'unknown') = ?
      AND COALESCE(task_key, 'unknown') = ?
      AND COALESCE(project, 'unknown') = ?
      AND COALESCE(workflow_key, 'unscoped') = ?${untracedDetailedSql}
  `);

  type PendingChainState = {
    event: BridgeMetricEnd;
    profileKey: string;
    substantive: boolean;
    hook: boolean;
  };
  const pendingChains = new Map<string, PendingChainState>();

  for (const event of pending) {
    const identity = metricProfileIdentityFromEvent(event, detailed);
    const profileKey = metricProfileKey(identity, detailed);
    const current = coverage.get(profileKey) ?? emptyRoutingCoverage();
    if (event.routingStatus === "exempt") current.exempt_calls += 1;
    if (event.routingStatus === "bootstrap") current.bootstrap_calls += 1;
    coverage.set(profileKey, current);

    if (!event.mssrEligible && event.routingStatus !== "bootstrap") continue;
    const chainKey = metricRoutingChainKey(event);
    const stateKey = JSON.stringify([profileKey, chainKey]);
    const chain = pendingChains.get(stateKey) ?? {
      event,
      profileKey,
      substantive: false,
      hook: false,
    };
    chain.substantive ||= event.mssrEligible;
    chain.hook ||= event.routingStatus === "bootstrap";
    pendingChains.set(stateKey, chain);
  }

  for (const chain of pendingChains.values()) {
    const event = chain.event;
    const caller = event.caller || "other";
    const row = event.traceId
      ? traceState.get(
          ...filter.params,
          event.traceId,
          caller,
          ...(detailed ? [
            event.model || "unknown",
            event.reasoningEffort || "unknown",
            event.hostAgent || "unknown",
            event.hostVariant || "unknown",
            event.project || "unknown",
            event.sessionKey || "unknown",
            event.taskKey || "unknown",
          ] : []),
        )
      : untracedState.get(
          ...filter.params,
          caller,
          event.sessionKey || "unknown",
          event.taskKey || "unknown",
          event.project || "unknown",
          event.workflowKey || "unscoped",
          ...(detailed ? [
            event.model || "unknown",
            event.reasoningEffort || "unknown",
            event.hostAgent || "unknown",
            event.hostVariant || "unknown",
          ] : []),
        );
    const persistedSubstantive = Number(row?.substantive ?? 0) > 0;
    const persistedHook = Number(row?.hook ?? 0) > 0;
    const mergedSubstantive = persistedSubstantive || chain.substantive;
    const mergedHook = persistedHook || chain.hook;
    const persistedRouted = persistedSubstantive && persistedHook;
    const mergedRouted = mergedSubstantive && mergedHook;
    const current = coverage.get(chain.profileKey) ?? emptyRoutingCoverage();
    current.substantive_chains += Number(mergedSubstantive) - Number(persistedSubstantive);
    current.routed_chains += Number(mergedRouted) - Number(persistedRouted);
    current.unrouted_chains = Math.max(0, current.substantive_chains - current.routed_chains);
    current.chains_without_route_hook = current.unrouted_chains;
    current.mssr_routed_chain_coverage = current.substantive_chains > 0
      ? Math.round((100 * current.routed_chains / current.substantive_chains) * 100) / 100
      : null;
    coverage.set(chain.profileKey, current);
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

function pendingMetricEvents(scope: BridgeMetricsScope): BridgeMetricEnd[] {
  const epoch = getMssrObservabilityEpoch();
  return recentToolMetricOverlay.filter((event) => {
    if (event.tool.startsWith("__test_") || event.tool === "metrics_regression") return false;
    if (scope === "all") return true;
    return event.observabilityEpoch === epoch.activeEpoch && event.startedAtIso >= epoch.baselineAt;
  });
}

function pendingUnpersistedMetricEvents(
  database: DatabaseSync,
  scope: BridgeMetricsScope,
  pendingSnapshot: BridgeMetricEnd[] = pendingMetricEvents(scope),
): BridgeMetricEnd[] {
  const pending = pendingSnapshot;
  if (pending.length === 0) return pending;

  // Persistence and its acknowledgement are intentionally decoupled from the
  // request path. A row can therefore already exist in SQLite for a brief
  // interval while the read-your-writes overlay still retains the same event.
  // Aggregate projections lose row ids during GROUP BY, so filter that overlap
  // before merging or the transition can count one call twice.
  const persistedIds = new Set<string>();
  const chunkSize = 250;
  for (let offset = 0; offset < pending.length; offset += chunkSize) {
    const chunk = pending.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = database.prepare(`SELECT id FROM tool_calls WHERE id IN (${placeholders})`)
      .all(...chunk.map((event) => event.id));
    for (const row of rows) {
      if (typeof row.id === "string") persistedIds.add(row.id);
    }
  }
  return pending.filter((event) => !persistedIds.has(event.id));
}

function withMetricsReadSnapshot<T>(
  database: DatabaseSync,
  scope: BridgeMetricsScope,
  reader: (pendingSnapshot: BridgeMetricEnd[]) => T,
): T {
  const pendingSnapshot = pendingMetricEvents(scope);
  database.exec("BEGIN DEFERRED");
  try {
    const result = reader(pendingSnapshot);
    database.exec("COMMIT");
    return result;
  }
  catch (error) {
    try { database.exec("ROLLBACK"); }
    catch {}
    throw error;
  }
}

export function getPendingTraceToolRowsSince(sinceIso: string): Array<Record<string, unknown>> {
  return recentToolMetricOverlay
    .filter((event) => Boolean(event.traceId) && event.startedAtIso >= sinceIso && !String(event.traceId).startsWith("__test_"))
    .map((event) => ({
      id: event.id,
      trace_id: event.traceId ?? null,
      started_at: event.startedAtIso,
      ended_at: new Date(event.startedAtMs + event.durationMs).toISOString(),
      duration_ms: event.durationMs,
      tool: event.tool,
      operation_subject: event.operationSubject ?? null,
      observability_epoch: event.observabilityEpoch,
      ok: event.ok ? 1 : 0,
      caller: event.caller,
      client_name: event.clientName,
      session_key: event.sessionKey,
      model: event.model,
      reasoning_effort: event.reasoningEffort,
      host_agent: event.hostAgent,
      host_variant: event.hostVariant,
      host_parent_session_key: event.parentSessionKey,
    }));
}

function mergePendingMetricSummary(
  database: DatabaseSync,
  rows: JsonRecord[],
  scope: BridgeMetricsScope,
  limit: number,
  pendingSnapshot: BridgeMetricEnd[],
): JsonRecord[] {
  const byTool = new Map<string, JsonRecord>();
  for (const row of rows) byTool.set(String(row.tool ?? "unknown"), { ...row });
  for (const event of pendingUnpersistedMetricEvents(database, scope, pendingSnapshot)) {
    const current = byTool.get(event.tool) ?? {
      tool: event.tool,
      calls: 0,
      ok_calls: 0,
      error_calls: 0,
      avg_duration_ms: 0,
      max_duration_ms: 0,
      last_started_at: null,
    };
    const previousCalls = Number(current.calls ?? 0);
    const nextCalls = previousCalls + 1;
    const previousAverage = Number(current.avg_duration_ms ?? 0);
    current.calls = nextCalls;
    current.ok_calls = Number(current.ok_calls ?? 0) + (event.ok ? 1 : 0);
    current.error_calls = Number(current.error_calls ?? 0) + (event.ok ? 0 : 1);
    current.avg_duration_ms = Math.round((((previousAverage * previousCalls) + event.durationMs) / nextCalls) * 100) / 100;
    current.max_duration_ms = Math.max(Number(current.max_duration_ms ?? 0), event.durationMs);
    if (typeof current.last_started_at !== "string" || event.startedAtIso > current.last_started_at) current.last_started_at = event.startedAtIso;
    byTool.set(event.tool, current);
  }
  return [...byTool.values()]
    .sort((a, b) => Number(b.calls ?? 0) - Number(a.calls ?? 0) || String(a.tool ?? "").localeCompare(String(b.tool ?? "")))
    .slice(0, Math.max(1, Math.trunc(limit)));
}

function mergePendingMetricProfiles(
  database: DatabaseSync,
  rows: JsonRecord[],
  scope: BridgeMetricsScope,
  detailed: boolean,
  pendingSnapshot: BridgeMetricEnd[],
  limit?: number,
): JsonRecord[] {
  const byKey = new Map<string, JsonRecord>();
  for (const row of rows) byKey.set(metricProfileKey(row, detailed), { ...row });
  for (const event of pendingUnpersistedMetricEvents(database, scope, pendingSnapshot)) {
    const identity = metricProfileIdentityFromEvent(event, detailed);
    const key = metricProfileKey(identity, detailed);
    const current = byKey.get(key) ?? {
      ...identity,
      calls: 0,
      error_calls: 0,
      avg_duration_ms: 0,
      eligible_calls: 0,
      traced_calls: 0,
      untraced_calls: 0,
      mssr_trace_coverage: null,
    };
    const previousCalls = Number(current.calls ?? 0);
    const nextCalls = previousCalls + 1;
    const previousAverage = Number(current.avg_duration_ms ?? 0);
    current.calls = nextCalls;
    current.error_calls = Number(current.error_calls ?? 0) + (event.ok ? 0 : 1);
    current.avg_duration_ms = Math.round((((previousAverage * previousCalls) + event.durationMs) / nextCalls) * 100) / 100;
    if (event.mssrEligible) {
      current.eligible_calls = Number(current.eligible_calls ?? 0) + 1;
      if (event.traceId) current.traced_calls = Number(current.traced_calls ?? 0) + 1;
      else current.untraced_calls = Number(current.untraced_calls ?? 0) + 1;
    }
    const eligible = Number(current.eligible_calls ?? 0);
    current.mssr_trace_coverage = eligible > 0
      ? Math.round((100 * Number(current.traced_calls ?? 0) / eligible) * 100) / 100
      : null;
    if (detailed && event.relatedProject && event.relatedProject !== "none") {
      const related = new Set(String(current.related_project ?? "none").split(",").filter((value) => value && value !== "none"));
      related.add(event.relatedProject);
      current.related_project = [...related].sort().join(",") || "none";
    }
    byKey.set(key, current);
  }
  const merged = [...byKey.values()].sort((a, b) => Number(b.calls ?? 0) - Number(a.calls ?? 0) || metricProfileKey(a, detailed).localeCompare(metricProfileKey(b, detailed)));
  return limit === undefined ? merged : merged.slice(0, Math.max(1, Math.trunc(limit)));
}

function getMetricsProfiles(
  database: DatabaseSync,
  scope: BridgeMetricsScope,
  pendingSnapshot: BridgeMetricEnd[],
  agentProfileLimit = 50,
) {
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
  const mergedSurfaces = mergePendingMetricProfiles(database, surfaces, scope, false, pendingSnapshot);
  const mergedAgentProfiles = mergePendingMetricProfiles(database, agentProfiles, scope, true, pendingSnapshot, agentProfileLimit);
  return {
    surfaces: withRoutingCoverage(mergedSurfaces, routingCoverageWithPending(database, scope, false, pendingSnapshot), false),
    agentProfiles: withRoutingCoverage(mergedAgentProfiles, routingCoverageWithPending(database, scope, true, pendingSnapshot), true),
  };
}

export function getMetricsSummary(limit = 50, scope: BridgeMetricsScope = "active") {
  const sqlite = getDb();
  if (!sqlite) return { ...getMetricsStatus(), scope, summary: [], surfaces: [], agentProfiles: [] };
  return withMetricsReadSnapshot(sqlite, scope, (pendingSnapshot) => {
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
    return {
      ...getMetricsStatus(),
      scope,
      summary: mergePendingMetricSummary(sqlite, rows, scope, limit, pendingSnapshot),
      ...getMetricsProfiles(sqlite, scope, pendingSnapshot, limit),
    };
  });
}

export function getRecentMetrics(limit = 25, scope: BridgeMetricsScope = "active") {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const sqlite = getDb();
  const filter = metricsFilter(scope);
  const persisted = sqlite ? sqlite.prepare(`
    SELECT id, started_at, duration_ms, tool, ok, error, input_keys, operation_subject, output_chars, pid,
      result_ok, result_code, result_status,
      runtime_boot_id, trace_id, workflow_key, task_key, caller, model, reasoning_effort, client_name, session_key, project, related_project,
      host_parent_session_key, host_agent, host_variant, message_key, call_key, project_key,
      routing_status, mssr_eligible
    FROM tool_calls
    WHERE ${filter.where}
    ORDER BY started_at DESC
    LIMIT ?
  `).all(...filter.params, boundedLimit) : [];
  const epoch = getMssrObservabilityEpoch();
  const overlay: JsonRecord[] = recentToolMetricOverlay
    .filter((event) => scope === "all" || (event.observabilityEpoch === epoch.activeEpoch && event.startedAtIso >= epoch.baselineAt))
    .map((event) => ({
      id: event.id, started_at: event.startedAtIso, duration_ms: event.durationMs, tool: event.tool,
      ok: event.ok ? 1 : 0, error: event.error ?? null, input_keys: event.inputKeys,
      operation_subject: event.operationSubject ?? null, output_chars: event.outputChars, pid: process.pid,
      result_ok: event.resultOk === undefined ? null : event.resultOk ? 1 : 0,
      result_code: event.resultCode ?? null, result_status: event.resultStatus ?? null,
      runtime_boot_id: event.runtimeBootId, trace_id: event.traceId ?? null, workflow_key: event.workflowKey,
      task_key: event.taskKey, caller: event.caller, model: event.model, reasoning_effort: event.reasoningEffort,
      client_name: event.clientName, session_key: event.sessionKey, project: event.project, related_project: event.relatedProject,
      host_parent_session_key: event.parentSessionKey, host_agent: event.hostAgent, host_variant: event.hostVariant,
      message_key: event.messageKey, call_key: event.callKey, project_key: event.projectKey,
      routing_status: event.routingStatus, mssr_eligible: event.mssrEligible ? 1 : 0,
    }));
  const byId = new Map<string, JsonRecord>();
  for (const row of persisted) byId.set(String(row.id ?? `${row.started_at}:${row.tool}`), row);
  for (const row of overlay) byId.set(String(row.id ?? `${row.started_at}:${row.tool}`), row);
  const rows = [...byId.values()]
    .sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")))
    .slice(0, boundedLimit);
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

  return withMetricsReadSnapshot(sqlite, scope, (pendingSnapshot) => {
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

    return { ...getMetricsStatus(), scope, totals, slowest, ...getMetricsProfiles(sqlite, scope, pendingSnapshot, 20) };
  });
}

export function getMetricsDashboardSnapshot(limit = 12, scope: BridgeMetricsScope = "active") {
  const overview = getMetricsOverview(scope);
  const sqlite = getDb();
  if (!sqlite) {
    return {
      overview,
      summary: { ...getMetricsStatus(), scope, summary: [], surfaces: [], agentProfiles: [] },
    };
  }

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
  `).all(...filter.params, Math.max(1, Math.min(200, limit)));

  return {
    overview,
    summary: {
      ...getMetricsStatus(),
      scope,
      summary: rows,
      surfaces: overview.surfaces,
      agentProfiles: overview.agentProfiles,
    },
  };
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
  const persistedCalls = sqlite ? sqlite.prepare(`
    SELECT id, started_at, ended_at, duration_ms, tool, ok, error, operation_subject,
      server_version, pid, runtime_boot_id, trace_id, workflow_key, task_key,
      caller, client_name, session_key, project, related_project, routing_status,
      host_parent_session_key
    FROM tool_calls
    WHERE trace_id = ?
    ORDER BY started_at ASC
    LIMIT ?
  `).all(normalizedTraceId, boundedLimit) : [];
  const overlayCalls: JsonRecord[] = recentToolMetricOverlay
    .filter((event) => event.traceId === normalizedTraceId)
    .map((event) => ({
      id: event.id,
      started_at: event.startedAtIso,
      ended_at: new Date(event.startedAtMs + event.durationMs).toISOString(),
      duration_ms: event.durationMs,
      tool: event.tool,
      ok: event.ok ? 1 : 0,
      error: event.error ?? null,
      operation_subject: event.operationSubject ?? null,
      server_version: SERVER_VERSION,
      pid: process.pid,
      runtime_boot_id: event.runtimeBootId,
      trace_id: event.traceId ?? null,
      workflow_key: event.workflowKey,
      task_key: event.taskKey,
      caller: event.caller,
      client_name: event.clientName,
      session_key: event.sessionKey,
      host_parent_session_key: event.parentSessionKey,
      project: event.project,
      related_project: event.relatedProject,
      routing_status: event.routingStatus,
    }));
  const byId = new Map<string, JsonRecord>();
  for (const row of persistedCalls) byId.set(String(row.id ?? `${row.started_at}:${row.tool}`), row);
  for (const row of overlayCalls) byId.set(String(row.id ?? `${row.started_at}:${row.tool}`), row);
  const calls = [...byId.values()]
    .sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")))
    .slice(0, boundedLimit);
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
  closeMetricsWalMaintenanceForTests();
  closeObservabilityPersistenceForTests();
  if (db) db.close();
  db = undefined;
  insertToolCall = null;
  recentToolMetricOverlay.length = 0;
}
