import crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP8z8DwnwEJMCFziBMAAIPRAgYEvCRHAAAAAElFTkSuQmCC", "base64");
const pngSha256 = crypto.createHash("sha256").update(png).digest("hex");
const capture = {
  id: "799719b7-d8bd-49ca-b0d5-485930473820",
  boardId: "default",
  boardTitle: "Pizarra de prueba",
  imagePath: "/api/captures/799719b7-d8bd-49ca-b0d5-485930473820/image",
  source: "mcp",
  clientId: "pc-test",
  clientKind: "pc",
  camera: { x: -90, y: -31.5, zoom: 1 },
  width: 4,
  height: 4,
  bytes: png.length,
  sha256: pngSha256,
  createdAt: "2026-07-22T07:20:00.000Z",
};

function captureForBoard(boardId) {
  if (boardId === "bad-dimensions") return { ...capture, boardId, width: 5 };
  if (boardId === "bad-bytes") return { ...capture, boardId, bytes: png.length + 1 };
  if (boardId === "bad-hash") return { ...capture, boardId, sha256: "0".repeat(64) };
  if (boardId === "bad-source") return { ...capture, boardId, source: "manual" };
  if (boardId === "bad-board") return { ...capture, boardId: "different-board" };
  return capture;
}

const calls = [];
const server = http.createServer(async (request, response) => {
  calls.push({ method: request.method, url: request.url });
  if (request.method === "POST" && request.url === "/api/captures/request") {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const payload = JSON.parse(body || "{}");
    if (payload.timeoutMs !== 4321 || typeof payload.boardId !== "string") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unexpected capture request" }));
      return;
    }
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ capture: captureForBoard(payload.boardId) }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/captures/latest?boardId=default") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ capture: { ...capture, source: "manual" } }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/captures?boardId=default&limit=7") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ captures: [capture] }));
    return;
  }
  if (request.method === "GET" && request.url === capture.imagePath) {
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
    });
    response.end(png);
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock whiteboard server did not expose a TCP port");
const baseUrl = `http://127.0.0.1:${address.port}`;
process.env.TABLET_WHITEBOARD_URL = baseUrl;
delete process.env.TABLET_WHITEBOARD_ALLOWED_ORIGINS;

async function expectRejected(registry, boardId, expectedText) {
  let rejected = false;
  try {
    await registry.call("whiteboard_capture_pc_view", { boardId, timeoutMs: 4321 });
  } catch (error) {
    rejected = String(error).toLowerCase().includes(expectedText.toLowerCase());
  }
  if (!rejected) throw new Error(`Expected '${boardId}' to be rejected with '${expectedText}'`);
}

try {
  const { createDefaultToolRegistry } = await import("../dist/tool-registry.js");
  const registry = createDefaultToolRegistry();

  for (const name of ["whiteboard_capture_pc_view", "whiteboard_latest_capture", "whiteboard_capture_list"]) {
    if (!registry.has(name)) throw new Error(`Missing TabletWhiteboard tool: ${name}`);
  }
  if (!registry.riskSummary.neutral.includes("whiteboard_capture_pc_view")) {
    throw new Error("Fresh TabletWhiteboard capture is not classified as a neutral mutating tool");
  }
  for (const name of ["whiteboard_latest_capture", "whiteboard_capture_list"]) {
    if (!registry.riskSummary.readOnly.includes(name)) throw new Error(`TabletWhiteboard query is not classified read-only: ${name}`);
  }
  if (!registry.modules.includes("tablet-whiteboard")) throw new Error("TabletWhiteboard module is not registered");

  const fresh = await registry.call("whiteboard_capture_pc_view", {
    boardId: "default",
    timeoutMs: 4321,
  });
  if (fresh.capture.source !== "mcp" || fresh.capture.camera.x !== -90 || fresh.capture.width !== 4 || fresh.capture.height !== 4) {
    throw new Error("Fresh capture metadata is incorrect");
  }
  if (fresh.capture.bytes !== png.length || fresh.capture.sha256 !== pngSha256) throw new Error("Fresh capture integrity metadata is incorrect");
  if (!Array.isArray(fresh.__bridgeImages) || fresh.__bridgeImages.length !== 1) throw new Error("Fresh capture did not attach one image");
  if (fresh.__bridgeImages[0].mimeType !== "image/png" || Buffer.from(fresh.__bridgeImages[0].data, "base64").compare(png) !== 0) {
    throw new Error("Fresh capture attachment is not the expected PNG");
  }

  const latest = await registry.call("whiteboard_latest_capture", { boardId: "default" });
  if (latest.capture.source !== "manual" || latest.__bridgeImages.length !== 1) throw new Error("Latest capture failed");

  const list = await registry.call("whiteboard_capture_list", { boardId: "default", limit: 7 });
  if (list.count !== 1 || list.captures[0].id !== capture.id || "__bridgeImages" in list) throw new Error("Capture list failed");

  const delegated = await registry.call("bridge_tool_query", {
    toolName: "whiteboard_latest_capture",
    arguments: { boardId: "default" },
  });
  if (!Array.isArray(delegated.__bridgeImages) || delegated.__bridgeImages.length !== 1) {
    throw new Error("bridge_tool_query did not hoist the latest whiteboard image attachment");
  }
  if (delegated.result?.__bridgeImages !== undefined || delegated.result?.capture?.id !== capture.id) {
    throw new Error("bridge_tool_query exposed internal image data in the nested public result");
  }

  let freshProxyRejected = false;
  try {
    await registry.call("bridge_tool_query", {
      toolName: "whiteboard_capture_pc_view",
      arguments: { boardId: "default", timeoutMs: 4321 },
    });
  } catch (error) {
    freshProxyRejected = String(error).includes("not classified read-only");
  }
  if (!freshProxyRejected) throw new Error("Fresh capture was incorrectly accepted by the read-only proxy");

  await expectRejected(registry, "bad-dimensions", "dimension metadata");
  await expectRejected(registry, "bad-bytes", "byte metadata");
  await expectRejected(registry, "bad-hash", "SHA-256");
  await expectRejected(registry, "bad-source", "PC MCP flow");
  await expectRejected(registry, "bad-board", "different board");

  let publicRejected = false;
  try {
    await registry.call("whiteboard_capture_list", { baseUrl: "https://example.com", limit: 1 });
  } catch (error) {
    publicRejected = String(error).includes("localhost or a private LAN address") || String(error).includes("http://");
  }
  if (!publicRejected) throw new Error("Public/open-world TabletWhiteboard URL was not rejected");

  let unlistedRejected = false;
  try {
    await registry.call("whiteboard_capture_list", { baseUrl: "http://127.0.0.1:1", limit: 1 });
  } catch (error) {
    unlistedRejected = String(error).includes("configured origin allowlist");
  }
  if (!unlistedRejected) throw new Error("Unlisted private TabletWhiteboard origin was not rejected");

  console.log(JSON.stringify({
    ok: true,
    module: "tablet-whiteboard",
    tools: 3,
    freshImageBytes: png.length,
    integrity: { dimensions: "4x4", sha256: pngSha256, metadataRegressions: 3 },
    freshClassification: "neutral",
    delegatedLatestImage: true,
    configuredOriginGuard: true,
    privateNetworkGuard: true,
    calls,
  }, null, 2));
} finally {
  server.close();
  await once(server, "close");
}
