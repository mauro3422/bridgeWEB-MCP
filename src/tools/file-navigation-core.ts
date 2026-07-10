import fs from "node:fs/promises";
import path from "node:path";
import { resolveToolPath } from "./shared/path.js";

const MAX_ANALYZE_BYTES = 512 * 1024;
const MAX_FILE_LIST = 200;
const MAX_SEARCH_OUTPUT_FILES = 80;
const MAX_LINE_SCAN = 10_000;

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "logs",
  "data",
  "sandbox",
  ".pytest_cache",
  "test-results",
  "__pycache__",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".7z", ".rar",
  ".exe", ".dll", ".pdb", ".sqlite", ".db", ".bin", ".wasm", ".pyc", ".lockb",
]);

export type NumberedLine = { line: number; text: string };
export type ReadFileLinesArgs = { path: string; startLine?: number; endLine?: number; maxLines?: number };
export type ReadManyFilesArgs = { files: string[]; maxLinesPerFile?: number };
export type SearchFilesArgs = {
  path: string;
  pattern: string;
  filePattern?: string;
  contextLines?: number;
  maxResults?: number;
  caseSensitive?: boolean;
};
export type ListFilesSmartArgs = { path: string; depth?: number; pattern?: string; showImports?: boolean };

function resolveInputPath(inputPath: string): string {
  return resolveToolPath(inputPath, { access: "read" });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value ?? fallback);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

function splitLinesPreserveText(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/);
}

function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

async function assertReadableTextFile(filePath: string): Promise<{ resolved: string; size: number }> {
  const resolved = resolveInputPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`Path is not a file: ${resolved}`);
  if (stat.size > MAX_ANALYZE_BYTES) throw new Error(`File too large for line tools: ${stat.size} bytes > ${MAX_ANALYZE_BYTES}`);
  if (isBinaryPath(resolved)) throw new Error(`Refusing likely binary file: ${resolved}`);
  const sample = await fs.readFile(resolved, { encoding: null });
  if (sample.subarray(0, Math.min(sample.length, 8192)).includes(0)) {
    throw new Error(`Refusing binary-looking file with NUL bytes: ${resolved}`);
  }
  return { resolved, size: stat.size };
}

async function readTextFileSafe(filePath: string): Promise<{ resolved: string; size: number; lines: string[] }> {
  const { resolved, size } = await assertReadableTextFile(filePath);
  const text = await fs.readFile(resolved, "utf8");
  return { resolved, size, lines: splitLinesPreserveText(text) };
}

function languageFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript React",
    ".js": "JavaScript",
    ".jsx": "JavaScript React",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".json": "JSON",
    ".md": "Markdown",
    ".ps1": "PowerShell",
    ".py": "Python",
    ".html": "HTML",
    ".css": "CSS",
    ".yml": "YAML",
    ".yaml": "YAML",
  };
  return map[ext] ?? (ext ? ext.slice(1).toUpperCase() : "text");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .split("")
    .map((char) => {
      if (char === "*") return ".*";
      if (char === "?") return ".";
      return escapeRegex(char);
    })
    .join("");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(filePath: string, pattern?: string): boolean {
  if (!pattern || pattern.trim() === "") return true;
  const normalized = pattern.trim();
  const base = path.basename(filePath);
  if (normalized.includes("{")) {
    const match = normalized.match(/^(.*)\{(.+)\}(.*)$/);
    if (match) {
      const [, prefix, choices, suffix] = match;
      return choices.split(",").some((choice) => matchesPattern(base, `${prefix}${choice.trim()}${suffix}`));
    }
  }
  return globToRegex(normalized).test(base) || globToRegex(normalized).test(filePath.replace(/\\/g, "/"));
}

function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRS.has(dirName) || dirName.startsWith(".") && dirName !== ".config";
}

