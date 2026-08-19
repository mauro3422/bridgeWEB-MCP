import { createHash } from "node:crypto";
import path from "node:path";
import {
  applyMssrProjectKnowledgeMaintenanceToLifecycle,
  evaluateMssrContextFreshnessOperationalAttention,
  evaluateMssrOperationalNoticeTransition,
  evaluateMssrProjectKnowledgeMaintenance,
  evaluateMssrProjectKnowledgeOperationalAttention,
  evaluateMssrTraceLifecycleOperationalAttention,
  getMssrTraceClosureState,
  hasFreshMaintenanceClose,
  missingRequiredSkills,
  reduceMssrCheckpointLifecycle,
  reduceMssrRouteLifecycle,
  reduceMssrSkillLoadLifecycle,
  structuredSkillIntentSchema,
  validateMssrCheckpointLifecycle,
  type MssrContextFreshness,
  type MssrContextFreshnessOperationalProjection,
  type MssrProjectKnowledgeMaintenanceResult,
  type MssrProjectKnowledgeOperationalProjection,
  type MssrTraceLifecycleOperationalProjection,
  type MssrTraceLifecycleState,
  type StructuredSkillIntent,
} from "@mauroprime/mssr";
import { adaptMssrOperationalDecision } from "./operational-notices.js";
import type { BridgeNoticeAction, BridgeNoticeInput } from "./notices.js";
import { findPersistedMssrTraceCandidates, purgeMssrTraceWorkingMemory, readPersistedMssrTraceState } from "./mssr-observatory.js";
import { createMssrRoutingComplianceNoticeTracker } from "./mssr-routing-compliance.js";
import { normalizeModelIdentifier } from "./runtime-identity.js";

type JsonRecord = Record<string, unknown>;
type ToolSchemaLike = {
  name: string;
  inputSchema?: JsonRecord;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
};

type ActiveTraceState = {
  traceId: string;
  workflowKey: string;
  stage: string;
  taskHash: string;
  caller: string;
  model: string;
  reasoningEffort: string;
  sessionKey: string;
  project: string;
  projectRootHint: string | null;
  intent: StructuredSkillIntent | null;
  changedPathHints: Set<string>;
  observedToolNames: Set<string>;
  materialWrites: number;
  packageChanged: boolean;
  runtimeChanged: boolean;
  routingChanged: boolean;
  skillStructureChanged: boolean;
  contextFreshnessIssues: number;
  projectInitialized: boolean | null;
  projectContextHealth: "ok" | "watch" | "review" | null;
  userCorrections: number;
  projectMaintenanceAdvisory: MssrProjectKnowledgeMaintenanceResult | null;
  projectMaintenanceAttention: MssrProjectKnowledgeOperationalProjection | null;
  contextFreshnessAttention: MssrContextFreshnessOperationalProjection | null;
  lifecycleAttention: MssrTraceLifecycleOperationalProjection | null;
  requiredSkills: Set<string>;
  selectedSkills: Set<string>;
  loadedSkills: Set<string>;
  requiredPhases: Set<MssrTraceLifecycleState["requiredPhases"][number]>;
  completedPhases: Set<MssrTraceLifecycleState["completedPhases"][number]>;
  routeCount: number;
  closed: boolean;
  maintenanceRequired: boolean;
  lifecycleRevision: number;
  closeRevision: number;
  maintenanceRevision: number;
  updatedAt: number;
  lastRoutePlannedAt: number;
  lastToolCompletedAt: number | null;
  lastToolName: string | null;
  toolActivityVersion: number;
  closureReminderVersion: number;
  progressLeaseUntil: number;
};

function portableLifecycle(state: ActiveTraceState): MssrTraceLifecycleState {
  return {
    stage: state.stage as MssrTraceLifecycleState["stage"],
    requiredSkills: [...state.requiredSkills],
    selectedSkills: [...state.selectedSkills],
    loadedSkills: [...state.loadedSkills],
    requiredPhases: [...state.requiredPhases],
    completedPhases: [...state.completedPhases],
    routeCount: state.routeCount,
    closed: state.closed,
    maintenanceRequired: state.maintenanceRequired,
    lifecycleRevision: state.lifecycleRevision,
    closeRevision: state.closeRevision,
    maintenanceRevision: state.maintenanceRevision,
  };
}

function applyPortableLifecycle(
  state: ActiveTraceState,
  lifecycle: MssrTraceLifecycleState,
): void {
  state.stage = lifecycle.stage;
  state.requiredSkills = new Set(lifecycle.requiredSkills);
  state.selectedSkills = new Set(lifecycle.selectedSkills);
  state.loadedSkills = new Set(lifecycle.loadedSkills);
  state.requiredPhases = new Set(lifecycle.requiredPhases);
  state.completedPhases = new Set(lifecycle.completedPhases);
  state.routeCount = lifecycle.routeCount;
  state.closed = lifecycle.closed;
  state.maintenanceRequired = lifecycle.maintenanceRequired;
  state.lifecycleRevision = lifecycle.lifecycleRevision;
  state.closeRevision = lifecycle.closeRevision;
  state.maintenanceRevision = lifecycle.maintenanceRevision;
}

const ROUTE_TOOLS = new Set(["skill_recommend", "skill_route_plan", "skill_bootstrap"]);
const TRACE_QUERY_TOOLS = new Set(["mssr_observatory_query"]);
const TRACE_DISPATCH_TOOLS = new Set(["bridge_tool_query", "bridge_tool_action"]);
const CLOSURE_ACTIVITY_EXEMPT_TOOLS = new Set([
  ...ROUTE_TOOLS,
  ...TRACE_QUERY_TOOLS,
  "skill_load",
  "skill_catalog",
  "skill_route_audit",
  "skill_route_vocabulary",
  "project_context_load",
  "bridge_notice_status",
  "bridge_notice_drain",
]);
const TRACE_BOUNDARY_STAGES = new Set(["verify", "persist", "close"]);
const TRACE_BOUNDARY_EVENTS = new Set(["verification", "persistence", "outcome"]);
const TRACE_LEASE_MS = Math.max(60_000, Number(process.env.BRIDGE_MCP_MSSR_TRACE_LEASE_MS) || 2 * 60 * 60 * 1_000);
const TRACE_AUTO_RECOVERY_MS = Math.min(
  TRACE_LEASE_MS,
  Math.max(5 * 60_000, Number(process.env.BRIDGE_MCP_MSSR_AUTO_RECOVERY_MS) || 30 * 60_000),
);
const CLOSED_TRACE_RETENTION_MS = Math.min(TRACE_LEASE_MS, 15 * 60 * 1_000);
const EXACT_HOST_ROUTE_DOMINANCE_MS = Math.max(15_000, Number(process.env.BRIDGE_MCP_MSSR_EXACT_ROUTE_DOMINANCE_MS) || 90_000);
const MAX_SHARED_TRACES = 128;
const sharedTraces = new Map<string, ActiveTraceState>();
const closureTimers = new Map<string, ReturnType<typeof setTimeout>>();

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalizedText(value: unknown, max = 2_000): string {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase().slice(0, max)
    : "";
}

