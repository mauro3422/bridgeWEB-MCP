import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { assertPathAllowed } from "./shared/path.js";

const DEFAULT_WHITEBOARD_URL = "http://127.0.0.1:8787";
const CONFIGURED_WHITEBOARD_URL = process.env.TABLET_WHITEBOARD_URL ?? DEFAULT_WHITEBOARD_URL;
const CONFIGURED_ALLOWED_ORIGINS = (process.env.TABLET_WHITEBOARD_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const INSERTABLE_IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type CaptureMetadata = {
  id: string;
  boardId: string;
  boardTitle: string;
  imagePath: string;
  source: "manual" | "mcp";
  clientId: string;
  clientKind: "tablet" | "pc" | "unknown";
  camera: { x: number; y: number; zoom: number };
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  createdAt: string;
};

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(normalized)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(normalized)) return true;
  const match172 = normalized.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  if (match172) {
    const second = Number(match172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function normalizeWhiteboardUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:") throw new Error("TabletWhiteboard baseUrl must use http://");
  if (url.username || url.password) throw new Error("TabletWhiteboard baseUrl must not include credentials");
  if (!isPrivateHostname(url.hostname)) throw new Error("TabletWhiteboard baseUrl must point to localhost or a private LAN address");
  if (url.search || url.hash) throw new Error("TabletWhiteboard baseUrl must not include query parameters or a fragment");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("TabletWhiteboard baseUrl must not include an application path");
  url.pathname = "/";
  return url;
}

function whiteboardBaseUrl(raw: string): URL {
  const url = normalizeWhiteboardUrl(raw);
  const allowedOrigins = new Set(
    [CONFIGURED_WHITEBOARD_URL, ...CONFIGURED_ALLOWED_ORIGINS]
      .map((candidate) => normalizeWhiteboardUrl(candidate).origin),
  );
  if (!allowedOrigins.has(url.origin)) {
    throw new Error("TabletWhiteboard baseUrl is not in the configured origin allowlist");
  }
  return url;
}

async function fetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`TabletWhiteboard did not respond within ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (text.length > MAX_JSON_BYTES) return fallback;
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : fallback;
  } catch {
    return fallback;
  }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await responseError(response, fallback));
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw new Error("TabletWhiteboard JSON response is too large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new Error("TabletWhiteboard JSON response is too large");
  return JSON.parse(text) as T;
}

function assertCapture(value: unknown): CaptureMetadata {
  const schema = z.object({
    id: z.string().uuid(),
    boardId: z.string().min(1).max(180),
    boardTitle: z.string().min(1).max(240),
    imagePath: z.string().regex(/^\/api\/captures\/[0-9a-f-]+\/image$/i),
    source: z.enum(["manual", "mcp"]),
    clientId: z.string().min(1).max(180),
    clientKind: z.enum(["tablet", "pc", "unknown"]),
    camera: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.02).max(8) }),
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
    bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i),
    createdAt: z.string().datetime(),
  });
  return schema.parse(value);
}

function pngDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("TabletWhiteboard returned an invalid PNG capture");
  }
  if (data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("TabletWhiteboard PNG does not start with a valid IHDR chunk");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 10_000 || height > 10_000) {
    throw new Error("TabletWhiteboard PNG dimensions are outside the allowed range");
  }
  return { width, height };
}

async function downloadCapture(baseUrl: URL, capture: CaptureMetadata, timeoutMs: number): Promise<Buffer> {
  const imageUrl = new URL(capture.imagePath, baseUrl);
  if (imageUrl.origin !== baseUrl.origin) throw new Error("TabletWhiteboard returned a cross-origin image path");
  const response = await fetchWithTimeout(imageUrl, { method: "GET", headers: { Accept: "image/png" } }, timeoutMs);
  if (!response.ok) throw new Error(await responseError(response, "Could not download the TabletWhiteboard capture"));
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "image/png") throw new Error(`TabletWhiteboard returned ${contentType || "an unknown content type"} instead of image/png`);
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_IMAGE_BYTES) throw new Error("TabletWhiteboard capture exceeds the 8 MB limit");
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_IMAGE_BYTES) throw new Error("TabletWhiteboard capture exceeds the 8 MB limit");
  const dimensions = pngDimensions(data);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  if (declaredBytes > 0 && declaredBytes !== data.length) throw new Error("TabletWhiteboard HTTP Content-Length does not match the downloaded PNG");
  if (capture.bytes !== data.length) throw new Error("TabletWhiteboard capture byte metadata does not match the downloaded PNG");
  if (capture.width !== dimensions.width || capture.height !== dimensions.height) {
    throw new Error("TabletWhiteboard capture dimension metadata does not match the PNG IHDR");
  }
  if (capture.sha256.toLowerCase() !== sha256) throw new Error("TabletWhiteboard capture SHA-256 does not match the downloaded PNG");
  return data;
}

function imageResult(baseUrl: URL, capture: CaptureMetadata, data: Buffer) {
  return {
    capture,
    whiteboardOrigin: baseUrl.origin,
    image: {
      mimeType: "image/png",
      bytes: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      attachedToToolResult: true,
    },
    __bridgeImages: [{ type: "image", mimeType: "image/png", data: data.toString("base64") }],
  };
}

const baseInput = {
  baseUrl: z.string().url().default(CONFIGURED_WHITEBOARD_URL),
  boardId: z.string().min(1).max(180).optional(),
};

const placementInput = {
  x: z.number().finite().min(-1_000_000).max(1_000_000).default(48),
  y: z.number().finite().min(-1_000_000).max(1_000_000).default(48),
  width: z.number().finite().min(16).max(4_000).default(480),
  height: z.number().finite().min(16).max(4_000).default(320),
  timeoutMs: z.number().int().min(1000).max(15000).default(5000),
};

async function postWhiteboardJson(baseUrl: URL, route: string, payload: unknown, timeoutMs: number) {
  const response = await fetchWithTimeout(new URL(route, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  }, timeoutMs);
  return readJson<Record<string, unknown>>(response, `TabletWhiteboard rejected ${route}`);
}

async function resolveBoardId(baseUrl: URL, boardId: string | undefined, timeoutMs: number): Promise<string> {
  if (boardId) return boardId;
  const payload = await readJson<{ id?: unknown }>(
    await fetchWithTimeout(new URL("api/board", baseUrl), { method: "GET", headers: { Accept: "application/json" } }, timeoutMs),
    "Could not resolve the active TabletWhiteboard board",
  );
  return z.string().min(1).max(180).parse(payload.id);
}

function validateInsertableImage(data: Buffer, mimeType: string): void {
  if (data.length < 1 || data.length > MAX_ASSET_BYTES) throw new Error("Image must be between 1 byte and 12 MB");
  const valid = mimeType === "image/png"
    ? data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)
    : mimeType === "image/jpeg"
      ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      : mimeType === "image/webp"
        ? data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP"
        : false;
  if (!valid) throw new Error(`File content does not match ${mimeType}`);
}

export const whiteboardToolModule: BridgeToolModule = {
  name: "tablet-whiteboard",
  tools: [
    {
      name: "whiteboard_capture_pc_view",
      description: "Use this when the user asks you to look at, inspect, read, or review what is currently visible in TabletWhiteboard. Requests a fresh PNG from the connected PC browser at its exact current pan and zoom, then attaches the image to the tool result.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL, description: "Configured TabletWhiteboard origin or an explicitly allowlisted private origin." },
          boardId: { type: "string", description: "Optional board id. Defaults to the active board." },
          timeoutMs: { type: "number", default: 8000, minimum: 1000, maximum: 15000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "whiteboard_latest_capture",
      description: "Use this when the user asks to see the most recently saved TabletWhiteboard capture without forcing the PC to create a new one. Attaches that PNG to the tool result.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL, description: "Configured TabletWhiteboard origin or an explicitly allowlisted private origin." },
          boardId: { type: "string", description: "Optional board id. Omitting it returns the latest capture across boards." },
          timeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 15000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "whiteboard_capture_list",
      description: "Use this when the user asks which TabletWhiteboard screenshots are saved in the capture album. Returns bounded capture metadata without attaching every image.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL, description: "Configured TabletWhiteboard origin or an explicitly allowlisted private origin." },
          boardId: { type: "string", description: "Optional board id used to filter the album." },
          limit: { type: "number", default: 20, minimum: 1, maximum: 100 },
          timeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 15000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "whiteboard_add_text",
      description: "Write a persistent structured text box in ChatGPT's TabletWhiteboard layer. Use world coordinates; the object is locked, separately hideable, captured, exported, backed up, and undoable.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL },
          boardId: { type: "string", description: "Optional board id. Defaults to the active board." },
          text: { type: "string", minLength: 1, maxLength: 4000 },
          x: { type: "number", default: 48 }, y: { type: "number", default: 48 },
          width: { type: "number", default: 360, minimum: 120, maximum: 2000 },
          height: { type: "number", default: 180, minimum: 64, maximum: 2000 },
          fontSize: { type: "number", default: 22, minimum: 10, maximum: 96 },
          color: { type: "string", default: "#e2e8f0" },
          backgroundColor: { type: "string", default: "rgba(15, 23, 42, 0.92)" },
          timeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 15000 },
        },
        required: ["text"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "whiteboard_add_svg",
      description: "Insert a sanitized SVG as a locked visual object in ChatGPT's TabletWhiteboard layer. Scripts, event handlers, links, external resources, embedded images, CSS and unsafe SVG elements are rejected by the whiteboard server.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL }, boardId: { type: "string" },
          svg: { type: "string", minLength: 11, maxLength: 256000 }, name: { type: "string", default: "diagrama.svg", maxLength: 80 },
          x: { type: "number", default: 48 }, y: { type: "number", default: 48 },
          width: { type: "number", default: 480, minimum: 16, maximum: 4000 }, height: { type: "number", default: 320, minimum: 16, maximum: 4000 },
          viewBoxWidth: { type: "number", minimum: 1, maximum: 10000 }, viewBoxHeight: { type: "number", minimum: 1, maximum: 10000 },
          timeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 15000 },
        },
        required: ["svg"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "whiteboard_add_diagram",
      description: "Create a safe structured diagram in ChatGPT's TabletWhiteboard layer. Supports rect, ellipse, line, arrow, polyline, polygon, text and SVG path elements including quadratic and cubic Bezier commands.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL }, boardId: { type: "string" }, name: { type: "string", default: "diagrama.svg", maxLength: 80 },
          x: { type: "number", default: 48 }, y: { type: "number", default: 48 }, width: { type: "number", default: 640, minimum: 16, maximum: 4000 }, height: { type: "number", default: 420, minimum: 16, maximum: 4000 },
          viewBoxWidth: { type: "number", minimum: 1, maximum: 10000 }, viewBoxHeight: { type: "number", minimum: 1, maximum: 10000 },
          elements: { type: "array", minItems: 1, maxItems: 500, items: { type: "object", additionalProperties: true } },
          timeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 15000 },
        },
        required: ["elements"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "whiteboard_insert_image",
      description: "Insert an existing local PNG, JPEG or WebP file into ChatGPT's TabletWhiteboard layer. The source path must pass Bridge path policy; this tool does not generate an image.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: CONFIGURED_WHITEBOARD_URL }, boardId: { type: "string" }, path: { type: "string", minLength: 1 }, name: { type: "string", maxLength: 80 },
          x: { type: "number", default: 48 }, y: { type: "number", default: 48 }, width: { type: "number", default: 480, minimum: 16, maximum: 4000 }, height: { type: "number", default: 320, minimum: 16, maximum: 4000 },
          timeoutMs: { type: "number", default: 7000, minimum: 1000, maximum: 15000 },
        },
        required: ["path"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ],
  handlers: {
    whiteboard_capture_pc_view: async (args) => {
      const parsed = z.object({
        ...baseInput,
        timeoutMs: z.number().int().min(1000).max(15000).default(8000),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const requestUrl = new URL("api/captures/request", baseUrl);
      const response = await fetchWithTimeout(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ boardId: parsed.boardId, timeoutMs: parsed.timeoutMs }),
      }, parsed.timeoutMs + 2000);
      const payload = await readJson<{ capture: unknown }>(response, "Could not request a fresh TabletWhiteboard capture");
      const capture = assertCapture(payload.capture);
      if (capture.source !== "mcp" || capture.clientKind !== "pc") {
        throw new Error("TabletWhiteboard fresh capture was not produced by the requested PC MCP flow");
      }
      if (parsed.boardId && capture.boardId !== parsed.boardId) {
        throw new Error("TabletWhiteboard fresh capture belongs to a different board");
      }
      const data = await downloadCapture(baseUrl, capture, parsed.timeoutMs);
      return imageResult(baseUrl, capture, data);
    },
    whiteboard_latest_capture: async (args) => {
      const parsed = z.object({
        ...baseInput,
        timeoutMs: z.number().int().min(1000).max(15000).default(5000),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const latestUrl = new URL("api/captures/latest", baseUrl);
      if (parsed.boardId) latestUrl.searchParams.set("boardId", parsed.boardId);
      const payload = await readJson<{ capture: unknown }>(
        await fetchWithTimeout(latestUrl, { method: "GET", headers: { Accept: "application/json" } }, parsed.timeoutMs),
        "Could not read the latest TabletWhiteboard capture",
      );
      const capture = assertCapture(payload.capture);
      const data = await downloadCapture(baseUrl, capture, parsed.timeoutMs);
      return imageResult(baseUrl, capture, data);
    },
    whiteboard_capture_list: async (args) => {
      const parsed = z.object({
        ...baseInput,
        limit: z.number().int().min(1).max(100).default(20),
        timeoutMs: z.number().int().min(1000).max(15000).default(5000),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const listUrl = new URL("api/captures", baseUrl);
      if (parsed.boardId) listUrl.searchParams.set("boardId", parsed.boardId);
      listUrl.searchParams.set("limit", String(parsed.limit));
      const payload = await readJson<{ captures: unknown[] }>(
        await fetchWithTimeout(listUrl, { method: "GET", headers: { Accept: "application/json" } }, parsed.timeoutMs),
        "Could not list TabletWhiteboard captures",
      );
      const captures = z.array(z.unknown()).max(100).parse(payload.captures).map(assertCapture);
      return {
        whiteboardOrigin: baseUrl.origin,
        count: captures.length,
        captures,
      };
    },
    whiteboard_add_text: async (args) => {
      const parsed = z.object({
        ...baseInput,
        text: z.string().trim().min(1).max(4000),
        x: z.number().finite().min(-1_000_000).max(1_000_000).default(48),
        y: z.number().finite().min(-1_000_000).max(1_000_000).default(48),
        width: z.number().finite().min(120).max(2000).default(360),
        height: z.number().finite().min(64).max(2000).default(180),
        fontSize: z.number().finite().min(10).max(96).default(22),
        color: z.string().max(80).default("#e2e8f0"),
        backgroundColor: z.string().max(120).default("rgba(15, 23, 42, 0.92)"),
        timeoutMs: z.number().int().min(1000).max(15000).default(5000),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const boardId = await resolveBoardId(baseUrl, parsed.boardId, parsed.timeoutMs);
      const payload = await postWhiteboardJson(baseUrl, "api/ai/texts", { ...parsed, boardId, baseUrl: undefined, timeoutMs: undefined }, parsed.timeoutMs);
      return { whiteboardOrigin: baseUrl.origin, boardId, ...payload };
    },
    whiteboard_add_svg: async (args) => {
      const parsed = z.object({
        ...baseInput,
        ...placementInput,
        svg: z.string().min(11).max(256000),
        name: z.string().trim().min(1).max(80).default("diagrama.svg"),
        viewBoxWidth: z.number().finite().min(1).max(10000).optional(),
        viewBoxHeight: z.number().finite().min(1).max(10000).optional(),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const boardId = await resolveBoardId(baseUrl, parsed.boardId, parsed.timeoutMs);
      const payload = await postWhiteboardJson(baseUrl, "api/ai/svg", {
        boardId, svg: parsed.svg, name: parsed.name, x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height,
        viewBoxWidth: parsed.viewBoxWidth, viewBoxHeight: parsed.viewBoxHeight,
      }, parsed.timeoutMs);
      return { whiteboardOrigin: baseUrl.origin, boardId, ...payload };
    },
    whiteboard_add_diagram: async (args) => {
      const parsed = z.object({
        ...baseInput,
        ...placementInput,
        name: z.string().trim().min(1).max(80).default("diagrama.svg"),
        viewBoxWidth: z.number().finite().min(1).max(10000).optional(),
        viewBoxHeight: z.number().finite().min(1).max(10000).optional(),
        elements: z.array(z.record(z.unknown())).min(1).max(500),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const boardId = await resolveBoardId(baseUrl, parsed.boardId, parsed.timeoutMs);
      const payload = await postWhiteboardJson(baseUrl, "api/ai/diagrams", {
        boardId, name: parsed.name, x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height,
        viewBoxWidth: parsed.viewBoxWidth, viewBoxHeight: parsed.viewBoxHeight, elements: parsed.elements,
      }, parsed.timeoutMs);
      return { whiteboardOrigin: baseUrl.origin, boardId, ...payload };
    },
    whiteboard_insert_image: async (args) => {
      const parsed = z.object({
        ...baseInput,
        ...placementInput,
        path: z.string().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        timeoutMs: z.number().int().min(1000).max(15000).default(7000),
      }).parse(args);
      const baseUrl = whiteboardBaseUrl(parsed.baseUrl);
      const boardId = await resolveBoardId(baseUrl, parsed.boardId, parsed.timeoutMs);
      const filePath = assertPathAllowed(parsed.path, "read");
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error("Image path must point to a regular file");
      if (stat.size < 1 || stat.size > MAX_ASSET_BYTES) throw new Error("Image must be between 1 byte and 12 MB");
      const extension = path.extname(filePath).toLowerCase();
      const mimeType = INSERTABLE_IMAGE_MIME[extension];
      if (!mimeType) throw new Error("Only PNG, JPEG and WebP files can be inserted into TabletWhiteboard");
      const data = fs.readFileSync(filePath);
      validateInsertableImage(data, mimeType);
      const response = await fetchWithTimeout(new URL("api/ai/images", baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          Accept: "application/json",
          "x-board-id": boardId,
          "x-file-name": encodeURIComponent(parsed.name ?? path.basename(filePath)),
          "x-position-x": String(parsed.x),
          "x-position-y": String(parsed.y),
          "x-display-width": String(parsed.width),
          "x-display-height": String(parsed.height),
        },
        body: data,
      }, parsed.timeoutMs);
      const payload = await readJson<Record<string, unknown>>(response, "TabletWhiteboard rejected the image insertion");
      return {
        whiteboardOrigin: baseUrl.origin,
        boardId,
        source: { path: filePath, mimeType, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") },
        ...payload,
      };
    },
  },
};
