import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { beginToolMetric, finishToolMetric } from "./metrics.js";
import { createDefaultToolRegistry } from "./tool-registry.js";

export { SERVER_NAME, SERVER_VERSION } from "./config.js";
export { bridgeRestartStatus } from "./tools/bridge-ops.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type BridgeImageAttachment = { type: "image"; data: string; mimeType: string };
type ToolContentPart = { type: "text"; text: string } | BridgeImageAttachment;

function toolContent(data: JsonValue | unknown) {
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
      const { __bridgeImages: _internalImages, ...publicPayload } = record;
      payload = publicPayload;
    }
  }
  const content: ToolContentPart[] = [
    { type: "text", text: JSON.stringify(payload, null, 2) },
    ...images,
  ];
  return { content };
}

export function createBridgeServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: [
        "This server controls MauroPrime. When substantial work begins in a known repository, call project_context_load once with the project root and current task so project rules, context, state, and workflow guides become active.",
        "When a user describes a repeatable multi-step process, says it should happen every time or in future, asks for a skill/pipeline/template/hook, or an existing reusable workflow may apply, call workflow_guide_recommend. Load a strong match with workflow_guide_load. Recommend creating a new guide when a repeatable pattern is detected without a strong match, but call workflow_guide_create only when the user asks or approves.",
        "For character concept-to-Blender work, load the character-concept-blender guide, use ChatGPT image generation for visual creation or editing, persist images with image_asset_save, normalize four views with image_character_views_prepare, create the Blender reference scene with blender_setup_character_references, and use blender_review_bundle for multi-angle renders plus geometry, rig, animation, visibility, and diagnostic context before editing.",
        "For arbitrary binary payloads, never route base64 through write_text_file. Use binary_file_write for small files or binary_upload_begin/append/status/finish for resumable large transfers, then verify with binary_file_info.",
        "When the user asks you to look at, inspect, read, or review the current TabletWhiteboard view, call whiteboard_capture_pc_view so the connected PC creates a fresh viewport PNG at its exact pan and zoom and the image is attached to the result. Use whiteboard_latest_capture only when the user explicitly wants the last saved image without taking a new one.",
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
    const complete = (result: ReturnType<typeof toolContent>, ok = true, error?: string) => {
      const outputChars = result.content.reduce((total, part) => {
        return total + (part.type === "text" ? part.text.length : part.data.length);
      }, 0);
      finishToolMetric(metric, ok, outputChars, error);
      return result;
    };

    try {
      if (!modularToolRegistry.has(name)) throw new Error(`Unknown tool: ${name}`);
      const result = await modularToolRegistry.call(name, args as Record<string, unknown>);
      return complete(toolContent(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return complete(toolContent({ error: message }), false, message);
    }
  });

  return server;
}
