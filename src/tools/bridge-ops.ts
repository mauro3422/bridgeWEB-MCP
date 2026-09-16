import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_RESTART_ACK_FILE,
  DEFAULT_RESTART_REQUEST_FILE,
  DEFAULT_TUNNEL_ADMIN_BASE_URL,
  SERVER_NAME,
  SERVER_VERSION,
} from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { fileExists, resolveToolPath, runShellCommand, summarizeCommand, tailText } from "./shared/process.js";
import { gitStatus } from "./git-tools.js";
import { terminalList } from "./process-tools.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type TunnelMetricsSummary = {
  processStartTimeSeconds: number | null;
  endToEnd: {
    initialize: Record<string, number>;
    toolsCall: Record<string, number>;
    notificationsInitialized: Record<string, number>;
  };
  localMcpPost: {
    noStatus: number;
    statuses: Record<string, number>;
  };
  controlPlane: {
    commandsEnqueued: number | null;
    commandsPolled: number | null;
    queueLength: number | null;
    queueCapacity: number | null;
    workerOccupancy: number | null;
    workerCapacity: number | null;
    lastSuccessfulPollTimestampSeconds: number | null;
  };
  transportFailures: {
    tunnelService502: number;
    localPostNoStatus: number;
    countsMatch: boolean;
  };
};

type TunnelFailureBaseline = {
  processStartTimeSeconds: number | null;
  capturedAt: string;
  tunnelService502: number;
  localPostNoStatus: number;
};

const tunnelFailureBaselines = new Map<string, TunnelFailureBaseline>();

function parsePrometheusLabels(raw = ""): Record<string, string> {
  const labels: Record<string, string> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return labels;
}

export function parseTunnelMetricsSummary(text: string): TunnelMetricsSummary {
  const summary: TunnelMetricsSummary = {
    processStartTimeSeconds: null,
    endToEnd: { initialize: {}, toolsCall: {}, notificationsInitialized: {} },
    localMcpPost: { noStatus: 0, statuses: {} },
    controlPlane: {
      commandsEnqueued: null,
      commandsPolled: null,
      queueLength: null,
      queueCapacity: null,
      workerOccupancy: null,
      workerCapacity: null,
      lastSuccessfulPollTimestampSeconds: null,
    },
    transportFailures: { tunnelService502: 0, localPostNoStatus: 0, countsMatch: true },
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)$/.exec(line);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    const metric = match[1];
    const labels = parsePrometheusLabels(match[2]);

    if (metric === "process_start_time_seconds") {
      summary.processStartTimeSeconds = value;
      continue;
    }

    if (metric === "command_end_to_end_latency_milliseconds_count" && labels.latency_type === "enqueue_to_response") {
      const status = labels.tunnel_service_status;
      if (!status) continue;
      const target = labels.request_method === "initialize"
        ? summary.endToEnd.initialize
        : labels.request_method === "tools/call"
          ? summary.endToEnd.toolsCall
          : labels.request_method === "notifications/initialized"
            ? summary.endToEnd.notificationsInitialized
            : null;
      if (target) target[status] = (target[status] || 0) + value;
      continue;
    }

    if (
      metric === "http_client_request_duration_seconds_count"
      && labels.http_request_method === "POST"
      && labels.http_route === "/mcp"
      && labels.server_address === "127.0.0.1"
      && labels.server_port === "3001"
    ) {
      const status = labels.http_response_status_code;
      if (status) summary.localMcpPost.statuses[status] = (summary.localMcpPost.statuses[status] || 0) + value;
      else summary.localMcpPost.noStatus += value;
      continue;
    }

    const controlPlaneKey = metric === "commands_enqueued_total" ? "commandsEnqueued"
      : metric === "commands_polled_total" ? "commandsPolled"
        : metric === "commands_queue_length" ? "queueLength"
          : metric === "commands_queue_capacity" ? "queueCapacity"
            : metric === "dispatcher_worker_pool_occupancy" ? "workerOccupancy"
              : metric === "dispatcher_worker_pool_capacity" ? "workerCapacity"
                : metric === "commands_poll_last_successful_timestamp_seconds" ? "lastSuccessfulPollTimestampSeconds"
                  : null;
    if (controlPlaneKey) summary.controlPlane[controlPlaneKey] = value;
  }

  const tunnelService502 = [
    summary.endToEnd.initialize["502"] || 0,
    summary.endToEnd.toolsCall["502"] || 0,
    summary.endToEnd.notificationsInitialized["502"] || 0,
  ].reduce((total, value) => total + value, 0);
  summary.transportFailures = {
    tunnelService502,
    localPostNoStatus: summary.localMcpPost.noStatus,
    countsMatch: tunnelService502 === summary.localMcpPost.noStatus,
  };
  return summary;
}

