import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_TIMEOUT_MS, MAX_CAPTURE_CHARS } from "../../config.js";

const blockedCommands = new Set([
  "format", "diskpart", "shutdown", "reboot", "halt", "poweroff",
  "bcdedit", "cipher", "takeown", "runas", "reg", "sc",
]);

export function resolveToolPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string") throw new Error("Path must be a non-empty string.");
  return path.resolve(inputPath);
}

export function appendBounded(current: string, chunk: Buffer | string, maxChars = MAX_CAPTURE_CHARS): string {
  const next = current + chunk.toString();
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

export function tailText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function getBaseCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  const first = trimmed.split(/\s+/)[0] ?? "";
  return first.replace(/^["']|["']$/g, "").toLowerCase();
}

export function assertCommandAllowed(command: string) {
  const base = getBaseCommand(command);
  if (blockedCommands.has(base)) throw new Error(`Command blocked by bridge-mcp policy: ${base}`);
}

export async function runShellCommand(command: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  assertCommandAllowed(command);
  const resolvedCwd = cwd ? resolveToolPath(cwd) : process.cwd();
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  return await new Promise<Record<string, unknown>>((resolve) => {
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
      resolve({ command, cwd: resolvedCwd, code, signal, timedOut, durationMs: Date.now() - startedAt, stdout, stderr });
    });
  });
}

export async function runProcess(command: string, args: string[], cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const resolvedCwd = cwd ? resolveToolPath(cwd) : process.cwd();
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
    child.on("error", (error) => finish({ command: commandLine, cwd: resolvedCwd, code: null, signal: null, timedOut, durationMs: Date.now() - startedAt, stdout, stderr, error: error.message }));
    child.on("close", (code, signal) => finish({ command: commandLine, cwd: resolvedCwd, code, signal, timedOut, durationMs: Date.now() - startedAt, stdout, stderr }));
  });
}

export function summarizeCommand(result: Record<string, unknown>) {
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
