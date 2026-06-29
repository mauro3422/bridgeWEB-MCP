const [toolName, rawArgs = "{}", ...expectedFragments] = process.argv.slice(2);
if (!toolName) {
  console.error("usage: node scripts/verify-mcp-call.mjs <toolName> <jsonArgs> [expectedFragment...]");
  process.exit(2);
}

const base = "http://127.0.0.1:3001/mcp";
const args = JSON.parse(rawArgs);

const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-mcp-call", version: "0.1.0" },
  },
};

const commonHeaders = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

const initResponse = await fetch(base, { method: "POST", headers: commonHeaders, body: JSON.stringify(init) });
const sessionId = initResponse.headers.get("mcp-session-id");
await initResponse.text();
if (!initResponse.ok || !sessionId) {
  console.error(`initialize failed status=${initResponse.status} session=${sessionId ?? "missing"}`);
  process.exit(3);
}

const callResponse = await fetch(base, {
  method: "POST",
  headers: { ...commonHeaders, "Mcp-Session-Id": sessionId },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } }),
});
const text = await callResponse.text();
if (!callResponse.ok) {
  console.error(text);
  process.exit(4);
}
const missing = expectedFragments.filter((fragment) => !text.includes(fragment));
if (missing.length > 0) {
  console.error(`missing fragments: ${missing.join(",")}`);
  console.error(text.slice(-4000));
  process.exit(5);
}
console.log(`${toolName} reachable`);
