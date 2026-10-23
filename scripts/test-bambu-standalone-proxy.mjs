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
assert(catalog.tools.some(t=>t.name==="bambu_text_cut_diagnose"));
assert(catalog.tools.some(t=>t.name==="bambu_slice_inspect"));
assert(catalog.tools.some(t=>t.name==="bambu_slice_text_diagnose"));
const inspection=await bambuToolModule.handlers.bambu_project_inspect({path:argsPath});
assert(inspection.ok);
const parts=inspection.objects.flatMap(o=>o.parts);
assert(inspection.objectCount>=1,"saved project must expose at least one object");
assert(parts.some(p=>p.subtype==="normal_part"),"saved project must expose printable geometry");
assert(parts.every(p=>p.boundsMm?.size?.every(v=>Number.isFinite(v))),"part bounds must be finite");
const diagnostic=await bambuToolModule.handlers.bambu_project_diagnose({path:argsPath});
assert.equal(diagnostic.mode,"saved-3mf-bbox-diagnostic");
assert(Array.isArray(diagnostic.negativePartChecks));
const engraving=await bambuToolModule.handlers.bambu_text_cut_diagnose({path:argsPath});
assert.equal(engraving.mode,"saved-3mf-text-cut-diagnostic");
assert(Array.isArray(engraving.texts));
assert(engraving.texts.every(t=>Array.isArray(t.intersections) && typeof t.interpretation==="string"));
const negativeText=engraving.texts.find(t=>t.kind==="negative_part");
if(negativeText) assert(negativeText.interpretation==="negative-subtraction-candidate" || negativeText.interpretation==="not-validated-cut");
const same=await bambuToolModule.handlers.bambu_project_compare({beforePath:argsPath,afterPath:argsPath});
assert.equal(same.changed,false);
// A saved geometry project is not a sliced .gcode.3mf and must fail with actionable guidance.
let expectedUnsliced=false;
try{await bambuToolModule.handlers.bambu_slice_inspect({path:argsPath});}
catch(e){expectedUnsliced=String(e).includes("Export");}
assert(expectedUnsliced,"must require actual plate-sliced G-code instead of silently reading a model 3MF");
const fixtureBase="D:\\Dev\\bambu-studio-mcp\\tests\\fixtures\\";
const simulatedGood=fixtureBase+"synthetic-unmerged.gcode";
const simulatedBad=fixtureBase+"synthetic-merged.gcode";
const sliced=await bambuToolModule.handlers.bambu_slice_inspect({path:simulatedGood});
assert.equal(sliced.mode,"sliced-gcode-toolpath-inspection");
assert(sliced.layerCount>=2);
const cut=await bambuToolModule.handlers.bambu_slice_text_diagnose({
  slicedPath:simulatedGood,projectPath:argsPath,text:"3D Tech",
  outputDir:outDir
});
assert.equal(cut.mode,"sliced-text-toolpath-qa");
assert(cut.images.length>=1);
const diffReadOnly=await bambuToolModule.handlers.bambu_slice_compare({
  beforePath:simulatedGood,afterPath:simulatedBad,projectPath:argsPath,text:"3D Tech"
});
assert.equal(diffReadOnly.mode,"post-slice-trajectory-comparison");
assert(diffReadOnly.differentLayers>=1);
assert.equal(diffReadOnly.comparisonImages.length,0);
const diff=await bambuToolModule.handlers.bambu_slice_compare_images_save({
  beforePath:simulatedGood,afterPath:simulatedBad,projectPath:argsPath,text:"3D Tech",
  outputDir:outDir
});
assert.equal(diff.mode,"post-slice-trajectory-comparison");
assert.equal(diff.comparisonImages.length,2);
const windows=await bambuToolModule.handlers.bambu_window_status({});
assert.equal(windows.mode,"live-window-list");
const render=await bambuToolModule.handlers.bambu_offscreen_views_save({
    path:argsPath,outputDir:outDir,views:"top,front,right,isometric"
});
assert.equal(render.mode,"offline-saved-3mf-render");
assert.equal(render.views.length,4);
for(const view of render.views) assert((await fs.stat(view.path)).size>1000);
let invalid=false;
try{await bambuToolModule.handlers.bambu_project_inspect({path:"D:\\Dev\\bad.stl"});}
catch{invalid=true;}
assert(invalid,"invalid extension must be rejected");
console.log(JSON.stringify({pass:true,tools:status.toolCount,objectCount:inspection.objectCount,
  parts:parts.map(p=>({name:p.name,subtype:p.subtype})),views:render.views.map(x=>x.view),
  windows:windows.count}));
process.exit(0);