function withTunnelFailureBaseline(baseUrl: string, summary: TunnelMetricsSummary) {
  const observedAt = new Date().toISOString();
  const previousBaseline = tunnelFailureBaselines.get(baseUrl) || null;
  const sameTunnelProcess = previousBaseline
    && previousBaseline.processStartTimeSeconds === summary.processStartTimeSeconds;
  const resetReason = !previousBaseline
    ? "initial-sample"
    : sameTunnelProcess
      ? null
      : "tunnel-restarted";
  if (!sameTunnelProcess) {
    tunnelFailureBaselines.set(baseUrl, {
      processStartTimeSeconds: summary.processStartTimeSeconds,
      capturedAt: observedAt,
      tunnelService502: summary.transportFailures.tunnelService502,
      localPostNoStatus: summary.transportFailures.localPostNoStatus,
    });
  }
  const baseline = tunnelFailureBaselines.get(baseUrl)!;
  return {
    observedAt,
    ...summary,
    baseline: {
      capturedAt: baseline.capturedAt,
      resetReason,
      sinceBaseline: {
        tunnelService502: Math.max(0, summary.transportFailures.tunnelService502 - baseline.tunnelService502),
        localPostNoStatus: Math.max(0, summary.transportFailures.localPostNoStatus - baseline.localPostNoStatus),
      },
    },
  };
}

