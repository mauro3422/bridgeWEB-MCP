import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: "C:/dev/bridge-mcp",
});

const client = new Client(
  { name: "bridge-mcp-smoke", version: "0.2.0" },
  { capabilities: {} }
);

await client.connect(transport);
const getJson = (result) => JSON.parse(result.content?.[0]?.text ?? "{}");
const tools = await client.listTools();
console.log("TOOLS", tools.tools.map((tool) => tool.name).join(","));

const commandResult = await client.callTool({
  name: "run_command",
  arguments: { command: "node --version", cwd: "C:/dev/bridge-mcp", timeoutMs: 10000 },
});
const commandJson = getJson(commandResult);
console.log("RUN_COMMAND_CODE", commandJson.code);
console.log("RUN_COMMAND_STDOUT", String(commandJson.stdout ?? "").trim());

const testFile = "C:/dev/bridge-mcp/.smoke-test.txt";
await client.callTool({
  name: "write_text_file",
  arguments: { path: testFile, content: "alpha\nbeta\n" },
});
const patchResult = await client.callTool({
  name: "apply_patch",
  arguments: {
    path: testFile,
    oldText: "beta",
    newText: "gamma",
    expectedReplacements: 1,
  },
});
console.log("APPLY_PATCH", getJson(patchResult).replacements);

const termStart = getJson(await client.callTool({
  name: "terminal_start",
  arguments: { command: "powershell.exe -NoLogo -NoProfile", cwd: "C:/dev/bridge-mcp" },
}));
console.log("TERM_ID", termStart.id);
await client.callTool({
  name: "terminal_write",
  arguments: { sessionId: termStart.id, input: "Write-Output ('TERM_OK ' + (6*7))\n" },
});
await new Promise((resolve) => setTimeout(resolve, 700));
const termRead = getJson(await client.callTool({
  name: "terminal_read",
  arguments: { sessionId: termStart.id, maxChars: 4000 },
}));
console.log("TERM_HAS_OK", String(termRead.stdout ?? "").includes("TERM_OK 42"));
await client.callTool({ name: "terminal_stop", arguments: { sessionId: termStart.id } });
await client.close();
