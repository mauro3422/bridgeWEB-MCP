#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBridgeServer } from "./bridge-server.js";
import { getBridgeHttpConfig, SERVER_NAME, SERVER_VERSION } from "./config.js";

const config = getBridgeHttpConfig();
const startedAt = new Date();

const SESSION_IDLE_MS = getPositiveIntEnv("BRIDGE_MCP_HTTP_SESSION_IDLE_MS", 30 * 60 * 1000);
const ANONYMOUS_TRANSPORT_TTL_MS = getPositiveIntEnv("BRIDGE_MCP_HTTP_ANON_TTL_MS", 60 * 1000);
const MAX_SESSIONS = getPositiveIntEnv("BRIDGE_MCP_HTTP_MAX_SESSIONS", 64);
const CLEANUP_INTERVAL_MS = getPositiveIntEnv("BRIDGE_MCP_HTTP_CLEANUP_INTERVAL_MS", 60 * 1000);

let ready = false;
let closing = false;

type BridgeHttpTransport = StreamableHTTPServerTransport & { sessionId?: string };
type SessionRecord = {
  transport: BridgeHttpTransport;
  createdAtMs: number;
  lastSeenMs: number;
};

const sessions = new Map<string, SessionRecord>();
const anonymousTransports = new Map<BridgeHttpTransport, number>();

function getPositiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function log(level: "info" | "warn" | "error", message: string, extra: Record<string, unknown> = {}) {
  const event = { ts: nowIso(), level, component: "bridge-http", message, ...extra };
  const line = JSON.stringify(event);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

function sendText(res: ServerResponse, statusCode: number, text: string) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function sendJson(res: ServerResponse, statusCode: number, data: Record<string, unknown>) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data, null, 2));
}

function isMcpStreamRequest(req: IncomingMessage): boolean {
  return String(req.headers.accept || "").includes("text/event-stream");
}

function getMcpSessionId(req: IncomingMessage): string | undefined {
  const header = req.headers["mcp-session-id"];
  if (Array.isArray(header)) return header[0];
  if (typeof header === "string" && header.trim().length > 0) return header.trim();
  return undefined;
}

function getStatus() {
  return {
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    transport: "streamable-http",
    mcpPath: config.mcpPath,
    host: config.host,
    port: config.port,
    allowRemote: config.allowRemote,
    ready,
    closing,
    sessions: sessions.size,
    anonymousTransports: anonymousTransports.size,
    limits: {
      maxSessions: MAX_SESSIONS,
      sessionIdleMs: SESSION_IDLE_MS,
      anonymousTransportTtlMs: ANONYMOUS_TRANSPORT_TTL_MS,
      cleanupIntervalMs: CLEANUP_INTERVAL_MS,
    },
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    node: process.version,
  };
}