export async function tunnelHealth(baseUrl = DEFAULT_TUNNEL_ADMIN_BASE_URL) {
  const fetchEndpoint = async (name: string) => {
    const url = `${baseUrl}/${name}`;
    try {
      const response = await fetch(url);
      const text = await response.text();
      return { ok: response.ok, status: response.status, text: tailText(text, 2000) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const fetchMetrics = async () => {
    try {
      const response = await fetch(`${baseUrl}/metrics`);
      if (!response.ok) return { ok: false, status: response.status };
      const text = await response.text();
      return { ok: true, status: response.status, summary: withTunnelFailureBaseline(baseUrl, parseTunnelMetricsSummary(text)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const [healthz, readyz, metrics] = await Promise.all([
    fetchEndpoint("healthz"),
    fetchEndpoint("readyz"),
    fetchMetrics(),
  ]);
  return { baseUrl, healthz, readyz, metrics };
}

async function getRuntimeToolCatalog() {
  try {
    const { createDefaultToolRegistry } = await import("../tool-registry.js");
    const registry = createDefaultToolRegistry();
    const names = registry.tools.map((tool) => tool.name);
    const payload = registry.tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema, annotations: tool.annotations }));
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
    return {
      available: true,
      count: names.length,
      hash,
      modules: registry.modules,
      names,
      riskSummary: registry.riskSummary,
      refreshHint: "If the connector exposes fewer tools than this runtime catalog, reopen the connector or start a new chat.",
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function compareConnectorCatalog(exposedToolNames: string[]) {
  const catalog = await getRuntimeToolCatalog();
  if (!catalog.available || !Array.isArray(catalog.names)) {
    throw new Error(`Runtime tool catalog unavailable: ${"error" in catalog ? catalog.error : "unknown error"}`);
  }
  const runtimeNames = catalog.names;
  const riskSummary = catalog.riskSummary;
  if (!riskSummary) throw new Error("Runtime tool catalog risk summary unavailable.");
  const runtimeSet = new Set(runtimeNames);
  const exposed = [...new Set(exposedToolNames.map((name) => name.trim()).filter(Boolean))].sort();
  const recognized = exposed.filter((name) => runtimeSet.has(name));
  const unrecognized = exposed.filter((name) => !runtimeSet.has(name));
  const absentDirectly = runtimeNames.filter((name) => !recognized.includes(name));
  const riskFor = (name: string): "read-only" | "destructive" | "neutral" => {
    if (riskSummary.readOnly.includes(name)) return "read-only";
    if (riskSummary.destructive.includes(name)) return "destructive";
    return "neutral";
  };
  const absentDirectDetails = absentDirectly.map((name) => {
    const risk = riskFor(name);
    const wrapper = risk === "read-only" ? "bridge_tool_query" : "bridge_tool_action";
    return {
      name,
      risk,
      wrapper,
      directExposure: false,
      schemaLookupRequired: true,
      schemaLookup: { toolName: "bridge_tool_schema", arguments: { toolName: name } },
      fallback: wrapper === "bridge_tool_query"
        ? { toolName: wrapper, arguments: { toolName: name, arguments: {} } }
        : { toolName: wrapper, arguments: { toolName: name, confirmToolName: name, arguments: {} } },
      instruction: "Use this wrapper only because the dedicated connector schema is absent. Inspect bridge_tool_schema first unless a route response already supplied exact fallback arguments.",
    };
  });
  const mssrCore = [
    "skill_catalog",
    "skill_recommend",
    "skill_route_audit",
    "skill_route_vocabulary",
    "skill_route_plan",
    "skill_bootstrap",
    "skill_context_next",
    "skill_load",
    "mssr_context_proposal_review",
    "mssr_observatory_query",
    "mssr_trace_evidence",
    "mssr_trace_record",
    "mssr_trace_working_update",
    "mssr_observatory_epoch_start",
  ];
  const mssrDirect = mssrCore.filter((name) => recognized.includes(name));
  const mssrDelegatedReadOnly = mssrCore.filter((name) => !recognized.includes(name) && riskSummary.readOnly.includes(name));
  const mssrDelegatedAction = mssrCore.filter((name) => !recognized.includes(name) && !riskSummary.readOnly.includes(name));
  return {
    observedAt: new Date().toISOString(),
    runtime: { count: catalog.count, hash: catalog.hash },
    connectorObservation: {
      supplied: exposed.length,
      recognized: recognized.length,
      unrecognized,
      directCoveragePercent: runtimeNames.length > 0 ? Math.round((recognized.length / runtimeNames.length) * 10_000) / 100 : null,
    },
    mssr: {
      runtime: mssrCore.length,
      direct: mssrDirect,
      directCoveragePercent: Math.round((mssrDirect.length / mssrCore.length) * 10_000) / 100,
      delegatedViaQuery: mssrDelegatedReadOnly,
      delegatedViaAction: mssrDelegatedAction,
    },
    absentDirectly,
    absentDirectDetails,
    interpretation: {
      boundary: "This compares a caller-supplied observable connector catalog with the current Bridge runtime catalog. Bridge cannot inspect or force the host's private catalog selection.",
      wrapperReachabilityIsDirectExposure: false,
      refreshHint: catalog.refreshHint,
    },
    privacy: {
      rawPromptsStored: false,
      rawArgumentsStoredInToolMetrics: false,
      acceptedValues: "bounded tool names only",
    },
  };
}

function getRestartRequestPath(cwd?: string) {
  return path.resolve(cwd ? resolveToolPath(cwd) : process.cwd(), DEFAULT_RESTART_REQUEST_FILE);
}

function getRestartAckPath(cwd?: string) {
  return path.resolve(cwd ? resolveToolPath(cwd) : process.cwd(), DEFAULT_RESTART_ACK_FILE);
}

async function bridgeRequestRestart(reason: string, mode: "http" | "tunnel" | "full", cwd?: string) {
  const requestPath = getRestartRequestPath(cwd);
  const tempPath = `${requestPath}.${process.pid}.${Date.now()}.tmp`;
  const request = {
    id: randomUUID(),
    requestedAt: new Date().toISOString(),
    reason,
    mode,
    server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid },
    cwd: cwd ? resolveToolPath(cwd) : process.cwd(),
  };
  await fs.writeFile(tempPath, JSON.stringify(request, null, 2), "utf8");
  await fs.rename(tempPath, requestPath);
  return { requested: true, requestPath, request, note: "The MCP server only wrote a restart request file. The external watchdog must perform the actual restart." };
}

export async function bridgeRestartStatus(cwd?: string) {
  const requestPath = getRestartRequestPath(cwd);
  const ackPath = getRestartAckPath(cwd);
  const readJsonIfExists = async (filePath: string) => {
    if (!(await fileExists(filePath))) return null;
    const text = await fs.readFile(filePath, "utf8");
    const parseText = text.replace(/^\uFEFF/, "");
    try {
      return JSON.parse(parseText) as JsonValue;
    } catch {
      return { parseError: true, text: tailText(text, 4000) };
    }
  };
  return { requestPath, ackPath, pending: await fileExists(requestPath), request: await readJsonIfExists(requestPath), lastAck: await readJsonIfExists(ackPath) };
}

async function bridgeHealth(check: "all" | "tunnel" | "restart" | "catalog", cwd?: string) {
  const root = cwd ? resolveToolPath(cwd) : process.cwd();
  const out: Record<string, unknown> = { server: { name: SERVER_NAME, version: SERVER_VERSION }, cwd: root };
  if (check === "all" || check === "tunnel") out.tunnel = await tunnelHealth();
  if (check === "all" || check === "restart") out.restart = await bridgeRestartStatus(root);
  if (check === "all" || check === "catalog") out.toolCatalog = await getRuntimeToolCatalog();
  const tunnel = out.tunnel as { healthz?: { ok?: boolean }; readyz?: { ok?: boolean } } | undefined;
  const restart = out.restart as { pending?: boolean } | undefined;
  return { ok: (tunnel ? tunnel.healthz?.ok === true && tunnel.readyz?.ok === true : true) && (restart ? restart.pending !== true : true), check, ...out };
}

async function bridgeSelfCheck(cwd?: string) {
  const root = cwd ? resolveToolPath(cwd) : process.cwd();
  const typecheck = await runShellCommand("npm run check", root, 120_000);
  const build = await runShellCommand("npm run build", root, 120_000);
  const status = await gitStatus(root);
  const tunnel = await tunnelHealth();
  const toolCatalog = await getRuntimeToolCatalog();
  return {
    ok: typecheck.code === 0 && build.code === 0,
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    cwd: root,
    node: process.version,
    checks: { typecheck: summarizeCommand(typecheck), build: summarizeCommand(build) },
    git: status,
    tunnel,
    activeTerminals: terminalList(),
    toolCatalog,
  };
}

export const bridgeOpsToolModule: BridgeToolModule = {
  name: "bridge-ops",
  tools: [
    { name: "tunnel_health", description: "Check tunnel-client health/readiness plus a bounded transport diagnostic summary from its local metrics, including MCP 502/no-status correlation and deltas since the first sample for the current tunnel process.", inputSchema: { type: "object", properties: { baseUrl: { type: "string", default: DEFAULT_TUNNEL_ADMIN_BASE_URL } }, additionalProperties: false } },
    { name: "bridge_health", description: "Compact read-only bridge health query for tunnel diagnostics, restart status, runtime tool catalog, or all lightweight checks.", inputSchema: { type: "object", properties: { check: { type: "string", enum: ["all", "tunnel", "restart", "catalog"], default: "all" }, cwd: { type: "string" } }, additionalProperties: false } },
    { name: "bridge_connector_catalog_compare", description: "Compare the exact dedicated tool names observable in the current connector with the live Bridge runtime catalog. Use this to distinguish direct schema exposure from wrapper reachability; Bridge cannot inspect or force the host catalog, so exposedToolNames must come from the caller's observable catalog search.", inputSchema: { type: "object", properties: { exposedToolNames: { type: "array", items: { type: "string", minLength: 1, maxLength: 120 }, minItems: 1, maxItems: 256 } }, required: ["exposedToolNames"], additionalProperties: false } },
    { name: "bridge_self_check", description: "Run typecheck, build, Git status, configured tunnel health, and terminal inventory.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
    { name: "bridge_request_restart", description: "Request a bridge restart by writing a restart-request file for the external watchdog. This tool does not restart or kill processes directly.", inputSchema: { type: "object", properties: { reason: { type: "string" }, mode: { type: "string", enum: ["http", "tunnel", "full"], default: "http" }, cwd: { type: "string" } }, required: ["reason"], additionalProperties: false } },
    { name: "bridge_restart_status", description: "Return pending restart-request and last restart-ack information for the bridge watchdog.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
  ],
  handlers: {
    tunnel_health: async (args) => {
      const parsed = z.object({ baseUrl: z.string().default(DEFAULT_TUNNEL_ADMIN_BASE_URL) }).parse(args);
      return await tunnelHealth(parsed.baseUrl);
    },
    bridge_health: async (args) => {
      const parsed = z.object({ check: z.enum(["all", "tunnel", "restart", "catalog"]).default("all"), cwd: z.string().optional() }).parse(args);
      return await bridgeHealth(parsed.check, parsed.cwd);
    },
    bridge_connector_catalog_compare: async (args) => {
      const parsed = z.object({ exposedToolNames: z.array(z.string().trim().min(1).max(120)).min(1).max(256) }).parse(args);
      return await compareConnectorCatalog(parsed.exposedToolNames);
    },
    bridge_self_check: async (args) => {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return await bridgeSelfCheck(parsed.cwd);
    },
    bridge_request_restart: async (args) => {
      const parsed = z.object({ reason: z.string().min(1).max(500), mode: z.enum(["http", "tunnel", "full"]).default("http"), cwd: z.string().optional() }).parse(args);
      return await bridgeRequestRestart(parsed.reason, parsed.mode, parsed.cwd);
    },
    bridge_restart_status: async (args) => {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return await bridgeRestartStatus(parsed.cwd);
    },
  },
};
