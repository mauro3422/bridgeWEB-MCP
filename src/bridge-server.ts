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

function jsonText(data: JsonValue) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function createBridgeServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: [
        "This server controls files, Git, terminals, reusable workflow guides, generated-image persistence, and Blender on MauroPrime.",
        "When a user describes a repeatable multi-step process, says it should happen every time or in future, asks for a skill/pipeline/template/hook, or an existing reusable workflow may apply, call workflow_guide_recommend. Load a strong match with workflow_guide_load. Recommend creating a new guide when a repeatable pattern is detected without a strong match, but call workflow_guide_create only when the user asks or approves.",
        "For character concept-to-Blender work, load the character-concept-blender guide, use ChatGPT image generation for visual creation or editing, persist images with image_asset_save, normalize four views with image_character_views_prepare, create the Blender reference scene with blender_setup_character_references, and verify through tool results.",
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
    const complete = (result: ReturnType<typeof jsonText>, ok = true, error?: string) => {
      const outputText = result.content.map((part) => part.text).join("\n");
      finishToolMetric(metric, ok, outputText.length, error);
      return result;
    };

    try {
      if (!modularToolRegistry.has(name)) throw new Error(`Unknown tool: ${name}`);
      const result = await modularToolRegistry.call(name, args as Record<string, unknown>);
      return complete(jsonText(result as JsonValue));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return complete(jsonText({ error: message }), false, message);
    }
  });

  return server;
}
