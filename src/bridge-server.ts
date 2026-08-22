import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Server as ModernServer } from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { beginToolMetric, classifyMssrRoutingStatus, classifyToolAuditError, extractToolResultMetric, finishToolMetric, type BridgeMetricProfile } from "./metrics.js";
import {
  drainBridgeNotices,
  emitBridgeNotice,
  type BridgeNotice,
  type BridgeNoticeAction,
  type BridgeNoticeInput,
} from "./notices.js";
import { createDefaultToolRegistry } from "./tool-registry.js";
import {
  evaluatePreparedBridgeArchitectureImpact,
  prepareBridgeArchitectureImpactHostAdoption,
  type BridgeArchitectureImpactEvaluationResult,
} from "./architecture-impact-host-adapter.js";
import type { BridgeToolSchema } from "./tools/types.js";
import { createMssrTraceSessionCoordinator } from "./mssr-trace-context.js";
import { recordMssrEvent } from "./mssr-observatory.js";
import { createMssrRoutingComplianceNoticeTracker } from "./mssr-routing-compliance.js";
import { normalizeModelIdentifier, normalizeWorkflowKey, resolveMetricTaskKey, resolveMetricWorkflowKey } from "./runtime-identity.js";

export { SERVER_NAME, SERVER_VERSION } from "./config.js";
export { bridgeRestartStatus } from "./tools/bridge-ops.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type BridgeImageAttachment = { type: "image"; data: string; mimeType: string };
type ToolContentPart = { type: "text"; text: string } | BridgeImageAttachment;

const slowToolThresholdMs = Math.max(1000, Number(process.env.BRIDGE_MCP_NOTICE_SLOW_TOOL_MS || 45_000));
const largeOutputThresholdChars = Math.max(10_000, Number(process.env.BRIDGE_MCP_NOTICE_LARGE_OUTPUT_CHARS || 250_000));
const largeOutputExemptTools = new Set([
  "image_file_attach",
  "whiteboard_capture_pc_view",
  "whiteboard_latest_capture",
  "blender_review_bundle",
]);
const noticeInspectionTools = new Set(["bridge_notice_status", "bridge_notice_drain"]);
const mssrRouteTools = new Set([
  "skill_recommend",
  "skill_route_plan",
  "skill_bootstrap",
]);
const sessionProjects = new Map<string, string>();
const sessionProjectRoots = new Map<string, string>();
const sessionTaskKeys = new Map<string, string>();
const sessionWorkflowKeys = new Map<string, string>();
const maxScopedMetricEntries = 2048;

function validNoticeInput(value: unknown): value is BridgeNoticeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.severity === "info" || item.severity === "warning" || item.severity === "error")
    && typeof item.code === "string"
    && typeof item.source === "string"
    && typeof item.message === "string";
}

function extractInternalNotices(data: unknown): { payload: unknown; notices: BridgeNoticeInput[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { payload: data, notices: [] };
  const record = data as Record<string, unknown>;
  const notices = Array.isArray(record.__bridgeNotices)
    ? record.__bridgeNotices.filter(validNoticeInput)
    : [];
  if (!Object.prototype.hasOwnProperty.call(record, "__bridgeNotices")) return { payload: data, notices };
  const { __bridgeNotices: _internalNotices, ...payload } = record;
  return { payload, notices };
}

function toolContent(data: JsonValue | unknown, deliveredNotices: BridgeNotice[] = []) {
  let payload = data;
  let images: BridgeImageAttachment[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.__bridgeImages)) {
      images = record.__bridgeImages.filter((item): item is BridgeImageAttachment => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Record<string, unknown>;
        return candidate.type === "image"
          && typeof candidate.data === "string"
          && typeof candidate.mimeType === "string";
      });
    }
    const { __bridgeImages: _internalImages, __bridgeNotices: _internalNotices, ...publicPayload } = record;
    payload = publicPayload;
  }

  if (deliveredNotices.length > 0) {
    const bridgeNotices = {
      delivery: "automatic-drain",
      count: deliveredNotices.length,
      items: deliveredNotices,
    };
    payload = payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), bridgeNotices }
      : { result: payload, bridgeNotices };
  }

  const content: ToolContentPart[] = [
    { type: "text", text: JSON.stringify(payload, null, 2) },
    ...images,
  ];
  return { content };
}

function toolRecoveryActions(toolName: string, error: string | undefined, toolSchema?: BridgeToolSchema): BridgeNoticeAction[] {
  const category = classifyToolAuditError(error);
  const usage = toolSchema?.metadata?.usage;
  const matching = (usage?.recovery ?? []).filter((rule) => rule.code === category);
  if (matching.length > 0) {
    return matching.slice(0, 4).map((rule) => ({
      label: rule.toolName ? `Usar ${rule.toolName}` : "Aplicar recuperación",
      ...(rule.toolName ? { toolName: rule.toolName } : {}),
      instruction: rule.instruction,
    }));
  }
  if (category === "schema-validation") {
    return [{
      label: `Inspeccionar schema de ${toolName}`,
      toolName: "bridge_tool_schema",
      arguments: { toolName },
      instruction: "Lee el contrato runtime exacto antes de reconstruir los argumentos; no inventes campos ni enums.",
    }];
  }
  const preflightTool = usage?.preflightTools?.[0];
  return preflightTool ? [{
    label: `Usar ${preflightTool}`,
    toolName: preflightTool,
    instruction: `Ejecuta el preflight recomendado para ${toolName} y reintenta sólo con un target o estado verificado.`,
  }] : [];
}

