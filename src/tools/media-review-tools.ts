import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath, runProcess } from "./shared/process.js";

const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_ATTACH_FRAMES = 8;
const MAX_ATTACH_FRAME_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 240_000;

const openAIFileSchema = z.object({
  download_url: z.string().min(1),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});

type OpenAIFileInput = z.infer<typeof openAIFileSchema>;

type MediaContainer = {
  kind: "iso-bmff" | "webm" | "wav" | "mp3";
  extension: ".mp4" | ".webm" | ".wav" | ".mp3";
  canonicalMime: string;
};

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isLoopbackUrl(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

function assertAuthorizedDownloadUrl(url: URL, fileId: string): void {
  if (url.protocol !== "https:" && !isLoopbackUrl(url)) {
    throw new Error(`[safety-guard] Authorized media download URL must use HTTPS: ${fileId}`);
  }
}

async function readBoundedResponse(response: Response, label: string): Promise<Buffer> {
  if (!response.body) throw new Error(`Media download returned no body: ${label}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
    throw new Error(`Media download exceeds ${MAX_MEDIA_BYTES} bytes: ${label}`);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    total += value.length;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Media download exceeds ${MAX_MEDIA_BYTES} bytes: ${label}`);
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw new Error(`Media download is empty: ${label}`);
  return Buffer.concat(chunks, total);
}

function detectMediaContainer(bytes: Buffer): MediaContainer {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") {
    return { kind: "wav", extension: ".wav", canonicalMime: "audio/wav" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: "webm", extension: ".webm", canonicalMime: "video/webm" };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    return { kind: "iso-bmff", extension: ".mp4", canonicalMime: "video/mp4" };
  }
  if (
    (bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3") ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { kind: "mp3", extension: ".mp3", canonicalMime: "audio/mpeg" };
  }
  throw new Error("[expected-integrity-mismatch] Unsupported or unrecognized media signature. Supported containers: MP4/M4A/MOV, WebM, WAV, MP3.");
}

function declaredMimeCompatible(declaredRaw: string | undefined, measured: MediaContainer): boolean {
  if (!declaredRaw) return true;
  const declared = declaredRaw.toLowerCase().split(";", 1)[0].trim();
  if (!declared || declared === "application/octet-stream") return true;
  if (measured.kind === "wav") return ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(declared);
  if (measured.kind === "mp3") return ["audio/mpeg", "audio/mp3"].includes(declared);
  if (measured.kind === "webm") return ["video/webm", "audio/webm"].includes(declared);
  if (measured.kind === "iso-bmff") {
    return ["video/mp4", "audio/mp4", "audio/x-m4a", "video/quicktime", "audio/quicktime"].includes(declared);
  }
  return false;
}

function safeId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return normalized.slice(0, 64) || "media";
}

async function downloadAuthorizedMedia(file: OpenAIFileInput): Promise<{ bytes: Buffer; measured: MediaContainer }> {
  const url = new URL(file.download_url);
  assertAuthorizedDownloadUrl(url, file.file_id);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", signal: controller.signal });
  } catch (error) {
    throw new Error(`[source-file-unavailable] Unable to download authorized media ${file.file_id}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`[source-file-unavailable] Authorized media download failed (${response.status}) for ${file.file_id}`);
  if (response.url) assertAuthorizedDownloadUrl(new URL(response.url), file.file_id);

  const bytes = await readBoundedResponse(response, file.file_name ?? file.file_id);
  const measured = detectMediaContainer(bytes);
  if (!declaredMimeCompatible(file.mime_type, measured)) {
    throw new Error(`[expected-integrity-mismatch] Media MIME mismatch for ${file.file_id}: declared ${file.mime_type}, measured ${measured.canonicalMime}`);
  }
  return { bytes, measured };
}

async function readLocalMedia(localPathRaw: string): Promise<{ bytes: Buffer; measured: MediaContainer; resolvedPath: string }> {
  const resolvedPath = resolveToolPath(localPathRaw, { access: "read" });
  const stats = await fs.stat(resolvedPath).catch((error) => {
    throw new Error(`[source-file-unavailable] Unable to read local media ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!stats.isFile()) throw new Error(`[source-file-unavailable] Local media path is not a file: ${resolvedPath}`);
  if (!stats.size) throw new Error(`[source-file-unavailable] Local media is empty: ${resolvedPath}`);
  if (stats.size > MAX_MEDIA_BYTES) throw new Error(`Local media exceeds ${MAX_MEDIA_BYTES} bytes: ${resolvedPath}`);
  const bytes = await fs.readFile(resolvedPath);
  const afterStats = await fs.stat(resolvedPath);
  if (bytes.length !== stats.size || afterStats.size !== stats.size || afterStats.mtimeMs !== stats.mtimeMs) {
    throw new Error(`[expected-integrity-mismatch] Local media changed while it was being read: ${resolvedPath}`);
  }
  const measured = detectMediaContainer(bytes);
  return { bytes, measured, resolvedPath };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function frameRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function evenlySpaced<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const selected: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i * (items.length - 1)) / Math.max(1, limit - 1));
    if (!used.has(index)) {
      used.add(index);
      selected.push(items[index]);
    }
  }
  return selected;
}

