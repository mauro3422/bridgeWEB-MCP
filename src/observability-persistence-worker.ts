import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

const require = createRequire(import.meta.url);

type StatementSync = { run: (...args: unknown[]) => unknown };
type DatabaseSync = { exec: (sql: string) => void; prepare: (sql: string) => StatementSync; close: () => void };
type SqliteModule = { DatabaseSync: new (filename: string) => DatabaseSync };
type Kind = "mssr" | "metric";
type Write = {
  kind: Kind;
  id: string;
  eventType?: string;
  sqlitePath: string;
  jsonlPath: string;
  jsonLine: string;
  values: unknown[];
};

type DbState = {
  db: DatabaseSync;
  mssr: StatementSync;
  metric: StatementSync;
};

const sqlite = require("node:sqlite") as SqliteModule;
const databases = new Map<string, DbState>();
const sleepSignal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function ms(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function getDb(sqlitePath: string): DbState {
  const existing = databases.get(sqlitePath);
  if (existing) return existing;
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const db = new sqlite.DatabaseSync(sqlitePath);
  db.exec(`
    PRAGMA busy_timeout = 100;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA wal_autocheckpoint = 0;
  `);
  const state: DbState = {
    db,
    mssr: db.prepare(`
      INSERT OR IGNORE INTO mssr_events (
        id, occurred_at, trace_id, event_type, caller, stage, classification_mode,
        skill_name, required, ok, task_hash, details_json, server_name,
        server_version, pid, hostname, platform
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    metric: db.prepare(`
      INSERT OR IGNORE INTO tool_calls (
        id, started_at, ended_at, duration_ms, tool, ok, error, input_keys,
        output_chars, server_name, server_version, pid, hostname, platform, cwd,
        observability_epoch, runtime_boot_id, trace_id, workflow_key, caller, model, reasoning_effort, client_name,
        session_key, host_parent_session_key, project, routing_status, mssr_eligible, operation_subject,
        task_key, related_project, result_ok, result_code, result_status,
        host_agent, host_variant, message_key, call_key, project_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
  databases.set(sqlitePath, state);
  return state;
}

function isBusy(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("busy") || text.includes("locked");
}

function runInsert(write: Write): { databaseMs: number; insertMs: number } {
  const dbStarted = performance.now();
  const state = getDb(write.sqlitePath);
  const databaseMs = performance.now() - dbStarted;
  const statement = write.kind === "mssr" ? state.mssr : state.metric;
  const insertStarted = performance.now();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      statement.run(...write.values);
      return { databaseMs: ms(databaseMs), insertMs: ms(performance.now() - insertStarted) };
    } catch (error) {
      lastError = error;
      if (!isBusy(error) || attempt === 3) throw error;
      Atomics.wait(sleepSignal, 0, 0, 25 * (attempt + 1));
    }
  }
  throw lastError;
}

function persist(write: Write): void {
  const started = performance.now();
  let jsonlMs = 0;
  let databaseMs = 0;
  let insertMs = 0;
  try {
    fs.mkdirSync(path.dirname(write.jsonlPath), { recursive: true });
    const jsonStarted = performance.now();
    fs.appendFileSync(write.jsonlPath, `${write.jsonLine}\n`, "utf8");
    jsonlMs = performance.now() - jsonStarted;
    const dbTiming = runInsert(write);
    databaseMs = dbTiming.databaseMs;
    insertMs = dbTiming.insertMs;
    parentPort?.postMessage({
      type: "ack",
      kind: write.kind,
      id: write.id,
      eventType: write.eventType,
      sqlitePath: write.sqlitePath,
      occurredAt: new Date().toISOString(),
      ok: true,
      totalMs: ms(performance.now() - started),
      jsonlMs: ms(jsonlMs),
      databaseMs: ms(databaseMs),
      insertMs: ms(insertMs),
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "ack",
      kind: write.kind,
      id: write.id,
      eventType: write.eventType,
      sqlitePath: write.sqlitePath,
      occurredAt: new Date().toISOString(),
      ok: false,
      totalMs: ms(performance.now() - started),
      jsonlMs: ms(jsonlMs),
      databaseMs: ms(databaseMs),
      insertMs: ms(insertMs),
      error: errorText(error),
    });
  }
}

function closeAll(): boolean {
  let ok = true;
  for (const state of databases.values()) {
    try {
      state.db.close();
    } catch {
      ok = false;
    }
  }
  databases.clear();
  return ok;
}

parentPort?.on("message", (message: unknown) => {
  if (!message || typeof message !== "object") return;
  const value = message as Record<string, unknown>;
  if (value.type === "write") {
    persist(value.write as Write);
    return;
  }
  if (value.type === "close-sync" && value.signal instanceof SharedArrayBuffer) {
    const state = new Int32Array(value.signal);
    const ok = closeAll();
    Atomics.store(state, 1, ok ? 1 : -1);
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0, 1);
    parentPort?.close();
  }
});

parentPort?.postMessage({ type: "worker-ready" });
