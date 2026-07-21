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

type Connection = {
  client: Client;
  transport: StdioClientTransport;
  executable: string;
  connectedAt: string;
};

let connection: Connection | null = null;
let connecting: Promise<Connection> | null = null;

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
  await client.connect(transport);
  return { client, transport, executable, connectedAt: new Date().toISOString() };
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

async function resetConnection(): Promise<void> {
  const current = connection;
  connection = null;
  connecting = null;
  if (current) await current.client.close().catch(() => undefined);
}

function looksLikeClosedConnection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection closed|not connected|broken pipe|econnreset|eof/i.test(message);
}

async function withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const current = await ensureConnection();
  try {
    return await operation(current.client);
  } catch (error) {
    if (!looksLikeClosedConnection(error)) throw error;
    await resetConnection();
    const retried = await ensureConnection();
    return await operation(retried.client);
  }
}

export async function listRobloxMcpTools(): Promise<RobloxMcpTool[]> {
  const result = await withClient((client) => client.listTools());
  return result.tools as RobloxMcpTool[];
}

export async function callRobloxMcpTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return await withClient((client) => client.callTool({ name: toolName, arguments: args }));
}

export async function robloxMcpConnectionStatus() {
  const current = await ensureConnection();
  const tools = await listRobloxMcpTools();
  return {
    connected: true,
    executable: current.executable,
    connectedAt: current.connectedAt,
    server: current.client.getServerVersion(),
    toolCount: tools.length,
  };
}

export async function closeRobloxMcpConnection(): Promise<void> {
  await resetConnection();
}
