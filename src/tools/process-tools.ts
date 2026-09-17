import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { DEFAULT_TIMEOUT_MS } from "../config.js";
import { emitBridgeNotice } from "../notices.js";
import type { BridgeToolModule } from "./types.js";
import { appendBounded, assertCommandAllowed, classifyBackgroundActivity, fileExists, inspectProcessTree, resolveToolPath, runShellCommand, tailText, terminateProcessTree } from "./shared/process.js";

const DONE_TTL_MS = 10 * 60_000;
const MAX_RUN_MS = 24 * 60 * 60_000;
const MAX_SYNC_WORK_MS = 60_000;
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;
const TRACE_ID_INPUT_SCHEMA = { type: "string", pattern: "^[A-Za-z0-9._:-]{6,128}$" } as const;
const optionalTraceId = z.string().regex(TRACE_ID_PATTERN).optional();

type TerminalSession = {
  id: string;
  name: string | null;
  command: string;
  cwd: string;
  startedAt: number;
  completedAt: number | null;
  lastOutputAt: number;
  lastProgressAt: number;
  timeoutMs: number | null;
  timeoutAction: "observe" | "terminate";
  timedOut: boolean;
  timeoutExpiredAt: number | null;
  cleanupAfterMs: number;
  logFile: string | null;
  traceId: string | null;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutLines: number;
  stderrLines: number;
  lastCpuSeconds: number | null;
  lastActivityState: "progressing" | "idle" | "stalled" | null;
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
  timeoutAction?: "observe" | "terminate";
  cleanupAfterMs?: number;
  traceId?: string;
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
  const resolved = resolveToolPath(logFile, { access: "write", baseDir: resolvedCwd });
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
  const running = isSessionRunning(session);
  const activity = classifyBackgroundActivity({
    running,
    timeoutExpired: session.timedOut,
    now,
    lastProgressAt: session.lastProgressAt,
  });
  return {
    id: session.id,
    name: session.name,
    command: session.command,
    cwd: session.cwd,
    pid: session.child.pid ?? null,
    state: activity.state,
    activityState: activity.activityState,
    running,
    exitCode: session.exitCode,
    signal: session.signal,
    timedOut: session.timedOut,
    timeoutExpired: session.timedOut,
    timeoutMs: session.timeoutMs,
    timeoutAction: session.timeoutAction,
    timeoutExpiredAtIso: isoOrNull(session.timeoutExpiredAt),
    logFile: session.logFile,
    traceId: session.traceId,
    startedAtIso: new Date(session.startedAt).toISOString(),
    completedAtIso: isoOrNull(session.completedAt),
    ageMs: now - session.startedAt,
    idleMs: now - session.lastOutputAt,
    progressIdleMs: activity.progressIdleMs,
    lastOutputAtIso: new Date(session.lastOutputAt).toISOString(),
    lastProgressAtIso: new Date(session.lastProgressAt).toISOString(),
    output: {
      stdoutBytes: session.stdoutBytes,
      stderrBytes: session.stderrBytes,
      stdoutLines: session.stdoutLines,
      stderrLines: session.stderrLines,
      bufferedStdoutChars: session.stdout.length,
      bufferedStderrChars: session.stderr.length,
    },
    stdout: tailText(session.stdout, maxChars),
    stderr: tailText(session.stderr, maxChars),
  };
}

function terminalNoticeAction(session: TerminalSession) {
  return {
    label: "Inspect work",
    toolName: "work_peek",
    arguments: {
      sessionId: session.id,
      ...(session.traceId ? { traceId: session.traceId } : {}),
    },
    instruction: "Inspect the retained terminal session by its exact sessionId before deciding the next step.",
  };
}

