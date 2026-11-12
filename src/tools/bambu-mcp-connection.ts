import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

const DEFAULT_SERVER = "D:\\Dev\\bambu-studio-mcp\\server.py";
const RECONNECT_CONFIRMATION = "RECONNECT_BAMBU_PROVIDER";
const DRAIN_TIMEOUT_MS = 10_000;
const PROVIDER_START_TIMEOUT_MS = 15_000;
type ProviderTools = Awaited<ReturnType<Client["listTools"]>>["tools"];
type Link = {
  client: Client;
  transport: StdioClientTransport;
  connectedAt: string;
  sourceFingerprint: string;
  catalogFingerprint: string;
  tools: ProviderTools;
  serverVersion?: { name: string; version: string };
  generation: number;
  inFlight: number;
  retired: boolean;
  closed: boolean;
  closePromise?: Promise<void>;
  drainWaiters: Array<() => void>;
};
type RefreshRecord = {
  attemptedAt: string;
  completedAt?: string;
  outcome: "running" | "refreshed" | "unchanged" | "failed";
  generation?: number;
  reason?: string;
  error?: string;
};

let current: Link | null = null;
let connecting: Promise<Link> | null = null;
let refreshing: Promise<Record<string, unknown>> | null = null;
let generation = 0;
let lastRefresh: RefreshRecord | null = null;

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function serverPath(): string {
  const entry = path.resolve(process.env.BRIDGE_BAMBU_MCP_SERVER_PATH || DEFAULT_SERVER);
  const productionAllowlist = path.resolve(DEFAULT_SERVER);
  const testFixture = process.env.NODE_ENV === "test" && isWithin(os.tmpdir(), entry);
  if (entry.toLowerCase() !== productionAllowlist.toLowerCase() && !testFixture) {
    throw new Error("Standalone Bambu MCP server path is outside the Bridge allowlist.");
  }
  return entry;
}

