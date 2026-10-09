import fs from "node:fs/promises";
import path from "node:path";
import { auditMssrProjectContextHealth, discoverMssrWorkspaceRepositories } from "@mauroprime/mssr";
import { collectBridgeDocumentFreshness } from "./document-freshness-host.js";

export const PROJECT_HEALTH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECK_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION = 90;
const DEFAULT_MAX_DEPTH = 4;

export type ProjectHealthLevel = "ok" | "watch" | "review";
export type ProjectWorkspaceStatusState = "finished" | "abandoned-or-replaced";
export type ProjectWorkspaceStatus = {
  status: "absent" | "valid" | "invalid";
  state: ProjectWorkspaceStatusState | null;
  reason: string | null;
  updatedAt: string | null;
  replacedBy: string | null;
  source: ".mssr/PROJECT_STATE.md#Workspace status";
  error: string | null;
};
export type ProjectHealthItem = {
  name: string;
  relativeRoot: string;
  level: ProjectHealthLevel;
  workspaceStatus: ProjectWorkspaceStatus;
  manifestStatus: string;
  coreEntries: number;
  modules: number;
  findingCount: number;
  findingCodes: string[];
  findings: Array<{ code: string; target: string; recommendation: string }>;
  freshnessManifestStatus: "absent" | "valid" | "invalid";
  freshnessLevel: ProjectHealthLevel;
  freshnessFindingCount: number;
  freshnessFindingCodes: string[];
  freshnessReviewDocuments: string[];
  referenceAuditAvailable: boolean;
  referenceScannedMarkdown: number;
  referenceCandidateCount: number;
  referenceHighPriorityCount: number;
  referenceMediumPriorityCount: number;
  referenceLowPriorityCount: number;
  referenceConnectedCount: number;
  referenceAuditTruncated: boolean;
  referenceHighCandidates: string[];
};
export type ProjectHealthSnapshot = {
  observedAt: string;
  workspaceRoot: string;
  counts: { projects: number; initialized: number; ok: number; watch: number; review: number };
  projects: ProjectHealthItem[];
};
type ProjectHealthStore = {
  schemaVersion: 1;
  updatedAt: string;
  workspaceRoot: string;
  snapshots: ProjectHealthSnapshot[];
};

function defaultFilePath(): string {
  return process.env.BRIDGE_MCP_PROJECT_HEALTH_PATH
    ? path.resolve(process.env.BRIDGE_MCP_PROJECT_HEALTH_PATH)
    : path.resolve(process.cwd(), "data", "project-health.json");
}

function defaultWorkspaceRoot(): string {
  return path.resolve(
    process.env.BRIDGE_MCP_PROJECT_HEALTH_ROOT
      || process.env.MSSR_WORKSPACE_ROOT
      || path.dirname(process.cwd()),
  );
}

const WORKSPACE_STATUS_SOURCE = ".mssr/PROJECT_STATE.md#Workspace status" as const;
const WORKSPACE_TERMINAL_STATES = new Set<ProjectWorkspaceStatusState>(["finished", "abandoned-or-replaced"]);

function boundedStatusValue(value: string | undefined, maxLength: number): string | null {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

async function readProjectWorkspaceStatus(projectRoot: string): Promise<ProjectWorkspaceStatus> {
  const statePath = path.join(projectRoot, ".mssr", "PROJECT_STATE.md");
  let text: string;
  try {
    text = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent", state: null, reason: null, updatedAt: null, replacedBy: null, source: WORKSPACE_STATUS_SOURCE, error: null };
    }
    return { status: "invalid", state: null, reason: null, updatedAt: null, replacedBy: null, source: WORKSPACE_STATUS_SOURCE, error: "workspace status authority could not be read" };
  }

  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === "## workspace status");
  if (headingIndex < 0) {
    return { status: "absent", state: null, reason: null, updatedAt: null, replacedBy: null, source: WORKSPACE_STATUS_SOURCE, error: null };
  }

  const fields = new Map<string, string>();
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line.trim())) break;
    const match = line.match(/^\s*([A-Za-z][A-Za-z -]*):\s*(.*?)\s*$/);
    if (!match) continue;
    fields.set(match[1].trim().toLowerCase().replace(/\s+/g, "-"), match[2]);
  }

  const rawState = boundedStatusValue(fields.get("state"), 80)?.toLowerCase() ?? null;
  if (!rawState || !WORKSPACE_TERMINAL_STATES.has(rawState as ProjectWorkspaceStatusState)) {
    return {
      status: "invalid",
      state: null,
      reason: boundedStatusValue(fields.get("reason"), 240),
      updatedAt: null,
      replacedBy: boundedStatusValue(fields.get("replaced-by"), 160),
      source: WORKSPACE_STATUS_SOURCE,
      error: "State must be finished or abandoned-or-replaced",
    };
  }

  const rawUpdatedAt = boundedStatusValue(fields.get("updated-at") ?? fields.get("updated"), 80);
  if (!rawUpdatedAt) {
    return {
      status: "invalid",
      state: rawState as ProjectWorkspaceStatusState,
      reason: boundedStatusValue(fields.get("reason"), 240),
      updatedAt: null,
      replacedBy: boundedStatusValue(fields.get("replaced-by"), 160),
      source: WORKSPACE_STATUS_SOURCE,
      error: "Updated-At is required so terminal state can be ordered against later work",
    };
  }
  const parsed = Date.parse(rawUpdatedAt);
  if (!Number.isFinite(parsed)) {
    return {
      status: "invalid",
      state: rawState as ProjectWorkspaceStatusState,
      reason: boundedStatusValue(fields.get("reason"), 240),
      updatedAt: null,
      replacedBy: boundedStatusValue(fields.get("replaced-by"), 160),
      source: WORKSPACE_STATUS_SOURCE,
      error: "Updated-At must be an ISO/date-like timestamp",
    };
  }
  const updatedAt = new Date(parsed).toISOString();

  return {
    status: "valid",
    state: rawState as ProjectWorkspaceStatusState,
    reason: boundedStatusValue(fields.get("reason"), 240),
    updatedAt,
    replacedBy: boundedStatusValue(fields.get("replaced-by"), 160),
    source: WORKSPACE_STATUS_SOURCE,
    error: null,
  };
}

