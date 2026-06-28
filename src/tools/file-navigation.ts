import { z } from "zod";
import { listFilesSmart, readFileLines, readManyFiles, searchFiles } from "../file-tools.js";
import type { BridgeToolModule } from "./types.js";

const tools = [
  {
    name: "list_files_smart",
    description: "List files with language, line counts, and lightweight symbols so code structure is visible without opening every file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "number", default: 1, minimum: 0, maximum: 3 },
        pattern: { type: "string" },
        showImports: { type: "boolean", default: false },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file_lines",
    description: "Read a text file as numbered lines with pagination. Prefer this over reading whole code files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number", default: 1, minimum: 1 },
        endLine: { type: "number", minimum: 1 },
        maxLines: { type: "number", default: 250, minimum: 1, maximum: 500 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_many_files",
    description: "Read up to 10 files or file ranges in one call, using specs like 'src/config.ts:1-80'.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        maxLinesPerFile: { type: "number", default: 250, minimum: 1, maximum: 500 },
      },
      required: ["files"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description: "Search literal text across files with line numbers, nearby context, and lightweight containing function/class hints.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        pattern: { type: "string" },
        filePattern: { type: "string" },
        contextLines: { type: "number", default: 2, minimum: 0, maximum: 10 },
        maxResults: { type: "number", default: 50, minimum: 1, maximum: 200 },
        caseSensitive: { type: "boolean", default: false },
      },
      required: ["path", "pattern"],
      additionalProperties: false,
    },
  },
] as const;

export const fileNavigationToolModule: BridgeToolModule = {
  name: "file-navigation",
  tools,
  handlers: {
    list_files_smart: async (args) => {
      const parsed = z.object({
        path: z.string(),
        depth: z.number().min(0).max(3).default(1),
        pattern: z.string().optional(),
        showImports: z.boolean().default(false),
      }).parse(args);
      return await listFilesSmart(parsed);
    },
    read_file_lines: async (args) => {
      const parsed = z.object({
        path: z.string(),
        startLine: z.number().int().min(1).default(1),
        endLine: z.number().int().min(1).optional(),
        maxLines: z.number().int().min(1).max(500).default(250),
      }).parse(args);
      return await readFileLines(parsed);
    },
    read_many_files: async (args) => {
      const parsed = z.object({
        files: z.array(z.string()).min(1).max(10),
        maxLinesPerFile: z.number().int().min(1).max(500).default(250),
      }).parse(args);
      return await readManyFiles(parsed);
    },
    search_files: async (args) => {
      const parsed = z.object({
        path: z.string(),
        pattern: z.string().min(1),
        filePattern: z.string().optional(),
        contextLines: z.number().int().min(0).max(10).default(2),
        maxResults: z.number().int().min(1).max(200).default(50),
        caseSensitive: z.boolean().default(false),
      }).parse(args);
      return await searchFiles(parsed);
    },
  },
};
