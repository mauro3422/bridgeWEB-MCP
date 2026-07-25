export type BridgeNoticeSeverity = "info" | "warning" | "error";

export type BridgeNoticeInput = {
  severity: BridgeNoticeSeverity;
  code: string;
  source: string;
  message: string;
  details?: Record<string, unknown>;
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
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  occurrences: number;
  dedupeKey: string;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_NOTICES = 100;
const MAX_MESSAGE_CHARS = 1200;
const MAX_DETAIL_CHARS = 4000;
const queue: BridgeNotice[] = [];

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

function cleanupExpired(now = Date.now()) {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (Date.parse(queue[index].expiresAt) <= now) queue.splice(index, 1);
  }
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
  const existing = queue.find((item) => item.dedupeKey === dedupeKey);
  if (existing) {
    existing.occurrences += 1;
    existing.updatedAt = new Date(now).toISOString();
    existing.expiresAt = new Date(now + ttlMs).toISOString();
    existing.severity = input.severity;
    existing.details = safeDetails(input.details);
    return { ...existing };
  }

  const notice: BridgeNotice = {
    id: randomId(),
    severity: input.severity,
    code,
    source,
    message,
    details: safeDetails(input.details),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    occurrences: 1,
    dedupeKey,
  };
  queue.push(notice);
  if (queue.length > MAX_NOTICES) queue.splice(0, queue.length - MAX_NOTICES);
  return { ...notice };
}

export function peekBridgeNotices(limit = MAX_NOTICES): BridgeNotice[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_NOTICES));
  return queue.slice(0, boundedLimit).map((item) => ({ ...item }));
}

export function drainBridgeNotices(limit = MAX_NOTICES): BridgeNotice[] {
  cleanupExpired();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_NOTICES));
  return queue.splice(0, boundedLimit).map((item) => ({ ...item }));
}

export function clearBridgeNotices(): number {
  const count = queue.length;
  queue.splice(0, queue.length);
  return count;
}

export function getBridgeNoticeStatus() {
  const notices = peekBridgeNotices();
  return {
    delivery: "automatic-drain",
    pendingCount: notices.length,
    maxNotices: MAX_NOTICES,
    defaultTtlMs: DEFAULT_TTL_MS,
    notices,
  };
}
