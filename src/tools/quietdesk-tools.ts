import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

const DEFAULT_QUIETDESK_BASE_URL = "http://127.0.0.1:17819";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ERROR_CHARS = 2_000;

const boundedId = z.string().min(1).max(1_024);
const optionalId = z.string().min(1).max(1_024).optional();
const probability = z.number().min(0).max(1);

const sessionPolicySchema = z.object({
  disturbance: z.enum(["silent", "polite", "interactive", "exclusive"]),
  autonomy: z.enum(["observe_only", "bounded", "autonomous"]),
  allowConsequential: z.boolean().optional(),
  pauseOnUserActivity: z.boolean().optional(),
  maxForegroundMs: z.number().int().min(0).max(60_000).optional(),
}).strict();

const semanticSelectionSchema = z.object({
  operationId: boundedId,
  targetId: boundedId,
  targetFreshnessToken: boundedId,
}).strict();

const decisionTelemetrySchema = z.object({
  provider: z.enum(["deterministic", "structured_jev", "visual_region", "large_model"]).optional(),
  decisionId: boundedId.optional(),
  confidence: probability.optional(),
  margin: probability.optional(),
  evidenceRefs: z.array(z.string().min(1).max(4_096)).max(32).optional(),
  screenshotRefs: z.array(z.string().min(1).max(4_096)).max(32).optional(),
}).strict();

const semanticPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().max(32_768) }).strict(),
]);

const semanticExecuteSchema = z.object({
  windowRef: boundedId,
  selection: semanticSelectionSchema,
  policy: sessionPolicySchema,
  sessionId: optionalId,
  decision: decisionTelemetrySchema.optional(),
  payload: semanticPayloadSchema.optional(),
}).strict();

export type QuietDeskToolModuleOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

function normalizeLoopbackBaseUrl(value: string): string {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)) {
    throw new Error("QuietDesk Bridge adapter accepts only loopback HTTP origins.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("QuietDesk base URL must be a bare loopback origin without credentials, path, query, or fragment.");
  }
  return parsed.origin;
}

