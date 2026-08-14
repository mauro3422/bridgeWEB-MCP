import { createHash } from "node:crypto";
import fs from "node:fs/promises";
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

function requestJson(options: {
  port: number;
  method: "GET" | "POST";
  pathname: string;
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
  return await requestJson({ port, method: "GET", pathname });
}

async function providerTool(name: string, args: Record<string, unknown>, port: number, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return await requestJson({
    port,
    method: "POST",
    pathname: "/tool",
    body: { name, args },
    timeoutMs,
  });
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
    connectionScope: "localhost-only",
    health,
    status: parseMcpText(status),
  };
}

type GodotToolClassification = "read-only" | "action";
type ClassifiedGodotTool = Record<string, unknown> & {
  name: string;
  description: string;
  classification: GodotToolClassification;
};

function classifyGodotTool(name: string): GodotToolClassification {
  return GODOT_READ_ONLY_TOOL_NAMES.has(name) ? "read-only" : "action";
}

async function getCatalog(port: number, query?: string, includeSchemas = true) {
  const response = await providerGet("/tools", port);
  const all = Array.isArray(response.tools) ? response.tools as Record<string, unknown>[] : [];
  const normalized = query?.trim().toLowerCase();
  const visible: ClassifiedGodotTool[] = all
    .filter((tool) => {
      const name = typeof tool.name === "string" ? tool.name : "";
      const description = typeof tool.description === "string" ? tool.description : "";
      return !normalized || `${name} ${description}`.toLowerCase().includes(normalized);
    })
    .map((tool) => {
      const name = typeof tool.name === "string" ? tool.name : "";
      const description = typeof tool.description === "string" ? tool.description : "";
      return { ...tool, name, description, classification: classifyGodotTool(name) };
    });
  const readOnlyCount = visible.filter((tool) => tool.classification === "read-only").length;
  const actionCount = visible.length - readOnlyCount;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    connectionScope: "localhost-only",
    providerCount: all.length,
    toolCount: visible.length,
    readOnlyCount,
    actionCount,
    safeCount: readOnlyCount,
    tools: includeSchemas
      ? visible
      : visible.map(({ name, description, classification }) => ({ name, description, classification })),
  };
}

async function safeQuery(toolName: string, args: Record<string, unknown>, port: number, timeoutMs: number) {
  if (!GODOT_READ_ONLY_TOOL_NAMES.has(toolName)) {
    throw new Error(`Godot tool '${toolName}' is not classified read-only; use godot_mcp_action.`);
  }
  const catalog = await getCatalog(port, toolName, true);
  const exact = catalog.tools.find((tool) => tool.name === toolName);
  if (!exact) throw new Error(`Godot tool '${toolName}' is not exposed by the current live provider catalog.`);
  const response = await providerTool(toolName, args, port, timeoutMs);
  return {
    toolName,
    classification: "read-only",
    result: parseMcpText(response),
  };
}

