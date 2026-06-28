import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_GIT_REMOTE_URL,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_RESTART_ACK_FILE,
  DEFAULT_RESTART_REQUEST_FILE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TUNNEL_ADMIN_BASE_URL,
  MAX_CAPTURE_CHARS,
  SERVER_NAME,
  SERVER_VERSION,
} from "./config.js";

export { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { beginToolMetric, finishToolMetric, getMetricsStatus, getMetricsSummary, getRecentMetrics } from "./metrics.js";
import { getMetricsVisualization, getVisualizationCatalog, type MetricsVisualizationKind } from "./visualizations.js";
import { createDefaultToolRegistry } from "./tool-registry.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type TerminalSession = {
  id: string;
  command: string;
  cwd: string;
  startedAt: number;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

const terminals = new Map<string, TerminalSession>();
let terminalCounter = 0;

const blockedCommands = new Set([
  "format", "diskpart", "shutdown", "reboot", "halt", "poweroff",
  "bcdedit", "cipher", "takeown", "runas", "reg", "sc",
]);

function jsonText(data: JsonValue) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function getBaseCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  const first = trimmed.split(/\s+/)[0] ?? "";
  return first.replace(/^["']|["']$/g, "").toLowerCase();
}

function assertCommandAllowed(command: string) {
  const base = getBaseCommand(command);
  if (blockedCommands.has(base)) {
    throw new Error(`Command blocked by bridge-mcp policy: ${base}`);
  }
}

function resolvePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Path must be a non-empty string.");
  }
  return path.resolve(inputPath);
}

function appendBounded(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > MAX_CAPTURE_CHARS ? next.slice(-MAX_CAPTURE_CHARS) : next;
}
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(filePath: string, maxBytes: number) {
  const resolved = resolvePath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("Path is not a file.");
  if (stat.size > maxBytes) {
    throw new Error(`File too large: ${stat.size} bytes > ${maxBytes} bytes.`);
  }
  const text = await fs.readFile(resolved, "utf8");
  return { path: resolved, bytes: stat.size, text };
}

async function writeTextFile(filePath: string, content: string, append: boolean) {
  const resolved = resolvePath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  append ? await fs.appendFile(resolved, content, "utf8") : await fs.writeFile(resolved, content, "utf8");
  const stat = await fs.stat(resolved);
  return { path: resolved, bytes: stat.size, append };
}
async function listDir(dirPath: string, depth: number) {
  const root = resolvePath(dirPath);
  const out: Array<{ type: string; path: string; size?: number }> = [];
  async function walk(current: string, level: number) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.slice(0, 200)) {
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full) || ".";
      if (entry.isDirectory()) {
        out.push({ type: "dir", path: rel });
        if (level < depth) await walk(full, level + 1);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        out.push({ type: "file", path: rel, size: stat.size });
      } else {
        out.push({ type: "other", path: rel });
      }
    }
  }
  await walk(root, 1);
  return { root, depth, entries: out };
}
async function applyPatch(filePath: string, oldText: string, newText: string, expected: number) {
  const resolved = resolvePath(filePath);
  const original = await fs.readFile(resolved, "utf8");
  if (!oldText) throw new Error("oldText must not be empty.");
  const count = original.split(oldText).length - 1;
  if (count !== expected) {
    throw new Error(`Expected ${expected} replacement(s), found ${count}.`);
  }
  const updated = original.split(oldText).join(newText);
  await fs.writeFile(resolved, updated, "utf8");
  return {
    path: resolved,
    replacements: count,
    oldBytes: Buffer.byteLength(original),
    newBytes: Buffer.byteLength(updated),
  };
}

async function runCommand(command: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  assertCommandAllowed(command);
  const resolvedCwd = cwd ? resolvePath(cwd) : process.cwd();
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  return await new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, { cwd: resolvedCwd, shell: true, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ command, cwd: resolvedCwd, code, signal, timedOut,
        durationMs: Date.now() - startedAt, stdout, stderr });
    });
  });
}