function emitAutomaticMetricNotices(
  toolName: string,
  event: ReturnType<typeof finishToolMetric>,
  toolSchema?: BridgeToolSchema,
  hasImages = false,
) {
  if (noticeInspectionTools.has(toolName)) return;
  if (!event.ok) {
    const errorCategory = classifyToolAuditError(event.error);
    const callerContractError = ["schema-validation", "target-not-found", "permission-or-risk-mismatch", "expected-safety-guard"].includes(errorCategory);
    emitBridgeNotice({
      severity: callerContractError ? "warning" : "error",
      code: "tool-call-failed",
      source: toolName,
      message: event.error || `La herramienta ${toolName} falló.`,
      details: {
        durationMs: event.durationMs,
        inputKeys: event.inputKeys,
        errorCategory,
        prerequisites: toolSchema?.metadata?.usage?.prerequisites ?? [],
        preflightTools: toolSchema?.metadata?.usage?.preflightTools ?? [],
      },
      actions: toolRecoveryActions(toolName, event.error, toolSchema),
      dedupeKey: `${toolName}:tool-call-failed:${errorCategory}:${event.error || "unknown"}`,
    });
  }
  if (event.durationMs >= slowToolThresholdMs) {
    emitBridgeNotice({
      severity: "warning",
      code: "slow-tool-call",
      source: toolName,
      message: `${toolName} tardó ${event.durationMs} ms, por encima del umbral de ${slowToolThresholdMs} ms.`,
      details: { durationMs: event.durationMs, thresholdMs: slowToolThresholdMs },
      dedupeKey: `${toolName}:slow-tool-call`,
    });
  }
  if (!hasImages && event.outputChars >= largeOutputThresholdChars && !largeOutputExemptTools.has(toolName)) {
    emitBridgeNotice({
      severity: "warning",
      code: "large-tool-response",
      source: toolName,
      message: `${toolName} produjo una respuesta de ${event.outputChars} caracteres.`,
      details: { outputChars: event.outputChars, thresholdChars: largeOutputThresholdChars },
      dedupeKey: `${toolName}:large-tool-response`,
    });
  }
}

const profiledMssrTools = new Set([
  "skill_recommend",
  "skill_route_plan",
  "skill_bootstrap",
  "mssr_trace_record",
]);

function withObservableAgentProfile(
  toolName: string,
  args: Record<string, unknown>,
  host: BridgeMetricProfile,
): Record<string, unknown> {
  const delegated = delegatedArgs(toolName, args);
  if (delegated.toolName !== toolName) {
    return {
      ...args,
      arguments: withObservableAgentProfile(delegated.toolName, delegated.args, host),
    };
  }
  if (!profiledMssrTools.has(toolName)) return args;
  return {
    ...args,
    caller: args.caller ?? host.caller,
    model: normalizeModelIdentifier(args.model ?? host.model),
    reasoningEffort: args.reasoningEffort ?? host.reasoningEffort,
  };
}

function hashedSessionKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return `session-${createHash("sha256").update(value.trim()).digest("hex").slice(0, 16)}`;
}

function requestAgentProfile(requestMeta: unknown, clientVersion: unknown): BridgeMetricProfile {
  const client = clientVersion && typeof clientVersion === "object"
    ? clientVersion as Record<string, unknown>
    : {};
  const clientName = typeof client.name === "string" ? client.name.trim().slice(0, 120) : undefined;
  const normalizedClient = clientName?.toLowerCase() ?? "";
  const inferredCaller = normalizedClient.includes("codex")
    ? "codex-local"
    : normalizedClient.includes("chatgpt") || normalizedClient.includes("openai")
      ? "chatgpt-web"
      : undefined;
  const envelope = requestMeta && typeof requestMeta === "object"
    ? requestMeta as Record<string, unknown>
    : {};
  const sessionKey = hashedSessionKey(envelope["openai/session"]);
  if (!requestMeta || typeof requestMeta !== "object") {
    return { caller: inferredCaller, clientName, sessionKey };
  }
  const codexMetadata = envelope["x-codex-turn-metadata"];
  if (!codexMetadata || typeof codexMetadata !== "object") {
    return { caller: inferredCaller, clientName, sessionKey };
  }
  const metadata = codexMetadata as Record<string, unknown>;
  return {
    caller: "codex-local",
    model: typeof metadata.model === "string" ? normalizeModelIdentifier(metadata.model) : undefined,
    reasoningEffort: typeof metadata.reasoning_effort === "string" ? metadata.reasoning_effort : undefined,
    clientName,
    sessionKey,
  };
}

