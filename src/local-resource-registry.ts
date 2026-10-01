import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const RESOURCE_SCHEME = "mauroprime";
const RESOURCE_HOST = "local-file";
const RESOURCE_TTL_MS = Math.max(60_000, Number(process.env.BRIDGE_MCP_LOCAL_RESOURCE_TTL_MS || 2 * 60 * 60 * 1000));
const MAX_RESOURCES = Math.max(16, Number(process.env.BRIDGE_MCP_LOCAL_RESOURCE_MAX_ENTRIES || 128));
const MAX_RESOURCE_BYTES = Math.max(64 * 1024, Number(process.env.BRIDGE_MCP_LOCAL_RESOURCE_MAX_BYTES || 8 * 1024 * 1024));

export type LocalResourceRegistration = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  size: number;
  sha256: string;
  modifiedAt: string;
  expiresAt: string;
};

type LocalResourceEntry = LocalResourceRegistration & {
  path: string;
  expiresAtMs: number;
};

const resources = new Map<string, LocalResourceEntry>();

function cleanupExpiredResources(nowMs = Date.now()): void {
  for (const [uri, entry] of resources) {
    if (entry.expiresAtMs <= nowMs) resources.delete(uri);
  }
  while (resources.size > MAX_RESOURCES) {
    const oldest = resources.keys().next().value;
    if (typeof oldest !== "string") break;
    resources.delete(oldest);
  }
}

export function registerLocalFileResource(input: {
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
  modifiedAt: string;
  description?: string;
}): LocalResourceRegistration {
  cleanupExpiredResources();
  if (!Number.isFinite(input.size) || input.size < 0 || input.size > MAX_RESOURCE_BYTES) {
    throw new Error(`Local MCP resource must be between 0 and ${MAX_RESOURCE_BYTES} bytes`);
  }
  if (!/^[0-9a-f]{64}$/i.test(input.sha256)) throw new Error("Local MCP resource requires a valid SHA-256");

  const token = crypto.randomUUID();
  const name = path.basename(input.path) || "local-file";
  const uri = `${RESOURCE_SCHEME}://${RESOURCE_HOST}/${token}`;
  const expiresAtMs = Date.now() + RESOURCE_TTL_MS;
  const entry: LocalResourceEntry = {
    uri,
    path: input.path,
    name,
    description: input.description || `Read-only local file evidence: ${name}`,
    mimeType: input.mimeType || "application/octet-stream",
    size: input.size,
    sha256: input.sha256.toLowerCase(),
    modifiedAt: input.modifiedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
  resources.set(uri, entry);
  cleanupExpiredResources();
  const { path: _path, expiresAtMs: _expiresAtMs, ...registration } = entry;
  return registration;
}

export function listLocalFileResources(): LocalResourceRegistration[] {
  cleanupExpiredResources();
  return Array.from(resources.values()).map(({ path: _path, expiresAtMs: _expiresAtMs, ...entry }) => entry);
}

export async function readLocalFileResource(uri: string): Promise<{
  uri: string;
  mimeType: string;
  blob: string;
  _meta: { sha256: string; bytes: number; modifiedAt: string; expiresAt: string };
}> {
  cleanupExpiredResources();
  const parsed = new URL(uri);
  if (parsed.protocol !== `${RESOURCE_SCHEME}:` || parsed.hostname !== RESOURCE_HOST) {
    throw new Error(`Unsupported Bridge resource URI: ${uri}`);
  }
  const entry = resources.get(uri);
  if (!entry) throw new Error(`Bridge resource is unknown or expired: ${uri}`);

  const stat = await fs.stat(entry.path);
  if (!stat.isFile()) throw new Error(`Bridge resource source is no longer a file: ${entry.path}`);
  if (stat.size !== entry.size || stat.size > MAX_RESOURCE_BYTES) {
    resources.delete(uri);
    throw new Error(`Bridge resource source changed size after registration: ${entry.name}`);
  }
  const bytes = await fs.readFile(entry.path);
  const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== entry.sha256) {
    resources.delete(uri);
    throw new Error(`Bridge resource source changed after registration: ${entry.name}`);
  }
  return {
    uri: entry.uri,
    mimeType: entry.mimeType,
    blob: bytes.toString("base64"),
    _meta: {
      sha256: entry.sha256,
      bytes: entry.size,
      modifiedAt: entry.modifiedAt,
      expiresAt: entry.expiresAt,
    },
  };
}

export const LOCAL_RESOURCE_MAX_BYTES = MAX_RESOURCE_BYTES;
