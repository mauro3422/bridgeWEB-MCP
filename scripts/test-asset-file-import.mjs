import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),"bridge-general-assets-"));
process.env.NODE_ENV="test";
process.env.BRIDGE_MCP_TEST_ASSET_LOCALHOST="1";
process.env.BRIDGE_MCP_ALLOWED_ROOTS=[sandbox,process.cwd()].join(path.delimiter);
const {createDefaultToolRegistry}=await import("../dist/tool-registry.js");
const reg=createDefaultToolRegistry();
const schema=reg.tools.find(x=>x.name==="asset_import_files");
assert(schema,"asset_import_files not registered");
assert.deepEqual(schema._meta?.["openai/fileParams"],["files"]);
assert.equal(schema.annotations?.readOnlyHint,false);
assert.equal(schema.annotations?.destructiveHint,true);
assert.equal(schema.annotations?.openWorldHint,true);
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8bQAAAABJRU5ErkJggg==","base64");
const wav=Buffer.from("RIFFabcdWAVEfmt sample wav","ascii");
const mp4=Buffer.from([0,0,0,24,...Buffer.from("ftypmp42x"),0,0,0,0,1,2,3,4,5,6]);
const body={"/img":png,"/audio":wav,"/video":mp4};
let requestCount=0;
const server=http.createServer((req,res)=>{
 requestCount+=1;
 if(req.url==="/redirect"){res.writeHead(302,{location:"/img"}).end();return}
 if(req.url==="/oversize"){res.writeHead(200,{"content-length":String(512*1024*1024+1)}).end();return}
 const data=body[req.url];if(!data){res.writeHead(404).end();return}
 res.writeHead(200,{"content-type":"application/octet-stream","content-length":String(data.length)});res.end(data);
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
const descriptors=[["/img","ref.png","image/png",png],["/audio","sound.wav","audio/wav",wav],["/video","clip.mp4","video/mp4",mp4]];
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
try {
 const files=descriptors.map(([route,n,m])=>({download_url:base+route,file_id:"file_"+n,mime_type:m,file_name:n}));
 const targets=descriptors.map(([route,n,m,b])=>({outputPath:path.join(sandbox,n),expectedSha256:sha(b),expectedBytes:b.length}));
 const manifestPath=path.join(sandbox,"asset-manifest.json");
 const done=await reg.call("asset_import_files",{files,targets,manifestPath});
 assert.equal(done.count,3);assert.equal(done.transport,"chatgpt-authorized-file-parameter");
 descriptors.forEach(([,n,,b])=>assert.deepEqual(fs.readFileSync(path.join(sandbox,n)),b));
 assert.equal(JSON.parse(fs.readFileSync(manifestPath,"utf8")).items.length,3);
 await assert.rejects(reg.call("asset_import_files",{files:[files[0]],targets:[targets[0]]}),/Existing destination/);
 await assert.rejects(reg.call("asset_import_files",{files:[files[0]],targets:[{outputPath:path.join(sandbox,"bad.png"),expectedSha256:"a".repeat(64)}]}),/SHA-256 differs/);
 assert(!fs.existsSync(path.join(sandbox,"bad.png")));
 await assert.rejects(reg.call("asset_import_files",{files:[{...files[0],mime_type:"audio/wav"}],targets:[{outputPath:path.join(sandbox,"bad-mime.png")}]}),/Declared MIME differs/);
 await assert.rejects(reg.call("asset_import_files",{files:[{...files[0],download_url:base+"/redirect"}],targets:[{outputPath:path.join(sandbox,"redirect.png")}]}),/Download rejected: 302/);
 await assert.rejects(reg.call("asset_import_files",{files:[{...files[0],download_url:base+"/oversize"}],targets:[{outputPath:path.join(sandbox,"oversize.png")}]}),/File exceeds/);
 await assert.rejects(reg.call("asset_import_files",{files:[files[0],files[1]],targets:[{outputPath:path.join(sandbox,"duplicate.png")},{outputPath:path.join(sandbox,"duplicate.png")}]}),/Duplicate destination/);
 const beforeBudgetCheck=requestCount;
 await assert.rejects(reg.call("asset_import_files",{files:[files[0],files[1],files[2]],targets:[
  {outputPath:path.join(sandbox,"budget-1.png"),expectedBytes:512*1024*1024},
  {outputPath:path.join(sandbox,"budget-2.wav"),expectedBytes:512*1024*1024},
  {outputPath:path.join(sandbox,"budget-3.mp4"),expectedBytes:1},
 ]}),/Declared batch byte budget exceeded/);
 assert.equal(requestCount,beforeBudgetCheck,"declared over-budget batch must be rejected before downloads");
 const rollbackTargets=[path.join(sandbox,"rollback.png"),path.join(sandbox,"rollback.wav")];
 await assert.rejects(reg.call("asset_import_files",{files:[files[0],files[1]],targets:[{outputPath:rollbackTargets[0]},{outputPath:rollbackTargets[1],expectedSha256:"b".repeat(64)}]}),/SHA-256 differs/);
 assert(rollbackTargets.every(p=>!fs.existsSync(p)),"failed batch must leave no partial destinations");
 assert(!fs.readdirSync(sandbox).some(name=>name.includes(".incoming-")),"failed batch must clean staged files");
 await assert.rejects(reg.call("asset_import_files",{files:[{...files[0],download_url:"http://169.254.169.254/"}],targets:[{outputPath:path.join(sandbox,"ssrf.png")}]}),/unsafe-url/);
 await assert.rejects(reg.call("asset_import_files",{files:[files[0]],targets:[{outputPath:path.join(os.tmpdir(),"bridge-asset-outside-policy.png")}]}),/outside bridge-mcp allowed roots/);
 await assert.rejects(reg.call("asset_import_files",{files:[files[0]],targets:[{outputPath:path.join(sandbox,"deny.png")}],overwrite:true}),/Overwrite intentionally unsupported/);
 console.log("asset_import_files PASS: PNG/WAV/MP4 byte-exact, manifest, no-overwrite, SHA rollback, unsafe URL blocked, tool metadata");
} finally {await new Promise(r=>server.close(r));fs.rmSync(sandbox,{force:true,recursive:true});}
