import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

const DEFAULT_SERVER = "D:\\Dev\\bambu-studio-mcp\\server.py";
type Link = { client: Client; transport: StdioClientTransport; connectedAt: string };
let current: Link | null = null;
let connecting: Promise<Link> | null = null;

async function link(): Promise<Link> {
  if (current) return current;
  if (connecting) return connecting;
  connecting = (async () => {
    const entry = path.resolve(process.env.BRIDGE_BAMBU_MCP_SERVER_PATH || DEFAULT_SERVER);
    const stat = await fs.stat(entry).catch(() => null);
    if (!stat?.isFile()) throw new Error("Bambu standalone MCP server not found: " + entry);
    const transport = new StdioClientTransport({
      command: process.env.BRIDGE_BAMBU_MCP_PYTHON || "python",
      args: [entry],
      stderr: "pipe",
    });
    const client = new Client({ name: "MauroPrime-Bridge-Bambu-Client", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      current = { client, transport, connectedAt: new Date().toISOString() };
      return current;
    } catch (error) {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      throw error;
    }
  })();
  try { return await connecting; } finally { connecting = null; }
}

async function providerTools() {
  const connection = await link();
  try {
    return (await connection.client.listTools()).tools;
  } catch (error) {
    current = null;
    await connection.client.close().catch(() => undefined);
    throw error;
  }
}

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const callArgs = z.object({
  toolName: z.string().min(1).max(200),
  arguments: z.record(z.unknown()).default({}),
  confirmToolName: z.string().min(1).max(200),
}).strict();

export const bambuMcpConnectionToolModule: BridgeToolModule = {
  name: "bambu-mcp-connection",
  tools: [
    { name: "bambu_mcp_status", description: "Connect to the standalone Bambu Studio MCP provider and report its live status and tool count.", inputSchema: emptySchema },
    { name: "bambu_mcp_tool_list", description: "Read the live tool names, schemas, and annotations owned by the standalone Bambu Studio MCP provider.", inputSchema: emptySchema },
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
      const connection = await link();
      const tools = await providerTools();
      return { ok: true, provider: "standalone-bambu-mcp", transport: "stdio", connectedAt: connection.connectedAt, toolCount: tools.length };
    },
    bambu_mcp_tool_list: async (args) => {
      z.object({}).strict().parse(args);
      const tools = await providerTools();
      return { provider: "standalone-bambu-mcp", tools };
    },
    bambu_mcp_tool_call: async (args) => {
      const input = callArgs.parse(args);
      if (input.toolName !== input.confirmToolName) throw new Error("confirmToolName must exactly match toolName.");
      const connection = await link();
      const tools = await providerTools();
      if (!tools.some((tool) => tool.name === input.toolName)) throw new Error(`Standalone Bambu MCP does not expose ${input.toolName}. Refresh bambu_mcp_tool_list and retry with an exact provider tool name.`);
      const result = await connection.client.callTool({ name: input.toolName, arguments: input.arguments }, undefined, { timeout: 60_000 });
      if (result.isError) {
        const failure = Array.isArray(result.content) ? result.content.find((item) => item.type === "text") : undefined;
        throw new Error(failure?.type === "text" ? String(failure.text) : "Bambu MCP tool returned an error.");
      }
      if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
      return result;
    },
  },
};