function delegatedArgs(toolName: string, args: Record<string, unknown>): { toolName: string; args: Record<string, unknown> } {
  if ((toolName === "bridge_tool_query" || toolName === "bridge_tool_action")
      && typeof args.toolName === "string"
      && args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)) {
    return { toolName: args.toolName, args: args.arguments as Record<string, unknown> };
  }
  return { toolName, args };
}

function withInheritedProjectRoot(toolName: string, args: Record<string, unknown>, projectRoot?: string): Record<string, unknown> {
  if (!projectRoot) return args;
  const delegated = delegatedArgs(toolName, args);
  if (!mssrRouteTools.has(delegated.toolName)) return args;
  if (typeof delegated.args.projectRoot === "string" && delegated.args.projectRoot.trim()) return args;
  if (delegated.toolName === toolName) return { ...args, projectRoot };
  if ((toolName === "bridge_tool_query" || toolName === "bridge_tool_action")
      && args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)) {
    return {
      ...args,
      arguments: { ...(args.arguments as Record<string, unknown>), projectRoot },
    };
  }
  return args;
}

function emittedTraceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.traceId === "string") return record.traceId;
  return record.result && typeof record.result === "object" && !Array.isArray(record.result)
    && typeof (record.result as Record<string, unknown>).traceId === "string"
    ? (record.result as Record<string, unknown>).traceId as string
    : undefined;
}

function projectFromArgs(toolName: string, args: Record<string, unknown>): string | undefined {
  const delegated = delegatedArgs(toolName, args);
  const candidates = [delegated.args.projectRoot, delegated.args.cwd, delegated.args.path];
  for (const value of candidates) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalized = value.trim().replace(/\//g, "\\");
    const devMatch = normalized.match(/^[A-Za-z]:\\Dev\\([^\\]+)/i);
    if (devMatch) return devMatch[1].toLowerCase().slice(0, 120);
    if (value === delegated.args.projectRoot || value === delegated.args.cwd) {
      const base = path.win32.basename(normalized).trim().toLowerCase();
      if (base && base !== "." && base !== "\\") return base.slice(0, 120);
    }
  }
  return undefined;
}

