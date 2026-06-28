#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

const SERVER_NAME = "bridge-mcp";
const SERVER_VERSION = "0.2.0";
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_CHARS = 512 * 1024;

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

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);
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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolSchemas, ...processToolSchemas],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    if (name === "system_info") {
      return jsonText({
        server: { name: SERVER_NAME, version: SERVER_VERSION },
        hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
        cpus: os.cpus().map((cpu) => cpu.model), totalMemory: os.totalmem(), freeMemory: os.freemem(),
        homedir: os.homedir(), cwd: process.cwd(), node: process.version,
      });
    }
    if (name === "list_dir") {
      const parsed = z.object({ path: z.string(), depth: z.number().min(1).max(5).default(1) }).parse(args);
      return jsonText(await listDir(parsed.path, parsed.depth));
    }
    if (name === "read_text_file") {
      const parsed = z.object({ path: z.string(), maxBytes: z.number().positive().default(DEFAULT_MAX_FILE_BYTES) }).parse(args);
      return jsonText(await readTextFile(parsed.path, parsed.maxBytes));
    }
    if (name === "write_text_file") {
      const parsed = z.object({ path: z.string(), content: z.string(), append: z.boolean().default(false) }).parse(args);
      return jsonText(await writeTextFile(parsed.path, parsed.content, parsed.append));
    }
    if (name === "apply_patch") {
      const parsed = z.object({
        path: z.string(), oldText: z.string(), newText: z.string(),
        expectedReplacements: z.number().int().positive().default(1),
      }).parse(args);
      return jsonText(await applyPatch(parsed.path, parsed.oldText, parsed.newText, parsed.expectedReplacements));
    }
    if (name === "run_command") {
      const parsed = z.object({
        command: z.string().min(1), cwd: z.string().optional(),
        timeoutMs: z.number().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS),
      }).parse(args);
      return jsonText(await runCommand(parsed.command, parsed.cwd, parsed.timeoutMs) as JsonValue);
    }
    if (name === "terminal_start") {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional() }).parse(args);
      return jsonText(await terminalStart(parsed.command, parsed.cwd));
    }
    if (name === "terminal_write") {
      const parsed = z.object({ sessionId: z.string(), input: z.string() }).parse(args);
      return jsonText(terminalWrite(parsed.sessionId, parsed.input));
    }
    if (name === "terminal_read") {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000) }).parse(args);
      return jsonText(terminalRead(parsed.sessionId, parsed.maxChars));
    }
    if (name === "terminal_stop") {
      const parsed = z.object({ sessionId: z.string() }).parse(args);
      return jsonText(terminalStop(parsed.sessionId));
    }
    if (name === "terminal_list") {
      return jsonText(terminalList());
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return jsonText({ error: error instanceof Error ? error.message : String(error) });
  }
});
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal`, error);
  process.exit(1);
});
