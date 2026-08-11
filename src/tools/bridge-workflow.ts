import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { SERVER_VERSION } from "../config.js";
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
  timedOut: boolean;
  stdout: string;
  stderr: string;
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

function verifyJobSnapshot(job: VerifyJob) {
  return {
    jobId: job.id,
    running: job.completedAt === null,
    pid: job.child.pid ?? null,
    projectRoot: job.projectRoot,
    startedAtIso: new Date(job.startedAt).toISOString(),
    completedAtIso: job.completedAt === null ? null : new Date(job.completedAt).toISOString(),
    durationMs: (job.completedAt ?? Date.now()) - job.startedAt,
    timeoutMs: job.timeoutMs,
    timedOut: job.timedOut,
    result: job.result,
    stdout: tailText(job.stdout, 30_000),
    stderr: tailText(job.stderr, 20_000),
  };
}

function startVerifyAll(projectRoot: string, expectedServerVersion: string, strictGit: boolean, timeoutMs: number) {
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
    timedOut: false,
    stdout: "",
    stderr: "",
    result: null,
  };
  verifyJobs.set(id, job);

  const timer = setTimeout(() => {
    if (job.completedAt !== null) return;
    job.timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  timer.unref();

  child.stdout.on("data", (chunk: Buffer) => {
    job.stdout = tailText(job.stdout + chunk.toString(), VERIFY_OUTPUT_MAX_CHARS);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    job.stderr = tailText(job.stderr + chunk.toString(), VERIFY_OUTPUT_MAX_CHARS);
  });
  child.on("error", (error) => {
    if (job.completedAt !== null) return;
    clearTimeout(timer);
    job.completedAt = Date.now();
    job.result = { ok: false, error: error.message, timedOut: job.timedOut };
  });
  child.on("close", (code, signal) => {
    if (job.completedAt !== null) return;
    clearTimeout(timer);
    job.completedAt = Date.now();
    job.result = { ok: code === 0 && !job.timedOut, code, signal, timedOut: job.timedOut };
  });

  return {
    started: true,
    jobId: id,
    pid: child.pid ?? null,
    projectRoot: resolvedRoot,
    timeoutMs,
    instruction: "Poll bridge_verify_status with this jobId. Full verification continues without holding the MCP request open.",
  };
}

export const bridgeWorkflowToolModule: BridgeToolModule = {
  name: "bridge-workflow",
  tools: [
    {
      name: "bridge_verify_all",
      description: "Start the full Bridge verification workflow in a background job so long verification cannot hold one MCP request open. Returns a jobId immediately; poll bridge_verify_status for completion.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          expectedServerVersion: { type: "string", default: SERVER_VERSION },
          strictGit: { type: "boolean", default: false },
          timeoutMs: { type: "number", default: 180000, minimum: 30000, maximum: 600000 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "bridge_verify_status",
      description: "Read one background bridge_verify_all job. Returns bounded stdout/stderr tails and the final result when complete.",
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
      }).parse(args);
      return startVerifyAll(parsed.cwd ?? process.cwd(), parsed.expectedServerVersion, parsed.strictGit, parsed.timeoutMs);
    },
    bridge_verify_status: (args) => {
      cleanupVerifyJobs();
      const parsed = z.object({ jobId: z.string().regex(/^bridge_verify_[A-Za-z0-9_-]+$/) }).parse(args);
      const job = verifyJobs.get(parsed.jobId);
      if (!job) throw new Error(`Unknown or expired bridge verification job: ${parsed.jobId}`);
      return verifyJobSnapshot(job);
    },
  },
};
