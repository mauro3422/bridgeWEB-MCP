import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { DEFAULT_TIMEOUT_MS } from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { appendBounded, assertCommandAllowed, fileExists, resolveToolPath, runShellCommand, tailText, terminateProcessTree } from "./shared/process.js";

const DONE_TTL_MS = 10 * 60_000;
const MAX_RUN_MS = 24 * 60 * 60_000;

type TerminalSession = {
  id: string;
  name: string | null;
  command: string;
  cwd: string;
  startedAt: number;
  completedAt: number | null;
  lastOutputAt: number;
  timeoutMs: number | null;
  timedOut: boolean;
  cleanupAfterMs: number;
  logFile: string | null;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timeoutHandle: NodeJS.Timeout | null;
};

type TerminalStartArgs = {
  command?: string;
  cwd?: string;
  name?: string;
  logFile?: string;
  timeoutMs?: number;
  cleanupAfterMs?: number;
};

const terminals = new Map<string, TerminalSession>();
let terminalCounter = 0;

function defaultShellCommand() {
  return process.platform === "win32" ? "powershell.exe -NoLogo -NoProfile" : "bash";
}

function clampMs(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isoOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function isSessionRunning(session: TerminalSession): boolean {
  return session.completedAt === null && session.exitCode === null && session.signal === null;
}

function cleanupFinishedSessions() {
  const now = Date.now();
  for (const [id, session] of terminals) {
    if (!isSessionRunning(session) && session.completedAt !== null && now - session.completedAt >= session.cleanupAfterMs) {
      terminals.delete(id);
    }
  }
}

async function prepareLogFile(logFile: string | undefined, resolvedCwd: string, id: string, command: string): Promise<string | null> {
  if (!logFile?.trim()) return null;
  const resolved = path.isAbsolute(logFile) ? path.resolve(logFile) : path.resolve(resolvedCwd, logFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, `\n--- bridge terminal ${id} started ${new Date().toISOString()} ---\ncommand: ${command}\ncwd: ${resolvedCwd}\n`, "utf8");
  return resolved;
}

function appendSessionLog(session: TerminalSession, chunk: Buffer | string) {
  if (!session.logFile) return;
  void fs.appendFile(session.logFile, chunk).catch((error: unknown) => {
    session.stderr = appendBounded(session.stderr, `[bridge log write failed] ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

function terminalSnapshot(session: TerminalSession, maxChars: number) {
  const now = Date.now();
  return {
    id: session.id,
    name: session.name,
    command: session.command,
    cwd: session.cwd,
    pid: session.child.pid ?? null,
    running: isSessionRunning(session),
    exitCode: session.exitCode,
    signal: session.signal,
    timedOut: session.timedOut,
    timeoutMs: session.timeoutMs,
    logFile: session.logFile,
    startedAtIso: new Date(session.startedAt).toISOString(),
    completedAtIso: isoOrNull(session.completedAt),
    ageMs: now - session.startedAt,
    idleMs: now - session.lastOutputAt,
    stdout: tailText(session.stdout, maxChars),
    stderr: tailText(session.stderr, maxChars),
  };
}

async function terminalStart(args: TerminalStartArgs) {
  const startedNow = Date.now();
  const cmd = args.command?.trim() || defaultShellCommand();
  assertCommandAllowed(cmd);
  const resolvedCwd = resolveToolPath(args.cwd ?? ".");
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  const id = `term_${Date.now()}_${++terminalCounter}`;
  const child = spawn(cmd, { cwd: resolvedCwd, shell: true, windowsHide: true, env: process.env });
  const sessionLogFile = await prepareLogFile(args.logFile, resolvedCwd, id, cmd);
  const timeoutMs = args.timeoutMs === undefined ? null : clampMs(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_RUN_MS);
  const cleanupAfterMs = clampMs(args.cleanupAfterMs, DONE_TTL_MS, 0, MAX_RUN_MS);
  const session: TerminalSession = {
    id,
    name: args.name?.trim() || null,
    command: cmd,
    cwd: resolvedCwd,
    startedAt: startedNow,
    completedAt: null,
    lastOutputAt: startedNow,
    timeoutMs,
    timedOut: false,
    cleanupAfterMs,
    logFile: sessionLogFile,
    child,
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
    timeoutHandle: null,
  };
  if (session.timeoutMs !== null) {
    session.timeoutHandle = setTimeout(() => {
      session.timedOut = true;
      void terminateProcessTree(session.child);
    }, session.timeoutMs);
  }
  child.stdout?.on("data", (chunk: Buffer) => {
    session.lastOutputAt = Date.now();
    session.stdout = appendBounded(session.stdout, chunk);
    appendSessionLog(session, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    session.lastOutputAt = Date.now();
    session.stderr = appendBounded(session.stderr, chunk);
    appendSessionLog(session, chunk);
  });
  child.on("error", (error) => {
    session.completedAt = Date.now();
    session.stderr = appendBounded(session.stderr, `[bridge process error] ${error.message}\n`);
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  });
  child.on("close", (code, signal) => {
    session.completedAt = Date.now();
    session.exitCode = code;
    session.signal = signal;
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  });
  terminals.set(id, session);
  return { id, command: cmd, cwd: resolvedCwd, pid: child.pid ?? null, logFile: session.logFile };
}

function getTerminal(id: string): TerminalSession {
  const session = terminals.get(id);
  if (!session) throw new Error(`Unknown terminal session: ${id}`);
  return session;
}

function terminalWrite(id: string, input: string) {
  const session = getTerminal(id);
  if (!isSessionRunning(session)) throw new Error(`Terminal already exited: ${id}`);
  session.child.stdin?.write(input);
  return { id, writtenChars: input.length };
}

function terminalRead(id: string, maxChars: number) {
  const session = getTerminal(id);
  return terminalSnapshot(session, maxChars);
}

async function terminalStop(id: string) {
  const session = getTerminal(id);
  const wasRunning = isSessionRunning(session);
  if (wasRunning) await terminateProcessTree(session.child);
  if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
  session.timeoutHandle = null;
  terminals.delete(id);
  return { id, wasRunning };
}

export function terminalList() {
  cleanupFinishedSessions();
  return Array.from(terminals.values()).map((session) => {
    const snap = terminalSnapshot(session, 0);
    return {
      id: snap.id,
      name: snap.name,
      command: snap.command,
      cwd: snap.cwd,
      pid: snap.pid,
      running: snap.running,
      exitCode: snap.exitCode,
      signal: snap.signal,
      timedOut: snap.timedOut,
      timeoutMs: snap.timeoutMs,
      logFile: snap.logFile,
      startedAtIso: snap.startedAtIso,
      completedAtIso: snap.completedAtIso,
      ageMs: snap.ageMs,
      idleMs: snap.idleMs,
    };
  });
}

export const processToolModule: BridgeToolModule = {
  name: "process",
  tools: [
    { name: "run_command", description: "Run a shell command in a cwd with timeout and captured stdout/stderr.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS } }, required: ["command"], additionalProperties: false } },
    { name: "terminal_start", description: "Start a persistent terminal process and return a session id. Supports optional name, logFile, timeoutMs, and cleanupAfterMs for long-running tasks.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, name: { type: "string" }, logFile: { type: "string" }, timeoutMs: { type: "number", minimum: 1000, maximum: MAX_RUN_MS }, cleanupAfterMs: { type: "number", default: DONE_TTL_MS, minimum: 0, maximum: MAX_RUN_MS } }, additionalProperties: false } },
    { name: "terminal_write", description: "Write input to a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, input: { type: "string" } }, required: ["sessionId", "input"], additionalProperties: false } },
    { name: "terminal_read", description: "Read buffered stdout/stderr from a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxChars: { type: "number", default: 20000 } }, required: ["sessionId"], additionalProperties: false } },
    { name: "terminal_stop", description: "Stop and forget a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
    { name: "terminal_list", description: "List active persistent terminal sessions.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "work_once", description: "Alias of run_command for one short project action.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS } }, required: ["command"], additionalProperties: false } },
    { name: "work_begin", description: "Alias of terminal_start for long-running project work.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, name: { type: "string" }, logFile: { type: "string" }, timeoutMs: { type: "number", minimum: 1000, maximum: MAX_RUN_MS }, cleanupAfterMs: { type: "number", default: DONE_TTL_MS, minimum: 0, maximum: MAX_RUN_MS } }, additionalProperties: false } },
    { name: "work_peek", description: "Alias of terminal_read for inspecting project work output.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxChars: { type: "number", default: 20000 } }, required: ["sessionId"], additionalProperties: false } },
    { name: "work_show", description: "Alias of terminal_list for listing project work.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "work_feed", description: "Alias of terminal_write for sending input to project work.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, input: { type: "string" } }, required: ["sessionId", "input"], additionalProperties: false } },
    { name: "work_finish", description: "Alias of terminal_stop for stopping project work.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  ],
  handlers: {
    run_command: async (args) => {
      const parsed = z.object({ command: z.string().min(1), cwd: z.string().optional(), timeoutMs: z.number().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS) }).parse(args);
      return await runShellCommand(parsed.command, parsed.cwd, parsed.timeoutMs);
    },
    terminal_start: async (args) => {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional(), name: z.string().optional(), logFile: z.string().optional(), timeoutMs: z.number().optional(), cleanupAfterMs: z.number().optional() }).parse(args);
      return await terminalStart(parsed);
    },
    terminal_write: (args) => {
      const parsed = z.object({ sessionId: z.string(), input: z.string() }).parse(args);
      return terminalWrite(parsed.sessionId, parsed.input);
    },
    terminal_read: (args) => {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000) }).parse(args);
      return terminalRead(parsed.sessionId, parsed.maxChars);
    },
    terminal_stop: async (args) => {
      const parsed = z.object({ sessionId: z.string() }).parse(args);
      return await terminalStop(parsed.sessionId);
    },
    terminal_list: () => terminalList(),
    work_once: async (args) => {
      const parsed = z.object({ command: z.string().min(1), cwd: z.string().optional(), timeoutMs: z.number().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS) }).parse(args);
      return await runShellCommand(parsed.command, parsed.cwd, parsed.timeoutMs);
    },
    work_begin: async (args) => {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional(), name: z.string().optional(), logFile: z.string().optional(), timeoutMs: z.number().optional(), cleanupAfterMs: z.number().optional() }).parse(args);
      return await terminalStart(parsed);
    },
    work_peek: (args) => {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000) }).parse(args);
      return terminalRead(parsed.sessionId, parsed.maxChars);
    },
    work_show: () => terminalList(),
    work_feed: (args) => {
      const parsed = z.object({ sessionId: z.string(), input: z.string() }).parse(args);
      return terminalWrite(parsed.sessionId, parsed.input);
    },
    work_finish: async (args) => {
      const parsed = z.object({ sessionId: z.string() }).parse(args);
      return await terminalStop(parsed.sessionId);
    },
  },
};
