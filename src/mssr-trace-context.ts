import type { BridgeNoticeInput } from "./notices.js";

type JsonRecord = Record<string, unknown>;
type ToolSchemaLike = {
  name: string;
  inputSchema?: JsonRecord;
};

type ActiveTraceState = {
  traceId: string;
  stage: string;
  taskKey: string;
  requiredSkills: Set<string>;
  loadedSkills: Set<string>;
  routeCount: number;
  closed: boolean;
};

const ROUTE_TOOLS = new Set(["skill_recommend", "skill_route_plan", "skill_bootstrap"]);
const TRACE_QUERY_TOOLS = new Set(["mssr_observatory_query"]);
const TRACE_DISPATCH_TOOLS = new Set(["bridge_tool_query", "bridge_tool_action"]);
const TRACE_BOUNDARY_STAGES = new Set(["verify", "persist", "close"]);
const TRACE_BOUNDARY_EVENTS = new Set(["verification", "persistence", "outcome"]);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalizedTask(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 2_000)
    : "";
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
  let active: ActiveTraceState | null = null;

  function boundaryNotice(toolName: string, stageOrEvent: string): BridgeNoticeInput[] {
    if (!active || active.closed) return [];
    const missing = missingRequired(active);
    if (missing.length === 0) return [];
    return [notice(
      "warning",
      "mssr-required-skill-not-loaded",
      toolName,
      `La traza ${active.traceId} llegó a ${stageOrEvent} sin cargar ${missing.length} skill(s) requerida(s).`,
      { traceId: active.traceId, stage: active.stage, boundary: stageOrEvent, missingSkills: missing },
      `mssr-required-skill-not-loaded:${active.traceId}:${stageOrEvent}:${missing.join(",")}`,
    )];
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

    if (ROUTE_TOOLS.has(toolName)) {
      const stage = typeof args.stage === "string" ? args.stage : "start";
      const taskKey = normalizedTask(args.task);
      const sameTask = Boolean(active && taskKey && taskKey === active.taskKey);
      const continuingStage = stage !== "start";

      if (!explicitTrace && active && !active.closed && (sameTask || continuingStage)) {
        args.traceId = active.traceId;
      } else if (!explicitTrace && active && !active.closed && stage === "start" && !sameTask) {
        notices.push(notice(
          "warning",
          "mssr-active-trace-replaced-before-outcome",
          toolName,
          `Se inició otra tarea mientras la traza ${active.traceId} todavía no tenía outcome.`,
          { previousTraceId: active.traceId, previousStage: active.stage },
          `mssr-active-trace-replaced-before-outcome:${active.traceId}`,
        ));
      } else if (explicitTrace && active && !active.closed && explicitTrace !== active.traceId && continuingStage) {
        notices.push(notice(
          "warning",
          "mssr-trace-mismatch",
          toolName,
          `El replan usa ${explicitTrace}, pero la sesión tenía activa ${active.traceId}.`,
          { activeTraceId: active.traceId, suppliedTraceId: explicitTrace, stage },
          `mssr-trace-mismatch:${active.traceId}:${explicitTrace}:${stage}`,
        ));
      }

      if (active && !active.closed && TRACE_BOUNDARY_STAGES.has(stage)) {
        notices.push(...boundaryNotice(toolName, stage));
      }
      return { args, notices };
    }

    if (!traceAwareTools.has(toolName)) return { args, notices };

    if (!explicitTrace && active && (!active.closed || toolName === "mssr_trace_record")) {
      args.traceId = active.traceId;
    } else if (!explicitTrace) {
      const code = toolName === "skill_load" ? "mssr-orphan-skill-load" : "mssr-trace-missing";
      const message = toolName === "skill_load"
        ? "Se intentó cargar una skill sin una ruta MSSR activa en esta sesión."
        : `${toolName} admite traceId, pero no existe una ruta MSSR activa para propagar.`;
      notices.push(notice(
        "warning",
        code,
        toolName,
        message,
        { toolName, activeTraceId: active?.traceId ?? null, activeClosed: active?.closed ?? null },
        `${code}:${toolName}:${active?.traceId ?? "none"}`,
      ));
    } else if (active && !active.closed && explicitTrace !== active.traceId) {
      notices.push(notice(
        "warning",
        "mssr-trace-mismatch",
        toolName,
        `${toolName} recibió ${explicitTrace}, pero la sesión tenía activa ${active.traceId}.`,
        { activeTraceId: active.traceId, suppliedTraceId: explicitTrace, stage: active.stage },
        `mssr-trace-mismatch:${active.traceId}:${explicitTrace}:${toolName}`,
      ));
    }

    if (active && stageAwareTools.has(toolName) && typeof args.stage !== "string") args.stage = active.stage;

    if (toolName === "skill_load" && active) {
      const skillName = typeof args.name === "string" ? args.name : "";
      if (skillName && active.requiredSkills.has(skillName) && args.required === undefined) args.required = true;
    }

    if (toolName === "mssr_trace_record") {
      const eventType = typeof args.eventType === "string" ? args.eventType : "";
      if (TRACE_BOUNDARY_EVENTS.has(eventType)) notices.push(...boundaryNotice(toolName, eventType));
      if (eventType === "outcome" && !active) {
        notices.push(notice(
          "warning",
          "mssr-outcome-without-route",
          toolName,
          "Se intentó registrar un outcome sin una ruta MSSR activa en esta sesión.",
          { suppliedTraceId: explicitTrace },
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
      const sameTrace = active?.traceId === traceId;
      const skills = routeSkills(record.activeSkills);
      active = {
        traceId,
        stage: typeof record.stage === "string" ? record.stage : typeof args.stage === "string" ? args.stage : "start",
        taskKey: normalizedTask(args.task),
        requiredSkills: new Set(skills.filter((skill) => skill.required).map((skill) => skill.name)),
        loadedSkills: sameTrace ? new Set(active?.loadedSkills ?? []) : new Set<string>(),
        routeCount: sameTrace ? (active?.routeCount ?? 0) + 1 : 1,
        closed: false,
      };
      if (toolName === "skill_bootstrap") {
        for (const name of loadedSkillNames(record.loaded)) active.loadedSkills.add(name);
      }
      return notices;
    }

    if (toolName === "skill_load" && active && record && validTraceId(record.traceId)) {
      const name = typeof args.name === "string" ? args.name : "";
      if (name && record.traceId === active.traceId) active.loadedSkills.add(name);
    }

    if (toolName === "mssr_trace_record" && active && record && record.traceId === active.traceId) {
      if (args.eventType === "outcome") active.closed = true;
      if (typeof args.stage === "string") active.stage = args.stage;
    }

    return notices;
  }

  function snapshot(): MssrTraceSessionSnapshot {
    return {
      active: Boolean(active),
      traceId: active?.traceId ?? null,
      stage: active?.stage ?? null,
      routeCount: active?.routeCount ?? 0,
      closed: active?.closed ?? false,
      requiredSkills: active ? [...active.requiredSkills].sort() : [],
      loadedSkills: active ? [...active.loadedSkills].sort() : [],
      missingRequiredSkills: missingRequired(active),
    };
  }

  return { prepare, observe, snapshot };
}