async function readStore(filePath = defaultFilePath()): Promise<ProjectHealthStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<ProjectHealthStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("unsupported project health store");
    return {
      schemaVersion: 1,
      updatedAt: String(parsed.updatedAt || ""),
      workspaceRoot: String(parsed.workspaceRoot || ""),
      snapshots: parsed.snapshots,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, updatedAt: "", workspaceRoot: "", snapshots: [] };
    }
    throw error;
  }
}

async function writeStore(filePath: string, store: ProjectHealthStore): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

export async function collectProjectHealthSnapshot(options: {
  workspaceRoot?: string;
  now?: Date;
  maxDepth?: number;
} = {}): Promise<ProjectHealthSnapshot> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultWorkspaceRoot());
  const now = options.now ?? new Date();
  const repos = await discoverMssrWorkspaceRepositories(workspaceRoot, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  const projects: ProjectHealthItem[] = [];

  const rank = { review: 2, watch: 1, ok: 0 } as const;
  for (const projectRoot of repos) {
    const [health, freshness, workspaceStatus] = await Promise.all([
      auditMssrProjectContextHealth(projectRoot),
      collectBridgeDocumentFreshness(projectRoot),
      readProjectWorkspaceStatus(projectRoot),
    ]);
    const relativeRoot = path.relative(workspaceRoot, projectRoot).replace(/\\/g, "/") || ".";
    const freshnessLevel: ProjectHealthLevel = freshness.manifestStatus === "invalid"
      ? "review"
      : freshness.evaluation?.level ?? "ok";
    const freshnessFindings = freshness.manifestStatus === "invalid"
      ? [{
          code: "document-freshness-manifest-invalid",
          target: ".mssr/document-freshness.json",
          recommendation: "Corrige el manifest de Document Freshness antes de confiar en sus señales; no reescribas documentos automáticamente.",
        }]
      : (freshness.evaluation?.findings ?? []).map((item) => ({
          code: `document-freshness-${item.code}`,
          target: item.impactRef ?? item.documentRef,
          recommendation: item.level === "review"
            ? `Revisa ${item.documentRef} contra sus refs declarados; la señal de freshness no prueba por sí sola una contradicción semántica.`
            : `Reúne evidencia de revisión para ${item.documentRef}; el orden actual no es concluyente.`,
        }));
    const structuralFindings = health.findings.map((item) => ({
      code: item.code,
      target: item.target,
      recommendation: item.recommendation,
    }));
    const workspaceStatusFindings = workspaceStatus.status === "invalid"
      ? [{
          code: "workspace-status-invalid",
          target: WORKSPACE_STATUS_SOURCE,
          recommendation: `Corrige ## Workspace status antes de usarlo como evidencia explícita de estado terminal: ${workspaceStatus.error ?? "contrato inválido"}.`,
        }]
      : [];
    const referenceAudit = health.referenceAudit ?? null;
    const allFindings = [...structuralFindings, ...freshnessFindings, ...workspaceStatusFindings];
    const findings = allFindings.slice(0, 24);
    const baseLevel = rank[freshnessLevel] > rank[health.level] ? freshnessLevel : health.level;
    const level: ProjectHealthLevel = workspaceStatus.status === "invalid" ? "review" : baseLevel;
    projects.push({
      name: path.basename(projectRoot),
      relativeRoot,
      level,
      workspaceStatus,
      manifestStatus: health.manifestStatus,
      coreEntries: health.coreCount,
      modules: health.moduleCount,
      findingCount: allFindings.length,
      findingCodes: [...new Set(allFindings.map((item) => item.code))].sort(),
      findings,
      freshnessManifestStatus: freshness.manifestStatus,
      freshnessLevel,
      freshnessFindingCount: freshnessFindings.length,
      freshnessFindingCodes: [...new Set(freshnessFindings.map((item) => item.code))].sort(),
      freshnessReviewDocuments: freshness.evaluation?.reviewDocuments ?? [],
      referenceAuditAvailable: Boolean(referenceAudit),
      referenceScannedMarkdown: referenceAudit?.scannedMarkdown ?? 0,
      referenceCandidateCount: referenceAudit?.candidateCount ?? 0,
      referenceHighPriorityCount: referenceAudit?.highPriorityCount ?? 0,
      referenceMediumPriorityCount: referenceAudit?.mediumPriorityCount ?? 0,
      referenceLowPriorityCount: referenceAudit?.lowPriorityCount ?? 0,
      referenceConnectedCount: referenceAudit?.connectedCount ?? 0,
      referenceAuditTruncated: referenceAudit?.truncated ?? false,
      referenceHighCandidates: (referenceAudit?.candidates ?? [])
        .filter((candidate) => candidate.reviewPriority === "high")
        .slice(0, 8)
        .map((candidate) => candidate.path),
    });
  }


  projects.sort((a, b) => rank[b.level] - rank[a.level] || b.findingCount - a.findingCount || a.relativeRoot.localeCompare(b.relativeRoot));
  return {
    observedAt: now.toISOString(),
    workspaceRoot,
    counts: {
      projects: projects.length,
      initialized: projects.filter((item) => item.manifestStatus === "valid").length,
      ok: projects.filter((item) => item.level === "ok").length,
      watch: projects.filter((item) => item.level === "watch").length,
      review: projects.filter((item) => item.level === "review").length,
    },
    projects,
  };
}