function taskFingerprint(value: unknown): string {
  const normalized = normalizedText(value);
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function normalizedCaller(value: unknown): string {
  return normalizedText(value, 80) || "other";
}

function normalizedScopeValue(value: unknown): string {
  return normalizedText(value, 120) || "unknown";
}


const MAX_PROJECT_MAINTENANCE_PATH_HINTS = 96;
const MAX_PROJECT_MAINTENANCE_TOOLS = 64;

function normalizeProjectRootHint(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  return path.isAbsolute(candidate) ? path.resolve(candidate) : null;
}

function projectPathHint(value: unknown, projectRootHint: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  if (/^(?:https?|data):/i.test(candidate)) return null;
  const normalized = candidate.replace(/\\/g, "/");

  if (projectRootHint && path.isAbsolute(candidate)) {
    const relative = path.relative(projectRootHint, path.resolve(candidate)).replace(/\\/g, "/");
    if (relative && !relative.startsWith("../") && relative !== "..") return relative;
    if (!relative) return null;
  }

  if (!path.isAbsolute(candidate)) return normalized.replace(/^\.\//, "").slice(0, 512);

  const anchors = ["/.mssr/", "/.bridge/", "/src/", "/skills/", "/config/", "/docs/", "/changelogs/", "/scripts/", "/vendor/"];
  const lower = normalized.toLowerCase();
  for (const anchor of anchors) {
    const index = lower.lastIndexOf(anchor);
    if (index >= 0) return normalized.slice(index + 1, index + 1 + 512);
  }
  const base = path.basename(candidate);
  return base ? base.slice(0, 512) : null;
}

function extractProjectPathHints(args: JsonRecord, projectRootHint: string | null): string[] {
  const hints = new Set<string>();
  const visit = (value: unknown, key: string, depth: number): void => {
    if (hints.size >= 12 || depth > 2) return;
    if (typeof value === "string") {
      if (/(?:path|file|cwd|root|destination|source)$/i.test(key) || /(?:path|file|cwd|root)/i.test(key)) {
        const hint = projectPathHint(value, projectRootHint);
        if (hint) hints.add(hint);
      }
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [childKey, child] of Object.entries(value as JsonRecord)) visit(child, childKey, depth + 1);
  };
  for (const [key, value] of Object.entries(args)) visit(value, key, 0);
  return [...hints];
}

function collectContextFreshness(result: JsonRecord | null): MssrContextFreshness[] | null {
  if (!result) return null;
  const plane = asRecord(result.contextPlane);
  if (!plane) return null;

  const freshnessValues: MssrContextFreshness[] = [];
  const allowed = new Set<MssrContextFreshness>(["fresh", "stale", "conflicting", "unavailable", "unknown"]);
  const inspectEvidence = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const record = asRecord(item);
      if (!record) continue;
      const freshness = typeof record.freshness === "string" ? record.freshness.toLowerCase() as MssrContextFreshness : null;
      if (freshness && allowed.has(freshness)) freshnessValues.push(freshness);
      if (Array.isArray(record.evidence)) inspectEvidence(record.evidence);
      if (Array.isArray(record.sources)) inspectEvidence(record.sources);
    }
  };

  const projectContext = asRecord(plane.projectContext);
  inspectEvidence(projectContext?.receipts);
  const contextMessages = asRecord(plane.contextMessages);
  inspectEvidence(contextMessages?.selected);
  return freshnessValues.slice(0, 10_000);
}

function pathSignals(paths: Iterable<string>): {
  packageChanged: boolean;
  routingChanged: boolean;
  skillStructureChanged: boolean;
} {
  const values = [...paths].map((value) => value.replace(/\\/g, "/").toLowerCase());
  return {
    packageChanged: values.some((value) => value === "package.json" || value === "package-lock.json" || value.endsWith("/package.json")),
    routingChanged: values.some((value) => value.includes("skill-routing") || value.includes("host-adapter-contract") || value.includes("mssr-adapter")),
    skillStructureChanged: values.some((value) => /(?:^|\/)skills\/[^/]+\/(?:skill\.md|context-modules\.json|references\/)/.test(value)),
  };
}

function validTraceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{6,128}$/.test(value.trim());
}

function schemaPropertyExists(schema: ToolSchemaLike, propertyName: string): boolean {
  const input = asRecord(schema.inputSchema);
  const properties = asRecord(input?.properties);
  return Boolean(properties && Object.prototype.hasOwnProperty.call(properties, propertyName));
}

function notice(
  severity: "info" | "warning" | "error",
  code: string,
  source: string,
  message: string,
  details: JsonRecord,
  dedupeKey: string,
  actions: BridgeNoticeAction[] = [],
): BridgeNoticeInput {
  return { severity, code, source, message, details, actions, dedupeKey };
}

function clearClosureTimer(traceId: string): void {
  const timer = closureTimers.get(traceId);
  if (timer) clearTimeout(timer);
  closureTimers.delete(traceId);
}

function pruneSharedTraces(now = Date.now()): void {
  for (const [traceId, state] of sharedTraces) {
    const retention = state.closed ? CLOSED_TRACE_RETENTION_MS : TRACE_LEASE_MS;
    if (now - state.updatedAt > retention) {
      clearClosureTimer(traceId);
      sharedTraces.delete(traceId);
    }
  }
  if (sharedTraces.size <= MAX_SHARED_TRACES) return;
  const oldest = [...sharedTraces.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const state of oldest.slice(0, sharedTraces.size - MAX_SHARED_TRACES)) {
    clearClosureTimer(state.traceId);
    sharedTraces.delete(state.traceId);
  }
}

function openSharedTraces(): ActiveTraceState[] {
  pruneSharedTraces();
  return [...sharedTraces.values()].filter((state) => !state.closed);
}

function autoRecoverySharedTraces(): ActiveTraceState[] {
  const now = Date.now();
  return openSharedTraces().filter((state) => {
    if (now - state.lastRoutePlannedAt > TRACE_AUTO_RECOVERY_MS) return false;
    const idleReminderConsumed = state.closureReminderVersion > 0
      && state.closureReminderVersion >= state.toolActivityVersion
      && state.progressLeaseUntil <= now;
    return !idleReminderConsumed;
  });
}

function candidateDetails(candidates: ActiveTraceState[]): JsonRecord {
  return {
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 8).map((state) => ({
      traceId: state.traceId,
      workflowKey: state.workflowKey,
      stage: state.stage,
      caller: state.caller,
      sessionKey: state.sessionKey,
      project: state.project,
      missingRequiredSkills: missingRequiredSkills(portableLifecycle(state)),
      ageMs: Math.max(0, Date.now() - state.updatedAt),
    })),
  };
}

export type MssrTracePreparation = {
  args: JsonRecord;
  notices: BridgeNoticeInput[];
  blocked?: {
    code: string;
    message: string;
    details: JsonRecord;
  };
};

export type MssrTraceSessionSnapshot = {
  active: boolean;
  traceId: string | null;
  workflowKey: string | null;
  taskHash: string | null;
  stage: string | null;
  caller: string | null;
  model: string | null;
  reasoningEffort: string | null;
  sessionKey: string | null;
  project: string | null;
  projectMaintenance: {
    level: string;
    due: boolean;
    projectRootKnown: boolean;
    materialWrites: number;
    changedPathHints: string[];
    observedToolNames: string[];
    packageChanged: boolean;
    runtimeChanged: boolean;
    routingChanged: boolean;
    skillStructureChanged: boolean;
    contextFreshnessIssues: number;
    projectInitialized: boolean | null;
    projectContextHealth: "ok" | "watch" | "review" | null;
    userCorrections: number;
    targets: Array<{ target: string; level: string; authority: string; reasons: readonly string[] }>;
  } | null;
  routeCount: number;
  closed: boolean;
  maintenanceRequired: boolean;
  lifecycleRevision: number;
  closeRevision: number;
  maintenanceRevision: number;
  maintenanceCloseFresh: boolean;
  requiredSkills: string[];
  loadedSkills: string[];
  missingRequiredSkills: string[];
  requiredPhases: string[];
  completedPhases: string[];
  closure: ReturnType<typeof getMssrTraceClosureState> | null;
  staleForAutoRecovery: boolean;
  progressLeaseUntil: string | null;
  progressLeaseRemainingMs: number;
  sharedOpenTraces: number;
  autoRecoveryOpenTraces: number;
};

export type MssrClosureReminder = {
  traceId: string;
  caller: string;
  stage: string;
  toolName: string;
  idleMs: number;
  activityVersion: number;
  notice: BridgeNoticeInput;
};

export type MssrTraceCoordinatorOptions = {
  closureIdleMs?: number;
  onClosureReminder?: (reminder: MssrClosureReminder) => void;
};

export type MssrTraceHostContext = {
  caller?: string;
  sessionKey?: string;
  project?: string;
  workflowKey?: string;
};

