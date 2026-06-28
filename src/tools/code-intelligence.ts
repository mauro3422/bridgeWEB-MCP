import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { readTextSnapshot } from "./shared/text-files.js";
import { collectProjectTextFiles } from "./shared/project-scan.js";
import { detectLanguage, extractCodeSymbols, findReferences, type CodeReference, type CodeSymbol } from "./shared/code-symbols.js";
import { semanticImpact } from "./shared/typescript-program.js";
import { analyzeTypeScriptSource, findTypeScriptIdentifierReferences, type TypeScriptReference, type TypeScriptSymbol } from "./shared/typescript-intelligence.js";

type Engine = "auto" | "regex" | "typescript" | "semantic";
type UnifiedSymbol = {
  name: string;
  kind: string;
  line: number;
  exported: boolean;
  text: string;
  source: "regex" | "typescript";
};

type UnifiedReference = {
  line: number;
  column?: number;
  kind: string;
  text: string;
  source: "regex" | "typescript";
};

function isTypeScriptLike(filePath: string) {
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function shouldUseTypeScript(engine: Engine, filePath: string) {
  if (engine === "regex") return false;
  if (engine === "typescript" || engine === "semantic") return true;
  return isTypeScriptLike(filePath);
}

function fromRegexSymbol(symbol: CodeSymbol): UnifiedSymbol {
  return { ...symbol, source: "regex" };
}

function fromTypeScriptSymbol(symbol: TypeScriptSymbol): UnifiedSymbol {
  return { ...symbol, source: "typescript" };
}

function fromRegexReference(ref: CodeReference): UnifiedReference {
  return { line: ref.line, kind: ref.kind, text: ref.text, source: "regex" };
}

function fromTypeScriptReference(ref: TypeScriptReference): UnifiedReference {
  return { line: ref.line, column: ref.column, kind: ref.kind, text: ref.text, source: "typescript" };
}

function compactSymbols(symbols: UnifiedSymbol[], limit = 120) {
  return symbols.slice(0, limit).map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
    exported: symbol.exported,
    source: symbol.source,
    text: symbol.text,
  }));
}

function groupDuplicateSymbols(symbols: Array<UnifiedSymbol & { file: string }>, exportedOnly: boolean, minOccurrences: number, maxGroups: number) {
  const groups = new Map<string, Array<UnifiedSymbol & { file: string }>>();
  for (const symbol of symbols) {
    if (exportedOnly && !symbol.exported) continue;
    if (symbol.kind === "export") continue;
    const key = `${symbol.kind}:${symbol.name}`;
    const current = groups.get(key) ?? [];
    current.push(symbol);
    groups.set(key, current);
  }
  return Array.from(groups.entries())
    .map(([key, entries]) => ({ key, name: entries[0]?.name ?? key, kind: entries[0]?.kind ?? "unknown", count: entries.length, entries }))
    .filter((group) => group.count >= minOccurrences)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, maxGroups)
    .map((group) => ({
      name: group.name,
      kind: group.kind,
      count: group.count,
      entries: group.entries.map((entry) => ({ file: entry.file, line: entry.line, exported: entry.exported, source: entry.source, text: entry.text })),
    }));
}

function summarizeRisk(referenceCount: number, definitionCount: number, duplicateCount: number, crossFileCount: number) {
  if (duplicateCount > 1) return { level: "high", reason: "Multiple definitions with the same symbol were found." };
  if (crossFileCount >= 3 || referenceCount >= 12) return { level: "medium", reason: "Symbol has several cross-file references." };
  if (definitionCount === 0 && referenceCount > 0) return { level: "medium", reason: "References exist but no clear definition was found in scanned files." };
  if (referenceCount > 0) return { level: "low", reason: "Symbol has limited references in scanned files." };
  return { level: "none", reason: "No references were found in scanned files." };
}

function trimReferences(refs: UnifiedReference[], maxReferences: number) {
  return refs.slice(0, maxReferences).map((ref) => ({ line: ref.line, column: ref.column, kind: ref.kind, source: ref.source, text: ref.text }));
}

async function analyzeSymbols(filePath: string, text: string, engine: Engine) {
  const regexSymbols = extractCodeSymbols(text).map(fromRegexSymbol);
  const regexDiagnostics: Array<{ line: number; message: string }> = [];
  if (!shouldUseTypeScript(engine, filePath)) {
    return { engineUsed: "regex", symbols: regexSymbols, imports: [], exports: [], diagnostics: regexDiagnostics, typeScriptAvailable: false, typeScriptReason: engine === "regex" ? "regex engine requested" : "not a TypeScript-like file" };
  }
  const tsAnalysis = await analyzeTypeScriptSource(filePath, text);
  if (!tsAnalysis.available) {
    if (engine === "typescript") throw new Error(tsAnalysis.reason ?? "TypeScript engine unavailable.");
    return { engineUsed: "regex", symbols: regexSymbols, imports: [], exports: [], diagnostics: regexDiagnostics, typeScriptAvailable: false, typeScriptReason: tsAnalysis.reason };
  }
  return {
    engineUsed: "typescript",
    symbols: tsAnalysis.symbols.map(fromTypeScriptSymbol),
    imports: tsAnalysis.imports,
    exports: tsAnalysis.exports,
    diagnostics: tsAnalysis.diagnostics,
    typeScriptAvailable: true,
    typeScriptReason: null,
  };
}

