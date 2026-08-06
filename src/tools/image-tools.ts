import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath, runProcess } from "./shared/process.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = 15 * 1024 * 1024;
const MAX_BATCH_ITEMS = 8;
const MAX_ATTACH_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACH_TOTAL_BYTES = 24 * 1024 * 1024;

const assetTargetSchema = z.object({
  outputPath: z.string().min(1),
  role: z.string().max(80).optional(),
  prompt: z.string().max(10_000).optional(),
  source: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const itemSchema = assetTargetSchema.extend({
  base64: z.string().min(1).max(MAX_BASE64_CHARS),
});

const openAIFileSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1).max(256),
  mime_type: z.string().max(200).optional(),
  file_name: z.string().max(512).optional(),
});

const localImageItemSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1).max(160).optional(),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

type AssetTargetInput = z.infer<typeof assetTargetSchema>;
type ImageInput = z.infer<typeof itemSchema>;
type OpenAIFileInput = z.infer<typeof openAIFileSchema>;
type LocalImageInput = z.infer<typeof localImageItemSchema>;

type DecodedImage = {
  input: AssetTargetInput;
  outputPath: string;
  extension: string;
  mime: string;
  bytes: Buffer;
  width: number | null;
  height: number | null;
  sha256: string;
};

function sha256(buffer: Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function webpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  return null;
}

function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function inspectImageBytes(filePath: string, bytes: Buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw new Error(`Unsupported image extension for ${filePath}; use .png, .jpg, .jpeg, or .webp`);
  }

  const isPng = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const valid = extension === ".png" ? isPng : extension === ".webp" ? isWebp : isJpeg;
  if (!valid) throw new Error(`Image bytes do not match extension ${extension}: ${filePath}`);

  const size = isPng ? pngSize(bytes) : isWebp ? webpSize(bytes) : jpegSize(bytes);
  return {
    extension,
    mime: isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg",
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

function decodeImage(input: ImageInput): DecodedImage {
  const outputPath = resolveToolPath(input.outputPath, { access: "write" });
  const raw = input.base64
    .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "")
    .replace(/\s+/g, "");
  if (!raw || raw.length > MAX_BASE64_CHARS) throw new Error(`Image payload is empty or too large: ${outputPath}`);

  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(`Decoded image is empty or exceeds ${MAX_IMAGE_BYTES} bytes: ${outputPath}`);
  const metadata = inspectImageBytes(outputPath, bytes);

  return {
    input,
    outputPath,
    extension: metadata.extension,
    mime: metadata.mime,
    bytes,
    width: metadata.width,
    height: metadata.height,
    sha256: sha256(bytes),
  };
}

async function attachLocalImages(args: { items: LocalImageInput[] }) {
  const resolved = await Promise.all(args.items.map(async (input) => {
    const filePath = resolveToolPath(input.path, { access: "read" });
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`Image path is not a file: ${filePath}`);
    if (stat.size <= 0) throw new Error(`Image file is empty: ${filePath}`);
    if (stat.size > MAX_ATTACH_IMAGE_BYTES) {
      throw new Error(`Image exceeds the ${MAX_ATTACH_IMAGE_BYTES} byte attachment limit: ${filePath}`);
    }
    return { input, filePath, stat };
  }));

  const uniquePaths = new Set(resolved.map((item) => item.filePath.toLowerCase()));
  if (uniquePaths.size !== resolved.length) throw new Error("Batch contains duplicate image paths");
  const totalBytes = resolved.reduce((sum, item) => sum + item.stat.size, 0);
  if (totalBytes > MAX_ATTACH_TOTAL_BYTES) {
    throw new Error(`Image batch exceeds the ${MAX_ATTACH_TOTAL_BYTES} byte attachment limit`);
  }

  const attached = [];
  const imageAttachments = [];
  for (const item of resolved) {
    const bytes = await fs.readFile(item.filePath);
    if (bytes.length !== item.stat.size) throw new Error(`Image changed while it was being read: ${item.filePath}`);
    const metadata = inspectImageBytes(item.filePath, bytes);
    const digest = sha256(bytes);
    if (item.input.expectedSha256 && digest !== item.input.expectedSha256.toLowerCase()) {
      throw new Error(`SHA-256 mismatch for ${item.filePath}: expected ${item.input.expectedSha256.toLowerCase()}, got ${digest}`);
    }

    attached.push({
      path: item.filePath,
      label: item.input.label ?? path.basename(item.filePath),
      bytes: bytes.length,
      sha256: digest,
      mime: metadata.mime,
      extension: metadata.extension,
      width: metadata.width,
      height: metadata.height,
      modifiedAt: item.stat.mtime.toISOString(),
      attachedToToolResult: true,
      transformed: false,
    });
    imageAttachments.push({ type: "image", mimeType: metadata.mime, data: bytes.toString("base64") });
  }

  return {
    mode: attached.length === 1 ? "single" : "batch",
    itemCount: attached.length,
    totalBytes,
    originalBytesPreserved: true,
    transport: "mcp-image-content",
    attached,
    __bridgeImages: imageAttachments,
  };
}

