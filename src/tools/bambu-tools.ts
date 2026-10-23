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
const sliced = (value:string) => {
  const file=resolveToolPath(value,{access:"read"});
  const suffix=path.extname(file).toLowerCase();
  if (suffix!==".gcode" && suffix!==".3mf") throw new Error("Expected saved .gcode or sliced .gcode.3mf");
  return file;
};
const out = (value:string,isFile=false) => {
  const file = resolveToolPath(value,{access:"write"});
  if (isFile && path.extname(file).toLowerCase() !== ".png") throw new Error("Expected .png");
  return file;
};
const regionInputs=z.object({
  slicedPath:z.string().min(1),projectPath:z.string().min(1).optional(),
  objectName:z.string().min(1).optional(),partName:z.string().min(1).optional(),
  text:z.string().min(1).optional(),minX:z.number().finite().optional(),minY:z.number().finite().optional(),
  maxX:z.number().finite().optional(),maxY:z.number().finite().optional(),
  minZ:z.number().finite().optional(),maxZ:z.number().finite().optional(),
  plate:z.number().int().min(1).max(50).default(1)
});
const pathParam = {type:"string",minLength:1};
const empty = {type:"object",properties:{},additionalProperties:false};

export const bambuToolModule: BridgeToolModule = {
  name:"bambu-standalone-mcp-proxy",
  tools:[
    {name:"bambu_mcp_status",description:"Inspect connection to separate reusable Bambu Studio stdio MCP server.",inputSchema:empty},
    {name:"bambu_mcp_tool_list",description:"Discover the current external Bambu Studio MCP tool catalog.",inputSchema:empty},
    {name:"bambu_project_inspect",description:"Read saved 3MF objects, parts, text and location via external Bambu MCP. No live unsaved UI state.",inputSchema:{type:"object",properties:{path:pathParam,maxObjects:{type:"integer",minimum:1,maximum:200}},required:["path"],additionalProperties:false}},
    {name:"bambu_project_diagnose",description:"Detect negative parts that have no bounding-box intersection with printable geometry in a saved 3MF. Cannot prove real slicing outcome.",inputSchema:{type:"object",properties:{path:pathParam},required:["path"],additionalProperties:false}},
    {name:"bambu_text_cut_diagnose",description:"Diagnose hidden negative text after Merge: retained text metadata, subtype, intersection with merged positive geometry. Saved 3MF only; slicing not proved.",inputSchema:{type:"object",properties:{path:pathParam},required:["path"],additionalProperties:false}},
    {name:"bambu_project_compare",description:"Compare two saved 3MFs via separate Bambu MCP. Read-only.",inputSchema:{type:"object",properties:{beforePath:pathParam,afterPath:pathParam},required:["beforePath","afterPath"],additionalProperties:false}},
    {name:"bambu_slice_inspect",description:"Read actual post-slice G-code in .gcode or .gcode.3mf, enumerate extrusion layers and XY paths. Saved editable project 3MF alone is not sliced.",inputSchema:{type:"object",properties:{path:pathParam,plate:{type:"integer",minimum:1,maximum:50}},required:["path"],additionalProperties:false}},
    {name:"bambu_slice_layer_render",description:"Export PNG showing reconstructed real post-slice extrusion paths at a specified layer/Z. No Bambu focus change.",inputSchema:{type:"object",properties:{path:pathParam,outputDir:pathParam,plate:{type:"integer",minimum:1,maximum:50},layerIndex:{type:"integer",minimum:0,maximum:4000},layerZMm:{type:"number",minimum:-10,maximum:1000}},required:["path","outputDir"],additionalProperties:false}},
    {name:"bambu_slice_compare",description:"Read-only comparison of post-slice extrusion paths before vs after Merge, optionally limited to text bounds. Does not write files.",inputSchema:{type:"object",properties:{beforePath:pathParam,afterPath:pathParam,projectPath:pathParam,text:pathParam,plate:{type:"integer",minimum:1,maximum:50}},required:["beforePath","afterPath"],additionalProperties:false}},
    {name:"bambu_slice_compare_images_save",description:"Compare two sliced G-code exports and write paired QA PNGs for the most divergent layer; explicit outputDir required.",inputSchema:{type:"object",properties:{beforePath:pathParam,afterPath:pathParam,projectPath:pathParam,text:pathParam,outputDir:pathParam,plate:{type:"integer",minimum:1,maximum:50}},required:["beforePath","afterPath","outputDir"],additionalProperties:false}},
    {name:"bambu_slice_text_diagnose",description:"Load sliced G-code and saved 3MF text region to output post-slice evidence per engraving layer (PNG files). Requires exported sliced plate, no Bambu GUI operation.",inputSchema:{type:"object",properties:{slicedPath:pathParam,projectPath:pathParam,text:pathParam,outputDir:pathParam,plate:{type:"integer",minimum:1,maximum:50}},required:["slicedPath","projectPath","text","outputDir"],additionalProperties:false}},
    {name:"bambu_slice_headless_save",description:"Run installed Bambu CLI in isolated configuration directory to slice an independent QA-only 3MF and export a validated .gcode.3mf. Does not focus GUI, touch original or print.",inputSchema:{type:"object",properties:{inputPath:pathParam,outputDir:pathParam,label:pathParam,timeoutSeconds:{type:"integer",minimum:15,maximum:45}},required:["inputPath","outputDir","label"],additionalProperties:false}},
    {name:"bambu_cache_discover",description:"Read-only discovery of Bambu Studio's temporary G-code and temporary scene with exact origin match to saved project; timestamps exposed, no UI focus.",inputSchema:{type:"object",properties:{projectPath:pathParam},required:["projectPath"],additionalProperties:false}},
    {name:"bambu_cache_slice_snapshot_save",description:"Save immutable G-code snapshot from Bambu's newest matching temporary slice without focus or re-slicing. Explicit outputDir; no original overwrite.",inputSchema:{type:"object",properties:{projectPath:pathParam,outputDir:pathParam},required:["projectPath","outputDir"],additionalProperties:false}},
    {name:"bambu_case_pair_prepare_save",description:"Create two independent 3MF QA cases: saved defective project and recovered matching temp scene with negative parts if available, plus temp G-code snapshot. Never overwrites originals; case B not proved working.",inputSchema:{type:"object",properties:{projectPath:pathParam,outputDir:pathParam},required:["projectPath","outputDir"],additionalProperties:false}},
    {name:"bambu_slice_region_inspect",description:"General post-slice G-code region QA by explicit XY/Z bounds or saved 3MF object, part, or text. Read only.",inputSchema:{type:"object",properties:{slicedPath:pathParam,projectPath:pathParam,objectName:pathParam,partName:pathParam,text:pathParam,outputDir:pathParam,
      minX:{type:"number"},maxX:{type:"number"},minY:{type:"number"},maxY:{type:"number"},
      minZ:{type:"number"},maxZ:{type:"number"},plate:{type:"integer",minimum:1,maximum:50}},required:["slicedPath"],additionalProperties:false}},
    {name:"bambu_slice_region_images_save",description:"Generate representative PNGs for post-slice ROI of any 3MF object, part, text or XYZ region. Requires outputDir.",inputSchema:{type:"object",properties:{slicedPath:pathParam,projectPath:pathParam,objectName:pathParam,partName:pathParam,text:pathParam,outputDir:pathParam,
      minX:{type:"number"},maxX:{type:"number"},minY:{type:"number"},maxY:{type:"number"},
      minZ:{type:"number"},maxZ:{type:"number"},plate:{type:"integer",minimum:1,maximum:50}},required:["slicedPath","outputDir"],additionalProperties:false}},
    {name:"bambu_slice_region_compare",description:"Read-only A/B post-slice G-code comparison by saved part/object/text or XYZ region, including Z interval; no files written.",inputSchema:{type:"object",properties:{beforePath:pathParam,afterPath:pathParam,projectPath:pathParam,objectName:pathParam,partName:pathParam,text:pathParam,outputDir:pathParam,
      minX:{type:"number"},maxX:{type:"number"},minY:{type:"number"},maxY:{type:"number"},
      minZ:{type:"number"},maxZ:{type:"number"},plate:{type:"integer",minimum:1,maximum:50}},required:["beforePath","afterPath"],additionalProperties:false}},
    {name:"bambu_slice_region_compare_images_save",description:"Write paired per-layer QA images for generalized A/B G-code comparison scoped to object/part/text or XYZ coordinates.",inputSchema:{type:"object",properties:{beforePath:pathParam,afterPath:pathParam,projectPath:pathParam,objectName:pathParam,partName:pathParam,text:pathParam,outputDir:pathParam,
      minX:{type:"number"},maxX:{type:"number"},minY:{type:"number"},maxY:{type:"number"},
      minZ:{type:"number"},maxZ:{type:"number"},plate:{type:"integer",minimum:1,maximum:50}},required:["beforePath","afterPath","outputDir"],additionalProperties:false}},
    {name:"bambu_window_status",description:"List Bambu Studio window status through separate MCP without changing focus.",inputSchema:empty},
    {name:"bambu_capture_save",description:"Foreground-only Bambu Studio window/viewport capture. Refuses minimized, occluded or out-of-focus windows.",inputSchema:{type:"object",properties:{outputPath:pathParam,region:{type:"string",enum:["window","viewport"]}},required:["outputPath"],additionalProperties:false}},
    {name:"bambu_saved_views_save",description:"Extract existing 3MF preview PNGs via separate MCP, no live UI interaction.",inputSchema:{type:"object",properties:{path:pathParam,outputDir:pathParam},required:["path","outputDir"],additionalProperties:false}},
    {name:"bambu_offscreen_views_save",description:"Render top/bottom/front/rear/left/right/isometric saved-3MF orthographic views offscreen via standalone Bambu MCP. No focus stealing; excludes unsaved changes.",inputSchema:{type:"object",properties:{path:pathParam,outputDir:pathParam,views:{type:"string"}},required:["path","outputDir"],additionalProperties:false}}
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
    bambu_text_cut_diagnose:async args => {
      const x=z.object({path:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_text_cut_diagnose",{path:src(x.path)});
    },
    bambu_project_compare:async args => {
      const x=z.object({beforePath:z.string().min(1),afterPath:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_project_compare",{beforePath:src(x.beforePath),afterPath:src(x.afterPath)});
    },
    bambu_slice_inspect:async args => {
      const x=z.object({path:z.string().min(1),plate:z.number().int().min(1).max(50).default(1)}).strict().parse(args);
      return providerTool("bambu_slice_inspect",{path:sliced(x.path),plate:x.plate});
    },
    bambu_slice_layer_render:async args => {
      const x=z.object({path:z.string().min(1),outputDir:z.string().min(1),plate:z.number().int().min(1).max(50).default(1),
        layerIndex:z.number().int().min(0).max(4000).optional(),layerZMm:z.number().min(-10).max(1000).optional()}).strict().parse(args);
      return providerTool("bambu_slice_layer_render",{path:sliced(x.path),outputDir:out(x.outputDir),plate:x.plate,
        ...(x.layerIndex!==undefined?{layerIndex:x.layerIndex}:{}),...(x.layerZMm!==undefined?{layerZMm:x.layerZMm}:{})});
    },
    bambu_slice_compare:async args => {
      const x=z.object({beforePath:z.string().min(1),afterPath:z.string().min(1),
         projectPath:z.string().min(1).optional(),text:z.string().min(1).optional(),
         plate:z.number().int().min(1).max(50).default(1)}).strict().parse(args);
      if(Boolean(x.projectPath)!==Boolean(x.text)) throw new Error("Both projectPath and text required for ROI");
      return providerTool("bambu_slice_compare",{beforePath:sliced(x.beforePath),afterPath:sliced(x.afterPath),
         plate:x.plate,...(x.projectPath?{projectPath:src(x.projectPath),text:x.text}:{})});
    },
    bambu_slice_compare_images_save:async args => {
      const x=z.object({beforePath:z.string().min(1),afterPath:z.string().min(1),
        projectPath:z.string().min(1).optional(),text:z.string().min(1).optional(),
        outputDir:z.string().min(1),plate:z.number().int().min(1).max(50).default(1)}).strict().parse(args);
      if(Boolean(x.projectPath)!==Boolean(x.text)) throw new Error("Both projectPath and text required for ROI");
      return providerTool("bambu_slice_compare",{beforePath:sliced(x.beforePath),afterPath:sliced(x.afterPath),
        plate:x.plate,...(x.projectPath?{projectPath:src(x.projectPath),text:x.text}:{}),
        outputDir:out(x.outputDir)});
    },
    bambu_slice_text_diagnose:async args => {
      const x=z.object({slicedPath:z.string().min(1),projectPath:z.string().min(1),
        text:z.string().min(1),outputDir:z.string().min(1),plate:z.number().int().min(1).max(50).default(1)}).strict().parse(args);
      return providerTool("bambu_slice_text_diagnose",{slicedPath:sliced(x.slicedPath),projectPath:src(x.projectPath),
        text:x.text,outputDir:out(x.outputDir),plate:x.plate});
    },
    bambu_slice_headless_save:async args => {
      const x=z.object({inputPath:z.string().min(1),outputDir:z.string().min(1),
        label:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        timeoutSeconds:z.number().int().min(15).max(45).optional()}).strict().parse(args);
      return providerTool("bambu_slice_headless_save",{inputPath:src(x.inputPath),outputDir:out(x.outputDir),label:x.label,
        ...(x.timeoutSeconds?{timeoutSeconds:x.timeoutSeconds}:{})});
    },
    bambu_cache_discover:async args => {
      const x=z.object({projectPath:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_cache_discover",{projectPath:src(x.projectPath)});
    },
    bambu_cache_slice_snapshot_save:async args => {
      const x=z.object({projectPath:z.string().min(1),outputDir:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_cache_slice_snapshot_save",{projectPath:src(x.projectPath),outputDir:out(x.outputDir)});
    },
    bambu_case_pair_prepare_save:async args => {
      const x=z.object({projectPath:z.string().min(1),outputDir:z.string().min(1)}).strict().parse(args);
      return providerTool("bambu_case_pair_prepare_save",{projectPath:src(x.projectPath),outputDir:out(x.outputDir)});
    },
    bambu_slice_region_inspect:async args => {
      const x=regionInputs.strict().parse(args);
      const {slicedPath,projectPath, ...selector}=x;
      return providerTool("bambu_slice_region_inspect",{slicedPath:sliced(slicedPath),
        ...(projectPath?{projectPath:src(projectPath)}:{}),...selector});
    },
    bambu_slice_region_images_save:async args => {
      const x=regionInputs.extend({outputDir:z.string().min(1)}).strict().parse(args);
      const {slicedPath,projectPath,outputDir,...selector}=x;
      return providerTool("bambu_slice_region_images_save",{slicedPath:sliced(slicedPath),
        ...(projectPath?{projectPath:src(projectPath)}:{}),outputDir:out(outputDir),...selector});
    },
    bambu_slice_region_compare:async args => {
      const x=regionInputs.omit({slicedPath:true}).extend({beforePath:z.string().min(1),afterPath:z.string().min(1)}).strict().parse(args);
      const {beforePath,afterPath,projectPath,...sel}=x;
      return providerTool("bambu_slice_region_compare",{beforePath:sliced(beforePath),afterPath:sliced(afterPath),
        ...(projectPath?{projectPath:src(projectPath)}:{}),...sel});
    },
    bambu_slice_region_compare_images_save:async args => {
      const x=regionInputs.omit({slicedPath:true}).extend({beforePath:z.string().min(1),afterPath:z.string().min(1),
        outputDir:z.string().min(1)}).strict().parse(args);
      const {beforePath,afterPath,projectPath,outputDir,...sel}=x;
      return providerTool("bambu_slice_region_compare",{beforePath:sliced(beforePath),afterPath:sliced(afterPath),
        ...(projectPath?{projectPath:src(projectPath)}:{}),outputDir:out(outputDir),...sel});
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
