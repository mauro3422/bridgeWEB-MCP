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
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NOTICES = 100;
const MAX_HISTORY = 200;
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

function cleanupExpired(now = Date.now()) {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (Date.parse(queue[index].expiresAt) <= now) queue.splice(index, 1);
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (Date.parse(history[index].expiresAt) <= now) history.splice(index, 1);
  }
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
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

export function drainBridgeNotices(limit = MAX_NOTICES): BridgeNotice[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_NOTICES));
  return queue.splice(0, boundedLimit).map(cloneBridgeNotice);
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
  return { items: selected.map(cloneBridgeNotice), remaining: queue.length };
}

export function clearBridgeNotices(): number {
  const count = queue.length;
  queue.splice(0, queue.length);
  return count;
}

export function getBridgeNoticeStatus() {
  const notices = peekBridgeNotices();
  const recent = peekBridgeNoticeHistory(25);
  return {
    delivery: "automatic-drain",
    pendingCount: notices.length,
    recentCount: recent.length,
    maxNotices: MAX_NOTICES,
    maxHistory: MAX_HISTORY,
    defaultTtlMs: DEFAULT_TTL_MS,
    historyTtlMs: HISTORY_TTL_MS,
    notices,
    recent,
  };
}
