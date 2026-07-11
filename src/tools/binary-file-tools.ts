import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/path.js";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DIRECT_ENCODED_CHARS = 512 * 1024;
const MAX_UPLOAD_CHUNK_CHARS = 24 * 1024;
const MAX_READ_CHUNK_BYTES = 256 * 1024;
const MAX_ENCODED_TOTAL_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const encodingSchema = z.enum(["base64", "base64url", "hex"]);
type BinaryEncoding = z.infer<typeof encodingSchema>;

type UploadManifest = {
  schemaVersion: 1;
  uploadId: string;
  outputPath: string;
  encoding: BinaryEncoding;
  overwrite: boolean;
  expectedBytes: number | null;
  expectedSha256: string | null;
  nextSequence: number;
  encodedChars: number;
  createdAt: string;
  updatedAt: string;
};

function uploadRoot(): string {
  return path.resolve(process.env.BRIDGE_MCP_BINARY_UPLOAD_DIR || path.join(os.tmpdir(), "bridge-mcp-binary-uploads"));
}

function uploadPaths(uploadId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new Error("uploadId must be a UUID returned by binary_upload_begin");
  }
  const dir = path.join(uploadRoot(), uploadId);
  return { dir, manifest: path.join(dir, "manifest.json"), payload: path.join(dir, "payload.txt") };
}

