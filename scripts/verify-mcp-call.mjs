const [toolName, rawArgs = "{}", ...expectedFragments] = process.argv.slice(2);
if (!toolName) {
  console.error("usage: node scripts/verify-mcp-call.mjs <toolName> <jsonArgs> [expectedFragment...]");
  process.exit(2);
}

const base = process.env.BRIDGE_MCP_VERIFY_BASE || "http://127.0.0.1:3001/mcp";
const args = JSON.parse(rawArgs);
const commonHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

let sessionId;
let failureCode = 0;

try {
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

  const initResponse = await fetch(base, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify(init),
  });
  sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;
  await initResponse.text();
  if (!initResponse.ok || !sessionId) {
    failureCode = 3;
    throw new Error(`initialize failed status=${initResponse.status} session=${sessionId ?? "missing"}`);
  }

  const callResponse = await fetch(base, {
    method: "POST",
    headers: { ...commonHeaders, "Mcp-Session-Id": sessionId },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const text = await callResponse.text();
  if (!callResponse.ok) {
    failureCode = 4;
    throw new Error(text || `tool call failed status=${callResponse.status}`);
  }

  const missing = expectedFragments.filter((fragment) => !text.includes(fragment));
  if (missing.length > 0) {
    failureCode = 5;
    throw new Error(`missing fragments: ${missing.join(",")}\n${text.slice(-4000)}`);
  }

  console.log(`${toolName} reachable`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = failureCode || 1;
} finally {
  if (sessionId) {
    try {
      const closeResponse = await fetch(base, {
        method: "DELETE",
        headers: {
          Accept: "application/json, text/event-stream",
          "Mcp-Session-Id": sessionId,
        },
      });
      await closeResponse.text();
      if (!closeResponse.ok) {
        console.error(`session close failed status=${closeResponse.status} session=${sessionId}`);
        if (!process.exitCode) process.exitCode = 6;
      }
    } catch (error) {
      console.error(`session close failed session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      if (!process.exitCode) process.exitCode = 6;
    }
  }
}
