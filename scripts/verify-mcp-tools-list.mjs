const expectedTools = process.argv.slice(2);
if (expectedTools.length === 0) {
  console.error("usage: node scripts/verify-mcp-tools-list.mjs <toolName...>");
  process.exit(2);
}

const base = process.env.BRIDGE_MCP_VERIFY_BASE || "http://127.0.0.1:3001/mcp";
const commonHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

let sessionId;
let failureCode = 0;

try {
  const initResponse = await fetch(base, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verify-mcp-tools-list", version: "0.1.0" },
      },
    }),
  });
  sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;
  const initText = await initResponse.text();
  if (!initResponse.ok || !sessionId) {
    failureCode = 3;
    throw new Error(`initialize failed status=${initResponse.status} session=${sessionId ?? "missing"}`);
  }
  if (!initText.includes("project_context_load") || !initText.includes("workflow_guide_recommend") || !initText.includes("repeatable multi-step process") || !initText.includes("binary_upload_begin")) {
    failureCode = 7;
    throw new Error("initialize response is missing project-context, workflow-guide, or binary-transfer instructions");
  }

  const listResponse = await fetch(base, {
    method: "POST",
    headers: { ...commonHeaders, "Mcp-Session-Id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const text = await listResponse.text();
  if (!listResponse.ok) {
    failureCode = 4;
    throw new Error(text || `tools/list failed status=${listResponse.status}`);
  }

  const missing = expectedTools.filter((name) => !text.includes(`\"name\":\"${name}\"`) && !text.includes(`\"name\": \"${name}\"`));
  if (missing.length > 0) {
    failureCode = 5;
    throw new Error(`missing tools: ${missing.join(",")}`);
  }

  console.log(`tools present: ${expectedTools.join(",")}`);
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
