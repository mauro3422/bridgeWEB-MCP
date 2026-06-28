import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { readTextSnapshot } from "./shared/text-files.js";
import { collectProjectTextFiles } from "./shared/project-scan.js";
import { detectLanguage, extractCodeSymbols, findReferences, splitCodeLines, type CodeReference, type CodeSymbol } from "./shared/code-symbols.js";

function compactSymbols(symbols: CodeSymbol[], limit = 120) {
  return symbols.slice(0, limit).map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
    exported: symbol.exported,
    text: symbol.text,
  }));
}

function groupDuplicateSymbols(symbols: Array<CodeSymbol & { file: string }>, exportedOnly: boolean, minOccurrences: number, maxGroups: number) {
  const groups = new Map<string, Array<CodeSymbol & { file: string }>>();
  for (const symbol of symbols) {
    if (exportedOnly && !symbol.exported) continue;
    if (symbol.kind === "export") continue;
    const key = `${symbol.kind}:${symbol.name}`;
    const current = groups.get(key) ?? [];
    current.push(symbol);
    groups.set(key, current);
  }
  return Array.from(groups.entries())
    .map(([key, entries]) => ({ key, name: entries[0]?.name ?? key, kind: entries[0]?.kind ?? "const", count: entries.length, entries }))
    .filter((group) => group.count >= minOccurrences)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, maxGroups)
    .map((group) => ({
      name: group.name,
      kind: group.kind,
      count: group.count,
      entries: group.entries.map((entry) => ({ file: entry.file, line: entry.line, exported: entry.exported, text: entry.text })),
    }));
}

function summarizeRisk(referenceCount: number, definitionCount: number, duplicateCount: number, crossFileCount: number) {
  if (duplicateCount > 1) return { level: "high", reason: "Multiple definitions with the same symbol were found." };
  if (crossFileCount >= 3 || referenceCount >= 12) return { level: "medium", reason: "Symbol has several cross-file references." };
  if (definitionCount === 0 && referenceCount > 0) return { level: "medium", reason: "References exist but no clear definition was found in scanned files." };
  if (referenceCount > 0) return { level: "low", reason: "Symbol has limited references in scanned files." };
  return { level: "none", reason: "No references were found in scanned files." };
}

function trimReferences(refs: CodeReference[], maxReferences: number) {
  return refs.slice(0, maxReferences).map((ref) => ({ line: ref.line, kind: ref.kind, text: ref.text }));
}

