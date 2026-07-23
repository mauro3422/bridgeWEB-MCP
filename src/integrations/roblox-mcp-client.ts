import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type RobloxMcpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type RobloxMcpToolCatalogHealth = {
  status: "healthy" | "degraded" | "unavailable";
  tools: RobloxMcpTool[];
  liveToolCount: number;
  effectiveToolCount: number;
  attempts: number;
  durationMs: number;
  usingCachedTools: boolean;
  cacheCapturedAt?: string;
  warning?: string;
};

export type RobloxStudioInstance = {
  id: string;
  name: string;
  active: boolean;
};

type Connection = {
  client: Client;
  transport: StdioClientTransport;
  executable: string;
  connectedAt: string;
  generation: number;
};

const TOOL_LIST_TIMEOUT_MS = 12_000;
const TOOL_CATALOG_INSPECTION_TTL_MS = 15_000;
const TOOL_CATALOG_CACHE_PATH = path.resolve(
  process.env.ROBLOX_STUDIO_MCP_TOOL_CACHE?.trim()
    || path.join(process.cwd(), "data", "roblox-mcp-tool-catalog.json"),
);

let connection: Connection | null = null;
let connecting: Promise<Connection> | null = null;
let recentToolCatalog: { inspectedAtMs: number; health: RobloxMcpToolCatalogHealth } | null = null;
let toolCatalogInspection: Promise<RobloxMcpToolCatalogHealth> | null = null;
let operationTail: Promise<void> = Promise.resolve();
let queuedOperations = 0;
let activeOperations = 0;
let connectionGeneration = 0;
let reconnectCount = 0;
let lastResetReason: string | null = null;
let lastConnectionError: string | null = null;

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  queuedOperations += 1;
  const previous = operationTail;
  let release!: () => void;
  operationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  queuedOperations -= 1;
  activeOperations += 1;
  try {
    return await operation();
  } finally {
    activeOperations -= 1;
    release();
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveStudioMcpExecutable(): Promise<string> {
  const configured = process.env.ROBLOX_STUDIO_MCP_EXE?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (!(await exists(resolved))) throw new Error(`ROBLOX_STUDIO_MCP_EXE does not exist: ${resolved}`);
    return resolved;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const direct = path.join(localAppData, "Roblox", "StudioMCP.exe");
  if (await exists(direct)) return direct;

  const versionsRoot = path.join(localAppData, "Roblox", "Versions");
  try {
    const entries = await fs.readdir(versionsRoot, { withFileTypes: true });
    const candidates: Array<{ path: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(versionsRoot, entry.name, "StudioMCP.exe");
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) candidates.push({ path: candidate, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore old or incomplete Roblox version directories.
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (candidates[0]) return candidates[0].path;
  } catch {
    // Fall through to the actionable error below.
  }

  throw new Error("Roblox Studio MCP executable was not found. Enable Studio as an MCP server and update/restart Roblox Studio.");
}

async function openConnection(): Promise<Connection> {
  const executable = await resolveStudioMcpExecutable();
  const transport = new StdioClientTransport({ command: executable, args: [], stderr: "pipe" });
  const client = new Client({ name: "MauroPrime-Bridge-Roblox", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    connectionGeneration += 1;
    lastConnectionError = null;
    return { client, transport, executable, connectedAt: new Date().toISOString(), generation: connectionGeneration };
  } catch (error) {
    lastConnectionError = error instanceof Error ? error.message : String(error);
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function ensureConnection(): Promise<Connection> {
  if (connection) return connection;
  if (!connecting) {
    connecting = openConnection()
      .then((value) => {
        connection = value;
        return value;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return await connecting;
}

async function resetConnection(reason = "requested"): Promise<void> {
  const current = connection;
  connection = null;
  connecting = null;
  recentToolCatalog = null;
  reconnectCount += 1;
  lastResetReason = reason;
  if (current) await current.client.close().catch(() => undefined);
}

function looksLikeClosedConnection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection closed|not connected|broken pipe|econnreset|eof/i.test(message);
}

async function withClientUnlocked<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const current = await ensureConnection();
  try {
    return await operation(current.client);
  } catch (error) {
    if (!looksLikeClosedConnection(error)) throw error;
    lastConnectionError = error instanceof Error ? error.message : String(error);
    await resetConnection("closed-connection");
    const retried = await ensureConnection();
    return await operation(retried.client);
  }
}

function validTools(value: unknown): RobloxMcpTool[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RobloxMcpTool => {
    return Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string");
  });
}

export function classifyRobloxMcpToolCatalog(input: {
  liveTools: RobloxMcpTool[];
  cachedTools?: RobloxMcpTool[];
  cacheCapturedAt?: string;
  attempts: number;
  durationMs: number;
  errors?: string[];
}): RobloxMcpToolCatalogHealth {
  if (input.liveTools.length > 0) {
    return {
      status: "healthy",
      tools: input.liveTools,
      liveToolCount: input.liveTools.length,
      effectiveToolCount: input.liveTools.length,
      attempts: input.attempts,
      durationMs: input.durationMs,
      usingCachedTools: false,
    };
  }

  const cachedTools = input.cachedTools ?? [];
  const detail = input.errors?.length ? input.errors.join("; ") : "tools/list returned zero tools";
  const warning = `Roblox Studio MCP tool catalog is ${cachedTools.length > 0 ? "degraded" : "unavailable"}: ${detail}.${cachedTools.length > 0 ? ` Using ${cachedTools.length} last-known tool schemas from ${input.cacheCapturedAt ?? "an earlier healthy connection"}.` : " No last-known tool cache is available."}`;
  return {
    status: cachedTools.length > 0 ? "degraded" : "unavailable",
    tools: cachedTools,
    liveToolCount: 0,
    effectiveToolCount: cachedTools.length,
    attempts: input.attempts,
    durationMs: input.durationMs,
    usingCachedTools: cachedTools.length > 0,
    cacheCapturedAt: input.cacheCapturedAt,
    warning,
  };
}

async function readCachedToolCatalog(): Promise<{ tools: RobloxMcpTool[]; capturedAt?: string }> {
  try {
    const parsed = JSON.parse(await fs.readFile(TOOL_CATALOG_CACHE_PATH, "utf8")) as Record<string, unknown>;
    return {
      tools: validTools(parsed.tools),
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
    };
  } catch {
    return { tools: [] };
  }
}

async function persistToolCatalog(tools: RobloxMcpTool[]): Promise<void> {
  if (tools.length === 0) return;
  const directory = path.dirname(TOOL_CATALOG_CACHE_PATH);
  const temporaryPath = `${TOOL_CATALOG_CACHE_PATH}.${process.pid}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    tools,
  }, null, 2), "utf8");
  await fs.rename(temporaryPath, TOOL_CATALOG_CACHE_PATH);
}

async function requestToolCatalog(): Promise<RobloxMcpTool[]> {
  const result = await withClientUnlocked((client) => client.listTools(undefined, { timeout: TOOL_LIST_TIMEOUT_MS }));
  return validTools(result.tools);
}

async function performToolCatalogInspection(options: {
  force?: boolean;
  retryOnEmpty?: boolean;
}): Promise<RobloxMcpToolCatalogHealth> {
  const startedAt = Date.now();
  const errors: string[] = [];
  let attempts = 0;
  let liveTools: RobloxMcpTool[] = [];
  const maxAttempts = options.retryOnEmpty === false ? 1 : 2;

  await runExclusive(async () => {
    while (attempts < maxAttempts && liveTools.length === 0) {
      attempts += 1;
      try {
        liveTools = await requestToolCatalog();
        if (liveTools.length === 0) errors.push(`attempt ${attempts}: tools/list returned zero tools`);
      } catch (error) {
        lastConnectionError = error instanceof Error ? error.message : String(error);
        errors.push(`attempt ${attempts}: ${lastConnectionError}`);
      }
      if (liveTools.length === 0 && attempts < maxAttempts) await resetConnection("empty-or-failed-tool-catalog");
    }
  });

  if (liveTools.length > 0) {
    await persistToolCatalog(liveTools).catch(() => undefined);
    const health = classifyRobloxMcpToolCatalog({
      liveTools,
      attempts,
      durationMs: Date.now() - startedAt,
    });
    recentToolCatalog = { inspectedAtMs: Date.now(), health };
    return health;
  }

  const cached = await readCachedToolCatalog();
  const health = classifyRobloxMcpToolCatalog({
    liveTools: [],
    cachedTools: cached.tools,
    cacheCapturedAt: cached.capturedAt,
    attempts,
    durationMs: Date.now() - startedAt,
    errors,
  });
  recentToolCatalog = { inspectedAtMs: Date.now(), health };
  return health;
}

export async function inspectRobloxMcpTools(options: {
  force?: boolean;
  retryOnEmpty?: boolean;
} = {}): Promise<RobloxMcpToolCatalogHealth> {
  const now = Date.now();
  if (!options.force && recentToolCatalog && now - recentToolCatalog.inspectedAtMs < TOOL_CATALOG_INSPECTION_TTL_MS) {
    return recentToolCatalog.health;
  }
  if (toolCatalogInspection) return await toolCatalogInspection;
  toolCatalogInspection = performToolCatalogInspection(options).finally(() => {
    toolCatalogInspection = null;
  });
  return await toolCatalogInspection;
}

export async function listRobloxMcpTools(): Promise<RobloxMcpTool[]> {
  return (await inspectRobloxMcpTools()).tools;
}

export async function callRobloxMcpTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return await runExclusive(async () => {
    return await withClientUnlocked((client) => client.callTool({ name: toolName, arguments: args }));
  });
}

function contentText(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  });
}

export function parseRobloxStudios(result: unknown): RobloxStudioInstance[] {
  for (const text of contentText(result)) {
    try {
      const parsed = JSON.parse(text) as { studios?: unknown };
      if (!Array.isArray(parsed.studios)) continue;
      return parsed.studios.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.name !== "string") return [];
        return [{ id: record.id, name: record.name, active: record.active === true }];
      });
    } catch {
      // Continue through other text content blocks.
    }
  }
  return [];
}

export async function callRobloxMcpToolForStudio(
  toolName: string,
  args: Record<string, unknown> = {},
  options: { studioId?: string; requireExplicitWhenMultiple?: boolean } = {},
): Promise<{
  studio: RobloxStudioInstance;
  studios: RobloxStudioInstance[];
  switchedStudio: boolean;
  restoredStudio: boolean;
  result: unknown;
}> {
  return await runExclusive(async () => {
    const studiosResult = await withClientUnlocked((client) => client.callTool({ name: "list_roblox_studios", arguments: {} }));
    const studios = parseRobloxStudios(studiosResult);
    if (studios.length === 0) throw new Error("Roblox Studio MCP reported no connected Studio instances.");

    let studio: RobloxStudioInstance | undefined;
    if (options.studioId) {
      studio = studios.find((item) => item.id === options.studioId);
      if (!studio) {
        throw new Error(`Roblox Studio '${options.studioId}' is not connected. Available: ${studios.map((item) => `${item.name} (${item.id})`).join(", ")}.`);
      }
    } else {
      if (options.requireExplicitWhenMultiple && studios.length > 1) {
        throw new Error(`Multiple Roblox Studio instances are connected; studioId is required. Available: ${studios.map((item) => `${item.name} (${item.id}${item.active ? ", active" : ""})`).join(", ")}.`);
      }
      studio = studios.find((item) => item.active) ?? (studios.length === 1 ? studios[0] : undefined);
      if (!studio) throw new Error("No active Roblox Studio instance is selected; provide studioId.");
    }

    if (!studio) throw new Error("No Roblox Studio target could be resolved.");
    const previousActiveStudio = studios.find((item) => item.active);
    let selectedStudio = studio;
    let switchedStudio = false;
    if (!selectedStudio.active) {
      await withClientUnlocked((client) => client.callTool({
        name: "set_active_studio",
        arguments: { studio_id: selectedStudio.id },
      }));
      switchedStudio = true;
      selectedStudio = { ...selectedStudio, active: true };
    }
    let result: unknown;
    let callError: unknown;
    try {
      result = await withClientUnlocked((client) => client.callTool({ name: toolName, arguments: args }));
    } catch (error) {
      callError = error;
    }
    let restoredStudio = false;
    if (switchedStudio && previousActiveStudio && previousActiveStudio.id !== selectedStudio.id) {
      await withClientUnlocked((client) => client.callTool({
        name: "set_active_studio",
        arguments: { studio_id: previousActiveStudio.id },
      })).then(() => {
        restoredStudio = true;
      }).catch(() => undefined);
    }
    if (callError) throw callError;
    return { studio: selectedStudio, studios, switchedStudio, restoredStudio, result };
  });
}

export async function inspectRobloxStudioState(): Promise<{
  studios: RobloxStudioInstance[];
  activeStudio: RobloxStudioInstance | null;
  studioState: unknown | null;
  warning?: string;
}> {
  return await runExclusive(async () => {
    const studiosResult = await withClientUnlocked((client) => client.callTool({ name: "list_roblox_studios", arguments: {} }));
    const studios = parseRobloxStudios(studiosResult);
    const activeStudio = studios.find((studio) => studio.active) ?? null;
    if (!activeStudio) {
      return {
        studios,
        activeStudio: null,
        studioState: null,
        warning: studios.length > 0
          ? "Roblox Studio instances are connected, but none is active. Status did not change the active target."
          : "No Roblox Studio instances are connected.",
      };
    }
    const studioState = await withClientUnlocked((client) => client.callTool({ name: "get_studio_state", arguments: {} }));
    return { studios, activeStudio, studioState };
  });
}

export async function robloxMcpConnectionStatus(options: { forceRefresh?: boolean } = {}) {
  const toolCatalog = await inspectRobloxMcpTools({ force: options.forceRefresh });
  let current: Connection | null = null;
  try {
    current = await runExclusive(async () => await ensureConnection());
  } catch (error) {
    lastConnectionError = error instanceof Error ? error.message : String(error);
  }
  return {
    connected: current !== null,
    status: toolCatalog.status,
    processConnected: current !== null,
    toolCatalogHealthy: toolCatalog.status === "healthy",
    executable: current?.executable,
    connectedAt: current?.connectedAt,
    server: current?.client.getServerVersion(),
    ownership: {
      bridgePid: process.pid,
      childPid: current?.transport.pid ?? null,
      connectionGeneration: current?.generation ?? connectionGeneration,
      reconnectCount,
      lastResetReason,
      lastConnectionError,
    },
    concurrency: {
      policy: "serialized-single-connection",
      activeOperations,
      queuedOperations,
      catalogProbeInFlight: toolCatalogInspection !== null,
    },
    toolCount: toolCatalog.effectiveToolCount,
    liveToolCount: toolCatalog.liveToolCount,
    usingCachedTools: toolCatalog.usingCachedTools,
    toolCatalog: {
      status: toolCatalog.status,
      attempts: toolCatalog.attempts,
      durationMs: toolCatalog.durationMs,
      warning: toolCatalog.warning,
      cacheCapturedAt: toolCatalog.cacheCapturedAt,
    },
  };
}

export async function closeRobloxMcpConnection(): Promise<void> {
  await runExclusive(async () => await resetConnection("bridge-shutdown"));
}
