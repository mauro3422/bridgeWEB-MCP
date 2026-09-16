import { Worker } from "node:worker_threads";
import { scheduleMetricsWalCheckpoint } from "./metrics-wal-maintenance.js";

export type ObservabilityPersistenceKind = "mssr" | "metric";

export type ObservabilityPersistenceWrite = {
  kind: ObservabilityPersistenceKind;
  id: string;
  eventType?: string;
  sqlitePath: string;
  jsonlPath: string;
  jsonLine: string;
  values: unknown[];
};

export type PersistenceTiming = {
  kind: ObservabilityPersistenceKind;
  id: string;
  eventType?: string;
  sqlitePath: string;
  occurredAt: string;
  ok: boolean;
  totalMs: number;
  jsonlMs: number;
  databaseMs: number;
  insertMs: number;
  error?: string;
};

type WorkerMessage =
  | ({ type: "ack" } & PersistenceTiming)
  | { type: "worker-ready" }
  | { type: "worker-error"; error: string };

const MAX_PENDING = Math.max(256, Math.min(32_768, Number(process.env.BRIDGE_MCP_OBSERVABILITY_MAX_PENDING || 8192)) || 8192);
const RECENT_TIMINGS_LIMIT = 64;

let worker: Worker | null = null;
let pending = 0;
let enqueued = 0;
let completed = 0;
let failed = 0;
let dropped = 0;
let restarts = 0;
let lastError: string | null = null;
let lastWorkerStartedAt: string | null = null;
const recent: PersistenceTiming[] = [];
const ackListeners = new Set<(timing: PersistenceTiming) => void>();

export function onObservabilityPersistenceAck(listener: (timing: PersistenceTiming) => void): () => void {
  ackListeners.add(listener);
  return () => ackListeners.delete(listener);
}

function remember(timing: PersistenceTiming): void {
  recent.push(timing);
  if (recent.length > RECENT_TIMINGS_LIMIT) recent.splice(0, recent.length - RECENT_TIMINGS_LIMIT);
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const next = new Worker(new URL("./observability-persistence-worker.js", import.meta.url));
  next.unref();
  lastWorkerStartedAt = new Date().toISOString();
  if (restarts > 0) lastError = null;
  restarts += 1;

  next.on("message", (message: WorkerMessage) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "ack") {
      pending = Math.max(0, pending - 1);
      completed += 1;
      if (!message.ok) {
        failed += 1;
        lastError = message.error ?? "observability persistence write failed";
      }
      const timing: PersistenceTiming = {
        kind: message.kind,
        id: message.id,
        eventType: message.eventType,
        sqlitePath: message.sqlitePath,
        occurredAt: message.occurredAt,
        ok: message.ok,
        totalMs: message.totalMs,
        jsonlMs: message.jsonlMs,
        databaseMs: message.databaseMs,
        insertMs: message.insertMs,
        ...(message.error ? { error: message.error } : {}),
      };
      remember(timing);
      for (const listener of ackListeners) {
        try { listener(timing); } catch { /* observability listeners are best effort */ }
      }
      if (message.ok) scheduleMetricsWalCheckpoint(message.sqlitePath);
      if (pending === 0) next.unref();
      return;
    }
    if (message.type === "worker-error") {
      lastError = message.error;
    }
  });
  next.on("error", (error) => {
    lastError = safeError(error);
    failed += pending;
    pending = 0;
    if (worker === next) worker = null;
  });
  next.on("exit", (code) => {
    if (worker === next) worker = null;
    if (code !== 0) {
      lastError = `observability persistence worker exited with code ${code}`;
      failed += pending;
      pending = 0;
    }
  });
  worker = next;
  return next;
}

export function enqueueObservabilityPersistence(write: ObservabilityPersistenceWrite): boolean {
  if (pending >= MAX_PENDING) {
    dropped += 1;
    lastError = `observability persistence queue full (${MAX_PENDING})`;
    return false;
  }
  const target = ensureWorker();
  pending += 1;
  enqueued += 1;
  target.ref();
  try {
    target.postMessage({ type: "write", write });
    // Mark the WAL dirty as soon as a durable write is accepted. The ACK path
    // schedules again after the write actually completes, which resets the
    // quiet-period timer. If an early passive checkpoint races a busy writer,
    // the later ACK therefore guarantees another checkpoint attempt without
    // putting SQLite work back on the HTTP/MCP event loop.
    scheduleMetricsWalCheckpoint(write.sqlitePath);
    return true;
  } catch (error) {
    pending = Math.max(0, pending - 1);
    failed += 1;
    lastError = safeError(error);
    if (pending === 0) target.unref();
    return false;
  }
}

export function getObservabilityPersistenceStatus() {
  return {
    mode: "worker-single-writer",
    maxPending: MAX_PENDING,
    pending,
    enqueued,
    completed,
    failed,
    dropped,
    workerActive: Boolean(worker),
    workerStarts: restarts,
    lastWorkerStartedAt,
    lastError,
    recent: recent.slice(-24),
  };
}

export function closeObservabilityPersistenceForTests(timeoutMs = 8_000): boolean {
  const target = worker;
  if (!target) return true;
  const signal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const state = new Int32Array(signal);
  target.ref();
  try {
    target.postMessage({ type: "close-sync", signal });
    const waitResult = Atomics.wait(state, 0, 0, Math.max(100, Math.min(30_000, Math.trunc(timeoutMs))));
    const ok = waitResult === "ok" && Atomics.load(state, 1) === 1;
    if (!ok) lastError = `observability persistence close timed out or failed (${waitResult})`;
    pending = 0;
    worker = null;
    return ok;
  } catch (error) {
    lastError = safeError(error);
    pending = 0;
    worker = null;
    return false;
  } finally {
    target.unref();
  }
}
