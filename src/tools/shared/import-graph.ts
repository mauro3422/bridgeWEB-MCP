import path from "node:path";
import { collectProjectTextFiles, type ScannedTextFile } from "./project-scan.js";
import { analyzeTypeScriptSource, findTypeScriptIdentifierReferences, type TypeScriptImport, type TypeScriptSymbol } from "./typescript-intelligence.js";

export type ImportResolutionEngine = "auto" | "relative" | "typescript";

type TypeScriptModule = typeof import("typescript");

type TypeScriptResolver = {
  available: boolean;
  reason?: string;
  root: string;
  ts?: TypeScriptModule;
  compilerOptions?: import("typescript").CompilerOptions;
  host?: import("typescript").ModuleResolutionHost;
  cache?: import("typescript").ModuleResolutionCache;
  tsconfigPath?: string;
};

export type ImportGraphEdge = {
  from: string;
  to: string;
  module: string;
  line: number;
  typeOnly: boolean;
  external: boolean;
  resolved: boolean;
  resolutionEngine: "relative" | "typescript" | "unresolved";
  resolvedFile?: string;
};

export type ImportGraphNode = {
  file: string;
  imports: number;
  importedBy: number;
  symbols: number;
  exportedSymbols: number;
};

export type ImportGraphResult = {
  root: string;
  resolutionEngine: ImportResolutionEngine;
  resolver: { available: boolean; reason?: string; tsconfigPath?: string };
  scannedFiles: number;
  truncated: boolean;
  skipped: Array<{ path: string; reason: string }>;
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];
  unresolved: ImportGraphEdge[];
  externalImports: ImportGraphEdge[];
  internalEdges: ImportGraphEdge[];
  cycles: string[][];
  mostImported: Array<{ file: string; importedBy: number }>;
  mostImporting: Array<{ file: string; imports: number }>;
  orphanFiles: string[];
};

export type DeadCodeCandidate = {
  file: string;
  name: string;
  kind: string;
  line: number;
  exported: boolean;
  references: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  text: string;
};