async function actionQuery(toolName: string, args: Record<string, unknown>, port: number, timeoutMs: number) {
  if (GODOT_READ_ONLY_TOOL_NAMES.has(toolName)) {
    throw new Error(`Godot tool '${toolName}' is classified read-only; use godot_mcp_query.`);
  }
  const catalog = await getCatalog(port, toolName, true);
  const exact = catalog.tools.find((tool) => tool.name === toolName);
  if (!exact) throw new Error(`Godot tool '${toolName}' is not exposed by the current live provider catalog.`);
  const response = await providerTool(toolName, args, port, timeoutMs);
  return {
    toolName,
    classification: "action",
    result: parseMcpText(response),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeScenePath(value: string): string {
  const scenePath = value.trim().replace(/\\/g, "/");
  if (!scenePath.startsWith("res://")) throw new Error(`Godot scene path must start with res://: ${value}`);
  if (scenePath.slice("res://".length).split("/").includes("..")) throw new Error(`Godot scene path may not escape the project: ${value}`);
  const lower = scenePath.toLowerCase();
  if (!lower.endsWith(".tscn") && !lower.endsWith(".scn")) throw new Error(`Godot scene path must end in .tscn or .scn: ${value}`);
  return scenePath;
}

function assertProviderResult(toolName: string, value: unknown): Record<string, unknown> {
  const result = asRecord(value);
  if (result.ok === false || (typeof result.error === "string" && result.error.trim())) {
    throw new Error(`Godot provider ${toolName} failed: ${String(result.error ?? "unknown error")}`);
  }
  return result;
}

function sceneReadbackSummary(value: unknown): Record<string, unknown> {
  const result = assertProviderResult("read_scene", value);
  const root = asRecord(result.root);
  return {
    scenePath: result.scene_path,
    rootName: root.name,
    rootType: root.type,
    childCount: Array.isArray(root.children) ? root.children.length : undefined,
  };
}

async function requireConnectedEditor(port: number) {
  const status = await getStatus(port);
  const detail = asRecord(status.status);
  if (!detail.connected) throw new Error(`No connected Godot editor is available at ${status.endpoint}. Reuse/connect the intended editor before scene operations.`);
  if (!detail.editor_instance_id) throw new Error("Godot provider is connected but did not report an editor instance id.");
  return { status, detail };
}

async function verifyActiveScene(scenePath: string, port: number, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + Math.min(timeoutMs, 4000);
  let last: Record<string, unknown> = {};
  do {
    const response = await safeQuery("scene_tree_dump", {}, port, timeoutMs);
    last = assertProviderResult("scene_tree_dump", response.result);
    if (last.scene_path === scenePath) return last;
    await new Promise((resolve) => setTimeout(resolve, 80));
  } while (Date.now() < deadline);
  throw new Error(`Godot editor did not confirm '${scenePath}' as the active edited scene; last scene was '${String(last.scene_path ?? "unknown")}'.`);
}

async function openSceneNative(scenePath: string, port: number, timeoutMs: number) {
  const readResponse = await safeQuery("read_scene", { scene_path: scenePath }, port, timeoutMs);
  const readback = sceneReadbackSummary(readResponse.result);
  const openResponse = await actionQuery("open_in_godot", { path: scenePath }, port, timeoutMs);
  const openResult = assertProviderResult("open_in_godot", openResponse.result);
  const active = await verifyActiveScene(scenePath, port, timeoutMs);
  return {
    scenePath,
    opened: true,
    verifiedActive: true,
    readback,
    providerMessage: openResult.message,
    activeRootName: typeof active.tree === "string" ? String(active.tree).split(/\r?\n/, 1)[0] : undefined,
  };
}

export const godotToolModule: BridgeToolModule = {
  name: "godot",
  tools: [
    {
      name: "godot_mcp_status",
      description: "Check the localhost-only MauroPrime Godot MCP provider, connected editor/runtime, project identity, mode, and tool count.",
      inputSchema: {
        type: "object",
        properties: { port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 } },
        additionalProperties: false,
      },
    },
    {
      name: "godot_mcp_tool_list",
      description: "List every live Godot provider tool and classify each as read-only or action for uninterrupted local authoring loops.",
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
      description: "Return the currently connected Godot project, stable project id, editor instance id, and runtime instance id from the local provider.",
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
      name: "godot_mcp_action",
      description: "Invoke one live non-read-only Godot authoring, project-control, or playtest tool from the localhost provider. No per-operation user prompt is required; the caller must still supply the exact live tool name and arguments.",
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
      name: "godot_scene_open",
      description: "Open one or more existing Godot .tscn/.scn scenes in the already-connected editor using Godot's native editor API, never Ctrl+O/click automation. Each scene is read back before opening and confirmed as the active edited scene immediately after opening. Optionally choose which opened scene remains active at the end.",
      inputSchema: {
        type: "object",
        properties: {
          scenePaths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 24, description: "Existing res:// .tscn/.scn scene paths to open in order." },
          activeScenePath: { type: "string", description: "Optional opened scene that should remain active after the batch. Must also appear in scenePaths." },
          port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS, minimum: 1000, maximum: 120000 },
        },
        required: ["scenePaths"],
        additionalProperties: false,
      },
    },
    {
      name: "godot_scene_create",
      description: "Create and persist a Godot .tscn/.scn scene through the connected native Godot provider, read the saved scene back, and optionally open it in the same editor without UI automation. Supports a root node, optional nested child node specs, and an optional root script.",
      inputSchema: {
        type: "object",
        properties: {
          scenePath: { type: "string", description: "Destination res:// path ending in .tscn or .scn." },
          rootNodeType: { type: "string", description: "Godot root node class, e.g. Node, Node2D, Node3D, Control." },
          rootNodeName: { type: "string", description: "Optional root node name. Omit to derive it from the filename." },
          nodes: { type: "array", items: { type: "object", additionalProperties: true }, description: "Optional nested child node specs accepted by the provider create_scene tool." },
          attachScript: { type: "string", description: "Optional res:// script path to attach to the root node." },
          openInEditor: { type: "boolean", default: true, description: "Open and verify the created scene in the already-connected editor after persistence." },
          port: { type: "number", default: DEFAULT_GODOT_HTTP_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS, minimum: 1000, maximum: 120000 },
        },
        required: ["scenePath", "rootNodeType"],
        additionalProperties: false,
      },
    },
    {
      name: "godot_screen_capture_save",
      description: "Capture the connected Godot game viewport through the local runtime, verify the PNG, and attach the original image for visual review.",
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
          connectionScope: "localhost-only",
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
    godot_mcp_action: async (raw) => {
      const parsed = z.object({
        toolName: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(DEFAULT_TIMEOUT_MS),
      }).parse(raw);
      return await actionQuery(parsed.toolName, parsed.arguments, parsed.port, parsed.timeoutMs);
    },
    godot_scene_open: async (raw) => {
      const parsed = z.object({
        scenePaths: z.array(z.string().min(1)).min(1).max(24),
        activeScenePath: z.string().min(1).optional(),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(DEFAULT_TIMEOUT_MS),
      }).parse(raw);
      const scenePaths = parsed.scenePaths.map(normalizeScenePath);
      if (new Set(scenePaths).size !== scenePaths.length) throw new Error("scenePaths must not contain duplicates.");
      const activeScenePath = parsed.activeScenePath ? normalizeScenePath(parsed.activeScenePath) : scenePaths.at(-1)!;
      if (!scenePaths.includes(activeScenePath)) throw new Error("activeScenePath must also appear in scenePaths.");
      const { status, detail } = await requireConnectedEditor(parsed.port);
      const opened = [];
      for (const scenePath of scenePaths) opened.push(await openSceneNative(scenePath, parsed.port, parsed.timeoutMs));
      if (scenePaths.at(-1) !== activeScenePath) await openSceneNative(activeScenePath, parsed.port, parsed.timeoutMs);
      const finalActive = await verifyActiveScene(activeScenePath, parsed.port, parsed.timeoutMs);
      return {
        endpoint: status.endpoint,
        projectPath: detail.project_path,
        projectId: detail.project_id,
        projectName: detail.project_name,
        editorInstanceId: detail.editor_instance_id,
        opened,
        activeScenePath: finalActive.scene_path,
        verified: finalActive.scene_path === activeScenePath,
        uiAutomation: false,
        nativeProviderOperation: "open_in_godot",
      };
    },
    godot_scene_create: async (raw) => {
      const parsed = z.object({
        scenePath: z.string().min(1),
        rootNodeType: z.string().min(1),
        rootNodeName: z.string().min(1).optional(),
        nodes: z.array(z.record(z.string(), z.unknown())).optional(),
        attachScript: z.string().min(1).optional(),
        openInEditor: z.boolean().default(true),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_GODOT_HTTP_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(DEFAULT_TIMEOUT_MS),
      }).parse(raw);
      const scenePath = normalizeScenePath(parsed.scenePath);
      const { status, detail } = await requireConnectedEditor(parsed.port);
      const providerArgs: Record<string, unknown> = {
        scene_path: scenePath,
        root_node_type: parsed.rootNodeType,
      };
      if (parsed.rootNodeName) providerArgs.root_node_name = parsed.rootNodeName;
      if (parsed.nodes) providerArgs.nodes = parsed.nodes;
      if (parsed.attachScript) providerArgs.attach_script = parsed.attachScript;
      const createResponse = await actionQuery("create_scene", providerArgs, parsed.port, parsed.timeoutMs);
      const createResult = assertProviderResult("create_scene", createResponse.result);
      const readResponse = await safeQuery("read_scene", { scene_path: scenePath }, parsed.port, parsed.timeoutMs);
      const readback = sceneReadbackSummary(readResponse.result);
      let openedInEditor = false;
      let activeScenePath: unknown = undefined;
      if (parsed.openInEditor) {
        const opened = await openSceneNative(scenePath, parsed.port, parsed.timeoutMs);
        openedInEditor = opened.verifiedActive;
        activeScenePath = scenePath;
      }
      return {
        endpoint: status.endpoint,
        projectPath: detail.project_path,
        projectId: detail.project_id,
        projectName: detail.project_name,
        editorInstanceId: detail.editor_instance_id,
        scenePath,
        created: createResult.created ?? true,
        providerResult: createResult,
        readback,
        openedInEditor,
        activeScenePath,
        verified: readback.scenePath === scenePath && (!parsed.openInEditor || openedInEditor),
        uiAutomation: false,
        nativeProviderOperations: parsed.openInEditor ? ["create_scene", "read_scene", "open_in_godot", "scene_tree_dump"] : ["create_scene", "read_scene"],
      };
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
