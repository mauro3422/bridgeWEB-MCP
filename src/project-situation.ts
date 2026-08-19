import fs from "node:fs/promises";
import path from "node:path";
import {
  buildMssrKnowledgeRevisionSituation,
  collectRepositoryContextMessages,
  discoverMssrWorkspaceRepositories,
  evaluateMssrOperationalNoticeTransition,
  evaluateMssrSituationModel,
  loadMssrContextInboxStateFromFile,
  pruneMssrContextInbox,
  type MssrContextDeliveryReceipt,
  type MssrProducerObservation,
  type MssrSituationModelResult,
} from "@mauroprime/mssr";
import type { BridgeNoticeInput } from "./notices.js";
import { adaptMssrOperationalDecision } from "./operational-notices.js";
import { bridgeActionForMssrConsistencyAction } from "./mssr-consistency.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CHECK_MS = 60 * 1000;
const DEFAULT_RETENTION = 96;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_LEGACY_RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ProjectSituationLevel = "ok" | "watch" | "review" | "error";

export type ProjectSituationItem = {
  name: string;
  relativeRoot: string;
  level: ProjectSituationLevel;
  fingerprint: string;
  noticeClass: string;
  primaryCategory: string;
  categories: string[];
  priority: number;
  reasonCodes: string[];
  mismatchCount: number;
  evidenceComplete: boolean;
  nextAction: string | null;
  readyActions: string[];
  deferredActions: string[];
  observationCount: number;
  activeReceiptCount: number;
  staleRefs: string[];
  notifyOnWatch: boolean;
  collectionError?: string;
};

export type ProjectSituationSnapshot = {
  observedAt: string;
  workspaceRoot: string;
  counts: {
    projects: number;
    activeContext: number;
    ok: number;
    watch: number;
    review: number;
    error: number;
  };
  projects: ProjectSituationItem[];
};

type ProjectSituationStore = {
  schemaVersion: 1;
  updatedAt: string;
  workspaceRoot: string;
  snapshots: ProjectSituationSnapshot[];
};

type SituationDependencies = {
  discover?: (workspaceRoot: string, maxDepth: number) => Promise<string[]>;
  loadInbox?: (filePath: string) => Promise<Awaited<ReturnType<typeof loadMssrContextInboxStateFromFile>>>;
  collectRepository?: (projectRoot: string) => Promise<{ observations: MssrProducerObservation[] }>;
};

function defaultFilePath(): string {
  return process.env.BRIDGE_MCP_PROJECT_SITUATION_PATH
    ? path.resolve(process.env.BRIDGE_MCP_PROJECT_SITUATION_PATH)
    : path.resolve(process.cwd(), "data", "project-situation.json");
}

function defaultWorkspaceRoot(): string {
  return path.resolve(
    process.env.BRIDGE_MCP_PROJECT_SITUATION_ROOT
      || process.env.BRIDGE_MCP_PROJECT_HEALTH_ROOT
      || process.env.MSSR_WORKSPACE_ROOT
      || path.dirname(process.cwd()),
  );
}

async function readStore(filePath = defaultFilePath()): Promise<ProjectSituationStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<ProjectSituationStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("unsupported project situation store");
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

async function writeStore(filePath: string, store: ProjectSituationStore): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

function receiptIsOperationallyActive(receipt: MssrContextDeliveryReceipt, nowMs: number, legacyMaxAgeMs: number): boolean {
  if (receipt.expiresAt) {
    const expiry = Date.parse(receipt.expiresAt);
    return Number.isFinite(expiry) && expiry > nowMs;
  }
  const selectedAt = Date.parse(receipt.lastSelectedAt);
  return Number.isFinite(selectedAt) && nowMs - selectedAt <= legacyMaxAgeMs;
}

function emptyItem(workspaceRoot: string, projectRoot: string): ProjectSituationItem {
  const relativeRoot = path.relative(workspaceRoot, projectRoot).replace(/\\/g, "/") || ".";
  return {
    name: path.basename(projectRoot),
    relativeRoot,
    level: "ok",
    fingerprint: "no-active-context-receipts",
    noticeClass: "context-refresh",
    primaryCategory: "other",
    categories: [],
    priority: 0,
    reasonCodes: [],
    mismatchCount: 0,
    evidenceComplete: true,
    nextAction: null,
    readyActions: [],
    deferredActions: [],
    observationCount: 0,
    activeReceiptCount: 0,
    staleRefs: [],
    notifyOnWatch: false,
  };
}