function extractSymbols(filePath: string, lines: string[], showImports: boolean) {
  const functions: Array<{ name: string; line: number }> = [];
  const classes: Array<{ name: string; line: number }> = [];
  const exports: Array<{ name: string; line: number }> = [];
  const imports: Array<{ text: string; line: number }> = [];
  const scan = lines.slice(0, MAX_LINE_SCAN);

  for (let i = 0; i < scan.length; i += 1) {
    const lineNo = i + 1;
    const line = scan[i] ?? "";
    const trimmed = line.trim();

    const fn = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
      ?? trimmed.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/)
      ?? trimmed.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/);
    if (fn?.[1]) functions.push({ name: fn[1], line: lineNo });

    const cls = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (cls?.[1]) classes.push({ name: cls[1], line: lineNo });

    const exp = trimmed.match(/^export\s+(?:const|let|var|function|class|type|interface)\s+([A-Za-z_$][\w$]*)\b/)
      ?? trimmed.match(/^export\s*\{\s*([^}]+)\s*\}/);
    if (exp?.[1]) exports.push({ name: exp[1].slice(0, 120), line: lineNo });

    if (showImports && /^(import\s|from\s.+\simport\s|const\s.+\s*=\s*require\()/.test(trimmed)) {
      imports.push({ text: trimmed.slice(0, 200), line: lineNo });
    }
  }

  return {
    language: languageFromExt(filePath),
    functions: functions.slice(0, 30),
    classes: classes.slice(0, 30),
    exports: exports.slice(0, 30),
    imports: showImports ? imports.slice(0, 30) : undefined,
  };
}

function findContainer(lines: string[], lineNumber: number): string | null {
  const start = Math.max(0, lineNumber - 1);
  const stop = Math.max(0, start - 80);
  for (let i = start; i >= stop; i -= 1) {
    const trimmed = (lines[i] ?? "").trim();
    const match = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
      ?? trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/)
      ?? trimmed.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/)
      ?? trimmed.match(/^if\s*\(name\s*===\s*["']([^"']+)["']\)/);
    if (match?.[1]) return `${match[1]} @ L${i + 1}`;
  }
  return null;
}

export async function readFileLines(args: ReadFileLinesArgs) {
  const maxLines = clampInt(args.maxLines, 250, 1, 500);
  const startLine = clampInt(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
  const { resolved, size, lines } = await readTextFileSafe(args.path);
  const totalLines = lines.length;
  const requestedEnd = args.endLine === undefined
    ? Math.min(totalLines, startLine + maxLines - 1)
    : clampInt(args.endLine, totalLines, startLine, totalLines);
  const cappedEnd = Math.min(requestedEnd, startLine + maxLines - 1, totalLines);
  const numbered: NumberedLine[] = [];
  for (let line = startLine; line <= cappedEnd; line += 1) {
    numbered.push({ line, text: lines[line - 1] ?? "" });
  }
  return {
    path: resolved,
    bytes: size,
    totalLines,
    startLine,
    endLine: cappedEnd,
    maxLines,
    truncated: cappedEnd < requestedEnd || cappedEnd < totalLines,
    nextStartLine: cappedEnd < totalLines ? cappedEnd + 1 : null,
    lines: numbered,
  };
}

function parseFileSpec(spec: string): ReadFileLinesArgs {
  const trimmed = spec.trim();
  const match = trimmed.match(/^(.*?):(\d+)(?:-(\d+))?$/);
  if (!match) return { path: trimmed };
  return {
    path: match[1] ?? trimmed,
    startLine: Number(match[2]),
    endLine: match[3] ? Number(match[3]) : undefined,
  };
}

export async function readManyFiles(args: ReadManyFilesArgs) {
  const files = args.files.slice(0, 10);
  if (args.files.length > 10) throw new Error(`read_many_files accepts at most 10 files, got ${args.files.length}.`);
  const maxLinesPerFile = clampInt(args.maxLinesPerFile, 250, 1, 500);
  const results = await Promise.all(files.map(async (spec) => {
    try {
      return { spec, ok: true, result: await readFileLines({ ...parseFileSpec(spec), maxLines: maxLinesPerFile }) };
    } catch (error) {
      return { spec, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return { count: results.length, maxLinesPerFile, results };
}

async function collectFiles(root: string, depth: number, pattern?: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, level: number) {
    if (out.length >= MAX_FILE_LIST) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= MAX_FILE_LIST) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name) && level < depth) await walk(full, level + 1);
      } else if (entry.isFile() && matchesPattern(full, pattern) && !isBinaryPath(full)) {
        out.push(full);
      }
    }
  }
  await walk(root, 0);
  return out;
}

