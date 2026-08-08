import { createHash } from "node:crypto";
import {
  hasFreshMaintenanceClose,
  missingRequiredSkills,
  reduceMssrCheckpointLifecycle,
  reduceMssrRouteLifecycle,
  reduceMssrSkillLoadLifecycle,
  validateMssrCheckpointLifecycle,
  type MssrTraceLifecycleState,
} from "@mauroprime/mssr";
import type { BridgeNoticeAction, BridgeNoticeInput } from "./notices.js";
import { findPersistedMssrTraceCandidates, readPersistedMssrTraceState } from "./mssr-observatory.js";
import { normalizeModelIdentifier } from "./runtime-identity.js";

type JsonRecord = Record<string, unknown>;
type ToolSchemaLike = {
  name: string;
  inputSchema?: JsonRecord;
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
  requiredSkills: Set<string>;
  selectedSkills: Set<string>;
  loadedSkills: Set<string>;
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
  progressLeaseUntil: string | null;
  progressLeaseRemainingMs: number;
  sharedOpenTraces: number;
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
  let localTraceId: string | null = null;
  let hostContext: Required<MssrTraceHostContext> = {
    caller: "other",
    sessionKey: "unknown",
    project: "unknown",
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
    const timer = setTimeout(() => {
      closureTimers.delete(state.traceId);
      const current = sharedTraces.get(state.traceId);
      if (!current || current.closed || current.caller !== "chatgpt-web") return;
      if (current.toolActivityVersion !== activityVersion || current.closureReminderVersion >= activityVersion) return;
      current.closureReminderVersion = activityVersion;
      current.updatedAt = Date.now();
      const reminderNotice = notice(
        "warning",
        "mssr-web-outcome-missing-after-idle",
        "mssr-trace-context",
        `La traza Web ${current.traceId} usó herramientas y quedó ${reminderDelayMs} ms sin outcome observable. Si la tarea terminó, registra el cierre MSSR y devuelve el resultado; si sigue activa, registra un checkpoint progress con lease acotado o comunica un bloqueo concreto.`,
        {
          traceId: current.traceId,
          caller: current.caller,
          stage: current.stage,
          lastToolName: current.lastToolName,
          lastToolCompletedAt: current.lastToolCompletedAt
            ? new Date(current.lastToolCompletedAt).toISOString()
            : null,
          idleMs: reminderDelayMs,
          baseIdleMs: closureIdleMs,
          progressLeaseUntil: current.progressLeaseUntil > 0 ? new Date(current.progressLeaseUntil).toISOString() : null,
          activityVersion,
          missingRequiredSkills: missingRequiredSkills(portableLifecycle(current)),
          limitation: "Bridge observes MCP lifecycle, not whether ChatGPT rendered final text.",
        },
        `mssr-web-outcome-missing-after-idle:${current.traceId}:${activityVersion}`,
        [{
          label: "Revisar evidencia de cierre",
          toolName: "mssr_trace_evidence",
          arguments: { traceId: current.traceId },
          instruction: "Inspecciona la evidencia correlacionada y, sólo si la tarea realmente terminó, registra verification/persistence/outcome con datos observables en esta misma traza.",
        }],
      );
      options.onClosureReminder?.({
        traceId: current.traceId,
        caller: current.caller,
        stage: current.stage,
        toolName: current.lastToolName ?? toolName,
        idleMs: reminderDelayMs,
        activityVersion,
        notice: reminderNotice,
      });
    }, reminderDelayMs);
    timer.unref?.();
    closureTimers.set(state.traceId, timer);
  }

  function localState(allowClosed = false): ActiveTraceState | null {
    pruneSharedTraces();
    if (!localTraceId) return null;
    const state = sharedTraces.get(localTraceId) ?? null;
    if (!state || (!allowClosed && state.closed)) return null;
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
      requiredSkills: new Set(persisted.requiredSkills),
      selectedSkills: new Set(persisted.selectedSkills),
      loadedSkills: new Set(persisted.loadedSkills),
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
    if (candidates.length <= 1
      || hostContext.sessionKey === "unknown"
      || hostContext.project === "unknown") return candidates;
    const exact = candidates.filter((state) => state.sessionKey === hostContext.sessionKey
      && state.project === hostContext.project
      && (hostContext.caller === "other" || state.caller === hostContext.caller));
    if (exact.length === 1) return exact;
    if (exact.length === 0) return dominantFreshRouteCandidate(candidates);
    const now = Date.now();
    const freshRoutes = exact.filter((state) => now - state.lastRoutePlannedAt <= EXACT_HOST_ROUTE_DOMINANCE_MS);
    return freshRoutes.length === 1 ? freshRoutes : exact;
  }

  function dominantFreshRouteCandidate(candidates: ActiveTraceState[]): ActiveTraceState[] {
    if (candidates.length <= 1) return candidates;
    const now = Date.now();
    const freshRoutes = candidates.filter((state) => now - state.lastRoutePlannedAt <= EXACT_HOST_ROUTE_DOMINANCE_MS);
    return freshRoutes.length === 1 ? freshRoutes : candidates;
  }

  function scopedCandidateResolution(candidates: ActiveTraceState[]): {
    candidates: ActiveTraceState[];
    relaxedHostScope: boolean;
  } {
    let relaxedHostScope = false;
    if (hostContext.sessionKey !== "unknown") {
      const sessionMatches = candidates.filter((state) => state.sessionKey === hostContext.sessionKey);
      if (sessionMatches.length > 0) {
        return { candidates: dominantExactHostCandidate(sessionMatches), relaxedHostScope: false };
      }
      relaxedHostScope = true;
    }
    if (hostContext.project !== "unknown") {
      const projectMatches = candidates.filter((state) => state.project === hostContext.project);
      if (projectMatches.length > 0) {
        return { candidates: dominantFreshRouteCandidate(projectMatches), relaxedHostScope: false };
      }
      relaxedHostScope = true;
    }
    if (hostContext.caller !== "other") {
      return {
        candidates: candidates.filter((state) => state.caller === hostContext.caller),
        relaxedHostScope,
      };
    }
    return { candidates, relaxedHostScope };
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
        maxAgeMs: TRACE_LEASE_MS,
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
        maxAgeMs: TRACE_LEASE_MS,
        limit: 16,
      }));
      if (projectMatches.length > 0) {
        return { candidates: dominantFreshRouteCandidate(projectMatches), relaxedHostScope: false };
      }
    }
    const callerMatches = restorePersistedCandidates(findPersistedMssrTraceCandidates({
      caller: hostContext.caller,
      maxAgeMs: TRACE_LEASE_MS,
      limit: 16,
    }));
    return {
      candidates: dominantFreshRouteCandidate(callerMatches),
      relaxedHostScope: hostContext.sessionKey !== "unknown" || hostContext.project !== "unknown",
    };
  }

  function ambiguousNotice(toolName: string, candidates: ActiveTraceState[]): BridgeNoticeInput {
    return notice(
      "warning",
      "mssr-trace-ambiguous",
      toolName,
      `${toolName} encontró ${candidates.length} trazas compatibles; no se propagó ninguna para evitar mezclar agentes o tareas.`,
      { toolName, ...candidateDetails(candidates) },
      `mssr-trace-ambiguous:${toolName}:${candidates.map((state) => state.traceId).sort().join(",")}`,
      [{
        label: "Inspeccionar trazas MSSR",
        toolName: "mssr_observatory_query",
        instruction: "Identifica una única traza abierta y reintenta con su traceId explícito; no elijas por nombre de skill solamente.",
      }],
    );
  }

  function uniqueCandidate(toolName: string, candidates: ActiveTraceState[], notices: BridgeNoticeInput[]): ActiveTraceState | null {
    if (candidates.length === 1) return adopt(candidates[0]);
    if (candidates.length > 1) notices.push(ambiguousNotice(toolName, candidates));
    return null;
  }

  function boundaryNotice(toolName: string, stageOrEvent: string, state: ActiveTraceState | null): BridgeNoticeInput[] {
    if (!state || state.closed) return [];
    const missing = missingRequiredSkills(portableLifecycle(state));
    if (missing.length === 0) return [];
    return [notice(
      "warning",
      "mssr-required-skill-not-loaded",
      toolName,
      `La traza ${state.traceId} llegó a ${stageOrEvent} sin cargar ${missing.length} skill(s) requerida(s).`,
      { traceId: state.traceId, stage: state.stage, boundary: stageOrEvent, missingSkills: missing },
      `mssr-required-skill-not-loaded:${state.traceId}:${stageOrEvent}:${missing.join(",")}`,
      missing.slice(0, 4).map((name) => ({
        label: `Cargar ${name}`,
        toolName: "skill_load",
        arguments: { name, traceId: state.traceId, stage: state.stage, required: true },
        instruction: "Carga esta skill sobre la traza activa antes de cruzar el límite de fase.",
      })),
    )];
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
    let resolution = scopedCandidateResolution(openSharedTraces());
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
    const activeBeforeCall = localState(toolName === "mssr_trace_record");
    if (activeBeforeCall) clearClosureTimer(activeBeforeCall.traceId);

    if (ROUTE_TOOLS.has(toolName)) {
      const stage = typeof args.stage === "string" ? args.stage : "start";
      const fingerprint = taskFingerprint(args.task);
      let state = localState();
      const sameTask = Boolean(state && fingerprint && fingerprint === state.taskHash);
      const continuingStage = stage !== "start";

      if (!explicitTrace && state && (sameTask || continuingStage)) {
        args.traceId = state.traceId;
      } else if (!explicitTrace && !state && continuingStage) {
        state = findRouteContinuation(toolName, args, notices);
        if (state) args.traceId = state.traceId;
      } else if (!explicitTrace && state && stage === "start" && !sameTask) {
        notices.push(notice(
          "warning",
          "mssr-active-trace-replaced-before-outcome",
          toolName,
          `Se inició otra tarea mientras la traza ${state.traceId} todavía no tenía outcome.`,
          { previousTraceId: state.traceId, previousStage: state.stage },
          `mssr-active-trace-replaced-before-outcome:${state.traceId}`,
        ));
      } else if (explicitTrace && state && explicitTrace !== state.traceId && continuingStage) {
        notices.push(notice(
          "warning",
          "mssr-trace-mismatch",
          toolName,
          `El replan usa ${explicitTrace}, pero la sesión tenía activa ${state.traceId}.`,
          { activeTraceId: state.traceId, suppliedTraceId: explicitTrace, stage },
          `mssr-trace-mismatch:${state.traceId}:${explicitTrace}:${stage}`,
        ));
      }

      state = localState();
      if (toolName !== "skill_bootstrap" && state && TRACE_BOUNDARY_STAGES.has(stage)) {
        notices.push(...boundaryNotice(toolName, stage, state));
      }
      return { args, notices };
    }

    if (!traceAwareTools.has(toolName)) return { args, notices };

    let state = localState(toolName === "mssr_trace_record");
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
        notices.push(notice(
          "warning",
          code,
          toolName,
          message,
          { toolName, localTraceId, sharedOpenTraces: openSharedTraces().length },
          `${code}:${toolName}:${localTraceId ?? "none"}`,
          toolName === "skill_load"
            ? [{
                label: "Cargar fase con skill_bootstrap",
                toolName: "skill_bootstrap",
                instruction: "Usa la tarea, intent y traceId correctos para cargar automáticamente todas las skills de la fase; si existen varias trazas, inspecciónalas primero.",
              }, {
                label: "Inspeccionar trazas MSSR",
                toolName: "mssr_observatory_query",
                instruction: "Selecciona una única traza y reintenta skill_load con traceId explícito.",
              }]
            : [{
                label: "Inspeccionar trazas MSSR",
                toolName: "mssr_observatory_query",
                instruction: "Recupera una traza abierta inequívoca o abre una ruta nueva antes de reintentar.",
              }],
        ));
      }
    } else if (state && explicitTrace !== state.traceId && !state.closed) {
      notices.push(notice(
        "warning",
        "mssr-trace-mismatch",
        toolName,
        `${toolName} recibió ${explicitTrace}, pero la sesión tenía activa ${state.traceId}.`,
        { activeTraceId: state.traceId, suppliedTraceId: explicitTrace, stage: state.stage },
        `mssr-trace-mismatch:${state.traceId}:${explicitTrace}:${toolName}`,
      ));
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
      const lifecycleBlock = lifecycleViolations.find((item) => item.blocking);
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
        notices.push(notice(
          "warning",
          "mssr-outcome-without-route",
          toolName,
          "Se intentó registrar un outcome sin una ruta MSSR activa e inequívoca.",
          { suppliedTraceId: explicitTrace, sharedOpenTraces: openSharedTraces().length },
          `mssr-outcome-without-route:${explicitTrace ?? "none"}`,
        ));
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
        requiredSkills: new Set(lifecycle.requiredSkills),
        selectedSkills: new Set(lifecycle.selectedSkills),
        loadedSkills: new Set(lifecycle.loadedSkills),
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
        if (args.eventType === "outcome") {
          state.progressLeaseUntil = 0;
          clearClosureTimer(state.traceId);
        }
        adopt(state);
        if (args.eventType !== "outcome") scheduleClosureReminder(state, toolName);
      }
      return notices;
    }

    const state = localState();
    if (state) scheduleClosureReminder(state, toolName);
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
      progressLeaseUntil: state?.progressLeaseUntil ? new Date(state.progressLeaseUntil).toISOString() : null,
      progressLeaseRemainingMs: state ? Math.max(0, state.progressLeaseUntil - Date.now()) : 0,
      sharedOpenTraces: openSharedTraces().length,
    };
  }

  function resolveMetricContext(context: MssrTraceHostContext = {}): MssrTraceSessionSnapshot {
    hostContext = {
      caller: normalizedCaller(context.caller),
      sessionKey: normalizedScopeValue(context.sessionKey),
      project: normalizedScopeValue(context.project),
    };
    let state = localState(true);
    if (!state || state.closed) {
      let resolution = scopedCandidateResolution(openSharedTraces());
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
