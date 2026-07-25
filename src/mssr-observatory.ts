import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  close: () => void;
};
type SqliteModule = {
  DatabaseSync: new (filename: string) => DatabaseSync;
};

export const MSSR_CHECKPOINT_TYPES = [
  "phase_completed",
  "verification",
  "persistence",
  "outcome",
  "friction",
  "context_used",
  "replan",
] as const;

export const MSSR_OUTCOME_EVIDENCE_KINDS = [
  "manifest",
  "tests",
  "runtime",
  "user-confirmation",
  "manual-review",
  "mixed",
  "other",
] as const;

export const MSSR_CONTEXT_SOURCES = [
  "current-conversation",
  "personal-context",
  "project-context",
  "git-history",
  "bridge-metrics",
  "user-upload",
  "codex-session",
  "other",
] as const;

export type MssrCheckpointType = typeof MSSR_CHECKPOINT_TYPES[number];
export type MssrContextSource = typeof MSSR_CONTEXT_SOURCES[number];
export type MssrOutcomeEvidenceKind = typeof MSSR_OUTCOME_EVIDENCE_KINDS[number];

type MssrEventInput = {
  traceId: string;
  eventType: string;
  caller?: string;
  stage?: string;
  classificationMode?: string;
  skillName?: string;
  required?: boolean;
  ok?: boolean;
  taskHash?: string;
  details?: JsonRecord;
};

type MssrStoredEvent = {
  id: string;
  occurredAt: string;
  traceId: string;
  eventType: string;
  caller?: string;
  stage?: string;
  classificationMode?: string;
  skillName?: string;
  required?: boolean;
  ok?: boolean;
  taskHash?: string;
  details: JsonRecord;
};

const require = createRequire(import.meta.url);
const observatoryEnabled = process.env.BRIDGE_MCP_METRICS_ENABLED !== "0";
const metricsDir = path.resolve(process.env.BRIDGE_MCP_METRICS_DIR || path.join(process.cwd(), "data"));
const logsDir = path.resolve(process.env.BRIDGE_MCP_LOG_DIR || path.join(process.cwd(), "logs"));
const sqlitePath = path.resolve(process.env.BRIDGE_MCP_METRICS_SQLITE || path.join(metricsDir, "bridge-metrics.sqlite"));
const jsonlPath = path.resolve(process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL || path.join(logsDir, "mssr-events.jsonl"));

let db: DatabaseSync | null | undefined;
let insertEvent: StatementSync | null = null;

function ensureDirs(): void {
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
  if (!observatoryEnabled) return null;
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
    CREATE TABLE IF NOT EXISTS mssr_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      caller TEXT,
      stage TEXT,
      classification_mode TEXT,
      skill_name TEXT,
      required INTEGER,
      ok INTEGER,
      task_hash TEXT,
      details_json TEXT NOT NULL,
      server_name TEXT NOT NULL,
      server_version TEXT NOT NULL,
      pid INTEGER NOT NULL,
      hostname TEXT NOT NULL,
      platform TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mssr_events_occurred_at ON mssr_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_mssr_events_trace ON mssr_events(trace_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_mssr_events_type ON mssr_events(event_type, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_mssr_events_skill ON mssr_events(skill_name, occurred_at);
  `);
  insertEvent = db.prepare(`
    INSERT INTO mssr_events (
      id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
      skill_name, required, ok, task_hash, details_json, server_name,
      server_version, pid, hostname, platform
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return db;
}

function redactText(value: string, maxChars = 400): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-REDACTED")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,}\]]+/gi, "$1=REDACTED")
    .slice(0, maxChars);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-limit]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 60).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== "object") return String(value ?? "");
  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value as JsonRecord).slice(0, 60)) {
    if (/prompt|transcript|chain.?of.?thought|password|secret|api.?key|token/i.test(key)) continue;
    output[key] = sanitizeValue(child, depth + 1);
  }
  return output;
}

