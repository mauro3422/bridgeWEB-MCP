import { createHash } from "node:crypto";
import type { BridgeNoticeInput } from "./notices.js";

type JsonRecord = Record<string, unknown>;
type ToolSchemaLike = {
  name: string;
  inputSchema?: JsonRecord;
};

type ActiveTraceState = {
  traceId: string;
  stage: string;
  taskHash: string;
  caller: string;
  requiredSkills: Set<string>;
  selectedSkills: Set<string>;
  loadedSkills: Set<string>;
  routeCount: number;
  closed: boolean;
  updatedAt: number;
};

const ROUTE_TOOLS = new Set(["skill_recommend", "skill_route_plan", "skill_bootstrap"]);
const TRACE_QUERY_TOOLS = new Set(["mssr_observatory_query"]);
const TRACE_DISPATCH_TOOLS = new Set(["bridge_tool_query", "bridge_tool_action"]);
const TRACE_BOUNDARY_STAGES = new Set(["verify", "persist", "close"]);
const TRACE_BOUNDARY_EVENTS = new Set(["verification", "persistence", "outcome"]);
const TRACE_LEASE_MS = Math.max(60_000, Number(process.env.BRIDGE_MCP_MSSR_TRACE_LEASE_MS) || 2 * 60 * 60 * 1_000);
const CLOSED_TRACE_RETENTION_MS = Math.min(TRACE_LEASE_MS, 15 * 60 * 1_000);
const MAX_SHARED_TRACES = 128;
const sharedTraces = new Map<string, ActiveTraceState>();

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

function validTraceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{6,128}$/.test(value.trim());
}

function schemaPropertyExists(schema: ToolSchemaLike, propertyName: string): boolean {
  const input = asRecord(schema.inputSchema);
  const properties = asRecord(input?.properties);
  return Boolean(properties && Object.prototype.hasOwnProperty.call(properties, propertyName));
}

function routeSkills(value: unknown): Array<{ name: string; required: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.name !== "string") return [];
    return [{ name: record.name, required: record.required === true }];
  });
}

function loadedSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const skill = asRecord(record?.skill);
    if (!record || record.loaded !== true || typeof skill?.name !== "string") return [];
    return [skill.name];
  });
}

function missingRequired(state: ActiveTraceState | null): string[] {
  if (!state) return [];
  return [...state.requiredSkills].filter((name) => !state.loadedSkills.has(name)).sort();
}

function notice(
  severity: "info" | "warning" | "error",
  code: string,
  source: string,
  message: string,
  details: JsonRecord,
  dedupeKey: string,
): BridgeNoticeInput {
  return { severity, code, source, message, details, dedupeKey };
}

function pruneSharedTraces(now = Date.now()): void {
  for (const [traceId, state] of sharedTraces) {
    const retention = state.closed ? CLOSED_TRACE_RETENTION_MS : TRACE_LEASE_MS;
    if (now - state.updatedAt > retention) sharedTraces.delete(traceId);
  }
  if (sharedTraces.size <= MAX_SHARED_TRACES) return;
  const oldest = [...sharedTraces.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const state of oldest.slice(0, sharedTraces.size - MAX_SHARED_TRACES)) sharedTraces.delete(state.traceId);
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
      stage: state.stage,
      caller: state.caller,
      missingRequiredSkills: missingRequired(state),
      ageMs: Math.max(0, Date.now() - state.updatedAt),
    })),
  };
}

export type MssrTracePreparation = {
  args: JsonRecord;
  notices: BridgeNoticeInput[];
};

export type MssrTraceSessionSnapshot = {
  active: boolean;
  traceId: string | null;
  stage: string | null;
  routeCount: number;
  closed: boolean;
  requiredSkills: string[];
  loadedSkills: string[];
  missingRequiredSkills: string[];
  sharedOpenTraces: number;
};