function providerStartTimeoutMs(): number {
  if (process.env.NODE_ENV === "test") {
    const testTimeout = Number(process.env.BRIDGE_BAMBU_MCP_TEST_START_TIMEOUT_MS);
    if (Number.isFinite(testTimeout) && testTimeout >= 50 && testTimeout <= 5_000) return testTimeout;
  }
  return PROVIDER_START_TIMEOUT_MS;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sourceFingerprint(entry = serverPath()): Promise<string> {
  const stat = await fs.stat(entry).catch(() => null);
  if (!stat?.isFile()) throw new Error("Allowlisted standalone Bambu MCP server was not found.");
  return digest(await fs.readFile(entry));
}

async function closeLink(connection: Link): Promise<void> {
  if (connection.closePromise) return connection.closePromise;
  connection.closed = true;
  connection.closePromise = (async () => {
    await connection.client.close().catch(() => undefined);
    await connection.transport.close().catch(() => undefined);
  })();
  return connection.closePromise;
}

function waitForDrain(connection: Link): Promise<void> {
  if (connection.inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => connection.drainWaiters.push(resolve));
}

async function drainWithin(connection: Link, timeoutMs: number): Promise<boolean> {
  if (connection.inFlight === 0) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void waitForDrain(connection).then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function release(connection: Link): void {
  connection.inFlight = Math.max(0, connection.inFlight - 1);
  if (connection.inFlight === 0) {
    for (const resolve of connection.drainWaiters.splice(0)) resolve();
    if (connection.retired) void closeLink(connection);
  }
}

function retire(connection: Link): void {
  connection.retired = true;
  if (connection.inFlight === 0) void closeLink(connection);
  else void waitForDrain(connection).then(() => closeLink(connection));
}

async function createLink(nextGeneration: number): Promise<Link> {
  const entry = serverPath();
  const before = await sourceFingerprint(entry);
  const python = process.env.BRIDGE_BAMBU_MCP_PYTHON || "python";
  const transport = new StdioClientTransport({ command: python, args: [entry], stderr: "pipe" });
  const client = new Client({ name: "MauroPrime-Bridge-Bambu-Client", version: "1.0.0" }, { capabilities: {} });
  try {
    const timeoutMs = providerStartTimeoutMs();
    await withTimeout(client.connect(transport), timeoutMs, "Standalone Bambu MCP initialize timed out.");
    const tools = (await withTimeout(client.listTools(), timeoutMs, "Standalone Bambu MCP tools/list timed out.")).tools;
    const after = await sourceFingerprint(entry);
    if (after !== before) throw new Error("Bambu MCP server source changed while the replacement was starting; retry reconnect.");
    const serverVersion = client.getServerVersion();
    return {
      client,
      transport,
      connectedAt: new Date().toISOString(),
      sourceFingerprint: before,
      catalogFingerprint: digest(JSON.stringify(tools)),
      tools,
      serverVersion,
      generation: nextGeneration,
      inFlight: 0,
      retired: false,
      closed: false,
      drainWaiters: [],
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

function startConnection(): Promise<Link> {
  if (current && !current.retired) return Promise.resolve(current);
  if (connecting) return connecting;
  const nextGeneration = ++generation;
  let task: Promise<Link>;
  task = createLink(nextGeneration).then((connection) => {
    current = connection;
    return connection;
  }).finally(() => {
    if (connecting === task) connecting = null;
  });
  connecting = task;
  return task;
}

async function connectionForCall(): Promise<Link> {
  while (refreshing) await refreshing.catch(() => undefined);
  return startConnection();
}

async function acquireForCall(): Promise<Link> {
  while (true) {
    const connection = await connectionForCall();
    if (connection === current && !connection.retired && !connection.closed) {
      connection.inFlight += 1;
      return connection;
    }
  }
}

async function acquireForStatus(): Promise<Link> {
  const active = current;
  if (active && !active.retired && !active.closed) {
    active.inFlight += 1;
    return active;
  }
  return acquireForCall();
}

async function providerTools(connection: Link): Promise<ProviderTools> {
  try {
    const tools = (await connection.client.listTools()).tools;
    connection.tools = tools;
    connection.catalogFingerprint = digest(JSON.stringify(tools));
    return tools;
  } catch (error) {
    if (current === connection) current = null;
    retire(connection);
    throw error;
  }
}

async function statusOf(connection: Link, tools: ProviderTools, isRefreshing: boolean) {
  const liveSourceFingerprint = await sourceFingerprint().catch(() => null);
  return {
    ok: true,
    provider: "standalone-bambu-mcp",
    transport: "stdio",
    connectedAt: connection.connectedAt,
    providerVersion: connection.serverVersion ?? null,
    toolCount: tools.length,
    catalogFingerprint: digest(JSON.stringify(tools)),
    sourceFingerprint: connection.sourceFingerprint,
    liveSourceFingerprint,
    sourceChanged: liveSourceFingerprint !== null && liveSourceFingerprint !== connection.sourceFingerprint,
    generation: connection.generation,
    refreshing: isRefreshing,
    lastRefresh,
  };
}

async function runRefresh(force: boolean): Promise<Record<string, unknown>> {
  if (refreshing) return refreshing;
  const attemptedAt = new Date().toISOString();
  const record: RefreshRecord = { attemptedAt, outcome: "running" };
  lastRefresh = record;
  let task: Promise<Record<string, unknown>>;
  task = (async () => {
    try {
      if (connecting) await connecting;
      const previous = current;
      const entry = serverPath();
      const latestSourceFingerprint = await sourceFingerprint(entry);
      if (previous && !previous.retired && previous.sourceFingerprint === latestSourceFingerprint && !force) {
        record.outcome = "unchanged";
        record.reason = "source-unchanged";
        record.completedAt = new Date().toISOString();
        return { ...(await statusOf(previous, previous.tools, true)), refreshed: false, reason: record.reason };
      }

      const nextGeneration = ++generation;
      const replacement = await createLink(nextGeneration);
      const old = current;
      current = replacement;
      if (old && old !== replacement) {
        old.retired = true;
        const drained = await drainWithin(old, DRAIN_TIMEOUT_MS);
        if (drained) await closeLink(old);
        else retire(old);
        record.reason = drained ? "provider-replaced" : "provider-replaced-old-call-draining";
      } else {
        record.reason = "provider-connected";
      }

      const oldNames = new Set(old?.tools.map((tool) => tool.name) ?? []);
      const newNames = new Set(replacement.tools.map((tool) => tool.name));
      record.outcome = "refreshed";
      record.generation = replacement.generation;
      record.completedAt = new Date().toISOString();
      return {
        ...(await statusOf(replacement, replacement.tools, true)),
        refreshed: true,
        addedToolNames: [...newNames].filter((name) => !oldNames.has(name)),
        removedToolNames: [...oldNames].filter((name) => !newNames.has(name)),
        oldCallsDrained: old ? old.inFlight === 0 : true,
      };
    } catch (error) {
      record.outcome = "failed";
      record.completedAt = new Date().toISOString();
      record.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  })().finally(() => {
    if (refreshing === task) refreshing = null;
  });
  refreshing = task;
  return task;
}

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const callArgs = z.object({
  toolName: z.string().min(1).max(200),
  arguments: z.record(z.unknown()).default({}),
  confirmToolName: z.string().min(1).max(200),
}).strict();
const reconnectArgs = z.object({
  confirmation: z.literal(RECONNECT_CONFIRMATION),
  force: z.boolean().optional().default(false),
}).strict();

export const bambuMcpConnectionToolModule: BridgeToolModule = {
  name: "bambu-mcp-connection",
  tools: [
    { name: "bambu_mcp_status", description: "Connect to the standalone Bambu Studio MCP provider and report its live version, tool count, source/catalog fingerprints and refresh state.", inputSchema: emptySchema },
    { name: "bambu_mcp_tool_list", description: "Read the live tool names, schemas, and annotations owned by the standalone Bambu Studio MCP provider.", inputSchema: emptySchema },
    {
      name: "bambu_mcp_reconnect",
      description: "Reconnect only the standalone Bambu MCP stdio provider. Requires confirmation RECONNECT_BAMBU_PROVIDER. Replaces its process after a healthy candidate starts, drains old calls, and never restarts Bridge HTTP, the tunnel, Bambu Studio, AMS, or a printer. Set force=true only to restart an unchanged provider for recovery.",
      inputSchema: {
        type: "object",
        properties: {
          confirmation: { type: "string", enum: [RECONNECT_CONFIRMATION], description: "Must exactly equal RECONNECT_BAMBU_PROVIDER." },
          force: { type: "boolean", default: false, description: "Restart even if the server source fingerprint is unchanged." },
        },
        required: ["confirmation"],
        additionalProperties: false,
      },
    },
    {
      name: "bambu_mcp_tool_call",
      description: "Call one tool from the standalone Bambu Studio MCP provider. Inspect its live schema first and repeat the exact toolName in confirmToolName. Provider owns all Bambu tool behavior and validation.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string", minLength: 1, maxLength: 200 },
          arguments: { type: "object", additionalProperties: true },
          confirmToolName: { type: "string", minLength: 1, maxLength: 200, description: "Must exactly equal toolName after reviewing the provider's live schema." },
        },
        required: ["toolName", "confirmToolName"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    bambu_mcp_status: async (args) => {
      z.object({}).strict().parse(args);
      const connection = await acquireForStatus();
      try {
        const tools = await providerTools(connection);
        return await statusOf(connection, tools, Boolean(refreshing));
      } finally {
        release(connection);
      }
    },
    bambu_mcp_tool_list: async (args) => {
      z.object({}).strict().parse(args);
      const connection = await acquireForCall();
      try {
        const tools = await providerTools(connection);
        return {
          provider: "standalone-bambu-mcp",
          connectedAt: connection.connectedAt,
          providerVersion: connection.serverVersion ?? null,
          generation: connection.generation,
          catalogFingerprint: connection.catalogFingerprint,
          tools,
        };
      } finally {
        release(connection);
      }
    },
    bambu_mcp_reconnect: async (args) => {
      const input = reconnectArgs.parse(args);
      return runRefresh(input.force);
    },
    bambu_mcp_tool_call: async (args) => {
      const input = callArgs.parse(args);
      if (input.toolName !== input.confirmToolName) throw new Error("confirmToolName must exactly match toolName.");
      const connection = await acquireForCall();
      try {
        const tools = await providerTools(connection);
        if (!tools.some((tool) => tool.name === input.toolName)) throw new Error(`Standalone Bambu MCP does not expose ${input.toolName}. Refresh bambu_mcp_tool_list and retry with an exact provider tool name.`);
        const result = await connection.client.callTool({ name: input.toolName, arguments: input.arguments }, undefined, { timeout: 60_000 });
        if (result.isError) {
          const failure = Array.isArray(result.content) ? result.content.find((item) => item.type === "text") : undefined;
          throw new Error(failure?.type === "text" ? String(failure.text) : "Bambu MCP tool returned an error.");
        }
        if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
        return result;
      } finally {
        release(connection);
      }
    },
  },
};
