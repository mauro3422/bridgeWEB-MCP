import fs from "node:fs/promises";
import path from "node:path";
import { readTextSnapshot } from "./text-files.js";

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "logs", "data", "sandbox", "test-results", "__pycache__"]);
const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".7z", ".rar", ".exe", ".dll", ".sqlite", ".db", ".bin", ".wasm", ".pyc"]);

export type ScannedTextFile = {
  path: string;
  relativePath: string;
  bytes: number;
  text: string;
  totalLines: number;
  sha256: string;
};

export type ProjectScanOptions = {
  root: string;
  filePattern?: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  includeTests?: boolean;
};

function matchesFilePattern(filePath: string, pattern?: string): boolean {
  if (!pattern || pattern.trim() === "") return true;
  const patterns = pattern.split(",").map((item) => item.trim()).filter(Boolean);
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.basename(normalized);
  return patterns.some((item) => {
    if (item === "*.ts") return base.endsWith(".ts") && !base.endsWith(".d.ts");
    if (item === "*.tsx") return base.endsWith(".tsx");
    if (item === "*.js") return base.endsWith(".js");
    if (item === "*.json") return base.endsWith(".json");
    if (item === "*.md") return base.endsWith(".md");
    if (item === "*.ps1") return base.endsWith(".ps1");
    if (item.startsWith("*.")) return base.endsWith(item.slice(1));
    return normalized.includes(item) || base.includes(item);
  });
}

function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRS.has(dirName) || (dirName.startsWith(".") && dirName !== ".config");
}

function isLikelyBinaryPath(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const base = path.basename(normalized);
  return normalized.startsWith("test/")
    || normalized.startsWith("tests/")
    || normalized.includes("/test/")
    || normalized.includes("/tests/")
    || base.startsWith("test_")
    || base.endsWith("_test.py")
    || base.endsWith(".test.py")
    || base.endsWith(".test.ts")
    || base.endsWith(".spec.ts");
}

export async function collectProjectTextFiles(options: ProjectScanOptions): Promise<{ root: string; files: ScannedTextFile[]; skipped: Array<{ path: string; reason: string }>; truncated: boolean }> {
  const root = path.resolve(options.root);
  const maxFiles = Math.max(1, Math.min(2000, Math.trunc(options.maxFiles ?? DEFAULT_MAX_FILES)));
  const maxBytesPerFile = Math.max(1, Math.min(5 * 1024 * 1024, Math.trunc(options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE)));
  const files: ScannedTextFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let truncated = false;

  async function walk(current: string) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = path.join(current, entry.name);
      const relativePath = path.relative(root, full) || entry.name;
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isLikelyBinaryPath(full)) {
        skipped.push({ path: relativePath, reason: "binary extension" });
        continue;
      }
      if (!matchesFilePattern(relativePath, options.filePattern)) continue;
      if (options.includeTests !== true && isTestPath(relativePath)) continue;
      try {
        const snapshot = await readTextSnapshot(full, maxBytesPerFile);
        files.push({
          path: snapshot.path,
          relativePath,
          bytes: snapshot.bytes,
          text: snapshot.text,
          totalLines: snapshot.totalLines,
          sha256: snapshot.sha256,
        });
      } catch (error) {
        skipped.push({ path: relativePath, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await walk(root);
  return { root, files, skipped: skipped.slice(0, 100), truncated };
}



