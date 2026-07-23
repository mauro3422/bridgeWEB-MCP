#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridgeServer, SERVER_NAME } from "./bridge-server.js";
import { closeRobloxMcpConnection } from "./integrations/roblox-mcp-client.js";

async function main() {
  const server = createBridgeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await closeRobloxMcpConnection().catch(() => undefined);
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal`, error);
  process.exit(1);
});
