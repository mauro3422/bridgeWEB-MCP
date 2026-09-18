import fs from "node:fs";
import path from "node:path";
import { parseMssrNoticeV1, type MssrNotice } from "@mauroprime/mssr";

export type BridgeNoticeSeverity = "info" | "warning" | "error";

export type BridgeNoticeAction = {
  label: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  instruction?: string;
};

export type BridgeNoticeInput = {
  severity: BridgeNoticeSeverity;
  code: string;
  source: string;
  message: string;
  details?: Record<string, unknown>;
  actions?: BridgeNoticeAction[];
  /** Genuine portable MSSR semantic payload. Host delivery metadata must stay outside this object. */
  mssrNotice?: MssrNotice;
  dedupeKey?: string;
  ttlMs?: number;
};

export type BridgeNotice = {
  id: string;
  severity: BridgeNoticeSeverity;
  code: string;
  source: string;
  message: string;
  details?: Record<string, unknown>;
  actions?: BridgeNoticeAction[];
  /** Exact validated MSSR semantic payload when this delivery originated from MSSR. */
  mssrNotice?: MssrNotice;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  occurrences: number;
  dedupeKey: string;
  deliveryCount: number;
  lastDeliveredAt?: string;
  lastDeliveryMode?: "automatic" | "manual";
};

