import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { buildCallGraph } from "./shared/call-graph.js";
import { buildImportGraph, findDeadCodeCandidates } from "./shared/import-graph.js";
import { semanticDeadCode } from "./shared/typescript-program.js";

export const codeGraphToolModule: BridgeToolModule = {
  name: "code-graph",
  tools: [
    {
      name: "import_graph",
      description: "Build an import graph for a TypeScript/JavaScript project, resolving relative imports and optionally showing external package imports.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          filePattern: { type: "string", default: "*.ts" },
          includeTests: { type: "boolean", default: false },
          includeExternal: { type: "boolean", default: true },
          maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 },
          maxCycles: { type: "number", default: 20, minimum: 0, maximum: 100 },
          resolutionEngine: { type: "string", enum: ["auto", "relative", "typescript"], default: "auto" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "dependency_graph",
      description: "Return a dependency-oriented graph summary: internal edges, unresolved imports, cycles, most imported files, most importing files, and orphan files.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          filePattern: { type: "string", default: "*.ts" },
          includeTests: { type: "boolean", default: false },
          maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 },
          maxCycles: { type: "number", default: 20, minimum: 0, maximum: 100 },
          resolutionEngine: { type: "string", enum: ["auto", "relative", "typescript"], default: "auto" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "call_graph",
      description: "Build a TypeScript semantic call graph showing which project functions/methods call each other, plus external/unresolved calls.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          includeTests: { type: "boolean", default: false },
          includeExternal: { type: "boolean", default: false },
          maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 },
          maxCycles: { type: "number", default: 20, minimum: 0, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "find_dead_code",
      description: "Find initial dead-code candidates using TypeScript AST references. Conservative: local symbols only by default; exported symbols are optional and lower-confidence.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          filePattern: { type: "string", default: "*.ts" },
          includeTests: { type: "boolean", default: false },
          includeExported: { type: "boolean", default: false },
          maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 },
          maxCandidates: { type: "number", default: 100, minimum: 1, maximum: 500 },
          engine: { type: "string", enum: ["auto", "typescript", "semantic"], default: "semantic" },
        },
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    import_graph: async (args) => {
      const parsed = z.object({
        projectRoot: z.string().optional(),
        filePattern: z.string().default("*.ts"),
        includeTests: z.boolean().default(false),
        includeExternal: z.boolean().default(true),
        maxFiles: z.number().int().min(1).max(2000).default(500),
        maxCycles: z.number().int().min(0).max(100).default(20),
        resolutionEngine: z.enum(["auto", "relative", "typescript"]).default("auto"),
      }).parse(args);
      return await buildImportGraph({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, includeExternal: parsed.includeExternal, maxFiles: parsed.maxFiles, maxCycles: parsed.maxCycles, resolutionEngine: parsed.resolutionEngine });
    },
    dependency_graph: async (args) => {
      const parsed = z.object({
        projectRoot: z.string().optional(),
        filePattern: z.string().default("*.ts"),
        includeTests: z.boolean().default(false),
        maxFiles: z.number().int().min(1).max(2000).default(500),
        maxCycles: z.number().int().min(0).max(100).default(20),
        resolutionEngine: z.enum(["auto", "relative", "typescript"]).default("auto"),
      }).parse(args);
      const graph = await buildImportGraph({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, includeExternal: false, maxFiles: parsed.maxFiles, maxCycles: parsed.maxCycles, resolutionEngine: parsed.resolutionEngine });
      return {
        root: graph.root,
        scannedFiles: graph.scannedFiles,
        nodeCount: graph.nodes.length,
        internalEdgeCount: graph.internalEdges.length,
        unresolvedCount: graph.unresolved.length,
        cycleCount: graph.cycles.length,
        cycles: graph.cycles,
        resolutionEngine: graph.resolutionEngine,
        resolver: graph.resolver,
        unresolved: graph.unresolved,
        mostImported: graph.mostImported,
        mostImporting: graph.mostImporting,
        orphanFiles: graph.orphanFiles,
        truncated: graph.truncated,
        skipped: graph.skipped,
      };
    },
    call_graph: async (args) => {
      const parsed = z.object({
        projectRoot: z.string().optional(),
        includeTests: z.boolean().default(false),
        includeExternal: z.boolean().default(false),
        maxFiles: z.number().int().min(1).max(2000).default(500),
        maxCycles: z.number().int().min(0).max(100).default(20),
      }).parse(args);
      return await buildCallGraph({ root: parsed.projectRoot ?? process.cwd(), includeTests: parsed.includeTests, includeExternal: parsed.includeExternal, maxFiles: parsed.maxFiles, maxCycles: parsed.maxCycles });
    },
    find_dead_code: async (args) => {
      const parsed = z.object({
        projectRoot: z.string().optional(),
        filePattern: z.string().default("*.ts"),
        includeTests: z.boolean().default(false),
        includeExported: z.boolean().default(false),
        maxFiles: z.number().int().min(1).max(2000).default(500),
        maxCandidates: z.number().int().min(1).max(500).default(100),
        engine: z.enum(["auto", "typescript", "semantic"]).default("semantic"),
      }).parse(args);
      if (parsed.engine === "semantic" || parsed.engine === "auto") {
        const semantic = await semanticDeadCode({ root: parsed.projectRoot ?? process.cwd(), includeTests: parsed.includeTests, includeExported: parsed.includeExported, maxFiles: parsed.maxFiles, maxCandidates: parsed.maxCandidates });
        if (semantic.available) return { engineUsed: "semantic", ...semantic };
        if (parsed.engine === "semantic") throw new Error(("reason" in semantic ? semantic.reason : undefined) ?? "Semantic TypeScript engine unavailable.");
      }
      return { engineUsed: "typescript", ...(await findDeadCodeCandidates({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, includeExported: parsed.includeExported, maxFiles: parsed.maxFiles, maxCandidates: parsed.maxCandidates })) };
    },
  },
};