function emitTerminalLifecycleNotice(session: TerminalSession, state: "started" | "completed"): void {
  const durationMs = Math.max(0, (session.completedAt ?? Date.now()) - session.startedAt);
  const hardTimeoutFailure = state === "completed" && session.timeoutAction === "terminate" && session.timedOut;
  const failed = state === "completed" && (hardTimeoutFailure || (session.exitCode !== null && session.exitCode !== 0));
  const displayName = session.name ? ` (${session.name})` : "";
  emitBridgeNotice({
    severity: failed ? "warning" : "info",
    code: `terminal-session-${state}`,
    source: "terminal-session",
    message: state === "started"
      ? `Background work ${session.id}${displayName} started and can run concurrently.`
      : `Background work ${session.id}${displayName} ${failed ? "finished with attention required" : "completed"}.`,
    details: {
      sessionId: session.id,
      name: session.name,
      pid: session.child.pid ?? null,
      cwd: session.cwd,
      traceId: session.traceId,
      state,
      running: state === "started",
      exitCode: session.exitCode,
      signal: session.signal,
      timedOut: session.timedOut,
      timeoutAction: session.timeoutAction,
      durationMs,
      cleanupAfterMs: session.cleanupAfterMs,
      commandStored: false,
      outputStored: false,
    },
    actions: [terminalNoticeAction(session)],
    dedupeKey: `terminal-session:${session.id}:${state}`,
    ttlMs: Math.max(30_000, Math.min(session.cleanupAfterMs || DONE_TTL_MS, 24 * 60 * 60_000)),
  });
}

function emitTerminalTimeoutNotice(session: TerminalSession): void {
  emitBridgeNotice({
    severity: "warning",
    code: session.timeoutAction === "observe" ? "terminal-session-timeout-alive" : "terminal-session-timeout-terminating",
    source: "terminal-session",
    message: session.timeoutAction === "observe"
      ? `Background work ${session.id} crossed its timeout threshold and remains alive for inspection.`
      : `Background work ${session.id} crossed its timeout threshold and process-tree termination was requested.`,
    details: {
      sessionId: session.id,
      name: session.name,
      pid: session.child.pid ?? null,
      traceId: session.traceId,
      timeoutMs: session.timeoutMs,
      timeoutAction: session.timeoutAction,
      timeoutExpiredAtIso: isoOrNull(session.timeoutExpiredAt),
      commandStored: false,
      outputStored: false,
      advisoryOnly: true,
    },
    actions: [terminalNoticeAction(session)],
    dedupeKey: `terminal-session:${session.id}:timeout`,
    ttlMs: Math.max(30_000, Math.min(session.cleanupAfterMs || DONE_TTL_MS, 24 * 60 * 60_000)),
  });
}

function maybeEmitTerminalActivityNotice(session: TerminalSession, activityState: "progressing" | "idle" | "stalled"): void {
  const previous = session.lastActivityState;
  session.lastActivityState = activityState;
  if (activityState === "stalled" && previous !== "stalled") {
    emitBridgeNotice({
      severity: "warning",
      code: "terminal-session-stalled",
      source: "terminal-session",
      message: `Background work ${session.id} is alive but has no recent observable output or CPU progress.`,
      details: { sessionId: session.id, name: session.name, pid: session.child.pid ?? null, traceId: session.traceId, advisoryOnly: true },
      actions: [terminalNoticeAction(session)],
      dedupeKey: `terminal-session:${session.id}:stalled`,
      ttlMs: Math.max(30_000, Math.min(session.cleanupAfterMs || DONE_TTL_MS, 24 * 60 * 60_000)),
    });
  } else if (activityState === "progressing" && previous === "stalled") {
    emitBridgeNotice({
      severity: "info",
      code: "terminal-session-progress-resumed",
      source: "terminal-session",
      message: `Background work ${session.id} resumed observable progress after a stalled interval.`,
      details: { sessionId: session.id, name: session.name, pid: session.child.pid ?? null, traceId: session.traceId, advisoryOnly: true },
      actions: [terminalNoticeAction(session)],
      dedupeKey: `terminal-session:${session.id}:progress-resumed`,
      ttlMs: Math.max(30_000, Math.min(session.cleanupAfterMs || DONE_TTL_MS, 24 * 60 * 60_000)),
    });
  }
}

