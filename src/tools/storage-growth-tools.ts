import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { prepareToolPathPolicy, resolveToolPathAsync } from "./shared/path.js";

const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 250_000;
const MAX_MAX_ENTRIES = 1_000_000;
const DEFAULT_TOP = 20;
const MAX_TOP = 100;
const MAX_DIRTY_PATHS = 20_000;

type FileRecord = { bytes: number; mtimeMs: number };
type Snapshot = {
  schemaVersion: number;
  root: string;
  capturedAt: string;
  maxEntries: number;
  complete: boolean;
  scannedDirectories: number;
  skippedLinks: number;
  readErrors: number;
  files: Record<string, FileRecord>;
};

type WatchState = {
  root: string;
  startedAtMs: number;
  dirty: Set<string>;
  invalidated: boolean;
  error: string | null;
  watcher: fs.FSWatcher;
};

const watchers = new Map<string, WatchState>();

function stateDirectory(): string {
  const configured = process.env.BRIDGE_MCP_STORAGE_GROWTH_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), "data", "storage-growth");
}

function rootKey(root: string): string {
  return crypto.createHash("sha256").update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex");
}

function snapshotPath(root: string): string {
  return path.join(stateDirectory(), `${rootKey(root)}.json`);
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function relativeKey(root: string, absolutePath: string): string {
  return normalizeRelative(path.relative(root, absolutePath));
}

function absoluteFromKey(root: string, key: string): string {
  return path.resolve(root, key.replace(/\//g, path.sep));
}

async function loadSnapshot(root: string): Promise<Snapshot | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(snapshotPath(root), "utf8")) as Snapshot;
    if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || path.resolve(parsed.root) !== path.resolve(root)) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

async function saveSnapshot(snapshot: Snapshot): Promise<string> {
  const directory = stateDirectory();
  await fsp.mkdir(directory, { recursive: true });
  const target = snapshotPath(snapshot.root);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(snapshot), "utf8");
  await fsp.rename(temp, target);
  return target;
}