async function quietDeskRequest(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
  timeoutMs: number,
  route: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${route}`, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, MAX_ERROR_CHARS);
      throw new Error(`QuietDesk HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`QuietDesk request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function queryRoute(pathname: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return query.size > 0 ? `${pathname}?${query.toString()}` : pathname;
}

const windowRefProperty = { type: "string", minLength: 1, maxLength: 1024 } as const;
const sessionIdProperty = { type: "string", minLength: 1, maxLength: 1024 } as const;

export function createQuietDeskToolModule(options: QuietDeskToolModuleOptions = {}): BridgeToolModule {
  const baseUrl = normalizeLoopbackBaseUrl(options.baseUrl ?? DEFAULT_QUIETDESK_BASE_URL);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("QuietDesk Bridge adapter requires fetch support.");
  const timeoutMs = z.number().int().min(250).max(60_000).parse(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const get = (route: string) => quietDeskRequest(fetchImpl, baseUrl, timeoutMs, route, { method: "GET" });
  const post = (route: string, body: unknown) => quietDeskRequest(fetchImpl, baseUrl, timeoutMs, route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    name: "quietdesk",
    tools: [
      {
        name: "quietdesk_status",
        description: "Check the local QuietDesk daemon, platform, user-presence state, and current foreground window. This is the preferred preflight before other QuietDesk tools.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "quietdesk_desktop_snapshot",
        description: "Read QuietDesk's passive semantic desktop snapshot without taking focus. Optionally scope observation to one previously issued windowRef.",
        inputSchema: {
          type: "object",
          properties: { windowRef: windowRefProperty },
          additionalProperties: false,
        },
      },
      {
        name: "quietdesk_desktop_coverage",
        description: "Report whether QuietDesk semantic/UIA coverage for a window is usable, partial, or unavailable, including whether visual escalation is recommended.",
        inputSchema: {
          type: "object",
          properties: { windowRef: windowRefProperty, sessionId: sessionIdProperty },
          additionalProperties: false,
        },
      },
      {
        name: "quietdesk_desktop_candidates",
        description: "Read the bounded semantic operation and target IDs currently issued by QuietDesk. Use these IDs rather than inventing controls or coordinates.",
        inputSchema: {
          type: "object",
          properties: { windowRef: windowRefProperty },
          additionalProperties: false,
        },
      },
      {
        name: "quietdesk_desktop_semantic_context",
        description: "Read one fresh QuietDesk semantic observation bundle containing both snapshot and candidate tables for an exact windowRef.",
        inputSchema: {
          type: "object",
          properties: { windowRef: windowRefProperty },
          required: ["windowRef"],
          additionalProperties: false,
        },
      },
      {
        name: "quietdesk_desktop_capture",
        description: "Ask QuietDesk for a bounded background capture of one issued windowRef without stealing focus. Returns the exact local artifact path and SHA-256; pass those to image_file_attach to inspect the original PNG in ChatGPT without manual base64 conversion.",
        inputSchema: {
          type: "object",
          properties: {
            windowRef: windowRefProperty,
            ttlMs: { type: "integer", minimum: 250, maximum: 30000 },
          },
          required: ["windowRef"],
          additionalProperties: false,
        },
      },
      {
        name: "quietdesk_runtime_telemetry",
        description: "Read bounded QuietDesk QA telemetry for disturbance, semantic coverage, and recent execution evidence. Prepared text payload values and secrets remain outside this report by QuietDesk design.",
        inputSchema: {
          type: "object",
          properties: { sessionId: sessionIdProperty },
          additionalProperties: false,
        },
      },
      {
        name: "quietdesk_execute_semantic",
        description: "Execute exactly one bounded QuietDesk semantic operation against a previously issued target ID and freshness token. QuietDesk remains the policy/execution authority: stale selections, disallowed disturbance/autonomy, and unsupported operations fail closed.",
        inputSchema: {
          type: "object",
          properties: {
            windowRef: windowRefProperty,
            selection: {
              type: "object",
              properties: {
                operationId: { type: "string", minLength: 1, maxLength: 1024 },
                targetId: { type: "string", minLength: 1, maxLength: 1024 },
                targetFreshnessToken: { type: "string", minLength: 1, maxLength: 1024 },
              },
              required: ["operationId", "targetId", "targetFreshnessToken"],
              additionalProperties: false,
            },
            policy: {
              type: "object",
              properties: {
                disturbance: { type: "string", enum: ["silent", "polite", "interactive", "exclusive"] },
                autonomy: { type: "string", enum: ["observe_only", "bounded", "autonomous"] },
                allowConsequential: { type: "boolean" },
                pauseOnUserActivity: { type: "boolean" },
                maxForegroundMs: { type: "integer", minimum: 0, maximum: 60000 },
              },
              required: ["disturbance", "autonomy"],
              additionalProperties: false,
            },
            sessionId: sessionIdProperty,
            decision: {
              type: "object",
              properties: {
                provider: { type: "string", enum: ["deterministic", "structured_jev", "visual_region", "large_model"] },
                decisionId: { type: "string", minLength: 1, maxLength: 1024 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                margin: { type: "number", minimum: 0, maximum: 1 },
                evidenceRefs: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 4096 } },
                screenshotRefs: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 4096 } },
              },
              additionalProperties: false,
            },
            payload: {
              oneOf: [
                { type: "object", properties: { kind: { const: "none" } }, required: ["kind"], additionalProperties: false },
                { type: "object", properties: { kind: { const: "text" }, value: { type: "string", maxLength: 32768 } }, required: ["kind", "value"], additionalProperties: false },
              ],
            },
          },
          required: ["windowRef", "selection", "policy"],
          additionalProperties: false,
        },
      },
    ],
    handlers: {
      quietdesk_status: async (args) => {
        z.object({}).strict().parse(args);
        return await get("/health");
      },
      quietdesk_desktop_snapshot: async (args) => {
        const parsed = z.object({ windowRef: optionalId }).strict().parse(args);
        return await get(queryRoute("/v1/desktop/snapshot", { windowRef: parsed.windowRef }));
      },
      quietdesk_desktop_coverage: async (args) => {
        const parsed = z.object({ windowRef: optionalId, sessionId: optionalId }).strict().parse(args);
        return await get(queryRoute("/v1/desktop/coverage", parsed));
      },
      quietdesk_desktop_candidates: async (args) => {
        const parsed = z.object({ windowRef: optionalId }).strict().parse(args);
        return await get(queryRoute("/v1/desktop/candidates", { windowRef: parsed.windowRef }));
      },
      quietdesk_desktop_semantic_context: async (args) => {
        const parsed = z.object({ windowRef: boundedId }).strict().parse(args);
        return await get(queryRoute("/v1/desktop/semantic-context", { windowRef: parsed.windowRef }));
      },
      quietdesk_desktop_capture: async (args) => {
        const parsed = z.object({
          windowRef: boundedId,
          ttlMs: z.number().int().min(250).max(30_000).optional(),
        }).strict().parse(args);
        return await post("/v1/desktop/capture", parsed);
      },
      quietdesk_runtime_telemetry: async (args) => {
        const parsed = z.object({ sessionId: optionalId }).strict().parse(args);
        return await get(queryRoute("/v1/telemetry/runtime", { sessionId: parsed.sessionId }));
      },
      quietdesk_execute_semantic: async (args) => {
        const parsed = semanticExecuteSchema.parse(args);
        return await post("/v1/desktop/execute", { payload: { kind: "none" }, ...parsed });
      },
    },
  };
}

export const quietDeskToolModule = createQuietDeskToolModule();