async function terminalDeepSnapshot(session: TerminalSession, maxChars: number) {
  const running = isSessionRunning(session);
  const processTree = await inspectProcessTree(session.child.pid, 16);
  const now = Date.now();
  if (running && processTree.totalCpuSeconds !== null) {
    if (session.lastCpuSeconds !== null && processTree.totalCpuSeconds > session.lastCpuSeconds + 0.01) {
      session.lastProgressAt = now;
    }
    session.lastCpuSeconds = processTree.totalCpuSeconds;
  }
  const snapshot = terminalSnapshot(session, maxChars);
  if (running) maybeEmitTerminalActivityNotice(session, snapshot.activityState);
  return { ...snapshot, processTree };
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
  const timeoutAction = args.timeoutAction ?? "terminate";
  const cleanupAfterMs = clampMs(args.cleanupAfterMs, DONE_TTL_MS, 0, MAX_RUN_MS);
  const session: TerminalSession = {
    id,
    name: args.name?.trim() || null,
    command: cmd,
    cwd: resolvedCwd,
    startedAt: startedNow,
    completedAt: null,
    lastOutputAt: startedNow,
    lastProgressAt: startedNow,
    timeoutMs,
    timeoutAction,
    timedOut: false,
    timeoutExpiredAt: null,
    cleanupAfterMs,
    logFile: sessionLogFile,
    traceId: args.traceId?.trim() || null,
    child,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutLines: 0,
    stderrLines: 0,
    lastCpuSeconds: null,
    lastActivityState: null,
    exitCode: null,
    signal: null,
    timeoutHandle: null,
  };
  if (session.timeoutMs !== null) {
    session.timeoutHandle = setTimeout(() => {
      if (!isSessionRunning(session)) return;
      session.timedOut = true;
      session.timeoutExpiredAt = Date.now();
      emitTerminalTimeoutNotice(session);
      if (session.timeoutAction === "terminate") void terminateProcessTree(session.child);
    }, session.timeoutMs);
    session.timeoutHandle.unref();
  }
  child.stdout?.on("data", (chunk: Buffer) => {
    const now = Date.now();
    session.lastOutputAt = now;
    session.lastProgressAt = now;
    session.stdoutBytes += chunk.byteLength;
    session.stdoutLines += (chunk.toString().match(/\n/g) ?? []).length;
    session.stdout = appendBounded(session.stdout, chunk);
    appendSessionLog(session, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const now = Date.now();
    session.lastOutputAt = now;
    session.lastProgressAt = now;
    session.stderrBytes += chunk.byteLength;
    session.stderrLines += (chunk.toString().match(/\n/g) ?? []).length;
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
    emitTerminalLifecycleNotice(session, "completed");
  });
  terminals.set(id, session);
  emitTerminalLifecycleNotice(session, "started");
  return { id, command: cmd, cwd: resolvedCwd, pid: child.pid ?? null, logFile: session.logFile, timeoutMs, timeoutAction };
}

function getTerminal(id: string): TerminalSession {
  const session = terminals.get(id);
  if (!session) {
    const activeSessions = Array.from(terminals.values()).slice(0, 12).map((item) => ({
      id: item.id,
      name: item.name,
      running: isSessionRunning(item),
      cwd: item.cwd,
    }));
    throw new Error(`[target-not-found] Unknown terminal session: ${id}. Active sessions: ${JSON.stringify(activeSessions)}. Call terminal_list or work_show and retry with an exact returned sessionId.`);
  }
  return session;
}

function terminalWrite(id: string, input: string) {
  const session = getTerminal(id);
  if (!isSessionRunning(session)) throw new Error(`Terminal already exited: ${id}`);
  session.child.stdin?.write(input);
  return { id, writtenChars: input.length };
}

async function terminalRead(id: string, maxChars: number) {
  const session = getTerminal(id);
  return await terminalDeepSnapshot(session, maxChars);
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
      state: snap.state,
      activityState: snap.activityState,
      running: snap.running,
      exitCode: snap.exitCode,
      signal: snap.signal,
      timedOut: snap.timedOut,
      timeoutMs: snap.timeoutMs,
      timeoutAction: snap.timeoutAction,
      timeoutExpiredAtIso: snap.timeoutExpiredAtIso,
      logFile: snap.logFile,
      traceId: snap.traceId,
      startedAtIso: snap.startedAtIso,
      completedAtIso: snap.completedAtIso,
      ageMs: snap.ageMs,
      idleMs: snap.idleMs,
      progressIdleMs: snap.progressIdleMs,
      lastOutputAtIso: snap.lastOutputAtIso,
      lastProgressAtIso: snap.lastProgressAtIso,
      output: snap.output,
    };
  });
}