export const codeIntelligenceToolModule: BridgeToolModule = {
  name: "code-intelligence",
  tools: [
    {
      name: "analyze_code",
      description: "Analyze one text/code file and return lightweight language, line count, symbols, duplicate names, and optional references for a symbol.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          symbol: { type: "string" },
          maxSymbols: { type: "number", default: 120, minimum: 1, maximum: 500 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "impact_analysis",
      description: "Find definitions and references for a symbol across a project, including duplicate definitions and an approximate risk summary.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          projectRoot: { type: "string" },
          filePattern: { type: "string", default: "*.ts" },
          includeTests: { type: "boolean", default: false },
          maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 },
          maxReferencesPerFile: { type: "number", default: 20, minimum: 1, maximum: 100 },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "find_duplicate_symbols",
      description: "Scan a project for duplicated lightweight symbol definitions by name and kind, useful after adding tools or refactors.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          filePattern: { type: "string", default: "*.ts" },
          includeTests: { type: "boolean", default: false },
          exportedOnly: { type: "boolean", default: false },
          minOccurrences: { type: "number", default: 2, minimum: 2, maximum: 20 },
          maxGroups: { type: "number", default: 50, minimum: 1, maximum: 200 },
          maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 },
        },
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    analyze_code: async (args) => {
      const parsed = z.object({ path: z.string(), symbol: z.string().optional(), maxSymbols: z.number().int().min(1).max(500).default(120) }).parse(args);
      const snapshot = await readTextSnapshot(parsed.path);
      const symbols = extractCodeSymbols(snapshot.text);
      const duplicateGroups = groupDuplicateSymbols(symbols.map((symbol) => ({ ...symbol, file: path.basename(snapshot.path) })), false, 2, 50);
      const references = parsed.symbol ? findReferences(snapshot.text, parsed.symbol) : [];
      return {
        path: snapshot.path,
        language: detectLanguage(snapshot.path),
        bytes: snapshot.bytes,
        totalLines: snapshot.totalLines,
        sha256: snapshot.sha256,
        symbolCount: symbols.length,
        symbols: compactSymbols(symbols, parsed.maxSymbols),
        duplicateSymbols: duplicateGroups,
        symbolQuery: parsed.symbol ? { name: parsed.symbol, references: trimReferences(references, 100), count: references.length } : null,
      };
    },
    impact_analysis: async (args) => {
      const parsed = z.object({
        name: z.string().min(1),
        projectRoot: z.string().optional(),
        filePattern: z.string().default("*.ts"),
        includeTests: z.boolean().default(false),
        maxFiles: z.number().int().min(1).max(2000).default(500),
        maxReferencesPerFile: z.number().int().min(1).max(100).default(20),
      }).parse(args);
      const scan = await collectProjectTextFiles({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, maxFiles: parsed.maxFiles });
      const definitions: Array<{ file: string; line: number; kind: CodeSymbol["kind"]; exported: boolean; text: string }> = [];
      const filesWithReferences = [];
      let totalReferences = 0;
      let callReferences = 0;
      let importReferences = 0;
      for (const file of scan.files) {
        const symbols = extractCodeSymbols(file.text);
        for (const symbol of symbols) {
          if (symbol.name === parsed.name && symbol.kind !== "export") {
            definitions.push({ file: file.relativePath, line: symbol.line, kind: symbol.kind, exported: symbol.exported, text: symbol.text });
          }
        }
        const references = findReferences(file.text, parsed.name);
        if (references.length > 0) {
          totalReferences += references.length;
          callReferences += references.filter((ref) => ref.kind === "call").length;
          importReferences += references.filter((ref) => ref.kind === "import").length;
          filesWithReferences.push({
            file: file.relativePath,
            count: references.length,
            references: trimReferences(references, parsed.maxReferencesPerFile),
          });
        }
      }
      const duplicateDefinitions = definitions.length;
      const crossFileCount = new Set(filesWithReferences.map((item) => item.file)).size;
      return {
        name: parsed.name,
        root: scan.root,
        filePattern: parsed.filePattern,
        scannedFiles: scan.files.length,
        skipped: scan.skipped,
        truncated: scan.truncated,
        definitions,
        duplicateDefinitions,
        totalReferences,
        callReferences,
        importReferences,
        filesWithReferences,
        risk: summarizeRisk(totalReferences, definitions.length, duplicateDefinitions, crossFileCount),
      };
    },
    find_duplicate_symbols: async (args) => {
      const parsed = z.object({
        projectRoot: z.string().optional(),
        filePattern: z.string().default("*.ts"),
        includeTests: z.boolean().default(false),
        exportedOnly: z.boolean().default(false),
        minOccurrences: z.number().int().min(2).max(20).default(2),
        maxGroups: z.number().int().min(1).max(200).default(50),
        maxFiles: z.number().int().min(1).max(2000).default(500),
      }).parse(args);
      const scan = await collectProjectTextFiles({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, maxFiles: parsed.maxFiles });
      const allSymbols: Array<CodeSymbol & { file: string }> = [];
      for (const file of scan.files) {
        for (const symbol of extractCodeSymbols(file.text)) {
          allSymbols.push({ ...symbol, file: file.relativePath });
        }
      }
      const duplicates = groupDuplicateSymbols(allSymbols, parsed.exportedOnly, parsed.minOccurrences, parsed.maxGroups);
      return {
        root: scan.root,
        filePattern: parsed.filePattern,
        scannedFiles: scan.files.length,
        totalSymbols: allSymbols.length,
        duplicateGroupCount: duplicates.length,
        duplicates,
        skipped: scan.skipped,
        truncated: scan.truncated,
      };
    },
  },
};