export function createMssrTraceSessionCoordinator(toolSchemas: readonly ToolSchemaLike[]) {
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

  function ambiguousNotice(toolName: string, candidates: ActiveTraceState[]): BridgeNoticeInput {
    return notice(
      "warning",
      "mssr-trace-ambiguous",
      toolName,
      `${toolName} encontró ${candidates.length} trazas compatibles; no se propagó ninguna para evitar mezclar agentes o tareas.`,
      { toolName, ...candidateDetails(candidates) },
      `mssr-trace-ambiguous:${toolName}:${candidates.map((state) => state.traceId).sort().join(",")}`,
    );
  }

  function uniqueCandidate(toolName: string, candidates: ActiveTraceState[], notices: BridgeNoticeInput[]): ActiveTraceState | null {
    if (candidates.length === 1) return adopt(candidates[0]);
    if (candidates.length > 1) notices.push(ambiguousNotice(toolName, candidates));
    return null;
  }

  function boundaryNotice(toolName: string, stageOrEvent: string, state: ActiveTraceState | null): BridgeNoticeInput[] {
    if (!state || state.closed) return [];
    const missing = missingRequired(state);
    if (missing.length === 0) return [];
    return [notice(
      "warning",
      "mssr-required-skill-not-loaded",
      toolName,
      `La traza ${state.traceId} llegó a ${stageOrEvent} sin cargar ${missing.length} skill(s) requerida(s).`,
      { traceId: state.traceId, stage: state.stage, boundary: stageOrEvent, missingSkills: missing },
      `mssr-required-skill-not-loaded:${state.traceId}:${stageOrEvent}:${missing.join(",")}`,
    )];
  }

  function findRouteContinuation(toolName: string, args: JsonRecord, notices: BridgeNoticeInput[]): ActiveTraceState | null {
    const fingerprint = taskFingerprint(args.task);
    if (!fingerprint) return null;
    const caller = normalizedCaller(args.caller);
    const taskMatches = openSharedTraces().filter((state) => state.taskHash === fingerprint);
    const callerMatches = taskMatches.filter((state) => state.caller === caller);
    return uniqueCandidate(toolName, callerMatches.length > 0 ? callerMatches : taskMatches, notices);
  }

  function findToolCandidate(toolName: string, args: JsonRecord, notices: BridgeNoticeInput[]): ActiveTraceState | null {
    const traces = openSharedTraces();
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

  function prepare(toolName: string, rawArgs: JsonRecord): MssrTracePreparation {
    const args: JsonRecord = { ...rawArgs };
    const notices: BridgeNoticeInput[] = [];
    if (TRACE_DISPATCH_TOOLS.has(toolName)) {
      const delegatedTool = typeof args.toolName === "string" ? args.toolName.trim() : "";
      if (!delegatedTool || TRACE_DISPATCH_TOOLS.has(delegatedTool)) return { args, notices };
      const delegated = prepare(delegatedTool, asRecord(args.arguments) ?? {});
      args.arguments = delegated.args;
      notices.push(...delegated.notices);
      return { args, notices };
    }

    const explicitTrace = validTraceId(args.traceId) ? String(args.traceId).trim() : null;
    if (explicitTrace && sharedTraces.has(explicitTrace)) adopt(sharedTraces.get(explicitTrace)!);

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
      if (state && TRACE_BOUNDARY_STAGES.has(stage)) notices.push(...boundaryNotice(toolName, stage, state));
      return { args, notices };
    }

    if (!traceAwareTools.has(toolName)) return { args, notices };

    let state = localState(toolName === "mssr_trace_record");
    if (!explicitTrace && !state) state = findToolCandidate(toolName, args, notices);

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
      const skills = routeSkills(record.activeSkills);
      const now = Date.now();
      const state: ActiveTraceState = {
        traceId,
        stage: typeof record.stage === "string" ? record.stage : typeof args.stage === "string" ? args.stage : "start",
        taskHash: taskFingerprint(args.task),
        caller: normalizedCaller(args.caller),
        requiredSkills: new Set([
          ...(previous ? previous.requiredSkills : []),
          ...skills.filter((skill) => skill.required).map((skill) => skill.name),
        ]),
        selectedSkills: new Set([
          ...(previous ? previous.selectedSkills : []),
          ...skills.map((skill) => skill.name),
        ]),
        loadedSkills: previous ? new Set(previous.loadedSkills) : new Set<string>(),
        routeCount: previous ? previous.routeCount + 1 : 1,
        closed: false,
        updatedAt: now,
      };
      if (toolName === "skill_bootstrap") {
        for (const name of loadedSkillNames(record.loaded)) state.loadedSkills.add(name);
      }
      sharedTraces.set(traceId, state);
      adopt(state);
      pruneSharedTraces(now);
      return notices;
    }

    if (toolName === "skill_load" && record && validTraceId(record.traceId)) {
      const state = sharedTraces.get(String(record.traceId));
      const name = typeof args.name === "string" ? args.name : "";
      if (state && name) {
        state.loadedSkills.add(name);
        adopt(state);
      }
    }

    if (toolName === "mssr_trace_record" && record && validTraceId(record.traceId)) {
      const state = sharedTraces.get(String(record.traceId));
      if (state) {
        if (args.eventType === "outcome") state.closed = true;
        if (typeof args.stage === "string") state.stage = args.stage;
        adopt(state);
      }
    }

    return notices;
  }

  function snapshot(): MssrTraceSessionSnapshot {
    const state = localState(true);
    return {
      active: Boolean(state),
      traceId: state?.traceId ?? null,
      stage: state?.stage ?? null,
      routeCount: state?.routeCount ?? 0,
      closed: state?.closed ?? false,
      requiredSkills: state ? [...state.requiredSkills].sort() : [],
      loadedSkills: state ? [...state.loadedSkills].sort() : [],
      missingRequiredSkills: missingRequired(state),
      sharedOpenTraces: openSharedTraces().length,
    };
  }

  return { prepare, observe, snapshot };
}

export function resetSharedMssrTraceRegistryForTests(): void {
  sharedTraces.clear();
}
