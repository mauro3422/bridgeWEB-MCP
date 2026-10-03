import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mcp-framing-"));
const port = 5200 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["dist/http.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BRIDGE_MCP_HTTP_PORT: String(port),
    BRIDGE_MCP_HTTP_SOFT_SESSION_LIMIT: "4",
    BRIDGE_MCP_HTTP_CAPACITY_RECLAIM_IDLE_MS: "60000",
    BRIDGE_MCP_HTTP_CLEANUP_INTERVAL_MS: "60000",
    BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(tempRoot, "skill-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(tempRoot, "project-health.json"),
    BRIDGE_MCP_PROJECT_HEALTH_ROOT: process.cwd(),
    BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(tempRoot, "runtime-health.json"),
    BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(tempRoot, "project-situation.json"),
    BRIDGE_MCP_PROJECT_SITUATION_ROOT: process.cwd(),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

class RawReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
    this.error = null;
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.on("end", () => {
      this.closed = true;
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.on("error", (error) => {
      this.error = error;
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  async ensure(length, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < length) {
      if (this.error) throw this.error;
      if (this.closed) throw new Error(`Socket closed with ${this.buffer.length}/${length} bytes buffered`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out waiting for ${length} bytes; received ${this.buffer.length}`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  async readUntil(delimiter, timeoutMs = 2000) {
    const marker = Buffer.from(delimiter);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.buffer.indexOf(marker);
      if (index >= 0) {
        const value = this.buffer.subarray(0, index);
        this.buffer = this.buffer.subarray(index + marker.length);
        return value;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out waiting for ${JSON.stringify(delimiter)}`);
      await this.ensure(this.buffer.length + 1, remaining);
    }
  }

  async readBytes(length, timeoutMs = 2000) {
    await this.ensure(length, timeoutMs);
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }

  async readHeaders(timeoutMs = 2000) {
    const raw = (await this.readUntil("\r\n\r\n", timeoutMs)).toString("latin1");
    const [statusLine, ...lines] = raw.split("\r\n");
    const status = Number(statusLine.match(/^HTTP\/1\.1 (\d{3})/)?.[1]);
    const headers = {};
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
    return { status, headers };
  }

  async readChunk(timeoutMs = 2000) {
    const sizeLine = (await this.readUntil("\r\n", timeoutMs)).toString("ascii");
    const size = Number.parseInt(sizeLine.split(";", 1)[0], 16);
    assert.ok(Number.isInteger(size) && size >= 0, `Invalid chunk size line: ${JSON.stringify(sizeLine)}`);
    if (size === 0) {
      const trailer = await this.readUntil("\r\n", timeoutMs);
      assert.equal(trailer.length, 0, "Unexpected trailer after terminal chunk");
      return null;
    }
    const data = await this.readBytes(size, timeoutMs);
    assert.equal((await this.readBytes(2, timeoutMs)).toString("ascii"), "\r\n", "Chunk data must end with CRLF");
    return data;
  }
}

async function connect() {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return { socket, reader: new RawReader(socket) };
}

function sendRequest(socket, method, headers = {}, body = "") {
  const requestHeaders = {
    Host: `127.0.0.1:${port}`,
    Accept: "application/json, text/event-stream",
    ...headers,
  };
  if (body) {
    requestHeaders["Content-Type"] ??= "application/json";
    requestHeaders["Content-Length"] = String(Buffer.byteLength(body));
  }
  const lines = [`${method} /mcp HTTP/1.1`, ...Object.entries(requestHeaders).map(([name, value]) => `${name}: ${value}`), "", body];
  socket.write(lines.join("\r\n"));
}

async function waitReady() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.ok) return;
    } catch {
      // The isolated server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Framing test server did not become ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

try {
  await waitReady();

  const initialize = await connect();
  const initializeBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "bridge-raw-framing-test", version: "1.0.0" },
    },
  });
  sendRequest(initialize.socket, "POST", {}, initializeBody);
  const initializeResponse = await initialize.reader.readHeaders();
  assert.equal(initializeResponse.status, 200);
  assert.match(initializeResponse.headers["transfer-encoding"] || "", /chunked/i);
  assert.equal(initializeResponse.headers["content-length"], undefined);
  const initializeChunks = [];
  while (true) {
    const chunk = await initialize.reader.readChunk();
    if (chunk === null) break;
    initializeChunks.push(chunk);
  }
  const initializeSse = Buffer.concat(initializeChunks).toString("utf8");
  assert.match(initializeSse, /event: message/);
  const sessionId = initializeResponse.headers["mcp-session-id"];
  assert.ok(sessionId, "Initialize must return an MCP session id");
  initialize.socket.destroy();

  const eventStream = await connect();
  sendRequest(eventStream.socket, "GET", {
    "Mcp-Session-Id": sessionId,
    "Mcp-Protocol-Version": "2025-06-18",
  });
  const eventStreamResponse = await eventStream.reader.readHeaders(1000);
  assert.equal(eventStreamResponse.status, 200);
  assert.match(eventStreamResponse.headers["content-type"] || "", /text\/event-stream/i);
  assert.match(eventStreamResponse.headers["transfer-encoding"] || "", /chunked/i);
  assert.equal(eventStream.reader.buffer.length, 0, "GET SSE must flush headers before waiting for its first event");

  const initialized = await connect();
  sendRequest(initialized.socket, "POST", {
    "Mcp-Session-Id": sessionId,
    "Mcp-Protocol-Version": "2025-06-18",
  }, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  const initializedResponse = await initialized.reader.readHeaders();
  assert.equal(initializedResponse.status, 202);
  initialized.socket.destroy();

  const notificationChunks = [];
  let notificationText = "";
  for (let attempt = 0; attempt < 4 && !notificationText.includes("notifications/tools/list_changed"); attempt += 1) {
    const chunk = await eventStream.reader.readChunk(1000);
    if (chunk) {
      notificationChunks.push(chunk);
      notificationText += chunk.toString("utf8");
    }
  }
  assert.match(notificationText, /notifications\/tools\/list_changed/, "GET SSE must remain open and deliver the post-initialize catalog notification");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(eventStream.reader.closed, false, "SSE connection must remain open after a notification");
  assert.equal(eventStream.socket.destroyed, false, "SSE connection must remain open after a notification");
  eventStream.socket.destroy();

  console.log(JSON.stringify({ ok: true, initializeStatus: initializeResponse.status, initializeChunks: initializeChunks.length, eventStreamStatus: eventStreamResponse.status, eventStreamNotificationBytes: Buffer.byteLength(notificationText) }));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2000).unref();
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
