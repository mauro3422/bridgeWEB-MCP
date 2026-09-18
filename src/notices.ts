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

export type BridgeNoticeDeliveryContext = {
  traceId?: string;
  project?: string;
  workflowKey?: string;
};

export type BridgeNoticeDeliverySummary = {
  id: string;
  severity: BridgeNoticeSeverity;
  code: string;
  message: string;
  updatedAt: string;
  occurrences: number;
  summaryOnly: true;
  mssrNoticeId?: string;
  subject?: string;
};

export type BridgeNoticeDeliveryItem = BridgeNotice | BridgeNoticeDeliverySummary;

export type BridgeNoticeDeliveryBatch = {
  items: BridgeNoticeDeliveryItem[];
  remaining: number;
  relevantPending: number;
  otherPending: number;
  globalPending: number;
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

function detailsRecord(notice: BridgeNotice): Record<string, unknown> {
  return notice.details && typeof notice.details === "object" && !Array.isArray(notice.details)
    ? notice.details
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return stringField((value as Record<string, unknown>)[key]);
}

function normalizedScopeToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() || undefined;
}

function scopeTokenVariants(value: string | undefined): string[] {
  const normalized = normalizedScopeToken(value);
  if (!normalized) return [];
  const parts = normalized.split("/").filter(Boolean);
  const leaf = parts.at(-1);
  return leaf && leaf !== normalized ? [normalized, leaf] : [normalized];
}

function noticeTraceId(notice: BridgeNotice): string | undefined {
  const details = detailsRecord(notice);
  return stringField(details.traceId)
    ?? nestedStringField(details.continuation, "traceId")
    ?? notice.actions?.map((action) => nestedStringField(action.arguments, "traceId")).find(Boolean)
    ?? (notice.mssrNotice?.subject.startsWith("trace-lifecycle:")
      ? notice.mssrNotice.subject.slice("trace-lifecycle:".length)
      : undefined);
}

function noticeProjectTokens(notice: BridgeNotice): string[] {
  const details = detailsRecord(notice);
  const candidates = [
    stringField(details.project),
    stringField(details.relativeRoot),
    stringField(details.projectRoot),
    stringField(details.cwd),
  ];
  const subject = notice.mssrNotice?.subject;
  if (subject?.startsWith("project-situation:")) candidates.push(subject.slice("project-situation:".length));
  if (subject?.startsWith("project:")) candidates.push(subject.slice("project:".length));
  return [...new Set(candidates.flatMap(scopeTokenVariants))];
}

function noticeWorkflowKey(notice: BridgeNotice): string | undefined {
  return stringField(detailsRecord(notice).workflowKey);
}

function noticeAttentionKey(notice: BridgeNotice): string {
  if (notice.mssrNotice) return `mssr:${notice.mssrNotice.noticeId}`;
  const details = detailsRecord(notice);
  const sessionId = stringField(details.sessionId);
  if (notice.source === "terminal-session" && sessionId) return `terminal-session:${sessionId}`;
  const jobId = stringField(details.jobId);
  if (notice.source === "bridge-verify-job" && jobId) return `bridge-verify:${jobId}`;
  return `dedupe:${notice.dedupeKey}`;
}

function isMssrResolution(notice: BridgeNotice): boolean {
  if (!notice.mssrNotice) return false;
  return notice.mssrNotice.details.event === "resolved" || notice.mssrNotice.attentionLevel === "ok";
}

function isHistoryOnlyNotice(notice: BridgeNotice): boolean {
  if (isMssrResolution(notice)) return true;
  if (notice.source === "mssr-context-message-v1" && notice.severity === "info") return true;
  if (notice.source === "terminal-session" && notice.severity === "info") {
    return notice.code === "terminal-session-started"
      || notice.code === "terminal-session-completed"
      || notice.code === "terminal-session-progress-resumed";
  }
  return notice.source === "bridge-verify-job"
    && notice.severity === "info"
    && notice.code === "bridge-background-job-progress-resumed";
}

function clearsCurrentAttention(notice: BridgeNotice): boolean {
  if (isMssrResolution(notice)) return true;
  if (notice.source === "terminal-session" && notice.severity === "info") {
    return notice.code === "terminal-session-completed" || notice.code === "terminal-session-progress-resumed";
  }
  return notice.source === "bridge-verify-job"
    && notice.severity === "info"
    && notice.code === "bridge-background-job-progress-resumed";
}

function reconcilePendingNotices(items: BridgeNotice[]): BridgeNotice[] {
  const latest = new Map<string, { notice: BridgeNotice; index: number }>();
  items.forEach((notice, index) => {
    const attentionKey = noticeAttentionKey(notice);
    if (clearsCurrentAttention(notice)) {
      latest.delete(attentionKey);
      return;
    }
    if (isHistoryOnlyNotice(notice)) return;
    latest.set(attentionKey, { notice, index });
  });
  return [...latest.values()]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.notice)
    .slice(-MAX_NOTICES);
}

function noticeRelevance(notice: BridgeNotice, context: BridgeNoticeDeliveryContext): "relevant" | "other" | "global" {
  const activeTrace = normalizedScopeToken(context.traceId);
  const noticeTrace = normalizedScopeToken(noticeTraceId(notice));
  if (activeTrace && noticeTrace) return activeTrace === noticeTrace ? "relevant" : "other";

  const activeProjects = new Set(scopeTokenVariants(context.project));
  const projectTokens = noticeProjectTokens(notice);
  if (activeProjects.size > 0 && projectTokens.length > 0) {
    return projectTokens.some((token) => activeProjects.has(token)) ? "relevant" : "other";
  }

  const activeWorkflow = normalizedScopeToken(context.workflowKey);
  const noticeWorkflow = normalizedScopeToken(noticeWorkflowKey(notice));
  if (activeWorkflow && noticeWorkflow) return activeWorkflow === noticeWorkflow ? "relevant" : "other";

  return "global";
}