export type BridgeNoticeHistoryEntry = BridgeNotice & {
  deliveryState: "pending" | "delivered" | "not-delivered";
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NOTICES = 100;
const MAX_HISTORY = 200;
const NOTICE_STATE_SCHEMA_VERSION = 1;
const NOTICE_STATE_MAX_BYTES = 512 * 1024;
const NOTICE_STATE_WRITE_DELAY_MS = 50;
const NOTICE_STATE_PATH = path.resolve(
  process.env.BRIDGE_MCP_NOTICE_STATE_PATH
    || path.join(process.env.BRIDGE_MCP_METRICS_DIR || path.join(process.cwd(), "data"), "bridge-notices.json"),
);
const NOTICE_PERSISTENCE_ENABLED = process.env.BRIDGE_MCP_NOTICE_PERSISTENCE_ENABLED !== "0";
let persistenceTimer: NodeJS.Timeout | null = null;
let persistenceWrite: Promise<void> = Promise.resolve();

const MAX_MESSAGE_CHARS = 1200;
const MAX_DETAIL_CHARS = 4000;
const queue: BridgeNotice[] = [];
const history: BridgeNotice[] = [];

function boundedText(value: unknown, maxChars: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function safeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const json = JSON.stringify(details);
  if (json.length <= MAX_DETAIL_CHARS) return details;
  return { truncated: true, preview: boundedText(json, MAX_DETAIL_CHARS) };
}

function safeActions(actions: BridgeNoticeAction[] | undefined): BridgeNoticeAction[] | undefined {
  if (!actions?.length) return undefined;
  return actions.slice(0, 4).flatMap((action) => {
    const label = boundedText(action.label, 180);
    if (!label) return [];
    const toolName = boundedText(action.toolName, 160);
    const instruction = boundedText(action.instruction, 600);
    const argumentsValue = action.arguments && JSON.stringify(action.arguments).length <= 2_000
      ? action.arguments
      : undefined;
    return [{
      label,
      ...(toolName ? { toolName } : {}),
      ...(argumentsValue ? { arguments: argumentsValue } : {}),
      ...(instruction ? { instruction } : {}),
    }];
  });
}

function safeMssrNotice(notice: MssrNotice | undefined): MssrNotice | undefined {
  return notice ? parseMssrNoticeV1(notice) : undefined;
}

function cloneBridgeNotice(notice: BridgeNotice): BridgeNotice {
  return {
    ...notice,
    ...(notice.mssrNotice ? { mssrNotice: parseMssrNoticeV1(notice.mssrNotice) } : {}),
  };
}
function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parsePersistedNotice(value: unknown): BridgeNotice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const severity = raw.severity;
  if (severity !== "info" && severity !== "warning" && severity !== "error") return null;
  if (
    typeof raw.id !== "string"
    || typeof raw.code !== "string"
    || typeof raw.source !== "string"
    || typeof raw.message !== "string"
    || typeof raw.dedupeKey !== "string"
    || !isIsoTimestamp(raw.createdAt)
    || !isIsoTimestamp(raw.updatedAt)
    || !isIsoTimestamp(raw.expiresAt)
  ) return null;
  const occurrences = Number(raw.occurrences);
  const deliveryCount = Number(raw.deliveryCount ?? 0);
  if (!Number.isInteger(occurrences) || occurrences < 1 || !Number.isInteger(deliveryCount) || deliveryCount < 0) return null;

  let mssrNotice: MssrNotice | undefined;
  if (raw.mssrNotice !== undefined) {
    try {
      mssrNotice = parseMssrNoticeV1(raw.mssrNotice);
    } catch {
      return null;
    }
  }

  return {
    id: boundedText(raw.id, 160),
    severity,
    code: boundedText(raw.code, 120),
    source: boundedText(raw.source, 160),
    message: boundedText(raw.message, MAX_MESSAGE_CHARS),
    details: raw.details && typeof raw.details === "object" && !Array.isArray(raw.details)
      ? safeDetails(raw.details as Record<string, unknown>)
      : undefined,
    actions: Array.isArray(raw.actions) ? safeActions(raw.actions as BridgeNoticeAction[]) : undefined,
    ...(mssrNotice ? { mssrNotice } : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    expiresAt: raw.expiresAt,
    occurrences,
    dedupeKey: boundedText(raw.dedupeKey, 1600),
    deliveryCount,
    ...(isIsoTimestamp(raw.lastDeliveredAt) ? { lastDeliveredAt: raw.lastDeliveredAt } : {}),
    ...(raw.lastDeliveryMode === "automatic" || raw.lastDeliveryMode === "manual"
      ? { lastDeliveryMode: raw.lastDeliveryMode }
      : {}),
  };
}

function noticeStateSnapshot() {
  return {
    schemaVersion: NOTICE_STATE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    queue: queue.map(cloneBridgeNotice),
    history: history.map(cloneBridgeNotice),
  };
}

async function persistNoticeState(): Promise<void> {
  if (!NOTICE_PERSISTENCE_ENABLED) return;
  await fs.promises.mkdir(path.dirname(NOTICE_STATE_PATH), { recursive: true });
  const tempPath = `${NOTICE_STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, `${JSON.stringify(noticeStateSnapshot())}\n`, "utf8");
    await fs.promises.rename(tempPath, NOTICE_STATE_PATH);
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function scheduleNoticeStatePersist(): void {
  if (!NOTICE_PERSISTENCE_ENABLED) return;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    persistenceWrite = persistenceWrite.then(() => persistNoticeState()).catch(() => undefined);
  }, NOTICE_STATE_WRITE_DELAY_MS);
  persistenceTimer.unref?.();
}

export async function flushBridgeNoticePersistence(): Promise<void> {
  if (persistenceTimer) {
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
    persistenceWrite = persistenceWrite.then(() => persistNoticeState()).catch(() => undefined);
  }
  await persistenceWrite;
}

function restoreNoticeState(): void {
  if (!NOTICE_PERSISTENCE_ENABLED) return;
  try {
    const stat = fs.statSync(NOTICE_STATE_PATH);
    if (!stat.isFile() || stat.size <= 0 || stat.size > NOTICE_STATE_MAX_BYTES) return;
    const parsed = JSON.parse(fs.readFileSync(NOTICE_STATE_PATH, "utf8")) as Record<string, unknown>;
    if (parsed.schemaVersion !== NOTICE_STATE_SCHEMA_VERSION) return;
    const now = Date.now();
    const restoredQueue = Array.isArray(parsed.queue)
      ? parsed.queue.map(parsePersistedNotice).filter((item): item is BridgeNotice => Boolean(item))
        .filter((item) => Date.parse(item.expiresAt) > now)
        .slice(-MAX_NOTICES)
      : [];
    const restoredHistory = Array.isArray(parsed.history)
      ? parsed.history.map(parsePersistedNotice).filter((item): item is BridgeNotice => Boolean(item))
        .filter((item) => Date.parse(item.expiresAt) > now)
        .slice(-MAX_HISTORY)
      : [];
    queue.splice(0, queue.length, ...restoredQueue);
    history.splice(0, history.length, ...restoredHistory);
  } catch {
    // Persistence is best-effort host state. Corrupt/missing files never block Bridge startup.
  }
}

restoreNoticeState();


function cleanupExpired(now = Date.now()) {
  let changed = false;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (Date.parse(queue[index].expiresAt) <= now) {
      queue.splice(index, 1);
      changed = true;
    }
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (Date.parse(history[index].expiresAt) <= now) {
      history.splice(index, 1);
      changed = true;
    }
  }
  if (changed) scheduleNoticeStatePersist();
}

function rememberNotice(notice: BridgeNotice, now = Date.now()): void {
  const historical: BridgeNotice = {
    ...notice,
    expiresAt: new Date(now + HISTORY_TTL_MS).toISOString(),
  };
  const existingIndex = history.findIndex((item) => item.dedupeKey === notice.dedupeKey);
  if (existingIndex >= 0) history.splice(existingIndex, 1);
  history.push(historical);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  scheduleNoticeStatePersist();
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function markNoticeDelivered(notice: BridgeNotice, mode: "automatic" | "manual", now = Date.now()): void {
  notice.deliveryCount += 1;
  notice.lastDeliveredAt = new Date(now).toISOString();
  notice.lastDeliveryMode = mode;
  rememberNotice(notice, now);
}


export function emitBridgeNotice(input: BridgeNoticeInput): BridgeNotice {
  cleanupExpired();
  const now = Date.now();
  const message = boundedText(input.message, MAX_MESSAGE_CHARS);
  const code = boundedText(input.code, 120) || "bridge-notice";
  const source = boundedText(input.source, 160) || "bridge";
  const dedupeKey = boundedText(input.dedupeKey || `${source}:${code}:${message}`, 1600);
  const ttlMs = Math.max(1000, Math.min(input.ttlMs ?? DEFAULT_TTL_MS, 24 * 60 * 60 * 1000));
  const mssrNotice = safeMssrNotice(input.mssrNotice);
  const existing = queue.find((item) => item.dedupeKey === dedupeKey);
  if (existing) {
    existing.occurrences += 1;
    existing.updatedAt = new Date(now).toISOString();
    existing.expiresAt = new Date(now + ttlMs).toISOString();
    existing.severity = input.severity;
    existing.details = safeDetails(input.details);
    existing.actions = safeActions(input.actions);
    if (mssrNotice) existing.mssrNotice = mssrNotice;
    rememberNotice(existing, now);
    return cloneBridgeNotice(existing);
  }

  const notice: BridgeNotice = {
    id: randomId(),
    severity: input.severity,
    code,
    source,
    message,
    details: safeDetails(input.details),
    actions: safeActions(input.actions),
    ...(mssrNotice ? { mssrNotice } : {}),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    occurrences: 1,
    dedupeKey,
    deliveryCount: 0,
  };
  queue.push(notice);
  rememberNotice(notice, now);
  if (queue.length > MAX_NOTICES) queue.splice(0, queue.length - MAX_NOTICES);
  return cloneBridgeNotice(notice);
}

export function peekBridgeNotices(limit = MAX_NOTICES): BridgeNotice[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_NOTICES));
  return queue.slice(0, boundedLimit).map(cloneBridgeNotice);
}

export function peekBridgeNoticeHistory(limit = 50): BridgeNotice[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_HISTORY));
  return history.slice(-boundedLimit).reverse().map(cloneBridgeNotice);
}

export function queryBridgeNoticeHistory(options: {
  limit?: number;
  severity?: BridgeNoticeSeverity;
  source?: string;
  code?: string;
  since?: string;
  deliveryState?: "all" | "pending" | "delivered" | "not-delivered";
} = {}): BridgeNoticeHistoryEntry[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(options.limit ?? 50), MAX_HISTORY));
  const sinceMs = options.since ? Date.parse(options.since) : Number.NaN;
  const pendingKeys = new Set(queue.map((item) => item.dedupeKey));

  return history
    .slice()
    .reverse()
    .map((item): BridgeNoticeHistoryEntry => ({
      ...cloneBridgeNotice(item),
      deliveryState: pendingKeys.has(item.dedupeKey)
        ? "pending"
        : item.deliveryCount > 0
          ? "delivered"
          : "not-delivered",
    }))
    .filter((item) => !options.severity || item.severity === options.severity)
    .filter((item) => !options.source || item.source === options.source)
    .filter((item) => !options.code || item.code === options.code)
    .filter((item) => !Number.isFinite(sinceMs) || Date.parse(item.updatedAt) >= sinceMs)
    .filter((item) => !options.deliveryState || options.deliveryState === "all" || item.deliveryState === options.deliveryState)
    .slice(0, boundedLimit);
}

export function drainBridgeNotices(limit = MAX_NOTICES): BridgeNotice[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_NOTICES));
  const selected = queue.splice(0, boundedLimit);
  const now = Date.now();
  for (const notice of selected) markNoticeDelivered(notice, "manual", now);
  return selected.map(cloneBridgeNotice);
}

export function drainBridgeNoticesWithinBudget(maxItems = 4, maxChars = 4_000): { items: BridgeNotice[]; remaining: number } {
  cleanupExpired();
  const itemLimit = Math.max(1, Math.min(Math.floor(maxItems), MAX_NOTICES));
  const charLimit = Math.max(512, Math.min(Math.floor(maxChars), 32_000));
  const selected: BridgeNotice[] = [];
  let used = 0;
  while (queue.length > 0 && selected.length < itemLimit) {
    const candidate = queue[0];
    const chars = JSON.stringify(candidate).length;
    if (used + chars > charLimit) break;
    selected.push(queue.shift()!);
    used += chars;
    if (used >= charLimit) break;
  }
  const now = Date.now();
  for (const notice of selected) markNoticeDelivered(notice, "automatic", now);
  return { items: selected.map(cloneBridgeNotice), remaining: queue.length };
}

export function clearBridgeNotices(): number {
  const count = queue.length;
  queue.splice(0, queue.length);
  if (count > 0) scheduleNoticeStatePersist();
  return count;
}

export function getBridgeNoticeStatus() {
  const pendingCount = peekBridgeNotices().length;
  return {
    delivery: "automatic-drain",
    pendingCount,
    hasPending: pendingCount > 0,
    historyAvailable: history.length > 0,
    historyCount: history.length,
    historyTtlMs: HISTORY_TTL_MS,
    historyPersistence: NOTICE_PERSISTENCE_ENABLED ? "disk-backed" : "memory-only",
    nextAction: pendingCount > 0
      ? "Use bridge_notice_drain only when you want the pending notice details now; otherwise normal tool responses will deliver them automatically."
      : "No pending notices. Use bridge_notice_history only when historical review is explicitly needed.",
  };
}