function safeDetails(details: JsonRecord = {}): JsonRecord {
  const sanitized = sanitizeValue(details) as JsonRecord;
  const encoded = JSON.stringify(sanitized);
  if (encoded.length <= 24_000) return sanitized;
  return { truncated: true, preview: redactText(encoded, 23_000) };
}

function writeJsonl(event: MssrStoredEvent): void {
  if (!observatoryEnabled) return;
  ensureDirs();
  fs.appendFileSync(jsonlPath, `${JSON.stringify({ type: "mssr_event", ...event })}\n`, "utf8");
}

function validTraceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{6,128}$/.test(value);
}

export function resolveMssrTraceId(value?: unknown): string {
  if (typeof value === "string" && validTraceId(value.trim())) return value.trim();
  return `mssr-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 12)}`;
}

export function hashMssrTask(task: string): string {
  const normalized = task.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export function recordMssrEvent(input: MssrEventInput): MssrStoredEvent {
  const event: MssrStoredEvent = {
    id: `${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`,
    occurredAt: new Date().toISOString(),
    traceId: resolveMssrTraceId(input.traceId),
    eventType: redactText(input.eventType, 80),
    caller: input.caller ? redactText(input.caller, 80) : undefined,
    stage: input.stage ? redactText(input.stage, 80) : undefined,
    classificationMode: input.classificationMode ? redactText(input.classificationMode, 80) : undefined,
    skillName: input.skillName ? redactText(input.skillName, 160) : undefined,
    required: input.required,
    ok: input.ok,
    taskHash: input.taskHash,
    details: safeDetails(input.details),
  };
  writeJsonl(event);
  const database = getDb();
  if (!database || !insertEvent) return event;
  insertEvent.run(
    event.id,
    event.occurredAt,
    event.traceId,
    event.eventType,
    event.caller ?? null,
    event.stage ?? null,
    event.classificationMode ?? null,
    event.skillName ?? null,
    event.required === undefined ? null : Number(event.required),
    event.ok === undefined ? null : Number(event.ok),
    event.taskHash ?? null,
    JSON.stringify(event.details),
    SERVER_NAME,
    SERVER_VERSION,
    process.pid,
    os.hostname(),
    os.platform(),
  );
  return event;
}

function routeSkills(value: unknown): Array<{ name: string; source?: string; required: boolean; score?: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof (item as JsonRecord).name !== "string") return [];
    const record = item as JsonRecord;
    return [{
      name: String(record.name),
      source: typeof record.source === "string" ? record.source : undefined,
      required: record.required === true,
      score: typeof record.score === "number" ? record.score : undefined,
    }];
  });
}

export function recordMssrRoute(args: {
  traceId: string;
  action: "recommend" | "plan" | "bootstrap";
  task: string;
  route: JsonRecord;
}): MssrStoredEvent {
  const intent = args.route.intent && typeof args.route.intent === "object" ? args.route.intent as JsonRecord : {};
  const coverage = args.route.coverage && typeof args.route.coverage === "object" ? args.route.coverage as JsonRecord : {};
  return recordMssrEvent({
    traceId: args.traceId,
    eventType: "route_planned",
    caller: typeof args.route.caller === "string" ? args.route.caller : undefined,
    stage: typeof args.route.stage === "string" ? args.route.stage : undefined,
    classificationMode: typeof args.route.classificationMode === "string" ? args.route.classificationMode : undefined,
    taskHash: hashMssrTask(args.task),
    ok: true,
    details: {
      action: args.action,
      contextUsed: args.route.contextUsed === true,
      contextCharacters: typeof args.route.contextCharacters === "number" ? args.route.contextCharacters : 0,
      workflows: Array.isArray(args.route.workflows) ? args.route.workflows : [],
      activeSkills: routeSkills(args.route.activeSkills),
      deferredSkills: routeSkills(args.route.deferredSkills),
      loadOrder: Array.isArray(args.route.loadOrder) ? args.route.loadOrder : [],
      deferredLoadOrder: Array.isArray(args.route.deferredLoadOrder) ? args.route.deferredLoadOrder : [],
      signals: Array.isArray(intent.signals) ? intent.signals : [],
      ambiguity: typeof intent.ambiguity === "string" ? intent.ambiguity : undefined,
      requiredPhases: Array.isArray(coverage.requiredPhases) ? coverage.requiredPhases : [],
      completedPhases: Array.isArray(coverage.completedPhases) ? coverage.completedPhases : [],
      missingRequiredPhases: Array.isArray(coverage.missingRequiredPhases) ? coverage.missingRequiredPhases : [],
    },
  });
}

