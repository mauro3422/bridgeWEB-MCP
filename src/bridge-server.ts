import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { beginToolMetric, finishToolMetric } from "./metrics.js";
import {
  drainBridgeNotices,
  emitBridgeNotice,
  type BridgeNotice,
  type BridgeNoticeInput,
} from "./notices.js";
import { createDefaultToolRegistry } from "./tool-registry.js";

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

function emitAutomaticMetricNotices(toolName: string, event: ReturnType<typeof finishToolMetric>, hasImages = false) {
  if (noticeInspectionTools.has(toolName)) return;
  if (!event.ok) {
    emitBridgeNotice({
      severity: "error",
      code: "tool-call-failed",
      source: toolName,
      message: event.error || `La herramienta ${toolName} falló.`,
      details: { durationMs: event.durationMs, inputKeys: event.inputKeys },
      dedupeKey: `${toolName}:tool-call-failed:${event.error || "unknown"}`,
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

export function createBridgeServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, logging: {} },
      instructions: [
        "This server controls MauroPrime. When substantial work begins in a known repository, call project_context_load once with the project root and current task so project rules, context, state, and workflow guides become active.",
        "When a user describes a repeatable multi-step process, says it should happen every time or in future, asks for a skill/pipeline/template/hook, or an existing reusable workflow may apply, call workflow_guide_recommend. Load a strong match with workflow_guide_load. Recommend creating a new guide when a repeatable pattern is detected without a strong match, but call workflow_guide_create only when the user asks or approves.",
        "For character concept-to-Blender work, load the character-concept-blender guide, use ChatGPT image generation for visual creation or editing, persist images with image_asset_save, normalize four views with image_character_views_prepare, create the Blender reference scene with blender_setup_character_references, and use blender_review_bundle for multi-angle renders plus geometry, rig, animation, visibility, and diagnostic context before editing.",
        "For arbitrary binary payloads, never route base64 through write_text_file. Use binary_file_write for small files or binary_upload_begin/append/status/finish for resumable large transfers, then verify with binary_file_info.",
        "When ChatGPT must visually inspect existing local PNG, JPEG, or WebP files, use image_file_attach. It attaches the original image bytes as MCP image content without printing the encoded payload; do not substitute binary_file_read_chunk, temporary HTTP servers, tunnels, or resized previews unless attachment itself is proven unavailable.",
        "When the user asks you to look at, inspect, read, or review the current TabletWhiteboard view, call whiteboard_capture_pc_view so the connected PC creates a fresh viewport PNG at its exact pan and zoom and the image is attached to the result. Use whiteboard_latest_capture only when the user explicitly wants the last saved image without taking a new one.",
        "When the user asks you to write, explain, diagram, annotate, or place an existing image inside TabletWhiteboard, use whiteboard_add_text for structured prose, whiteboard_add_diagram for safe shapes, arrows, polylines and Bezier paths, whiteboard_add_svg only for sanitized SVG markup, and whiteboard_insert_image only for an existing local PNG, JPEG, or WebP. These tools write to ChatGPT's separate locked layer; do not claim an object exists until the tool confirms it.",
        "Bridge anomaly notices are delivered inside normal tool responses as bridgeNotices and are removed from the pending queue after delivery. Inspect them before continuing a long workflow.",
        "Never claim that a guide, file, image, build, Blender scene, or other side effect exists until a tool result confirms it.",
      ].join(" "),
    },
  );
  const modularToolRegistry = createDefaultToolRegistry();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: modularToolRegistry.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const metric = beginToolMetric(name, args);

    const complete = (rawData: unknown, ok = true, error?: string) => {
      const extracted = extractInternalNotices(rawData);
      for (const notice of extracted.notices) emitBridgeNotice(notice);
      const preview = toolContent(extracted.payload);
      const hasImages = preview.content.some((part) => part.type === "image");
      const outputChars = preview.content.reduce((total, part) => {
        return total + (part.type === "text" ? part.text.length : part.data.length);
      }, 0);
      const event = finishToolMetric(metric, ok, outputChars, error);
      emitAutomaticMetricNotices(name, event, hasImages);
      const delivered = noticeInspectionTools.has(name) ? [] : drainBridgeNotices();
      return toolContent(extracted.payload, delivered);
    };

    try {
      if (!modularToolRegistry.has(name)) throw new Error(`Unknown tool: ${name}`);
      const result = await modularToolRegistry.call(name, args as Record<string, unknown>);
      return complete(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return complete({ error: message }, false, message);
    }
  });

  return server;
}