export function createMssrTraceSessionCoordinator(
  toolSchemas: readonly ToolSchemaLike[],
  options: MssrTraceCoordinatorOptions = {},
) {
  const traceAwareTools = new Set(
    toolSchemas
      .filter((schema) => schemaPropertyExists(schema, "traceId"))
      .map((schema) => schema.name)
      .filter((name) => !ROUTE_TOOLS.has(name) && !TRACE_QUERY_TOOLS.has(name)),
  );
  const stageAwareTools = new Set(
    toolSchemas.filter((schema) => schemaPropertyExists(schema, "stage")).map((schema) => schema.name),
  );
  const schemaByName = new Map(toolSchemas.map((schema) => [schema.name, schema] as const));
  const routingCompliance = createMssrRoutingComplianceNoticeTracker();
  const projectMaintenanceExemptTools = new Set([
    ...ROUTE_TOOLS,
    ...TRACE_QUERY_TOOLS,
    ...TRACE_DISPATCH_TOOLS,
    "mssr_trace_record",
    "mssr_trace_working_update",
    "mssr_observatory_epoch_start",
    "skill_load",
    "skill_catalog",
    "skill_route_audit",
    "skill_route_vocabulary",
    "project_context_load",
    "project_context_audit",
    "project_context_health",
    "project_context_modularization_plan",
    "project_change_consistency",
    "bridge_notice_status",
    "bridge_notice_drain",
    "bridge_health",
    "bridge_verify_all",
    "run_command",
  ]);

  function isMaterialWriteTool(toolName: string): boolean {
    if (projectMaintenanceExemptTools.has(toolName)) return false;
    const schema = schemaByName.get(toolName);
    if (schema?.annotations?.readOnlyHint === true) return false;
    if (schema?.annotations?.destructiveHint === true) return true;
    if (["apply_patch", "edit_lines", "write_text_file", "git_restore_file"].includes(toolName)) return true;
    return /(?:write|edit|patch|update|create|delete|remove|move|rename|save|install|migrate|publish)/i.test(toolName);
  }

  function evaluateProjectMaintenanceState(state: ActiveTraceState): MssrProjectKnowledgeMaintenanceResult {
    const advisory = evaluateMssrProjectKnowledgeMaintenance({
      stage: state.stage as Parameters<typeof evaluateMssrProjectKnowledgeMaintenance>[0]["stage"],
      intent: state.intent ?? undefined,
      changedPaths: [...state.changedPathHints],
      toolNames: [...state.observedToolNames],
      materialWrites: state.materialWrites,
      packageChanged: state.packageChanged,
      runtimeChanged: state.runtimeChanged,
      routingChanged: state.routingChanged,
      skillStructureChanged: state.skillStructureChanged,
      contextFreshnessIssues: state.contextFreshnessIssues,
      ...(state.projectInitialized !== null ? { projectInitialized: state.projectInitialized } : {}),
      ...(state.projectContextHealth !== null ? { projectContextHealth: state.projectContextHealth } : {}),
      userCorrections: state.userCorrections,
    });
    state.projectMaintenanceAdvisory = advisory;
    return advisory;
  }

  function projectMaintenanceNotice(state: ActiveTraceState, advisory: MssrProjectKnowledgeMaintenanceResult): BridgeNoticeInput | null {
    const previous = state.projectMaintenanceAttention;
    const current = evaluateMssrProjectKnowledgeOperationalAttention(advisory, portableLifecycle(state));
    state.projectMaintenanceAttention = current;
    const targets = advisory.targets.map((target) => `${target.target}:${target.level}`);
    const decision = evaluateMssrOperationalNoticeTransition({
      subject: `project-knowledge:${state.traceId}`,
      source: "mssr-project-maintenance",
      code: current.level === "error" ? "mssr-project-knowledge-review-required" : "mssr-project-knowledge-review-due",
      resolutionCode: "mssr-project-knowledge-review-resolved",
      currentLevel: current.level,
      previousLevel: previous?.level ?? null,
      currentFingerprint: current.fingerprint,
      previousFingerprint: previous?.fingerprint ?? null,
      message: `MSSR detectó conocimiento durable que requiere atención en la traza ${state.traceId} (${targets.join(", ") || "maintenance-debt"}). La metadata sólo dispara revisión: no se escribió ninguna autoridad automáticamente.`,
      resolutionMessage: `La revisión de conocimiento durable para ${state.traceId} quedó cerrada para la revisión actual. Evidencia histórica puede permanecer en la traza, pero ya no requiere atención operativa hasta una nueva invalidación.`,
      recommendation: "Revisa sólo las autoridades señaladas y registra updated vs reviewed-none; no autoescribas desde la notificación.",
    });
    return adaptMssrOperationalDecision(decision, {
      traceId: state.traceId,
      stage: state.stage,
      advisoryLevel: advisory.level,
      operationalLevel: current.level,
      maintenancePending: current.maintenancePending,
      maintenanceFresh: current.maintenanceFresh,
      targets: advisory.targets.map((target) => ({
        target: target.target,
        level: target.level,
        authority: target.authority,
        reasons: target.reasons.slice(0, 8),
      })),
      materialWrites: state.materialWrites,
      changedPathHints: [...state.changedPathHints].slice(0, 24),
      contextFreshnessIssues: state.contextFreshnessIssues,
      projectInitialized: state.projectInitialized,
      projectContextHealth: state.projectContextHealth,
      recommendedSkills: [...advisory.recommendedSkills],
      advisoryOnly: true,
    }, [{
      label: "Revisar mantenimiento MSSR",
      toolName: "skill_bootstrap",
      instruction: "Reusa esta traceId y el objetivo resuelto. Replanifica en la fase adecuada (preferentemente close), carga skill-maintenance-loop y sólo las autoridades .mssr/skills señaladas; decide updated vs reviewed-none con diff/readback. No autoescribas desde la notificación.",
    }]);
  }

  function contextFreshnessNotice(
    state: ActiveTraceState,
    current: MssrContextFreshnessOperationalProjection,
  ): BridgeNoticeInput | null {
    const previous = state.contextFreshnessAttention;
    state.contextFreshnessAttention = current;
    const decision = evaluateMssrOperationalNoticeTransition({
      subject: `context-plane:${state.traceId}`,
      source: "mssr-context-plane",
      code: current.level === "error" ? "mssr-context-plane-freshness-conflict" : "mssr-context-plane-freshness-review",
      resolutionCode: "mssr-context-plane-freshness-resolved",
      currentLevel: current.level,
      previousLevel: previous?.level ?? null,
      currentFingerprint: current.fingerprint,
      previousFingerprint: previous?.fingerprint ?? null,
      message: `Context Plane de ${state.traceId} requiere revisar frescura (${Object.entries(current.counts).map(([key, value]) => `${key}:${value}`).join(", ")}). No se persistió ni reemplazó evidencia automáticamente.`,
      resolutionMessage: `Context Plane de ${state.traceId} volvió por debajo del umbral de revisión; la observación actual ya no exige atención operativa.`,
      recommendation: "Revalida la evidencia/provenance de Context Plane antes de usarla para decisiones durables.",
    });
    return adaptMssrOperationalDecision(decision, {
      traceId: state.traceId,
      stage: state.stage,
      counts: current.counts,
      issueCount: current.issueCount,
      advisoryOnly: true,
    }, [{
      label: "Revalidar Context Plane",
      toolName: "project_context_load",
      ...(state.projectRootHint ? { arguments: { projectRoot: state.projectRootHint } } : {}),
      instruction: "Revalida la evidencia de Context Plane y su provenance. No escribas PROJECT_* ni aceptes una revisión sólo por este aviso.",
    }]);
  }

  function lifecycleOperationalNotice(
    state: ActiveTraceState,
    idleObserved: boolean,
    details: JsonRecord = {},
  ): BridgeNoticeInput | null {
    const previous = state.lifecycleAttention;
    const current = evaluateMssrTraceLifecycleOperationalAttention(portableLifecycle(state), { idleObserved });
    state.lifecycleAttention = current;
    const decision = evaluateMssrOperationalNoticeTransition({
      subject: `trace-lifecycle:${state.traceId}`,
      source: "mssr-trace-context",
      code: "mssr-web-outcome-missing-after-idle",
      resolutionCode: "mssr-web-outcome-idle-resolved",
      currentLevel: current.level,
      previousLevel: previous?.level ?? null,
      currentFingerprint: current.fingerprint,
      previousFingerprint: previous?.fingerprint ?? null,
      message: `La traza Web ${state.traceId} quedó sin outcome observable después de actividad sustantiva. El idle no prueba finalización: si realmente está cerrando, sigue '${current.nextRequiredAction}'; si continúa activa, registra progress/lease o evidencia del bloqueo.`,
      resolutionMessage: `La señal idle de ${state.traceId} quedó resuelta por actividad explícita/progress o por el cierre de la traza; esto no sintetiza ni reemplaza el outcome real.`,
      recommendation: "Inspecciona la evidencia de la misma traza antes de registrar un outcome; el aviso no autoriza success.",
    });
    return adaptMssrOperationalDecision(decision, {
      traceId: state.traceId,
      caller: state.caller,
      stage: state.stage,
      nextRequiredAction: current.nextRequiredAction,
      missingRequiredSkills: current.missingRequiredSkills,
      missingRequiredPhases: current.missingRequiredPhases,
      needsMaintenance: current.needsMaintenance,
      needsCloseReplan: current.needsCloseReplan,
      limitation: "Bridge observa lifecycle MCP; silencio no demuestra finalización ni autoriza success.",
      ...details,
    }, [{
      label: "Revisar evidencia de cierre",
      toolName: "mssr_trace_evidence",
      arguments: { traceId: state.traceId },
      instruction: `Inspecciona la evidencia y, sólo si la tarea realmente terminó, continúa el gate '${current.nextRequiredAction}' en esta misma traza.`,
    }]);
  }

  function observeProjectMaintenanceMetadata(
    state: ActiveTraceState,
    toolName: string,
    args: JsonRecord,
    result: JsonRecord | null,
  ): BridgeNoticeInput[] {
    let materiallyChanged = false;
    let metadataChanged = false;
    const operationalNotices: BridgeNoticeInput[] = [];

    if (!state.projectRootHint) {
      const root = normalizeProjectRootHint(args.projectRoot ?? args.cwd);
      if (root) {
        state.projectRootHint = root;
        metadataChanged = true;
      }
    }

    if (state.observedToolNames.size < MAX_PROJECT_MAINTENANCE_TOOLS && !state.observedToolNames.has(toolName)) {
      state.observedToolNames.add(toolName);
      metadataChanged = true;
    }

    if (isMaterialWriteTool(toolName)) {
      state.materialWrites = Math.min(10_000, state.materialWrites + 1);
      materiallyChanged = true;
      metadataChanged = true;
      for (const hint of extractProjectPathHints(args, state.projectRootHint)) {
        if (state.changedPathHints.size >= MAX_PROJECT_MAINTENANCE_PATH_HINTS) break;
        if (!state.changedPathHints.has(hint)) {
          state.changedPathHints.add(hint);
          metadataChanged = true;
        }
      }
    }

    if (/restart|reload/i.test(toolName) && !/status|health/i.test(toolName)) {
      if (!state.runtimeChanged) metadataChanged = true;
      state.runtimeChanged = true;
      materiallyChanged = true;
    }

    const pathFlags = pathSignals(state.changedPathHints);
    if (pathFlags.packageChanged && !state.packageChanged) metadataChanged = true;
    if (pathFlags.routingChanged && !state.routingChanged) metadataChanged = true;
    if (pathFlags.skillStructureChanged && !state.skillStructureChanged) metadataChanged = true;
    state.packageChanged ||= pathFlags.packageChanged;
    state.routingChanged ||= pathFlags.routingChanged;
    state.skillStructureChanged ||= pathFlags.skillStructureChanged;

    const observedFreshness = collectContextFreshness(result);
    if (observedFreshness !== null) {
      const freshness = evaluateMssrContextFreshnessOperationalAttention(observedFreshness);
      const maintenanceFreshnessIssues = freshness.level === "review" || freshness.level === "error"
        ? freshness.issueCount
        : 0;
      if (maintenanceFreshnessIssues !== state.contextFreshnessIssues) {
        state.contextFreshnessIssues = maintenanceFreshnessIssues;
        metadataChanged = true;
        materiallyChanged = true;
      }
      const freshnessNotice = contextFreshnessNotice(state, freshness);
      if (freshnessNotice) operationalNotices.push(freshnessNotice);
    }

    if ((toolName === "project_context_health" || toolName === "project_context_load") && result) {
      const healthResult = toolName === "project_context_load"
        && result.projectContextHealth
        && typeof result.projectContextHealth === "object"
        ? result.projectContextHealth as JsonRecord
        : result;
      const initialized = healthResult.manifestStatus === "valid";
      const health = healthResult.level === "ok" || healthResult.level === "watch" || healthResult.level === "review" ? healthResult.level : null;
      if (state.projectInitialized !== initialized) metadataChanged = true;
      if (health !== null && state.projectContextHealth !== health) metadataChanged = true;
      state.projectInitialized = initialized;
      if (health !== null) state.projectContextHealth = health;
      if (!initialized || health === "review") materiallyChanged = true;
    }

    if (toolName === "project_context_initialize" && result) {
      const directInitialized = typeof result.initialized === "boolean" ? result.initialized : null;
      if (directInitialized !== null) {
        if (state.projectInitialized !== directInitialized) metadataChanged = true;
        state.projectInitialized = directInitialized;
        materiallyChanged = true;
      }
    }

    const userCorrections = typeof args.userCorrections === "number" && Number.isFinite(args.userCorrections)
      ? Math.max(0, Math.floor(args.userCorrections))
      : 0;
    if (userCorrections > state.userCorrections) {
      state.userCorrections = Math.min(1_000, userCorrections);
      metadataChanged = true;
      materiallyChanged = true;
    }

    if (!metadataChanged) return operationalNotices;
    const advisory = evaluateProjectMaintenanceState(state);
    if (materiallyChanged && advisory.due) {
      applyPortableLifecycle(state, applyMssrProjectKnowledgeMaintenanceToLifecycle(portableLifecycle(state), advisory));
    }
    const advisoryNotice = projectMaintenanceNotice(state, advisory);
    if (advisoryNotice) operationalNotices.push(advisoryNotice);
    return operationalNotices;
  }

  let localTraceId: string | null = null;
  let hostContext: Required<MssrTraceHostContext> = {
    caller: "other",
    sessionKey: "unknown",
    project: "unknown",
    workflowKey: "unknown",
  };
  const closureIdleMs = Math.max(
    10,
    options.closureIdleMs
      ?? (Number(process.env.BRIDGE_MCP_WEB_CLOSURE_IDLE_MS) || 3 * 60_000),
  );

  function scheduleClosureReminder(state: ActiveTraceState, toolName: string): void {
    if (state.caller !== "chatgpt-web" || state.closed || CLOSURE_ACTIVITY_EXEMPT_TOOLS.has(toolName)) return;
    const now = Date.now();
    state.lastToolCompletedAt = now;
    state.lastToolName = toolName;
    state.toolActivityVersion += 1;
    state.updatedAt = now;
    const activityVersion = state.toolActivityVersion;
    const reminderDelayMs = Math.max(closureIdleMs, state.progressLeaseUntil - now);
    clearClosureTimer(state.traceId);

    const armReminder = (delayMs: number): void => {
      const timer = setTimeout(() => {
        closureTimers.delete(state.traceId);
        const current = sharedTraces.get(state.traceId);
        if (!current || current.closed || current.caller !== "chatgpt-web") return;
        if (current.toolActivityVersion !== activityVersion || current.closureReminderVersion >= activityVersion) return;

        const firedAt = Date.now();
        if (current.progressLeaseUntil > firedAt) {
          armReminder(Math.max(closureIdleMs, current.progressLeaseUntil - firedAt));
          return;
        }

        current.closureReminderVersion = activityVersion;
        current.updatedAt = firedAt;
        const closePreflight = getMssrTraceClosureState(portableLifecycle(current));
        const actualIdleMs = current.lastToolCompletedAt ? Math.max(0, firedAt - current.lastToolCompletedAt) : delayMs;
        const reminderNotice = lifecycleOperationalNotice(current, true, {
          lastToolName: current.lastToolName,
          lastToolCompletedAt: current.lastToolCompletedAt
            ? new Date(current.lastToolCompletedAt).toISOString()
            : null,
          idleMs: actualIdleMs,
          baseIdleMs: closureIdleMs,
          progressLeaseUntil: current.progressLeaseUntil > 0 ? new Date(current.progressLeaseUntil).toISOString() : null,
          activityVersion,
          closureDueCandidate: true,
          closePreflight,
        });
        if (reminderNotice) {
          options.onClosureReminder?.({
            traceId: current.traceId,
            caller: current.caller,
            stage: current.stage,
            toolName: current.lastToolName ?? toolName,
            idleMs: actualIdleMs,
            activityVersion,
            notice: reminderNotice,
          });
        }
      }, delayMs);
      timer.unref?.();
      closureTimers.set(state.traceId, timer);
    };

    armReminder(reminderDelayMs);
  }

  function knownWorkflowKey(value: string): boolean {
    return value !== "unknown" && value !== "unscoped";
  }

  function traceOwnerCompatible(state: ActiveTraceState): boolean {
    const projectMismatch = hostContext.project !== "unknown"
      && state.project !== "unknown"
      && state.project !== hostContext.project;
    const workflowMismatch = knownWorkflowKey(hostContext.workflowKey)
      && knownWorkflowKey(state.workflowKey)
      && state.workflowKey !== hostContext.workflowKey;
    return !projectMismatch && !workflowMismatch;
  }

  function localState(allowClosed = false, enforceOwnerScope = false): ActiveTraceState | null {
    pruneSharedTraces();
    if (!localTraceId) return null;
    const state = sharedTraces.get(localTraceId) ?? null;
    if (!state || (!allowClosed && state.closed)) return null;
    if (enforceOwnerScope && !traceOwnerCompatible(state)) return null;
    return state;
  }

  function adopt(state: ActiveTraceState): ActiveTraceState {
    localTraceId = state.traceId;
    state.updatedAt = Date.now();
    return state;
  }

  function restore(traceId: string): ActiveTraceState | null {
    const persisted = readPersistedMssrTraceState(traceId);
    if (!persisted) return null;
    const state: ActiveTraceState = {
      ...persisted,
      projectRootHint: null,
      intent: null,
      changedPathHints: new Set(),
      observedToolNames: new Set(),
      materialWrites: 0,
      packageChanged: false,
      runtimeChanged: false,
      routingChanged: false,
      skillStructureChanged: false,
      contextFreshnessIssues: 0,
      projectInitialized: null,
      projectContextHealth: null,
      userCorrections: 0,
      projectMaintenanceAdvisory: null,
      projectMaintenanceAttention: null,
      contextFreshnessAttention: null,
      lifecycleAttention: null,
      requiredSkills: new Set(persisted.requiredSkills),
      selectedSkills: new Set(persisted.selectedSkills),
      loadedSkills: new Set(persisted.loadedSkills),
      requiredPhases: new Set(persisted.requiredPhases as MssrTraceLifecycleState["requiredPhases"]),
      completedPhases: new Set(persisted.completedPhases as MssrTraceLifecycleState["completedPhases"]),
      lastRoutePlannedAt: persisted.updatedAt,
      lastToolCompletedAt: null,
      lastToolName: null,
      toolActivityVersion: 0,
      closureReminderVersion: 0,
      progressLeaseUntil: 0,
    };
    sharedTraces.set(traceId, state);
    return state;
  }
  function dominantExactHostCandidate(candidates: ActiveTraceState[]): ActiveTraceState[] {
    const compatible = candidates.filter(traceOwnerCompatible);
    if (compatible.length <= 1 || hostContext.sessionKey === "unknown") return dominantFreshRouteCandidate(compatible);
    const exact = compatible.filter((state) => state.sessionKey === hostContext.sessionKey
      && (hostContext.project === "unknown" || state.project === hostContext.project || state.project === "unknown")
      && (!knownWorkflowKey(hostContext.workflowKey) || state.workflowKey === hostContext.workflowKey || !knownWorkflowKey(state.workflowKey))
      && (hostContext.caller === "other" || state.caller === hostContext.caller));
    if (exact.length === 0) return dominantFreshRouteCandidate(compatible);
    return dominantFreshRouteCandidate(exact);
  }

  function dominantFreshRouteCandidate(candidates: ActiveTraceState[]): ActiveTraceState[] {
    if (candidates.length <= 1) return candidates;
    const ordered = [...candidates].sort((left, right) => right.lastRoutePlannedAt - left.lastRoutePlannedAt);
    const [newest, second] = ordered;
    if (newest && second && newest.lastRoutePlannedAt - second.lastRoutePlannedAt >= EXACT_HOST_ROUTE_DOMINANCE_MS) {
      return [newest];
    }
    const now = Date.now();
    const freshRoutes = ordered.filter((state) => now - state.lastRoutePlannedAt <= EXACT_HOST_ROUTE_DOMINANCE_MS);
    return freshRoutes.length === 1 ? freshRoutes : candidates;
  }

  function scopedCandidateResolution(candidates: ActiveTraceState[]): {
    candidates: ActiveTraceState[];
    relaxedHostScope: boolean;
  } {
    const compatible = candidates.filter(traceOwnerCompatible);
    let relaxedHostScope = compatible.length !== candidates.length;
    if (compatible.length === 0 && (hostContext.project !== "unknown" || knownWorkflowKey(hostContext.workflowKey))) {
      return { candidates: [], relaxedHostScope: true };
    }
    if (hostContext.sessionKey !== "unknown") {
      const sessionMatches = compatible.filter((state) => state.sessionKey === hostContext.sessionKey);
      if (sessionMatches.length > 0) {
        return { candidates: dominantExactHostCandidate(sessionMatches), relaxedHostScope: false };
      }
      relaxedHostScope = true;
    }
    if (hostContext.project !== "unknown") {
      const projectMatches = compatible.filter((state) => state.project === hostContext.project);
      if (projectMatches.length > 0) {
        return { candidates: dominantFreshRouteCandidate(projectMatches), relaxedHostScope: false };
      }
      relaxedHostScope = true;
    }
    if (knownWorkflowKey(hostContext.workflowKey)) {
      const workflowMatches = compatible.filter((state) => state.workflowKey === hostContext.workflowKey);
      if (workflowMatches.length > 0) {
        return { candidates: dominantFreshRouteCandidate(workflowMatches), relaxedHostScope: false };
      }
      relaxedHostScope = true;
    }
    if (hostContext.caller !== "other") {
      return {
        candidates: compatible.filter((state) => state.caller === hostContext.caller),
        relaxedHostScope,
      };
    }
    return { candidates: compatible, relaxedHostScope };
  }

  function scopedCandidates(candidates: ActiveTraceState[]): ActiveTraceState[] {
    return scopedCandidateResolution(candidates).candidates;
  }

  function restorePersistedCandidates(candidates: Array<{ traceId: string }>): ActiveTraceState[] {
    return candidates.flatMap((candidate) => {
      const restored = restore(candidate.traceId);
      return restored ? [restored] : [];
    });
  }

  function persistedCandidateResolution(): {
    candidates: ActiveTraceState[];
    relaxedHostScope: boolean;
  } {
    if (hostContext.sessionKey !== "unknown") {
      const sessionMatches = restorePersistedCandidates(findPersistedMssrTraceCandidates({
        caller: hostContext.caller,
        sessionKey: hostContext.sessionKey,
        project: hostContext.project,
        workflowKey: hostContext.workflowKey,
        maxAgeMs: TRACE_AUTO_RECOVERY_MS,
        limit: 16,
      }));
      if (sessionMatches.length > 0) {
        return { candidates: dominantExactHostCandidate(sessionMatches), relaxedHostScope: false };
      }
    }
    if (hostContext.project !== "unknown") {
      const projectMatches = restorePersistedCandidates(findPersistedMssrTraceCandidates({
        caller: hostContext.caller,
        project: hostContext.project,
        workflowKey: hostContext.workflowKey,
        maxAgeMs: TRACE_AUTO_RECOVERY_MS,
        limit: 16,
      }));
      if (projectMatches.length > 0) {
        return { candidates: dominantFreshRouteCandidate(projectMatches), relaxedHostScope: false };
      }
    }
    const callerMatches = restorePersistedCandidates(findPersistedMssrTraceCandidates({
      caller: hostContext.caller,
      project: hostContext.project,
      workflowKey: hostContext.workflowKey,
      maxAgeMs: TRACE_AUTO_RECOVERY_MS,
      limit: 16,
    }));
    return {
      candidates: dominantFreshRouteCandidate(callerMatches),
      relaxedHostScope: hostContext.sessionKey !== "unknown" || hostContext.project !== "unknown",
    };
  }

  function routingComplianceNotice(
    toolName: string,
    subject: string,
    observation: Parameters<ReturnType<typeof createMssrRoutingComplianceNoticeTracker>["observe"]>[0]["observation"],
    traceId: string | null,
    details: JsonRecord,
    message: string,
    resolutionMessage: string,
    codes: { code?: string; errorCode?: string; resolutionCode?: string } = {},
  ): BridgeNoticeInput | null {
    return routingCompliance.observe({
      subject,
      source: "mssr-routing-compliance",
      observation,
      traceId,
      details: { toolName, ...details },
      ...codes,
      message,
      resolutionMessage,
    }).notice;
  }
  function ambiguousNotice(toolName: string, candidates: ActiveTraceState[]): BridgeNoticeInput | null {
    return routingComplianceNotice(
      toolName,
      `routing-host:${hostContext.sessionKey}:${hostContext.project}:${hostContext.caller}`,
      {
        trace: "ambiguous",
        route: "present",
        boundary: toolName === "skill_load" ? "skill-load" : "ordinary",
      },
      null,
      candidateDetails(candidates),
      `${toolName} encontró ${candidates.length} trazas compatibles; no se propagó ninguna para evitar mezclar agentes o tareas.`,
      `La selección de traza para ${toolName} volvió a ser inequívoca.`,
      { code: "mssr-trace-ambiguous" },
    );
  }

  function uniqueCandidate(toolName: string, candidates: ActiveTraceState[], notices: BridgeNoticeInput[]): ActiveTraceState | null {
    if (candidates.length === 1) return adopt(candidates[0]);
    if (candidates.length > 1) {
      const projected = ambiguousNotice(toolName, candidates);
      if (projected) notices.push(projected);
    }
    return null;
  }

  function boundaryNotice(toolName: string, stageOrEvent: string, state: ActiveTraceState | null): BridgeNoticeInput[] {
    if (!state || state.closed) return [];
    const lifecycle = portableLifecycle(state);
    const output: BridgeNoticeInput[] = [];
    const missing = missingRequiredSkills(lifecycle);
    const compliance = routingComplianceNotice(
      toolName,
      `routing-trace:${state.traceId}`,
      {
        trace: "matched",
        route: "present",
        boundary: stageOrEvent === "outcome" ? "outcome" : "phase-boundary",
        requiredSkills: [...state.requiredSkills],
        selectedSkills: [...state.selectedSkills],
        loadedSkills: [...state.loadedSkills],
        requiredPhases: [...state.requiredPhases],
        completedPhases: [...state.completedPhases],
      },
      state.traceId,
      { stage: state.stage, boundary: stageOrEvent, missingSkills: missing },
      missing.length > 0
        ? `La traza ${state.traceId} llegó a ${stageOrEvent} sin cargar ${missing.length} skill(s) requerida(s).`
        : `La traza ${state.traceId} llegó a ${stageOrEvent} con obligaciones de routing incompletas.`,
      `La traza ${state.traceId} volvió a cumplir las obligaciones de routing de ${stageOrEvent}.`,
      missing.length > 0
        ? { code: "mssr-required-skill-not-loaded", errorCode: "mssr-required-skill-not-loaded" }
        : {},
    );
    if (compliance) output.push(compliance);

    const closure = getMssrTraceClosureState(lifecycle);
    if (closure.closureDue && !closure.canCloseSuccess) {
      output.push(notice(
        "warning",
        "mssr-trace-closure-due",
        toolName,
        `La traza ${state.traceId} está en cierre y todavía requiere '${closure.nextRequiredAction}' antes de un outcome success.`,
        {
          traceId: state.traceId,
          stage: state.stage,
          boundary: stageOrEvent,
          ...closure,
        },
        `mssr-trace-closure-due:${state.traceId}:${state.lifecycleRevision}:${closure.nextRequiredAction}`,
        [{
          label: "Revisar cierre MSSR",
          toolName: "mssr_trace_evidence",
          arguments: { traceId: state.traceId },
          instruction: `Continúa la misma traza y completa el gate '${closure.nextRequiredAction}'. No registres success hasta que canCloseSuccess=true.`,
        }],
      ));
    }
    return output;
  }

  function findRouteContinuation(toolName: string, args: JsonRecord, notices: BridgeNoticeInput[]): ActiveTraceState | null {
    const fingerprint = taskFingerprint(args.task);
    if (!fingerprint) return null;
    const caller = normalizedCaller(args.caller);
    const taskMatches = scopedCandidates(openSharedTraces()).filter((state) => state.taskHash === fingerprint);
    const callerMatches = taskMatches.filter((state) => state.caller === caller);
    return uniqueCandidate(toolName, callerMatches.length > 0 ? callerMatches : taskMatches, notices);
  }

  function findToolCandidate(toolName: string, args: JsonRecord, notices: BridgeNoticeInput[]): ActiveTraceState | null {
    let resolution = scopedCandidateResolution(autoRecoverySharedTraces());
    if (resolution.candidates.length === 0) resolution = persistedCandidateResolution();
    const traces = resolution.candidates;
    if (resolution.relaxedHostScope && traces.length > 1) {
      uniqueCandidate(toolName, traces, notices);
      return null;
    }
    if (toolName === "skill_load") {
      const skillName = typeof args.name === "string" ? args.name : "";
      if (!skillName) return null;
      const compatible = traces.filter((state) => state.selectedSkills.has(skillName) && !state.loadedSkills.has(skillName));
      const required = compatible.filter((state) => state.requiredSkills.has(skillName));
      return uniqueCandidate(toolName, required.length > 0 ? required : compatible, notices);
    }

    if (toolName === "mssr_trace_record") {
      const caller = normalizedCaller(args.caller);
      const primarySkill = typeof args.primarySkill === "string" ? args.primarySkill : "";
      let compatible = traces.filter((state) => state.caller === caller);
      if (primarySkill) compatible = compatible.filter((state) => state.selectedSkills.has(primarySkill));
      if (compatible.length === 0 && caller === "other") compatible = traces;
      return uniqueCandidate(toolName, compatible, notices);
    }

    return uniqueCandidate(toolName, traces, notices);
  }

  function prepare(
    toolName: string,
    rawArgs: JsonRecord,
    context: MssrTraceHostContext = {},
  ): MssrTracePreparation {
    hostContext = {
      caller: normalizedCaller(context.caller),
      sessionKey: normalizedScopeValue(context.sessionKey),
      project: normalizedScopeValue(context.project),
      workflowKey: normalizedScopeValue(context.workflowKey),
    };
    const args: JsonRecord = { ...rawArgs };
    const notices: BridgeNoticeInput[] = [];
    if (TRACE_DISPATCH_TOOLS.has(toolName)) {
      const delegatedTool = typeof args.toolName === "string" ? args.toolName.trim() : "";
      if (!delegatedTool || TRACE_DISPATCH_TOOLS.has(delegatedTool)) return { args, notices };
      const delegatedInput = { ...(asRecord(args.arguments) ?? {}) };
      const legacyNestedTraceId = validTraceId(delegatedInput.traceId) ? String(delegatedInput.traceId).trim() : null;
      const controlTraceId = validTraceId(args.traceId) ? String(args.traceId).trim() : legacyNestedTraceId;
      const targetAcceptsTraceId = traceAwareTools.has(delegatedTool) || ROUTE_TOOLS.has(delegatedTool);
      if (controlTraceId && delegatedInput.traceId === undefined) delegatedInput.traceId = controlTraceId;
      const delegated = prepare(delegatedTool, delegatedInput, hostContext);
      if (controlTraceId && !targetAcceptsTraceId && delegated.args.traceId === controlTraceId) delete delegated.args.traceId;
      args.arguments = delegated.args;
      notices.push(...delegated.notices);
      return { args, notices, blocked: delegated.blocked };
    }

    const explicitTrace = validTraceId(args.traceId) ? String(args.traceId).trim() : null;
    if (explicitTrace) {
      const state = sharedTraces.get(explicitTrace) ?? restore(explicitTrace);
      if (state) adopt(state);
    }
    const activeBeforeCall = localState(toolName === "mssr_trace_record", !explicitTrace);
    if (activeBeforeCall) clearClosureTimer(activeBeforeCall.traceId);

    if (ROUTE_TOOLS.has(toolName)) {
      const stage = typeof args.stage === "string" ? args.stage : "start";
      const fingerprint = taskFingerprint(args.task);
      let state = localState(false, !explicitTrace);
      const sameTask = Boolean(state && fingerprint && fingerprint === state.taskHash);
      const continuingStage = stage !== "start";

      if (!explicitTrace && state && (sameTask || continuingStage)) {
        args.traceId = state.traceId;
      } else if (!explicitTrace && !state && continuingStage) {
        state = findRouteContinuation(toolName, args, notices);
        if (state) args.traceId = state.traceId;
      } else if (!explicitTrace && state && stage === "start" && !sameTask) {
        const projected = routingComplianceNotice(
          toolName,
          `routing-trace:${state.traceId}`,
          {
            trace: "matched",
            route: "present",
            boundary: "route-replacement",
            activeTraceReplacedBeforeOutcome: true,
          },
          state.traceId,
          { previousTraceId: state.traceId, previousStage: state.stage },
          `Se inició otra tarea mientras la traza ${state.traceId} todavía no tenía outcome.`,
          `La traza ${state.traceId} ya no tiene un reemplazo pendiente antes de su outcome.`,
          { code: "mssr-active-trace-replaced-before-outcome" },
        );
        if (projected) notices.push(projected);
      } else if (explicitTrace && state && explicitTrace !== state.traceId && continuingStage) {
        const projected = routingComplianceNotice(
          toolName,
          `routing-trace:${state.traceId}`,
          { trace: "mismatch", route: "present", boundary: "phase-boundary" },
          state.traceId,
          { activeTraceId: state.traceId, suppliedTraceId: explicitTrace, stage },
          `El replan usa ${explicitTrace}, pero la sesión tenía activa ${state.traceId}.`,
          `El replan volvió a usar la traza compatible con la sesión.`,
          { code: "mssr-trace-mismatch", errorCode: "mssr-trace-mismatch" },
        );
        if (projected) notices.push(projected);
      }

      state = localState(false, !explicitTrace);
      if (toolName !== "skill_bootstrap" && state && TRACE_BOUNDARY_STAGES.has(stage)) {
        notices.push(...boundaryNotice(toolName, stage, state));
      }
      return { args, notices };
    }

    if (!traceAwareTools.has(toolName)) return { args, notices };

    let state = localState(toolName === "mssr_trace_record", !explicitTrace);
    if (!explicitTrace && !state) state = findToolCandidate(toolName, args, notices);
    if (state) clearClosureTimer(state.traceId);

    if (!explicitTrace && state) {
      args.traceId = state.traceId;
    } else if (!explicitTrace) {
      const alreadyAmbiguous = notices.some((item) => item.code === "mssr-trace-ambiguous");
      if (!alreadyAmbiguous) {
        const code = toolName === "skill_load" ? "mssr-orphan-skill-load" : "mssr-trace-missing";
        const message = toolName === "skill_load"
          ? "Se intentó cargar una skill sin una ruta MSSR activa o inequívoca."
          : `${toolName} admite traceId, pero no existe una ruta MSSR activa e inequívoca para propagar.`;
        const projected = routingComplianceNotice(
          toolName,
          `routing-host:${hostContext.sessionKey}:${hostContext.project}:${hostContext.caller}`,
          {
            trace: "missing",
            route: "missing",
            boundary: toolName === "skill_load" ? "skill-load" : "ordinary",
          },
          null,
          { localTraceId, sharedOpenTraces: openSharedTraces().length },
          message,
          `La sesión volvió a tener una traza MSSR activa e inequívoca para ${toolName}.`,
          { code },
        );
        if (projected) notices.push(projected);
      }
    } else if (state && explicitTrace !== state.traceId && !state.closed) {
      const projected = routingComplianceNotice(
        toolName,
        `routing-trace:${state.traceId}`,
        { trace: "mismatch", route: "present", boundary: toolName === "skill_load" ? "skill-load" : "ordinary" },
        state.traceId,
        { activeTraceId: state.traceId, suppliedTraceId: explicitTrace, stage: state.stage },
        `${toolName} recibió ${explicitTrace}, pero la sesión tenía activa ${state.traceId}.`,
        `${toolName} volvió a usar una traza compatible con la sesión.`,
        { code: "mssr-trace-mismatch", errorCode: "mssr-trace-mismatch" },
      );
      if (projected) notices.push(projected);
    }

    if (state && (!explicitTrace || explicitTrace === state.traceId)) {
      const resolved = routingComplianceNotice(
        toolName,
        `routing-host:${hostContext.sessionKey}:${hostContext.project}:${hostContext.caller}`,
        { trace: "matched", route: "present", boundary: toolName === "skill_load" ? "skill-load" : "ordinary" },
        state.traceId,
        { stage: state.stage },
        `${toolName} usa una traza MSSR compatible.`,
        `La sesión volvió a tener una traza MSSR activa e inequívoca para ${toolName}.`,
      );
      if (resolved) notices.push(resolved);
    }

    if (state && stageAwareTools.has(toolName) && typeof args.stage !== "string") args.stage = state.stage;

    if (toolName === "skill_load" && state) {
      const skillName = typeof args.name === "string" ? args.name : "";
      if (skillName && state.requiredSkills.has(skillName) && args.required === undefined) args.required = true;
    }

    if (toolName === "mssr_trace_record") {
      const eventType = typeof args.eventType === "string" ? args.eventType : "";
      if (TRACE_BOUNDARY_EVENTS.has(eventType)) notices.push(...boundaryNotice(toolName, eventType, state));
      const lifecycleViolations = validateMssrCheckpointLifecycle(
        state ? portableLifecycle(state) : null,
        args,
      );
      // A stale maintenance close can coexist with the generic close violation
      // after resume/persistence. Prefer the actionable, more specific repair
      // over the first portable-contract item.
      const lifecycleBlock = lifecycleViolations.find((item) => item.code === "mssr-success-outcome-blocked-stale-close")
        ?? lifecycleViolations.find((item) => item.blocking);
      if (state && lifecycleBlock?.code === "mssr-success-outcome-blocked-required-skills") {
        const missing = lifecycleBlock.missingSkills ?? [];
        const blocked = {
          code: "mssr-success-outcome-blocked-required-skills",
          message: `No se puede cerrar con éxito la traza ${state.traceId}: faltan ${missing.length} skill(s) requerida(s).`,
          details: {
            traceId: state.traceId,
            stage: state.stage,
            missingSkills: missing,
            recovery: "Carga las skills requeridas y vuelve a registrar un único outcome.",
          },
        };
        notices.push(notice(
          "error",
          blocked.code,
          toolName,
          blocked.message,
          blocked.details,
          `${blocked.code}:${state.traceId}:${missing.join(",")}`,
        ));
        return { args, notices, blocked };
      }
      if (state && lifecycleBlock?.code === "mssr-success-outcome-blocked-stale-close") {
        const blocked = {
          code: "mssr-success-outcome-blocked-stale-close",
          message: `No se puede cerrar con éxito la traza ${state.traceId}: el último cierre con maintenance quedó stale después de trabajo o persistencia posterior.`,
          details: {
            traceId: state.traceId,
            stage: state.stage,
            maintenanceRequired: state.maintenanceRequired,
            lifecycleRevision: state.lifecycleRevision,
            closeRevision: state.closeRevision,
            maintenanceRevision: state.maintenanceRevision,
            recovery: "Replanifica la misma traza en stage=close después de la última persistencia, completa maintenance y recién entonces registra el outcome.",
          },
        };
        notices.push(notice(
          "error",
          blocked.code,
          toolName,
          blocked.message,
          blocked.details,
          `${blocked.code}:${state.traceId}:${state.lifecycleRevision}:${state.closeRevision}:${state.maintenanceRevision}`,
          [{
            label: "Replanificar cierre MSSR",
            toolName: "skill_bootstrap",
            instruction: "Reusa esta traceId y la tarea/contexto resueltos, avanza a stage=close, ejecuta las skills requeridas de maintenance y registra phase_completed antes del outcome.",
          }],
        ));
        return { args, notices, blocked };
      }
      if (eventType === "outcome" && !state) {
        const projected = routingComplianceNotice(
          toolName,
          `routing-host:${hostContext.sessionKey}:${hostContext.project}:${hostContext.caller}`,
          { trace: "missing", route: "missing", boundary: "outcome" },
          explicitTrace,
          { suppliedTraceId: explicitTrace, sharedOpenTraces: openSharedTraces().length },
          "Se intentó registrar un outcome sin una ruta MSSR activa e inequívoca.",
          "La sesión volvió a tener una ruta MSSR inequívoca antes del outcome.",
          { code: "mssr-outcome-without-route", errorCode: "mssr-outcome-without-route" },
        );
        if (projected) notices.push(projected);
      }
    }

    return { args, notices };
  }

  function observe(toolName: string, args: JsonRecord, result: unknown): BridgeNoticeInput[] {
    const notices: BridgeNoticeInput[] = [];
    const record = asRecord(result);
    if (TRACE_DISPATCH_TOOLS.has(toolName) && record) {
      const delegatedTool = typeof args.toolName === "string" ? args.toolName.trim() : "";
      if (!delegatedTool || TRACE_DISPATCH_TOOLS.has(delegatedTool)) return notices;
      return observe(delegatedTool, asRecord(args.arguments) ?? {}, record.result);
    }

    if (ROUTE_TOOLS.has(toolName) && record && validTraceId(record.traceId)) {
      const traceId = String(record.traceId).trim();
      const previous = sharedTraces.get(traceId);
      const now = Date.now();
      const stage = typeof record.stage === "string" ? record.stage : typeof args.stage === "string" ? args.stage : "start";
      const lifecycle = reduceMssrRouteLifecycle(
        previous ? portableLifecycle(previous) : null,
        { ...record, stage },
      );
      const intentParsed = structuredSkillIntentSchema.safeParse(record.intent ?? args.intent);
      const state: ActiveTraceState = {
        traceId,
        workflowKey: previous?.workflowKey
          ?? (normalizedText(record.workflowKey, 80) || normalizedText(args.workflowKey, 80) || "unscoped"),
        stage: lifecycle.stage,
        taskHash: taskFingerprint(args.task),
        caller: normalizedCaller(args.caller ?? hostContext.caller),
        model: normalizeModelIdentifier(asRecord(record.agentProfile)?.model ?? args.model),
        reasoningEffort: normalizedText(asRecord(record.agentProfile)?.reasoningEffort, 20)
          || normalizedText(args.reasoningEffort, 20)
          || "unknown",
        sessionKey: previous && previous.sessionKey !== "unknown" ? previous.sessionKey : hostContext.sessionKey,
        project: previous && previous.project !== "unknown" ? previous.project : hostContext.project,
        projectRootHint: previous?.projectRootHint ?? normalizeProjectRootHint(args.projectRoot) ?? null,
        intent: intentParsed.success ? intentParsed.data : previous?.intent ?? null,
        changedPathHints: previous?.changedPathHints ?? new Set(),
        observedToolNames: previous?.observedToolNames ?? new Set(),
        materialWrites: previous?.materialWrites ?? 0,
        packageChanged: previous?.packageChanged ?? false,
        runtimeChanged: previous?.runtimeChanged ?? false,
        routingChanged: previous?.routingChanged ?? false,
        skillStructureChanged: previous?.skillStructureChanged ?? false,
        contextFreshnessIssues: previous?.contextFreshnessIssues ?? 0,
        projectInitialized: previous?.projectInitialized ?? null,
        projectContextHealth: previous?.projectContextHealth ?? null,
        userCorrections: previous?.userCorrections ?? 0,
        projectMaintenanceAdvisory: previous?.projectMaintenanceAdvisory ?? null,
        projectMaintenanceAttention: previous?.projectMaintenanceAttention ?? null,
        contextFreshnessAttention: previous?.contextFreshnessAttention ?? null,
        lifecycleAttention: previous?.lifecycleAttention ?? null,
        requiredSkills: new Set(lifecycle.requiredSkills),
        selectedSkills: new Set(lifecycle.selectedSkills),
        loadedSkills: new Set(lifecycle.loadedSkills),
        requiredPhases: new Set(lifecycle.requiredPhases),
        completedPhases: new Set(lifecycle.completedPhases),
        routeCount: lifecycle.routeCount,
        closed: lifecycle.closed,
        maintenanceRequired: lifecycle.maintenanceRequired,
        lifecycleRevision: lifecycle.lifecycleRevision,
        closeRevision: lifecycle.closeRevision,
        maintenanceRevision: lifecycle.maintenanceRevision,
        updatedAt: now,
        lastRoutePlannedAt: now,
        lastToolCompletedAt: previous?.lastToolCompletedAt ?? null,
        lastToolName: previous?.lastToolName ?? null,
        toolActivityVersion: previous?.toolActivityVersion ?? 0,
        closureReminderVersion: previous?.closureReminderVersion ?? 0,
        progressLeaseUntil: previous?.progressLeaseUntil ?? 0,
      };
      notices.push(...observeProjectMaintenanceMetadata(state, toolName, args, record));
      if (toolName === "skill_bootstrap") {
        if (TRACE_BOUNDARY_STAGES.has(state.stage)) {
          notices.push(...boundaryNotice(toolName, state.stage, state));
        }
      }
      sharedTraces.set(traceId, state);
      adopt(state);
      pruneSharedTraces(now);
      scheduleClosureReminder(state, toolName);
      return notices;
    }

    if (toolName === "skill_load" && record && validTraceId(record.traceId)) {
      const state = sharedTraces.get(String(record.traceId));
      const name = typeof args.name === "string" ? args.name : "";
      if (state && name) {
        const lifecycle = reduceMssrSkillLoadLifecycle(portableLifecycle(state), name);
        applyPortableLifecycle(state, lifecycle);
        adopt(state);
      }
    }

    if (toolName === "mssr_trace_record" && record && validTraceId(record.traceId)) {
      const state = sharedTraces.get(String(record.traceId));
      if (state) {
        if (args.eventType === "progress") {
          const leaseMs = Math.min(15 * 60_000, Math.max(30_000, Number(args.leaseMs) || 5 * 60_000));
          state.progressLeaseUntil = Date.now() + leaseMs;
          state.updatedAt = Date.now();
        }
        const lifecycle = reduceMssrCheckpointLifecycle(portableLifecycle(state), args);
        applyPortableLifecycle(state, lifecycle);
        if (args.eventType === "progress" || args.eventType === "outcome") {
          const lifecycleNotice = lifecycleOperationalNotice(state, false, { resolvedBy: args.eventType });
          if (lifecycleNotice) notices.push(lifecycleNotice);
        }
        if (args.eventType === "outcome") {
          state.progressLeaseUntil = 0;
          clearClosureTimer(state.traceId);
          purgeMssrTraceWorkingMemory(state.traceId);
        }
        if (args.eventType !== "outcome") {
          notices.push(...observeProjectMaintenanceMetadata(state, toolName, args, record));
        }
        if (state.projectMaintenanceAdvisory) {
          const maintenanceNotice = projectMaintenanceNotice(state, state.projectMaintenanceAdvisory);
          if (maintenanceNotice) notices.push(maintenanceNotice);
        }
        adopt(state);
        if (args.eventType !== "outcome") scheduleClosureReminder(state, toolName);
      }
      return notices;
    }

    const state = localState(false, !validTraceId(args.traceId));
    if (state) {
      notices.push(...observeProjectMaintenanceMetadata(state, toolName, args, record));
      scheduleClosureReminder(state, toolName);
    }
    return notices;
  }

  function snapshot(): MssrTraceSessionSnapshot {
    const state = localState(true);
    return {
      active: Boolean(state),
      traceId: state?.traceId ?? null,
      workflowKey: state?.workflowKey ?? null,
      taskHash: state?.taskHash ?? null,
      stage: state?.stage ?? null,
      caller: state?.caller ?? null,
      model: state?.model ?? null,
      reasoningEffort: state?.reasoningEffort ?? null,
      sessionKey: state?.sessionKey ?? null,
      project: state?.project ?? null,
      projectMaintenance: state ? {
        level: state.projectMaintenanceAdvisory?.level ?? "none",
        due: state.projectMaintenanceAdvisory?.due ?? false,
        projectRootKnown: Boolean(state.projectRootHint),
        materialWrites: state.materialWrites,
        changedPathHints: [...state.changedPathHints].slice(0, 24),
        observedToolNames: [...state.observedToolNames].slice(0, 24),
        packageChanged: state.packageChanged,
        runtimeChanged: state.runtimeChanged,
        routingChanged: state.routingChanged,
        skillStructureChanged: state.skillStructureChanged,
        contextFreshnessIssues: state.contextFreshnessIssues,
        projectInitialized: state.projectInitialized,
        projectContextHealth: state.projectContextHealth,
        userCorrections: state.userCorrections,
        targets: (state.projectMaintenanceAdvisory?.targets ?? []).map((target) => ({
          target: target.target,
          level: target.level,
          authority: target.authority,
          reasons: target.reasons.slice(0, 8),
        })),
      } : null,
      routeCount: state?.routeCount ?? 0,
      closed: state?.closed ?? false,
      maintenanceRequired: state?.maintenanceRequired ?? false,
      lifecycleRevision: state?.lifecycleRevision ?? 0,
      closeRevision: state?.closeRevision ?? 0,
      maintenanceRevision: state?.maintenanceRevision ?? 0,
      maintenanceCloseFresh: state ? hasFreshMaintenanceClose(portableLifecycle(state)) : true,
      requiredSkills: state ? [...state.requiredSkills].sort() : [],
      loadedSkills: state ? [...state.loadedSkills].sort() : [],
      missingRequiredSkills: state ? missingRequiredSkills(portableLifecycle(state)) : [],
      requiredPhases: state ? [...state.requiredPhases].sort() : [],
      completedPhases: state ? [...state.completedPhases].sort() : [],
      closure: state ? getMssrTraceClosureState(portableLifecycle(state)) : null,
      staleForAutoRecovery: state ? !autoRecoverySharedTraces().some((candidate) => candidate.traceId === state.traceId) : false,
      progressLeaseUntil: state?.progressLeaseUntil ? new Date(state.progressLeaseUntil).toISOString() : null,
      progressLeaseRemainingMs: state ? Math.max(0, state.progressLeaseUntil - Date.now()) : 0,
      sharedOpenTraces: openSharedTraces().length,
      autoRecoveryOpenTraces: autoRecoverySharedTraces().length,
    };
  }

  function resolveMetricContext(context: MssrTraceHostContext = {}): MssrTraceSessionSnapshot {
    hostContext = {
      caller: normalizedCaller(context.caller),
      sessionKey: normalizedScopeValue(context.sessionKey),
      project: normalizedScopeValue(context.project),
      workflowKey: normalizedScopeValue(context.workflowKey),
    };
    let state = localState(true, true);
    if (!state || state.closed) {
      let resolution = scopedCandidateResolution(autoRecoverySharedTraces());
      if (resolution.candidates.length === 0) resolution = persistedCandidateResolution();
      if (resolution.candidates.length === 1) {
        state = adopt(resolution.candidates[0]);
      } else {
        localTraceId = null;
        state = null;
      }
    }
    return snapshot();
  }

  return { prepare, observe, snapshot, resolveMetricContext };
}

export function ageSharedMssrTraceForTests(traceId: string, ageMs: number): void {
  const state = sharedTraces.get(traceId);
  if (!state) throw new Error(`Unknown shared MSSR trace: ${traceId}`);
  const age = Math.max(0, ageMs);
  state.lastRoutePlannedAt = Date.now() - age;
  state.updatedAt = Date.now() - age;
}

export function resetSharedMssrTraceRegistryForTests(): void {
  for (const traceId of closureTimers.keys()) clearClosureTimer(traceId);
  sharedTraces.clear();
}