function itemFromSituation(
  workspaceRoot: string,
  projectRoot: string,
  activeReceiptCount: number,
  situation: MssrSituationModelResult,
): ProjectSituationItem {
  const mismatchKeys = new Set(situation.decision.mismatches.map((item) => item.key));
  const staleRefs = [...new Set(
    situation.observations
      .filter((item) => mismatchKeys.has(item.key) && item.authority === "historical")
      .flatMap((item) => item.sourceRef ? [item.sourceRef] : []),
  )].sort().slice(0, 16);
  const relativeRoot = path.relative(workspaceRoot, projectRoot).replace(/\\/g, "/") || ".";
  return {
    name: path.basename(projectRoot),
    relativeRoot,
    level: situation.decision.level,
    fingerprint: situation.decision.fingerprint,
    noticeClass: situation.classification.noticeClass,
    primaryCategory: situation.classification.primaryCategory,
    categories: [...situation.classification.categories],
    priority: situation.classification.priority,
    reasonCodes: [...situation.decision.reasonCodes],
    mismatchCount: situation.decision.mismatches.length,
    evidenceComplete: situation.decision.evidenceComplete,
    nextAction: situation.decision.nextAction,
    readyActions: situation.decision.recommendations.filter((item) => item.status === "ready").map((item) => item.action),
    deferredActions: situation.decision.recommendations.filter((item) => item.status === "deferred").map((item) => item.action),
    observationCount: situation.observations.length,
    activeReceiptCount,
    staleRefs,
    notifyOnWatch: situation.decision.notifyOnWatch,
  };
}

export async function collectProjectSituationSnapshot(options: {
  workspaceRoot?: string;
  now?: Date;
  maxDepth?: number;
  legacyReceiptMaxAgeMs?: number;
  dependencies?: SituationDependencies;
} = {}): Promise<ProjectSituationSnapshot> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? defaultWorkspaceRoot());
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const legacyReceiptMaxAgeMs = options.legacyReceiptMaxAgeMs ?? DEFAULT_LEGACY_RECEIPT_MAX_AGE_MS;
  const discover = options.dependencies?.discover ?? discoverMssrWorkspaceRepositories;
  const loadInbox = options.dependencies?.loadInbox ?? loadMssrContextInboxStateFromFile;
  const collectRepository = options.dependencies?.collectRepository
    ?? (async (projectRoot: string) => collectRepositoryContextMessages({ projectRoot, maxObservations: 32 }));
  const repos = await discover(workspaceRoot, maxDepth);
  const projects: ProjectSituationItem[] = [];

  for (const projectRoot of repos) {
    const base = emptyItem(workspaceRoot, projectRoot);
    const inboxPath = path.join(projectRoot, ".mssr", "runtime", "context-inbox.json");
    try {
      const state = await loadInbox(inboxPath);
      const pruned = pruneMssrContextInbox(state, now.toISOString()).state;
      const activeReceipts = pruned.deliveries.filter((receipt) => receiptIsOperationallyActive(receipt, nowMs, legacyReceiptMaxAgeMs));
      if (activeReceipts.length === 0) {
        projects.push(base);
        continue;
      }
      const repository = await collectRepository(projectRoot);
      const observations = buildMssrKnowledgeRevisionSituation({
        repositoryObservations: repository.observations,
        deliveryReceipts: activeReceipts,
      });
      const situation = evaluateMssrSituationModel({ boundary: "context-load", observations });
      projects.push(itemFromSituation(workspaceRoot, projectRoot, activeReceipts.length, situation));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        projects.push(base);
        continue;
      }
      projects.push({
        ...base,
        level: "error",
        fingerprint: "project-situation-collection-error",
        noticeClass: "consistency",
        priority: 95,
        reasonCodes: ["situation-collection-error"],
        evidenceComplete: false,
        notifyOnWatch: true,
        collectionError: error instanceof Error ? error.name : "unknown-error",
      });
    }
  }

  const rank = { error: 3, review: 2, watch: 1, ok: 0 } as const;
  projects.sort((a, b) => rank[b.level] - rank[a.level] || b.priority - a.priority || a.relativeRoot.localeCompare(b.relativeRoot));
  return {
    observedAt: now.toISOString(),
    workspaceRoot,
    counts: {
      projects: projects.length,
      activeContext: projects.filter((item) => item.activeReceiptCount > 0).length,
      ok: projects.filter((item) => item.level === "ok").length,
      watch: projects.filter((item) => item.level === "watch").length,
      review: projects.filter((item) => item.level === "review").length,
      error: projects.filter((item) => item.level === "error").length,
    },
    projects,
  };
}