export async function listFilesSmart(args: ListFilesSmartArgs) {
  const root = resolveInputPath(args.path);
  const depth = clampInt(args.depth, 1, 0, 3);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${root}`);
  const files = await collectFiles(root, depth, args.pattern);
  const entries = await Promise.all(files.map(async (filePath) => {
    const rel = path.relative(root, filePath) || path.basename(filePath);
    const fileStat = await fs.stat(filePath);
    const base = { type: "file", path: rel, bytes: fileStat.size, language: languageFromExt(filePath) };
    if (fileStat.size > MAX_ANALYZE_BYTES) return { ...base, skipped: `too large (${fileStat.size} bytes)` };
    try {
      const text = await fs.readFile(filePath, "utf8");
      const lines = splitLinesPreserveText(text);
      return {
        ...base,
        totalLines: lines.length,
        ...extractSymbols(filePath, lines, args.showImports === true),
      };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return {
    root,
    depth,
    pattern: args.pattern ?? null,
    listed: entries.length,
    truncated: files.length >= MAX_FILE_LIST,
    entries,
  };
}

export async function searchFiles(args: SearchFilesArgs) {
  if (!args.pattern) throw new Error("pattern is required.");
  const root = resolveInputPath(args.path);
  const stat = await fs.stat(root);
  const contextLines = clampInt(args.contextLines, 2, 0, 10);
  const maxResults = clampInt(args.maxResults, 50, 1, 200);
  const needle = args.caseSensitive ? args.pattern : args.pattern.toLowerCase();
  const roots = stat.isDirectory() ? await collectFiles(root, 10, args.filePattern) : [root];
  const files = [];
  let totalMatches = 0;
  let scannedFiles = 0;

  for (const filePath of roots) {
    if (totalMatches >= maxResults || files.length >= MAX_SEARCH_OUTPUT_FILES) break;
    let read;
    try {
      read = await readTextFileSafe(filePath);
    } catch {
      continue;
    }
    scannedFiles += 1;
    const matches = [];
    for (let i = 0; i < read.lines.length; i += 1) {
      if (totalMatches >= maxResults) break;
      const haystack = args.caseSensitive ? read.lines[i] ?? "" : (read.lines[i] ?? "").toLowerCase();
      if (!haystack.includes(needle)) continue;
      const lineNumber = i + 1;
      const start = Math.max(1, lineNumber - contextLines);
      const end = Math.min(read.lines.length, lineNumber + contextLines);
      const context: Array<NumberedLine & { match: boolean }> = [];
      for (let line = start; line <= end; line += 1) {
        context.push({ line, text: read.lines[line - 1] ?? "", match: line === lineNumber });
      }
      matches.push({ line: lineNumber, container: findContainer(read.lines, lineNumber), context });
      totalMatches += 1;
    }
    if (matches.length > 0) {
      files.push({ path: path.relative(root, filePath) || filePath, matches: matches.length, results: matches });
    }
  }

  return {
    root,
    pattern: args.pattern,
    filePattern: args.filePattern ?? null,
    caseSensitive: args.caseSensitive === true,
    contextLines,
    maxResults,
    scannedFiles,
    totalMatches,
    truncated: totalMatches >= maxResults,
    files,
  };
}
