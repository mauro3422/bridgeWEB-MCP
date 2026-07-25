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

const itemSchema = z.object({
  outputPath: z.string().min(1),
  base64: z.string().min(1).max(MAX_BASE64_CHARS),
  role: z.string().max(80).optional(),
  prompt: z.string().max(10_000).optional(),
  source: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const localImageItemSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1).max(160).optional(),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

type ImageInput = z.infer<typeof itemSchema>;
type LocalImageInput = z.infer<typeof localImageItemSchema>;

type DecodedImage = {
  input: ImageInput;
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

async function saveImages(args: {
  items: ImageInput[];
  overwrite: boolean;
  manifestPath?: string;
  collectionName?: string;
}) {
  const decoded = args.items.map(decodeImage);
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

const characterViewRoleSchema = z.enum(["front", "side", "back", "three-quarter"]);

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