export async function captureProjectSituationIfDue(options: {
  force?: boolean;
  workspaceRoot?: string;
  now?: Date;
  filePath?: string;
  intervalMs?: number;
  retention?: number;
  maxDepth?: number;
  legacyReceiptMaxAgeMs?: number;
  dependencies?: SituationDependencies;
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

  const snapshot = await collectProjectSituationSnapshot(options);
  const next: ProjectSituationStore = {
    schemaVersion: 1,
    updatedAt: snapshot.observedAt,
    workspaceRoot: snapshot.workspaceRoot,
    snapshots: [...store.snapshots, snapshot].slice(-retention),
  };
  await writeStore(filePath, next);
  return { captured: true, filePath, latest: snapshot, previous: latest ?? null, snapshotCount: next.snapshots.length };
}

export async function getProjectSituationReport(filePath = defaultFilePath()) {
  const store = await readStore(filePath);
  return {
    schemaVersion: 1,
    updatedAt: store.updatedAt || null,
    workspaceRoot: store.workspaceRoot || null,
    snapshotCount: store.snapshots.length,
    latest: store.snapshots.at(-1) ?? null,
    previousObservedAt: store.snapshots.at(-2)?.observedAt ?? null,
    policy: {
      cadenceMs: DEFAULT_INTERVAL_MS,
      advisoryOnly: true,
      autoEdit: false,
      rawContentStored: false,
      receiptMaxAgeMs: DEFAULT_LEGACY_RECEIPT_MAX_AGE_MS,
      retentionSnapshots: DEFAULT_RETENTION,
    },
  };
}

export function buildProjectSituationNoticeInputs(
  snapshot: ProjectSituationSnapshot,
  previous: ProjectSituationSnapshot | null,
): BridgeNoticeInput[] {
  const previousByRoot = new Map((previous?.projects ?? []).map((item) => [item.relativeRoot, item]));
  const notices: BridgeNoticeInput[] = [];

  for (const current of snapshot.projects) {
    const before = previousByRoot.get(current.relativeRoot) ?? null;
    const decision = evaluateMssrOperationalNoticeTransition({
      subject: `project-situation:${current.relativeRoot}`,
      source: "mssr-project-situation",
      code: current.level === "error" ? "mssr-project-situation-error" : "mssr-project-situation-review",
      resolutionCode: "mssr-project-situation-resolved",
      currentLevel: current.level,
      previousLevel: before?.level ?? null,
      currentFingerprint: current.fingerprint,
      previousFingerprint: before?.fingerprint ?? null,
      notifyOnWatch: current.notifyOnWatch,
      message: `Situation Model requiere atención en ${current.relativeRoot}: ${current.reasonCodes.join(", ") || current.primaryCategory}. El contexto entregado no fue reescrito.`,
      resolutionMessage: `Situation Model: ${current.relativeRoot} volvió a coherencia para el contexto entregado actual.`,
      recommendation: "Usa primero la acción C2d ready de mayor rango y vuelve a observar antes de avanzar; el notice no autoriza escrituras.",
    });
    const actions = decision.event === "resolved"
      ? []
      : current.readyActions.slice(0, 4).map((action) => bridgeActionForMssrConsistencyAction(action as Parameters<typeof bridgeActionForMssrConsistencyAction>[0], path.resolve(snapshot.workspaceRoot, current.relativeRoot)));
    const notice = adaptMssrOperationalDecision(decision, {
      relativeRoot: current.relativeRoot,
      noticeClass: current.noticeClass,
      primaryCategory: current.primaryCategory,
      categories: current.categories,
      priority: current.priority,
      reasonCodes: current.reasonCodes,
      mismatchCount: current.mismatchCount,
      evidenceComplete: current.evidenceComplete,
      nextAction: current.nextAction,
      readyActions: current.readyActions,
      deferredActions: current.deferredActions,
      activeReceiptCount: current.activeReceiptCount,
      observationCount: current.observationCount,
      staleRefs: current.staleRefs,
      advisoryOnly: true,
      privacy: {
        rawFileContentsStored: false,
        rawMemoryStored: false,
        rawPromptStored: false,
        transcriptStored: false,
        privateReasoningStored: false,
      },
    }, actions);
    if (notice) notices.push(notice);
  }
  return notices;
}

export function startProjectSituationScheduler(options: {
  workspaceRoot?: string;
  filePath?: string;
  intervalMs?: number;
  checkMs?: number;
  maxDepth?: number;
  onSnapshot?: (snapshot: ProjectSituationSnapshot, previous: ProjectSituationSnapshot | null) => void;
  onError?: (error: unknown) => void;
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await captureProjectSituationIfDue(options);
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
