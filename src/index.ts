#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridgeServer, SERVER_NAME } from "./bridge-server.js";

async function main() {
  const server = createBridgeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal`, error);
  process.exit(1);
});