function deliveryPriority(notice: BridgeNotice, context: BridgeNoticeDeliveryContext): number {
  const relevance = noticeRelevance(notice, context);
  if (relevance === "other") return -1;
  if (relevance === "relevant") {
    if (notice.severity === "error") return 400;
    if (notice.severity === "warning") return 350;
    return 300;
  }
  if (notice.severity === "error") return 200;
  if (notice.severity === "warning") return 150;
  return -1;
}

function compactDeliverySummary(notice: BridgeNotice, maxChars: number): BridgeNoticeDeliverySummary | null {
  const summary: BridgeNoticeDeliverySummary = {
    id: notice.id,
    severity: notice.severity,
    code: boundedText(notice.code, 80),
    message: boundedText(notice.message, Math.max(80, Math.min(260, maxChars - 220))),
    updatedAt: notice.updatedAt,
    occurrences: notice.occurrences,
    summaryOnly: true,
    ...(notice.mssrNotice ? {
      mssrNoticeId: boundedText(notice.mssrNotice.noticeId, 120),
      subject: boundedText(notice.mssrNotice.subject, 160),
    } : {}),
  };
  if (JSON.stringify(summary).length <= maxChars) return summary;
  const minimal: BridgeNoticeDeliverySummary = {
    id: notice.id,
    severity: notice.severity,
    code: boundedText(notice.code, 60),
    message: boundedText(notice.message, 80),
    updatedAt: notice.updatedAt,
    occurrences: notice.occurrences,
    summaryOnly: true,
  };
  return JSON.stringify(minimal).length <= maxChars ? minimal : null;
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
    history.splice(0, history.length, ...restoredHistory);
    queue.splice(0, queue.length, ...reconcilePendingNotices(restoredQueue));
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

  const historical = history.find((item) => item.dedupeKey === dedupeKey);
  const notice: BridgeNotice = {
    id: historical?.id ?? randomId(),
    severity: input.severity,
    code,
    source,
    message,
    details: safeDetails(input.details),
    actions: safeActions(input.actions),
    ...(mssrNotice ? { mssrNotice } : {}),
    createdAt: historical?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    occurrences: (historical?.occurrences ?? 0) + 1,
    dedupeKey,
    deliveryCount: historical?.deliveryCount ?? 0,
    ...(historical?.lastDeliveredAt ? { lastDeliveredAt: historical.lastDeliveredAt } : {}),
    ...(historical?.lastDeliveryMode ? { lastDeliveryMode: historical.lastDeliveryMode } : {}),
  };

  const attentionKey = noticeAttentionKey(notice);
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (noticeAttentionKey(queue[index]) === attentionKey) queue.splice(index, 1);
  }

  // An exact MSSR transition that was already delivered stays quiet until its
  // semantic fingerprint/event changes. Native failures may legitimately recur.
  const alreadyDeliveredSemanticEvent = Boolean(mssrNotice && historical && historical.deliveryCount > 0);
  if (!isHistoryOnlyNotice(notice) && !alreadyDeliveredSemanticEvent) queue.push(notice);
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

export function getBridgeNoticePendingSummary(context: BridgeNoticeDeliveryContext = {}) {
  cleanupExpired();
  let relevantPending = 0;
  let otherPending = 0;
  let globalPending = 0;
  for (const notice of queue) {
    const relevance = noticeRelevance(notice, context);
    if (relevance === "relevant") relevantPending += 1;
    else if (relevance === "other") otherPending += 1;
    else globalPending += 1;
  }
  return {
    pendingCount: queue.length,
    relevantPending,
    otherPending,
    globalPending,
  };
}

export function drainBridgeNoticesWithinBudget(
  maxItems = 4,
  maxChars = 4_000,
  context: BridgeNoticeDeliveryContext = {},
): BridgeNoticeDeliveryBatch {
  cleanupExpired();
  const itemLimit = Math.max(1, Math.min(Math.floor(maxItems), MAX_NOTICES));
  const charLimit = Math.max(512, Math.min(Math.floor(maxChars), 32_000));
  const ranked = queue
    .map((notice, index) => ({ notice, index, priority: deliveryPriority(notice, context) }))
    .filter((candidate) => candidate.priority >= 0)
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const selected: Array<{ notice: BridgeNotice; index: number; item: BridgeNoticeDeliveryItem }> = [];
  let used = 0;

  for (const candidate of ranked) {
    if (selected.length >= itemLimit || used >= charLimit) break;
    const remainingBudget = charLimit - used;
    const full = cloneBridgeNotice(candidate.notice);
    const fullChars = JSON.stringify(full).length;
    const item: BridgeNoticeDeliveryItem | null = fullChars <= remainingBudget
      ? full
      : compactDeliverySummary(candidate.notice, remainingBudget);
    if (!item) continue;
    selected.push({ notice: candidate.notice, index: candidate.index, item });
    used += JSON.stringify(item).length;
  }

  if (selected.length > 0) {
    const now = Date.now();
    for (const candidate of [...selected].sort((left, right) => right.index - left.index)) {
      const [removed] = queue.splice(candidate.index, 1);
      if (removed) markNoticeDelivered(removed, "automatic", now);
    }
  }

  const summary = getBridgeNoticePendingSummary(context);
  return {
    items: selected.map((candidate) => candidate.item),
    remaining: summary.pendingCount,
    relevantPending: summary.relevantPending,
    otherPending: summary.otherPending,
    globalPending: summary.globalPending,
  };
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
