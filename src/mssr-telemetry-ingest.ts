import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mssrHostCallEnvelopeSchema } from "@mauroprime/mssr";
import { recordExternalMssrTelemetry, resolveExternalMssrRouteTrace } from "./mssr-observatory.js";
import { beginToolMetric, finishToolMetric, hasObservedToolCall, resolveObservedSessionTrace } from "./metrics.js";

const DEFAULT_TOKEN_PATH = path.resolve(process.cwd(), "data", "mssr-ingest.token");

export function getMssrTelemetryTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.BRIDGE_MCP_MSSR_INGEST_TOKEN_FILE || DEFAULT_TOKEN_PATH);
}

export function ensureMssrTelemetryToken(env: NodeJS.ProcessEnv = process.env): string {
  const tokenPath = getMssrTelemetryTokenPath(env);
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  if (!fs.existsSync(tokenPath)) {
    try {
      fs.writeFileSync(tokenPath, randomBytes(32).toString("hex"), { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!fs.existsSync(tokenPath)) throw error;
    }
  }
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  if (!/^[a-f0-9]{64,128}$/i.test(token)) throw new Error("Bridge MSSR ingest token file is invalid.");
  return token;
}

export function authorizeMssrTelemetry(authorization: string | string[] | undefined): boolean {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(raw.slice("Bearer ".length).trim(), "utf8");
  const expected = Buffer.from(ensureMssrTelemetryToken(), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function ingestMssrTelemetry(payload: unknown) {
  const hostCall = mssrHostCallEnvelopeSchema.safeParse(payload);
  if (hostCall.success) {
    const envelope = hostCall.data;
    if (hasObservedToolCall(envelope.host.callKey)) {
      return {
        accepted: true,
        duplicate: true,
        traceId: envelope.traceId ?? null,
        eventId: envelope.eventId,
        eventType: "host_tool_call",
        occurredAt: envelope.emittedAt,
        privacy: "No raw prompt, transcript, arguments, output, error text, secret, or private reasoning stored.",
      };
    }
    const bootstrap = envelope.tool.name.startsWith("mssr_");
    const correlatedTrace = envelope.traceId
      ?? (bootstrap ? resolveExternalMssrRouteTrace(envelope.tool.startedAt, envelope.tool.endedAt, envelope.caller) : undefined)
      ?? resolveObservedSessionTrace(envelope.host.sessionKey);
    const metric = beginToolMetric(envelope.tool.name, {}, {
      caller: envelope.caller,
      clientName: "opencode-cli",
      traceId: correlatedTrace,
      model: envelope.host.model,
      reasoningEffort: envelope.host.reasoningEffort,
      sessionKey: envelope.host.sessionKey,
      parentSessionKey: envelope.host.parentSessionKey,
      project: envelope.host.project,
      hostAgent: envelope.host.agent,
      hostVariant: envelope.host.variant,
      messageKey: envelope.host.messageKey,
      callKey: envelope.host.callKey,
      projectKey: envelope.host.projectKey,
      routingStatus: bootstrap ? "bootstrap" : correlatedTrace ? "traced" : "unrouted",
    });
    metric.id = envelope.eventId;
    metric.startedAtIso = envelope.tool.startedAt;
    metric.startedAtMs = Date.parse(envelope.tool.endedAt) - envelope.tool.durationMs;
    finishToolMetric(
      metric,
      envelope.tool.status === "success",
      0,
      undefined,
      { resultOk: envelope.tool.status === "success", resultStatus: envelope.tool.status === "success" ? "success" : "failed" },
      new Date(envelope.tool.endedAt),
    );
    return {
      accepted: true,
      duplicate: false,
      traceId: correlatedTrace ?? null,
      eventId: envelope.eventId,
      eventType: "host_tool_call",
      occurredAt: envelope.emittedAt,
      privacy: "No raw prompt, transcript, arguments, output, error text, secret, or private reasoning stored.",
    };
  }
  let result: ReturnType<typeof recordExternalMssrTelemetry>;
  try {
    result = recordExternalMssrTelemetry(payload);
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      throw Object.assign(new Error("Invalid MSSR telemetry envelope."), { statusCode: 400 });
    }
    throw error;
  }
  return {
    accepted: true,
    duplicate: result.duplicate,
    traceId: result.event.traceId,
    eventId: result.event.id,
    eventType: result.event.eventType,
    occurredAt: result.event.occurredAt,
    privacy: "No raw prompt, transcript, secret, or private reasoning stored.",
  };
}