function normalizeRel(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function normalizeAbs(filePath: string) {
  return path.resolve(filePath).toLowerCase();
}

function isInsideRoot(root: string, filePath: string) {
  const rel = path.relative(root, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function stripKnownExt(specifier: string) {
  return specifier.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");
}

function candidateRelativePaths(fromFile: string, moduleSpecifier: string) {
  const baseDir = path.dirname(fromFile);
  const raw = normalizeRel(path.normalize(path.join(baseDir, stripKnownExt(moduleSpecifier))));
  return [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.jsx`, `${raw}/index.ts`, `${raw}/index.tsx`, `${raw}/index.js`, `${raw}/index.jsx`];
}

function resolveInternalImport(fromFile: string, moduleSpecifier: string, knownFiles: Set<string>) {
  if (!moduleSpecifier.startsWith(".")) return null;
  for (const candidate of candidateRelativePaths(fromFile, moduleSpecifier)) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

async function loadTypeScript(): Promise<TypeScriptModule | null> {
  try {
    return await import("typescript");
  } catch {
    return null;
  }
}

async function createTypeScriptResolver(root: string, enabled: boolean): Promise<TypeScriptResolver> {
  if (!enabled) return { available: false, root, reason: "typescript resolver disabled" };
  const ts = await loadTypeScript();
  if (!ts) return { available: false, root, reason: "typescript package is not available at runtime" };
  const tsconfigPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  let compilerOptions: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true,
  };
  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
      compilerOptions = parsed.options;
    }
  }
  return {
    available: true,
    root,
    ts,
    compilerOptions,
    host: ts.sys,
    cache: ts.createModuleResolutionCache(root, (fileName) => fileName.toLowerCase(), compilerOptions),
    tsconfigPath,
  };
}

function resolveWithTypeScript(resolver: TypeScriptResolver, fromAbs: string, moduleSpecifier: string, knownFilesByAbs: Map<string, string>) {
  if (!resolver.available || !resolver.ts || !resolver.compilerOptions || !resolver.host) return null;
  const resolved = resolver.ts.resolveModuleName(moduleSpecifier, fromAbs, resolver.compilerOptions, resolver.host, resolver.cache).resolvedModule;
  if (!resolved) return null;
  const resolvedAbs = path.resolve(resolved.resolvedFileName);
  const knownRel = knownFilesByAbs.get(normalizeAbs(resolvedAbs));
  const inRoot = isInsideRoot(resolver.root, resolvedAbs);
  const external = resolved.isExternalLibraryImport === true || !inRoot || resolvedAbs.toLowerCase().includes(`${path.sep}node_modules${path.sep}`);
  if (knownRel) {
    return { to: knownRel, external: false, resolved: true, resolvedFile: normalizeRel(path.relative(resolver.root, resolvedAbs)) };
  }
  if (inRoot && !external && !resolvedAbs.endsWith(".d.ts")) {
    return { to: normalizeRel(path.relative(resolver.root, resolvedAbs)), external: false, resolved: true, resolvedFile: normalizeRel(path.relative(resolver.root, resolvedAbs)) };
  }
  return { to: moduleSpecifier, external: true, resolved: true, resolvedFile: normalizeRel(resolved.resolvedFileName) };
}

function findCycles(nodes: string[], edges: ImportGraphEdge[], maxCycles: number) {
  const graph = new Map<string, string[]>();
  for (const node of nodes) graph.set(node, []);
  for (const edge of edges) if (!edge.external && edge.resolved) graph.get(edge.from)?.push(edge.to);
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  const visiting = new Set<string>();
  function canonical(cycle: string[]) {
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join(" -> "));
    return rotations.sort()[0] ?? cycle.join(" -> ");
  }
  function dfs(node: string) {
    if (cycles.length >= maxCycles) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (cycles.length >= maxCycles) break;
      if (!visiting.has(next)) dfs(next);
      else {
        const start = stack.indexOf(next);
        if (start >= 0) {
          const cycle = [...stack.slice(start), next];
          const key = canonical(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      }
    }
    stack.pop();
    visiting.delete(node);
  }
  for (const node of nodes) {
    if (cycles.length >= maxCycles) break;
    dfs(node);
  }
  return cycles;
}

async function analyzeFile(file: ScannedTextFile) {
  const analysis = await analyzeTypeScriptSource(file.path, file.text);
  if (!analysis.available) return { imports: [] as TypeScriptImport[], symbols: [] as TypeScriptSymbol[] };
  return { imports: analysis.imports, symbols: analysis.symbols };
}

export async function buildImportGraph(options: { root: string; filePattern?: string; includeTests?: boolean; includeExternal?: boolean; maxFiles?: number; maxCycles?: number; resolutionEngine?: ImportResolutionEngine }): Promise<ImportGraphResult> {
  const root = path.resolve(options.root);
  const resolutionEngine = options.resolutionEngine ?? "auto";
  const scan = await collectProjectTextFiles({ root, filePattern: options.filePattern ?? "*.ts", includeTests: options.includeTests === true, maxFiles: options.maxFiles ?? 500 });
  const knownFiles = new Set(scan.files.map((file) => normalizeRel(file.relativePath)));
  const knownFilesByAbs = new Map(scan.files.map((file) => [normalizeAbs(file.path), normalizeRel(file.relativePath)]));
  const tsResolver = await createTypeScriptResolver(root, resolutionEngine !== "relative");
  const nodeStats = new Map<string, { imports: number; importedBy: number; symbols: number; exportedSymbols: number }>();
  const edges: ImportGraphEdge[] = [];

  for (const file of scan.files) {
    const rel = normalizeRel(file.relativePath);
    const analyzed = await analyzeFile(file);
    nodeStats.set(rel, { imports: 0, importedBy: 0, symbols: analyzed.symbols.length, exportedSymbols: analyzed.symbols.filter((symbol) => symbol.exported).length });
    for (const imported of analyzed.imports) {
      const tsResolved = resolutionEngine !== "relative" ? resolveWithTypeScript(tsResolver, file.path, imported.module, knownFilesByAbs) : null;
      const relativeTarget = tsResolved ? null : resolveInternalImport(rel, imported.module, knownFiles);
      const external = tsResolved ? tsResolved.external : !imported.module.startsWith(".");
      if (external && options.includeExternal !== true) continue;
      const edge: ImportGraphEdge = {
        from: rel,
        to: tsResolved?.to ?? relativeTarget ?? imported.module,
        module: imported.module,
        line: imported.line,
        typeOnly: imported.typeOnly,
        external,
        resolved: tsResolved?.resolved ?? (relativeTarget !== null || external),
        resolutionEngine: tsResolved ? "typescript" : relativeTarget ? "relative" : "unresolved",
        resolvedFile: tsResolved?.resolvedFile,
      };
      edges.push(edge);
      const current = nodeStats.get(rel);
      if (current) current.imports += 1;
      if (!edge.external && edge.resolved) {
        const targetStats = nodeStats.get(edge.to) ?? { imports: 0, importedBy: 0, symbols: 0, exportedSymbols: 0 };
        targetStats.importedBy += 1;
        nodeStats.set(edge.to, targetStats);
      }
    }
  }

  const nodes = Array.from(nodeStats.entries()).map(([file, stats]) => ({ file, ...stats })).sort((a, b) => a.file.localeCompare(b.file));
  const internalEdges = edges.filter((edge) => !edge.external && edge.resolved);
  const unresolved = edges.filter((edge) => !edge.external && !edge.resolved);
  const externalImports = edges.filter((edge) => edge.external);
  return {
    root: scan.root,
    resolutionEngine,
    resolver: { available: tsResolver.available, reason: tsResolver.reason, tsconfigPath: tsResolver.tsconfigPath },
    scannedFiles: scan.files.length,
    truncated: scan.truncated,
    skipped: scan.skipped,
    nodes,
    edges,
    unresolved,
    externalImports,
    internalEdges,
    cycles: findCycles(nodes.map((node) => node.file), internalEdges, options.maxCycles ?? 20),
    mostImported: nodes.filter((node) => node.importedBy > 0).sort((a, b) => b.importedBy - a.importedBy).slice(0, 20).map(({ file, importedBy }) => ({ file, importedBy })),
    mostImporting: nodes.filter((node) => node.imports > 0).sort((a, b) => b.imports - a.imports).slice(0, 20).map(({ file, imports }) => ({ file, imports })),
    orphanFiles: nodes.filter((node) => node.importedBy === 0 && node.imports === 0).map((node) => node.file).slice(0, 100),
  };
}

export async function findDeadCodeCandidates(options: { root: string; filePattern?: string; includeTests?: boolean; includeExported?: boolean; maxFiles?: number; maxCandidates?: number }): Promise<{ root: string; scannedFiles: number; candidates: DeadCodeCandidate[]; skipped: Array<{ path: string; reason: string }>; truncated: boolean }> {
  const scan = await collectProjectTextFiles({ root: options.root, filePattern: options.filePattern ?? "*.ts", includeTests: options.includeTests === true, maxFiles: options.maxFiles ?? 500 });
  const candidates: DeadCodeCandidate[] = [];
  const maxCandidates = Math.max(1, Math.min(500, Math.trunc(options.maxCandidates ?? 100)));
  for (const file of scan.files) {
    if (candidates.length >= maxCandidates) break;
    const analyzed = await analyzeFile(file);
    for (const symbol of analyzed.symbols) {
      if (candidates.length >= maxCandidates) break;
      if (symbol.kind === "method") continue;
      if (symbol.exported && options.includeExported !== true) continue;
      const refs = await findTypeScriptIdentifierReferences(file.path, file.text, symbol.name);
      const nonDefinitionRefs = refs.references.filter((ref) => ref.kind !== "definition" && ref.kind !== "export");
      if (nonDefinitionRefs.length === 0) {
        candidates.push({ file: normalizeRel(file.relativePath), name: symbol.name, kind: symbol.kind, line: symbol.line, exported: symbol.exported, references: nonDefinitionRefs.length, confidence: symbol.exported ? "low" : "medium", reason: symbol.exported ? "Exported symbol has no references inside its defining file; external usage is unknown." : "Local symbol has no AST references outside its definition in the same file.", text: symbol.text });
      }
    }
  }
  return { root: scan.root, scannedFiles: scan.files.length, candidates, skipped: scan.skipped, truncated: scan.truncated };
}