async function runProcess(command: string, args: string[], cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const resolvedCwd = cwd ? resolvePath(cwd) : process.cwd();
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  const commandLine = [command, ...args].join(" ");
  return await new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd: resolvedCwd, shell: false, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
    child.on("error", (error) => {
      finish({ command: commandLine, cwd: resolvedCwd, code: null, signal: null, timedOut,
        durationMs: Date.now() - startedAt, stdout, stderr, error: error.message });
    });
    child.on("close", (code, signal) => {
      finish({ command: commandLine, cwd: resolvedCwd, code, signal, timedOut,
        durationMs: Date.now() - startedAt, stdout, stderr });
    });
  });
}

function assertSafeGitRemote(remote: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) throw new Error(`Unsafe git remote name: ${remote}`);
}

function assertSafeGitHubUrl(repoUrl: string) {
  const parsed = new URL(repoUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("Only https://github.com/... remotes are allowed by bridge-mcp git tools.");
  }
}

async function gitStatus(cwd?: string) {
  return await runProcess("git", ["status", "--short", "--branch"], cwd);
}

async function gitSetRemote(repoUrl: string, remote = "origin", cwd?: string) {
  assertSafeGitRemote(remote);
  assertSafeGitHubUrl(repoUrl);
  const current = await runProcess("git", ["remote", "get-url", remote], cwd);
  const action = current.code === 0 ? "set-url" : "add";
  const updated = await runProcess("git", ["remote", action, remote, repoUrl], cwd);
  return { action, remote, repoUrl, result: updated };
}

async function gitCommitAll(message: string, cwd?: string) {
  const add = await runProcess("git", ["add", "-A"], cwd, 120_000);
  if (add.code !== 0) return { committed: false, add };
  const porcelain = await runProcess("git", ["status", "--porcelain"], cwd);
  if (String(porcelain.stdout ?? "").trim().length === 0) {
    return { committed: false, reason: "working tree clean", status: await gitStatus(cwd) };
  }
  const commit = await runProcess("git", ["commit", "-m", message], cwd, 120_000);
  return { committed: commit.code === 0, commit, status: await gitStatus(cwd) };
}

async function gitPushCurrentBranch(remote = "origin", branch?: string, cwd?: string) {
  assertSafeGitRemote(remote);
  const branchResult = branch
    ? { code: 0, stdout: branch }
    : await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (branchResult.code !== 0) return { pushed: false, branchResult };
  const resolvedBranch = String(branchResult.stdout ?? "").trim() || "main";
  const push = await runProcess("git", ["push", "-u", remote, resolvedBranch], cwd, 120_000);
  return { pushed: push.code === 0, remote, branch: resolvedBranch, push };
}

