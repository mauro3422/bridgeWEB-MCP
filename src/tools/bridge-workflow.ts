import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { SERVER_VERSION } from "../config.js";
import { emitBridgeNotice } from "../notices.js";
import { classifyBackgroundActivity, inspectProcessTree, terminateProcessTree } from "./shared/process.js";
import { resolveToolPath } from "./shared/path.js";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

const VERIFY_JOB_TTL_MS = 30 * 60_000;
const VERIFY_JOB_MAX = 16;
const VERIFY_OUTPUT_MAX_CHARS = 60_000;

type VerifyJob = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  projectRoot: string;
  startedAt: number;
  completedAt: number | null;
  timeoutMs: number;
  timeoutAction: "observe" | "terminate";
  timedOut: boolean;
  timeoutExpiredAt: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutLines: number;
  stderrLines: number;
  lastOutputAt: number;
  lastProgressAt: number;
  lastCpuSeconds: number | null;
  lastCpuSampleAt: number | null;
  lastActivityState: "progressing" | "idle" | "stalled" | null;
  result: Record<string, unknown> | null;
};

const verifyJobs = new Map<string, VerifyJob>();
let verifyJobCounter = 0;

function tailText(text: string, maxChars: number) {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function cleanupVerifyJobs() {
  const now = Date.now();
  for (const [id, job] of verifyJobs) {
    if (job.completedAt !== null && now - job.completedAt > VERIFY_JOB_TTL_MS) verifyJobs.delete(id);
  }
  while (verifyJobs.size > VERIFY_JOB_MAX) {
    const oldest = verifyJobs.keys().next().value as string | undefined;
    if (!oldest) break;
    const job = verifyJobs.get(oldest);
    if (job && job.completedAt === null) break;
    verifyJobs.delete(oldest);
  }
}

function verifyStatusAction(job: VerifyJob) {
  return {
    label: "Inspect verification",
    toolName: "bridge_verify_status",
    arguments: { jobId: job.id },
    instruction: "Inspect the exact background verification job before deciding whether it should continue or be terminated.",
  };
}

function emitVerifyTimeoutNotice(job: VerifyJob) {
  emitBridgeNotice({
    severity: "warning",
    code: job.timeoutAction === "observe" ? "bridge-verify-timeout-alive" : "bridge-verify-timeout-terminating",
    source: "bridge-verify-job",
    message: job.timeoutAction === "observe"
      ? `Bridge verification ${job.id} crossed its timeout threshold but was left alive for inspection.`
      : `Bridge verification ${job.id} crossed its timeout threshold and process-tree termination was requested.`,
    details: {
      jobId: job.id,
      pid: job.child.pid ?? null,
      timeoutMs: job.timeoutMs,
      timeoutAction: job.timeoutAction,
      timeoutExpiredAtIso: job.timeoutExpiredAt === null ? null : new Date(job.timeoutExpiredAt).toISOString(),
      commandStored: false,
      outputStored: false,
      advisoryOnly: true,
    },
    actions: [verifyStatusAction(job)],
    dedupeKey: `bridge-verify:${job.id}:timeout`,
    ttlMs: VERIFY_JOB_TTL_MS,
  });
}

function maybeEmitVerifyActivityNotice(job: VerifyJob, activityState: "progressing" | "idle" | "stalled") {
  const previous = job.lastActivityState;
  job.lastActivityState = activityState;
  if (activityState === "stalled" && previous !== "stalled") {
    emitBridgeNotice({
      severity: "warning",
      code: "bridge-background-job-stalled",
      source: "bridge-verify-job",
      message: `Bridge verification ${job.id} is alive but has no recent observable output or CPU progress.`,
      details: { jobId: job.id, pid: job.child.pid ?? null, advisoryOnly: true },
      actions: [verifyStatusAction(job)],
      dedupeKey: `bridge-verify:${job.id}:stalled`,
      ttlMs: VERIFY_JOB_TTL_MS,
    });
  } else if (activityState === "progressing" && previous === "stalled") {
    emitBridgeNotice({
      severity: "info",
      code: "bridge-background-job-progress-resumed",
      source: "bridge-verify-job",
      message: `Bridge verification ${job.id} resumed observable progress after a stalled interval.`,
      details: { jobId: job.id, pid: job.child.pid ?? null, advisoryOnly: true },
      actions: [verifyStatusAction(job)],
      dedupeKey: `bridge-verify:${job.id}:progress-resumed`,
      ttlMs: VERIFY_JOB_TTL_MS,
    });
  }
}

async function verifyJobSnapshot(job: VerifyJob) {
  const now = Date.now();
  const running = job.completedAt === null;
  const processTree = running ? await inspectProcessTree(job.child.pid) : await inspectProcessTree(job.child.pid, 8);
  if (running && processTree.totalCpuSeconds !== null) {
    if (job.lastCpuSeconds !== null && processTree.totalCpuSeconds > job.lastCpuSeconds + 0.01) {
      job.lastProgressAt = now;
    }
    job.lastCpuSeconds = processTree.totalCpuSeconds;
    job.lastCpuSampleAt = now;
  }
  const timeoutExpired = job.timedOut || now - job.startedAt >= job.timeoutMs;
  const activity = classifyBackgroundActivity({
    running,
    timeoutExpired,
    now,
    lastProgressAt: job.lastProgressAt,
  });
  if (running) maybeEmitVerifyActivityNotice(job, activity.activityState);
  return {
    jobId: job.id,
    state: activity.state,
    activityState: activity.activityState,
    running,
    pid: job.child.pid ?? null,
    projectRoot: job.projectRoot,
    startedAtIso: new Date(job.startedAt).toISOString(),
    completedAtIso: job.completedAt === null ? null : new Date(job.completedAt).toISOString(),
    durationMs: (job.completedAt ?? now) - job.startedAt,
    timeoutMs: job.timeoutMs,
    timeoutAction: job.timeoutAction,
    timedOut: timeoutExpired,
    timeoutExpired,
    timeoutExpiredAtIso: job.timeoutExpiredAt === null ? null : new Date(job.timeoutExpiredAt).toISOString(),
    progressIdleMs: activity.progressIdleMs,
    lastOutputAtIso: new Date(job.lastOutputAt).toISOString(),
    lastProgressAtIso: new Date(job.lastProgressAt).toISOString(),
    output: {
      stdoutBytes: job.stdoutBytes,
      stderrBytes: job.stderrBytes,
      stdoutLines: job.stdoutLines,
      stderrLines: job.stderrLines,
      bufferedStdoutChars: job.stdout.length,
      bufferedStderrChars: job.stderr.length,
    },
    processTree,
    result: job.result,
    stdout: tailText(job.stdout, 30_000),
    stderr: tailText(job.stderr, 20_000),
  };
}

function startVerifyAll(projectRoot: string, expectedServerVersion: string, strictGit: boolean, timeoutMs: number, timeoutAction: "observe" | "terminate") {
  cleanupVerifyJobs();
  const resolvedRoot = resolveToolPath(projectRoot, { access: "cwd" });
  const args = [
    "-NoProfile",
    "-File",
    ".\\scripts\\verify-all.ps1",
    "-ProjectRoot",
    resolvedRoot,
    "-ExpectedServerVersion",
    expectedServerVersion,
  ];
  if (strictGit) args.push("-StrictGit");

  const child = spawn("powershell", args, { cwd: resolvedRoot, shell: false, windowsHide: true, env: process.env });
  const id = `bridge_verify_${Date.now()}_${++verifyJobCounter}`;
  const job: VerifyJob = {
    id,
    child,
    projectRoot: resolvedRoot,
    startedAt: Date.now(),
    completedAt: null,
    timeoutMs,
    timeoutAction,
    timedOut: false,
    timeoutExpiredAt: null,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutLines: 0,
    stderrLines: 0,
    lastOutputAt: Date.now(),
    lastProgressAt: Date.now(),
    lastCpuSeconds: null,
    lastCpuSampleAt: null,
    lastActivityState: null,
    result: null,
  };
  verifyJobs.set(id, job);

  const timer = setTimeout(() => {
    if (job.completedAt !== null) return;
    job.timedOut = true;
    job.timeoutExpiredAt = Date.now();
    emitVerifyTimeoutNotice(job);
    if (job.timeoutAction === "terminate") void terminateProcessTree(child);
  }, timeoutMs);
  timer.unref();

  child.stdout.on("data", (chunk: Buffer) => {
    const now = Date.now();
    job.stdoutBytes += chunk.byteLength;
    job.stdoutLines += (chunk.toString().match(/\n/g) ?? []).length;
    job.lastOutputAt = now;
    job.lastProgressAt = now;
    job.stdout = tailText(job.stdout + chunk.toString(), VERIFY_OUTPUT_MAX_CHARS);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const now = Date.now();
    job.stderrBytes += chunk.byteLength;
    job.stderrLines += (chunk.toString().match(/\n/g) ?? []).length;
    job.lastOutputAt = now;
    job.lastProgressAt = now;
    job.stderr = tailText(job.stderr + chunk.toString(), VERIFY_OUTPUT_MAX_CHARS);
  });
  child.on("error", (error) => {
    if (job.completedAt !== null) return;
    clearTimeout(timer);
    job.completedAt = Date.now();
    job.result = { ok: false, error: error.message, timedOut: job.timedOut, timeoutAction: job.timeoutAction };
  });
  child.on("close", (code, signal) => {
    if (job.completedAt !== null) return;
    clearTimeout(timer);
    job.completedAt = Date.now();
    job.result = { ok: code === 0 && !(job.timeoutAction === "terminate" && job.timedOut), code, signal, timedOut: job.timedOut, timeoutAction: job.timeoutAction };
  });

  return {
    started: true,
    jobId: id,
    pid: child.pid ?? null,
    projectRoot: resolvedRoot,
    timeoutMs,
    timeoutAction,
    instruction: "Poll bridge_verify_status with this jobId. Full verification continues without holding the MCP request open; timeoutAction=observe leaves an over-deadline job alive for inspection.",
  };
}

export const bridgeWorkflowToolModule: BridgeToolModule = {
  name: "bridge-workflow",
  tools: [
    {
      name: "bridge_verify_all",
      description: "Start the full Bridge verification workflow in a background job so long verification cannot hold one MCP request open. Returns a jobId immediately; poll bridge_verify_status for progress/completion. timeoutAction=observe (default) treats timeout as an attention deadline and leaves the process tree alive for inspection; timeoutAction=terminate explicitly requests process-tree termination.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          expectedServerVersion: { type: "string", default: SERVER_VERSION },
          strictGit: { type: "boolean", default: false },
          timeoutMs: { type: "number", default: 180000, minimum: 30000, maximum: 600000 },
          timeoutAction: { type: "string", enum: ["observe", "terminate"], default: "observe" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "bridge_verify_status",
      description: "Inspect one background bridge_verify_all job. Reports running/completed state, timeout-alive status, observable activity, bounded output counters/tails, and a sanitized process-tree summary before any termination decision.",
      inputSchema: {
        type: "object",
        properties: { jobId: { type: "string", pattern: "^bridge_verify_[A-Za-z0-9_-]+$" } },
        required: ["jobId"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    bridge_verify_all: (args) => {
      const parsed = z.object({
        cwd: z.string().optional(),
        expectedServerVersion: z.string().default(SERVER_VERSION),
        strictGit: z.boolean().default(false),
        timeoutMs: z.number().int().min(30000).max(600000).default(180000),
        timeoutAction: z.enum(["observe", "terminate"]).default("observe"),
      }).parse(args);
      return startVerifyAll(parsed.cwd ?? process.cwd(), parsed.expectedServerVersion, parsed.strictGit, parsed.timeoutMs, parsed.timeoutAction);
    },
    bridge_verify_status: async (args) => {
      cleanupVerifyJobs();
      const parsed = z.object({ jobId: z.string().regex(/^bridge_verify_[A-Za-z0-9_-]+$/) }).parse(args);
      const job = verifyJobs.get(parsed.jobId);
      if (!job) throw new Error(`Unknown or expired bridge verification job: ${parsed.jobId}`);
      return await verifyJobSnapshot(job);
    },
  },
};
