import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/process.js";

// Explicit bridge adapters for audited standalone Blender MCP operations.
// The tool implementation remains owned by blender-mcp, not copied into Bridge.
// Fail closed when the standalone build is unavailable.
const standaloneRoot = () => path.resolve(process.env.MAURO_BLENDER_MCP_ROOT || "D:/Dev/blender-mcp");
const standaloneTool = async (moduleName: string, exportName: string) => {
  const modulePath = path.join(standaloneRoot(), "dist", "src", "tools", moduleName + ".js");
  const mod = await import(pathToFileURL(modulePath).href);
  const tool = mod[exportName];
  if (!tool || typeof tool.handler !== "function") throw new Error("Missing standalone Blender MCP tool: " + exportName);
  return tool;
};
const savedPath = (requested: string, extension: string) => {
  const output = resolveToolPath(requested, { access: "write" });
  if (path.extname(output).toLowerCase() !== extension) throw new Error("Expected " + extension + " output path");
  return output;
};

export const blenderStandaloneProxyToolModule: BridgeToolModule = {
  name: "blender-standalone-mcp-proxy",
  tools: [
    {
      name: "blender_viewport_capture",
      description: "Use the standalone Blender MCP to capture a Blender-rendered viewport PNG without focusing the OS window. Verifies exact live scene/workspace and optional .blend, frame and active object. This renders through Blender itself; it is NOT a screen copy. Does not promise zero Blender render-side activity; use a test scene first.",
      inputSchema: { type: "object", properties: {
        expectedBlendFile: { type: "string", minLength: 1 },
        expectedScene: { type: "string", minLength: 1 },
        expectedWorkspace: { type: "string", minLength: 1 },
        expectedFrame: { type: "number", minimum: 0 },
        expectedActiveObject: { type: "string", minLength: 1 },
        outputPath: { type: "string", minLength: 1 },
        overwrite: { type: "boolean", default: false },
        port: { type: "number", minimum: 1024, maximum: 65535, default: 9878 },
        timeoutMs: { type: "number", minimum: 1000, maximum: 180000, default: 60000 }
      }, required: ["expectedScene", "expectedWorkspace", "outputPath"], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    {
      name: "blender_session_snapshot",
      description: "Use the standalone Blender MCP to write a guarded copy of the current live Blender session to a distinct .blend file. Never overwrites output, never saves the active .blend; refuses recent human activity by default. This is a write operation, not a read-only screenshot.",
      inputSchema: { type: "object", properties: {
        expectedBlendFile: { type: "string", minLength: 1 },
        outputBlendFile: { type: "string", minLength: 1 },
        recentActivityWindowSeconds: { type: "integer", minimum: 0, maximum: 3600, default: 15 },
        allowRecentHumanActivity: { type: "boolean", default: false },
        port: { type: "integer", minimum: 1024, maximum: 65535, default: 9878 },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, default: 60000 }
      }, required: ["expectedBlendFile", "outputBlendFile"], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: true }
    }
  ],
  handlers: {
    blender_viewport_capture: async (raw) => {
      const input = z.object({
        expectedBlendFile: z.string().min(1).optional(),
        expectedScene: z.string().min(1), expectedWorkspace: z.string().min(1),
        expectedFrame: z.number().int().min(0).optional(), expectedActiveObject: z.string().min(1).optional(),
        outputPath: z.string().min(1), overwrite: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(9878),
        timeoutMs: z.number().int().min(1000).max(180000).default(60000)
      }).strict().parse(raw);
      const outputPath = savedPath(input.outputPath, ".png");
      const tool = await standaloneTool("viewport-capture", "blenderViewportCaptureTool");
      return await tool.handler({ ...input, outputPath });
    },
    blender_session_snapshot: async (raw) => {
      const input = z.object({
        expectedBlendFile: z.string().min(1), outputBlendFile: z.string().min(1),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(9878),
        timeoutMs: z.number().int().min(1000).max(120000).default(60000)
      }).strict().parse(raw);
      const outputBlendFile = savedPath(input.outputBlendFile, ".blend");
      if (path.resolve(outputBlendFile).toLowerCase() === path.resolve(input.expectedBlendFile).toLowerCase()) {
        throw new Error("Snapshot output cannot be the active Blender file");
      }
      const tool = await standaloneTool("session-snapshot", "blenderSessionSnapshotTool");
      return await tool.handler({ ...input, outputBlendFile });
    }
  }
};
