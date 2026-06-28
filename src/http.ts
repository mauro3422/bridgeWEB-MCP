#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBridgeServer } from "./bridge-server.js";
import { getBridgeHttpConfig, SERVER_NAME, SERVER_VERSION } from "./config.js";

const config = getBridgeHttpConfig();
const startedAt = new Date();

let ready = false;
let closing = false;

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
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    node: process.version,
  };
}

async function main() {
  const mcpServer = createBridgeServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);
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

        await transport.handleRequest(req, res);
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
      await transport.close();
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
