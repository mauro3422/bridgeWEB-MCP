import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CACHE_VERSION = 2;
const CACHE_ROOT = path.resolve(process.env.BRIDGE_MCP_CACHE_DIR || path.join(process.cwd(), "data", "cache"));
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 2000;
let writesSincePrune = 0;

function positiveEnv(name: string, fallback: number) {
  const value = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function safeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "default";
}

function cachePath(namespace: string, key: string) {
  const digest = createHash("sha256").update(key, "utf8").digest("hex");
  return path.join(CACHE_ROOT, safeNamespace(namespace), `${digest}.json`);
}

function listCacheFiles() {
  const files: Array<{ path: string; bytes: number; mtimeMs: number }> = [];
  if (!fs.existsSync(CACHE_ROOT)) return files;
  for (const namespace of fs.readdirSync(CACHE_ROOT, { withFileTypes: true })) {
    if (!namespace.isDirectory()) continue;
    const namespacePath = path.join(CACHE_ROOT, namespace.name);
    for (const entry of fs.readdirSync(namespacePath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(namespacePath, entry.name);
      try {
        const stat = fs.statSync(filePath);
        files.push({ path: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs });
      } catch { /* file disappeared during scan */ }
    }
  }
  return files;
}

export type PersistentCacheMeta = {
  enabled: boolean;
  namespace: string;
  hit: boolean;
  key: string;
  path?: string;
  reason?: string;
  ageMs?: number;
};

export type PersistentCachePruneOptions = {
  ttlMs?: number;
  maxBytes?: number;
  maxEntries?: number;
  dryRun?: boolean;
};

export function persistentCacheStatus() {
  const files = listCacheFiles();
  const now = Date.now();
  const ttlMs = positiveEnv("BRIDGE_MCP_CACHE_TTL_MS", DEFAULT_TTL_MS);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return {
    enabled: process.env.BRIDGE_MCP_PERSISTENT_CACHE_ENABLED !== "0",
    root: CACHE_ROOT,
    entries: files.length,
    totalBytes,
    oldestAgeMs: files.length ? Math.max(...files.map((file) => now - file.mtimeMs)) : 0,
    limits: {
      ttlMs,
      maxBytes: positiveEnv("BRIDGE_MCP_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES),
      maxEntries: positiveEnv("BRIDGE_MCP_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES),
    },
  };
}

export function prunePersistentCache(options: PersistentCachePruneOptions = {}) {
  const now = Date.now();
  const ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? positiveEnv("BRIDGE_MCP_CACHE_TTL_MS", DEFAULT_TTL_MS)));
  const maxBytes = Math.max(0, Math.trunc(options.maxBytes ?? positiveEnv("BRIDGE_MCP_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES)));
  const maxEntries = Math.max(0, Math.trunc(options.maxEntries ?? positiveEnv("BRIDGE_MCP_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES)));
  const dryRun = options.dryRun === true;
  const files = listCacheFiles().sort((a, b) => a.mtimeMs - b.mtimeMs);
  const selected = new Map<string, { path: string; bytes: number; reason: string }>();

  for (const file of files) {
    if (ttlMs > 0 && now - file.mtimeMs > ttlMs) selected.set(file.path, { path: file.path, bytes: file.bytes, reason: "ttl" });
  }

  let retained = files.filter((file) => !selected.has(file.path));
  while (retained.length > maxEntries) {
    const file = retained.shift()!;
    selected.set(file.path, { path: file.path, bytes: file.bytes, reason: "entry-limit" });
  }
  let retainedBytes = retained.reduce((sum, file) => sum + file.bytes, 0);
  while (retained.length > 0 && retainedBytes > maxBytes) {
    const file = retained.shift()!;
    retainedBytes -= file.bytes;
    selected.set(file.path, { path: file.path, bytes: file.bytes, reason: "byte-limit" });
  }

  const removals = Array.from(selected.values());
  const removed = [] as typeof removals;
  const failures: Array<{ path: string; error: string }> = [];
  if (!dryRun) {
    for (const removal of removals) {
      try {
        fs.rmSync(removal.path, { force: true });
        removed.push(removal);
      } catch (error) {
        failures.push({ path: removal.path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (fs.existsSync(CACHE_ROOT)) {
      for (const namespace of fs.readdirSync(CACHE_ROOT, { withFileTypes: true })) {
        if (!namespace.isDirectory()) continue;
        const namespacePath = path.join(CACHE_ROOT, namespace.name);
        try { if (fs.readdirSync(namespacePath).length === 0) fs.rmdirSync(namespacePath); } catch { /* ignore empty-directory cleanup failures */ }
      }
    }
  }

  const effectiveRemovals = dryRun ? removals : removed;
  const effectiveRemovedBytes = effectiveRemovals.reduce((sum, item) => sum + item.bytes, 0);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return {
    dryRun,
    root: CACHE_ROOT,
    scannedEntries: files.length,
    removedEntries: effectiveRemovals.length,
    removedBytes: effectiveRemovedBytes,
    retainedEntries: files.length - effectiveRemovals.length,
    retainedBytes: totalBytes - effectiveRemovedBytes,
    failedEntries: failures.length,
    failures: failures.slice(0, 50).map((item) => ({ path: path.relative(CACHE_ROOT, item.path).replace(/\\/g, "/"), error: item.error })),
    limits: { ttlMs, maxBytes, maxEntries },
    removals: removals.slice(0, 200).map((item) => ({ path: path.relative(CACHE_ROOT, item.path).replace(/\\/g, "/"), bytes: item.bytes, reason: item.reason })),
    truncated: removals.length > 200 || failures.length > 50,
  };
}

export function readPersistentCache<T>(namespace: string, key: string): { value: T | null; meta: PersistentCacheMeta } {
  if (process.env.BRIDGE_MCP_PERSISTENT_CACHE_ENABLED === "0") {
    return { value: null, meta: { enabled: false, namespace, hit: false, key, reason: "persistent cache disabled" } };
  }

  const filePath = cachePath(namespace, key);
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    const ttlMs = positiveEnv("BRIDGE_MCP_CACHE_TTL_MS", DEFAULT_TTL_MS);
    if (ttlMs > 0 && ageMs > ttlMs) {
      fs.rmSync(filePath, { force: true });
      return { value: null, meta: { enabled: true, namespace, hit: false, key, path: filePath, reason: "cache entry expired", ageMs } };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; namespace?: string; key?: string; value?: T };
    if (parsed.version !== CACHE_VERSION || parsed.namespace !== namespace || parsed.key !== key) {
      return { value: null, meta: { enabled: true, namespace, hit: false, key, path: filePath, reason: "cache metadata mismatch", ageMs } };
    }
    return { value: parsed.value ?? null, meta: { enabled: true, namespace, hit: true, key, path: filePath, ageMs } };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    const reason = code === "ENOENT" ? "cache miss" : error instanceof Error ? error.message : String(error);
    return { value: null, meta: { enabled: true, namespace, hit: false, key, path: filePath, reason } };
  }
}

export function writePersistentCache<T>(namespace: string, key: string, value: T): PersistentCacheMeta {
  if (process.env.BRIDGE_MCP_PERSISTENT_CACHE_ENABLED === "0") {
    return { enabled: false, namespace, hit: false, key, reason: "persistent cache disabled" };
  }

  const filePath = cachePath(namespace, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ version: CACHE_VERSION, namespace, key, createdAt: new Date().toISOString(), value }), "utf8");
  fs.renameSync(tempPath, filePath);
  writesSincePrune += 1;
  if (writesSincePrune >= 50) {
    writesSincePrune = 0;
    try { prunePersistentCache(); } catch { /* cache pruning must not break analysis */ }
  }
  return { enabled: true, namespace, hit: false, key, path: filePath };
}
