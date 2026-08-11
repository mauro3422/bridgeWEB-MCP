import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  analyzeMssrTelemetry,
  MSSR_CHECKPOINT_TYPES,
  MSSR_OUTCOME_DIMENSION_STATUSES,
  MSSR_OUTCOME_EVIDENCE_KINDS,
  type MssrCheckpointType,
  type MssrOutcomeDimensionStatus,
  type MssrOutcomeEvidenceKind,
  mssrTelemetryEnvelopeSchema,
  structuredSkillIntentSchema,
  validateMssrCheckpointLifecycle,
  type MssrTelemetryEnvelope,
} from "@mauroprime/mssr";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { getTraceToolEvidence } from "./metrics.js";
import { normalizeModelIdentifier, RUNTIME_BOOT_ID } from "./runtime-identity.js";
import {
  getMssrObservabilityEpoch,
  mssrObservabilityStatePath,
  resetMssrObservabilityEpochForTests,
} from "./mssr-observability-epoch.js";

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

export {
  MSSR_CHECKPOINT_TYPES,
  MSSR_OUTCOME_DIMENSION_STATUSES,
  MSSR_OUTCOME_EVIDENCE_KINDS,
} from "@mauroprime/mssr";

export type {
  MssrCheckpointType,
  MssrOutcomeDimensionStatus,
  MssrOutcomeEvidenceKind,
} from "@mauroprime/mssr";

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

export type MssrContextSource = typeof MSSR_CONTEXT_SOURCES[number];
export type MssrObservatoryScope = "active" | "all";

const DELEGATED_QUERY_TOOL = "bridge_tool_query";
const DELEGATED_ACTION_TOOL = "bridge_tool_action";
const PREPARATION_TOOLS = new Set([
  "project_context_load",
  "workflow_guide_recommend",
  "workflow_guide_load",
  "skill_catalog",
  "skill_recommend",
  "skill_route_audit",
  "skill_route_vocabulary",
  "skill_route_plan",
  "skill_bootstrap",
  "skill_load",
  "mssr_observatory_query",
  "mssr_trace_evidence",
  "mssr_trace_record",
  "bridge_connector_catalog_compare",
  "bridge_tool_schema",
  "bridge_tool_audit",
  "bridge_metrics_status",
  "bridge_metrics_query",
  "bridge_metrics_recent",
  "bridge_metrics_summary",
  "bridge_notice_status",
  "bridge_notice_drain",
]);

