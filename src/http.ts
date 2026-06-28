#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBridgeServer, SERVER_NAME, SERVER_VERSION } from "./bridge-server.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;
const HOST = process.env.BRIDGE_MCP_HTTP_HOST || DEFAULT_HOST;
const PORT = Number(process.env.BRIDGE_MCP_HTTP_PORT || DEFAULT_PORT);
const MCP_PATH = process.env.BRIDGE_MCP_HTTP_PATH || "/mcp";

let ready = false;
let closing = false;

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

async function main() {
  const mcpServer = createBridgeServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);
  ready = true;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

      if (req.method === "GET" && url.pathname === "/healthz") {
        sendText(res, 200, "live");
        return;
      }

      if (req.method === "GET" && url.pathname === "/readyz") {
        sendText(res, ready && !closing ? 200 : 503, ready && !closing ? "ready" : "not ready");
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, ready && !closing ? 200 : 503, {
          server: { name: SERVER_NAME, version: SERVER_VERSION },
          transport: "streamable-http",
          mcpPath: MCP_PATH,
          host: HOST,
          port: PORT,
          ready,
          closing,
          uptimeSeconds: Math.round(process.uptime()),
          pid: process.pid,
          node: process.version,
        });
        return;
      }

      if (url.pathname === MCP_PATH) {
        const accept = String(req.headers.accept || "");
        if (req.method === "GET" && !accept.includes("text/event-stream")) {
          sendJson(res, 405, {
            error: "method_not_allowed",
            message: "GET MCP streams require Accept: text/event-stream. Use POST for JSON-RPC requests.",
          });
          return;
        }

        await transport.handleRequest(req, res);
        return;
      }

      sendJson(res, 404, {
        error: "not_found",
        routes: ["GET /healthz", "GET /readyz", "GET /status", `${MCP_PATH} MCP Streamable HTTP`],
      });
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        res.end();
      }
    }
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    ready = false;
    console.error(`[${SERVER_NAME}] received ${signal}, shutting down HTTP transport`);
    httpServer.close(async () => {
      await transport.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    ready = false;
    console.error(`[${SERVER_NAME}] HTTP server error`, error.message);
    if (error.code === "EADDRINUSE") {
      console.error(`[${SERVER_NAME}] Port already in use: ${HOST}:${PORT}`);
    }
    process.exit(1);
  });

  httpServer.listen(PORT, HOST, () => {
    console.error(`[${SERVER_NAME}] HTTP MCP ${SERVER_VERSION} listening on http://${HOST}:${PORT}${MCP_PATH}`);
    console.error(`[${SERVER_NAME}] health: http://${HOST}:${PORT}/healthz ready: http://${HOST}:${PORT}/readyz status: http://${HOST}:${PORT}/status`);
  });
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal`, error);
  process.exit(1);
});
