import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { DEFAULT_TIMEOUT_MS } from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { appendBounded, assertCommandAllowed, fileExists, resolveToolPath, runShellCommand, tailText } from "./shared/process.js";

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

function defaultShellCommand() {
  return process.platform === "win32" ? "powershell.exe -NoLogo -NoProfile" : "bash";
}

async function terminalStart(command?: string, cwd?: string) {
  const cmd = command?.trim() || defaultShellCommand();
  assertCommandAllowed(cmd);
  const resolvedCwd = cwd ? resolveToolPath(cwd) : process.cwd();
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  const id = `term_${Date.now()}_${++terminalCounter}`;
  const child = spawn(cmd, { cwd: resolvedCwd, shell: true, windowsHide: true, env: process.env });
  const session: TerminalSession = { id, command: cmd, cwd: resolvedCwd, startedAt: Date.now(), child, stdout: "", stderr: "", exitCode: null, signal: null };
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

export function terminalList() {
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

export const processToolModule: BridgeToolModule = {
  name: "process",
  tools: [
    { name: "run_command", description: "Run a shell command in a cwd with timeout and captured stdout/stderr.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number", default: DEFAULT_TIMEOUT_MS } }, required: ["command"], additionalProperties: false } },
    { name: "terminal_start", description: "Start a persistent terminal process and return a session id.", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" } }, additionalProperties: false } },
    { name: "terminal_write", description: "Write input to a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, input: { type: "string" } }, required: ["sessionId", "input"], additionalProperties: false } },
    { name: "terminal_read", description: "Read buffered stdout/stderr from a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxChars: { type: "number", default: 20000 } }, required: ["sessionId"], additionalProperties: false } },
    { name: "terminal_stop", description: "Stop and forget a persistent terminal session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
    { name: "terminal_list", description: "List active persistent terminal sessions.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  ],
  handlers: {
    run_command: async (args) => {
      const parsed = z.object({ command: z.string().min(1), cwd: z.string().optional(), timeoutMs: z.number().positive().max(10 * 60_000).default(DEFAULT_TIMEOUT_MS) }).parse(args);
      return await runShellCommand(parsed.command, parsed.cwd, parsed.timeoutMs);
    },
    terminal_start: async (args) => {
      const parsed = z.object({ command: z.string().optional(), cwd: z.string().optional() }).parse(args);
      return await terminalStart(parsed.command, parsed.cwd);
    },
    terminal_write: (args) => {
      const parsed = z.object({ sessionId: z.string(), input: z.string() }).parse(args);
      return terminalWrite(parsed.sessionId, parsed.input);
    },
    terminal_read: (args) => {
      const parsed = z.object({ sessionId: z.string(), maxChars: z.number().positive().default(20000) }).parse(args);
      return terminalRead(parsed.sessionId, parsed.maxChars);
    },
    terminal_stop: (args) => {
      const parsed = z.object({ sessionId: z.string() }).parse(args);
      return terminalStop(parsed.sessionId);
    },
    terminal_list: () => terminalList(),
  },
};
