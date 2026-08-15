import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "integrations", "workflow-guides", "narrated-media-review", "guide.json");
const guidePath = path.join(root, "integrations", "workflow-guides", "narrated-media-review", "GUIDE.md");

const fail = (message) => {
  console.error(`[narrated-media-review] ${message}`);
  process.exitCode = 1;
};

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const guide = fs.readFileSync(guidePath, "utf8");

const keywords = new Set((manifest.activation?.keywords ?? []).map((value) => String(value).toLowerCase()));
const phrases = new Set((manifest.activation?.phrases ?? []).map((value) => String(value).toLowerCase()));
const negatives = new Set((manifest.activation?.negativeKeywords ?? []).map((value) => String(value).toLowerCase()));
const tools = new Set(manifest.recommendedTools ?? []);

for (const keyword of ["audio", "video", "transcripción", "escuchar", "meme", "asr"]) {
  if (!keywords.has(keyword)) fail(`missing activation keyword: ${keyword}`);
}

for (const phrase of [
  "escuchá este audio",
  "escuchá este video",
  "qué dice este audio",
  "transcribí y entendé el meme",
  "usá el sistema de transcripción",
]) {
  if (!phrases.has(phrase)) fail(`missing activation phrase: ${phrase}`);
}

for (const forbidden of [
  "transcribir solamente",
  "transcribime este audio y nada más",
  "solo transcripción",
  "sólo transcripción",
]) {
  if (negatives.has(forbidden)) fail(`pure transcription must not be excluded: ${forbidden}`);
}

if (!tools.has("media_review_ingest")) fail("media_review_ingest is not a recommended tool");

for (const contract of [
  "media_review_ingest` is the canonical first transcription/review path",
  "Do **not** fall back to Whisper",
  "Do not claim that media was transcribed",
  "inspect both the canonical transcript/audio evidence and at least one representative visual frame",
]) {
  if (!guide.includes(contract)) fail(`GUIDE.md missing contract: ${contract}`);
}

const toolDescriptionNeedle = "before inventing an ad-hoc fallback";
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "build", ".git"].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(?:ts|js|mjs|cjs)$/.test(entry.name)) sourceFiles.push(target);
  }
};
walk(path.join(root, "src"));
if (!sourceFiles.some((file) => fs.readFileSync(file, "utf8").includes(toolDescriptionNeedle))) {
  fail("workflow_guide_recommend tool description does not advertise existing-pipeline recovery before ad-hoc fallback");
}

if (!process.exitCode) {
  console.log("narrated-media-review routing/ownership contract: PASS");
}