function taskKeyFromText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return `task_${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function projectRootScopeKey(sessionKey: string | undefined, workflowKey: string | undefined): string | undefined {
  if (!sessionKey) return undefined;
  return `${sessionKey}:${workflowKey ?? ""}`;
}

function resolveProject(toolName: string, args: Record<string, unknown>, host: BridgeMetricProfile): string | undefined {
  const observed = projectFromArgs(toolName, args);
  if (toolName === "project_context_load" && observed && host.sessionKey) {
    sessionProjects.delete(host.sessionKey);
    sessionProjects.set(host.sessionKey, observed);
    while (sessionProjects.size > maxScopedMetricEntries) {
      const oldest = sessionProjects.keys().next().value;
      if (typeof oldest !== "string") break;
      sessionProjects.delete(oldest);
    }
  }
  if (toolName === "project_context_load") return observed;
  return (host.sessionKey ? sessionProjects.get(host.sessionKey) : undefined) ?? observed;
}

function routingStatus(
  toolName: string,
  traceId: string | null,
  args: Record<string, unknown>,
): NonNullable<BridgeMetricProfile["routingStatus"]> {
  const effective = delegatedArgs(toolName, args).toolName;
  return classifyMssrRoutingStatus(effective, traceId);
}

function metricProfile(
  toolName: string,
  args: Record<string, unknown>,
  host: BridgeMetricProfile,
  traceSnapshot: ReturnType<ReturnType<typeof createMssrTraceSessionCoordinator>["snapshot"]>,
  project: string | undefined,
  taskKey: string | undefined,
  workflowKey: string | undefined,
  relatedProject: string | undefined,
): BridgeMetricProfile {
  const delegated = delegatedArgs(toolName, args);
  const effectiveToolName = delegated.toolName;
  const effectiveArgs = delegated.args;
  const isNewRoute = profiledMssrTools.has(effectiveToolName) && typeof effectiveArgs.task === "string";
  const traceId = typeof effectiveArgs.traceId === "string"
    ? effectiveArgs.traceId
    : isNewRoute ? undefined : traceSnapshot.traceId ?? undefined;
  return {
    traceId,
    caller: typeof effectiveArgs.caller === "string"
      ? effectiveArgs.caller
      : isNewRoute ? host.caller : traceSnapshot.caller ?? host.caller,
    model: normalizeModelIdentifier(
      typeof effectiveArgs.model === "string"
        ? effectiveArgs.model
        : isNewRoute ? host.model : traceSnapshot.model ?? host.model,
    ),
    reasoningEffort: typeof effectiveArgs.reasoningEffort === "string"
      ? effectiveArgs.reasoningEffort
      : isNewRoute ? host.reasoningEffort : traceSnapshot.reasoningEffort ?? host.reasoningEffort,
    clientName: host.clientName,
    sessionKey: host.sessionKey,
    project,
    taskKey,
    workflowKey,
    relatedProject,
    routingStatus: routingStatus(toolName, traceId ?? null, args),
  };
}

function emitRoutingComplianceNotice(
  toolName: string,
  metric: ReturnType<typeof beginToolMetric>,
  destructive: boolean,
  tracker: ReturnType<typeof createMssrRoutingComplianceNoticeTracker>,
): void {
  if (metric.routingStatus !== "traced" && metric.routingStatus !== "unrouted") return;
  const subject = `routing-chain:${metric.sessionKey}:${metric.project}:${metric.caller}`;
  const projected = tracker.observe({
    subject,
    source: "mssr-routing-compliance",
    traceId: metric.traceId ?? null,
    observation: {
      trace: metric.routingStatus === "traced" ? "matched" : "not-applicable",
      route: metric.routingStatus === "traced" ? "present" : "missing",
      boundary: destructive ? "substantial-tool" : "ordinary",
    },
    details: {
      toolName,
      caller: metric.caller,
      project: metric.project,
      sessionKey: metric.sessionKey,
      destructive,
      routingStatus: metric.routingStatus,
      policy: "portable projection + host delivery; advisory only",
    },
    message: `${toolName} inició trabajo ${destructive ? "sustancial" : "observable"} sin routing MSSR activo. La llamada no fue bloqueada; revisa la ruta antes de continuar si la proyección requiere atención.`,
    resolutionMessage: `La cadena ${subject} volvió a tener routing MSSR compatible.`,
  });
  if (projected.notice) emitBridgeNotice(projected.notice);
}

function architectureImpactErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitArchitectureImpactEvaluation(result: BridgeArchitectureImpactEvaluationResult): void {
  for (const item of result.items) {
    if (item.state === "baseline-review-required") {
      emitBridgeNotice({
        severity: "warning",
        code: "mssr-architecture-impact-baseline-review-due",
        source: "bridge-architecture-impact-host-adapter",
        message: `Architecture Impact requiere baseline revisado para '${item.architectureId}' antes de evaluar cambios automáticamente.`,
        details: {
          architectureId: item.architectureId,
          matchedRefs: item.matchedRefs,
          ...(item.contextRef ? { contextRef: item.contextRef } : {}),
          semanticOwner: "mssr",
          canonicalRewriteAllowed: false,
        },
        actions: [{
          label: "Revisar baseline Architecture Impact",
          instruction: "Revisa explícitamente la arquitectura declarada y crea el baseline host-local sólo con reviewed=true; no autoactualices ADRs ni autoridad canónica.",
        }],
        dedupeKey: `architecture-impact:baseline:${item.architectureId}`,
      });
      continue;
    }
    const evaluation = item.evaluation;
    if (evaluation.attentionLevel !== "review") continue;
    emitBridgeNotice({
      severity: "warning",
      code: "mssr-architecture-impact-review",
      source: "bridge-architecture-impact-host-adapter",
      message: `Architecture Impact marcó REVIEW para '${item.architectureId}'; replanifica con el contexto/autoridad indicados antes de persistir una decisión arquitectónica.`,
      details: {
        architectureId: item.architectureId,
        matchedRefs: item.matchedRefs,
        projectionStatus: evaluation.projection.status,
        projectionReasons: evaluation.projection.reasonCodes,
        structuralLevel: evaluation.structuralRefinement?.level ?? null,
        structuralReasons: evaluation.structuralRefinement?.reasonCodes ?? [],
        invariants: evaluation.invariants.map((invariant) => ({
          invariantId: invariant.invariantId,
          status: invariant.status,
          level: invariant.level,
          reasonCode: invariant.reasonCode,
        })),
        contextRequests: evaluation.contextFeedback?.requests.map((request) => ({
          role: request.role,
          ...(request.contextRef ? { contextRef: request.contextRef } : {}),
          kind: request.request.kind,
          resolution: request.request.resolution,
          action: request.request.action,
          reasonCodes: request.request.reasonCodes,
        })) ?? [],
        semanticOwner: evaluation.semanticOwner,
        canonicalRewriteAllowed: evaluation.canonicalRewriteAllowed,
      },
      actions: [{
        label: "Replanificar Architecture Impact",
        instruction: "Replanifica MSSR en el mismo workflow y carga sólo los contextRef/authority solicitados por contextRequests; no reescribas autoridad canónica automáticamente.",
      }],
      dedupeKey: `architecture-impact:review:${item.architectureId}`,
    });
  }
}

function emitArchitectureImpactFailure(projectRoot: string, toolName: string, error: unknown): void {
  emitBridgeNotice({
    severity: "warning",
    code: "mssr-architecture-impact-host-observation-failed",
    source: "bridge-architecture-impact-host-adapter",
    message: `Architecture Impact no pudo completar la observación host para '${toolName}'. La tool autorizada no fue bloqueada; trata esta arquitectura como REVIEW hasta revalidarla.`,
    details: {
      projectRoot,
      toolName,
      error: architectureImpactErrorMessage(error).slice(0, 600),
      semanticOwner: "mssr",
      advisoryOnly: true,
    },
    dedupeKey: `architecture-impact:host-failure:${projectRoot}:${toolName}`,
  });
}

type BridgeServerSurface = {
  setRequestHandler: (...args: any[]) => void;
  getClientVersion: () => { name?: string; version?: string } | undefined;
};

function configureBridgeServer(server: BridgeServerSurface, modern: boolean) {
  const modularToolRegistry = createDefaultToolRegistry();
  const routingCompliance = createMssrRoutingComplianceNoticeTracker();
  const pendingContextProjects = new Set<string>();
  const pendingContextRoots = new Set<string>();
  let localTaskKey: string | undefined;
  let localWorkflowKey: string | undefined;
  const mssrTraceSession = createMssrTraceSessionCoordinator(modularToolRegistry.tools, {
    onClosureReminder: (reminder) => {
      emitBridgeNotice(reminder.notice);
      recordMssrEvent({
        traceId: reminder.traceId,
        eventType: "closure_reminder",
        caller: reminder.caller,
        stage: reminder.stage,
        ok: false,
        details: {
          lastToolName: reminder.toolName,
          idleMs: reminder.idleMs,
          activityVersion: reminder.activityVersion,
          surface: "chatgpt-web",
          limitation: "MCP outcome missing; final UI render is not observable by Bridge.",
        },
      });
    },
  });

  const listTools = async () => ({
    tools: modularToolRegistry.tools,
  });

  if (modern) server.setRequestHandler("tools/list", listTools);
  else server.setRequestHandler(ListToolsRequestSchema, listTools);

  const callTool = async (request: {
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };
  }) => {
    const name = request.params.name;
    const hostProfile = requestAgentProfile(request.params._meta, server.getClientVersion());
    const profiledArgs = withObservableAgentProfile(
      name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
      hostProfile,
    );
    const activeTraceBeforeCall = mssrTraceSession.snapshot();
    const rootWorkflowKey = normalizeWorkflowKey(profiledArgs.workflowKey)
      ?? (hostProfile.sessionKey ? sessionWorkflowKeys.get(hostProfile.sessionKey) : undefined)
      ?? (activeTraceBeforeCall.active && !activeTraceBeforeCall.closed
        ? normalizeWorkflowKey(activeTraceBeforeCall.workflowKey)
        : undefined)
      ?? localWorkflowKey;
    const rootScopeKey = projectRootScopeKey(hostProfile.sessionKey, rootWorkflowKey);
    const inheritedProjectRoot = (rootScopeKey ? sessionProjectRoots.get(rootScopeKey) : undefined)
      ?? (pendingContextRoots.size === 1 ? [...pendingContextRoots][0] : undefined);
    const scopedArgs = withInheritedProjectRoot(name, profiledArgs, inheritedProjectRoot);
    const effectiveCall = delegatedArgs(name, scopedArgs);
    let architectureImpactPrepared: Awaited<ReturnType<typeof prepareBridgeArchitectureImpactHostAdoption>> = null;
    const observedProject = projectFromArgs(name, scopedArgs);
    if (name === "project_context_load") {
      const nextTaskKey = taskKeyFromText(profiledArgs.task);
      const nextWorkflowKey = normalizeWorkflowKey(profiledArgs.workflowKey);
      if (nextTaskKey) {
        localTaskKey = nextTaskKey;
        if (hostProfile.sessionKey) {
          sessionTaskKeys.delete(hostProfile.sessionKey);
          sessionTaskKeys.set(hostProfile.sessionKey, nextTaskKey);
          while (sessionTaskKeys.size > maxScopedMetricEntries) {
            const oldest = sessionTaskKeys.keys().next().value;
            if (typeof oldest !== "string") break;
            sessionTaskKeys.delete(oldest);
          }
        }
      } else {
        localTaskKey = undefined;
        if (hostProfile.sessionKey) sessionTaskKeys.delete(hostProfile.sessionKey);
      }
      if (nextWorkflowKey) {
        localWorkflowKey = nextWorkflowKey;
        if (hostProfile.sessionKey) {
          sessionWorkflowKeys.delete(hostProfile.sessionKey);
          sessionWorkflowKeys.set(hostProfile.sessionKey, nextWorkflowKey);
          while (sessionWorkflowKeys.size > maxScopedMetricEntries) {
            const oldest = sessionWorkflowKeys.keys().next().value;
            if (typeof oldest !== "string") break;
            sessionWorkflowKeys.delete(oldest);
          }
        }
      } else {
        localWorkflowKey = undefined;
        if (hostProfile.sessionKey) sessionWorkflowKeys.delete(hostProfile.sessionKey);
      }
    }
    const explicitWorkflowKey = normalizeWorkflowKey(effectiveCall.args.workflowKey);
    if (explicitWorkflowKey) {
      localWorkflowKey = explicitWorkflowKey;
      if (hostProfile.sessionKey) {
        sessionWorkflowKeys.delete(hostProfile.sessionKey);
        sessionWorkflowKeys.set(hostProfile.sessionKey, explicitWorkflowKey);
      }
    }
    const startsNewRoute = (effectiveCall.toolName === "skill_recommend"
      || effectiveCall.toolName === "skill_route_plan"
      || effectiveCall.toolName === "skill_bootstrap")
      && (effectiveCall.args.stage === undefined || effectiveCall.args.stage === "start")
      && typeof effectiveCall.args.traceId !== "string";
    const pendingProject = startsNewRoute && pendingContextProjects.size > 0
      ? pendingContextProjects.size === 1
        ? [...pendingContextProjects][0]
        : "multi-project"
      : undefined;
    const activeTraceProject = activeTraceBeforeCall.active
      && !activeTraceBeforeCall.closed
      && activeTraceBeforeCall.project
      && activeTraceBeforeCall.project !== "unknown"
      ? activeTraceBeforeCall.project
      : undefined;
    const activeTraceWorkflowKey = activeTraceBeforeCall.active
      && !activeTraceBeforeCall.closed
      && activeTraceBeforeCall.workflowKey
      && activeTraceBeforeCall.workflowKey !== "unscoped"
      ? activeTraceBeforeCall.workflowKey
      : undefined;
    const requestedWorkflowKey = explicitWorkflowKey
      ?? (hostProfile.sessionKey ? sessionWorkflowKeys.get(hostProfile.sessionKey) : undefined)
      ?? localWorkflowKey;
    const workflowOwnerChanged = Boolean(
      requestedWorkflowKey
      && activeTraceWorkflowKey
      && requestedWorkflowKey !== activeTraceWorkflowKey,
    );
    const workflowOwner = workflowOwnerChanged || startsNewRoute
      ? requestedWorkflowKey
      : activeTraceWorkflowKey ?? requestedWorkflowKey;
    const resolvedCallProject = resolveProject(name, scopedArgs, hostProfile);
    const project = startsNewRoute || workflowOwnerChanged
      ? observedProject ?? pendingProject ?? resolvedCallProject
      : activeTraceProject ?? resolvedCallProject ?? pendingProject;
    const prepared = mssrTraceSession.prepare(name, scopedArgs, {
      caller: hostProfile.caller,
      sessionKey: hostProfile.sessionKey,
      project,
      workflowKey: workflowOwner,
    });
    for (const notice of prepared.notices) emitBridgeNotice(notice);
    const args = prepared.args;
    const effectivePrepared = delegatedArgs(name, args);
    const traceSnapshot = mssrTraceSession.resolveMetricContext({
      caller: typeof effectivePrepared.args.caller === "string" ? effectivePrepared.args.caller : hostProfile.caller,
      sessionKey: hostProfile.sessionKey,
      project,
      workflowKey: workflowOwner,
    });
    const traceMetricProject = traceSnapshot.project && traceSnapshot.project !== "unknown"
      ? traceSnapshot.project
      : undefined;
    const metricProject = startsNewRoute
      ? project ?? traceMetricProject
      : traceMetricProject ?? project;
    const taskKey = resolveMetricTaskKey({
      startsNewRoute,
      traceId: traceSnapshot.traceId,
      traceTaskHash: traceSnapshot.taskHash,
      explicitTaskKey: taskKeyFromText(effectivePrepared.args.task),
      sessionTaskKey: hostProfile.sessionKey ? sessionTaskKeys.get(hostProfile.sessionKey) : undefined,
      localTaskKey,
    });
    const workflowKey = resolveMetricWorkflowKey({
      startsNewRoute,
      traceId: traceSnapshot.traceId,
      traceWorkflowKey: traceSnapshot.workflowKey,
      explicitWorkflowKey: effectivePrepared.args.workflowKey,
      sessionWorkflowKey: hostProfile.sessionKey ? sessionWorkflowKeys.get(hostProfile.sessionKey) : undefined,
      localWorkflowKey,
    });
    const relatedProject = observedProject && observedProject !== metricProject
      ? observedProject
      : undefined;
    const metric = beginToolMetric(
      name,
      args,
      metricProfile(name, args, hostProfile, traceSnapshot, metricProject, taskKey, workflowKey, relatedProject),
    );
    if (startsNewRoute) {
      localTaskKey = undefined;
      localWorkflowKey = explicitWorkflowKey;
      if (hostProfile.sessionKey) {
        sessionTaskKeys.delete(hostProfile.sessionKey);
        if (explicitWorkflowKey) {
          sessionWorkflowKeys.delete(hostProfile.sessionKey);
          sessionWorkflowKeys.set(hostProfile.sessionKey, explicitWorkflowKey);
        } else {
          sessionWorkflowKeys.delete(hostProfile.sessionKey);
        }
      }
    }
    const toolSchema = modularToolRegistry.tools.find((tool) => tool.name === name);
    emitRoutingComplianceNotice(name, metric, toolSchema?.annotations?.destructiveHint === true, routingCompliance);

    const complete = (rawData: unknown, ok = true, error?: string) => {
      if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
        const result = rawData as Record<string, unknown>;
        const delegatedResult = result.result && typeof result.result === "object" && !Array.isArray(result.result)
          ? result.result as Record<string, unknown>
          : undefined;
        const traceIdFromResult = emittedTraceId(rawData);
        if (!metric.traceId && traceIdFromResult) metric.traceId = traceIdFromResult.slice(0, 128);
        const resultProfile = result.agentProfile ?? delegatedResult?.agentProfile;
        if (resultProfile && typeof resultProfile === "object" && !Array.isArray(resultProfile)) {
          const profile = resultProfile as Record<string, unknown>;
          if (metric.model === "unknown" && typeof profile.model === "string") metric.model = normalizeModelIdentifier(profile.model);
          if (metric.reasoningEffort === "unknown" && typeof profile.reasoningEffort === "string") {
            metric.reasoningEffort = profile.reasoningEffort.slice(0, 20);
          }
        }
      }
      const extracted = extractInternalNotices(rawData);
      for (const notice of extracted.notices) emitBridgeNotice(notice);
      const preview = toolContent(extracted.payload);
      const hasImages = preview.content.some((part) => part.type === "image");
      const outputChars = preview.content.reduce((total, part) => {
        return total + (part.type === "text" ? part.text.length : part.data.length);
      }, 0);
      const event = finishToolMetric(metric, ok, outputChars, error, extractToolResultMetric(name, rawData));
      emitAutomaticMetricNotices(name, event, toolSchema, hasImages);
      const delivered = noticeInspectionTools.has(name) ? [] : drainBridgeNotices();
      return toolContent(extracted.payload, delivered);
    };

    try {
      if (prepared.blocked) {
        throw new Error(`${prepared.blocked.code}: ${prepared.blocked.message}`);
      }
      if (!modularToolRegistry.has(name)) throw new Error(`Unknown tool: ${name}`);
      if (inheritedProjectRoot) {
        try {
          architectureImpactPrepared = await prepareBridgeArchitectureImpactHostAdoption({
            projectRoot: inheritedProjectRoot,
            toolName: effectivePrepared.toolName,
            args: effectivePrepared.args,
          });
        } catch (error) {
          emitArchitectureImpactFailure(inheritedProjectRoot, effectivePrepared.toolName, error);
        }
      }
      const result = await modularToolRegistry.call(name, args);
      if (architectureImpactPrepared) {
        try {
          emitArchitectureImpactEvaluation(await evaluatePreparedBridgeArchitectureImpact(architectureImpactPrepared));
        } catch (error) {
          emitArchitectureImpactFailure(architectureImpactPrepared.projectRoot, effectiveCall.toolName, error);
        }
      }
      if (name === "project_context_load") {
        const loadedRoot = typeof profiledArgs.projectRoot === "string" ? profiledArgs.projectRoot.trim() : "";
        if (loadedRoot) {
          pendingContextRoots.add(loadedRoot);
          const scopeKey = projectRootScopeKey(hostProfile.sessionKey, normalizeWorkflowKey(profiledArgs.workflowKey));
          if (scopeKey) {
            sessionProjectRoots.delete(scopeKey);
            sessionProjectRoots.set(scopeKey, loadedRoot);
            while (sessionProjectRoots.size > maxScopedMetricEntries) {
              const oldest = sessionProjectRoots.keys().next().value;
              if (typeof oldest !== "string") break;
              sessionProjectRoots.delete(oldest);
            }
          }
        }
        if (observedProject) pendingContextProjects.add(observedProject);
      }
      for (const notice of mssrTraceSession.observe(name, args, result)) emitBridgeNotice(notice);
      if (startsNewRoute && emittedTraceId(result)) {
        pendingContextProjects.clear();
        pendingContextRoots.clear();
      }
      return complete(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return complete({ error: message }, false, message);
    }
  };

  if (modern) server.setRequestHandler("tools/call", callTool);
  else server.setRequestHandler(CallToolRequestSchema, callTool);
}

function bridgeServerOptions() {
  return {
    capabilities: { tools: {}, logging: {} },
    instructions: [
      "This server controls MauroPrime. When substantial work begins in a known repository, call project_context_load once with the project root and current task so project rules, context, state, and workflow guides become active.",
      "When a user describes a repeatable multi-step process, says it should happen every time or in future, asks for a skill/pipeline/template/hook, or an existing reusable workflow may apply, call workflow_guide_recommend. Uploaded audio/video requests to listen, transcribe, inspect, or understand also require workflow-guide discovery before any generic ASR fallback; when narrated-media-review matches, load it and use media_review_ingest rather than improvising Whisper while the canonical pipeline is healthy. Follow load_existing with workflow_guide_load, follow use_existing_skill with skill_load, and propose a new guide only when neither a guide nor an existing skill owns the procedure. Call workflow_guide_create only when the user asks or approves.",
      "At the close of substantial or long-running work, when an observable error, incident, repeated friction, manual workaround, routing defect, stale runtime, lifecycle problem, or missing capability occurred, load skill-maintenance-loop for the close phase and persist a concise incident in the canonical owner ledger. Record symptom, reproduction/evidence, cause or unresolved status, correction, regression and follow-up; never record private chain-of-thought.",
      "For Blender modeling references, distinguish a perspective design master from the orthographic geometric master. Persist generated images with image_asset_save, normalize a generic pack with image_reference_pack_prepare, require semantic visual QA, validate it with blender_validate_reference_pack, and install it with blender_install_reference_pack. Keep blender_setup_character_references only as the four-view compatibility path. Use blender_review_bundle for comparable model evidence before editing.",
      "For arbitrary binary payloads, never route base64 through write_text_file. Use binary_file_write for small files or binary_upload_begin/append/status/finish for resumable large transfers, then verify with binary_file_info.",
      "When ChatGPT must visually inspect existing local PNG, JPEG, or WebP files, use image_file_attach. It attaches the original image bytes as MCP image content without printing the encoded payload; do not substitute binary_file_read_chunk, temporary HTTP servers, tunnels, or resized previews unless attachment itself is proven unavailable.",
      "When the user asks you to look at, inspect, read, or review the current TabletWhiteboard view, call whiteboard_capture_pc_view so the connected PC creates a fresh viewport PNG at its exact pan and zoom and the image is attached to the result. Use whiteboard_latest_capture only when the user explicitly wants the last saved image without taking a new one.",
      "When the user asks you to write, explain, diagram, annotate, or place an existing image inside TabletWhiteboard, use whiteboard_add_text for structured prose, whiteboard_add_diagram for safe shapes, arrows, polylines and Bezier paths, whiteboard_add_svg only for sanitized SVG markup, and whiteboard_insert_image only for an existing local PNG, JPEG, or WebP. These tools write to ChatGPT's separate locked layer; do not claim an object exists until the tool confirms it.",
      "Bridge anomaly notices are delivered inside normal tool responses as bridgeNotices and are removed from the pending queue after delivery. Their bounded actions are suggested preflights or recovery steps, never authorization. Delivered notices remain visible in the dashboard recent-history view for 24 hours so unresolved triggers are not lost.",
      "Bridge automatically propagates an MSSR trace inside the current MCP session, through a bounded process-shared lease and, after coordinator-memory loss, from persisted SQLite state. Exact anonymized-session or project matches win; when connector metadata rotates across related repositories, Bridge may adopt only the single open trace for the same caller and never uses a skill name to choose between concurrent tasks. Keep explicit traceId for ambiguous, historical or deliberately selected resumes; treat ambiguous trace, mismatch, orphan load, missing required skill, and outcome-without-route notices as control evidence that may require replanning.",
      "Use skill_route_plan for inspection. When applying a route, follow its nextAction and call skill_bootstrap. If bootstrap returns mustContinue=true, call its exact skill_context_next action repeatedly on the same trace until status=complete before dependent work; notices are recovery reminders, not context transport. Required obligations and accepted optional roots remain distinct across every page. Use individual skill_load only for focused recovery. Before tools that consume runtime ids, follow metadata.usage preflights and never invent sessions, snapshots, uploads, Studios or provider tool names.",
      "Bridge correlates ChatGPT tool calls with the anonymized openai/session metadata when the host provides it. An mssr-unrouted-tool-call notice means an eligible tool ran without a compatible route; continue safely, but bootstrap MSSR before the next substantial chain. Bootstrap and diagnostic tools are excluded from trace-coverage denominators.",
      "For long or multi-phase chatgpt-web work, keep the user-visible host alive with bounded progress checkpoints at scope/owner resolution, before another opaque tool phase, after material results or delegated handoffs, after classified failures/replans, before persistence, and at closure. Report only observable facts, active phase/owner, and the next gate; never private chain-of-thought. Record an MSSR outcome and return a concise result or concrete blocker when the task ends. Bridge may emit mssr-web-outcome-missing-after-idle after substantive tool activity without an observable outcome; treat it as an in-band lifecycle reminder to communicate before another long chain, not proof that the UI failed to render. Bridge notices cannot interrupt an active opaque tool call or push directly to the user outside a later tool response.",
      "Never claim that a guide, file, image, build, Blender scene, or other side effect exists until a tool result confirms it.",
    ].join(" "),
  };
}

export function createBridgeServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    bridgeServerOptions(),
  );
  configureBridgeServer(server as unknown as BridgeServerSurface, false);
  return server;
}

export function createModernBridgeServer() {
  const server = new ModernServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    bridgeServerOptions(),
  );
  configureBridgeServer(server as unknown as BridgeServerSurface, true);
  return server;
}