export function recordMssrSkillLoad(args: {
  traceId: string;
  skillName: string;
  source?: string;
  stage?: string;
  required?: boolean;
  loaded: boolean;
  via: "skill_load" | "skill_bootstrap";
  warning?: string;
}): MssrStoredEvent {
  return recordMssrEvent({
    traceId: args.traceId,
    eventType: "skill_loaded",
    stage: args.stage,
    skillName: args.skillName,
    required: args.required,
    ok: args.loaded,
    details: {
      source: args.source,
      via: args.via,
      warning: args.warning,
    },
  });
}

export function recordMssrCheckpoint(args: {
  traceId: string;
  eventType: MssrCheckpointType;
  caller?: string;
  stage?: string;
  skillName?: string;
  primarySkill?: string;
  supportingSkills?: string[];
  metricName?: string;
  score?: number;
  accepted?: boolean;
  evidenceKind?: MssrOutcomeEvidenceKind;
  evidenceRef?: string;
  status?: "success" | "partial" | "failed" | "skipped";
  completedPhases?: string[];
  contextSources?: MssrContextSource[];
  userCorrections?: number;
  verificationPassed?: boolean;
  persisted?: boolean;
  summary?: string;
  signals?: string[];
}): MssrStoredEvent {
  const ok = args.status === undefined ? undefined : args.status === "success";
  const primarySkill = args.primarySkill ?? args.skillName;
  const supportingSkills = [...new Set((args.supportingSkills ?? []).filter((name) => name && name !== primarySkill))].slice(0, 24);
  const score = typeof args.score === "number" && Number.isFinite(args.score)
    ? Math.max(0, Math.min(1, args.score))
    : undefined;
  return recordMssrEvent({
    traceId: args.traceId,
    eventType: args.eventType,
    caller: args.caller,
    stage: args.stage,
    skillName: primarySkill,
    ok,
    details: {
      status: args.status,
      completedPhases: args.completedPhases ?? [],
      contextSources: args.contextSources ?? [],
      userCorrections: args.userCorrections ?? 0,
      verificationPassed: args.verificationPassed,
      persisted: args.persisted,
      primarySkill,
      supportingSkills,
      metricName: args.metricName ? redactText(args.metricName, 120) : undefined,
      score,
      accepted: args.accepted,
      evidenceKind: args.evidenceKind,
      evidenceRef: args.evidenceRef ? redactText(args.evidenceRef, 300) : undefined,
      summary: args.summary ? redactText(args.summary, 300) : undefined,
      signals: args.signals ?? [],
    },
  });
}