async function resolveRoot(inputPath: string): Promise<string> {
  const prepared = await prepareToolPathPolicy();
  const root = await resolveToolPathAsync(inputPath, { access: "read" }, prepared);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${root}`);
  return root;
}

async function scanTree(root: string, maxEntries: number, start?: string): Promise<{
  files: Record<string, FileRecord>;
  complete: boolean;
  scannedDirectories: number;
  skippedLinks: number;
  readErrors: number;
}> {
  const files: Record<string, FileRecord> = {};
  let complete = true;
  let scannedDirectories = 0;
  let skippedLinks = 0;
  let readErrors = 0;
  let fileCount = 0;
  const scanRoot = start ? path.resolve(start) : root;
  const stack = [scanRoot];

  while (stack.length > 0) {
    const current = stack.pop()!;
    scannedDirectories += 1;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      readErrors += 1;
      continue;
    }

    const filePaths: string[] = [];
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        skippedLinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile()) filePaths.push(absolute);
    }

    for (let offset = 0; offset < filePaths.length;) {
      if (fileCount >= maxEntries) {
        complete = false;
        stack.length = 0;
        break;
      }
      const batch = filePaths.slice(offset, offset + Math.min(96, maxEntries - fileCount));
      offset += batch.length;
      const stats = await Promise.all(batch.map(async (absolute) => {
        try {
          const stat = await fsp.stat(absolute);
          return { absolute, stat };
        } catch {
          readErrors += 1;
          return null;
        }
      }));
      for (const item of stats) {
        if (!item) continue;
        const key = relativeKey(root, item.absolute);
        if (!key || key.startsWith("../")) continue;
        files[key] = { bytes: item.stat.size, mtimeMs: item.stat.mtimeMs };
        fileCount += 1;
      }
    }
  }

  return { files, complete, scannedDirectories, skippedLinks, readErrors };
}
async function scanTreeWindowsNative(root: string, maxEntries: number, relativeRoots?: string[]): Promise<{
  files: Record<string, FileRecord>;
  complete: boolean;
  scannedDirectories: number;
  skippedLinks: number;
  readErrors: number;
}> {
  const scriptPath = fileURLToPath(new URL("../../scripts/storage-growth-baseline.ps1", import.meta.url));
  const files: Record<string, FileRecord> = {};
  let summary: { count: number; scannedDirectories: number; skippedLinks: number; readErrors: number; complete: boolean } | null = null;
  let stderr = "";
  let rootsTempDir: string | null = null;
  const spawnArgs = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-Root", root,
    "-MaxEntries", String(maxEntries),
  ];
  if (relativeRoots && relativeRoots.length > 0) {
    rootsTempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bridge-storage-roots-"));
    const rootsFile = path.join(rootsTempDir, "roots.txt");
    await fsp.writeFile(rootsFile, relativeRoots.join("\n"), "utf8");
    spawnArgs.push("-RootsFile", rootsFile);
  }
  const child = spawn("powershell.exe", spawnArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

  const stdoutLines = readline.createInterface({ input: child.stdout });
  stdoutLines.on("line", (line) => {
    if (!line.startsWith("F\t")) return;
    const firstTab = line.indexOf("\t", 2);
    const secondTab = firstTab < 0 ? -1 : line.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) return;
    const bytes = Number(line.slice(2, firstTab));
    const mtimeMs = Number(line.slice(firstTab + 1, secondTab));
    const key = normalizeRelative(line.slice(secondTab + 1));
    if (!key || !Number.isFinite(bytes) || !Number.isFinite(mtimeMs)) return;
    files[key] = { bytes, mtimeMs };
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  let code = -1;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode) => resolve(exitCode ?? -1));
    });
  } finally {
    stdoutLines.close();
    if (rootsTempDir) await fsp.rm(rootsTempDir, { recursive: true, force: true }).catch(() => {});
  }

  for (const line of stderr.split(/\r?\n/)) {
    if (!line.startsWith("SUMMARY\t")) continue;
    const [, count, scannedDirectories, skippedLinks, readErrors, complete] = line.split("\t");
    summary = {
      count: Number(count),
      scannedDirectories: Number(scannedDirectories),
      skippedLinks: Number(skippedLinks),
      readErrors: Number(readErrors),
      complete: complete === "1",
    };
  }
  if (code !== 0 || !summary) {
    throw new Error(`Windows storage baseline failed (exit ${code}): ${stderr.slice(-1000)}`);
  }
  return {
    files,
    complete: summary.complete && summary.count === Object.keys(files).length,
    scannedDirectories: summary.scannedDirectories,
    skippedLinks: summary.skippedLinks,
    readErrors: summary.readErrors,
  };
}

async function scanFullTreeWindowsPartitioned(root: string, maxEntries: number) {
  const files: Record<string, FileRecord> = {};
  let complete = true;
  let scannedDirectories = 1;
  let skippedLinks = 0;
  let readErrors = 0;
  let fileCount = 0;
  const directories: string[] = [];
  const rootFiles: string[] = [];
  const entries = await fsp.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      skippedLinks += 1;
    } else if (entry.isDirectory()) {
      directories.push(absolute);
    } else if (entry.isFile()) {
      rootFiles.push(absolute);
    }
  }

  const rootStats = await Promise.all(rootFiles.map(async (absolute) => {
    try {
      return { absolute, stat: await fsp.stat(absolute) };
    } catch {
      readErrors += 1;
      return null;
    }
  }));
  for (const item of rootStats) {
    if (!item) continue;
    if (fileCount >= maxEntries) {
      complete = false;
      break;
    }
    files[relativeKey(root, item.absolute)] = { bytes: item.stat.size, mtimeMs: item.stat.mtimeMs };
    fileCount += 1;
  }

  const workerCount = Math.min(6, directories.length);
  if (workerCount > 0) {
    const groups = Array.from({ length: workerCount }, () => [] as string[]);
    directories.forEach((directory, index) => {
      groups[index % workerCount]!.push(relativeKey(root, directory));
    });

    type PartitionScan = {
      group: string[];
      scanned: Awaited<ReturnType<typeof scanTreeWindowsNative>>;
    };

    const finalScans: PartitionScan[] = [];
    let pendingGroups = groups.filter((group) => group.length > 0);
    let settledFileCount = fileCount;

    while (pendingGroups.length > 0) {
      const remaining = maxEntries - settledFileCount;
      if (remaining <= 0) {
        complete = false;
        break;
      }

      const perWorkerLimit = Math.max(1, Math.ceil(remaining / pendingGroups.length));
      const pass = await Promise.all(pendingGroups.map(async (group): Promise<PartitionScan> => ({
        group,
        scanned: await scanTreeWindowsNative(root, perWorkerLimit, group),
      })));

      for (const { scanned } of pass) {
        scannedDirectories += scanned.scannedDirectories;
        skippedLinks += scanned.skippedLinks;
        readErrors += scanned.readErrors;
      }

      const completed = pass.filter(({ scanned }) => scanned.complete);
      const truncated = pass.filter(({ scanned }) => !scanned.complete);
      finalScans.push(...completed);
      settledFileCount += completed.reduce((sum, { scanned }) => sum + Object.keys(scanned.files).length, 0);

      if (truncated.length === 0) break;
      if (completed.length === 0) {
        complete = false;
        finalScans.push(...truncated);
        break;
      }

      pendingGroups = truncated.map(({ group }) => group);
    }

    for (const { scanned } of finalScans) {
      if (!scanned.complete) complete = false;
      for (const [key, record] of Object.entries(scanned.files)) {
        if (fileCount >= maxEntries) {
          complete = false;
          break;
        }
        files[key] = record;
        fileCount += 1;
      }
    }
  }

  return { files, complete, scannedDirectories, skippedLinks, readErrors };
}

async function scanFullTree(root: string, maxEntries: number) {
  if (process.platform !== "win32") return await scanTree(root, maxEntries);
  try {
    return await scanFullTreeWindowsPartitioned(root, maxEntries);
  } catch {
    return await scanTree(root, maxEntries);
  }
}

function stopWatcher(root: string): void {
  const existing = watchers.get(root);
  if (!existing) return;
  existing.watcher.close();
  watchers.delete(root);
}

function startWatcher(root: string): WatchState | null {
  stopWatcher(root);
  try {
    const state = {} as WatchState;
    const watcher = fs.watch(root, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (!filename) {
        state.invalidated = true;
        return;
      }
      if (state.dirty.size >= MAX_DIRTY_PATHS) {
        state.invalidated = true;
        return;
      }
      state.dirty.add(normalizeRelative(String(filename)));
    });
    Object.assign(state, {
      root,
      startedAtMs: Date.now(),
      dirty: new Set<string>(),
      invalidated: false,
      error: null,
      watcher,
    });
    watcher.on("error", (error) => {
      state.invalidated = true;
      state.error = error instanceof Error ? error.message : String(error);
    });
    watchers.set(root, state);
    return state;
  } catch {
    return null;
  }
}

function cloneFiles(files: Record<string, FileRecord>): Record<string, FileRecord> {
  return Object.fromEntries(Object.entries(files).map(([key, value]) => [key, { ...value }]));
}

function removeKeyAndDescendants(files: Record<string, FileRecord>, key: string): number {
  const prefix = key.endsWith("/") ? key : `${key}/`;
  let removed = 0;
  for (const existing of Object.keys(files)) {
    if (existing === key || existing.startsWith(prefix)) {
      delete files[existing];
      removed += 1;
    }
  }
  return removed;
}

function compactDirtyPaths(items: string[]): string[] {
  const sorted = Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const kept: string[] = [];
  for (const candidate of sorted) {
    if (kept.some((parent) => candidate === parent || candidate.startsWith(`${parent}/`))) continue;
    kept.push(candidate);
  }
  return kept;
}

async function applyDirtyPaths(root: string, previous: Snapshot, dirtyPaths: string[], maxEntries: number): Promise<Snapshot> {
  const files = cloneFiles(previous.files);
  let scannedDirectories = 0;
  let skippedLinks = 0;
  let readErrors = 0;
  let complete = previous.complete;

  for (const key of compactDirtyPaths(dirtyPaths)) {
    const absolute = absoluteFromKey(root, key);
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        removeKeyAndDescendants(files, key);
        continue;
      }
      readErrors += 1;
      continue;
    }

    if (stat.isFile()) {
      files[key] = { bytes: stat.size, mtimeMs: stat.mtimeMs };
      continue;
    }
    if (!stat.isDirectory()) continue;

    removeKeyAndDescendants(files, key);
    const remaining = Math.max(1, maxEntries - Object.keys(files).length);
    const scanned = await scanTree(root, remaining, absolute);
    Object.assign(files, scanned.files);
    scannedDirectories += scanned.scannedDirectories;
    skippedLinks += scanned.skippedLinks;
    readErrors += scanned.readErrors;
    complete = complete && scanned.complete && Object.keys(files).length <= maxEntries;
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    root,
    capturedAt: new Date().toISOString(),
    maxEntries,
    complete,
    scannedDirectories,
    skippedLinks,
    readErrors,
    files,
  };
}

function classify(relativePath: string): string {
  const lower = `/${relativePath.toLowerCase()}/`;
  if (/\/(target(?:-[^/]+)?|dist|build|out|bin|obj|\.godot|\.gradle)\//.test(lower)) return "build-output";
  if (/\/(node_modules|vendor|packages?|deps?|dependencies|\.venv)\//.test(lower)) return "dependencies";
  if (/\/(cache|\.cache|caches|tmp|temp|__pycache__|\.pytest_cache)\//.test(lower)) return "cache-temp";
  if (/\/(screenshots?|captures?|evidence|artifacts?|test-results?|reports?|benchmark[^/]*)\//.test(lower)) return "test-evidence";
  if (/\/(context|contexts|\.mssr|memory|memories|sessions?)\//.test(lower)) return "context-memory";
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?|exr|hdr)$/.test(lower)) return "images";
  if (/\.(blend|fbx|gltf|glb|obj|dae|rbxlx?|tscn|scn|res|tres|wav|mp3|ogg|mp4|mov|mkv)$/.test(lower)) return "assets-media";
  if (/\/(steamapps|workshop|games?|game|mods?)\//.test(lower)) return "games-mods";
  return "other";
}

type AuditDisposition = "safe-regenerable" | "review" | "preserve" | "project-data";

type AuditClassification = {
  disposition: AuditDisposition;
  reason: string;
};

function auditClassification(root: string, relativePath: string, category = classify(relativePath)): AuditClassification {
  const absolute = normalizeRelative(path.resolve(root, relativePath)).toLowerCase();
  const absoluteWrapped = `/${absolute}/`;
  const relativeWrapped = `/${normalizeRelative(relativePath).toLowerCase()}/`;

  if (/\/(wsl)(\/|$)/.test(absoluteWrapped)
    || absoluteWrapped.includes("/maestro-agua/evidence/")
    || absoluteWrapped.includes("/omnysystem/src/ai/models/")
    || absoluteWrapped.includes("/tradinglablive/data/")
    || absoluteWrapped.includes("/omnysystem/.omnysysdata/")) {
    return { disposition: "preserve", reason: "Known project/runtime data that this storage workflow must preserve." };
  }
  if (/\/(backups?|backup)(\/|$)/.test(relativeWrapped)) {
    return { disposition: "preserve", reason: "Backup/history data; never treat as automatic cleanup." };
  }
  if (relativeWrapped.includes("/.mssr/runtime/")) {
    return { disposition: "safe-regenerable", reason: "MSSR runtime is explicitly ephemeral project-control state." };
  }
  if (/\/(?:\.tmp(?:-[^/]+)?|tmp|temp|cache|\.cache|caches)(?:\/|$)/.test(relativeWrapped)) {
    return { disposition: "safe-regenerable", reason: "Explicit temp/cache root; nested dependency/build names do not make it durable project data." };
  }
  if (category === "build-output" || category === "cache-temp") {
    return { disposition: "safe-regenerable", reason: "Generated build/cache/temp output; verify activity before cleanup." };
  }
  if (category === "dependencies") {
    return { disposition: "review", reason: "Dependency environment is recreatable but may be expensive or require network access." };
  }
  if (category === "test-evidence" || category === "context-memory") {
    return { disposition: "preserve", reason: "Evidence/context/history is useful project state and should be retained by default." };
  }
  if (/\/(logs?|\.runtime|archives?)(\/|$)/.test(relativeWrapped) || /\.(zip|7z|tar|tgz|gz)$/.test(relativePath.toLowerCase())) {
    return { disposition: "review", reason: "Runtime/log/archive data may support retention cleanup but is not safe to delete blindly." };
  }
  return { disposition: "project-data", reason: "No regenerable-storage rule matched; treat as ordinary project data." };
}

function auditHotspotKey(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return relativePath;
  const lower = parts.map((part) => part.toLowerCase());
  const startsWith = (...expected: string[]) => expected.every((part, index) => lower[index] === part);
  if (startsWith("maestro-agua", "evidence")) return parts.slice(0, 2).join("/");
  if (startsWith("tradinglablive", "data")) return parts.slice(0, 2).join("/");
  if (startsWith("omnysystem", ".omnysysdata")) return parts.slice(0, 2).join("/");
  if (startsWith("omnysystem", "src", "ai", "models")) return parts.slice(0, 4).join("/");
  if (startsWith("wsl")) return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    const current = parts[index]!.toLowerCase();
    const next = parts[index + 1]?.toLowerCase();
    if (current === ".mssr" && next === "runtime") return parts.slice(0, index + 2).join("/");
    if (current === ".runtime" || current === ".tmp" || current.startsWith(".tmp-")) return parts.slice(0, index + 1).join("/");
    if (current === ".godot" || current === ".gradle" || current === "node_modules" || current === ".venv") return parts.slice(0, index + 1).join("/");
    if (current === "cache" || current === ".cache" || current === "caches" || current === "tmp" || current === "temp") return parts.slice(0, index + 1).join("/");
    if (current === "logs" || current === "log" || current === "backup" || current === "backups" || current === "archive" || current === "archives") return parts.slice(0, index + 1).join("/");
    if (/^target(?:-.+)?$/.test(current) || current === "dist" || current === "build" || current === "out") return parts.slice(0, index + 1).join("/");
  }
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

type Change = { path: string; beforeBytes: number; afterBytes: number; deltaBytes: number; kind: "new" | "grew" | "shrank" | "deleted" | "metadata" };

function compareSnapshots(previous: Snapshot | null, current: Snapshot): Change[] {
  if (!previous) return [];
  const changes: Change[] = [];
  const seen = new Set<string>();
  for (const [key, after] of Object.entries(current.files)) {
    seen.add(key);
    const before = previous.files[key];
    if (!before) {
      changes.push({ path: key, beforeBytes: 0, afterBytes: after.bytes, deltaBytes: after.bytes, kind: "new" });
      continue;
    }
    if (before.bytes !== after.bytes) {
      changes.push({
        path: key,
        beforeBytes: before.bytes,
        afterBytes: after.bytes,
        deltaBytes: after.bytes - before.bytes,
        kind: after.bytes > before.bytes ? "grew" : "shrank",
      });
    } else if (before.mtimeMs !== after.mtimeMs) {
      changes.push({ path: key, beforeBytes: before.bytes, afterBytes: after.bytes, deltaBytes: 0, kind: "metadata" });
    }
  }
  for (const [key, before] of Object.entries(previous.files)) {
    if (!seen.has(key)) changes.push({ path: key, beforeBytes: before.bytes, afterBytes: 0, deltaBytes: -before.bytes, kind: "deleted" });
  }
  return changes;
}

function topDirectories(files: Record<string, FileRecord>, depth: number, top: number) {
  const totals = new Map<string, { bytes: number; files: number }>();
  for (const [key, record] of Object.entries(files)) {
    const parts = key.split("/").filter(Boolean);
    const limit = Math.min(parts.length - 1, depth);
    for (let index = 1; index <= limit; index += 1) {
      const dir = parts.slice(0, index).join("/");
      const current = totals.get(dir) ?? { bytes: 0, files: 0 };
      current.bytes += record.bytes;
      current.files += 1;
      totals.set(dir, current);
    }
  }
  return Array.from(totals.entries())
    .map(([directory, value]) => ({ directory, ...value }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top);
}

function summarize(root: string, previous: Snapshot | null, current: Snapshot, strategy: string, top: number, groupDepth: number, watcher: WatchState | null, dirtyCount: number) {
  const changes = compareSnapshots(previous, current);
  const totalBytes = Object.values(current.files).reduce((sum, record) => sum + record.bytes, 0);
  const previousBytes = previous ? Object.values(previous.files).reduce((sum, record) => sum + record.bytes, 0) : null;
  const categoryTotals = new Map<string, { bytes: number; files: number; deltaBytes: number }>();
  const dispositionTotals = new Map<AuditDisposition, { bytes: number; files: number; deltaBytes: number }>();
  const hotspotTotals = new Map<string, { bytes: number; files: number; disposition: AuditDisposition; reason: string }>();
  for (const [key, record] of Object.entries(current.files)) {
    const category = classify(key);
    const classification = auditClassification(root, key, category);
    const item = categoryTotals.get(category) ?? { bytes: 0, files: 0, deltaBytes: 0 };
    item.bytes += record.bytes;
    item.files += 1;
    categoryTotals.set(category, item);

    const disposition = dispositionTotals.get(classification.disposition) ?? { bytes: 0, files: 0, deltaBytes: 0 };
    disposition.bytes += record.bytes;
    disposition.files += 1;
    dispositionTotals.set(classification.disposition, disposition);

    if (classification.disposition !== "project-data") {
      const hotspot = auditHotspotKey(key);
      const hotspotItem = hotspotTotals.get(hotspot) ?? { bytes: 0, files: 0, disposition: classification.disposition, reason: classification.reason };
      hotspotItem.bytes += record.bytes;
      hotspotItem.files += 1;
      hotspotTotals.set(hotspot, hotspotItem);
    }
  }
  for (const change of changes) {
    const category = classify(change.path);
    const classification = auditClassification(root, change.path, category);
    const item = categoryTotals.get(category) ?? { bytes: 0, files: 0, deltaBytes: 0 };
    item.deltaBytes += change.deltaBytes;
    categoryTotals.set(category, item);
    const disposition = dispositionTotals.get(classification.disposition) ?? { bytes: 0, files: 0, deltaBytes: 0 };
    disposition.deltaBytes += change.deltaBytes;
    dispositionTotals.set(classification.disposition, disposition);
  }

  const largestFiles = Object.entries(current.files)
    .map(([file, record]) => ({ file, bytes: record.bytes, mtimeMs: record.mtimeMs }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top);
  const growth = changes
    .filter((item) => item.deltaBytes > 0)
    .sort((a, b) => b.deltaBytes - a.deltaBytes)
    .slice(0, top)
    .map((item) => ({ ...item, category: classify(item.path), ...auditClassification(root, item.path) }));
  const shrink = changes.filter((item) => item.deltaBytes < 0).sort((a, b) => a.deltaBytes - b.deltaBytes).slice(0, top);
  const categories = Array.from(categoryTotals.entries())
    .map(([category, value]) => ({ category, ...value }))
    .sort((a, b) => b.bytes - a.bytes);
  const auditHotspots = Array.from(hotspotTotals.entries())
    .map(([directory, value]) => ({ directory, ...value }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top);
  const dispositions = Array.from(dispositionTotals.entries())
    .map(([disposition, value]) => ({ disposition, ...value }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    root,
    strategy,
    capturedAt: current.capturedAt,
    baselineAvailable: previous !== null || strategy === "status-only",
    coverage: {
      snapshotComplete: current.complete,
      watcherActive: watcher !== null && !watcher.invalidated,
      watcherStartedAt: watcher ? new Date(watcher.startedAtMs).toISOString() : null,
      watcherInvalidated: watcher?.invalidated ?? false,
      watcherError: watcher?.error ?? null,
      dirtyPathsProcessed: dirtyCount,
      limitation: strategy === "status-only"
        ? "Status only; loaded the persistent snapshot without traversing the filesystem tree."
        : strategy === "incremental-watcher"
          ? "Only paths reported changed by the live recursive watcher were re-read; unchanged subtrees were not traversed."
          : "This pass reconciled the tree recursively because continuous watcher coverage was unavailable or explicitly reset.",
    },
    totals: {
      bytes: totalBytes,
      files: Object.keys(current.files).length,
      deltaBytes: previousBytes === null ? null : totalBytes - previousBytes,
      previousBytes,
      scannedDirectoriesThisPass: strategy === "status-only" ? 0 : current.scannedDirectories,
      skippedLinksThisPass: strategy === "status-only" ? 0 : current.skippedLinks,
      readErrorsThisPass: strategy === "status-only" ? 0 : current.readErrors,
    },
    topDirectories: topDirectories(current.files, groupDepth, top),
    largestFiles,
    growth,
    shrink,
    categories,
    audit: {
      dispositions,
      hotspots: auditHotspots,
      policy: {
        automaticDeletion: false,
        note: "Classification is advisory. safe-regenerable still requires activity/ownership verification before cleanup.",
      },
    },
  };
}

export const storageGrowthToolModule: BridgeToolModule = {
  name: "storage-growth",
  tools: [
    {
      name: "storage_growth_scan",
      description: "Track filesystem growth with a persistent baseline plus a live recursive watcher. The first/recovery pass scans the tree; later passes re-read only paths reported changed while watcher coverage remains continuous. Reports new/growing files, hot directories, coarse categories, and advisory storage-audit classifications (safe-regenerable/review/preserve/project-data) without deleting anything, reading file contents, or following links.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          mode: { type: "string", enum: ["auto", "baseline", "status"], default: "auto" },
          top: { type: "number", minimum: 1, maximum: MAX_TOP, default: DEFAULT_TOP },
          groupDepth: { type: "number", minimum: 1, maximum: 6, default: 3 },
          maxEntries: { type: "number", minimum: 100, maximum: MAX_MAX_ENTRIES, default: DEFAULT_MAX_ENTRIES },
        },
        required: ["path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ],
  handlers: {
    storage_growth_scan: async (args) => {
      const parsed = z.object({
        path: z.string().min(1),
        mode: z.enum(["auto", "baseline", "status"]).default("auto"),
        top: z.number().int().min(1).max(MAX_TOP).default(DEFAULT_TOP),
        groupDepth: z.number().int().min(1).max(6).default(3),
        maxEntries: z.number().int().min(100).max(MAX_MAX_ENTRIES).default(DEFAULT_MAX_ENTRIES),
      }).parse(args);
      const root = await resolveRoot(parsed.path);
      const previous = await loadSnapshot(root);
      let watcher = watchers.get(root) ?? null;

      if (parsed.mode === "status") {
        if (!watcher) watcher = startWatcher(root);
        if (!previous) {
          return {
            root,
            strategy: "status-only",
            baselineAvailable: false,
            watcherActive: watcher !== null && !watcher.invalidated,
            watcherStartedAt: watcher ? new Date(watcher.startedAtMs).toISOString() : null,
            nextAction: "Run mode=baseline or mode=auto to create the first baseline.",
          };
        }
        return summarize(root, null, previous, "status-only", parsed.top, parsed.groupDepth, watcher, 0);
      }

      const previousCapturedMs = previous ? Date.parse(previous.capturedAt) : 0;
      const canIncrement = parsed.mode === "auto"
        && previous !== null
        && previous.complete
        && watcher !== null
        && !watcher.invalidated
        && watcher.startedAtMs <= previousCapturedMs;

      let current: Snapshot;
      let strategy: string;
      let dirtyCount = 0;

      if (canIncrement && watcher) {
        const dirty = Array.from(watcher.dirty);
        dirtyCount = dirty.length;
        watcher.dirty.clear();
        current = await applyDirtyPaths(root, previous!, dirty, parsed.maxEntries);
        current.capturedAt = new Date().toISOString();
        strategy = "incremental-watcher";
      } else {
        watcher = startWatcher(root);
        watcher?.dirty.clear();
        const scanned = await scanFullTree(root, parsed.maxEntries);
        current = {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          root,
          capturedAt: new Date().toISOString(),
          maxEntries: parsed.maxEntries,
          complete: scanned.complete,
          scannedDirectories: scanned.scannedDirectories,
          skippedLinks: scanned.skippedLinks,
          readErrors: scanned.readErrors,
          files: scanned.files,
        };
        strategy = previous ? "full-reconcile" : "baseline-full";
      }

      await saveSnapshot(current);
      return summarize(root, previous, current, strategy, parsed.top, parsed.groupDepth, watcher, dirtyCount);
    },
  },
};

export function closeStorageGrowthWatchersForTests(): void {
  for (const root of Array.from(watchers.keys())) stopWatcher(root);
}
