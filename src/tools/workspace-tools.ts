import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/path.js";
import { runProcess } from "./shared/process.js";

const SNAPSHOT_ROOT = path.resolve(process.env.BRIDGE_MCP_SNAPSHOT_DIR || path.join(process.cwd(), "data", "workspace-snapshots"));
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "logs", "data", "sandbox", "test-results", ".pytest_cache", "__pycache__"]);
const DEFAULT_MAX_FILES = 1000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

type SnapshotFile = { path: string; bytes: number; sha256: string };
type SnapshotManifest = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  sourceRoot: string;
  files: SnapshotFile[];
  skipped: Array<{ path: string; reason: string }>;
  truncated: boolean;
  totalBytes: number;
  git: { head: string | null; status: string | null } | null;
  label?: string;
};

function normalizeRel(value: string) { return value.replace(/\\/g, "/"); }
function hashBuffer(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function normalizePathForCompare(value: string) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function samePath(left: string, right: string) { return normalizePathForCompare(left) === normalizePathForCompare(right); }
function validateSnapshotId(id: string) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error(`Invalid snapshot id: ${id}`);
  return id;
}
function validateSnapshotRelativePath(value: string) {
  const normalized = normalizeRel(String(value ?? "")).replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (!normalized || path.posix.isAbsolute(normalized) || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid snapshot relative path: ${value}`);
  }
  return normalized;
}
function snapshotDir(id: string) { return path.join(SNAPSHOT_ROOT, validateSnapshotId(id)); }
function manifestPath(id: string) { return path.join(snapshotDir(id), "manifest.json"); }
function snapshotContentPath(contentDir: string, relativePath: string) {
  const safeRelative = validateSnapshotRelativePath(relativePath);
  const resolved = path.resolve(contentDir, ...safeRelative.split("/"));
  const relative = path.relative(contentDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Snapshot path escaped content root: ${relativePath}`);
  return resolved;
}
function projectContentPath(root: string, relativePath: string, access: "read" | "write") {
  const safeRelative = validateSnapshotRelativePath(relativePath);
  const resolved = resolveToolPath(safeRelative, { access, baseDir: root });
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Snapshot path escaped project root: ${relativePath}`);
  return resolved;
}

async function readManifest(id: string): Promise<SnapshotManifest> {
  const parsed = JSON.parse(await fs.readFile(manifestPath(id), "utf8")) as SnapshotManifest;
  if (parsed.schemaVersion !== 1 || parsed.id !== id || !path.isAbsolute(parsed.sourceRoot) || !Array.isArray(parsed.files) || !Array.isArray(parsed.skipped)) {
    throw new Error(`Invalid snapshot manifest: ${id}`);
  }
  const seen = new Set<string>();
  for (const file of parsed.files) {
    const safePath = validateSnapshotRelativePath(file.path);
    if (safePath !== file.path || seen.has(safePath) || !Number.isInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new Error(`Invalid snapshot file entry in ${id}: ${file.path}`);
    }
    seen.add(safePath);
  }
  for (const skipped of parsed.skipped) validateSnapshotRelativePath(skipped.path);
  return parsed;
}

async function scanWorkspace(root: string, maxFiles: number, maxFileBytes: number, maxTotalBytes: number, includeBuffers: boolean) {
  const files: SnapshotFile[] = [];
  const buffers = new Map<string, Buffer>();
  const skipped: Array<{ path: string; reason: string }> = [];
  let totalBytes = 0;
  let truncated = false;

  async function walk(current: string) {
    if (truncated) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles || totalBytes >= maxTotalBytes) { truncated = true; break; }
      const full = path.join(current, entry.name);
      const rel = normalizeRel(path.relative(root, full));
      if (entry.isSymbolicLink()) { skipped.push({ path: rel, reason: "symbolic link" }); continue; }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".bridge-snapshot")) { skipped.push({ path: rel, reason: "excluded directory" }); continue; }
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        resolveToolPath(full, { access: "read" });
        const stat = await fs.stat(full);
        if (stat.size > maxFileBytes) { skipped.push({ path: rel, reason: `file exceeds ${maxFileBytes} bytes` }); continue; }
        if (totalBytes + stat.size > maxTotalBytes) { skipped.push({ path: rel, reason: "snapshot total byte limit" }); truncated = true; break; }
        const buffer = await fs.readFile(full);
        files.push({ path: rel, bytes: buffer.length, sha256: hashBuffer(buffer) });
        totalBytes += buffer.length;
        if (includeBuffers) buffers.set(rel, buffer);
      } catch (error) {
        skipped.push({ path: rel, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await walk(root);
  return { files, buffers, skipped, truncated, totalBytes };
}

async function gitSnapshot(root: string) {
  const head = await runProcess("git", ["rev-parse", "HEAD"], root);
  if (head.code !== 0) return null;
  const status = await runProcess("git", ["status", "--short", "--branch"], root);
  return { head: String(head.stdout ?? "").trim() || null, status: String(status.stdout ?? "").trim() || null };
}

async function createWorkspaceSnapshot(projectRoot: string | undefined, maxFiles: number, maxFileBytes: number, maxTotalBytes: number, label: string | undefined) {
  const root = resolveToolPath(projectRoot ?? process.cwd(), { access: "read" });
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 12)}`;
  const dir = snapshotDir(id);
  const contentDir = path.join(dir, "files");
  try {
    await fs.mkdir(contentDir, { recursive: true });
    const scan = await scanWorkspace(root, maxFiles, maxFileBytes, maxTotalBytes, true);
    for (const file of scan.files) {
      const destination = snapshotContentPath(contentDir, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, scan.buffers.get(file.path)!);
    }
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      sourceRoot: root,
      files: scan.files,
      skipped: scan.skipped,
      truncated: scan.truncated,
      totalBytes: scan.totalBytes,
      git: await gitSnapshot(root),
      ...(label?.trim() ? { label: label.trim().slice(0, 200) } : {}),
    };
    await fs.writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { created: true, snapshot: manifest, storagePath: dir };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function workspaceDiff(snapshotId: string, projectRoot: string | undefined, maxChanges: number) {
  const manifest = await readManifest(snapshotId);
  const root = resolveToolPath(projectRoot ?? manifest.sourceRoot, { access: "read" });
  if (!samePath(root, manifest.sourceRoot)) throw new Error(`Snapshot belongs to ${manifest.sourceRoot}, not ${root}`);
  const current = await scanWorkspace(root, Math.max(manifest.files.length * 3, 1000), DEFAULT_MAX_FILE_BYTES, Math.max(manifest.totalBytes * 3, DEFAULT_MAX_TOTAL_BYTES), false);
  const before = new Map(manifest.files.map((file) => [file.path, file]));
  const after = new Map(current.files.map((file) => [file.path, file]));
  const modified: Array<{ path: string; before: string; after: string }> = [];
  const missing: string[] = [];
  const added: string[] = [];
  for (const [filePath, oldFile] of before) {
    const newFile = after.get(filePath);
    if (!newFile) missing.push(filePath);
    else if (newFile.sha256 !== oldFile.sha256) modified.push({ path: filePath, before: oldFile.sha256, after: newFile.sha256 });
  }
  for (const filePath of after.keys()) if (!before.has(filePath)) added.push(filePath);
  const totalChanges = modified.length + missing.length + added.length;
  return {
    snapshotId,
    root,
    changed: totalChanges > 0,
    totalChanges,
    complete: !manifest.truncated && !current.truncated,
    snapshotTruncated: manifest.truncated,
    modified: modified.slice(0, maxChanges),
    missing: missing.slice(0, maxChanges),
    added: added.slice(0, maxChanges),
    truncated: totalChanges > maxChanges,
    currentScan: { files: current.files.length, skipped: current.skipped.length, truncated: current.truncated },
  };
}

async function rollbackWorkspace(snapshotId: string, confirmSnapshotId: string, projectRoot: string | undefined, removeAddedFiles: boolean) {
  if (snapshotId !== confirmSnapshotId) throw new Error("confirmSnapshotId must exactly match snapshotId.");
  const manifest = await readManifest(snapshotId);
  if (manifest.truncated) throw new Error("Refusing rollback from a truncated snapshot. Create a complete snapshot with higher limits.");
  const root = resolveToolPath(projectRoot ?? manifest.sourceRoot, { access: "write" });
  if (!samePath(root, manifest.sourceRoot)) throw new Error(`Snapshot belongs to ${manifest.sourceRoot}, not ${root}`);
  const contentDir = path.join(snapshotDir(snapshotId), "files");

  const restorePlan: Array<{ path: string; destination: string; buffer: Buffer }> = [];
  for (const file of manifest.files) {
    const destination = projectContentPath(root, file.path, "write");
    const source = snapshotContentPath(contentDir, file.path);
    const buffer = await fs.readFile(source);
    if (buffer.length !== file.bytes || hashBuffer(buffer) !== file.sha256) throw new Error(`Snapshot content hash mismatch: ${file.path}`);
    restorePlan.push({ path: file.path, destination, buffer });
  }

  const removalPlan: Array<{ path: string; target: string }> = [];
  if (removeAddedFiles) {
    const current = await scanWorkspace(root, Math.max(manifest.files.length * 3, 1000), DEFAULT_MAX_FILE_BYTES, Math.max(manifest.totalBytes * 3, DEFAULT_MAX_TOTAL_BYTES), false);
    if (current.truncated) throw new Error("Refusing removeAddedFiles because the current workspace scan was truncated.");
    const protectedPaths = new Set([
      ...manifest.files.map((file) => file.path),
      ...manifest.skipped.map((file) => file.path),
    ]);
    for (const file of current.files) {
      if (protectedPaths.has(file.path)) continue;
      removalPlan.push({ path: file.path, target: projectContentPath(root, file.path, "write") });
    }
  }

  const restored: string[] = [];
  for (const item of restorePlan) {
    await fs.mkdir(path.dirname(item.destination), { recursive: true });
    await fs.writeFile(item.destination, item.buffer);
    restored.push(item.path);
  }
  const removed: string[] = [];
  for (const item of removalPlan) {
    await fs.unlink(item.target);
    removed.push(item.path);
  }
  return { rolledBack: true, snapshotId, root, restoredCount: restored.length, restored, removedAddedCount: removed.length, removedAdded: removed };
}

async function listSnapshots(limit: number) {
  await fs.mkdir(SNAPSHOT_ROOT, { recursive: true });
  const entries = await fs.readdir(SNAPSHOT_ROOT, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{8,100}$/.test(entry.name)) continue;
    try {
      const manifest = await readManifest(entry.name);
      manifests.push({ id: manifest.id, label: manifest.label ?? null, createdAt: manifest.createdAt, sourceRoot: manifest.sourceRoot, files: manifest.files.length, totalBytes: manifest.totalBytes, truncated: manifest.truncated, git: manifest.git });
    } catch { /* ignore invalid snapshot directories */ }
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { snapshotRoot: SNAPSHOT_ROOT, count: manifests.length, snapshots: manifests.slice(0, limit) };
}

export const workspaceToolModule: BridgeToolModule = {
  name: "workspace",
  tools: [
    { name: "workspace_snapshot", description: "Create a bounded content-addressed workspace snapshot outside the project, excluding generated/noisy directories and sensitive denied paths.", inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, label: { type: "string" }, maxFiles: { type: "number", default: DEFAULT_MAX_FILES, minimum: 1, maximum: 5000 }, maxFileBytes: { type: "number", default: DEFAULT_MAX_FILE_BYTES, minimum: 1024, maximum: 10485760 }, maxTotalBytes: { type: "number", default: DEFAULT_MAX_TOTAL_BYTES, minimum: 1024, maximum: 104857600 } }, additionalProperties: false } },
    { name: "workspace_diff", description: "Compare the current workspace with a saved snapshot by file hashes.", inputSchema: { type: "object", properties: { snapshotId: { type: "string" }, projectRoot: { type: "string" }, maxChanges: { type: "number", default: 200, minimum: 1, maximum: 2000 } }, required: ["snapshotId"], additionalProperties: false } },
    { name: "workspace_rollback", description: "Restore files from a complete snapshot after preflight hash/path checks. Requires an exact repeated snapshot id; optional removal affects only newly added files from a complete current scan.", inputSchema: { type: "object", properties: { snapshotId: { type: "string" }, confirmSnapshotId: { type: "string" }, projectRoot: { type: "string" }, removeAddedFiles: { type: "boolean", default: false } }, required: ["snapshotId", "confirmSnapshotId"], additionalProperties: false } },
    { name: "workspace_snapshot_list", description: "List recent workspace snapshots with roots, timestamps, sizes, and Git metadata.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 20, minimum: 1, maximum: 200 } }, additionalProperties: false } },
  ],
  handlers: {
    workspace_snapshot: async (args) => { const p = z.object({ projectRoot: z.string().optional(), label: z.string().max(200).optional(), maxFiles: z.number().int().min(1).max(5000).default(DEFAULT_MAX_FILES), maxFileBytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(DEFAULT_MAX_FILE_BYTES), maxTotalBytes: z.number().int().min(1024).max(100 * 1024 * 1024).default(DEFAULT_MAX_TOTAL_BYTES) }).parse(args); return createWorkspaceSnapshot(p.projectRoot, p.maxFiles, p.maxFileBytes, p.maxTotalBytes, p.label); },
    workspace_diff: async (args) => { const p = z.object({ snapshotId: z.string(), projectRoot: z.string().optional(), maxChanges: z.number().int().min(1).max(2000).default(200) }).parse(args); return workspaceDiff(p.snapshotId, p.projectRoot, p.maxChanges); },
    workspace_rollback: async (args) => { const p = z.object({ snapshotId: z.string(), confirmSnapshotId: z.string(), projectRoot: z.string().optional(), removeAddedFiles: z.boolean().default(false) }).parse(args); return rollbackWorkspace(p.snapshotId, p.confirmSnapshotId, p.projectRoot, p.removeAddedFiles); },
    workspace_snapshot_list: async (args) => listSnapshots(z.object({ limit: z.number().int().min(1).max(200).default(20) }).parse(args).limit),
  },
};