function decodeRow(row: JsonRecord): MssrStoredEvent {
  let details: JsonRecord = {};
  try {
    details = typeof row.details_json === "string" ? JSON.parse(row.details_json) as JsonRecord : {};
  } catch {
    details = { parseError: true };
  }
  return {
    id: String(row.id ?? ""),
    occurredAt: String(row.occurred_at ?? ""),
    traceId: String(row.trace_id ?? ""),
    eventType: String(row.event_type ?? ""),
    caller: typeof row.caller === "string" ? row.caller : undefined,
    stage: typeof row.stage === "string" ? row.stage : undefined,
    classificationMode: typeof row.classification_mode === "string" ? row.classification_mode : undefined,
    skillName: typeof row.skill_name === "string" ? row.skill_name : undefined,
    required: row.required === null || row.required === undefined ? undefined : Number(row.required) === 1,
    ok: row.ok === null || row.ok === undefined ? undefined : Number(row.ok) === 1,
    taskHash: typeof row.task_hash === "string" ? row.task_hash : undefined,
    details,
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
}

function topCounts(values: string[], limit = 12): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function observatoryStatus() {
  const database = getDb();
  const totals = database?.prepare(`
    SELECT COUNT(*) AS events, COUNT(DISTINCT trace_id) AS traces, MAX(occurred_at) AS latest
    FROM mssr_events
    WHERE trace_id NOT LIKE '__test_%'
  `).get() ?? { events: 0, traces: 0, latest: null };
  return {
    enabled: observatoryEnabled,
    sqliteAvailable: Boolean(database),
    sqlitePath,
    jsonlPath,
    privacy: {
      rawPromptsStored: false,
      transcriptsStored: false,
      taskStorage: "sha256 fingerprint only",
      details: "bounded structured metadata with sensitive-key filtering",
    },
    totals,
  };
}

function summary(days: number) {
  const database = getDb();
  if (!database) return { ...observatoryStatus(), days, benchmark: null, top: {} };
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const events = database.prepare(`
    SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
           skill_name, required, ok, task_hash, details_json
    FROM mssr_events
    WHERE occurred_at >= ? AND trace_id NOT LIKE '__test_%'
    ORDER BY occurred_at ASC
  `).all(since).map(decodeRow);

  const byTrace = new Map<string, MssrStoredEvent[]>();
  for (const event of events) {
    const trace = byTrace.get(event.traceId) ?? [];
    trace.push(event);
    byTrace.set(event.traceId, trace);
  }

  const routes = events.filter((event) => event.eventType === "route_planned");
  const loads = events.filter((event) => event.eventType === "skill_loaded");
  const successfulLoads = loads.filter((event) => event.ok === true);
  const traceIdsWithRoutes = new Set(routes.map((event) => event.traceId));
  const traceIdsWithLoads = new Set(successfulLoads.map((event) => event.traceId));
  const routeTracesWithLoads = [...traceIdsWithRoutes].filter((traceId) => traceIdsWithLoads.has(traceId)).length;
  const replannedTraces = [...byTrace.values()].filter((trace) => trace.filter((event) => event.eventType === "route_planned").length > 1).length;

  const expectedRequired = new Set<string>();
  const selectedSkillNames: string[] = [];
  for (const route of routes) {
    const active = Array.isArray(route.details.activeSkills) ? route.details.activeSkills : [];
    for (const item of active) {
      if (!item || typeof item !== "object" || typeof (item as JsonRecord).name !== "string") continue;
      const name = String((item as JsonRecord).name);
      selectedSkillNames.push(name);
      if ((item as JsonRecord).required === true) expectedRequired.add(`${route.traceId}\u0000${name}`);
    }
  }
  const loadedKeys = new Set(successfulLoads.filter((event) => event.skillName).map((event) => `${event.traceId}\u0000${event.skillName}`));
  const satisfiedRequired = [...expectedRequired].filter((key) => loadedKeys.has(key)).length;

  const verificationTraces = new Set(events.filter((event) => event.eventType === "verification" && (event.ok === true || event.details.verificationPassed === true)).map((event) => event.traceId));
  const persistenceTraces = new Set(events.filter((event) => event.eventType === "persistence" && (event.ok === true || event.details.persisted === true)).map((event) => event.traceId));
  const outcomeEvents = events.filter((event) => event.eventType === "outcome");
  const latestOutcomeByTrace = new Map<string, MssrStoredEvent>();
  for (const event of outcomeEvents) latestOutcomeByTrace.set(event.traceId, event);
  const latestOutcomes = [...latestOutcomeByTrace.values()];
  const outcomeTraces = new Set(latestOutcomes.map((event) => event.traceId));
  const primaryOutcomeEvents = latestOutcomes.filter((event) => Boolean(event.skillName));
  const measuredAcceptanceOutcomes = primaryOutcomeEvents.filter((event) => typeof event.details.accepted === "boolean");
  const acceptedOutcomes = measuredAcceptanceOutcomes.filter((event) => event.details.accepted === true);
  const successfulOutcomes = primaryOutcomeEvents.filter((event) => event.details.status === "success" || event.ok === true);
  const scoredOutcomes = primaryOutcomeEvents.filter((event) => typeof event.details.score === "number");
  const outcomeSupportingSkills: string[] = [];
  const outcomeBySkill = new Map<string, {
    outcomes: number;
    success: number;
    partial: number;
    failed: number;
    accepted: number;
    acceptanceMeasured: number;
    scoreTotal: number;
    scoreCount: number;
  }>();
  for (const event of primaryOutcomeEvents) {
    const skill = String(event.skillName);
    const current = outcomeBySkill.get(skill) ?? {
      outcomes: 0,
      success: 0,
      partial: 0,
      failed: 0,
      accepted: 0,
      acceptanceMeasured: 0,
      scoreTotal: 0,
      scoreCount: 0,
    };
    current.outcomes += 1;
    const status = String(event.details.status ?? (event.ok === true ? "success" : event.ok === false ? "failed" : "unknown"));
    if (status === "success") current.success += 1;
    else if (status === "partial") current.partial += 1;
    else if (status === "failed") current.failed += 1;
    if (typeof event.details.accepted === "boolean") {
      current.acceptanceMeasured += 1;
      if (event.details.accepted === true) current.accepted += 1;
    }
    if (typeof event.details.score === "number") {
      current.scoreTotal += event.details.score;
      current.scoreCount += 1;
    }
    if (Array.isArray(event.details.supportingSkills)) {
      outcomeSupportingSkills.push(...event.details.supportingSkills.filter((item): item is string => typeof item === "string"));
    }
    outcomeBySkill.set(skill, current);
  }
  const skillOutcomes = [...outcomeBySkill.entries()]
    .map(([name, value]) => ({
      name,
      outcomes: value.outcomes,
      successRate: rate(value.success, value.outcomes),
      success: value.success,
      partial: value.partial,
      failed: value.failed,
      acceptanceRate: rate(value.accepted, value.acceptanceMeasured),
      accepted: value.accepted,
      acceptanceMeasured: value.acceptanceMeasured,
      averageScore: value.scoreCount > 0 ? Math.round((value.scoreTotal / value.scoreCount) * 10_000) / 10_000 : null,
    }))
    .sort((a, b) => b.outcomes - a.outcomes || a.name.localeCompare(b.name));
  const contextSources = events.flatMap((event) => Array.isArray(event.details.contextSources) ? event.details.contextSources.filter((item): item is string => typeof item === "string") : []);
  const userCorrections = events.reduce((total, event) => total + (typeof event.details.userCorrections === "number" ? event.details.userCorrections : 0), 0);
  const structuredRoutes = routes.filter((event) => event.classificationMode === "structured-semantic").length;
  const orphanLoads = loads.filter((event) => !traceIdsWithRoutes.has(event.traceId)).length;

  return {
    ...observatoryStatus(),
    days,
    since,
    eventCount: events.length,
    traceCount: byTrace.size,
    benchmark: {
      routeEvents: routes.length,
      structuredRoutes,
      lexicalFallbackRoutes: routes.length - structuredRoutes,
      structuredRouteRate: rate(structuredRoutes, routes.length),
      tracesWithRoute: traceIdsWithRoutes.size,
      tracesWithSuccessfulLoad: traceIdsWithLoads.size,
      routedTraceLoadCoverage: rate(routeTracesWithLoads, traceIdsWithRoutes.size),
      requiredSkillLoadsExpected: expectedRequired.size,
      requiredSkillLoadsSatisfied: satisfiedRequired,
      requiredLoadCompliance: rate(satisfiedRequired, expectedRequired.size),
      loadEvents: loads.length,
      successfulLoadEvents: successfulLoads.length,
      orphanLoadEvents: orphanLoads,
      replannedTraces,
      verifiedTraces: verificationTraces.size,
      verificationCoverage: rate(verificationTraces.size, traceIdsWithRoutes.size),
      persistedTraces: persistenceTraces.size,
      persistenceCoverage: rate(persistenceTraces.size, traceIdsWithRoutes.size),
      outcomeTraces: outcomeTraces.size,
      outcomeCoverage: rate(outcomeTraces.size, traceIdsWithRoutes.size),
      attributedOutcomeTraces: primaryOutcomeEvents.length,
      outcomeAttributionCoverage: rate(primaryOutcomeEvents.length, latestOutcomes.length),
      successfulOutcomeTraces: successfulOutcomes.length,
      outcomeSuccessRate: rate(successfulOutcomes.length, primaryOutcomeEvents.length),
      acceptedOutcomeTraces: acceptedOutcomes.length,
      measuredAcceptanceOutcomeTraces: measuredAcceptanceOutcomes.length,
      outcomeAcceptanceRate: rate(acceptedOutcomes.length, measuredAcceptanceOutcomes.length),
      scoredOutcomeTraces: scoredOutcomes.length,
      averageOutcomeScore: scoredOutcomes.length > 0
        ? Math.round((scoredOutcomes.reduce((total, event) => total + Number(event.details.score), 0) / scoredOutcomes.length) * 10_000) / 10_000
        : null,
      userCorrections,
    },
    top: {
      selectedSkills: topCounts(selectedSkillNames),
      loadedSkills: topCounts(successfulLoads.flatMap((event) => event.skillName ? [event.skillName] : [])),
      skillOutcomes,
      outcomeSupportingSkills: topCounts(outcomeSupportingSkills),
      callers: topCounts(routes.flatMap((event) => event.caller ? [event.caller] : [])),
      stages: topCounts(routes.flatMap((event) => event.stage ? [event.stage] : [])),
      contextSources: topCounts(contextSources),
    },
  };
}

export function queryMssrObservatory(args: {
  kind?: "status" | "summary" | "benchmark" | "recent" | "trace";
  traceId?: string;
  days?: number;
  limit?: number;
}) {
  const kind = args.kind ?? "summary";
  const days = Math.max(1, Math.min(365, Math.trunc(args.days ?? 30)));
  const limit = Math.max(1, Math.min(200, Math.trunc(args.limit ?? 50)));
  if (kind === "status") return observatoryStatus();
  if (kind === "summary" || kind === "benchmark") return summary(days);
  const database = getDb();
  if (!database) return { ...observatoryStatus(), [kind]: [] };
  if (kind === "trace") {
    if (!args.traceId || !validTraceId(args.traceId)) throw new Error("traceId is required for kind=trace and must contain only letters, numbers, dot, underscore, colon, or hyphen.");
    const trace = database.prepare(`
      SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
             skill_name, required, ok, task_hash, details_json
      FROM mssr_events WHERE trace_id = ? ORDER BY occurred_at ASC LIMIT ?
    `).all(args.traceId, limit).map(decodeRow);
    return { ...observatoryStatus(), traceId: args.traceId, trace };
  }
  const recent = database.prepare(`
    SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
           skill_name, required, ok, task_hash, details_json
    FROM mssr_events
    WHERE trace_id NOT LIKE '__test_%'
    ORDER BY occurred_at DESC LIMIT ?
  `).all(limit).map(decodeRow);
  return { ...observatoryStatus(), recent };
}
export function closeMssrObservatoryForTests(): void {
  if (db) db.close();
  db = undefined;
  insertEvent = null;
}
