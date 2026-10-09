import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/path.js";

const MAX_FILE = 512 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_TOTAL = 1024 * 1024 * 1024;
const CHUNK_TIMEOUT = 120000;
const hex = z.string().regex(/^[a-fA-F0-9]{64}$/);
const fileParam = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1).max(256),
  mime_type: z.string().max(200).optional(),
  file_name: z.string().max(512).optional(),
});
const targetParam = z.object({
  outputPath: z.string().min(1),
  expectedSha256: hex.optional(),
  expectedBytes: z.number().int().min(0).max(MAX_FILE).optional(),
});
const input = z.object({
  files: z.array(fileParam).min(1).max(MAX_FILES),
  targets: z.array(targetParam).min(1).max(MAX_FILES),
  manifestPath: z.string().optional(),
  overwrite: z.boolean().default(false),
});

const blockedIpv4 = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedIpv4.addSubnet(subnet, prefix, "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [subnet, prefix] of [
  ["2001:2::", 48], ["2001:10::", 28], ["2001:db8::", 32], ["2001::", 23],
] as const) blockedIpv6.addSubnet(subnet, prefix, "ipv6");

function localIp(address: string): boolean {
  const type = isIP(address);
  if (type === 4) return blockedIpv4.check(address, "ipv4");
  if (type !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) !== 4 || localIp(mapped);
  }
  return !globalIpv6.check(address, "ipv6") || blockedIpv6.check(address, "ipv6");
}
async function checkUrl(raw: string) {
  const url = new URL(raw);
  const testLocal = process.env.NODE_ENV === "test" && process.env.BRIDGE_MCP_TEST_ASSET_LOCALHOST === "1";
  if (testLocal && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    return url;
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw new Error("[unsafe-url] Only HTTPS standard-port file download URLs are allowed");
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || isIP(host)) throw new Error("[unsafe-url] IP literal / localhost refused");
  const names = (process.env.BRIDGE_ASSET_FILE_HOSTS || "files.oaiusercontent.com").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!names.some(n => host === n || (n.startsWith("*.") && host.endsWith(n.slice(1)))))
    throw new Error("[unsafe-url] Download hostname not allowlisted; configure BRIDGE_ASSET_FILE_HOSTS deliberately");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(x => localIp(x.address)))
    throw new Error("[unsafe-url] Private / invalid DNS answer");
  return url;
}
function detectMime(h: Buffer): string {
  if (h.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (h.length >= 3 && h[0] === 255 && h[1] === 216 && h[2] === 255) return "image/jpeg";
  if (h.subarray(0,4).toString("ascii") === "RIFF" && h.subarray(8,12).toString("ascii")==="WEBP") return "image/webp";
  if (h.subarray(0,4).toString("ascii") === "RIFF" && h.subarray(8,12).toString("ascii")==="WAVE") return "audio/wav";
  if (h.subarray(0,4).toString("ascii") === "fLaC") return "audio/flac";
  if (h.subarray(0,4).toString("ascii") === "OggS") return "application/ogg";
  if (h.subarray(0,3).toString("ascii") === "ID3") return "audio/mpeg";
  if (h.subarray(4,8).toString("ascii") === "ftyp") return "video/mp4";
  if (h.subarray(0,4).toString("hex") === "1a45dfa3") return "video/x-matroska";
  if (h.subarray(0,5).toString("ascii") === "%PDF-") return "application/pdf";
  if (h.subarray(0,4).toString("hex") === "504b0304") return "application/zip";
  if (h.subarray(0,6).toString("ascii") === "BLENDER") return "application/x-blender";
  return "application/octet-stream";
}
async function transferOne(file: z.infer<typeof fileParam>, target: z.infer<typeof targetParam>, byteBudget: number) {
  const outputPath = resolveToolPath(target.outputPath, { access:"write" });
  const temp = outputPath + ".incoming-" + crypto.randomUUID();
  const url = await checkUrl(file.download_url);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHUNK_TIMEOUT);
  try {
    const response = await fetch(url, { signal: abort.signal, redirect: "manual" });
    if (!response.ok || !response.body) throw new Error("[source-unavailable] Download rejected: " + response.status);
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > byteBudget) throw new Error("[too-large] File exceeds its remaining import budget");
    await fs.mkdir(path.dirname(outputPath), { recursive:true });
    const stream = await fs.open(temp, "wx");
    const hash = crypto.createHash("sha256");
    let bytes = 0; let header = Buffer.alloc(0);
    try {
      for await (const packet of response.body) {
        const chunk = Buffer.from(packet);
        bytes += chunk.length;
        if (bytes > byteBudget) throw new Error("[too-large] Stream exceeded its remaining import budget");
        if (header.length < 32) header = Buffer.concat([header, chunk]).subarray(0, 32);
        hash.update(chunk);
        await stream.writeFile(chunk);
      }
    } finally { await stream.close(); }
    if (!bytes) throw new Error("[source-unavailable] Empty file");
    const sha256 = hash.digest("hex");
    if (target.expectedSha256 && target.expectedSha256.toLowerCase() !== sha256)
      throw new Error("[integrity-mismatch] SHA-256 differs from expected bytes");
    if (target.expectedBytes !== undefined && target.expectedBytes !== bytes)
      throw new Error("[integrity-mismatch] File length differs");
    const mime = detectMime(header);
    if (file.mime_type && file.mime_type.toLowerCase() !== mime && mime !== "application/octet-stream" &&
        file.mime_type.toLowerCase() !== "application/octet-stream")
      throw new Error("[integrity-mismatch] Declared MIME differs from signature");
    return { outputPath, temp, bytes, sha256, mime, fileId: file.file_id, sourceName: file.file_name ?? null };
  } catch (error) { await fs.rm(temp, { force: true }).catch(()=>undefined); throw error; }
  finally { clearTimeout(timer); }
}
type Stage = Awaited<ReturnType<typeof transferOne>>;
async function importFiles(args: z.infer<typeof input>) {
  if (args.files.length !== args.targets.length) throw new Error("files/targets lengths must match");
  const declaredBytes = args.targets.reduce((total, item) => total + (item.expectedBytes ?? 0), 0);
  if (declaredBytes > MAX_TOTAL) throw new Error("Declared batch byte budget exceeded");
  const paths = args.targets.map(x => resolveToolPath(x.outputPath, { access: "write" }));
  if (new Set(paths.map(s=>s.toLowerCase())).size !== paths.length) throw new Error("Duplicate destination path");
  const manifest = args.manifestPath ? resolveToolPath(args.manifestPath, { access:"write" }) : null;
  if (manifest && (path.extname(manifest).toLowerCase()!==".json" || paths.includes(manifest)))
    throw new Error("Invalid manifest target");
  if (args.overwrite) throw new Error("Overwrite intentionally unsupported for newly imported file assets");
  for (const p of [...paths, ...(manifest?[manifest]:[])]) {
    try { await fs.access(p); throw new Error("Existing destination: " + p); }
    catch(e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  const staged: Stage[] = [];
  const committed: string[] = [];
  let remainingBytes = MAX_TOTAL;
  try {
    for (let i=0; i<args.files.length; i++) {
      const x = await transferOne(args.files[i]!, args.targets[i]!, Math.min(MAX_FILE, remainingBytes));
      staged.push(x);
      remainingBytes -= x.bytes;
    }
    for (const item of staged) {
      // Never replace a file that appeared mid-download.
      // Atomic no-clobber commit on the same filesystem (staged in destination directory).
      await fs.link(item.temp, item.outputPath);
      committed.push(item.outputPath);
      await fs.rm(item.temp,{force:true});
    }
    if (manifest) {
      await fs.mkdir(path.dirname(manifest), { recursive:true });
      await fs.writeFile(manifest,JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),items:staged.map(({temp,...rest})=>rest)},null,2),{encoding:"utf8",flag:"wx"});
      committed.push(manifest);
    }
    return {count:staged.length,saved:staged.map(({temp,...rest})=>rest),manifestPath:manifest,verified:true,transport:"chatgpt-authorized-file-parameter",encodedPayloadInText:false};
  } catch(err) {
    await Promise.all(staged.map(s=>fs.rm(s.temp,{force:true}).catch(()=>undefined)));
    await Promise.all(committed.map(p=>fs.rm(p,{force:true}).catch(()=>undefined)));
    throw err;
  }
}
export const assetFileToolModule: BridgeToolModule = {
 name:"asset-files",
 tools:[{
  name:"asset_import_files",
  description:"Import ChatGPT-authorized files (images, audio, video, documents, archives, .blend, other bytes) to safe MauroPrime local paths. Use ChatGPT file attachments/generations as top-level file parameters; the host resolves file_id/download_url automatically. No manual Base64, execution, installation or decompression. HTTPS allowlisted download, streamed atomic staging, SHA-256 and receipt. Maximum 512 MiB per file / 1 GiB batch; no execution or installation.",
  inputSchema:{
   type:"object",properties:{
    files:{type:"array",minItems:1,maxItems:MAX_FILES,items:{type:"object",properties:{download_url:{type:"string"},file_id:{type:"string"},mime_type:{type:"string"},file_name:{type:"string"}},required:["download_url","file_id"],additionalProperties:false}},
    targets:{type:"array",minItems:1,maxItems:MAX_FILES,items:{type:"object",properties:{outputPath:{type:"string"},expectedSha256:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},expectedBytes:{type:"number",minimum:0,maximum:MAX_FILE}},required:["outputPath"],additionalProperties:false}},
    manifestPath:{type:"string"},overwrite:{type:"boolean",default:false}
   },required:["files","targets"],additionalProperties:false
  }, _meta:{"openai/fileParams":["files"]},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}
 }],
 handlers:{asset_import_files:async raw=>importFiles(input.parse(raw))}
};