type MssrEventInput = {
  eventId?: string;
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

export type PersistedMssrTraceState = {
  traceId: string;
  workflowKey: string;
  stage: string;
  taskHash: string;
  caller: string;
  model: string;
  reasoningEffort: string;
  sessionKey: string;
  project: string;
  requiredSkills: string[];
  selectedSkills: string[];
  loadedSkills: string[];
  routeCount: number;
  closed: boolean;
  maintenanceRequired: boolean;
  lifecycleRevision: number;
  closeRevision: number;
  maintenanceRevision: number;
  updatedAt: number;
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
  const epoch = getMssrObservabilityEpoch();
  const event: MssrStoredEvent = {
    id: input.eventId ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`,
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
    details: safeDetails({
      ...(input.details ?? {}),
      observabilityEpoch: epoch.activeEpoch,
      runtimeBootId: RUNTIME_BOOT_ID,
      contractVersion: epoch.contractVersion,
    }),
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

function hasMssrEvent(eventId: string): boolean {
  const database = getDb();
  if (!database) return false;
  return Boolean(database.prepare("SELECT id FROM mssr_events WHERE id = ? LIMIT 1").get(eventId));
}

/** Persist one authenticated, privacy-bounded event emitted by an external MSSR host adapter. */
export function recordExternalMssrTelemetry(input: unknown): { event: MssrStoredEvent; duplicate: boolean } {
  const envelope = mssrTelemetryEnvelopeSchema.parse(input) as MssrTelemetryEnvelope;
  if (hasMssrEvent(envelope.eventId)) {
    const existing = getDb()?.prepare(`
      SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
             skill_name, required, ok, task_hash, details_json
      FROM mssr_events WHERE id = ? LIMIT 1
    `).get(envelope.eventId);
    if (!existing) throw new Error("External MSSR event deduplication readback failed.");
    return { event: decodeRow(existing), duplicate: true };
  }

  if (envelope.event.kind === "route") {
    const route = envelope.event.route;
    return { duplicate: false, event: recordMssrEvent({
      eventId: envelope.eventId,
      traceId: envelope.traceId,
      eventType: "route_planned",
      caller: envelope.caller,
      stage: route.stage,
      classificationMode: route.classificationMode,
      taskHash: envelope.event.taskHash,
      ok: true,
      details: {
        action: envelope.event.action,
        workflowKey: route.workflowKey ?? null,
        agentProfile: route.agentProfile,
        contextUsed: route.contextUsed,
        contextCharacters: route.contextCharacters,
        workflows: route.workflows,
        activeSkills: route.activeSkills,
        deferredSkills: route.deferredSkills,
        loadOrder: route.loadOrder,
        deferredLoadOrder: route.deferredLoadOrder,
        intent: boundedRouteIntent(route.intent),
        signals: route.signals,
        ambiguity: route.ambiguity,
        requiredPhases: route.requiredPhases,
        completedPhases: route.completedPhases,
        missingRequiredPhases: route.missingRequiredPhases,
        externalSource: envelope.source,
        emittedAt: envelope.emittedAt,
      },
    }) };
  }

  if (envelope.event.kind === "skill_load") {
    const load = envelope.event;
    return { duplicate: false, event: recordMssrEvent({
      eventId: envelope.eventId,
      traceId: envelope.traceId,
      eventType: "skill_loaded",
      caller: envelope.caller,
      stage: load.stage,
      skillName: load.skillName,
      required: load.required,
      ok: load.loaded,
      details: {
        source: load.source,
        via: load.via,
        warning: load.warning,
        externalSource: envelope.source,
        emittedAt: envelope.emittedAt,
      },
    }) };
  }

  const checkpoint = envelope.event.checkpoint;
  const persisted = readPersistedMssrTraceState(envelope.traceId);
  const violations = validateMssrCheckpointLifecycle(persisted ? {
    stage: persisted.stage as never,
    requiredSkills: persisted.requiredSkills,
    selectedSkills: persisted.selectedSkills,
    loadedSkills: persisted.loadedSkills,
    routeCount: persisted.routeCount,
    closed: persisted.closed,
    maintenanceRequired: persisted.maintenanceRequired,
    lifecycleRevision: persisted.lifecycleRevision,
    closeRevision: persisted.closeRevision,
    maintenanceRevision: persisted.maintenanceRevision,
  } : null, checkpoint);
  if (violations.some((item) => item.blocking)) {
    throw Object.assign(new Error(`External MSSR checkpoint rejected: ${violations.map((item) => item.code).join(", ")}.`), { statusCode: 409 });
  }
  const stored = recordMssrCheckpoint({
    ...checkpoint,
    eventId: envelope.eventId,
    traceId: envelope.traceId,
    caller: envelope.caller,
    externalSource: envelope.source,
    emittedAt: envelope.emittedAt,
  });
  return { event: stored, duplicate: false };
}

/** Correlate one host-observed MSSR route call only when exactly one lifecycle route occurred inside its bounded call window. */
export function resolveExternalMssrRouteTrace(startedAt: string, endedAt: string, caller = "opencode-local"): string | undefined {
  const database = getDb();
  if (!database) return undefined;
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > 24 * 60 * 60_000) return undefined;
  const lower = new Date(startMs - 1_000).toISOString();
  const upper = new Date(endMs + 1_000).toISOString();
  const rows = database.prepare(`
    SELECT DISTINCT trace_id FROM mssr_events
    WHERE caller = ? AND event_type = 'route_planned'
      AND occurred_at >= ? AND occurred_at <= ?
      AND trace_id NOT LIKE '__test_%'
  `).all(caller, lower, upper);
  return rows.length === 1 && typeof rows[0]?.trace_id === "string" ? rows[0].trace_id : undefined;
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

function boundedRouteIntent(value: unknown): JsonRecord | undefined {
  const parsed = structuredSkillIntentSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { domains, actions, artifacts, needs, signals, risk, ambiguity } = parsed.data;
  return { domains, actions, artifacts, needs, signals, risk, ambiguity };
}

export function recordMssrRoute(args: {
  traceId: string;
  action: "recommend" | "plan" | "bootstrap";
  task: string;
  route: JsonRecord;
}): MssrStoredEvent {
  const intent = args.route.intent && typeof args.route.intent === "object" ? args.route.intent as JsonRecord : {};
  const coverage = args.route.coverage && typeof args.route.coverage === "object" ? args.route.coverage as JsonRecord : {};
  const agentProfile = args.route.agentProfile && typeof args.route.agentProfile === "object"
    ? args.route.agentProfile as JsonRecord
    : {};
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
      workflowKey: typeof args.route.workflowKey === "string" ? args.route.workflowKey : null,
      agentProfile: {
        model: normalizeModelIdentifier(agentProfile.model),
        reasoningEffort: typeof agentProfile.reasoningEffort === "string" ? agentProfile.reasoningEffort : "unknown",
      },
      contextUsed: args.route.contextUsed === true,
      contextCharacters: typeof args.route.contextCharacters === "number" ? args.route.contextCharacters : 0,
      workflows: Array.isArray(args.route.workflows) ? args.route.workflows : [],
      activeSkills: routeSkills(args.route.activeSkills),
      deferredSkills: routeSkills(args.route.deferredSkills),
      loadOrder: Array.isArray(args.route.loadOrder) ? args.route.loadOrder : [],
      deferredLoadOrder: Array.isArray(args.route.deferredLoadOrder) ? args.route.deferredLoadOrder : [],
      intent: boundedRouteIntent(intent),
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
  contentMode?: "selective" | "full";
  coreCharsLoaded?: number;
  moduleCharsLoaded?: number;
  totalCharsLoaded?: number;
  fullSkillChars?: number;
  estimatedCharsSaved?: number;
  selectedModules?: string[];
  manifestStatus?: string;
  budgetExceeded?: boolean;
  skipped?: boolean;
  skippedReason?: string;
  candidateChars?: number;
  ambiguousGroups?: Array<{ group: string; candidates: string[]; score: number }>;
  planningMode?: string;
  allocationTiers?: string[];
  duplicateCharsAvoided?: number;
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
      contentMode: args.contentMode,
      coreCharsLoaded: args.coreCharsLoaded,
      moduleCharsLoaded: args.moduleCharsLoaded,
      totalCharsLoaded: args.totalCharsLoaded,
      fullSkillChars: args.fullSkillChars,
      estimatedCharsSaved: args.estimatedCharsSaved,
      selectedModules: args.selectedModules?.slice(0, 24),
      manifestStatus: args.manifestStatus,
      budgetExceeded: args.budgetExceeded,
      skipped: args.skipped,
      skippedReason: args.skippedReason,
      candidateChars: args.candidateChars,
      ambiguousGroups: args.ambiguousGroups?.slice(0, 8).map((item) => ({
        group: item.group,
        candidates: item.candidates.slice(0, 8),
        score: item.score,
      })),
      planningMode: args.planningMode,
      allocationTiers: args.allocationTiers?.slice(0, 8),
      duplicateCharsAvoided: args.duplicateCharsAvoided,
    },
  });
}

export function recordMssrCheckpoint(args: {
  eventId?: string;
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
  leaseMs?: number;
  dimensions?: Array<{
    name: string;
    status: MssrOutcomeDimensionStatus;
    summary?: string;
    evidenceRef?: string;
  }>;
  status?: "success" | "partial" | "failed" | "skipped";
  completedPhases?: string[];
  contextSources?: MssrContextSource[];
  userCorrections?: number;
  verificationPassed?: boolean;
  persisted?: boolean;
  summary?: string;
  signals?: string[];
  model?: string;
  reasoningEffort?: string;
  externalSource?: string;
  emittedAt?: string;
}): MssrStoredEvent {
  const ok = args.status === undefined ? undefined : args.status === "success";
  const primarySkill = args.primarySkill ?? args.skillName;
  const supportingSkills = [...new Set((args.supportingSkills ?? []).filter((name) => name && name !== primarySkill))].slice(0, 24);
  const score = typeof args.score === "number" && Number.isFinite(args.score)
    ? Math.max(0, Math.min(1, args.score))
    : undefined;
  const leaseMs = args.eventType === "progress"
    ? Math.min(15 * 60_000, Math.max(30_000, Math.floor(args.leaseMs ?? 5 * 60_000)))
    : undefined;
  const dimensions = (args.dimensions ?? []).slice(0, 12).map((item) => ({
    name: redactText(item.name, 80),
    status: item.status,
    summary: item.summary ? redactText(item.summary, 200) : undefined,
    evidenceRef: item.evidenceRef ? redactText(item.evidenceRef, 200) : undefined,
  }));
  return recordMssrEvent({
    eventId: args.eventId,
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
      leaseMs,
      dimensions,
      summary: args.summary ? redactText(args.summary, 300) : undefined,
      signals: args.signals ?? [],
      agentProfile: {
        model: normalizeModelIdentifier(args.model),
        reasoningEffort: args.reasoningEffort ? redactText(args.reasoningEffort, 20) : "unknown",
      },
      externalSource: args.externalSource,
      emittedAt: args.emittedAt,
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

export function readPersistedMssrTraceState(traceId: string): PersistedMssrTraceState | null {
  if (!validTraceId(traceId)) return null;
  const database = getDb();
  if (!database) return null;
  const events = database.prepare(`
    SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
           skill_name, required, ok, task_hash, details_json
    FROM mssr_events
    WHERE trace_id = ?
    ORDER BY occurred_at ASC
    LIMIT 1000
  `).all(traceId).map(decodeRow);
  const routes = events.filter((event) => event.eventType === "route_planned");
  if (routes.length === 0) return null;
  const latestRoute = routes[routes.length - 1];
  const requiredSkills = new Set<string>();
  const selectedSkills = new Set<string>();
  for (const route of routes) {
    const active = Array.isArray(route.details.activeSkills) ? route.details.activeSkills : [];
    for (const item of active) {
      if (!item || typeof item !== "object" || typeof (item as JsonRecord).name !== "string") continue;
      const name = String((item as JsonRecord).name);
      selectedSkills.add(name);
      if ((item as JsonRecord).required === true) requiredSkills.add(name);
    }
  }
  let maintenanceRequired = false;
  let lifecycleRevision = 0;
  let closeRevision = 0;
  let maintenanceRevision = 0;
  for (const event of events) {
    if (event.eventType === "route_planned") {
      const requiredPhases = Array.isArray(event.details.requiredPhases) ? event.details.requiredPhases : [];
      if (requiredPhases.includes("maintenance")) maintenanceRequired = true;
      if (lifecycleRevision === 0) lifecycleRevision = 1;
      else if (event.stage !== "close") lifecycleRevision += 1;
      if (event.stage === "close") closeRevision = lifecycleRevision;
      continue;
    }
    if (event.eventType === "persistence") {
      lifecycleRevision = Math.max(1, lifecycleRevision) + 1;
      continue;
    }
    if (event.eventType === "phase_completed"
      && event.stage === "close"
      && event.ok === true
      && Array.isArray(event.details.completedPhases)
      && event.details.completedPhases.includes("maintenance")
      && closeRevision === lifecycleRevision) {
      maintenanceRevision = lifecycleRevision;
    }
  }
  const loadedSkills = new Set(events
    .filter((event) => event.eventType === "skill_loaded" && event.ok === true && event.skillName)
    .map((event) => String(event.skillName)));
  const latestOutcome = [...events].reverse().find((event) => event.eventType === "outcome");
  const latestEvent = events[events.length - 1];
  const profile = latestRoute.details.agentProfile && typeof latestRoute.details.agentProfile === "object"
    ? latestRoute.details.agentProfile as JsonRecord
    : {};
  let metricContext: JsonRecord = {};
  try {
    metricContext = database.prepare(`
      SELECT session_key, project, workflow_key
      FROM tool_calls
      WHERE trace_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(traceId) ?? {};
  } catch {
    metricContext = {};
  }
  return {
    traceId,
    workflowKey: typeof latestRoute.details.workflowKey === "string"
      ? latestRoute.details.workflowKey
      : typeof metricContext.workflow_key === "string" ? metricContext.workflow_key : "unscoped",
    stage: latestRoute.stage ?? "start",
    taskHash: latestRoute.taskHash ?? "",
    caller: latestRoute.caller ?? "other",
    model: typeof profile.model === "string" ? profile.model : "unknown",
    reasoningEffort: typeof profile.reasoningEffort === "string" ? profile.reasoningEffort : "unknown",
    sessionKey: typeof metricContext.session_key === "string" ? metricContext.session_key : "unknown",
    project: typeof metricContext.project === "string" ? metricContext.project : "unknown",
    requiredSkills: [...requiredSkills].sort(),
    selectedSkills: [...selectedSkills].sort(),
    loadedSkills: [...loadedSkills].sort(),
    routeCount: routes.length,
    closed: Boolean(latestOutcome && Date.parse(latestOutcome.occurredAt) >= Date.parse(latestRoute.occurredAt)),
    maintenanceRequired,
    lifecycleRevision,
    closeRevision,
    maintenanceRevision,
    updatedAt: Date.parse(latestEvent.occurredAt) || Date.now(),
  };
}

export function findPersistedMssrTraceCandidates(args: {
  caller?: string;
  sessionKey?: string;
  project?: string;
  skillName?: string;
  maxAgeMs?: number;
  limit?: number;
}): PersistedMssrTraceState[] {
  const database = getDb();
  if (!database) return [];
  const maxAgeMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1_000, args.maxAgeMs ?? 2 * 60 * 60 * 1_000));
  const limit = Math.max(1, Math.min(32, args.limit ?? 8));
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const caller = typeof args.caller === "string" ? args.caller.trim().toLowerCase() : "";
  const sessionKey = typeof args.sessionKey === "string" ? args.sessionKey.trim().toLowerCase() : "";
  const project = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";
  const skillName = typeof args.skillName === "string" ? args.skillName.trim() : "";
  const rows = database.prepare(`
    SELECT trace_id, MAX(occurred_at) AS latest_route_at
    FROM mssr_events
    WHERE event_type = 'route_planned'
      AND occurred_at >= ?
    GROUP BY trace_id
    ORDER BY latest_route_at DESC
    LIMIT 64
  `).all(since);
  const candidates: PersistedMssrTraceState[] = [];
  for (const row of rows) {
    if (typeof row.trace_id !== "string") continue;
    const state = readPersistedMssrTraceState(row.trace_id);
    if (!state || state.closed || Date.now() - state.updatedAt > maxAgeMs) continue;
    if (caller && caller !== "other" && state.caller !== caller) continue;
    if (sessionKey && sessionKey !== "unknown" && state.sessionKey !== sessionKey) continue;
    if ((!sessionKey || sessionKey === "unknown") && project && project !== "unknown" && state.project !== project) continue;
    if (skillName && (!state.selectedSkills.includes(skillName) || state.loadedSkills.includes(skillName))) continue;
    candidates.push(state);
    if (candidates.length >= limit) break;
  }
  return candidates;
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
function numericDetail(event: MssrStoredEvent, key: string): number {
  const value = event.details[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function summarizeContextAssembly(events: MssrStoredEvent[]) {
  const loads = events.filter((event) => event.eventType === "skill_loaded"
    && (typeof event.details.totalCharsLoaded === "number" || typeof event.details.fullSkillChars === "number"));
  const byTrace = new Map<string, {
    traceId: string;
    latestAt: string;
    loadedChars: number;
    fullChars: number;
    savedChars: number;
    skippedLoads: number;
    overflowLoads: number;
    requiredOverflowLoads: number;
    optionalOverflowLoads: number;
    skippedForBudgetLoads: number;
    duplicateCharsAvoided: number;
    skillNames: Set<string>;
    planningModes: Set<string>;
  }>();
  const bySkill = new Map<string, {
    name: string;
    loads: number;
    selectiveLoads: number;
    fullLoads: number;
    fallbackLoads: number;
    skippedLoads: number;
    overflowLoads: number;
    requiredOverflowLoads: number;
    optionalOverflowLoads: number;
    skippedForBudgetLoads: number;
    coreChars: number;
    loadedChars: number;
    fullChars: number;
    savedChars: number;
    duplicateCharsAvoided: number;
  }>();
  let loadedChars = 0;
  let fullChars = 0;
  let savedChars = 0;
  let fallbackLoads = 0;
  let skippedLoads = 0;
  let overflowLoads = 0;
  let requiredOverflowLoads = 0;
  let optionalOverflowLoads = 0;
  let skippedForBudgetLoads = 0;
  let duplicateCharsAvoided = 0;
  let ambiguousGroups = 0;
  const planningModes: string[] = [];

  for (const event of loads) {
    const loaded = numericDetail(event, "totalCharsLoaded");
    const full = numericDetail(event, "fullSkillChars");
    const saved = numericDetail(event, "estimatedCharsSaved");
    const duplicate = numericDetail(event, "duplicateCharsAvoided");
    const skipped = event.details.skipped === true;
    const overflow = event.details.budgetExceeded === true;
    const skippedForBudget = skipped && event.details.skippedReason === "optional-context-exceeds-budget";
    const requiredOverflow = overflow && event.required === true && !skipped;
    const optionalOverflow = overflow && event.required !== true && !skipped;
    const fallback = event.details.manifestStatus === "missing" || event.details.manifestStatus === "invalid" || event.details.fallbackFull === true;
    const mode = typeof event.details.contentMode === "string" ? event.details.contentMode : "unknown";
    const planner = typeof event.details.planningMode === "string" ? event.details.planningMode : "legacy-sequential";
    const ambiguous = Array.isArray(event.details.ambiguousGroups) ? event.details.ambiguousGroups.length : 0;
    loadedChars += loaded;
    fullChars += full;
    savedChars += saved;
    duplicateCharsAvoided += duplicate;
    if (fallback) fallbackLoads += 1;
    if (skipped) skippedLoads += 1;
    if (overflow) overflowLoads += 1;
    if (requiredOverflow) requiredOverflowLoads += 1;
    if (optionalOverflow) optionalOverflowLoads += 1;
    if (skippedForBudget) skippedForBudgetLoads += 1;
    ambiguousGroups += ambiguous;
    planningModes.push(planner);

    const trace = byTrace.get(event.traceId) ?? {
      traceId: event.traceId,
      latestAt: event.occurredAt,
      loadedChars: 0,
      fullChars: 0,
      savedChars: 0,
      skippedLoads: 0,
      overflowLoads: 0,
      requiredOverflowLoads: 0,
      optionalOverflowLoads: 0,
      skippedForBudgetLoads: 0,
      duplicateCharsAvoided: 0,
      skillNames: new Set<string>(),
      planningModes: new Set<string>(),
    };
    trace.latestAt = event.occurredAt > trace.latestAt ? event.occurredAt : trace.latestAt;
    trace.loadedChars += loaded;
    trace.fullChars += full;
    trace.savedChars += saved;
    trace.skippedLoads += skipped ? 1 : 0;
    trace.overflowLoads += overflow ? 1 : 0;
    trace.requiredOverflowLoads += requiredOverflow ? 1 : 0;
    trace.optionalOverflowLoads += optionalOverflow ? 1 : 0;
    trace.skippedForBudgetLoads += skippedForBudget ? 1 : 0;
    trace.duplicateCharsAvoided += duplicate;
    if (event.skillName) trace.skillNames.add(event.skillName);
    trace.planningModes.add(planner);
    byTrace.set(event.traceId, trace);

    const name = event.skillName || "unknown";
    const skill = bySkill.get(name) ?? {
      name,
      loads: 0,
      selectiveLoads: 0,
      fullLoads: 0,
      fallbackLoads: 0,
      skippedLoads: 0,
      overflowLoads: 0,
      requiredOverflowLoads: 0,
      optionalOverflowLoads: 0,
      skippedForBudgetLoads: 0,
      coreChars: 0,
      loadedChars: 0,
      fullChars: 0,
      savedChars: 0,
      duplicateCharsAvoided: 0,
    };
    skill.loads += 1;
    skill.selectiveLoads += mode === "selective" ? 1 : 0;
    skill.fullLoads += mode === "full" ? 1 : 0;
    skill.fallbackLoads += fallback ? 1 : 0;
    skill.skippedLoads += skipped ? 1 : 0;
    skill.overflowLoads += overflow ? 1 : 0;
    skill.requiredOverflowLoads += requiredOverflow ? 1 : 0;
    skill.optionalOverflowLoads += optionalOverflow ? 1 : 0;
    skill.skippedForBudgetLoads += skippedForBudget ? 1 : 0;
    skill.coreChars += numericDetail(event, "coreCharsLoaded");
    skill.loadedChars += loaded;
    skill.fullChars += full;
    skill.savedChars += saved;
    skill.duplicateCharsAvoided += duplicate;
    bySkill.set(name, skill);
  }

  const skillPressure = [...bySkill.values()].map((skill) => {
    const averageCoreChars = skill.loads > 0 ? Math.round(skill.coreChars / skill.loads) : 0;
    const averageLoadedChars = skill.loads > 0 ? Math.round(skill.loadedChars / skill.loads) : 0;
    const averageFullChars = skill.loads > 0 ? Math.round(skill.fullChars / skill.loads) : 0;
    const savingsRate = rate(skill.savedChars, skill.fullChars);
    const fallbackRate = skill.loads > 0 ? skill.fallbackLoads / skill.loads : 0;
    const retainedRatio = skill.fullChars > 0 ? skill.loadedChars / skill.fullChars : 1;
    const pressureScore = Math.round(skill.loads * Math.max(1, averageFullChars) * Math.max(0.1, fallbackRate + retainedRatio));
    const recommendation = skill.fallbackLoads > 0
      ? "add-context-manifest"
      : averageCoreChars >= 4500 && skill.loads >= 2
        ? "review-core"
        : skill.skippedForBudgetLoads > 0
          ? "review-budget"
          : skill.requiredOverflowLoads > 0
            ? "review-required-context"
            : skill.optionalOverflowLoads > 0
              ? "review-optional-context"
              : "healthy-selective";
    return {
      ...skill,
      averageCoreChars,
      averageLoadedChars,
      averageFullChars,
      savingsRate,
      pressureScore,
      recommendation,
    };
  }).sort((a, b) => b.pressureScore - a.pressureScore || b.loads - a.loads || a.name.localeCompare(b.name));

  return {
    loadEvents: loads.length,
    selectiveLoads: loads.filter((event) => event.details.contentMode === "selective").length,
    fullLoads: loads.filter((event) => event.details.contentMode === "full").length,
    fallbackLoads,
    skippedLoads,
    overflowLoads,
    requiredOverflowLoads,
    optionalOverflowLoads,
    skippedForBudgetLoads,
    ambiguousGroups,
    loadedChars,
    fullChars,
    savedChars,
    savingsRate: rate(savedChars, fullChars),
    duplicateCharsAvoided,
    planningModes: topCounts(planningModes, 8),
    recentTraces: [...byTrace.values()]
      .map((trace) => ({
        traceId: trace.traceId,
        latestAt: trace.latestAt,
        loadedChars: trace.loadedChars,
        fullChars: trace.fullChars,
        savedChars: trace.savedChars,
        savingsRate: rate(trace.savedChars, trace.fullChars),
        skippedLoads: trace.skippedLoads,
        overflowLoads: trace.overflowLoads,
        requiredOverflowLoads: trace.requiredOverflowLoads,
        optionalOverflowLoads: trace.optionalOverflowLoads,
        skippedForBudgetLoads: trace.skippedForBudgetLoads,
        duplicateCharsAvoided: trace.duplicateCharsAvoided,
        skills: trace.skillNames.size,
        planningModes: [...trace.planningModes],
      }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
      .slice(0, 12),
    skillPressure: skillPressure.slice(0, 20),
  };
}



function observatoryStatus() {
  const database = getDb();
  const epoch = getMssrObservabilityEpoch();
  const totals = database?.prepare(`
    SELECT COUNT(*) AS events, COUNT(DISTINCT trace_id) AS traces, MAX(occurred_at) AS latest
    FROM mssr_events
    WHERE trace_id NOT LIKE '__test_%'
  `).get() ?? { events: 0, traces: 0, latest: null };
  const activeEvents = database?.prepare(`
    SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
           skill_name, required, ok, task_hash, details_json
    FROM mssr_events
    WHERE occurred_at >= ? AND trace_id NOT LIKE '__test_%'
    ORDER BY occurred_at ASC
  `).all(epoch.baselineAt).map(decodeRow)
    .filter((event) => event.details.observabilityEpoch === epoch.activeEpoch) ?? [];
  const activeTotals = {
    events: activeEvents.length,
    traces: new Set(activeEvents.map((event) => event.traceId)).size,
    latest: activeEvents.at(-1)?.occurredAt ?? null,
  };
  return {
    enabled: observatoryEnabled,
    sqliteAvailable: Boolean(database),
    sqlitePath,
    jsonlPath,
    observability: {
      defaultScope: "active",
      contractVersion: epoch.contractVersion,
      activeEpoch: epoch.activeEpoch,
      baselineAt: epoch.baselineAt,
      legacyScope: epoch.legacyScope,
      statePath: mssrObservabilityStatePath,
    },
    privacy: {
      rawPromptsStored: false,
      transcriptsStored: false,
      taskStorage: "sha256 fingerprint only",
      details: "bounded structured metadata with sensitive-key filtering",
    },
    totals,
    activeTotals,
  };
}

function portableIntentAnalysis(events: readonly MssrStoredEvent[]) {
  const projected = events.flatMap<unknown>((event) => {
    if (event.eventType === "route_planned") {
      const profile = event.details.agentProfile && typeof event.details.agentProfile === "object"
        ? event.details.agentProfile as JsonRecord
        : {};
      return [{
        protocolVersion: "mssr-telemetry-v1",
        eventId: `analysis:${event.id}`,
        emittedAt: event.occurredAt,
        source: "mauroprime-bridge",
        traceId: event.traceId,
        caller: ["codex-local", "opencode-local", "chatgpt-web", "other"].includes(event.caller ?? "") ? event.caller : "other",
        event: {
          kind: "route",
          action: event.details.action === "bootstrap" ? "bootstrap" : "plan",
          taskHash: typeof event.taskHash === "string" && /^[a-f0-9]{64}$/.test(event.taskHash)
            ? event.taskHash
            : "0".repeat(64),
          route: {
            caller: ["codex-local", "opencode-local", "chatgpt-web", "other"].includes(event.caller ?? "") ? event.caller : "other",
            stage: event.stage,
            classificationMode: event.classificationMode ?? "unknown",
            workflowKey: typeof event.details.workflowKey === "string" ? event.details.workflowKey : null,
            agentProfile: {
              model: typeof profile.model === "string" ? profile.model : "unknown",
              reasoningEffort: typeof profile.reasoningEffort === "string" ? profile.reasoningEffort : "unknown",
            },
            contextUsed: event.details.contextUsed === true,
            contextCharacters: typeof event.details.contextCharacters === "number" ? event.details.contextCharacters : 0,
            workflows: Array.isArray(event.details.workflows) ? event.details.workflows : [],
            activeSkills: Array.isArray(event.details.activeSkills) ? event.details.activeSkills : [],
            deferredSkills: Array.isArray(event.details.deferredSkills) ? event.details.deferredSkills : [],
            loadOrder: Array.isArray(event.details.loadOrder) ? event.details.loadOrder : [],
            deferredLoadOrder: Array.isArray(event.details.deferredLoadOrder) ? event.details.deferredLoadOrder : [],
            intent: event.details.intent,
            signals: Array.isArray(event.details.signals) ? event.details.signals : [],
            ambiguity: typeof event.details.ambiguity === "string" ? event.details.ambiguity : undefined,
            requiredPhases: Array.isArray(event.details.requiredPhases) ? event.details.requiredPhases : [],
            completedPhases: Array.isArray(event.details.completedPhases) ? event.details.completedPhases : [],
            missingRequiredPhases: Array.isArray(event.details.missingRequiredPhases) ? event.details.missingRequiredPhases : [],
          },
        },
      }];
    }
    if (event.eventType === "skill_loaded" && event.skillName) {
      return [{
        protocolVersion: "mssr-telemetry-v1",
        eventId: `analysis:${event.id}`,
        emittedAt: event.occurredAt,
        source: "mauroprime-bridge",
        traceId: event.traceId,
        caller: ["codex-local", "opencode-local", "chatgpt-web", "other"].includes(event.caller ?? "") ? event.caller : "other",
        event: {
          kind: "skill_load",
          skillName: event.skillName,
          source: typeof event.details.source === "string" ? event.details.source : undefined,
          stage: event.stage,
          required: event.required,
          loaded: event.ok === true,
          via: event.details.via === "skill_bootstrap" ? "skill_bootstrap" : "skill_load",
        },
      }];
    }
    return [];
  });
  const analysis = analyzeMssrTelemetry(projected);
  return {
    analyzedEvents: analysis.counters.validEvents,
    invalidProjectionEvents: analysis.counters.invalidEvents,
    intentDimensions: analysis.intentDimensions,
    maintenanceCandidates: analysis.maintenanceCandidates,
  };
}

function summary(days: number, scope: MssrObservatoryScope) {
  const database = getDb();
  const epoch = getMssrObservabilityEpoch();
  if (!database) return { ...observatoryStatus(), scope, days, benchmark: null, top: {} };
  const windowSince = new Date(Date.now() - days * 86_400_000).toISOString();
  const since = scope === "active" && epoch.baselineAt > windowSince ? epoch.baselineAt : windowSince;
  const decoded = database.prepare(`
    SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
           skill_name, required, ok, task_hash, details_json
    FROM mssr_events
    WHERE occurred_at >= ? AND trace_id NOT LIKE '__test_%'
    ORDER BY occurred_at ASC
  `).all(since).map(decodeRow);
  const events = scope === "active"
    ? decoded.filter((event) => event.details.observabilityEpoch === epoch.activeEpoch)
    : decoded;
  const intentAnalysis = portableIntentAnalysis(events);
  const decodedToolCalls = database.prepare(`
    SELECT trace_id, started_at, ended_at, duration_ms, tool, operation_subject,
           observability_epoch, ok, caller, client_name, session_key,
           model, reasoning_effort, host_agent, host_variant, host_parent_session_key
    FROM tool_calls
    WHERE started_at >= ? AND trace_id IS NOT NULL AND trace_id <> ''
      AND trace_id NOT LIKE '__test_%'
    ORDER BY started_at ASC
  `).all(since);
  const toolCalls = scope === "active"
    ? decodedToolCalls.filter((row) => row.observability_epoch === epoch.activeEpoch)
    : decodedToolCalls;

  const byTrace = new Map<string, MssrStoredEvent[]>();
  for (const event of events) {
    const trace = byTrace.get(event.traceId) ?? [];
    trace.push(event);
    byTrace.set(event.traceId, trace);
  }
  const toolCallsByTrace = new Map<string, JsonRecord[]>();
  for (const row of toolCalls) {
    const traceId = typeof row.trace_id === "string" ? row.trace_id : "";
    if (!traceId) continue;
    const traceCalls = toolCallsByTrace.get(traceId) ?? [];
    traceCalls.push(row);
    toolCallsByTrace.set(traceId, traceCalls);
  }
  type TraceHostIdentity = {
    state: "not-observed" | "single" | "mixed";
    model: string;
    reasoningEffort: string;
    hostAgent: string;
    hostVariant: string;
    sessionKeys: string[];
    parentSessionKeys: string[];
  };
  const usable = (value: unknown): string | undefined => (
    typeof value === "string" && value && value !== "unknown" ? value : undefined
  );
  const hostIdentityByTrace = new Map<string, TraceHostIdentity>();
  for (const [traceId, calls] of toolCallsByTrace) {
    // Only the authenticated OpenCode plugin exposes these fields.  Rows that
    // merely share a trace do not become host evidence by association alone.
    const observed = calls.filter((call) => call.client_name === "opencode-cli");
    if (!observed.length) continue;
    const identities = new Map<string, Omit<TraceHostIdentity, "state" | "sessionKeys" | "parentSessionKeys">>();
    const sessionKeys = new Set<string>();
    const parentSessionKeys = new Set<string>();
    for (const call of observed) {
      const identity = {
        model: normalizeModelIdentifier(call.model),
        reasoningEffort: usable(call.reasoning_effort) ?? "unknown",
        hostAgent: usable(call.host_agent) ?? "unknown",
        hostVariant: usable(call.host_variant) ?? "unknown",
      };
      identities.set(JSON.stringify(identity), identity);
      const sessionKey = usable(call.session_key);
      if (sessionKey) sessionKeys.add(sessionKey);
      const parentSessionKey = usable(call.host_parent_session_key);
      if (parentSessionKey) parentSessionKeys.add(parentSessionKey);
    }
    if (identities.size === 1) {
      const identity = [...identities.values()][0];
      hostIdentityByTrace.set(traceId, {
        state: "single", ...identity,
        sessionKeys: [...sessionKeys].sort(),
        parentSessionKeys: [...parentSessionKeys].sort(),
      });
    } else {
      // A single lifecycle result may legitimately span an agent handoff. Keep
      // that ambiguity visible rather than choosing the newest host call.
      hostIdentityByTrace.set(traceId, {
        state: "mixed",
        model: "multiple-observed",
        reasoningEffort: "multiple-observed",
        hostAgent: "multiple-observed",
        hostVariant: "multiple-observed",
        sessionKeys: [...sessionKeys].sort(),
        parentSessionKeys: [...parentSessionKeys].sort(),
      });
    }
  }
  const lifecycleProfile = (route: MssrStoredEvent) => {
    const explicit = route.details.agentProfile && typeof route.details.agentProfile === "object"
      ? route.details.agentProfile as JsonRecord
      : {};
    const observed = hostIdentityByTrace.get(route.traceId);
    if (observed?.state === "single") {
      return {
        caller: route.caller || "other",
        model: observed.model,
        reasoningEffort: observed.reasoningEffort,
        hostAgent: observed.hostAgent,
        hostVariant: observed.hostVariant,
        identitySource: "trace-correlated-host",
        observedSessionCount: observed.sessionKeys.length,
        observedParentSessionCount: observed.parentSessionKeys.length,
      };
    }
    if (observed?.state === "mixed") {
      return {
        caller: route.caller || "other",
        model: "multiple-observed",
        reasoningEffort: "multiple-observed",
        hostAgent: "multiple-observed",
        hostVariant: "multiple-observed",
        identitySource: "trace-host-mixed",
        observedSessionCount: observed.sessionKeys.length,
        observedParentSessionCount: observed.parentSessionKeys.length,
      };
    }
    return {
      caller: route.caller || "other",
      model: normalizeModelIdentifier(explicit.model),
      reasoningEffort: typeof explicit.reasoningEffort === "string" ? explicit.reasoningEffort : "unknown",
      hostAgent: "unknown",
      hostVariant: "unknown",
      identitySource: "lifecycle-only",
      observedSessionCount: 0,
      observedParentSessionCount: 0,
    };
  };
  const effectiveToolName = (row: JsonRecord): string => {
    const outer = typeof row.tool === "string" ? row.tool : "unknown";
    return (outer === DELEGATED_QUERY_TOOL || outer === DELEGATED_ACTION_TOOL)
      && typeof row.operation_subject === "string"
      && row.operation_subject
      ? row.operation_subject
      : outer;
  };
  const executionMetrics = (traceIds: Set<string>, profileRoutes: MssrStoredEvent[]) => {
    let bridgeDirectToolCalls = 0;
    let hostObservedToolCalls = 0;
    let delegatedQueryCalls = 0;
    let delegatedActionCalls = 0;
    let discoveryDetours = 0;
    const firstActionDelays: number[] = [];
    const toolSpans: number[] = [];
    for (const traceId of traceIds) {
      const calls = toolCallsByTrace.get(traceId) ?? [];
      for (const call of calls) {
        if (call.client_name === "opencode-cli") hostObservedToolCalls += 1;
        else if (call.tool === DELEGATED_QUERY_TOOL) delegatedQueryCalls += 1;
        else if (call.tool === DELEGATED_ACTION_TOOL) delegatedActionCalls += 1;
        else bridgeDirectToolCalls += 1;
      }
      const firstRoute = profileRoutes.find((route) => route.traceId === traceId);
      const substantive = calls.filter((call) => !PREPARATION_TOOLS.has(effectiveToolName(call)));
      const firstAction = substantive[0];
      if (firstRoute && firstAction && typeof firstAction.started_at === "string") {
        const delay = Date.parse(firstAction.started_at) - Date.parse(firstRoute.occurredAt);
        if (Number.isFinite(delay) && delay >= 0) firstActionDelays.push(delay);
      }
      if (firstAction) {
        const firstStarted = typeof firstAction.started_at === "string" ? Date.parse(firstAction.started_at) : NaN;
        const last = substantive.at(-1);
        const lastEnded = typeof last?.ended_at === "string"
          ? Date.parse(last.ended_at)
          : typeof last?.started_at === "string"
            ? Date.parse(last.started_at) + Number(last.duration_ms ?? 0)
            : NaN;
        if (Number.isFinite(firstStarted) && Number.isFinite(lastEnded) && lastEnded >= firstStarted) {
          toolSpans.push(lastEnded - firstStarted);
        }
        const firstActionAt = typeof firstAction.started_at === "string" ? firstAction.started_at : "";
        discoveryDetours += calls.filter((call) => (
          PREPARATION_TOOLS.has(effectiveToolName(call))
          && typeof call.started_at === "string"
          && call.started_at <= firstActionAt
        )).length;
      } else {
        discoveryDetours += calls.filter((call) => PREPARATION_TOOLS.has(effectiveToolName(call))).length;
      }
    }
    const delegatedCalls = delegatedQueryCalls + delegatedActionCalls;
    const physicalCalls = bridgeDirectToolCalls + hostObservedToolCalls + delegatedCalls;
    return {
      // Compatibility alias: direct means Bridge-executed and excludes host
      // telemetry. Lifecycle rows live in mssr_events and are never counted.
      directToolCalls: bridgeDirectToolCalls,
      bridgeDirectToolCalls,
      hostObservedToolCalls,
      physicalToolCalls: physicalCalls,
      delegatedQueryCalls,
      delegatedActionCalls,
      delegatedToolCalls: delegatedCalls,
      delegatedCallRate: rate(delegatedCalls, physicalCalls),
      discoveryDetours,
      averageDiscoveryDetours: traceIds.size > 0
        ? Math.round((discoveryDetours / traceIds.size) * 100) / 100
        : null,
      tracesWithFirstAction: firstActionDelays.length,
      averageFirstActionMs: firstActionDelays.length > 0
        ? Math.round(firstActionDelays.reduce((total, value) => total + value, 0) / firstActionDelays.length)
        : null,
      averageToolSpanMs: toolSpans.length > 0
        ? Math.round(toolSpans.reduce((total, value) => total + value, 0) / toolSpans.length)
        : null,
    };
  };

  const routes = events.filter((event) => event.eventType === "route_planned");
  const loads = events.filter((event) => event.eventType === "skill_loaded");
  const successfulLoads = loads.filter((event) => event.ok === true);
  const contextAssembly = summarizeContextAssembly(events);
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
  const closureReminderEvents = events.filter((event) => event.eventType === "closure_reminder");
  const intentNormalizedEvents = events.filter((event) => event.eventType === "intent_normalized");
  const intentCorrectionEvents = events.filter((event) => event.eventType === "intent_correction_required");
  const intentCorrectionTraceIds = new Set(intentCorrectionEvents.map((event) => event.traceId));
  const intentCorrectionRecoveredTraceIds = new Set(intentCorrectionEvents.flatMap((correction) => (
    routes.some((route) => route.traceId === correction.traceId && route.occurredAt > correction.occurredAt)
      ? [correction.traceId]
      : []
  )));
  const normalizedAliasIds = intentNormalizedEvents.flatMap((event) => (
    Array.isArray(event.details.aliasIds)
      ? event.details.aliasIds.filter((item): item is string => typeof item === "string")
      : []
  ));
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
  const surfaceNames = new Set(
    [...routes, ...outcomeEvents, ...closureReminderEvents, ...intentNormalizedEvents, ...intentCorrectionEvents]
      .map((event) => event.caller || "other"),
  );
  const surfaceBenchmarks = [...surfaceNames]
    .map((caller) => {
      const surfaceRouteTraces = new Set(routes.filter((event) => (event.caller || "other") === caller).map((event) => event.traceId));
      const surfaceOutcomeTraces = new Set(latestOutcomes.filter((event) => (event.caller || "other") === caller).map((event) => event.traceId));
      const surfaceReminderTraces = new Set(closureReminderEvents.filter((event) => (event.caller || "other") === caller).map((event) => event.traceId));
      const surfaceIntentNormalized = intentNormalizedEvents.filter((event) => (event.caller || "other") === caller);
      const surfaceIntentCorrections = intentCorrectionEvents.filter((event) => (event.caller || "other") === caller);
      const surfaceCorrectionTraceIds = new Set(surfaceIntentCorrections.map((event) => event.traceId));
      return {
        caller,
        routedTraces: surfaceRouteTraces.size,
        outcomeTraces: surfaceOutcomeTraces.size,
        outcomeCoverage: rate(surfaceOutcomeTraces.size, surfaceRouteTraces.size),
        closureReminderEvents: closureReminderEvents.filter((event) => (event.caller || "other") === caller).length,
        closureReminderTraces: surfaceReminderTraces.size,
        closureReminderRate: rate(surfaceReminderTraces.size, surfaceRouteTraces.size),
        intentNormalizedEvents: surfaceIntentNormalized.length,
        intentCorrectionRequiredEvents: surfaceIntentCorrections.length,
        intentCorrectionRecoveredTraces: [...surfaceCorrectionTraceIds].filter((traceId) => intentCorrectionRecoveredTraceIds.has(traceId)).length,
        intentCorrectionRecoveryRate: rate(
          [...surfaceCorrectionTraceIds].filter((traceId) => intentCorrectionRecoveredTraceIds.has(traceId)).length,
          surfaceCorrectionTraceIds.size,
        ),
      };
    })
    .sort((a, b) => b.routedTraces - a.routedTraces || a.caller.localeCompare(b.caller));
  const profileKeys = new Set(routes.map((event) => {
    const profile = lifecycleProfile(event);
    return JSON.stringify([
      profile.caller,
      profile.model,
      profile.reasoningEffort,
      profile.hostAgent,
      profile.hostVariant,
      profile.identitySource,
    ]);
  }));
  const agentProfiles = [...profileKeys].map((key) => {
    const [caller, model, reasoningEffort, hostAgent, hostVariant, identitySource] = JSON.parse(key) as [string, string, string, string, string, string];
    const profileRoutes = routes.filter((event) => {
      const profile = lifecycleProfile(event);
      return profile.caller === caller
        && profile.model === model
        && profile.reasoningEffort === reasoningEffort
        && profile.hostAgent === hostAgent
        && profile.hostVariant === hostVariant
        && profile.identitySource === identitySource;
    });
    const profileTraceIds = new Set(profileRoutes.map((event) => event.traceId));
    const observedSessionKeys = new Set(profileRoutes.flatMap((event) => (
      hostIdentityByTrace.get(event.traceId)?.sessionKeys ?? []
    )));
    const observedParentSessionKeys = new Set(profileRoutes.flatMap((event) => (
      hostIdentityByTrace.get(event.traceId)?.parentSessionKeys ?? []
    )));
    const profileLoads = successfulLoads.filter((event) => profileTraceIds.has(event.traceId));
    const profileTraceIdsWithLoads = new Set(profileLoads.map((event) => event.traceId));
    const profileRequired = new Set<string>();
    for (const route of profileRoutes) {
      const active = Array.isArray(route.details.activeSkills) ? route.details.activeSkills : [];
      for (const item of active) {
        if (!item || typeof item !== "object" || typeof (item as JsonRecord).name !== "string") continue;
        if ((item as JsonRecord).required === true) {
          profileRequired.add(`${route.traceId}\u0000${String((item as JsonRecord).name)}`);
        }
      }
    }
    const profileLoadedKeys = new Set(profileLoads
      .filter((event) => event.skillName)
      .map((event) => `${event.traceId}\u0000${event.skillName}`));
    const profileRequiredSatisfied = [...profileRequired].filter((item) => profileLoadedKeys.has(item)).length;
    const profileOutcomeTraces = new Set(latestOutcomes.filter((event) => profileTraceIds.has(event.traceId)).map((event) => event.traceId));
    const profilePrimaryOutcomes = primaryOutcomeEvents.filter((event) => profileTraceIds.has(event.traceId));
    const profileSuccessfulOutcomes = profilePrimaryOutcomes.filter((event) => event.details.status === "success" || event.ok === true);
    const profileMeasuredOutcomes = profilePrimaryOutcomes.filter((event) => typeof event.details.accepted === "boolean");
    const profileAcceptedOutcomes = profileMeasuredOutcomes.filter((event) => event.details.accepted === true);
    const profileScoredOutcomes = profilePrimaryOutcomes.filter((event) => typeof event.details.score === "number");
    const profileReminderEvents = closureReminderEvents.filter((event) => profileTraceIds.has(event.traceId));
    const profileEvents = events.filter((event) => profileTraceIds.has(event.traceId));
    const completionDurations = latestOutcomes.flatMap((outcome) => {
      if (!profileTraceIds.has(outcome.traceId)) return [];
      const firstRoute = profileRoutes.find((route) => route.traceId === outcome.traceId);
      if (!firstRoute) return [];
      const duration = Date.parse(outcome.occurredAt) - Date.parse(firstRoute.occurredAt);
      return Number.isFinite(duration) && duration >= 0 ? [duration] : [];
    });
    const profileExecution = executionMetrics(profileTraceIds, profileRoutes);
    const reminderIdleValues = profileReminderEvents.flatMap((event) => (
      typeof event.details.idleMs === "number" ? [event.details.idleMs] : []
    ));
    return {
      caller,
      model,
      reasoningEffort,
      hostAgent,
      hostVariant,
      identitySource,
      observedSessionCount: observedSessionKeys.size,
      observedParentSessionCount: observedParentSessionKeys.size,
      routedTraces: profileTraceIds.size,
      routeEvents: profileRoutes.length,
      structuredRouteRate: rate(profileRoutes.filter((event) => event.classificationMode === "structured-semantic").length, profileRoutes.length),
      routeLoadCoverage: rate([...profileTraceIds].filter((traceId) => profileTraceIdsWithLoads.has(traceId)).length, profileTraceIds.size),
      requiredSkillLoadsExpected: profileRequired.size,
      requiredSkillLoadsSatisfied: profileRequiredSatisfied,
      requiredLoadCompliance: rate(profileRequiredSatisfied, profileRequired.size),
      verificationCoverage: rate([...profileTraceIds].filter((traceId) => verificationTraces.has(traceId)).length, profileTraceIds.size),
      persistenceCoverage: rate([...profileTraceIds].filter((traceId) => persistenceTraces.has(traceId)).length, profileTraceIds.size),
      outcomeTraces: profileOutcomeTraces.size,
      outcomeCoverage: rate(profileOutcomeTraces.size, profileTraceIds.size),
      outcomeSuccessRate: rate(profileSuccessfulOutcomes.length, profilePrimaryOutcomes.length),
      outcomeAcceptanceRate: rate(profileAcceptedOutcomes.length, profileMeasuredOutcomes.length),
      averageOutcomeScore: profileScoredOutcomes.length > 0
        ? Math.round((profileScoredOutcomes.reduce((total, event) => total + Number(event.details.score), 0) / profileScoredOutcomes.length) * 10_000) / 10_000
        : null,
      averageCompletionMs: completionDurations.length > 0
        ? Math.round(completionDurations.reduce((total, duration) => total + duration, 0) / completionDurations.length)
        : null,
      replannedTraces: [...profileTraceIds].filter((traceId) => profileRoutes.filter((event) => event.traceId === traceId).length > 1).length,
      closureReminderEvents: profileReminderEvents.length,
      closureReminderRate: rate(new Set(profileReminderEvents.map((event) => event.traceId)).size, profileTraceIds.size),
      averageReminderIdleMs: reminderIdleValues.length > 0
        ? Math.round(reminderIdleValues.reduce((total, value) => total + value, 0) / reminderIdleValues.length)
        : null,
      userCorrections: profileEvents.reduce((total, event) => total + (typeof event.details.userCorrections === "number" ? event.details.userCorrections : 0), 0),
      ...profileExecution,
    };
  }).sort((a, b) => b.routedTraces - a.routedTraces
    || a.caller.localeCompare(b.caller)
    || a.model.localeCompare(b.model)
    || a.reasoningEffort.localeCompare(b.reasoningEffort)
    || a.hostAgent.localeCompare(b.hostAgent));

  type ReasoningEffortBucket = "low" | "high" | "other" | "unknown" | "multiple-observed";
  const reasoningEffortBuckets: ReasoningEffortBucket[] = ["low", "high", "other", "unknown", "multiple-observed"];
  const reasoningEffortBucketOf = (value: string): ReasoningEffortBucket => {
    if (value === "low" || value === "high" || value === "multiple-observed") return value;
    if (value === "unknown") return "unknown";
    return "other";
  };
  // Canonical per-trace assignment so a trace with multiple route events
  // (replans) lands in exactly one bucket. Host-correlated identities are
  // authoritative and already consistent across a trace (single/mixed); a
  // lifecycle-only trace resolves to its last route event deterministically by
  // existing event order (occurred_at ASC).
  const canonicalBucketByTrace = new Map<string, ReasoningEffortBucket>();
  const canonicalRouteByTrace = new Map<string, MssrStoredEvent>();
  for (const traceId of traceIdsWithRoutes) {
    const traceRoutes = routes.filter((route) => route.traceId === traceId);
    const lastRoute = traceRoutes[traceRoutes.length - 1];
    const host = hostIdentityByTrace.get(traceId);
    const explicitProfile = lastRoute.details.agentProfile && typeof lastRoute.details.agentProfile === "object"
      ? lastRoute.details.agentProfile as JsonRecord
      : {};
    const effort = host && host.state !== "not-observed"
      ? lifecycleProfile(lastRoute).reasoningEffort
      : typeof explicitProfile.reasoningEffort === "string"
        ? String(explicitProfile.reasoningEffort)
        : "unknown";
    canonicalBucketByTrace.set(traceId, reasoningEffortBucketOf(effort));
    canonicalRouteByTrace.set(traceId, lastRoute);
  }
  const reasoningEffortComparison = reasoningEffortBuckets.map((bucket) => {
    const bucketTraceIds = new Set(
      [...canonicalBucketByTrace.entries()]
        .filter(([, assigned]) => assigned === bucket)
        .map(([traceId]) => traceId),
    );
    const bucketRoutes = routes.filter((route) => bucketTraceIds.has(route.traceId));
    const bucketExecution = executionMetrics(bucketTraceIds, bucketRoutes);
    const bucketTracesWithLoads = new Set(successfulLoads.filter((event) => bucketTraceIds.has(event.traceId)).map((event) => event.traceId));
    const bucketPrimaryOutcomes = primaryOutcomeEvents.filter((event) => bucketTraceIds.has(event.traceId));
    const bucketSuccessfulOutcomes = bucketPrimaryOutcomes.filter((event) => event.details.status === "success" || event.ok === true);
    const bucketOutcomeTraces = new Set(bucketPrimaryOutcomes.map((event) => event.traceId));
    const identitySources = new Map<string, number>();
    for (const traceId of bucketTraceIds) {
      const route = canonicalRouteByTrace.get(traceId);
      const source = route ? lifecycleProfile(route).identitySource : "lifecycle-only";
      identitySources.set(source, (identitySources.get(source) ?? 0) + 1);
    }
    return {
      bucket,
      traces: bucketTraceIds.size,
      routeEvents: bucketRoutes.length,
      identitySources: Object.fromEntries([...identitySources.entries()].sort()),
      physicalToolCalls: bucketExecution.physicalToolCalls,
      bridgeDirectToolCalls: bucketExecution.bridgeDirectToolCalls,
      hostObservedToolCalls: bucketExecution.hostObservedToolCalls,
      delegatedToolCalls: bucketExecution.delegatedToolCalls,
      delegatedQueryCalls: bucketExecution.delegatedQueryCalls,
      delegatedActionCalls: bucketExecution.delegatedActionCalls,
      delegatedCallRate: rate(bucketExecution.delegatedToolCalls, bucketExecution.physicalToolCalls),
      discoveryDetours: bucketExecution.discoveryDetours,
      averageDiscoveryDetoursPerTrace: bucketExecution.averageDiscoveryDetours,
      routeLoadCoverage: rate([...bucketTraceIds].filter((traceId) => bucketTracesWithLoads.has(traceId)).length, bucketTraceIds.size),
      verificationCoverage: rate([...bucketTraceIds].filter((traceId) => verificationTraces.has(traceId)).length, bucketTraceIds.size),
      persistenceCoverage: rate([...bucketTraceIds].filter((traceId) => persistenceTraces.has(traceId)).length, bucketTraceIds.size),
      outcomeCoverage: rate(bucketOutcomeTraces.size, bucketTraceIds.size),
      outcomeSuccessRate: rate(bucketSuccessfulOutcomes.length, bucketPrimaryOutcomes.length),
    };
  });

  const overallExecution = executionMetrics(traceIdsWithRoutes, routes);
  return {
    ...observatoryStatus(),
    scope,
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
      skillLoadCoverage: rate(routeTracesWithLoads, traceIdsWithRoutes.size),
      correlatedRouteLoadCoverage: rate(routeTracesWithLoads, traceIdsWithRoutes.size),
      requiredSkillLoadsExpected: expectedRequired.size,
      requiredSkillLoadsSatisfied: satisfiedRequired,
      requiredLoadCompliance: rate(satisfiedRequired, expectedRequired.size),
      loadEvents: loads.length,
      successfulLoadEvents: successfulLoads.length,
      orphanLoadEvents: orphanLoads,
      orphanLoadRate: rate(orphanLoads, loads.length),
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
      closureReminderEvents: closureReminderEvents.length,
      closureReminderTraces: new Set(closureReminderEvents.map((event) => event.traceId)).size,
      ...overallExecution,
      intentNormalizedEvents: intentNormalizedEvents.length,
      intentCorrectionRequiredEvents: intentCorrectionEvents.length,
      intentCorrectionTraces: intentCorrectionTraceIds.size,
      intentCorrectionRecoveredTraces: intentCorrectionRecoveredTraceIds.size,
      intentCorrectionRecoveryRate: rate(intentCorrectionRecoveredTraceIds.size, intentCorrectionTraceIds.size),
      userCorrections,
    },
    intentAnalysis,
    contextAssembly,
    surfaces: surfaceBenchmarks,
    agentProfiles,
    reasoningEffortComparison,
    top: {
      selectedSkills: topCounts(selectedSkillNames),
      loadedSkills: topCounts(successfulLoads.flatMap((event) => event.skillName ? [event.skillName] : [])),
      skillOutcomes,
      outcomeSupportingSkills: topCounts(outcomeSupportingSkills),
      callers: topCounts(routes.flatMap((event) => event.caller ? [event.caller] : [])),
      stages: topCounts(routes.flatMap((event) => event.stage ? [event.stage] : [])),
      contextSources: topCounts(contextSources),
      normalizedIntentAliases: topCounts(normalizedAliasIds),
    },
  };
}

export function queryMssrObservatory(args: {
  kind?: "status" | "summary" | "benchmark" | "recent" | "trace";
  traceId?: string;
  days?: number;
  limit?: number;
  scope?: MssrObservatoryScope;
}) {
  const kind = args.kind ?? "summary";
  const days = Math.max(1, Math.min(365, Math.trunc(args.days ?? 30)));
  const limit = Math.max(1, Math.min(200, Math.trunc(args.limit ?? 50)));
  const scope: MssrObservatoryScope = args.scope === "all" ? "all" : "active";
  const epoch = getMssrObservabilityEpoch();
  if (kind === "status") return { ...observatoryStatus(), scope };
  if (kind === "summary" || kind === "benchmark") return summary(days, scope);
  const database = getDb();
  if (!database) return { ...observatoryStatus(), scope, [kind]: [] };
  if (kind === "trace") {
    if (!args.traceId || !validTraceId(args.traceId)) throw new Error("traceId is required for kind=trace and must contain only letters, numbers, dot, underscore, colon, or hyphen.");
    const decoded = database.prepare(`
      SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
             skill_name, required, ok, task_hash, details_json
      FROM mssr_events WHERE trace_id = ? ORDER BY occurred_at ASC LIMIT ?
    `).all(args.traceId, limit).map(decodeRow);
    const trace = scope === "active"
      ? decoded.filter((event) => event.details.observabilityEpoch === epoch.activeEpoch)
      : decoded;
    return { ...observatoryStatus(), scope, traceId: args.traceId, trace };
  }
  const decoded = database.prepare(`
    SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
           skill_name, required, ok, task_hash, details_json
    FROM mssr_events
    WHERE trace_id NOT LIKE '__test_%'
    ORDER BY occurred_at DESC LIMIT ?
  `).all(scope === "active" ? Math.min(1_000, limit * 10) : limit).map(decodeRow);
  const recent = (scope === "active"
    ? decoded.filter((event) => event.details.observabilityEpoch === epoch.activeEpoch)
    : decoded).slice(0, limit);
  return { ...observatoryStatus(), scope, recent };
}
export function getMssrTraceEvidence(traceId: string, limit = 500) {
  if (!validTraceId(traceId)) {
    throw new Error("traceId must contain only letters, numbers, dot, underscore, colon, or hyphen.");
  }
  const boundedLimit = Math.max(1, Math.min(2_000, Math.trunc(limit)));
  const database = getDb();
  const events = database
    ? database.prepare(`
        SELECT id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
               skill_name, required, ok, task_hash, details_json
        FROM mssr_events
        WHERE trace_id = ?
        ORDER BY occurred_at ASC
        LIMIT ?
      `).all(traceId, boundedLimit).map(decodeRow)
    : [];
  const state = readPersistedMssrTraceState(traceId);
  const toolEvidence = getTraceToolEvidence(traceId, boundedLimit);
  const latest = (type: string) => [...events].reverse().find((event) => event.eventType === type) ?? null;
  const latestRoute = latest("route_planned");
  const latestOutcome = latest("outcome");
  const latestVerification = latest("verification");
  const latestPersistence = latest("persistence");
  const latestReminder = [...events].reverse().find((event) => event.eventType.includes("reminder") || event.eventType.includes("idle")) ?? null;
  const missingRequiredSkills = state
    ? state.requiredSkills.filter((skill) => !state.loadedSkills.includes(skill))
    : [];
  const outcomeStatus = latestOutcome && typeof latestOutcome.details.status === "string"
    ? latestOutcome.details.status
    : null;
  const closureStatus = !latestRoute
    ? "trace-not-found"
    : latestOutcome && Date.parse(latestOutcome.occurredAt) >= Date.parse(latestRoute.occurredAt)
      ? `closed-${outcomeStatus ?? (latestOutcome.ok === false ? "failed" : "recorded")}`
      : missingRequiredSkills.length > 0
        ? "open-missing-required-skills"
        : latestReminder
          ? "open-idle-reminder"
          : "open-active";
  const evidenceRefs = [...new Set(events.flatMap((event) => {
    const value = event.details.evidenceRef;
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  }))];
  const eventRuntimeBootIds = [...new Set(events.flatMap((event) => {
    const value = event.details.runtimeBootId;
    return typeof value === "string" && value ? [value] : [];
  }))];
  const workflowKeys = [...new Set([
    ...(state?.workflowKey && state.workflowKey !== "unscoped" ? [state.workflowKey] : []),
    ...toolEvidence.workflowKeys,
  ])];
  return {
    traceId,
    workflowKeys,
    identity: {
      taskHash: state?.taskHash ?? null,
      taskKeys: toolEvidence.taskKeys,
      sessionKeys: toolEvidence.sessionKeys,
      caller: state?.caller ?? null,
      project: state?.project ?? toolEvidence.projects[0] ?? null,
      projects: toolEvidence.projects,
    },
    lifecycle: {
      status: closureStatus,
      stage: state?.stage ?? latestRoute?.stage ?? null,
      routeCount: state?.routeCount ?? 0,
      firstEventAt: events[0]?.occurredAt ?? toolEvidence.summary.firstStartedAt,
      lastEventAt: events.at(-1)?.occurredAt ?? toolEvidence.summary.lastStartedAt,
      requiredSkills: state?.requiredSkills ?? [],
      selectedSkills: state?.selectedSkills ?? [],
      loadedSkills: state?.loadedSkills ?? [],
      missingRequiredSkills,
      verification: latestVerification,
      persistence: latestPersistence,
      outcome: latestOutcome,
      idleReminder: latestReminder,
    },
    runtime: {
      currentBootId: RUNTIME_BOOT_ID,
      eventRuntimeBootIds,
      toolRuntimeGenerations: toolEvidence.runtimeGenerations,
    },
    tools: {
      summary: toolEvidence.summary,
      counts: toolEvidence.toolCounts,
      calls: toolEvidence.calls,
      truncated: toolEvidence.truncated,
    },
    evidenceRefs,
    events,
    truncated: events.length >= boundedLimit || toolEvidence.truncated,
    privacy: {
      rawArgumentsStored: false,
      rawPromptsStored: false,
      transcriptsStored: false,
      privateReasoningStored: false,
      gitOutputsStored: false,
      note: "Commit hashes, snapshot ids, restart ids and remote-ref checks are retained only when explicitly written as bounded evidenceRef values.",
    },
  };
}


export function closeMssrObservatoryForTests(): void {
  if (db) db.close();
  db = undefined;
  insertEvent = null;
  resetMssrObservabilityEpochForTests();
}