async function persistImages(decoded: DecodedImage[], args: {
  overwrite: boolean;
  manifestPath?: string;
  collectionName?: string;
}) {
  const uniquePaths = new Set(decoded.map((item) => item.outputPath.toLowerCase()));
  if (uniquePaths.size !== decoded.length) throw new Error("Batch contains duplicate output paths");

  if (!args.overwrite) {
    for (const item of decoded) {
      if (await exists(item.outputPath)) throw new Error(`Image already exists: ${item.outputPath}`);
    }
  }

  const tempPaths: string[] = [];
  try {
    for (const item of decoded) {
      await fs.mkdir(path.dirname(item.outputPath), { recursive: true });
      const tempPath = `${item.outputPath}.bridge-${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tempPath, item.bytes);
      tempPaths.push(tempPath);
    }
    for (let index = 0; index < decoded.length; index += 1) {
      if (args.overwrite && await exists(decoded[index].outputPath)) await fs.rm(decoded[index].outputPath, { force: true });
      await fs.rename(tempPaths[index], decoded[index].outputPath);
    }
  } catch (error) {
    await Promise.all(tempPaths.map((tempPath) => fs.rm(tempPath, { force: true }).catch(() => undefined)));
    throw error;
  }

  const saved = decoded.map((item) => ({
    outputPath: item.outputPath,
    bytes: item.bytes.length,
    sha256: item.sha256,
    mime: item.mime,
    extension: item.extension,
    width: item.width,
    height: item.height,
    role: item.input.role ?? null,
    prompt: item.input.prompt ?? null,
    source: item.input.source ?? null,
    metadata: item.input.metadata ?? {},
  }));

  let manifestPath: string | null = null;
  if (args.manifestPath) {
    manifestPath = resolveToolPath(args.manifestPath, { access: "write" });
    if (path.extname(manifestPath).toLowerCase() !== ".json") throw new Error("manifestPath must use the .json extension");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      collectionName: args.collectionName ?? null,
      createdAt: new Date().toISOString(),
      itemCount: saved.length,
      items: saved,
    }, null, 2), "utf8");
  }

  return {
    mode: saved.length === 1 ? "single" : "batch",
    itemCount: saved.length,
    saved,
    manifestPath,
  };
}

async function saveImages(args: {
  items: ImageInput[];
  overwrite: boolean;
  manifestPath?: string;
  collectionName?: string;
}) {
  return await persistImages(args.items.map(decodeImage), args);
}

async function readBoundedResponse(response: Response, label: string): Promise<Buffer> {
  if (!response.body) throw new Error(`File download returned no body: ${label}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`File download exceeds ${MAX_IMAGE_BYTES} bytes: ${label}`);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`File download exceeds ${MAX_IMAGE_BYTES} bytes: ${label}`);
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw new Error(`File download is empty: ${label}`);
  return Buffer.concat(chunks, total);
}

