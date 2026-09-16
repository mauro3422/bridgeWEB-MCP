import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

type CheckpointWorkerInput = {
  sqlitePath: string;
  busyTimeoutMs: number;
};

type DatabaseSync = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { get: (...args: unknown[]) => Record<string, unknown> | undefined };
  close: () => void;
};

type SqliteModule = {
  DatabaseSync: new (path: string) => DatabaseSync;
};

const require = createRequire(import.meta.url);
const input = workerData as CheckpointWorkerInput;

try {
  const sqlite = require("node:sqlite") as SqliteModule;
  const database = new sqlite.DatabaseSync(input.sqlitePath);
  database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(input.busyTimeoutMs))};`);
  const result = database.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
  database.close();
  parentPort?.postMessage({ ok: true, result: result ?? null });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
