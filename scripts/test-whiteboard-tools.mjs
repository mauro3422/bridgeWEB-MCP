import http from "node:http";
import { once } from "node:events";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP8z8DwnwEJMCFziBMAAIPRAgYEvCRHAAAAAElFTkSuQmCC", "base64");
const capture = {
  id: "799719b7-d8bd-49ca-b0d5-485930473820",
  boardId: "default",
  boardTitle: "Pizarra de prueba",
  imagePath: "/api/captures/799719b7-d8bd-49ca-b0d5-485930473820/image",
  source: "mcp",
  clientId: "pc-test",
  clientKind: "pc",
  camera: { x: -90, y: -31.5, zoom: 1 },
  width: 1164,
  height: 609,
  bytes: png.length,
  createdAt: "2026-07-22T07:20:00.000Z",
};

const calls = [];
const server = http.createServer(async (request, response) => {
  calls.push({ method: request.method, url: request.url });
  if (request.method === "POST" && request.url === "/api/captures/request") {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const payload = JSON.parse(body || "{}");
    if (payload.timeoutMs !== 4321 || payload.boardId !== "default") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unexpected capture request" }));
      return;
    }
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ capture }));
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

try {
  const { createDefaultToolRegistry } = await import("../dist/tool-registry.js");
  const registry = createDefaultToolRegistry();

  for (const name of ["whiteboard_capture_pc_view", "whiteboard_latest_capture", "whiteboard_capture_list"]) {
    if (!registry.has(name)) throw new Error(`Missing TabletWhiteboard tool: ${name}`);
    if (!registry.riskSummary.readOnly.includes(name)) throw new Error(`TabletWhiteboard tool is not classified read-only: ${name}`);
  }
  if (!registry.modules.includes("tablet-whiteboard")) throw new Error("TabletWhiteboard module is not registered");

  const fresh = await registry.call("whiteboard_capture_pc_view", {
    baseUrl,
    boardId: "default",
    timeoutMs: 4321,
  });
  if (fresh.capture.source !== "mcp" || fresh.capture.camera.x !== -90) throw new Error("Fresh capture metadata is incorrect");
  if (!Array.isArray(fresh.__bridgeImages) || fresh.__bridgeImages.length !== 1) throw new Error("Fresh capture did not attach one image");
  if (fresh.__bridgeImages[0].mimeType !== "image/png" || Buffer.from(fresh.__bridgeImages[0].data, "base64").compare(png) !== 0) {
    throw new Error("Fresh capture attachment is not the expected PNG");
  }

  const latest = await registry.call("whiteboard_latest_capture", { baseUrl, boardId: "default" });
  if (latest.capture.source !== "manual" || latest.__bridgeImages.length !== 1) throw new Error("Latest capture failed");

  const list = await registry.call("whiteboard_capture_list", { baseUrl, boardId: "default", limit: 7 });
  if (list.count !== 1 || list.captures[0].id !== capture.id || "__bridgeImages" in list) throw new Error("Capture list failed");

  const delegated = await registry.call("bridge_tool_query", {
    toolName: "whiteboard_capture_pc_view",
    arguments: { baseUrl, boardId: "default", timeoutMs: 4321 },
  });
  if (!Array.isArray(delegated.__bridgeImages) || delegated.__bridgeImages.length !== 1) {
    throw new Error("bridge_tool_query did not hoist the whiteboard image attachment");
  }
  if (delegated.result?.__bridgeImages !== undefined || delegated.result?.capture?.id !== capture.id) {
    throw new Error("bridge_tool_query exposed internal image data in the nested public result");
  }

  let publicRejected = false;
  try {
    await registry.call("whiteboard_capture_list", { baseUrl: "https://example.com", limit: 1 });
  } catch (error) {
    publicRejected = String(error).includes("localhost or a private LAN address") || String(error).includes("http://");
  }
  if (!publicRejected) throw new Error("Public/open-world TabletWhiteboard URL was not rejected");

  console.log(JSON.stringify({
    ok: true,
    module: "tablet-whiteboard",
    tools: 3,
    freshImageBytes: png.length,
    delegatedImage: true,
    privateNetworkGuard: true,
    calls,
  }, null, 2));
} finally {
  server.close();
  await once(server, "close");
}