async function tunnelHealth(baseUrl = DEFAULT_TUNNEL_ADMIN_BASE_URL) {
  const fetchEndpoint = async (name: string) => {
    const url = `${baseUrl}/${name}`;
    try {
      const response = await fetch(url);
      const text = await response.text();
      return { ok: response.ok, status: response.status, text: tailText(text, 2000) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  return { baseUrl, healthz: await fetchEndpoint("healthz"), readyz: await fetchEndpoint("readyz") };
}

function summarizeCommand(result: Record<string, unknown>) {
  return {
    ok: result.code === 0 && result.timedOut !== true,
    code: result.code,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutTail: tailText(String(result.stdout ?? ""), 4000),
    stderrTail: tailText(String(result.stderr ?? ""), 4000),
    error: result.error,
  };
}

function getRestartRequestPath(cwd?: string) {
  return path.resolve(cwd ? resolvePath(cwd) : process.cwd(), DEFAULT_RESTART_REQUEST_FILE);
}

function getRestartAckPath(cwd?: string) {
  return path.resolve(cwd ? resolvePath(cwd) : process.cwd(), DEFAULT_RESTART_ACK_FILE);
}

async function bridgeRequestRestart(reason: string, mode: "http" | "tunnel" | "full", cwd?: string) {
  const requestPath = getRestartRequestPath(cwd);
  const tempPath = `${requestPath}.${process.pid}.${Date.now()}.tmp`;
  const request = {
    id: randomUUID(),
    requestedAt: new Date().toISOString(),
    reason,
    mode,
    server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid },
    cwd: cwd ? resolvePath(cwd) : process.cwd(),
  };

  await fs.writeFile(tempPath, JSON.stringify(request, null, 2), "utf8");
  await fs.rename(tempPath, requestPath);

  return {
    requested: true,
    requestPath,
    request,
    note: "The MCP server only wrote a restart request file. The external watchdog must perform the actual restart.",
  };
}

export async function bridgeRestartStatus(cwd?: string) {
  const requestPath = getRestartRequestPath(cwd);
  const ackPath = getRestartAckPath(cwd);
  const readJsonIfExists = async (filePath: string) => {
    if (!(await fileExists(filePath))) return null;
    const text = await fs.readFile(filePath, "utf8");
    const parseText = text.replace(/^\uFEFF/, "");
    try {
      return JSON.parse(parseText) as JsonValue;
    } catch {
      return { parseError: true, text: tailText(text, 4000) };
    }
  };

  return {
    requestPath,
    ackPath,
    pending: await fileExists(requestPath),
    request: await readJsonIfExists(requestPath),
    lastAck: await readJsonIfExists(ackPath),
  };
}

async function bridgeSelfCheck(cwd?: string) {
  const root = cwd ? resolvePath(cwd) : process.cwd();
  const typecheck = await runCommand("npm run check", root, 120_000) as Record<string, unknown>;
  const build = await runCommand("npm run build", root, 120_000) as Record<string, unknown>;
  const status = await gitStatus(root);
  const tunnel = await tunnelHealth();
  return {
    ok: typecheck.code === 0 && build.code === 0,
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    cwd: root,
    node: process.version,
    checks: { typecheck: summarizeCommand(typecheck), build: summarizeCommand(build) },
    git: status,
    tunnel,
    activeTerminals: terminalList(),
  };
}

function defaultShellCommand() {
  return process.platform === "win32" ? "powershell.exe -NoLogo -NoProfile" : "bash";
}
async function terminalStart(command?: string, cwd?: string) {
  const cmd = command?.trim() || defaultShellCommand();
  assertCommandAllowed(cmd);
  const resolvedCwd = cwd ? resolvePath(cwd) : process.cwd();
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  const id = `term_${Date.now()}_${++terminalCounter}`;
  const child = spawn(cmd, { cwd: resolvedCwd, shell: true, windowsHide: true, env: process.env });
  const session: TerminalSession = {
    id, command: cmd, cwd: resolvedCwd, startedAt: Date.now(), child,
    stdout: "", stderr: "", exitCode: null, signal: null,
  };
  child.stdout?.on("data", (chunk: Buffer) => { session.stdout = appendBounded(session.stdout, chunk); });
  child.stderr?.on("data", (chunk: Buffer) => { session.stderr = appendBounded(session.stderr, chunk); });
  child.on("close", (code, signal) => { session.exitCode = code; session.signal = signal; });
  terminals.set(id, session);
  return { id, command: cmd, cwd: resolvedCwd, pid: child.pid ?? null };
}
function getTerminal(id: string): TerminalSession {
  const session = terminals.get(id);
  if (!session) throw new Error(`Unknown terminal session: ${id}`);
  return session;
}

function terminalWrite(id: string, input: string) {
  const session = getTerminal(id);
  if (session.exitCode !== null) throw new Error(`Terminal already exited: ${id}`);
  session.child.stdin?.write(input);
  return { id, writtenChars: input.length };
}

function tailText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function terminalRead(id: string, maxChars: number) {
  const session = getTerminal(id);
  return {
    id,
    pid: session.child.pid ?? null,
    running: session.exitCode === null,
    exitCode: session.exitCode,
    signal: session.signal,
    stdout: tailText(session.stdout, maxChars),
    stderr: tailText(session.stderr, maxChars),
  };
}
function terminalStop(id: string) {
  const session = getTerminal(id);
  const wasRunning = session.exitCode === null;
  if (wasRunning) session.child.kill("SIGTERM");
  terminals.delete(id);
  return { id, wasRunning };
}

function terminalList() {
  return Array.from(terminals.values()).map((session) => ({
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    pid: session.child.pid ?? null,
    running: session.exitCode === null,
    exitCode: session.exitCode,
    signal: session.signal,
    ageMs: Date.now() - session.startedAt,
  }));
}

export function createBridgeServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  const modularToolRegistry = createDefaultToolRegistry();
const toolSchemas = [
  { name: "system_info", description: "Return basic OS, Node, CPU, memory, hostname and cwd information.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_dir", description: "List a directory recursively with bounded depth and entry limits.", inputSchema: { type: "object", properties: { path: { type: "string" }, depth: { type: "number", default: 1, minimum: 1, maximum: 5 } }, required: ["path"], additionalProperties: false } },
  { name: "read_text_file", description: "Read a UTF-8 text file with a maximum byte limit.", inputSchema: { type: "object", properties: { path: { type: "string" }, maxBytes: { type: "number", default: DEFAULT_MAX_FILE_BYTES } }, required: ["path"], additionalProperties: false } },
  { name: "write_text_file", description: "Write or append a UTF-8 text file, creating parent directories if needed.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, append: { type: "boolean", default: false } }, required: ["path", "content"], additionalProperties: false } },
  { name: "apply_patch", description: "Exact string replacement patch for one text file. Fails if replacement count differs from expectedReplacements.", inputSchema: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" }, expectedReplacements: { type: "number", default: 1 } }, required: ["path", "oldText", "newText"], additionalProperties: false } },
] as const;
const processToolSchemas = [
  { name: "run_command", description: "Run a shell command in a cwd with timeout and captured stdout/stderr.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS } }, required: ["command"], additionalProperties: false } },
  { name: "terminal_start", description: "Start a persistent terminal process and return a session id.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, additionalProperties: false } },
  { name: "terminal_write", description: "Write input to a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, input: { type: "string" } }, required: ["sessionId", "input"], additionalProperties: false } },
  { name: "terminal_read", description: "Read buffered stdout/stderr from a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxChars: { type: "number", default: 20000 } }, required: ["sessionId"], additionalProperties: false } },
  { name: "terminal_stop", description: "Stop and forget a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "terminal_list", description: "List active persistent terminal sessions.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
] as const;
const opsToolSchemas = [
  { name: "git_status", description: "Return short Git status for the current project.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
  { name: "git_set_remote", description: "Add or update a GitHub HTTPS remote for the current project.", inputSchema: { type: "object", properties: { repoUrl: { type: "string", default: DEFAULT_GIT_REMOTE_URL }, remote: { type: "string", default: "origin" }, cwd: { type: "string" } }, additionalProperties: false } },
  { name: "git_commit_all", description: "Stage all changes and create a Git commit if the working tree is dirty.", inputSchema: { type: "object", properties: { message: { type: "string" }, cwd: { type: "string" } }, required: ["message"], additionalProperties: false } },
  { name: "git_push_current_branch", description: "Publish the current Git branch to the configured remote and report the exact Git result.", inputSchema: { type: "object", properties: { remote: { type: "string", default: "origin" }, branch: { type: "string" }, cwd: { type: "string" } }, additionalProperties: false } },
  { name: "tunnel_health", description: "Check tunnel-client local healthz and readyz endpoints using the configured tunnel admin URL by default.", inputSchema: { type: "object", properties: { baseUrl: { type: "string", default: DEFAULT_TUNNEL_ADMIN_BASE_URL } }, additionalProperties: false } },
  { name: "bridge_self_check", description: "Run typecheck, build, Git status, configured tunnel health, and terminal inventory.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
  { name: "bridge_request_restart", description: "Request a bridge restart by writing a restart-request file for the external watchdog. This tool does not restart or kill processes directly.", inputSchema: { type: "object", properties: { reason: { type: "string" }, mode: { type: "string", enum: ["http", "tunnel", "full"], default: "http" }, cwd: { type: "string" } }, required: ["reason"], additionalProperties: false } },
  { name: "bridge_restart_status", description: "Return pending restart-request and last restart-ack information for the bridge watchdog.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
  { name: "bridge_metrics_status", description: "Return metrics storage status and paths for bridge tool telemetry.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "bridge_metrics_summary", description: "Return aggregated bridge tool metrics from SQLite.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 50, minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: "bridge_metrics_recent", description: "Return recent bridge tool calls from SQLite.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 25, minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: "bridge_visualization_catalog", description: "Return available bridge visualization cards and chart kinds.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "bridge_visualize_metrics", description: "Use this when the user wants a visual chart/card for bridge metrics. Returns a chart spec compatible with ChatGPT chart rendering.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["calls_by_tool", "avg_duration_by_tool", "errors_by_tool", "activity_timeline", "success_mix"], default: "calls_by_tool" }, limit: { type: "number", default: 10, minimum: 1, maximum: 20 } }, additionalProperties: false } },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolSchemas, ...modularToolRegistry.tools, ...processToolSchemas, ...opsToolSchemas],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};
  const metric = beginToolMetric(name, args);
  const complete = (result: ReturnType<typeof jsonText>, ok = true, error?: string) => {
    const outputText = result.content.map((part) => part.text).join("\n");
    finishToolMetric(metric, ok, outputText.length, error);
    return result;
  };

  try {
    if (name === "system_info") {
      return complete(jsonText({
        server: { name: SERVER_NAME, version: SERVER_VERSION },
        hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
        cpus: os.cpus().map((cpu) => cpu.model), totalMemory: os.totalmem(), freeMemory: os.freemem(),
        homedir: os.homedir(), cwd: process.cwd(), node: process.version,
      }));
    }
    if (name === "list_dir") {
      const parsed = z.object({ path: z.string(), depth: z.number().min(1).max(5).default(1) }).parse(args);
      return complete(jsonText(await listDir(parsed.path, parsed.depth)));
    }
    if (modularToolRegistry.has(name)) {
      return complete(jsonText(await modularToolRegistry.call(name, args as Record<string, unknown>) as JsonValue));
    }
    if (name === "read_text_file") {
      const parsed = z.object({ path: z.string(), maxBytes: z.number().positive().default(DEFAULT_MAX_FILE_BYTES) }).parse(args);
      return complete(jsonText(await readTextFile(parsed.path, parsed.maxBytes)));
    }
    if (name === "write_text_file") {
      const parsed = z.object({ path: z.string(), content: z.string(), append: z.boolean().default(false) }).parse(args);
      return complete(jsonText(await writeTextFile(parsed.path, parsed.content, parsed.append)));
    }
    if (name === "apply_patch") {
      const parsed = z.object({
        path: z.string(), oldText: z.string(), newText: z.string(),
        expectedReplacements: z.number().int().positive().default(1),
      }).parse(args);
      return complete(jsonText(await applyPatch(parsed.path, parsed.oldText, parsed.newText, parsed.expectedReplacements)));
    }
    if (name === "run_command") {
      const parsed = z.object({
        command: z.string().min(1), cwd: z.string().optional(),
        timeoutMs: z.number().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS),
      }).parse(args);
      return complete(jsonText(await runCommand(parsed.command, parsed.cwd, parsed.timeoutMs) as JsonValue));
    }
    if (name === "terminal_start") {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional() }).parse(args);
      return complete(jsonText(await terminalStart(parsed.command, parsed.cwd)));
    }
    if (name === "terminal_write") {
      const parsed = z.object({ sessionId: z.string(), input: z.string() }).parse(args);
      return complete(jsonText(terminalWrite(parsed.sessionId, parsed.input)));
    }
    if (name === "terminal_read") {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000) }).parse(args);
      return complete(jsonText(terminalRead(parsed.sessionId, parsed.maxChars)));
    }
    if (name === "terminal_stop") {
      const parsed = z.object({ sessionId: z.string() }).parse(args);
      return complete(jsonText(terminalStop(parsed.sessionId)));
    }
    if (name === "terminal_list") {
      return complete(jsonText(terminalList()));
    }
    if (name === "git_status") {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return complete(jsonText(await gitStatus(parsed.cwd)));
    }
    if (name === "git_set_remote") {
      const parsed = z.object({
        repoUrl: z.string().default(DEFAULT_GIT_REMOTE_URL),
        remote: z.string().default("origin"),
        cwd: z.string().optional(),
      }).parse(args);
      return complete(jsonText(await gitSetRemote(parsed.repoUrl, parsed.remote, parsed.cwd)));
    }
    if (name === "git_commit_all") {
      const parsed = z.object({ message: z.string().min(1).max(200), cwd: z.string().optional() }).parse(args);
      return complete(jsonText(await gitCommitAll(parsed.message, parsed.cwd)));
    }
    if (name === "git_push_current_branch") {
      const parsed = z.object({ remote: z.string().default("origin"), branch: z.string().optional(), cwd: z.string().optional() }).parse(args);
      return complete(jsonText(await gitPushCurrentBranch(parsed.remote, parsed.branch, parsed.cwd)));
    }
    if (name === "tunnel_health") {
      const parsed = z.object({ baseUrl: z.string().default(DEFAULT_TUNNEL_ADMIN_BASE_URL) }).parse(args);
      return complete(jsonText(await tunnelHealth(parsed.baseUrl)));
    }
    if (name === "bridge_self_check") {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return complete(jsonText(await bridgeSelfCheck(parsed.cwd)));
    }
    if (name === "bridge_request_restart") {
      const parsed = z.object({
        reason: z.string().min(1).max(500),
        mode: z.enum(["http", "tunnel", "full"]).default("http"),
        cwd: z.string().optional(),
      }).parse(args);
      return complete(jsonText(await bridgeRequestRestart(parsed.reason, parsed.mode, parsed.cwd)));
    }
    if (name === "bridge_restart_status") {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return complete(jsonText(await bridgeRestartStatus(parsed.cwd)));
    }
    if (name === "bridge_metrics_status") {
      return complete(jsonText(getMetricsStatus()));
    }
    if (name === "bridge_metrics_summary") {
      const parsed = z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(args);
      return complete(jsonText(getMetricsSummary(parsed.limit)));
    }
    if (name === "bridge_metrics_recent") {
      const parsed = z.object({ limit: z.number().int().min(1).max(200).default(25) }).parse(args);
      return complete(jsonText(getRecentMetrics(parsed.limit)));
    }
    if (name === "bridge_visualization_catalog") {
      return complete(jsonText(getVisualizationCatalog()));
    }
    if (name === "bridge_visualize_metrics") {
      const parsed = z.object({
        kind: z.enum(["calls_by_tool", "avg_duration_by_tool", "errors_by_tool", "activity_timeline", "success_mix"]).default("calls_by_tool"),
        limit: z.number().int().min(1).max(20).default(10),
      }).parse(args);
      return complete(jsonText(getMetricsVisualization(parsed.kind as MetricsVisualizationKind, parsed.limit)));
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return complete(jsonText({ error: message }), false, message);
  }
});
  return server;
}