async function closeTransport(transport: BridgeHttpTransport, reason: string, sessionId?: string) {
  const effectiveSessionId = sessionId || transport.sessionId;
  anonymousTransports.delete(transport);
  if (effectiveSessionId) sessions.delete(effectiveSessionId);

  try {
    await transport.close();
  } catch (error) {
    log("warn", "MCP HTTP transport close failed", {
      reason,
      sessionId: effectiveSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupTransports(reason = "periodic") {
  const now = Date.now();
  const closePromises: Promise<void>[] = [];

  for (const [sessionId, record] of sessions) {
    if (now - record.lastSeenMs > SESSION_IDLE_MS) {
      log("info", "Closing idle MCP HTTP session", { reason, sessionId, idleMs: now - record.lastSeenMs });
      closePromises.push(closeTransport(record.transport, "idle-session", sessionId));
    }
  }

  const sessionEntries = Array.from(sessions.entries()).sort((a, b) => a[1].lastSeenMs - b[1].lastSeenMs);
  while (sessionEntries.length > MAX_SESSIONS) {
    const next = sessionEntries.shift();
    if (!next) break;
    const [sessionId, record] = next;
    if (!sessions.has(sessionId)) continue;
    log("warn", "Closing oldest MCP HTTP session over limit", { reason, sessionId, maxSessions: MAX_SESSIONS });
    closePromises.push(closeTransport(record.transport, "session-limit", sessionId));
  }

  for (const [transport, createdAtMs] of anonymousTransports) {
    if (now - createdAtMs > ANONYMOUS_TRANSPORT_TTL_MS) {
      log("warn", "Closing stale anonymous MCP HTTP transport", { reason, ageMs: now - createdAtMs });
      closePromises.push(closeTransport(transport, "stale-anonymous"));
    }
  }

  await Promise.allSettled(closePromises);
}

async function createTransport(requestId: string): Promise<BridgeHttpTransport> {
  await cleanupTransports("before-create");

  const mcpServer = createBridgeServer();
  let transport: BridgeHttpTransport;

  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      const now = Date.now();
      sessions.set(sessionId, { transport, createdAtMs: now, lastSeenMs: now });
      anonymousTransports.delete(transport);
      log("info", "MCP HTTP session initialized", { requestId, sessionId, sessions: sessions.size });
    },
  }) as BridgeHttpTransport;

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    anonymousTransports.delete(transport);
    if (sessionId) sessions.delete(sessionId);
    log("info", "MCP HTTP transport closed", { requestId, sessionId, sessions: sessions.size });
  };

  anonymousTransports.set(transport, Date.now());
  await mcpServer.connect(transport);
  return transport;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const sessionId = getMcpSessionId(req);
  let transport: BridgeHttpTransport | undefined;
  let createdForThisRequest = false;

  if (sessionId) {
    const record = sessions.get(sessionId);
    if (!record) {
      sendJson(res, 404, {
        error: "mcp_session_not_found",
        requestId,
        sessionId,
        message: "Unknown or expired MCP session. Start a new initialize request without MCP-Session-Id.",
      });
      return;
    }
    record.lastSeenMs = Date.now();
    transport = record.transport;
  } else if (req.method === "POST") {
    createdForThisRequest = true;
    transport = await createTransport(requestId);
  } else {
    sendJson(res, 400, {
      error: "mcp_session_required",
      requestId,
      message: "GET and DELETE MCP requests require an MCP-Session-Id header.",
    });
    return;
  }

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    log("error", "MCP request failed", {
      requestId,
      method: req.method,
      url: req.url,
      sessionId,
      transportSessionId: transport.sessionId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!res.headersSent) {
      sendJson(res, 500, {
        requestId,
        error: "mcp_request_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } else {
      res.end();
    }
  } finally {
    if (createdForThisRequest && !transport.sessionId && anonymousTransports.has(transport)) {
      await closeTransport(transport, "uninitialized-request");
    }
  }
}

async function main() {
  ready = true;

  const cleanupTimer = setInterval(() => {
    cleanupTransports().catch((error) => {
      log("warn", "transport cleanup failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader("x-bridge-request-id", requestId);

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);

      if (req.method === "GET" && url.pathname === "/healthz") {
        sendText(res, 200, "live");
        return;
      }

      if (req.method === "GET" && url.pathname === "/readyz") {
        sendText(res, ready && !closing ? 200 : 503, ready && !closing ? "ready" : "not ready");
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, ready && !closing ? 200 : 503, getStatus());
        return;
      }

      if (url.pathname === config.mcpPath) {
        if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
          sendJson(res, 405, {
            error: "method_not_allowed",
            requestId,
            allowedMethods: ["GET", "POST", "DELETE"],
          });
          return;
        }

        if (req.method === "GET" && !isMcpStreamRequest(req)) {
          sendJson(res, 405, {
            error: "method_not_allowed",
            requestId,
            message: "GET MCP streams require Accept: text/event-stream. Use POST for JSON-RPC requests.",
          });
          return;
        }

        await handleMcpRequest(req, res, requestId);
        return;
      }

      sendJson(res, 404, {
        error: "not_found",
        requestId,
        routes: ["GET /healthz", "GET /readyz", "GET /status", `${config.mcpPath} MCP Streamable HTTP`],
      });
    } catch (error) {
      log("error", "request failed", {
        requestId,
        method: req.method,
        url: req.url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      if (!res.headersSent) {
        sendJson(res, 500, { requestId, error: error instanceof Error ? error.message : String(error) });
      } else {
        res.end();
      }
    }
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    ready = false;
    clearInterval(cleanupTimer);
    log("warn", "shutdown requested", { signal });

    httpServer.close(async () => {
      await Promise.allSettled([
        ...Array.from(sessions.entries()).map(([sessionId, record]) => closeTransport(record.transport, "shutdown", sessionId)),
        ...Array.from(anonymousTransports.keys()).map((transport) => closeTransport(transport, "shutdown")),
      ]);
      log("info", "shutdown complete", { signal });
      process.exit(0);
    });

    setTimeout(() => {
      log("error", "forced shutdown timeout exceeded", { signal });
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.on("uncaughtException", (error) => {
    ready = false;
    log("error", "uncaught exception", { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    ready = false;
    log("error", "unhandled rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
    process.exit(1);
  });

  httpServer.on("clientError", (error, socket) => {
    log("warn", "client error", { error: error.message });
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    ready = false;
    log("error", "HTTP server error", { error: error.message, code: error.code });
    if (error.code === "EADDRINUSE") {
      log("error", "port already in use", { host: config.host, port: config.port });
    }
    process.exit(1);
  });

  httpServer.listen(config.port, config.host, () => {
    log("info", "HTTP MCP listening", {
      server: { name: SERVER_NAME, version: SERVER_VERSION },
      url: `http://${config.host}:${config.port}${config.mcpPath}`,
      healthz: `http://${config.host}:${config.port}/healthz`,
      readyz: `http://${config.host}:${config.port}/readyz`,
      status: `http://${config.host}:${config.port}/status`,
      limits: {
        maxSessions: MAX_SESSIONS,
        sessionIdleMs: SESSION_IDLE_MS,
        anonymousTransportTtlMs: ANONYMOUS_TRANSPORT_TTL_MS,
      },
    });
  });
}

main().catch((error) => {
  log("error", "fatal startup error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