async function cleanupExpiredUploads(limit = 200): Promise<number> {
  const root = uploadRoot();
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries.slice(0, limit)) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const manifestPath = path.join(dir, "manifest.json");
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Partial<UploadManifest>;
      const updatedAt = typeof manifest.updatedAt === "string" ? Date.parse(manifest.updatedAt) : Number.NaN;
      if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > UPLOAD_TTL_MS) {
        await fs.rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      await fs.rm(dir, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeEncoded(data: string, encoding: BinaryEncoding): string {
  let value = String(data ?? "").trim();
  if (encoding === "base64") value = value.replace(/^data:[^;,]+;base64,/i, "");
  value = value.replace(/\s+/g, "");
  if (!value) throw new Error("Encoded payload is empty");

  if (encoding === "hex") {
    if (!/^[0-9a-f]+$/i.test(value)) throw new Error("Hex payload contains invalid characters");
    return value;
  }

  const pattern = encoding === "base64" ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9_-]*={0,2}$/;
  if (!pattern.test(value)) throw new Error(`${encoding} payload contains invalid characters`);
  return value;
}

function decodeEncoded(data: string, encoding: BinaryEncoding): Buffer {
  const normalized = normalizeEncoded(data, encoding);
  if (encoding === "hex") {
    if (normalized.length % 2 !== 0) throw new Error("Hex payload must contain an even number of characters");
    return Buffer.from(normalized, "hex");
  }

  let standard = encoding === "base64url"
    ? normalized.replace(/-/g, "+").replace(/_/g, "/")
    : normalized;
  const remainder = standard.length % 4;
  if (remainder === 1) throw new Error("Invalid base64 length");
  if (remainder > 0) standard += "=".repeat(4 - remainder);
  const bytes = Buffer.from(standard, "base64");
  const canonicalInput = standard.replace(/=+$/g, "");
  const canonicalOutput = bytes.toString("base64").replace(/=+$/g, "");
  if (canonicalInput !== canonicalOutput) throw new Error("Base64 payload is truncated or non-canonical");
  return bytes;
}

function encodeBytes(bytes: Buffer, encoding: BinaryEncoding): string {
  if (encoding === "hex") return bytes.toString("hex");
  const base64 = bytes.toString("base64");
  return encoding === "base64url"
    ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
    : base64;
}

function sha256Bytes(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function detectMime(header: Buffer): string {
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (header.length >= 6 && ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (header.length >= 4 && header.subarray(0, 4).toString("ascii") === "glTF") return "model/gltf-binary";
  if (header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b && [0x03, 0x05, 0x07].includes(header[2]) && [0x04, 0x06, 0x08].includes(header[3])) return "application/zip";
  if (header.length >= 5 && header.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return "application/octet-stream";
}

async function writeAtomic(outputPathInput: string, bytes: Buffer, options: {
  overwrite: boolean;
  expectedBytes?: number;
  expectedSha256?: string;
}) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`Decoded payload exceeds ${MAX_FILE_BYTES} bytes`);
  const sha256 = sha256Bytes(bytes);
  if (options.expectedBytes !== undefined && bytes.length !== options.expectedBytes) {
    throw new Error(`Byte count mismatch: expected ${options.expectedBytes}, decoded ${bytes.length}`);
  }
  if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: expected ${options.expectedSha256.toLowerCase()}, decoded ${sha256}`);
  }

  const outputPath = resolveToolPath(outputPathInput, { access: "write" });
  if (!options.overwrite && await exists(outputPath)) throw new Error(`File already exists: ${outputPath}`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.bridge-${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, bytes);
    if (options.overwrite && await exists(outputPath)) await fs.rm(outputPath, { force: true });
    await fs.rename(tempPath, outputPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    outputPath,
    bytes: bytes.length,
    sha256,
    mime: detectMime(bytes.subarray(0, 32)),
    overwritten: options.overwrite,
  };
}

async function readUpload(uploadId: string): Promise<{ manifest: UploadManifest; paths: ReturnType<typeof uploadPaths> }> {
  const paths = uploadPaths(uploadId);
  let manifest: UploadManifest;
  try {
    manifest = JSON.parse(await fs.readFile(paths.manifest, "utf8")) as UploadManifest;
  } catch {
    throw new Error(`Binary upload session not found: ${uploadId}`);
  }
  if (Date.now() - Date.parse(manifest.updatedAt) > UPLOAD_TTL_MS) {
    throw new Error(`Binary upload session expired: ${uploadId}`);
  }
  return { manifest, paths };
}

async function writeManifest(filePath: string, manifest: UploadManifest): Promise<void> {
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(temp, filePath);
}

async function fileInfo(inputPath: string) {
  const filePath = resolveToolPath(inputPath, { access: "read" });
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Path is not a file: ${filePath}`);
  const handle = await fs.open(filePath, "r");
  const header = Buffer.alloc(Math.min(64, stat.size));
  try {
    if (header.length) await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  return {
    path: filePath,
    bytes: stat.size,
    sha256: await sha256File(filePath),
    mime: detectMime(header),
    modifiedAt: stat.mtime.toISOString(),
  };
}

export const binaryFileToolModule: BridgeToolModule = {
  name: "binary-files",
  tools: [
    {
      name: "binary_file_info",
      description: "Inspect an allowed binary file without printing its contents. Returns byte size, SHA-256, detected MIME type, and modification time.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_file_read_chunk",
      description: "Read a bounded byte range from an allowed binary file and return it as base64, base64url, or hex. Use offsets to transfer large files safely.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number", default: 0, minimum: 0 },
          maxBytes: { type: "number", default: 32768, minimum: 1, maximum: MAX_READ_CHUNK_BYTES },
          encoding: { type: "string", enum: ["base64", "base64url", "hex"], default: "base64url" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_file_write",
      description: "Write a small binary payload atomically from base64, base64url, or hex. Validates optional expected byte count and SHA-256 before replacing the target.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: { type: "string" },
          data: { type: "string", maxLength: MAX_DIRECT_ENCODED_CHARS },
          encoding: { type: "string", enum: ["base64", "base64url", "hex"], default: "base64" },
          overwrite: { type: "boolean", default: false },
          expectedBytes: { type: "number", minimum: 0, maximum: MAX_FILE_BYTES },
          expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        },
        required: ["outputPath", "data"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_upload_begin",
      description: "Begin a resumable encoded binary upload for a large file. Returns an uploadId and next sequence number; append bounded chunks, then finish atomically.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: { type: "string" },
          encoding: { type: "string", enum: ["base64", "base64url", "hex"], default: "base64" },
          overwrite: { type: "boolean", default: false },
          expectedBytes: { type: "number", minimum: 0, maximum: MAX_FILE_BYTES },
          expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        },
        required: ["outputPath"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_upload_append",
      description: "Append one bounded encoded chunk to a resumable binary upload. Sequence numbers are enforced so interrupted transfers can resume safely.",
      inputSchema: {
        type: "object",
        properties: {
          uploadId: { type: "string" },
          sequence: { type: "number", minimum: 0 },
          chunk: { type: "string", maxLength: MAX_UPLOAD_CHUNK_CHARS },
        },
        required: ["uploadId", "sequence", "chunk"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_upload_status",
      description: "Inspect a resumable binary upload and return its target, encoding, accumulated characters, next sequence, expectations, and expiry.",
      inputSchema: {
        type: "object",
        properties: { uploadId: { type: "string" } },
        required: ["uploadId"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_upload_finish",
      description: "Decode and atomically commit a resumable binary upload after validating size and SHA-256. Successful uploads remove their temporary session.",
      inputSchema: {
        type: "object",
        properties: { uploadId: { type: "string" } },
        required: ["uploadId"],
        additionalProperties: false,
      },
    },
    {
      name: "binary_upload_abort",
      description: "Delete a resumable binary upload session without touching its target file.",
      inputSchema: {
        type: "object",
        properties: { uploadId: { type: "string" } },
        required: ["uploadId"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    binary_file_info: async (raw) => {
      const parsed = z.object({ path: z.string().min(1) }).parse(raw);
      return await fileInfo(parsed.path);
    },
    binary_file_read_chunk: async (raw) => {
      const parsed = z.object({
        path: z.string().min(1),
        offset: z.number().int().min(0).default(0),
        maxBytes: z.number().int().min(1).max(MAX_READ_CHUNK_BYTES).default(32768),
        encoding: encodingSchema.default("base64url"),
      }).parse(raw);
      const filePath = resolveToolPath(parsed.path, { access: "read" });
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error(`Path is not a file: ${filePath}`);
      if (parsed.offset > stat.size) throw new Error(`offset ${parsed.offset} exceeds file size ${stat.size}`);
      const length = Math.min(parsed.maxBytes, stat.size - parsed.offset);
      const bytes = Buffer.alloc(length);
      const handle = await fs.open(filePath, "r");
      try {
        if (length) await handle.read(bytes, 0, length, parsed.offset);
      } finally {
        await handle.close();
      }
      const nextOffset = parsed.offset + length;
      return {
        path: filePath,
        fileBytes: stat.size,
        offset: parsed.offset,
        bytesRead: length,
        nextOffset,
        eof: nextOffset >= stat.size,
        encoding: parsed.encoding,
        data: encodeBytes(bytes, parsed.encoding),
      };
    },
    binary_file_write: async (raw) => {
      const parsed = z.object({
        outputPath: z.string().min(1),
        data: z.string().min(1).max(MAX_DIRECT_ENCODED_CHARS),
        encoding: encodingSchema.default("base64"),
        overwrite: z.boolean().default(false),
        expectedBytes: z.number().int().min(0).max(MAX_FILE_BYTES).optional(),
        expectedSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
      }).parse(raw);
      return await writeAtomic(parsed.outputPath, decodeEncoded(parsed.data, parsed.encoding), parsed);
    },
    binary_upload_begin: async (raw) => {
      const parsed = z.object({
        outputPath: z.string().min(1),
        encoding: encodingSchema.default("base64"),
        overwrite: z.boolean().default(false),
        expectedBytes: z.number().int().min(0).max(MAX_FILE_BYTES).optional(),
        expectedSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
      }).parse(raw);
      const cleanedExpiredSessions = await cleanupExpiredUploads();
      const outputPath = resolveToolPath(parsed.outputPath, { access: "write" });
      if (!parsed.overwrite && await exists(outputPath)) throw new Error(`File already exists: ${outputPath}`);
      const uploadId = crypto.randomUUID();
      const paths = uploadPaths(uploadId);
      await fs.mkdir(paths.dir, { recursive: true });
      const now = new Date().toISOString();
      const manifest: UploadManifest = {
        schemaVersion: 1,
        uploadId,
        outputPath,
        encoding: parsed.encoding,
        overwrite: parsed.overwrite,
        expectedBytes: parsed.expectedBytes ?? null,
        expectedSha256: parsed.expectedSha256?.toLowerCase() ?? null,
        nextSequence: 0,
        encodedChars: 0,
        createdAt: now,
        updatedAt: now,
      };
      await fs.writeFile(paths.payload, "", "utf8");
      await writeManifest(paths.manifest, manifest);
      return { uploadId, outputPath, encoding: parsed.encoding, nextSequence: 0, maxChunkChars: MAX_UPLOAD_CHUNK_CHARS, cleanedExpiredSessions, expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString() };
    },
    binary_upload_append: async (raw) => {
      const parsed = z.object({
        uploadId: z.string().min(1),
        sequence: z.number().int().min(0),
        chunk: z.string().min(1).max(MAX_UPLOAD_CHUNK_CHARS),
      }).parse(raw);
      const { manifest, paths } = await readUpload(parsed.uploadId);
      if (parsed.sequence !== manifest.nextSequence) throw new Error(`Sequence mismatch: expected ${manifest.nextSequence}, received ${parsed.sequence}`);
      const chunk = normalizeEncoded(parsed.chunk, manifest.encoding);
      if (manifest.encodedChars + chunk.length > MAX_ENCODED_TOTAL_CHARS) throw new Error(`Encoded upload exceeds ${MAX_ENCODED_TOTAL_CHARS} characters`);
      await fs.appendFile(paths.payload, chunk, "utf8");
      manifest.nextSequence += 1;
      manifest.encodedChars += chunk.length;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(paths.manifest, manifest);
      return { uploadId: manifest.uploadId, acceptedSequence: parsed.sequence, nextSequence: manifest.nextSequence, encodedChars: manifest.encodedChars, chunkChars: chunk.length };
    },
    binary_upload_status: async (raw) => {
      const parsed = z.object({ uploadId: z.string().min(1) }).parse(raw);
      const { manifest } = await readUpload(parsed.uploadId);
      return { ...manifest, expiresAt: new Date(Date.parse(manifest.updatedAt) + UPLOAD_TTL_MS).toISOString() };
    },
    binary_upload_finish: async (raw) => {
      const parsed = z.object({ uploadId: z.string().min(1) }).parse(raw);
      const { manifest, paths } = await readUpload(parsed.uploadId);
      const encoded = await fs.readFile(paths.payload, "utf8");
      if (encoded.length !== manifest.encodedChars) throw new Error(`Upload payload length mismatch: manifest ${manifest.encodedChars}, file ${encoded.length}`);
      const result = await writeAtomic(manifest.outputPath, decodeEncoded(encoded, manifest.encoding), {
        overwrite: manifest.overwrite,
        expectedBytes: manifest.expectedBytes ?? undefined,
        expectedSha256: manifest.expectedSha256 ?? undefined,
      });
      await fs.rm(paths.dir, { recursive: true, force: true });
      return { uploadId: manifest.uploadId, sequences: manifest.nextSequence, encodedChars: manifest.encodedChars, ...result };
    },
    binary_upload_abort: async (raw) => {
      const parsed = z.object({ uploadId: z.string().min(1) }).parse(raw);
      const paths = uploadPaths(parsed.uploadId);
      const existed = await exists(paths.dir);
      await fs.rm(paths.dir, { recursive: true, force: true });
      return { uploadId: parsed.uploadId, aborted: existed, targetUntouched: true };
    },
  },
};
