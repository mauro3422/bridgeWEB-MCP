import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveToolPath } from "./path.js";

export const DEFAULT_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_EDIT_FILE_MAX_BYTES = 512 * 1024;

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".7z", ".rar",
  ".exe", ".dll", ".pdb", ".sqlite", ".db", ".bin", ".wasm", ".pyc", ".lockb",
]);

export type TextFileSnapshot = {
  path: string;
  bytes: number;
  text: string;
  sha256: string;
  lineEnding: "CRLF" | "LF" | "mixed" | "none";
  totalLines: number;
};


export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function detectLineEnding(text: string): TextFileSnapshot["lineEnding"] {
  const hasCrlf = /\r\n/.test(text);
  const hasBareLf = /(?<!\r)\n/.test(text);
  if (hasCrlf && hasBareLf) return "mixed";
  if (hasCrlf) return "CRLF";
  if (hasBareLf) return "LF";
  return "none";
}

export function preferredNewline(lineEnding: TextFileSnapshot["lineEnding"]): string {
  return lineEnding === "CRLF" ? "\r\n" : "\n";
}

export function splitTextLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/);
}

export function isLikelyBinaryPath(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

export async function readTextSnapshot(filePath: string, maxBytes = DEFAULT_TEXT_FILE_MAX_BYTES): Promise<TextFileSnapshot> {
  const resolved = resolveToolPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`Path is not a file: ${resolved}`);
  if (stat.size > maxBytes) throw new Error(`File too large: ${stat.size} bytes > ${maxBytes} bytes.`);
  if (isLikelyBinaryPath(resolved)) throw new Error(`Refusing likely binary file: ${resolved}`);

  const raw = await fs.readFile(resolved, { encoding: null });
  if (raw.subarray(0, Math.min(raw.length, 8192)).includes(0)) {
    throw new Error(`Refusing binary-looking file with NUL bytes: ${resolved}`);
  }

  const text = raw.toString("utf8");
  return {
    path: resolved,
    bytes: stat.size,
    text,
    sha256: sha256Text(text),
    lineEnding: detectLineEnding(text),
    totalLines: splitTextLines(text).length,
  };
}

export async function writeTextAndVerify(filePath: string, content: string, append = false) {
  const resolved = resolveToolPath(filePath, { access: "write" });
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const before = await fs.stat(resolved).then(
    async () => await readTextSnapshot(resolved),
    () => null,
  );

  if (append) await fs.appendFile(resolved, content, "utf8");
  else await fs.writeFile(resolved, content, "utf8");

  const after = await readTextSnapshot(resolved);
  return {
    path: resolved,
    append,
    before: before ? { bytes: before.bytes, sha256: before.sha256, totalLines: before.totalLines } : null,
    after: { bytes: after.bytes, sha256: after.sha256, totalLines: after.totalLines, lineEnding: after.lineEnding },
    changed: before ? before.sha256 !== after.sha256 : true,
  };
}