async function downloadFileImage(file: OpenAIFileInput, target: AssetTargetInput): Promise<DecodedImage> {
  const url = new URL(file.download_url);
  const isLoopbackHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !isLoopbackHttp) throw new Error(`File download URL must use HTTPS: ${file.file_id}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", signal: controller.signal });
  } catch (error) {
    throw new Error(`Unable to download authorized file ${file.file_id}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Authorized file download failed (${response.status}) for ${file.file_id}`);

  const bytes = await readBoundedResponse(response, file.file_name ?? file.file_id);
  const outputPath = resolveToolPath(target.outputPath, { access: "write" });
  const measured = inspectImageBytes(outputPath, bytes);
  const declaredMime = file.mime_type?.toLowerCase();
  const normalizedDeclaredMime = declaredMime === "image/jpg" ? "image/jpeg" : declaredMime;
  if (normalizedDeclaredMime && normalizedDeclaredMime !== measured.mime) {
    throw new Error(`File MIME mismatch for ${file.file_id}: declared ${file.mime_type}, measured ${measured.mime}`);
  }

  return {
    input: {
      ...target,
      source: target.source ?? "chatgpt-authorized-file-param",
      metadata: {
        ...(target.metadata ?? {}),
        authorizedFile: {
          fileId: file.file_id,
          fileName: file.file_name ?? null,
          declaredMime: file.mime_type ?? null,
          originalBytesPreserved: true,
        },
      },
    },
    outputPath,
    extension: measured.extension,
    mime: measured.mime,
    bytes,
    width: measured.width,
    height: measured.height,
    sha256: sha256(bytes),
  };
}

async function importFileImages(args: {
  files: OpenAIFileInput[];
  targets: AssetTargetInput[];
  overwrite: boolean;
  manifestPath?: string;
  collectionName?: string;
}) {
  if (args.files.length !== args.targets.length) {
    throw new Error(`files and targets must have the same length; got ${args.files.length} and ${args.targets.length}`);
  }
  const decoded = await Promise.all(args.files.map((file, index) => downloadFileImage(file, args.targets[index])));
  return await persistImages(decoded, args);
}

const characterViewRoleSchema = z.enum(["front", "side", "back", "three-quarter"]);
const referencePackRoles = [
  "front",
  "rear",
  "left",
  "right",
  "top",
  "bottom",
  "front_left_3q",
  "front_right_3q",
  "rear_left_3q",
  "rear_right_3q",
] as const;
const referencePackRoleSchema = z.enum(referencePackRoles);
const referencePackUsageSchema = z.enum(["construction", "design"]);
const referencePackProjectionSchema = z.enum(["orthographic", "perspective"]);
const referencePackQaSchema = z.object({
  status: z.enum(["pass", "pending", "fail"]).default("pending"),
  notes: z.array(z.string().max(500)).max(20).default([]),
});
const normalizedLandmarkSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

async function ensureImageFile(filePath: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

async function prepareCharacterViews(args: {
  baseName: string;
  items: Array<{ role: "front" | "side" | "back" | "three-quarter"; inputPath: string }>;
  outputDir: string;
  manifestPath?: string;
  targetWidth: number;
  targetHeight: number;
  backgroundThreshold: number;
  cropMargin: number;
  canvasMargin: number;
  outputFormat: "jpeg" | "png";
  jpegQuality: number;
  overwrite: boolean;
  timeoutMs: number;
}) {
  const expectedRoles = new Set(["front", "side", "back", "three-quarter"]);
  const roles = new Set(args.items.map((item) => item.role));
  if (args.items.length !== 4 || roles.size !== 4 || [...expectedRoles].some((role) => !roles.has(role as never))) {
    throw new Error("Character preparation requires exactly one front, side, back, and three-quarter view");
  }

  const items = [];
  for (const item of args.items) {
    const inputPath = resolveToolPath(item.inputPath, { access: "read" });
    await ensureImageFile(inputPath, `${item.role} source image`);
    items.push({ role: item.role, inputPath });
  }

  const outputDir = resolveToolPath(args.outputDir, { access: "write" });
  await fs.mkdir(outputDir, { recursive: true });
  const manifestPath = resolveToolPath(
    args.manifestPath ?? path.join(outputDir, `${args.baseName}_prepared-manifest.json`),
    { access: "write" },
  );
  if (path.extname(manifestPath).toLowerCase() !== ".json") throw new Error("manifestPath must use the .json extension");

  const scriptPath = path.resolve(process.cwd(), "integrations", "images", "prepare_character_views.py");
  await ensureImageFile(scriptPath, "Character image preparation script");
  const configPath = path.join(outputDir, `.prepare-${crypto.randomUUID()}.json`);
  const config = {
    baseName: args.baseName,
    items,
    outputDir,
    manifestPath,
    targetWidth: args.targetWidth,
    targetHeight: args.targetHeight,
    backgroundThreshold: args.backgroundThreshold,
    cropMargin: args.cropMargin,
    canvasMargin: args.canvasMargin,
    outputFormat: args.outputFormat,
    jpegQuality: args.jpegQuality,
    overwrite: args.overwrite,
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  try {
    const pythonExecutable = process.env.BRIDGE_PYTHON_EXE || "python";
    const processResult = await runProcess(
      pythonExecutable,
      [scriptPath, "--config", configPath],
      process.cwd(),
      args.timeoutMs,
    );
    if (processResult.code !== 0 || processResult.timedOut) {
      throw new Error(`Character image preparation failed: ${processResult.stderr || processResult.stdout || processResult.error || "unknown error"}`);
    }
    const marker = String(processResult.stdout ?? "")
      .split(/\r?\n/)
      .find((line) => line.startsWith("CHARACTER_VIEWS_PREPARED="));
    const generated = marker ? JSON.parse(marker.slice("CHARACTER_VIEWS_PREPARED=".length)) : null;
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return {
      stage: "views_normalized",
      outputDir,
      manifestPath,
      generated,
      manifest,
      process: {
        code: processResult.code,
        timedOut: processResult.timedOut,
        durationMs: processResult.durationMs,
      },
    };
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => undefined);
  }
}


async function prepareReferencePack(args: {
  baseName: string;
  assetKind: "character" | "prop" | "environment" | "other";
  items: Array<{
    role: (typeof referencePackRoles)[number];
    inputPath: string;
    usage: "construction" | "design";
    projection: "orthographic" | "perspective";
    semanticQa: { status: "pass" | "pending" | "fail"; notes: string[] };
    landmarks: Record<string, { x: number; y: number }>;
  }>;
  masters: { design?: (typeof referencePackRoles)[number]; geometry?: (typeof referencePackRoles)[number] };
  operationMode: "reference-only" | "offline-preparation";
  userModeling: boolean;
  targetBlendFile?: string;
  outputDir: string;
  manifestPath?: string;
  targetWidth: number;
  targetHeight: number;
  backgroundThreshold: number;
  cropMargin: number;
  canvasMargin: number;
  alignment: "center" | "baseline";
  outputFormat: "jpeg" | "png";
  jpegQuality: number;
  overwrite: boolean;
  timeoutMs: number;
}) {
  if (args.userModeling && args.operationMode !== "reference-only") {
    throw new Error("userModeling=true requires operationMode=reference-only");
  }
  let targetBlendFile: string | undefined;
  if (args.targetBlendFile) {
    targetBlendFile = resolveToolPath(args.targetBlendFile, { access: "read" });
    if (path.extname(targetBlendFile).toLowerCase() !== ".blend") {
      throw new Error("targetBlendFile must use the .blend extension");
    }
  }
  const roles = new Set(args.items.map((item) => item.role));
  if (roles.size !== args.items.length) throw new Error("Reference-pack roles must be unique");
  if (args.items.length < 2) throw new Error("Reference packs require at least two views");
  const cardinalRoles = new Set(["front", "rear", "left", "right", "top", "bottom"]);
  for (const item of args.items) {
    if (item.usage === "construction" && !cardinalRoles.has(item.role)) {
      throw new Error(`Construction role '${item.role}' must be an axis-aligned cardinal view`);
    }
    if (item.usage === "construction" && item.projection !== "orthographic") {
      throw new Error(`Construction role '${item.role}' must use orthographic projection`);
    }
  }
  for (const [label, role] of Object.entries(args.masters)) {
    if (role && !roles.has(role)) throw new Error(`${label} master '${role}' is not present in the pack`);
  }

  const items = [];
  for (const item of args.items) {
    const inputPath = resolveToolPath(item.inputPath, { access: "read" });
    await ensureImageFile(inputPath, `${item.role} source image`);
    items.push({ ...item, inputPath });
  }

  const outputDir = resolveToolPath(args.outputDir, { access: "write" });
  await fs.mkdir(outputDir, { recursive: true });
  const manifestPath = resolveToolPath(
    args.manifestPath ?? path.join(outputDir, `${args.baseName}_reference-pack.json`),
    { access: "write" },
  );
  if (path.extname(manifestPath).toLowerCase() !== ".json") throw new Error("manifestPath must use the .json extension");

  const scriptPath = path.resolve(process.cwd(), "integrations", "images", "prepare_reference_pack.py");
  await ensureImageFile(scriptPath, "Reference-pack preparation script");
  const configPath = path.join(outputDir, `.prepare-reference-pack-${crypto.randomUUID()}.json`);
  const config = {
    baseName: args.baseName,
    assetKind: args.assetKind,
    items,
    masters: args.masters,
    operationMode: args.operationMode,
    userModeling: args.userModeling,
    targetBlendFile,
    outputDir,
    manifestPath,
    targetWidth: args.targetWidth,
    targetHeight: args.targetHeight,
    backgroundThreshold: args.backgroundThreshold,
    cropMargin: args.cropMargin,
    canvasMargin: args.canvasMargin,
    alignment: args.alignment,
    outputFormat: args.outputFormat,
    jpegQuality: args.jpegQuality,
    overwrite: args.overwrite,
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  try {
    const pythonExecutable = process.env.BRIDGE_PYTHON_EXE || "python";
    const processResult = await runProcess(
      pythonExecutable,
      [scriptPath, "--config", configPath],
      process.cwd(),
      args.timeoutMs,
    );
    if (processResult.code !== 0 || processResult.timedOut) {
      throw new Error(`Reference-pack preparation failed: ${processResult.stderr || processResult.stdout || processResult.error || "unknown error"}`);
    }
    const marker = String(processResult.stdout ?? "")
      .split(/\r?\n/)
      .find((line) => line.startsWith("REFERENCE_PACK_PREPARED="));
    const generated = marker ? JSON.parse(marker.slice("REFERENCE_PACK_PREPARED=".length)) : null;
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return {
      stage: "prepared",
      outputDir,
      manifestPath,
      generated,
      manifest,
      process: {
        code: processResult.code,
        timedOut: processResult.timedOut,
        durationMs: processResult.durationMs,
      },
    };
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => undefined);
  }
}


export const imageToolModule: BridgeToolModule = {
  name: "images",
  tools: [
    {
      name: "image_file_attach",
      description: "Attach one or more allowed local PNG/JPEG/WebP files directly to the MCP tool result for full-quality visual inspection. Preserves the original bytes, reports dimensions and SHA-256, supports optional hash verification, and never prints the encoded image payload in the text result. Prefer this over binary_file_read_chunk, temporary HTTP servers, tunnels, or resized previews when ChatGPT needs to see an existing local image.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BATCH_ITEMS,
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "Allowed local PNG/JPEG/WebP path to attach without transformation." },
                label: { type: "string", description: "Optional short label identifying the view or role." },
                expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$", description: "Optional expected SHA-256 for immutable evidence verification." },
              },
              required: ["path"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    {
      name: "image_asset_save",
      description: "Use this when ChatGPT has generated or edited one or more images that must be persisted on MauroPrime. Saves one image or an atomic batch from base64/data URLs, validates signatures, records hashes and dimensions, and can write a JSON manifest.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BATCH_ITEMS,
            items: {
              type: "object",
              properties: {
                outputPath: { type: "string" },
                base64: { type: "string", maxLength: MAX_BASE64_CHARS },
                role: { type: "string" },
                prompt: { type: "string" },
                source: { type: "string" },
                metadata: { type: "object", additionalProperties: true },
              },
              required: ["outputPath", "base64"],
              additionalProperties: false,
            },
          },
          overwrite: { type: "boolean", default: false },
          manifestPath: { type: "string" },
          collectionName: { type: "string" },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    {
      name: "image_asset_import_files",
      description: "Import one or more ChatGPT-authorized image file parameters without recompression. Downloads the temporary authorized files, validates image signatures, MIME, dimensions and byte limits, saves them atomically, records SHA-256 provenance, and can write a JSON manifest.",
      inputSchema: {
        type: "object",
        $defs: {
          OpenAIFile: {
            type: "object",
            properties: {
              download_url: { type: "string" },
              file_id: { type: "string" },
              mime_type: { type: "string" },
              file_name: { type: "string" },
            },
            required: ["download_url", "file_id"],
            additionalProperties: false,
          },
        },
        properties: {
          files: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BATCH_ITEMS,
            items: { $ref: "#/$defs/OpenAIFile" },
          },
          targets: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BATCH_ITEMS,
            items: {
              type: "object",
              properties: {
                outputPath: { type: "string" },
                role: { type: "string" },
                prompt: { type: "string" },
                source: { type: "string" },
                metadata: { type: "object", additionalProperties: true },
              },
              required: ["outputPath"],
              additionalProperties: false,
            },
          },
          overwrite: { type: "boolean", default: false },
          manifestPath: { type: "string" },
          collectionName: { type: "string" },
        },
        required: ["files", "targets"],
        additionalProperties: false,
      },
      _meta: {
        "openai/fileParams": ["files"],
      },
    },
    {
      name: "image_reference_pack_prepare",
      description: "Normalize and version a generic Blender modeling reference pack without stretching. Records a durable coordination contract for offline preparation or reference-only generation while Mauro models, including the intended .blend handoff and a hard no-live-Blender tool policy.",
      inputSchema: {
        type: "object",
        properties: {
          baseName: { type: "string" },
          assetKind: { type: "string", enum: ["character", "prop", "environment", "other"], default: "prop" },
          items: {
            type: "array",
            minItems: 2,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: [...referencePackRoles] },
                inputPath: { type: "string" },
                usage: { type: "string", enum: ["construction", "design"] },
                projection: { type: "string", enum: ["orthographic", "perspective"] },
                semanticQa: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["pass", "pending", "fail"], default: "pending" },
                    notes: { type: "array", items: { type: "string" }, maxItems: 20, default: [] },
                  },
                  additionalProperties: false,
                },
                landmarks: {
                  type: "object",
                  description: "Optional named normalized source-image points in the 0..1 range, for example ground, top, shoulder, hinge or drawer-center.",
                  additionalProperties: {
                    type: "object",
                    properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } },
                    required: ["x", "y"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["role", "inputPath", "usage", "projection"],
              additionalProperties: false,
            },
          },
          masters: {
            type: "object",
            properties: {
              design: { type: "string", enum: [...referencePackRoles] },
              geometry: { type: "string", enum: [...referencePackRoles] },
            },
            additionalProperties: false,
          },
          operationMode: { type: "string", enum: ["reference-only", "offline-preparation"], default: "offline-preparation" },
          userModeling: { type: "boolean", default: false },
          targetBlendFile: { type: "string", description: "Optional intended .blend handoff path. The preparation tool never opens or modifies it." },
          outputDir: { type: "string" },
          manifestPath: { type: "string" },
          targetWidth: { type: "number", default: 1400, minimum: 256, maximum: 4096 },
          targetHeight: { type: "number", default: 1400, minimum: 256, maximum: 4096 },
          backgroundThreshold: { type: "number", default: 10, minimum: 1, maximum: 80 },
          cropMargin: { type: "number", default: 0.04, minimum: 0, maximum: 0.3 },
          canvasMargin: { type: "number", default: 0.06, minimum: 0, maximum: 0.3 },
          alignment: { type: "string", enum: ["center", "baseline"], default: "center" },
          outputFormat: { type: "string", enum: ["jpeg", "png"], default: "png" },
          jpegQuality: { type: "number", default: 94, minimum: 50, maximum: 100 },
          overwrite: { type: "boolean", default: false },
          timeoutMs: { type: "number", default: 180000, minimum: 1000, maximum: 600000 },
        },
        required: ["baseName", "items", "outputDir"],
        additionalProperties: false,
      },
    },

    {
      name: "image_character_views_prepare",
      description: "Use this after image_asset_save when a character has exactly one front, side, back, and three-quarter source view. Normalizes the set for Blender, aligns feet and scale, exports lightweight references, and returns quality warnings plus a manifest.",
      inputSchema: {
        type: "object",
        properties: {
          baseName: { type: "string" },
          items: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["front", "side", "back", "three-quarter"] },
                inputPath: { type: "string" },
              },
              required: ["role", "inputPath"],
              additionalProperties: false,
            },
          },
          outputDir: { type: "string" },
          manifestPath: { type: "string" },
          targetWidth: { type: "number", default: 1024, minimum: 256, maximum: 4096 },
          targetHeight: { type: "number", default: 1280, minimum: 256, maximum: 4096 },
          backgroundThreshold: { type: "number", default: 10, minimum: 1, maximum: 80 },
          cropMargin: { type: "number", default: 0.04, minimum: 0, maximum: 0.3 },
          canvasMargin: { type: "number", default: 0.06, minimum: 0, maximum: 0.3 },
          outputFormat: { type: "string", enum: ["jpeg", "png"], default: "jpeg" },
          jpegQuality: { type: "number", default: 92, minimum: 50, maximum: 100 },
          overwrite: { type: "boolean", default: false },
          timeoutMs: { type: "number", default: 180000, minimum: 1000, maximum: 600000 },
        },
        required: ["baseName", "items", "outputDir"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    image_file_attach: async (raw) => {
      const parsed = z.object({
        items: z.array(localImageItemSchema).min(1).max(MAX_BATCH_ITEMS),
      }).parse(raw);
      return await attachLocalImages(parsed);
    },
    image_asset_save: async (raw) => {
      const parsed = z.object({
        items: z.array(itemSchema).min(1).max(MAX_BATCH_ITEMS),
        overwrite: z.boolean().default(false),
        manifestPath: z.string().optional(),
        collectionName: z.string().max(160).optional(),
      }).parse(raw);
      return await saveImages(parsed);
    },
    image_asset_import_files: async (raw) => {
      const parsed = z.object({
        files: z.array(openAIFileSchema).min(1).max(MAX_BATCH_ITEMS),
        targets: z.array(assetTargetSchema).min(1).max(MAX_BATCH_ITEMS),
        overwrite: z.boolean().default(false),
        manifestPath: z.string().optional(),
        collectionName: z.string().max(160).optional(),
      }).parse(raw);
      return await importFileImages(parsed);
    },
    image_reference_pack_prepare: async (raw) => {
      const parsed = z.object({
        baseName: z.string().min(1).max(120),
        assetKind: z.enum(["character", "prop", "environment", "other"]).default("prop"),
        items: z.array(z.object({
          role: referencePackRoleSchema,
          inputPath: z.string(),
          usage: referencePackUsageSchema,
          projection: referencePackProjectionSchema,
          semanticQa: referencePackQaSchema.default({ status: "pending", notes: [] }),
          landmarks: z.record(z.string().min(1).max(120), normalizedLandmarkSchema).default({}),
        })).min(2).max(10),
        masters: z.object({
          design: referencePackRoleSchema.optional(),
          geometry: referencePackRoleSchema.optional(),
        }).default({}),
        operationMode: z.enum(["reference-only", "offline-preparation"]).default("offline-preparation"),
        userModeling: z.boolean().default(false),
        targetBlendFile: z.string().optional(),
        outputDir: z.string(),
        manifestPath: z.string().optional(),
        targetWidth: z.number().int().min(256).max(4096).default(1400),
        targetHeight: z.number().int().min(256).max(4096).default(1400),
        backgroundThreshold: z.number().min(1).max(80).default(10),
        cropMargin: z.number().min(0).max(0.3).default(0.04),
        canvasMargin: z.number().min(0).max(0.3).default(0.06),
        alignment: z.enum(["center", "baseline"]).default("center"),
        outputFormat: z.enum(["jpeg", "png"]).default("png"),
        jpegQuality: z.number().int().min(50).max(100).default(94),
        overwrite: z.boolean().default(false),
        timeoutMs: z.number().int().min(1000).max(600000).default(180000),
      }).parse(raw);
      return await prepareReferencePack(parsed);
    },

    image_character_views_prepare: async (raw) => {
      const parsed = z.object({
        baseName: z.string().min(1).max(120),
        items: z.array(z.object({
          role: characterViewRoleSchema,
          inputPath: z.string(),
        })).length(4),
        outputDir: z.string(),
        manifestPath: z.string().optional(),
        targetWidth: z.number().int().min(256).max(4096).default(1024),
        targetHeight: z.number().int().min(256).max(4096).default(1280),
        backgroundThreshold: z.number().min(1).max(80).default(10),
        cropMargin: z.number().min(0).max(0.3).default(0.04),
        canvasMargin: z.number().min(0).max(0.3).default(0.06),
        outputFormat: z.enum(["jpeg", "png"]).default("jpeg"),
        jpegQuality: z.number().int().min(50).max(100).default(92),
        overwrite: z.boolean().default(false),
        timeoutMs: z.number().int().min(1000).max(600000).default(180000),
      }).parse(raw);
      return await prepareCharacterViews(parsed);
    },
  },
};
