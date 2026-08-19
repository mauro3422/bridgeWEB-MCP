import fs from "node:fs/promises";
import path from "node:path";
import { auditMssrProjectContextHealth, discoverMssrWorkspaceRepositories } from "@mauroprime/mssr";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECK_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION = 90;
const DEFAULT_MAX_DEPTH = 4;

export type ProjectHealthLevel = "ok" | "watch" | "review";
export type ProjectHealthItem = {
  name: string;
  relativeRoot: string;
  level: ProjectHealthLevel;
  manifestStatus: string;
  coreEntries: number;
  modules: number;
  findingCount: number;
  findingCodes: string[];
  findings: Array<{ code: string; target: string; recommendation: string }>;
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

  for (const projectRoot of repos) {
    const health = await auditMssrProjectContextHealth(projectRoot);
    const relativeRoot = path.relative(workspaceRoot, projectRoot).replace(/\\/g, "/") || ".";
    projects.push({
      name: path.basename(projectRoot),
      relativeRoot,
      level: health.level,
      manifestStatus: health.manifestStatus,
      coreEntries: health.coreCount,
      modules: health.moduleCount,
      findingCount: health.findings.length,
      findingCodes: [...new Set(health.findings.map((item) => item.code))].sort(),
      findings: health.findings.slice(0, 24).map((item) => ({
        code: item.code,
        target: item.target,
        recommendation: item.recommendation,
      })),
    });
  }

  const rank = { review: 2, watch: 1, ok: 0 } as const;
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
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
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