export const processToolModule: BridgeToolModule = {
  name: "process",
  tools: [
    { name: "run_command", description: "Run a shell command in a cwd with timeout and captured stdout/stderr. Accepts optional traceId control metadata for explicit MSSR correlation across projects or processes.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["command"], additionalProperties: false } },
    { name: "terminal_start", description: "Start non-blocking persistent terminal work and return a session id immediately. terminal_start keeps backward-compatible hard timeout behavior by default (timeoutAction=terminate); set observe to make the timeout advisory. Inspect one session deeply with terminal_read before deciding whether to stop it.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, name: { type: "string" }, logFile: { type: "string" }, timeoutMs: { type: "number", minimum: 1000, maximum: MAX_RUN_MS }, timeoutAction: { type: "string", enum: ["observe", "terminate"], default: "terminate" }, cleanupAfterMs: { type: "number", default: DONE_TTL_MS, minimum: 0, maximum: MAX_RUN_MS }, traceId: TRACE_ID_INPUT_SCHEMA }, additionalProperties: false } },
    { name: "terminal_write", description: "Write input to a persistent terminal session. Accepts optional traceId control metadata to preserve MSSR attribution through the session lifecycle.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, input: { type: "string" }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["sessionId", "input"], additionalProperties: false } },
    { name: "terminal_read", description: "Deep-inspect one persistent terminal session: bounded stdout/stderr, output counters, progress/timeout state, and a sanitized process-tree/CPU/memory summary. Accepts optional traceId control metadata.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxChars: { type: "number", default: 20000 }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["sessionId"], additionalProperties: false } },
    { name: "terminal_stop", description: "Explicitly stop the exact persistent terminal session and its process tree, then forget it. Inspect first when the session state is uncertain. Accepts optional traceId control metadata.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["sessionId"], additionalProperties: false } },
    { name: "terminal_list", description: "List persistent terminal sessions with lightweight running/progress/timeout/output metadata; does not scan every process tree.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "work_once", description: "Alias of run_command for one short project action. Requests up to 60000 ms (60 seconds) execute synchronously; a larger timeout is accepted only to return a safe redirect to work_begin/terminal_start without executing the command, so one MCP request is not held open. Accepts optional traceId control metadata for explicit MSSR correlation across projects or processes.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS, minimum: 1, maximum: MAX_RUN_MS }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["command"], additionalProperties: false } },
    { name: "work_begin", description: "Alias of terminal_start for inspectable long-running project work. timeoutAction defaults to observe: crossing timeout raises a Bridge Notice but leaves the tree alive so work_peek can show progress before an explicit work_finish. Multiple sessions may run concurrently.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, name: { type: "string" }, logFile: { type: "string" }, timeoutMs: { type: "number", minimum: 1000, maximum: MAX_RUN_MS }, timeoutAction: { type: "string", enum: ["observe", "terminate"], default: "observe" }, cleanupAfterMs: { type: "number", default: DONE_TTL_MS, minimum: 0, maximum: MAX_RUN_MS }, traceId: TRACE_ID_INPUT_SCHEMA }, additionalProperties: false } },
    { name: "work_peek", description: "Deep-inspect one project-work session by exact sessionId: output, progress/timeout state, and sanitized process-tree/CPU/memory evidence before deciding whether to stop it.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxChars: { type: "number", default: 20000 }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["sessionId"], additionalProperties: false } },
    { name: "work_show", description: "List project-work sessions with lightweight state and progress metadata without scanning every process tree. Accepts optional traceId control metadata.", inputSchema: { type: "object", properties: { traceId: TRACE_ID_INPUT_SCHEMA }, additionalProperties: false } },
    { name: "work_feed", description: "Alias of terminal_write for sending input to project work. Accepts optional traceId control metadata to preserve MSSR attribution.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, input: { type: "string" }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["sessionId", "input"], additionalProperties: false } },
    { name: "work_finish", description: "Alias of terminal_stop for stopping project work. Accepts optional traceId control metadata to preserve MSSR attribution.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, traceId: TRACE_ID_INPUT_SCHEMA }, required: ["sessionId"], additionalProperties: false } },
  ],
  handlers: {
    run_command: async (args) => {
      const parsed = z.object({ command: z.string().min(1), cwd: z.string().optional(), timeoutMs: z.number().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS), traceId: optionalTraceId }).parse(args);
      return await runShellCommand(parsed.command, parsed.cwd, parsed.timeoutMs);
    },
    terminal_start: async (args) => {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional(), name: z.string().optional(), logFile: z.string().optional(), timeoutMs: z.number().optional(), timeoutAction: z.enum(["observe", "terminate"]).default("terminate"), cleanupAfterMs: z.number().optional(), traceId: optionalTraceId }).parse(args);
      return await terminalStart(parsed);
    },
    terminal_write: (args) => {
      const parsed = z.object({ sessionId: z.string(), input: z.string(), traceId: optionalTraceId }).parse(args);
      return terminalWrite(parsed.sessionId, parsed.input);
    },
    terminal_read: async (args) => {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000), traceId: optionalTraceId }).parse(args);
      return await terminalRead(parsed.sessionId, parsed.maxChars);
    },
    terminal_stop: async (args) => {
      const parsed = z.object({ sessionId: z.string(), traceId: optionalTraceId }).parse(args);
      return await terminalStop(parsed.sessionId);
    },
    terminal_list: () => terminalList(),
    work_once: async (args) => {
      const parsed = z.object({ command: z.string().min(1), cwd: z.string().optional(), timeoutMs: z.number().positive().max(MAX_RUN_MS).default(DEFAULT_TIMEOUT_MS), traceId: optionalTraceId }).parse(args);
      if (parsed.timeoutMs > MAX_SYNC_WORK_MS) {
        return {
          executed: false,
          redirected: true,
          reason: "sync-timeout-exceeds-limit",
          requestedTimeoutMs: parsed.timeoutMs,
          maxSyncTimeoutMs: MAX_SYNC_WORK_MS,
          recommendedTool: "work_begin",
          alternateTool: "terminal_start",
          instruction: "Start the same command with work_begin/terminal_start and inspect the returned sessionId before deciding whether to stop it.",
        };
      }
      return await runShellCommand(parsed.command, parsed.cwd, parsed.timeoutMs);
    },
    work_begin: async (args) => {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional(), name: z.string().optional(), logFile: z.string().optional(), timeoutMs: z.number().optional(), timeoutAction: z.enum(["observe", "terminate"]).default("observe"), cleanupAfterMs: z.number().optional(), traceId: optionalTraceId }).parse(args);
      return await terminalStart(parsed);
    },
    work_peek: async (args) => {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000), traceId: optionalTraceId }).parse(args);
      return await terminalRead(parsed.sessionId, parsed.maxChars);
    },
    work_show: (args) => {
      z.object({ traceId: optionalTraceId }).parse(args);
      return terminalList();
    },
    work_feed: (args) => {
      const parsed = z.object({ sessionId: z.string(), input: z.string(), traceId: optionalTraceId }).parse(args);
      return terminalWrite(parsed.sessionId, parsed.input);
    },
    work_finish: async (args) => {
      const parsed = z.object({ sessionId: z.string(), traceId: optionalTraceId }).parse(args);
      return await terminalStop(parsed.sessionId);
    },
  },
};
