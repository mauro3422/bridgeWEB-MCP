import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { DEFAULT_TIMEOUT_MS, MAX_CAPTURE_CHARS } from "../../config.js";
import { resolveToolPath } from "./path.js";
export { resolveToolPath } from "./path.js";

const blockedCommands = new Set([
  "format", "diskpart", "shutdown", "reboot", "halt", "poweroff",
  "bcdedit", "cipher", "takeown", "runas", "reg", "sc",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockedCommandInShellText(command: string): string | null {
  for (const blocked of blockedCommands) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_.-])${escapeRegExp(blocked)}(?:\\.exe)?(?=$|[^A-Za-z0-9_.-])`, "i");
    if (pattern.test(command)) return blocked;
  }
  return null;
}

export async function terminateProcessTree(child: ChildProcess, graceMs = 1500): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export function appendBounded(current: string, chunk: Buffer | string, maxChars = MAX_CAPTURE_CHARS): string {
  const next = current + chunk.toString();
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

export function tailText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

export type ProcessTreeEntry = {
  pid: number;
  parentPid: number;
  name: string;
  cpuSeconds: number;
  workingSetBytes: number;
  depth: number;
  activityHint: string | null;
};

export type ProcessTreeSnapshot = {
  available: boolean;
  rootPid: number | null;
  alive: boolean;
  observedAtIso: string;
  processCount: number;
  totalCpuSeconds: number | null;
  totalWorkingSetBytes: number | null;
  leaf: ProcessTreeEntry | null;
  processes: ProcessTreeEntry[];
  error?: string;
};

function safeProcessActivityHint(commandLine: string): string | null {
  const taskMatch = commandLine.match(/\b(?:npm(?:\.cmd)?\s+)?run\s+([A-Za-z0-9:._-]+)/i);
  if (taskMatch?.[1]) return `npm:${taskMatch[1]}`;
  const scriptMatches = Array.from(commandLine.matchAll(/([A-Za-z0-9_.-]+\.(?:mjs|cjs|js|ts|ps1))/gi));
  const script = scriptMatches.at(-1)?.[1];
  return script ?? null;
}

export async function inspectProcessTree(rootPid: number | null | undefined, maxProcesses = 16): Promise<ProcessTreeSnapshot> {
  const observedAtIso = new Date().toISOString();
  if (!rootPid || !Number.isInteger(rootPid) || rootPid <= 0) {
    return { available: false, rootPid: rootPid ?? null, alive: false, observedAtIso, processCount: 0, totalCpuSeconds: null, totalWorkingSetBytes: null, leaf: null, processes: [], error: "missing-root-pid" };
  }

  if (process.platform !== "win32") {
    let alive = false;
    try { process.kill(rootPid, 0); alive = true; } catch { alive = false; }
    return { available: false, rootPid, alive, observedAtIso, processCount: alive ? 1 : 0, totalCpuSeconds: null, totalWorkingSetBytes: null, leaf: null, processes: [], error: "process-tree-telemetry-not-supported-on-this-platform" };
  }

  const script = [
    "$ErrorActionPreference='Stop'",
    "$all=Get-CimInstance Win32_Process",
    `$ids=@(${rootPid})`,
    "do{$before=$ids.Count;$ids+=@($all|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId});$ids=@($ids|Sort-Object -Unique)}while($ids.Count -gt $before)",
    "$rows=@($all|Where-Object{$ids -contains [int]$_.ProcessId}|ForEach-Object{[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=[string]$_.Name;commandLine=[string]$_.CommandLine;cpuSeconds=[math]::Round((([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000000),3);workingSetBytes=[int64]$_.WorkingSetSize}})",
    "$rows|ConvertTo-Json -Compress -Depth 3",
  ].join(";");

  return await new Promise<ProcessTreeSnapshot>((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { shell: false, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (snapshot: ProcessTreeSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(snapshot);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, rootPid, alive: true, observedAtIso: new Date().toISOString(), processCount: 0, totalCpuSeconds: null, totalWorkingSetBytes: null, leaf: null, processes: [], error: "process-tree-inspection-timeout" });
    }, 5000);
    timer.unref();
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk, 64_000); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk, 8_000); });
    child.once("error", (error) => finish({ available: false, rootPid, alive: true, observedAtIso: new Date().toISOString(), processCount: 0, totalCpuSeconds: null, totalWorkingSetBytes: null, leaf: null, processes: [], error: error.message }));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish({ available: false, rootPid, alive: false, observedAtIso: new Date().toISOString(), processCount: 0, totalCpuSeconds: null, totalWorkingSetBytes: null, leaf: null, processes: [], error: tailText(stderr.trim() || `process-tree-inspection-exit-${code}`, 1000) });
        return;
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : [];
        const rawRows = Array.isArray(parsed) ? parsed : [parsed];
        const base = rawRows
          .filter((row) => row && Number.isFinite(Number(row.pid)))
          .map((row) => ({
            pid: Number(row.pid),
            parentPid: Number(row.parentPid) || 0,
            name: String(row.name ?? "unknown"),
            cpuSeconds: Number(row.cpuSeconds) || 0,
            workingSetBytes: Number(row.workingSetBytes) || 0,
            commandLine: String(row.commandLine ?? ""),
          }));
        const byPid = new Map(base.map((row) => [row.pid, row]));
        const depthFor = (pid: number) => {
          let depth = 0;
          let current = byPid.get(pid);
          const seen = new Set<number>();
          while (current && current.pid !== rootPid && byPid.has(current.parentPid) && !seen.has(current.parentPid)) {
            seen.add(current.parentPid);
            depth += 1;
            current = byPid.get(current.parentPid);
          }
          return depth;
        };
        const rows: ProcessTreeEntry[] = base.map((row) => ({
          pid: row.pid,
          parentPid: row.parentPid,
          name: row.name,
          cpuSeconds: row.cpuSeconds,
          workingSetBytes: row.workingSetBytes,
          depth: depthFor(row.pid),
          activityHint: safeProcessActivityHint(row.commandLine),
        }));
        const childParents = new Set(rows.map((row) => row.parentPid));
        const leaf = [...rows]
          .filter((row) => !childParents.has(row.pid))
          .sort((a, b) => b.depth - a.depth || b.cpuSeconds - a.cpuSeconds)[0]
          ?? [...rows].sort((a, b) => b.depth - a.depth || b.cpuSeconds - a.cpuSeconds)[0]
          ?? null;
        const limited = [...rows].sort((a, b) => a.depth - b.depth || a.pid - b.pid).slice(0, Math.max(1, Math.min(maxProcesses, 32)));
        finish({
          available: true,
          rootPid,
          alive: rows.length > 0,
          observedAtIso: new Date().toISOString(),
          processCount: rows.length,
          totalCpuSeconds: Math.round(rows.reduce((sum, row) => sum + row.cpuSeconds, 0) * 1000) / 1000,
          totalWorkingSetBytes: rows.reduce((sum, row) => sum + row.workingSetBytes, 0),
          leaf,
          processes: limited,
        });
      } catch (error) {
        finish({ available: false, rootPid, alive: false, observedAtIso: new Date().toISOString(), processCount: 0, totalCpuSeconds: null, totalWorkingSetBytes: null, leaf: null, processes: [], error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}

export type BackgroundActivityState = "completed" | "progressing" | "idle" | "stalled" | "timed-out-alive";

export function classifyBackgroundActivity(input: {
  running: boolean;
  timeoutExpired: boolean;
  now: number;
  lastProgressAt: number;
  idleAfterMs?: number;
  stalledAfterMs?: number;
}): { state: BackgroundActivityState; activityState: Exclude<BackgroundActivityState, "completed" | "timed-out-alive">; progressIdleMs: number } {
  const progressIdleMs = Math.max(0, input.now - input.lastProgressAt);
  const idleAfterMs = input.idleAfterMs ?? 30_000;
  const stalledAfterMs = Math.max(idleAfterMs, input.stalledAfterMs ?? 120_000);
  const activityState = progressIdleMs <= idleAfterMs ? "progressing" : progressIdleMs <= stalledAfterMs ? "idle" : "stalled";
  if (!input.running) return { state: "completed", activityState, progressIdleMs };
  if (input.timeoutExpired) return { state: "timed-out-alive", activityState, progressIdleMs };
  return { state: activityState, activityState, progressIdleMs };
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
  const blocked = blockedCommands.has(base) ? base : blockedCommandInShellText(command);
  if (blocked) throw new Error(`Command blocked by bridge-mcp policy: ${blocked}`);
}

export async function runShellCommand(command: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  assertCommandAllowed(command);
  const resolvedCwd = resolveToolPath(cwd ?? process.cwd(), { access: "cwd" });
  if (!(await fileExists(resolvedCwd))) throw new Error(`cwd does not exist: ${resolvedCwd}`);
  return await new Promise<Record<string, unknown>>((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, { cwd: resolvedCwd, shell: true, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ command, cwd: resolvedCwd, code, signal, timedOut, durationMs: Date.now() - startedAt, stdout, stderr });
    });
  });
}

export async function runProcess(
  command: string,
  args: string[],
  cwd?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stdin?: string | Buffer,
): Promise<Record<string, unknown>> {
  const resolvedCwd = resolveToolPath(cwd ?? process.cwd(), { access: "cwd" });
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
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
    if (stdin !== undefined) child.stdin?.end(stdin);
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

