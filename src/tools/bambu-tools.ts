import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { resolveToolPath } from "./shared/path.js";
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
    const client = new Client({ name: "MauroPrime-Bridge-Bambu", version: "0.1.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      current = { client, transport, connectedAt: new Date().toISOString() };
      return current;
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  })();
  try { return await connecting; } finally { connecting = null; }
}

async function list(): Promise<Array<{name:string; description?:string; annotations?:Record<string,unknown>}>> {
  const connection = await link();
  try {
    const response = await connection.client.listTools();
    return response.tools.map(t => ({name:t.name,description:t.description,
      annotations:t.annotations as unknown as Record<string,unknown>|undefined}));
  } catch(err) {
    current = null;
    void connection.transport.close().catch(() => {});
    throw err;
  }
}
async function providerTool(name: string, args: Record<string,unknown>) {
  const conn = await link();
  if (!(await list()).some(t => t.name === name)) throw new Error("Standalone Bambu MCP does not expose " + name);
  const result = await conn.client.callTool({name, arguments:args}, undefined, {timeout:60_000});
  const content: Array<{type:string;text?:string}> = Array.isArray(result.content)
    ? result.content as Array<{type:string;text?:string}> : [];
  if (result.isError) {
    const failure = content.find(i => i.type === "text");
    throw new Error(failure?.type === "text" ? String(failure.text) : "Bambu MCP tool returned error");
  }
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const payload = content.find(i => i.type === "text");
  if (!payload || payload.type !== "text") throw new Error("Bambu MCP returned no JSON result");
  return JSON.parse(String(payload.text ?? "{}")) as Record<string,unknown>;
}

const src = (value:string) => {
  const file = resolveToolPath(value,{access:"read"});
  if (path.extname(file).toLowerCase() !== ".3mf") throw new Error("Expected .3mf");
  return file;
};
const out = (value:string,isFile=false) => {
  const file = resolveToolPath(value,{access:"write"});
  if (isFile && path.extname(file).toLowerCase() !== ".png") throw new Error("Expected .png");
  return file;
};
const pathParam = {type:"string",minLength:1};
const empty = {type:"object",properties:{},additionalProperties:false};

export const bambuToolModule: BridgeToolModule = {
  name:"bambu-standalone-mcp-proxy",
  tools:[
    {name:"bambu_mcp_status",description:"Inspect connection to separate reusable Bambu Studio stdio MCP server.",inputSchema:empty},
    {name:"bambu_mcp_tool_list",description:"Discover the current external Bambu Studio MCP tool catalog.",inputSchema:empty},
    {name:"bambu_project_inspect",description:"Read saved 3MF objects, parts, text and location via external Bambu MCP. No live unsaved UI state.",inputSchema:{type:"object",properties:{path:pathParam,maxObjects:{type:"integer",minimum:1,maximum:200}},required:["path"],additionalProperties:false}},
    {name:"bambu_project_diagnose",description:"Detect negative parts that have no bounding-box intersection with printable geometry in a saved 3MF. Cannot prove real slicing outcome.",inputSchema:{type:"object",properties:{path:pathParam},required:["path"],additionalProperties:false}},
    {name:"bambu_project_compare",description:"Compare two saved 3MFs via separate Bambu MCP. Read-only.",inputSchema:{type:"object",properties:{beforePath:pathParam,afterPath:pathParam},required:["beforePath","afterPath"],additionalProperties:false}},
    {name:"bambu_window_status",description:"List Bambu Studio window status through separate MCP without changing focus.",inputSchema:empty},
    {name:"bambu_capture_save",description:"Foreground-only Bambu Studio window/viewport capture. Refuses minimized, occluded or out-of-focus windows.",inputSchema:{type:"object",properties:{outputPath:pathParam,region:{type:"string",enum:["window","viewport"]}},required:["outputPath"],additionalProperties:false}},
    {name:"bambu_saved_views_save",description:"Extract existing 3MF preview PNGs via separate MCP, no live UI interaction.",inputSchema:{type:"object",properties:{path:pathParam,outputDir:pathParam},required:["path","outputDir"],additionalProperties:false}},
    {name:"bambu_offscreen_views_save",description:"Render top/isometric/front/side saved-3MF views offscreen with standalone Bambu MCP. No focus stealing; excludes unsaved changes.",inputSchema:{type:"object",properties:{path:pathParam,outputDir:pathParam,views:{type:"string"}},required:["path","outputDir"],additionalProperties:false}}
  ],
  handlers:{
    bambu_mcp_status:async args => {
      z.object({}).strict().parse(args);
      const conn=await link(),tools=await list();
      return {ok:true,provider:"standalone-bambu-mcp-stdio",connectedAt:conn.connectedAt,toolCount:tools.length,
        serverPath:path.resolve(process.env.BRIDGE_BAMBU_MCP_SERVER_PATH || DEFAULT_SERVER)};
    },
    bambu_mcp_tool_list:async args => {z.object({}).strict().parse(args);return {tools:await list()};},
    bambu_project_inspect:async args => {
      const x=z.object({path:z.string().min(1),maxObjects:z.number().int().min(1).max(200).optional()}).strict().parse(args);
      return providerTool("bambu_project_inspect",{path:src(x.path),...(x.maxObjects?{maxObjects:x.maxObjects}:{})});
    },
    bambu_project_diagnose:async args => {
      const x=z.object({path:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_project_diagnose",{path:src(x.path)});
    },
    bambu_project_compare:async args => {
      const x=z.object({beforePath:z.string().min(1),afterPath:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_project_compare",{beforePath:src(x.beforePath),afterPath:src(x.afterPath)});
    },
    bambu_window_status:async args => {z.object({}).strict().parse(args);return providerTool("bambu_window_status",{});},
    bambu_capture_save:async args => {
      const x=z.object({outputPath:z.string().min(1),region:z.enum(["window","viewport"]).default("viewport")}).strict().parse(args);
      return providerTool("bambu_capture_save",{outputPath:out(x.outputPath,true),region:x.region});
    },
    bambu_saved_views_save:async args => {
      const x=z.object({path:z.string().min(1),outputDir:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_saved_views_save",{path:src(x.path),outputDir:out(x.outputDir)});
    },
    bambu_offscreen_views_save:async args => {
      const x=z.object({path:z.string().min(1),outputDir:z.string().min(1),views:z.string().default("top,isometric,front,side")}).strict().parse(args);
      return providerTool("bambu_offscreen_views_save",{path:src(x.path),outputDir:out(x.outputDir),views:x.views});
    }
  }
};