export async function captureProjectHealthIfDue(options: {
  force?: boolean;
  workspaceRoot?: string;
  now?: Date;
  filePath?: string;
  intervalMs?: number;
  retention?: number;
  maxDepth?: number;
} = {}) {
  const now = options.now ?? new Date();
  const filePath = options.filePath ?? defaultFilePath();
  const intervalMs = options.intervalMs ?? PROJECT_HEALTH_INTERVAL_MS;
  const retention = Math.max(2, Math.floor(options.retention ?? DEFAULT_RETENTION));
  const store = await readStore(filePath);
  const latest = store.snapshots.at(-1);
  const latestMs = latest ? Date.parse(latest.observedAt) : Number.NaN;
  const due = options.force === true || !Number.isFinite(latestMs) || now.getTime() - latestMs >= intervalMs;
  if (!due) return { captured: false, filePath, latest, previous: store.snapshots.at(-2) ?? null, snapshotCount: store.snapshots.length };

  const snapshot = await collectProjectHealthSnapshot({ workspaceRoot: options.workspaceRoot, now, maxDepth: options.maxDepth });
  const next: ProjectHealthStore = {
    schemaVersion: 1,
    updatedAt: snapshot.observedAt,
    workspaceRoot: snapshot.workspaceRoot,
    snapshots: [...store.snapshots, snapshot].slice(-retention),
  };
  await writeStore(filePath, next);
  return { captured: true, filePath, latest: snapshot, previous: latest ?? null, snapshotCount: next.snapshots.length };
}

export async function getProjectHealthReport(filePath = defaultFilePath()) {
  const store = await readStore(filePath);
  const latest = store.snapshots.at(-1) ?? null;
  const previous = store.snapshots.at(-2) ?? null;
  const previousByRoot = new Map((previous?.projects ?? []).map((item) => [item.relativeRoot, item]));
  const projects = (latest?.projects ?? []).map((item) => ({
    ...item,
    previousLevel: previousByRoot.get(item.relativeRoot)?.level ?? null,
    deltaFindings: previousByRoot.has(item.relativeRoot)
      ? item.findingCount - previousByRoot.get(item.relativeRoot)!.findingCount
      : null,
  }));
  return {
    schemaVersion: 1,
    updatedAt: store.updatedAt || null,
    workspaceRoot: store.workspaceRoot || null,
    snapshotCount: store.snapshots.length,
    latest: latest ? { ...latest, projects } : null,
    previousObservedAt: previous?.observedAt ?? null,
    policy: {
      cadence: "daily",
      advisoryOnly: true,
      autoEdit: false,
      contentStored: false,
      watchesNotify: false,
      reviewsNotify: true,
      retentionSnapshots: DEFAULT_RETENTION,
    },
  };
}

export function startProjectHealthScheduler(options: {
  workspaceRoot?: string;
  filePath?: string;
  intervalMs?: number;
  checkMs?: number;
  maxDepth?: number;
  onSnapshot?: (snapshot: ProjectHealthSnapshot, previous: ProjectHealthSnapshot | null) => void;
  onError?: (error: unknown) => void;
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await captureProjectHealthIfDue({
        workspaceRoot: options.workspaceRoot,
        filePath: options.filePath,
        intervalMs: options.intervalMs,
        maxDepth: options.maxDepth,
      });
      if (result.captured && result.latest) options.onSnapshot?.(result.latest, result.previous ?? null);
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), options.checkMs ?? DEFAULT_CHECK_MS);
  timer.unref();
  return { run, stop: () => clearInterval(timer) };
}
