import fs from "node:fs/promises";
import path from "node:path";
import { auditSkillRouting, canonicalizeSkillEntries } from "@mauroprime/mssr";
import { discoverLocalSkills } from "./tools/skill-catalog-tools.js";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECK_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION = 90;

export type SkillHealthStatus = "ok" | "watch" | "review";
export type SkillHealthItem = {
  name: string;
  source: string;
  status: SkillHealthStatus;
  reasonCodes: string[];
  recommendation: string;
  lines: number;
  chars: number;
  contextManifestStatus: string;
  contextModuleCount: number;
  referenceFiles: number;
  referenceChars: number;
};
export type SkillHealthSnapshot = {
  observedAt: string;
  counts: Record<string, number>;
  maintenanceRequired: boolean;
  healthReviewRecommended: boolean;
  sourceWarnings: string[];
  skills: SkillHealthItem[];
};
type SkillHealthStore = {
  schemaVersion: 1;
  updatedAt: string;
  snapshots: SkillHealthSnapshot[];
};

function defaultFilePath(): string {
  return process.env.BRIDGE_MCP_SKILL_HEALTH_PATH
    ? path.resolve(process.env.BRIDGE_MCP_SKILL_HEALTH_PATH)
    : path.resolve(process.cwd(), "data", "skill-health.json");
}

async function readStore(filePath = defaultFilePath()): Promise<SkillHealthStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<SkillHealthStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("unsupported skill health store");
    return { schemaVersion: 1, updatedAt: String(parsed.updatedAt || ""), snapshots: parsed.snapshots };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, updatedAt: "", snapshots: [] };
    throw error;
  }
}

async function writeStore(filePath: string, store: SkillHealthStore): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

export async function collectSkillHealthSnapshot(now = new Date()): Promise<SkillHealthSnapshot> {
  const discovered = await discoverLocalSkills();
  const canonical = canonicalizeSkillEntries(discovered.skills).entries;
  const audit = await auditSkillRouting(canonical);
  const structural = Array.isArray(audit.structuralHealth) ? audit.structuralHealth : [];
  return {
    observedAt: now.toISOString(),
    counts: { ...audit.counts },
    maintenanceRequired: audit.maintenanceRequired === true,
    healthReviewRecommended: audit.healthReviewRecommended === true,
    sourceWarnings: [...discovered.warnings],
    skills: structural.map((item) => ({
      name: item.name,
      source: item.source,
      status: item.status,
      reasonCodes: [...item.reasonCodes],
      recommendation: item.recommendation,
      lines: item.lines,
      chars: item.chars,
      contextManifestStatus: item.contextManifestStatus,
      contextModuleCount: item.contextModuleCount,
      referenceFiles: item.referenceFiles,
      referenceChars: item.referenceChars,
    })).sort((a, b) => {
      const rank = { review: 2, watch: 1, ok: 0 } as const;
      return rank[b.status] - rank[a.status] || b.chars - a.chars || a.name.localeCompare(b.name);
    }),
  };
}

export async function captureSkillHealthIfDue(options: {
  force?: boolean;
  now?: Date;
  filePath?: string;
  intervalMs?: number;
  retention?: number;
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

  const snapshot = await collectSkillHealthSnapshot(now);
  const next: SkillHealthStore = {
    schemaVersion: 1,
    updatedAt: snapshot.observedAt,
    snapshots: [...store.snapshots, snapshot].slice(-retention),
  };
  await writeStore(filePath, next);
  return { captured: true, filePath, latest: snapshot, previous: latest ?? null, snapshotCount: next.snapshots.length };
}

export async function getSkillHealthReport(filePath = defaultFilePath()) {
  const store = await readStore(filePath);
  const latest = store.snapshots.at(-1) ?? null;
  const previous = store.snapshots.at(-2) ?? null;
  const previousByName = new Map((previous?.skills ?? []).map((item) => [item.name, item]));
  const skills = (latest?.skills ?? []).map((item) => {
    const before = previousByName.get(item.name);
    return {
      ...item,
      deltaLines: before ? item.lines - before.lines : null,
      deltaChars: before ? item.chars - before.chars : null,
      previousStatus: before?.status ?? null,
    };
  });
  return {
    schemaVersion: 1,
    updatedAt: store.updatedAt || null,
    snapshotCount: store.snapshots.length,
    latest: latest ? { ...latest, skills } : null,
    previousObservedAt: previous?.observedAt ?? null,
    policy: {
      cadence: "daily",
      advisoryOnly: true,
      autoEdit: false,
      contentStored: false,
      retentionSnapshots: DEFAULT_RETENTION,
    },
  };
}

export function startSkillHealthScheduler(options: {
  filePath?: string;
  intervalMs?: number;
  checkMs?: number;
  onSnapshot?: (snapshot: SkillHealthSnapshot, previous: SkillHealthSnapshot | null) => void;
  onError?: (error: unknown) => void;
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await captureSkillHealthIfDue({ filePath: options.filePath, intervalMs: options.intervalMs });
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
