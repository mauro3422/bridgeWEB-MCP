#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBridgeServer } from "./bridge-server.js";
import { getBridgeHttpConfig, SERVER_NAME, SERVER_VERSION } from "./config.js";

const config = getBridgeHttpConfig();
const startedAt = new Date();

let ready = false;
let closing = false;

type BridgeHttpTransport = StreamableHTTPServerTransport & { sessionId?: string };

const transports = new Map<string, BridgeHttpTransport>();
const anonymousTransports = new Set<BridgeHttpTransport>();

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
    sessions: transports.size,
    anonymousTransports: anonymousTransports.size,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    node: process.version,
  };
}

async function createTransport(requestId: string): Promise<BridgeHttpTransport> {
  const mcpServer = createBridgeServer();
  let transport: BridgeHttpTransport;

  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      transports.set(sessionId, transport);
      anonymousTransports.delete(transport);
      log("info", "MCP HTTP session initialized", { requestId, sessionId, sessions: transports.size });
    },
  }) as BridgeHttpTransport;

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    anonymousTransports.delete(transport);
    if (sessionId) transports.delete(sessionId);
    log("info", "MCP HTTP transport closed", { requestId, sessionId, sessions: transports.size });
  };

  anonymousTransports.add(transport);
  await mcpServer.connect(transport);
  return transport;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const sessionId = getMcpSessionId(req);
  let transport: BridgeHttpTransport | undefined;

  if (sessionId) {
    transport = transports.get(sessionId);
    if (!transport) {
      sendJson(res, 404, {
        error: "mcp_session_not_found",
        requestId,
        sessionId,
        message: "Unknown or expired MCP session. Start a new initialize request without MCP-Session-Id.",
      });
      return;
    }
  } else if (req.method === "POST") {
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
  }
}

async function main() {
  ready = true;

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
    log("warn", "shutdown requested", { signal });

    httpServer.close(async () => {
      await Promise.allSettled([
        ...Array.from(transports.values()).map((transport) => transport.close()),
        ...Array.from(anonymousTransports).map((transport) => transport.close()),
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
    });
  });
}

main().catch((error) => {
  log("error", "fatal startup error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
