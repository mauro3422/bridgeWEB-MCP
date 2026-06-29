import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CACHE_VERSION = 1;
const CACHE_ROOT = path.resolve(process.env.BRIDGE_MCP_CACHE_DIR || path.join(process.cwd(), "data", "cache"));

function safeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "default";
}

function cachePath(namespace: string, key: string) {
  const digest = createHash("sha256").update(key, "utf8").digest("hex");
  return path.join(CACHE_ROOT, safeNamespace(namespace), `${digest}.json`);
}

export type PersistentCacheMeta = {
  enabled: boolean;
  namespace: string;
  hit: boolean;
  key: string;
  path?: string;
  reason?: string;
};

export function readPersistentCache<T>(namespace: string, key: string): { value: T | null; meta: PersistentCacheMeta } {
  if (process.env.BRIDGE_MCP_PERSISTENT_CACHE_ENABLED === "0") {
    return { value: null, meta: { enabled: false, namespace, hit: false, key, reason: "persistent cache disabled" } };
  }

  const filePath = cachePath(namespace, key);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; namespace?: string; key?: string; value?: T };
    if (parsed.version !== CACHE_VERSION || parsed.namespace !== namespace || parsed.key !== key) {
      return { value: null, meta: { enabled: true, namespace, hit: false, key, path: filePath, reason: "cache metadata mismatch" } };
    }
    return { value: parsed.value ?? null, meta: { enabled: true, namespace, hit: true, key, path: filePath } };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    const reason = code === "ENOENT"
      ? "cache miss"
      : error instanceof Error ? error.message : String(error);
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
  return { enabled: true, namespace, hit: false, key, path: filePath };
}