async function attachPreviewFrames(frames: Array<Record<string, unknown>>) {
  const attachments: Array<{ type: "image"; mimeType: string; data: string }> = [];
  const attached: Array<{ path: string; timestampSeconds: number | null; bytes: number; sha256: string; kind: string | null; transcriptExcerpt: string; visualEventIndices: number[]; motion: unknown }> = [];
  for (const frame of evenlySpaced(frames, MAX_ATTACH_FRAMES)) {
    if (typeof frame.path !== "string") continue;
    const framePath = resolveToolPath(frame.path, { access: "read" });
    const bytes = await fs.readFile(framePath);
    if (!bytes.length || bytes.length > MAX_ATTACH_FRAME_BYTES) continue;
    if (!(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) continue;
    const digest = sha256(bytes);
    attachments.push({ type: "image", mimeType: "image/jpeg", data: bytes.toString("base64") });
    const context = frame.context && typeof frame.context === "object" && !Array.isArray(frame.context) ? frame.context as Record<string, unknown> : {};
    const transcription = context.transcription && typeof context.transcription === "object" && !Array.isArray(context.transcription)
      ? context.transcription as Record<string, unknown>
      : {};
    attached.push({
      path: framePath,
      timestampSeconds: typeof frame.timestampSeconds === "number" ? frame.timestampSeconds : null,
      bytes: bytes.length,
      sha256: digest,
      kind: typeof frame.kind === "string" ? frame.kind : null,
      transcriptExcerpt: typeof transcription.excerpt === "string" ? transcription.excerpt : "",
      visualEventIndices: Array.isArray(context.visualEventIndices)
        ? context.visualEventIndices.filter((item): item is number => typeof item === "number")
        : [],
      motion: frame.motion ?? null,
    });
  }
  return { attachments, attached };
}

async function ingestMediaReview(args: {
  files?: OpenAIFileInput[];
  localPath?: string;
  outputDir?: string;
  segmentSeconds: number;
  frameIntervalSeconds: number;
  maxFrames: number;
  visualAnalysisFps: number;
  transcribe: boolean;
  primaryLanguage: string;
  fallbackLanguage?: string;
  keepAudio: boolean;
  keepSource: boolean;
  attachPreviewFrames: boolean;
  maxWorkers: number;
  jpegQuality: number;
  alignmentMode: "speech-aware" | "fixed";
  detectVisualKeyframes: boolean;
  timeoutMs: number;
}) {
  const file = args.files?.[0] ?? null;
  const hasLocalPath = Boolean(args.localPath?.trim());
  if (Boolean(file) === hasLocalPath) {
    throw new Error("[schema-validation] Provide exactly one media source: files or localPath.");
  }

  const acquired = file
    ? {
        sourceKind: "chatgpt-file" as const,
        ...(await downloadAuthorizedMedia(file)),
        fileId: file.file_id,
        fileName: file.file_name ?? null,
        declaredMime: file.mime_type ?? null,
        originPath: null as string | null,
        identity: file.file_id,
      }
    : await (async () => {
        const local = await readLocalMedia(args.localPath!);
        return {
          sourceKind: "local-path" as const,
          bytes: local.bytes,
          measured: local.measured,
          fileId: null as string | null,
          fileName: path.basename(local.resolvedPath),
          declaredMime: null as string | null,
          originPath: local.resolvedPath,
          identity: path.basename(local.resolvedPath),
        };
      })();

  const reviewId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeId(acquired.identity)}_${crypto.randomUUID().slice(0, 8)}`;
  const outputDir = resolveToolPath(args.outputDir ?? path.join(process.cwd(), ".tmp", "media-reviews", reviewId), { access: "write" });
  await fs.mkdir(outputDir, { recursive: true });

  const sourcePath = resolveToolPath(path.join(outputDir, `source${acquired.measured.extension}`), { access: "write" });
  await fs.writeFile(sourcePath, acquired.bytes);
  const sourceDigest = sha256(acquired.bytes);
  const configPath = resolveToolPath(path.join(outputDir, "review-config.json"), { access: "write" });
  const reviewPath = resolveToolPath(path.join(outputDir, "review.json"), { access: "write" });
  const helperPath = resolveToolPath(path.join(process.cwd(), "integrations", "media", "review_media.py"), { access: "read" });

  const helperConfig = {
    sourcePath,
    outputDir,
    segmentSeconds: args.segmentSeconds,
    frameIntervalSeconds: args.frameIntervalSeconds,
    maxFrames: args.maxFrames,
    visualAnalysisFps: args.visualAnalysisFps,
    transcribe: args.transcribe,
    primaryLanguage: args.primaryLanguage,
    fallbackLanguage: args.fallbackLanguage ?? null,
    keepAudio: args.keepAudio,
    maxWorkers: args.maxWorkers,
    jpegQuality: args.jpegQuality,
    alignmentMode: args.alignmentMode,
    detectVisualKeyframes: args.detectVisualKeyframes,
    processTimeoutSeconds: Math.max(30, Math.floor(args.timeoutMs / 1000) - 10),
  };
  await fs.writeFile(configPath, JSON.stringify(helperConfig, null, 2), "utf8");

  let processResult: Record<string, unknown> | null = null;
  try {
    processResult = await runProcess("python", [helperPath, configPath], process.cwd(), args.timeoutMs);
    if (processResult.code !== 0 || processResult.timedOut === true) {
      throw new Error(`[media-review-failed] Media review helper failed: ${String(processResult.stderr ?? processResult.stdout ?? "unknown failure").slice(-4000)}`);
    }
    const parsed = JSON.parse(await fs.readFile(reviewPath, "utf8")) as Record<string, unknown>;
    const frames = frameRecords(parsed.frames);
    const visualKeyframes = frameRecords(parsed.visualKeyframes);
    const warnings = stringArray(parsed.warnings);
    const source = {
      sourceKind: acquired.sourceKind,
      fileId: acquired.fileId,
      fileName: acquired.fileName,
      declaredMime: acquired.declaredMime,
      originPath: acquired.originPath,
      detectedContainer: acquired.measured.kind,
      canonicalMime: acquired.measured.canonicalMime,
      bytes: acquired.bytes.length,
      sha256: sourceDigest,
      originalBytesPreserved: true,
      workingCopyUsed: true,
      persistedSourcePath: args.keepSource ? sourcePath : null,
    };
    parsed.source = source;
    parsed.sourcePath = args.keepSource ? sourcePath : null;
    parsed.reviewId = reviewId;
    parsed.reviewPath = reviewPath;
    const transcription = parsed.transcription && typeof parsed.transcription === "object" ? parsed.transcription as Record<string, unknown> : {};
    parsed.externalProcessing = args.transcribe
      ? { provider: "Google Speech Recognition", audioSentExternally: true, strategy: typeof transcription.strategy === "string" ? transcription.strategy : null }
      : { provider: null, audioSentExternally: false, strategy: null };
    parsed.warnings = warnings;
    await fs.writeFile(reviewPath, JSON.stringify(parsed, null, 2), "utf8");

    const previewCandidates = visualKeyframes.length ? visualKeyframes : frames;
    const preview = args.attachPreviewFrames ? await attachPreviewFrames(previewCandidates) : { attachments: [], attached: [] };
    if (!args.keepSource) await fs.rm(sourcePath, { force: true }).catch(() => undefined);

    return {
      ...parsed,
      previewFramesAttached: preview.attached,
      ...(preview.attachments.length ? { __bridgeImages: preview.attachments } : {}),
      processing: {
        durationMs: processResult.durationMs,
        helper: helperPath,
      },
    };
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => undefined);
    if (!args.keepSource && processResult === null) await fs.rm(sourcePath, { force: true }).catch(() => undefined);
  }
}

export const mediaReviewToolModule: BridgeToolModule = {
  name: "media-review",
  tools: [
    {
      name: "media_review_ingest",
      description: "Ingest one local or ChatGPT-authorized audio/video source for narrated synchronized review. Uses an immutable working copy, automatically detects acoustic activity, speech/silence, adaptive visual changes and apparent 2D view motion, materializes only bounded representative JPEGs plus sparse coverage frames, and correlates each representative/event with transcript and audio metadata. When transcribe=true, it performs one full-audio Google recognition as the canonical text plus bounded speech-aware recognitions as temporal anchors, aligns the canonical text back onto those timestamped segments, preserves the raw segment recognitions, and writes an aligned SRT sidecar. Google Speech through this provider still does not expose word-level timestamps. inverseViewDirectionHint is only a 2D viewport/camera-pan hint. Audio leaves MauroPrime when transcribe=true; use transcribe=false for fully local analysis.",
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
          files: { type: "array", minItems: 1, maxItems: 1, items: { $ref: "#/$defs/OpenAIFile" }, description: "ChatGPT-authorized attachment source." },
          localPath: { type: "string", description: "Allowed local audio/video file path. Use this for Codex or files already present on MauroPrime." },
          outputDir: { type: "string", description: "Optional allowed local review directory. Defaults to .tmp/media-reviews/<review-id>." },
          segmentSeconds: { type: "number", minimum: 4, maximum: 30, default: 10, description: "Maximum ASR group duration. Speech-aware mode preserves finer voice/silence windows separately." },
          frameIntervalSeconds: { type: "number", minimum: 1, maximum: 30, default: 12, description: "Sparse coverage-frame interval. Adaptive visual events are detected separately and are the primary review evidence." },
          maxFrames: { type: "integer", minimum: 1, maximum: 60, default: 12, description: "Maximum sparse coverage frames; adaptive representative frames use a separate bounded event budget." },
          visualAnalysisFps: { type: "number", minimum: 1, maximum: 20, default: 10, description: "Target reduced-resolution visual analysis cadence. Long videos are automatically bounded to at most about 6000 analysis samples." },
          transcribe: { type: "boolean", default: true, description: "When true, sends the full audio once to Google for canonical recognition plus bounded speech-aware groups for timestamp anchors; falls back to segmented text if the full-audio recognition is unavailable." },
          primaryLanguage: { type: "string", default: "es-AR" },
          fallbackLanguage: { type: "string", default: "en-US" },
          alignmentMode: { type: "string", enum: ["speech-aware", "fixed"], default: "speech-aware", description: "speech-aware uses detected voice activity as the audio clock; fixed preserves the legacy fixed-window ASR behavior." },
          detectVisualKeyframes: { type: "boolean", default: true, description: "Detect review keyframes from visual content changes. These are not codec/GOP keyframes." },
          keepAudio: { type: "boolean", default: false },
          keepSource: { type: "boolean", default: false },
          attachPreviewFrames: { type: "boolean", default: true, description: "Attach up to eight representative visual-change frames, or periodic frames when no keyframes exist." },
          maxWorkers: { type: "integer", minimum: 1, maximum: 4, default: 3 },
          jpegQuality: { type: "integer", minimum: 55, maximum: 95, default: 86 },
          timeoutMs: { type: "integer", minimum: 30000, maximum: 600000, default: DEFAULT_TIMEOUT_MS },
        },
        oneOf: [{ required: ["files"] }, { required: ["localPath"] }],
        additionalProperties: false,
      },
      _meta: {
        "openai/fileParams": ["files"],
      },
    },
  ],
  handlers: {
    media_review_ingest: async (raw) => {
      const parsed = z.object({
        files: z.array(openAIFileSchema).length(1).optional(),
        localPath: z.string().min(1).optional(),
        outputDir: z.string().optional(),
        segmentSeconds: z.number().min(4).max(30).default(10),
        frameIntervalSeconds: z.number().min(1).max(30).default(12),
        maxFrames: z.number().int().min(1).max(60).default(12),
        visualAnalysisFps: z.number().min(1).max(20).default(10),
        transcribe: z.boolean().default(true),
        primaryLanguage: z.string().min(2).max(32).default("es-AR"),
        fallbackLanguage: z.string().min(2).max(32).optional().default("en-US"),
        alignmentMode: z.enum(["speech-aware", "fixed"]).default("speech-aware"),
        detectVisualKeyframes: z.boolean().default(true),
        keepAudio: z.boolean().default(false),
        keepSource: z.boolean().default(false),
        attachPreviewFrames: z.boolean().default(true),
        maxWorkers: z.number().int().min(1).max(4).default(3),
        jpegQuality: z.number().int().min(55).max(95).default(86),
        timeoutMs: z.number().int().min(30000).max(600000).default(DEFAULT_TIMEOUT_MS),
      }).superRefine((value, ctx) => {
        const sourceCount = (value.files?.length ? 1 : 0) + (value.localPath?.trim() ? 1 : 0);
        if (sourceCount !== 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one media source: files or localPath." });
        }
      }).parse(raw);
      return await ingestMediaReview(parsed);
    },
  },
};
