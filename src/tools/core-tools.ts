import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_MAX_FILE_BYTES, SERVER_NAME, SERVER_VERSION } from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/process.js";

async function readTextFile(filePath: string, maxBytes: number) {
  const resolved = resolveToolPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("Path is not a file.");
  if (stat.size > maxBytes) throw new Error(`File too large: ${stat.size} bytes > ${maxBytes} bytes.`);
  const text = await fs.readFile(resolved, "utf8");
  return { path: resolved, bytes: stat.size, text };
}

async function listDir(dirPath: string, depth: number) {
  const root = resolveToolPath(dirPath);
  const out: Array<{ type: string; path: string; size?: number }> = [];
  async function walk(current: string, level: number) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.slice(0, 200)) {
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full) || ".";
      if (entry.isDirectory()) {
        out.push({ type: "dir", path: rel });
        if (level < depth) await walk(full, level + 1);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        out.push({ type: "file", path: rel, size: stat.size });
      } else {
        out.push({ type: "other", path: rel });
      }
    }
  }
  await walk(root, 1);
  return { root, depth, entries: out };
}

export const coreToolModule: BridgeToolModule = {
  name: "core",
  tools: [
    { name: "system_info", description: "Return basic OS, Node, CPU, memory, hostname and cwd information.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "list_dir", description: "List a directory recursively with bounded depth and entry limits.", inputSchema: { type: "object", properties: { path: { type: "string" }, depth: { type: "number", default: 1, minimum: 1, maximum: 5 } }, required: ["path"], additionalProperties: false } },
    { name: "read_text_file", description: "Read a UTF-8 text file with a maximum byte limit.", inputSchema: { type: "object", properties: { path: { type: "string" }, maxBytes: { type: "number", default: DEFAULT_MAX_FILE_BYTES } }, required: ["path"], additionalProperties: false } },
  ],
  handlers: {
    system_info: () => ({
      server: { name: SERVER_NAME, version: SERVER_VERSION },
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().map((cpu) => cpu.model),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      homedir: os.homedir(),
      cwd: process.cwd(),
      node: process.version,
    }),
    list_dir: async (args) => {
      const parsed = z.object({ path: z.string(), depth: z.number().min(1).max(5).default(1) }).parse(args);
      return await listDir(parsed.path, parsed.depth);
    },
    read_text_file: async (args) => {
      const parsed = z.object({ path: z.string(), maxBytes: z.number().positive().default(DEFAULT_MAX_FILE_BYTES) }).parse(args);
      return await readTextFile(parsed.path, parsed.maxBytes);
    },
  },
};
