import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root=path.resolve(process.cwd());
const built=process.env.BAMBU_BRIDGE_TEST_BUILD || "dist";
const source=path.resolve(root,built,"tools","bambu-tools.js");
const {bambuToolModule}=await import(pathToFileURL(source).href);
const argsPath="D:\\Dev\\impresion-3d-lab\\modelos\\practicas\\Llavero_Auro.3mf";
const outDir="D:\\Dev\\bambu-studio-mcp\\qa\\bridge-smoke";
const names=bambuToolModule.tools.map(t=>t.name);
assert(names.includes("bambu_mcp_status")&&names.includes("bambu_project_inspect"));
const status=await bambuToolModule.handlers.bambu_mcp_status({});
assert.equal(status.provider,"standalone-bambu-mcp-stdio");
assert(status.toolCount>=6);
const catalog=await bambuToolModule.handlers.bambu_mcp_tool_list({});
assert(catalog.tools.some(t=>t.name==="bambu_project_compare"));
const inspection=await bambuToolModule.handlers.bambu_project_inspect({path:argsPath});
assert(inspection.ok);
const parts=inspection.objects.flatMap(o=>o.parts);
assert(inspection.objectCount>=1,"saved project must expose at least one object");
assert(parts.some(p=>p.subtype==="normal_part"),"saved project must expose printable geometry");
assert(parts.every(p=>p.boundsMm?.size?.every(v=>Number.isFinite(v))),"part bounds must be finite");
const diagnostic=await bambuToolModule.handlers.bambu_project_diagnose({path:argsPath});
assert.equal(diagnostic.mode,"saved-3mf-bbox-diagnostic");
assert(Array.isArray(diagnostic.negativePartChecks));
const same=await bambuToolModule.handlers.bambu_project_compare({beforePath:argsPath,afterPath:argsPath});
assert.equal(same.changed,false);
const windows=await bambuToolModule.handlers.bambu_window_status({});
assert.equal(windows.mode,"live-window-list");
const render=await bambuToolModule.handlers.bambu_offscreen_views_save({
    path:argsPath,outputDir:outDir,views:"top,isometric"
});
assert.equal(render.mode,"offline-saved-3mf-render");
assert.equal(render.views.length,2);
for(const view of render.views) assert((await fs.stat(view.path)).size>1000);
let invalid=false;
try{await bambuToolModule.handlers.bambu_project_inspect({path:"D:\\Dev\\bad.stl"});}
catch{invalid=true;}
assert(invalid,"invalid extension must be rejected");
console.log(JSON.stringify({pass:true,tools:status.toolCount,objectCount:inspection.objectCount,
  parts:parts.map(p=>({name:p.name,subtype:p.subtype})),views:render.views.map(x=>x.view),
  windows:windows.count}));
process.exit(0);
