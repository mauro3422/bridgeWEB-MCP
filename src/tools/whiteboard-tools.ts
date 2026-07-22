import crypto from "node:crypto";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

const DEFAULT_WHITEBOARD_URL = "http://127.0.0.1:8787";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
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

function whiteboardBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:") throw new Error("TabletWhiteboard baseUrl must use http://");
  if (url.username || url.password) throw new Error("TabletWhiteboard baseUrl must not include credentials");
  if (!isPrivateHostname(url.hostname)) throw new Error("TabletWhiteboard baseUrl must point to localhost or a private LAN address");
  if (url.search || url.hash) throw new Error("TabletWhiteboard baseUrl must not include query parameters or a fragment");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("TabletWhiteboard baseUrl must not include an application path");
  url.pathname = "/";
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
    createdAt: z.string().datetime(),
  });
  return schema.parse(value);
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
  if (data.length < PNG_SIGNATURE.length || data.length > MAX_IMAGE_BYTES || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("TabletWhiteboard returned an invalid PNG capture");
  }
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
  baseUrl: z.string().url().default(DEFAULT_WHITEBOARD_URL),
  boardId: z.string().min(1).max(180).optional(),
};

export const whiteboardToolModule: BridgeToolModule = {
  name: "tablet-whiteboard",
  tools: [
    {
      name: "whiteboard_capture_pc_view",
      description: "Use this when the user asks you to look at, inspect, read, or review what is currently visible in TabletWhiteboard. Requests a fresh PNG from the connected PC browser at its exact current pan and zoom, then attaches the image to the tool result.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: DEFAULT_WHITEBOARD_URL, description: "Local or private-LAN TabletWhiteboard origin." },
          boardId: { type: "string", description: "Optional board id. Defaults to the active board." },
          timeoutMs: { type: "number", default: 8000, minimum: 1000, maximum: 15000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "whiteboard_latest_capture",
      description: "Use this when the user asks to see the most recently saved TabletWhiteboard capture without forcing the PC to create a new one. Attaches that PNG to the tool result.",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string", default: DEFAULT_WHITEBOARD_URL, description: "Local or private-LAN TabletWhiteboard origin." },
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
          baseUrl: { type: "string", default: DEFAULT_WHITEBOARD_URL, description: "Local or private-LAN TabletWhiteboard origin." },
          boardId: { type: "string", description: "Optional board id used to filter the album." },
          limit: { type: "number", default: 20, minimum: 1, maximum: 100 },
          timeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 15000 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
  },
};