async function analyzeReferences(filePath: string, text: string, name: string, engine: Engine) {
  const regexRefs = findReferences(text, name).map(fromRegexReference);
  if (!shouldUseTypeScript(engine, filePath)) return { engineUsed: "regex", references: regexRefs, typeScriptAvailable: false };
  const tsRefs = await findTypeScriptIdentifierReferences(filePath, text, name);
  if (!tsRefs.available) {
    if (engine === "typescript") throw new Error(tsRefs.reason ?? "TypeScript engine unavailable.");
    return { engineUsed: "regex", references: regexRefs, typeScriptAvailable: false, typeScriptReason: tsRefs.reason };
  }
  return { engineUsed: "typescript", references: tsRefs.references.map(fromTypeScriptReference), typeScriptAvailable: true };
}

export const codeIntelligenceToolModule: BridgeToolModule = {
  name: "code-intelligence",
  tools: [
    {
      name: "analyze_code",
      description: "Analyze one text/code file. Uses TypeScript AST for TS/JS when available, otherwise regex fallback. Returns symbols, imports, exports, diagnostics, duplicates, and optional symbol references.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, symbol: { type: "string" }, maxSymbols: { type: "number", default: 120, minimum: 1, maximum: 500 }, engine: { type: "string", enum: ["auto", "regex", "typescript", "semantic"], default: "auto" } }, required: ["path"], additionalProperties: false },
    },
    {
      name: "impact_analysis",
      description: "Find definitions and references for a symbol across a project. Uses TypeScript AST for TS/JS files when available, with regex fallback.",
      inputSchema: { type: "object", properties: { name: { type: "string" }, projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.ts" }, includeTests: { type: "boolean", default: false }, maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 }, maxReferencesPerFile: { type: "number", default: 20, minimum: 1, maximum: 100 }, engine: { type: "string", enum: ["auto", "regex", "typescript", "semantic"], default: "auto" } }, required: ["name"], additionalProperties: false },
    },
    {
      name: "find_duplicate_symbols",
      description: "Scan a project for duplicated symbol definitions by name and kind. Uses TypeScript AST for TS/JS files when available, with regex fallback.",
      inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.ts" }, includeTests: { type: "boolean", default: false }, exportedOnly: { type: "boolean", default: false }, minOccurrences: { type: "number", default: 2, minimum: 2, maximum: 20 }, maxGroups: { type: "number", default: 50, minimum: 1, maximum: 200 }, maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 }, engine: { type: "string", enum: ["auto", "regex", "typescript", "semantic"], default: "auto" } }, additionalProperties: false },
    },
  ],
  handlers: {
    analyze_code: async (args) => {
      const parsed = z.object({ path: z.string(), symbol: z.string().optional(), maxSymbols: z.number().int().min(1).max(500).default(120), engine: z.enum(["auto", "regex", "typescript", "semantic"]).default("auto") }).parse(args);
      const snapshot = await readTextSnapshot(parsed.path);
      const analysis = await analyzeSymbols(snapshot.path, snapshot.text, parsed.engine);
      const duplicateGroups = groupDuplicateSymbols(analysis.symbols.map((symbol) => ({ ...symbol, file: path.basename(snapshot.path) })), false, 2, 50);
      const references = parsed.symbol ? await analyzeReferences(snapshot.path, snapshot.text, parsed.symbol, parsed.engine) : null;
      return { path: snapshot.path, language: detectLanguage(snapshot.path), engineRequested: parsed.engine, engineUsed: analysis.engineUsed, typeScriptAvailable: analysis.typeScriptAvailable, typeScriptReason: analysis.typeScriptReason, bytes: snapshot.bytes, totalLines: snapshot.totalLines, sha256: snapshot.sha256, symbolCount: analysis.symbols.length, symbols: compactSymbols(analysis.symbols, parsed.maxSymbols), imports: analysis.imports, exports: analysis.exports, diagnostics: analysis.diagnostics, duplicateSymbols: duplicateGroups, symbolQuery: parsed.symbol && references ? { name: parsed.symbol, engineUsed: references.engineUsed, references: trimReferences(references.references, 100), count: references.references.length } : null };
    },
    impact_analysis: async (args) => {
      const parsed = z.object({ name: z.string().min(1), projectRoot: z.string().optional(), filePattern: z.string().default("*.ts"), includeTests: z.boolean().default(false), maxFiles: z.number().int().min(1).max(2000).default(500), maxReferencesPerFile: z.number().int().min(1).max(100).default(20), engine: z.enum(["auto", "regex", "typescript", "semantic"]).default("auto") }).parse(args);
      if (parsed.engine === "semantic") {
        const semantic = await semanticImpact({ root: parsed.projectRoot ?? process.cwd(), name: parsed.name, includeTests: parsed.includeTests, maxFiles: parsed.maxFiles });
        if (!semantic.available) throw new Error(("reason" in semantic ? semantic.reason : undefined) ?? "Semantic TypeScript engine unavailable.");
        const crossFileCount = new Set(semantic.filesWithReferences.map((item) => item.file)).size;
        return { name: parsed.name, filePattern: parsed.filePattern, engineRequested: parsed.engine, enginesUsed: ["semantic"], ...semantic, risk: summarizeRisk(semantic.totalReferences, semantic.definitions.length, semantic.duplicateDefinitions, crossFileCount) };
      }
      const scan = await collectProjectTextFiles({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, maxFiles: parsed.maxFiles });
      const definitions: Array<{ file: string; line: number; kind: string; exported: boolean; source: string; text: string }> = [];
      const filesWithReferences = [];
      let totalReferences = 0;
      let callReferences = 0;
      let importReferences = 0;
      let typeReferences = 0;
      const enginesUsed = new Set<string>();
      for (const file of scan.files) {
        const symbolsAnalysis = await analyzeSymbols(file.path, file.text, parsed.engine);
        enginesUsed.add(String(symbolsAnalysis.engineUsed));
        for (const symbol of symbolsAnalysis.symbols) {
          if (symbol.name === parsed.name && symbol.kind !== "export") definitions.push({ file: file.relativePath, line: symbol.line, kind: symbol.kind, exported: symbol.exported, source: symbol.source, text: symbol.text });
        }
        const referenceAnalysis = await analyzeReferences(file.path, file.text, parsed.name, parsed.engine);
        enginesUsed.add(String(referenceAnalysis.engineUsed));
        const references = referenceAnalysis.references;
        if (references.length > 0) {
          totalReferences += references.length;
          callReferences += references.filter((ref) => ref.kind === "call").length;
          importReferences += references.filter((ref) => ref.kind === "import").length;
          typeReferences += references.filter((ref) => ref.kind === "type").length;
          filesWithReferences.push({ file: file.relativePath, count: references.length, references: trimReferences(references, parsed.maxReferencesPerFile) });
        }
      }
      const duplicateDefinitions = definitions.length;
      const crossFileCount = new Set(filesWithReferences.map((item) => item.file)).size;
      return { name: parsed.name, root: scan.root, filePattern: parsed.filePattern, engineRequested: parsed.engine, enginesUsed: Array.from(enginesUsed), scannedFiles: scan.files.length, skipped: scan.skipped, truncated: scan.truncated, definitions, duplicateDefinitions, totalReferences, callReferences, importReferences, typeReferences, filesWithReferences, risk: summarizeRisk(totalReferences, definitions.length, duplicateDefinitions, crossFileCount) };
    },
    find_duplicate_symbols: async (args) => {
      const parsed = z.object({ projectRoot: z.string().optional(), filePattern: z.string().default("*.ts"), includeTests: z.boolean().default(false), exportedOnly: z.boolean().default(false), minOccurrences: z.number().int().min(2).max(20).default(2), maxGroups: z.number().int().min(1).max(200).default(50), maxFiles: z.number().int().min(1).max(2000).default(500), engine: z.enum(["auto", "regex", "typescript", "semantic"]).default("auto") }).parse(args);
      const scan = await collectProjectTextFiles({ root: parsed.projectRoot ?? process.cwd(), filePattern: parsed.filePattern, includeTests: parsed.includeTests, maxFiles: parsed.maxFiles });
      const allSymbols: Array<UnifiedSymbol & { file: string }> = [];
      const enginesUsed = new Set<string>();
      for (const file of scan.files) {
        const analysis = await analyzeSymbols(file.path, file.text, parsed.engine);
        enginesUsed.add(String(analysis.engineUsed));
        for (const symbol of analysis.symbols) allSymbols.push({ ...symbol, file: file.relativePath });
      }
      const duplicates = groupDuplicateSymbols(allSymbols, parsed.exportedOnly, parsed.minOccurrences, parsed.maxGroups);
      return { root: scan.root, filePattern: parsed.filePattern, engineRequested: parsed.engine, enginesUsed: Array.from(enginesUsed), scannedFiles: scan.files.length, totalSymbols: allSymbols.length, duplicateGroupCount: duplicates.length, duplicates, skipped: scan.skipped, truncated: scan.truncated };
    },
  },
};
