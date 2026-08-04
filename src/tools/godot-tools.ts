import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/process.js";

const DEFAULT_GODOT_HTTP_PORT = 6506;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export const GODOT_READ_ONLY_TOOL_NAMES = new Set([
  "list_dir",
  "read_file",
  "search_project",
  "get_project_settings",
  "get_input_map",
  "get_collision_layers",
  "get_node_properties",
  "get_console_log",
  "get_errors",
  "scene_tree_dump",
  "list_settings",
  "is_playing",
  "get_runtime_status",
  "take_screenshot",
  "query_runtime_node",
  "get_runtime_log",
  "classdb_query",
  "read_scene",
  "get_node_spatial_info",
  "measure_node_distance",
  "get_node_groups",
  "find_nodes_in_group",
  "get_resource_info",
  "list_signal_connections",
  "validate_script",
  "list_scripts",
  "map_project",
]);

const NEVER_DISPATCH = new Set([
  "create_scene",
  "edit_script",
  "run_scene",
  "send_input",
  "set_project_setting",
  "add_node",
  "delete_node",
  "set_node_property",
]);

function resolveTokenFile(): string {
  const explicit = process.env.GODOT_MCP_TOKEN_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  const base = process.env.APPDATA?.trim()
    || (process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"));
  return path.join(base, "MauroPrime", "godot-mcp", "token");
}

async function readToken(): Promise<{ token: string; tokenFile: string }> {
  const tokenFile = resolveTokenFile();
  const explicit = process.env.GODOT_MCP_TOKEN?.trim();
  const token = explicit || (await fs.readFile(tokenFile, "utf8")).trim();
  if (token.length < 32) throw new Error(`Godot MCP token is unavailable or invalid: ${tokenFile}`);
  return { token, tokenFile };
}

function requestJson(options: {
  port: number;
  method: "GET" | "POST";
  pathname: string;
  token: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: options.port,
      path: options.pathname,
      method: options.method,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        "x-mauroprime-token": options.token,
        ...(body ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode !== 200) {
          reject(new Error(`Godot MCP HTTP ${res.statusCode}: ${text.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(text) as Record<string, unknown>);
        } catch {
          reject(new Error("Godot MCP returned invalid JSON."));
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Godot MCP request timed out."));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function providerGet(pathname: string, port: number) {
  const { token, tokenFile } = await readToken();
  return {
    tokenFile,
    result: await requestJson({ port, method: "GET", pathname, token }),
  };
}

async function providerTool(name: string, args: Record<string, unknown>, port: number, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { token, tokenFile } = await readToken();
  return {
    tokenFile,
    result: await requestJson({
      port,
      method: "POST",
      pathname: "/tool",
      token,
      body: { name, args },
      timeoutMs,
    }),
  };
}

function parseMcpText(result: Record<string, unknown>): unknown {
  const content = Array.isArray(result.content) ? result.content : [];
  const textItem = content.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
  const text = typeof textItem?.text === "string" ? textItem.text : undefined;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

async function getStatus(port: number) {
  const health = await providerGet("/health", port);
  const status = await providerTool("get_godot_status", {}, port);
  return {
    available: true,
    endpoint: `http://127.0.0.1:${port}`,
    tokenFile: health.tokenFile,
    health: health.result,
    status: parseMcpText(status.result),
  };
}

async function getCatalog(port: number, query?: string, includeSchemas = true) {
  const response = await providerGet("/tools", port);
  const all = Array.isArray(response.result.tools) ? response.result.tools as Record<string, unknown>[] : [];
  const normalized = query?.trim().toLowerCase();
  const visible = all.filter((tool) => {
    const name = typeof tool.name === "string" ? tool.name : "";
    const description = typeof tool.description === "string" ? tool.description : "";
    return GODOT_READ_ONLY_TOOL_NAMES.has(name)
      && !NEVER_DISPATCH.has(name)
      && (!normalized || `${name} ${description}`.toLowerCase().includes(normalized));
  });
  return {
    endpoint: `http://127.0.0.1:${port}`,
    tokenFile: response.tokenFile,
    providerCount: all.length,
    safeCount: visible.length,
    tools: includeSchemas ? visible : visible.map(({ name, description }) => ({ name, description })),
  };
}

async function safeQuery(toolName: string, args: Record<string, unknown>, port: number, timeoutMs: number) {
  if (NEVER_DISPATCH.has(toolName) || !GODOT_READ_ONLY_TOOL_NAMES.has(toolName)) {
    throw new Error(`Godot tool '${toolName}' is not in the MauroPrime read-only allowlist.`);
  }
  const catalog = await getCatalog(port, toolName, true);
  const exact = catalog.tools.find((tool) => tool.name === toolName);
  if (!exact) throw new Error(`Godot tool '${toolName}' is not exposed by the current live provider catalog.`);
  const response = await providerTool(toolName, args, port, timeoutMs);
  return {
    toolName,
    projectSafe: true,
    result: parseMcpText(response.result),
  };
}

export const godotToolModule: BridgeToolModule = {
  name: "godot",
  tools: [
    {
      name: "godot_mcp_status",
      description: "Check the authenticated local MauroPrime Godot MCP provider, connected editor/runtime, project identity, mode, and tool count.",
      inputSchema: {
        type: "object",
        properties: { port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 } },
        additionalProperties: false,
      },
    },
    {
      name: "godot_mcp_tool_list",
      description: "List the live Godot provider tools that also pass MauroPrime Bridge's independent read-only allowlist.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          includeSchemas: { type: "boolean", default: true },
          port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "godot_mcp_instance_list",
      description: "Return the currently connected Godot project, stable project id, editor instance id, and runtime instance id from the authenticated provider.",
      inputSchema: {
        type: "object",
        properties: { port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 } },
        additionalProperties: false,
      },
    },
    {
      name: "godot_mcp_query",
      description: "Invoke one live Godot tool only when both the provider catalog and MauroPrime's independent allowlist classify it as read-only.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          arguments: { type: "object", additionalProperties: true, default: {} },
          port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS, minimum: 1000, maximum: 120000 },
        },
        required: ["toolName"],
        additionalProperties: false,
      },
    },
    {
      name: "godot_screen_capture_save",
      description: "Capture the connected Godot game viewport through the authenticated runtime, verify the PNG, and attach the original image for visual review.",
      inputSchema: {
        type: "object",
        properties: {
          resourcePath: { type: "string", default: "res://addons/godot_mcp/cache/screenshots/bridge-capture.png" },
          port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS, minimum: 1000, maximum: 120000 },
        },
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    godot_mcp_status: async (raw) => {
      const parsed = z.object({ port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT) }).parse(raw);
      try { return await getStatus(parsed.port); }
      catch (error) {
        return {
          available: false,
          endpoint: `http://127.0.0.1:${parsed.port}`,
          tokenFile: resolveTokenFile(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    godot_mcp_tool_list: async (raw) => {
      const parsed = z.object({
        query: z.string().optional(),
        includeSchemas: z.boolean().default(true),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT),
      }).parse(raw);
      return await getCatalog(parsed.port, parsed.query, parsed.includeSchemas);
    },
    godot_mcp_instance_list: async (raw) => {
      const parsed = z.object({ port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT) }).parse(raw);
      const status = await getStatus(parsed.port);
      const detail = status.status && typeof status.status === "object" ? status.status as Record<string, unknown> : {};
      return {
        endpoint: status.endpoint,
        instances: detail.connected ? [{
          projectPath: detail.project_path,
          projectId: detail.project_id,
          projectName: detail.project_name,
          editorInstanceId: detail.editor_instance_id,
          runtimeInstanceId: detail.runtime_instance_id,
          runtimeConnected: Boolean(detail.runtime_instance_id),
          mode: detail.tool_mode,
        }] : [],
      };
    },
    godot_mcp_query: async (raw) => {
      const parsed = z.object({
        toolName: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(DEFAULT_TIMEOUT_MS),
      }).parse(raw);
      return await safeQuery(parsed.toolName, parsed.arguments, parsed.port, parsed.timeoutMs);
    },
    godot_screen_capture_save: async (raw) => {
      const parsed = z.object({
        resourcePath: z.string().default("res://addons/godot_mcp/cache/screenshots/bridge-capture.png"),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(DEFAULT_TIMEOUT_MS),
      }).parse(raw);
      if (!parsed.resourcePath.startsWith("res://") || !parsed.resourcePath.toLowerCase().endsWith(".png")) {
        throw new Error("resourcePath must be a res:// path ending in .png.");
      }
      const response = await safeQuery("take_screenshot", {
        save_to: parsed.resourcePath,
        return_base64: false,
      }, parsed.port, parsed.timeoutMs);
      const result = response.result && typeof response.result === "object" ? response.result as Record<string, unknown> : {};
      if (typeof result.absolute_path !== "string") throw new Error("Godot screenshot did not return an absolute_path.");
      const absolutePath = resolveToolPath(result.absolute_path);
      const data = await fs.readFile(absolutePath);
      if (data.length > MAX_IMAGE_BYTES) throw new Error(`Godot screenshot exceeds ${MAX_IMAGE_BYTES} bytes.`);
      if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Godot screenshot is not a valid PNG.");
      return {
        outputPath: absolutePath,
        resourcePath: parsed.resourcePath,
        bytes: data.length,
        width: result.width,
        height: result.height,
        sha256: createHash("sha256").update(data).digest("hex"),
        __bridgeImages: [{ type: "image", mimeType: "image/png", data: data.toString("base64") }],
      };
    },
  },
};
