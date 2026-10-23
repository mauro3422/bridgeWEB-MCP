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
for(const tool of ["bambu_cache_discover","bambu_case_pair_prepare_save","bambu_cache_slice_snapshot_save",
 "bambu_slice_region_inspect","bambu_slice_region_images_save","bambu_slice_region_compare","bambu_slice_headless_save"]){
 assert(catalog.tools.some(t=>t.name===tool),tool+" missing in provider");
}
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
const hasEditable3DTech=engraving.texts.some(t=>t.text==="3D Tech");
const targetOpts=hasEditable3DTech?{projectPath:argsPath,text:"3D Tech"}:{};
if(hasEditable3DTech){
  const cut=await bambuToolModule.handlers.bambu_slice_text_diagnose({
    slicedPath:simulatedGood,projectPath:argsPath,text:"3D Tech",outputDir:outDir
  });
  assert.equal(cut.mode,"sliced-text-toolpath-qa");
} else {
  let negativeTextMissing=false;
  try{await bambuToolModule.handlers.bambu_slice_text_diagnose({
    slicedPath:simulatedGood,projectPath:argsPath,text:"3D Tech",outputDir:outDir
  });}catch(e){negativeTextMissing=String(e).includes("No editable text");}
  assert(negativeTextMissing,"when merged text is baked into the mesh, the MCP must report missing semantic text");
}
const diffReadOnly=await bambuToolModule.handlers.bambu_slice_compare({
  beforePath:simulatedGood,afterPath:simulatedBad,...targetOpts
});
assert.equal(diffReadOnly.mode,"post-slice-trajectory-comparison");
assert(diffReadOnly.differentLayers>=1);
assert.equal(diffReadOnly.comparisonImages.length,0);
const diff=await bambuToolModule.handlers.bambu_slice_compare_images_save({
  beforePath:simulatedGood,afterPath:simulatedBad,...targetOpts,outputDir:outDir
});
assert.equal(diff.mode,"post-slice-trajectory-comparison");
assert.equal(diff.comparisonImages.length,2);
const cache=await bambuToolModule.handlers.bambu_cache_discover({projectPath:argsPath});
assert.equal(cache.mode,"bambu-temporary-cache-discovery");
assert(Array.isArray(cache.matches));
const generic=await bambuToolModule.handlers.bambu_slice_region_inspect({
  slicedPath:simulatedGood,
  minX:145,minY:149,maxX:191,maxY:161,minZ:0,maxZ:3
});
assert.equal(generic.mode,"generic-sliced-region-QA");
assert(generic.regionLayers>=1);
const genericObject=await bambuToolModule.handlers.bambu_slice_region_inspect({
  slicedPath:simulatedGood,projectPath:argsPath,objectName:"Cubo"
});
assert.equal(genericObject.target.kind,"object");
const regionComparison=await bambuToolModule.handlers.bambu_slice_region_compare({
  beforePath:simulatedGood,afterPath:simulatedBad,
  minX:144,minY:148,maxX:193,maxY:163,minZ:0,maxZ:3
});
assert.equal(regionComparison.mode,"generic-sliced-region-comparison");
assert(regionComparison.differentLayers>=1);
assert(regionComparison.comparisonImages.length===0);
const regionImages=await bambuToolModule.handlers.bambu_slice_region_compare_images_save({
  beforePath:simulatedGood,afterPath:simulatedBad,
  minX:144,minY:148,maxX:193,maxY:163,minZ:0,maxZ:3,outputDir:outDir
});
assert.equal(regionImages.comparisonImages.length,2);
const savedRegions=await bambuToolModule.handlers.bambu_slice_region_images_save({
  slicedPath:simulatedGood,minX:144,minY:148,maxX:193,maxY:163,minZ:0,maxZ:3,
  outputDir:outDir
});
assert(savedRegions.images.length>=1);
let rejectedUnsafeLabel=false;
try{
  await bambuToolModule.handlers.bambu_slice_headless_save({
    inputPath:argsPath,outputDir:outDir,label:"../../unsafe"
  });
}catch{rejectedUnsafeLabel=true;}
assert(rejectedUnsafeLabel,"Headless slicer must reject unsafe label and not execute");
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
