import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const calls = [];
const writeCalls = [];
const server = http.createServer(async (request, response) => {
  const body = await readRequestBody(request);
  calls.push({ method: request.method, url: request.url, bytes: body.length });

  if (request.method === "GET" && request.url === "/api/board") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "default" }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/captures/request") {
    const payload = JSON.parse(body.toString("utf8") || "{}");
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
    response.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(png.length) });
    response.end(png);
    return;
  }

  if (request.method === "POST" && ["/api/ai/texts", "/api/ai/svg", "/api/ai/diagrams"].includes(request.url)) {
    const payload = JSON.parse(body.toString("utf8") || "{}");
    writeCalls.push({ route: request.url, payload, headers: request.headers });
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      annotation: request.url === "/api/ai/texts" ? { id: "text-test", ...payload, layerId: "ai-annotations", locked: true } : undefined,
      image: request.url !== "/api/ai/texts" ? { id: `image-${writeCalls.length}`, boardId: payload.boardId, layerId: "ai-annotations", locked: true } : undefined,
    }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/ai/images") {
    writeCalls.push({ route: request.url, body, headers: request.headers });
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ image: { id: "image-upload", boardId: request.headers["x-board-id"], layerId: "ai-annotations", locked: true } }));
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

const tempDir = path.resolve(".tmp", "whiteboard-tool-test");
fs.mkdirSync(tempDir, { recursive: true });
const imagePath = path.join(tempDir, "existing-image.png");
fs.writeFileSync(imagePath, png);

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
  const toolNames = [
    "whiteboard_capture_pc_view",
    "whiteboard_latest_capture",
    "whiteboard_capture_list",
    "whiteboard_add_text",
    "whiteboard_add_svg",
    "whiteboard_add_diagram",
    "whiteboard_insert_image",
  ];
  for (const name of toolNames) if (!registry.has(name)) throw new Error(`Missing TabletWhiteboard tool: ${name}`);
  for (const name of ["whiteboard_capture_pc_view", "whiteboard_add_text", "whiteboard_add_svg", "whiteboard_add_diagram", "whiteboard_insert_image"]) {
    if (!registry.riskSummary.neutral.includes(name)) throw new Error(`TabletWhiteboard mutation is not neutral: ${name}`);
  }
  for (const name of ["whiteboard_latest_capture", "whiteboard_capture_list"]) {
    if (!registry.riskSummary.readOnly.includes(name)) throw new Error(`TabletWhiteboard query is not read-only: ${name}`);
  }
  if (!registry.modules.includes("tablet-whiteboard")) throw new Error("TabletWhiteboard module is not registered");

  const fresh = await registry.call("whiteboard_capture_pc_view", { boardId: "default", timeoutMs: 4321 });
  if (fresh.capture.source !== "mcp" || fresh.capture.camera.x !== -90 || fresh.capture.width !== 4 || fresh.capture.height !== 4) throw new Error("Fresh capture metadata is incorrect");
  if (fresh.capture.bytes !== png.length || fresh.capture.sha256 !== pngSha256) throw new Error("Fresh capture integrity metadata is incorrect");
  if (!Array.isArray(fresh.__bridgeImages) || fresh.__bridgeImages.length !== 1) throw new Error("Fresh capture did not attach one image");
  if (fresh.__bridgeImages[0].mimeType !== "image/png" || Buffer.from(fresh.__bridgeImages[0].data, "base64").compare(png) !== 0) throw new Error("Fresh capture attachment is not expected PNG");

  const latest = await registry.call("whiteboard_latest_capture", { boardId: "default" });
  if (latest.capture.source !== "manual" || latest.__bridgeImages.length !== 1) throw new Error("Latest capture failed");
  const list = await registry.call("whiteboard_capture_list", { boardId: "default", limit: 7 });
  if (list.count !== 1 || list.captures[0].id !== capture.id || "__bridgeImages" in list) throw new Error("Capture list failed");

  const textResult = await registry.call("whiteboard_add_text", { text: "Respuesta estructurada", x: 120, y: 160, width: 420, height: 170 });
  if (textResult.boardId !== "default" || textResult.annotation?.layerId !== "ai-annotations") throw new Error("Text tool result is invalid");

  const svgSource = '<svg viewBox="0 0 200 120"><rect x="8" y="8" width="184" height="104" rx="12" fill="none" stroke="#38bdf8" stroke-width="4"/><text x="100" y="68" text-anchor="middle" fill="#e2e8f0" font-size="22">SVG seguro</text></svg>';
  const svgResult = await registry.call("whiteboard_add_svg", { boardId: "default", svg: svgSource, x: 220, y: 240, width: 500, height: 300 });
  if (svgResult.image?.layerId !== "ai-annotations") throw new Error("SVG tool result is invalid");

  const bezier = "M 20 160 C 120 20 220 300 360 100";
  const diagramResult = await registry.call("whiteboard_add_diagram", {
    boardId: "default",
    width: 640,
    height: 420,
    elements: [
      { type: "rect", x: 10, y: 10, width: 180, height: 80, stroke: "#38bdf8" },
      { type: "arrow", x1: 190, y1: 50, x2: 340, y2: 120, stroke: "#f59e0b" },
      { type: "path", d: bezier, stroke: "#a78bfa", fill: "none", strokeWidth: 5 },
      { type: "text", x: 90, y: 55, text: "Nodo", textAnchor: "middle" },
    ],
  });
  if (diagramResult.image?.layerId !== "ai-annotations") throw new Error("Diagram tool result is invalid");

  const imageResult = await registry.call("whiteboard_insert_image", { path: imagePath, name: "imagen existente.png", x: 400, y: 500, width: 300, height: 180 });
  if (imageResult.source?.sha256 !== pngSha256 || imageResult.image?.layerId !== "ai-annotations") throw new Error("Image insertion result is invalid");

  const textCall = writeCalls.find((call) => call.route === "/api/ai/texts");
  const svgCall = writeCalls.find((call) => call.route === "/api/ai/svg");
  const diagramCall = writeCalls.find((call) => call.route === "/api/ai/diagrams");
  const imageCall = writeCalls.find((call) => call.route === "/api/ai/images");
  if (textCall?.payload.text !== "Respuesta estructurada" || textCall.payload.boardId !== "default") throw new Error("Text request payload changed");
  if (svgCall?.payload.svg !== svgSource || svgCall.payload.width !== 500) throw new Error("SVG request payload changed");
  if (diagramCall?.payload.elements?.[2]?.d !== bezier) throw new Error("Bezier path did not reach TabletWhiteboard intact");
  if (!imageCall || Buffer.compare(imageCall.body, png) !== 0 || imageCall.headers["content-type"] !== "image/png") throw new Error("Image bytes or MIME changed");
  if (imageCall.headers["x-board-id"] !== "default" || imageCall.headers["x-display-width"] !== "300") throw new Error("Image placement headers changed");

  const delegated = await registry.call("bridge_tool_query", { toolName: "whiteboard_latest_capture", arguments: { boardId: "default" } });
  if (!Array.isArray(delegated.__bridgeImages) || delegated.__bridgeImages.length !== 1) throw new Error("bridge_tool_query did not hoist latest image");
  if (delegated.result?.__bridgeImages !== undefined || delegated.result?.capture?.id !== capture.id) throw new Error("bridge_tool_query exposed internal image data");
  const schemaInfo = await registry.call("bridge_tool_schema", { toolName: "whiteboard_latest_capture" });
  if (schemaInfo.tool?.name !== "whiteboard_latest_capture") throw new Error("bridge_tool_schema returned the wrong tool");
  if (!schemaInfo.tool?.inputSchema?.properties?.boardId) throw new Error("bridge_tool_schema omitted the delegated input schema");
  if (schemaInfo.tool?.annotations?.readOnlyHint !== true) throw new Error("bridge_tool_schema omitted safety annotations");


  let freshProxyRejected = false;
  try {
    await registry.call("bridge_tool_query", { toolName: "whiteboard_capture_pc_view", arguments: { boardId: "default", timeoutMs: 4321 } });
  } catch (error) {
    freshProxyRejected = String(error).includes("not classified read-only");
  }
  if (!freshProxyRejected) throw new Error("Fresh capture was incorrectly accepted by read-only proxy");

  await expectRejected(registry, "bad-dimensions", "dimension metadata");
  await expectRejected(registry, "bad-bytes", "byte metadata");
  await expectRejected(registry, "bad-hash", "SHA-256");
  await expectRejected(registry, "bad-source", "PC MCP flow");
  await expectRejected(registry, "bad-board", "different board");

  let publicRejected = false;
  try { await registry.call("whiteboard_capture_list", { baseUrl: "https://example.com", limit: 1 }); }
  catch (error) { publicRejected = String(error).includes("localhost or a private LAN address") || String(error).includes("http://"); }
  if (!publicRejected) throw new Error("Public/open-world URL was not rejected");

  let unlistedRejected = false;
  try { await registry.call("whiteboard_capture_list", { baseUrl: "http://127.0.0.1:1", limit: 1 }); }
  catch (error) { unlistedRejected = String(error).includes("configured origin allowlist"); }
  if (!unlistedRejected) throw new Error("Unlisted private origin was not rejected");

  console.log(JSON.stringify({
    ok: true,
    module: "tablet-whiteboard",
    tools: toolNames.length,
    freshImageBytes: png.length,
    integrity: { dimensions: "4x4", sha256: pngSha256, metadataRegressions: 3 },
    writeTools: { text: true, sanitizedSvgTransport: true, bezier: true, existingImage: true },
    classifications: { neutral: 5, readOnly: 2 },
    delegatedLatestImage: true,
    configuredOriginGuard: true,
    privateNetworkGuard: true,
    calls,
  }, null, 2));
} finally {
  server.close();
  await once(server, "close");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
