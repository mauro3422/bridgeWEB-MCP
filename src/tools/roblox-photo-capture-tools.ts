import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { recordMssrCheckpoint } from "../mssr-observatory.js";
import { resolveToolPath, runProcess, summarizeCommand } from "./shared/process.js";
import type { BridgeToolModule } from "./types.js";

type CaptureAttempt = { status?: unknown };
type CaptureResult = {
  id?: unknown;
  status?: unknown;
  attemptCount?: unknown;
  attempts?: CaptureAttempt[];
  error?: unknown;
};
type CaptureManifest = {
  schemaVersion?: unknown;
  jobId?: unknown;
  technicalStatus?: unknown;
  status?: unknown;
  results?: CaptureResult[];
  duplicateHashes?: unknown[];
  cleanup?: { errors?: unknown[]; returnedToEdit?: unknown; moduleCleanupOk?: unknown };
  capturedCount?: unknown;
  failedCount?: unknown;
};

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const text = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Expected a JSON object: ${filePath}`);
  return parsed as Record<string, unknown>;
}

function captureNotices(manifest: CaptureManifest, commandSummary: ReturnType<typeof summarizeCommand>) {
  const notices: Array<Record<string, unknown>> = [];
  const results = Array.isArray(manifest.results) ? manifest.results : [];
  const retried = results.filter((item) => Number(item.attemptCount || 0) > 1);
  if (retried.length > 0) {
    notices.push({
      severity: "warning",
      code: "photo-rig-shot-retry",
      source: "roblox_photo_capture_job",
      message: `${retried.length} toma(s) requirieron reintento: ${retried.map((item) => String(item.id || "unknown")).join(", ")}.`,
      details: { shots: retried.map((item) => ({ id: item.id, attemptCount: item.attemptCount })) },
      dedupeKey: `photo-rig-shot-retry:${String(manifest.jobId || "unknown")}`,
    });
  }
  if (manifest.technicalStatus === "partial") {
    notices.push({
      severity: "warning",
      code: "photo-rig-job-partial",
      source: "roblox_photo_capture_job",
      message: `El job ${String(manifest.jobId || "unknown")} terminó parcial; las tomas válidas fueron preservadas.`,
      details: { capturedCount: manifest.capturedCount, failedCount: manifest.failedCount },
      dedupeKey: `photo-rig-job-partial:${String(manifest.jobId || "unknown")}`,
    });
  } else if (manifest.technicalStatus === "failed") {
    notices.push({
      severity: "error",
      code: "photo-rig-job-failed",
      source: "roblox_photo_capture_job",
      message: `El job ${String(manifest.jobId || "unknown")} no produjo ninguna toma utilizable.`,
      details: { capturedCount: manifest.capturedCount, failedCount: manifest.failedCount },
      dedupeKey: `photo-rig-job-failed:${String(manifest.jobId || "unknown")}`,
    });
  }
  if (Array.isArray(manifest.duplicateHashes) && manifest.duplicateHashes.length > 0) {
    notices.push({
      severity: "error",
      code: "photo-rig-duplicate-view-hash",
      source: "roblox_photo_capture_job",
      message: "Dos o más vistas semánticamente distintas produjeron el mismo hash; no deben tratarse como evidencia independiente.",
      details: { duplicateHashes: manifest.duplicateHashes },
      dedupeKey: `photo-rig-duplicate-view-hash:${String(manifest.jobId || "unknown")}`,
    });
  }
  const cleanupErrors = Array.isArray(manifest.cleanup?.errors) ? manifest.cleanup?.errors : [];
  if (cleanupErrors.length > 0 || manifest.cleanup?.returnedToEdit === false || manifest.cleanup?.moduleCleanupOk === false) {
    notices.push({
      severity: "warning",
      code: "photo-rig-cleanup-incomplete",
      source: "roblox_photo_capture_job",
      message: "El job fotográfico dejó una anomalía de cleanup o no confirmó el retorno limpio a Edit.",
      details: { cleanup: manifest.cleanup },
      dedupeKey: `photo-rig-cleanup-incomplete:${String(manifest.jobId || "unknown")}`,
    });
  }
  if (commandSummary.timedOut) {
    notices.push({
      severity: "error",
      code: "photo-rig-process-timeout",
      source: "roblox_photo_capture_job",
      message: "El proceso orquestador superó su timeout; revise el manifest y el estado de Studio antes de continuar.",
      details: { durationMs: commandSummary.durationMs },
      dedupeKey: `photo-rig-process-timeout:${String(manifest.jobId || "unknown")}`,
    });
  }
  if (manifest.status === "rejected" && manifest.technicalStatus !== "failed") {
    notices.push({
      severity: "warning",
      code: "photo-rig-evidence-rejected",
      source: "roblox_photo_capture_job",
      message: "El lote produjo archivos, pero su contrato de calidad o integridad quedó rechazado.",
      details: { technicalStatus: manifest.technicalStatus, status: manifest.status },
      dedupeKey: `photo-rig-evidence-rejected:${String(manifest.jobId || "unknown")}`,
    });
  }
  return notices;
}

export const robloxPhotoCaptureToolModule: BridgeToolModule = {
  name: "roblox-photo-capture",
  tools: [
    {
      name: "roblox_photo_capture_job",
      description: "Run one resilient Roblox Photo Rig capture job from an existing photo-plan. The tool keeps one Play Client, processes shots sequentially, retries only failed shots, treats stable PNG files as authoritative, writes a schema-v2 manifest, and returns partial evidence instead of discarding successful views. It does not steal Windows focus and does not invoke the window-capture fallback automatically.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Project root containing tools/visual_benchmark/photo_rig." },
          planPath: { type: "string", description: "Existing photo-plan JSON path inside projectRoot." },
          retriesPerShot: { type: "number", default: 2, minimum: 0, maximum: 5 },
          shotTimeoutMs: { type: "number", default: 30000, minimum: 5000, maximum: 120000 },
          clientTimeoutMs: { type: "number", default: 20000, minimum: 5000, maximum: 60000 },
          overwrite: { type: "boolean", default: false },
          simulateFirstFailure: { type: "string", description: "Optional capture id used only to verify per-shot retry behavior." },
          jobId: { type: "string", description: "Optional explicit job id for reproducible tests." },
          traceId: { type: "string", description: "MSSR trace id. When provided, the verified manifest records a primary outcome for roblox-photo-rig-capture." },
          supportingSkills: { type: "array", items: { type: "string" }, maxItems: 24 },
        },
        required: ["projectRoot", "planPath"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    roblox_photo_capture_job: async (args) => {
      const parsed = z.object({
        projectRoot: z.string().min(1),
        planPath: z.string().min(1),
        retriesPerShot: z.number().int().min(0).max(5).default(2),
        shotTimeoutMs: z.number().int().min(5000).max(120000).default(30000),
        clientTimeoutMs: z.number().int().min(5000).max(60000).default(20000),
        overwrite: z.boolean().default(false),
        simulateFirstFailure: z.string().min(1).optional(),
        jobId: z.string().min(1).optional(),
        traceId: z.string().regex(/^[A-Za-z0-9._:-]{6,128}$/).optional(),
        supportingSkills: z.array(z.string().max(160)).max(24).default([]),
      }).parse(args);

      const projectRoot = resolveToolPath(parsed.projectRoot, { access: "cwd" });
      const rootStat = await fs.stat(projectRoot);
      if (!rootStat.isDirectory()) throw new Error(`projectRoot is not a directory: ${projectRoot}`);
      const planPath = resolveToolPath(parsed.planPath, { access: "read" });
      if (!isInside(projectRoot, planPath)) throw new Error("planPath must be inside projectRoot.");
      if (path.extname(planPath).toLowerCase() !== ".json") throw new Error("planPath must be a JSON file.");
      const plan = await readJson(planPath);
      const captures = Array.isArray(plan.captures) ? plan.captures : [];
      if (captures.length === 0) throw new Error("Photo plan contains no captures.");

      const scriptPath = path.join(projectRoot, "tools", "visual_benchmark", "photo_rig", "capture_service_bundle.mjs");
      const scriptStat = await fs.stat(scriptPath).catch(() => null);
      if (!scriptStat?.isFile()) throw new Error(`Capture bundle script is missing: ${scriptPath}`);
      const resultPath = path.join(path.dirname(planPath), "capture-results.json");
      const commandArgs = [
        scriptPath,
        planPath,
        "--retries", String(parsed.retriesPerShot),
        "--shot-timeout-ms", String(parsed.shotTimeoutMs),
        "--client-timeout-ms", String(parsed.clientTimeoutMs),
      ];
      if (parsed.overwrite) commandArgs.push("--overwrite");
      if (parsed.simulateFirstFailure) commandArgs.push("--simulate-first-failure", parsed.simulateFirstFailure);
      if (parsed.jobId) commandArgs.push("--job-id", parsed.jobId);

      const maximumAttempts = parsed.retriesPerShot + 1;
      const timeoutMs = Math.min(
        30 * 60 * 1000,
        Math.max(90_000, captures.length * maximumAttempts * (parsed.shotTimeoutMs + 12_000) + 60_000),
      );
      const commandResult = await runProcess(process.execPath, commandArgs, projectRoot, timeoutMs);
      const commandSummary = summarizeCommand(commandResult);
      const manifestExists = await fs.stat(resultPath).then((stat) => stat.isFile()).catch(() => false);
      if (!manifestExists) {
        throw new Error(`Photo capture job produced no manifest. ${commandSummary.stderrTail || commandSummary.stdoutTail || commandSummary.error || "Unknown failure."}`);
      }
      const manifest = await readJson(resultPath) as CaptureManifest;
      if (manifest.schemaVersion !== 2) throw new Error(`Expected capture manifest schemaVersion 2 at ${resultPath}.`);

      const capturedCount = Math.max(0, Number(manifest.capturedCount || 0));
      const failedCount = Math.max(0, Number(manifest.failedCount || 0));
      const measuredCount = capturedCount + failedCount;
      const ok = manifest.technicalStatus === "complete" && manifest.status !== "rejected";
      const outcomeStatus: "success" | "partial" | "failed" = ok
        ? "success"
        : manifest.technicalStatus === "failed" || capturedCount === 0
          ? "failed"
          : "partial";
      const technicalScore = measuredCount > 0 ? capturedCount / measuredCount : ok ? 1 : 0;
      const notices = captureNotices(manifest, commandSummary);
      const outcomeEvent = parsed.traceId
        ? recordMssrCheckpoint({
          traceId: parsed.traceId,
          eventType: "outcome",
          caller: "chatgpt-web",
          stage: "close",
          primarySkill: "roblox-photo-rig-capture",
          supportingSkills: parsed.supportingSkills,
          status: outcomeStatus,
          metricName: "photo-capture-technical-acceptance",
          score: technicalScore,
          accepted: ok,
          evidenceKind: "manifest",
          evidenceRef: resultPath,
          verificationPassed: ok,
          summary: `Photo Rig manifest: technicalStatus=${String(manifest.technicalStatus)}, status=${String(manifest.status)}, captured=${capturedCount}, failed=${failedCount}.`,
        })
        : null;
      if (!parsed.traceId) {
        notices.push({
          severity: "warning",
          code: "photo-rig-mssr-trace-missing",
          source: "roblox_photo_capture_job",
          message: "La captura terminó sin traceId MSSR; el resultado técnico no pudo atribuirse automáticamente a la skill primaria.",
          details: { primarySkill: "roblox-photo-rig-capture", resultPath },
          dedupeKey: `photo-rig-mssr-trace-missing:${String(manifest.jobId || resultPath)}`,
        });
      }

      return {
        ok,
        projectRoot,
        planPath,
        resultPath,
        command: commandSummary,
        manifest,
        mssrOutcome: {
          recorded: Boolean(outcomeEvent),
          traceId: parsed.traceId ?? null,
          eventId: outcomeEvent?.id ?? null,
          primarySkill: "roblox-photo-rig-capture",
          supportingSkills: parsed.supportingSkills,
          status: outcomeStatus,
          metricName: "photo-capture-technical-acceptance",
          score: technicalScore,
          accepted: ok,
          evidenceKind: "manifest",
          evidenceRef: resultPath,
          supersedableByFinalReview: true,
        },
        fallback: {
          used: false,
          availableTool: "roblox_studio_window_capture_save",
          policy: "explicit-only; never invoked automatically because it can steal Windows focus",
        },
        __bridgeNotices: notices,
      };
    },
  },
};
