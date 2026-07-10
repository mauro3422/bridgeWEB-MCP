import fs from "node:fs";
import path from "node:path";
import { readPersistentCache, writePersistentCache, type PersistentCacheMeta } from "./persistent-cache.js";
import { resolveToolPath } from "./path.js";

type TypeScriptModule = typeof import("typescript");

type CallableNode = {
  key: string;
  file: string;
  name: string;
  kind: string;
  line: number;
  column: number;
  exported: boolean;
  text: string;
  calls: number;
  calledBy: number;
};

type CallGraphEdge = {
  from: string;
  to: string;
  caller: string;
  callee: string;
  file: string;
  line: number;
  column: number;
  external: boolean;
  resolved: boolean;
  text: string;
};

export type CallGraphResult = {
  available: boolean;
  reason?: string;
  root: string;
  tsconfigPath?: string;
  scannedFiles: number;
  truncated: boolean;
  cache?: { hit: boolean; key: string; persistent?: PersistentCacheMeta };
  nodes: CallableNode[];
  edges: CallGraphEdge[];
  internalEdges: CallGraphEdge[];
  externalCalls: CallGraphEdge[];
  unresolvedCalls: CallGraphEdge[];
  cycles: string[][];
  mostCalled: Array<{ key: string; name: string; file: string; calledBy: number }>;
  mostCalling: Array<{ key: string; name: string; file: string; calls: number }>;
};

const memoryStore = new Map<string, CallGraphResult>();
const MEMORY_STORE_MAX = 8;

function remember(key: string, result: CallGraphResult) {
  if (!memoryStore.has(key) && memoryStore.size >= MEMORY_STORE_MAX) {
    const oldest = memoryStore.keys().next().value;
    if (oldest) memoryStore.delete(oldest);
  }
  memoryStore.set(key, result);
}

function fileStamp(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    return `${path.resolve(filePath)}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return `${path.resolve(filePath)}:missing`;
  }
}

async function loadTypeScript(): Promise<TypeScriptModule | null> {
  try {
    return await import("typescript");
  } catch {
    return null;
  }
}

function normalizeRel(root: string, filePath: string) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function isInsideRoot(root: string, filePath: string) {
  const rel = path.relative(root, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isProjectSource(root: string, filePath: string, includeTests: boolean) {
  const rel = normalizeRel(root, filePath).toLowerCase();
  if (!isInsideRoot(root, filePath)) return false;
  if (rel.includes("/node_modules/") || rel.startsWith("node_modules/")) return false;
  if (rel.includes("/dist/") || rel.startsWith("dist/")) return false;
  if (!includeTests && (rel.includes("/test/") || rel.includes("/tests/") || rel.endsWith(".test.ts") || rel.endsWith(".spec.ts"))) return false;
  return /\.[cm]?[tj]sx?$/.test(rel);
}

function createProgram(ts: TypeScriptModule, root: string, includeTests: boolean, maxFiles: number) {
  const tsconfigPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, " "));
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
    const files = parsed.fileNames.filter((file) => isProjectSource(root, file, includeTests)).slice(0, maxFiles);
    return { tsconfigPath, program: ts.createProgram(files, parsed.options), files, truncated: parsed.fileNames.length > files.length };
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "build", ".git", "data", "logs", "sandbox"].includes(entry.name)) walk(full);
      } else if (entry.isFile() && isProjectSource(root, full, includeTests)) {
        files.push(full);
      }
    }
  };
  walk(root);
  return { tsconfigPath: undefined, program: ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }), files, truncated: false };
}

function lineColumn(ts: TypeScriptModule, sourceFile: import("typescript").SourceFile, pos: number) {
  const loc = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return { line: loc.line + 1, column: loc.character + 1 };
}

function lineText(sourceText: string, line: number) {
  return (sourceText.split(/\r?\n/)[line - 1] ?? "").trim().slice(0, 240);
}

function modifiersExported(ts: TypeScriptModule, node: import("typescript").Node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function callableName(ts: TypeScriptModule, node: import("typescript").Node): { name: string; kind: string } | null {
  if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, kind: "function" };
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return { name: node.name.text, kind: "method" };
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return { name: node.parent.name.text, kind: "function" };
  return null;
}

function callableDeclarationNode(ts: TypeScriptModule, node: import("typescript").Node): import("typescript").Node | null {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node;
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent)) return node.parent;
  return null;
}

function isCallableNode(ts: TypeScriptModule, node: import("typescript").Node) {
  return callableName(ts, node) !== null;
}

function callableKey(ts: TypeScriptModule, root: string, node: import("typescript").Node, name: string) {
  const declaration = callableDeclarationNode(ts, node) ?? node;
  const sourceFile = declaration.getSourceFile();
  return `${normalizeRel(root, sourceFile.fileName)}:${declaration.pos}:${declaration.end}:${name}`;
}

function findEnclosingCallable(ts: TypeScriptModule, node: import("typescript").Node, nodeKeys: WeakMap<import("typescript").Node, string>) {
  let current: import("typescript").Node | undefined = node;
  while (current) {
    if (isCallableNode(ts, current)) {
      const key = nodeKeys.get(current);
      if (key) return key;
    }
    current = current.parent;
  }
  return null;
}

function resolveAlias(ts: TypeScriptModule, checker: import("typescript").TypeChecker, symbol: import("typescript").Symbol) {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try { return checker.getAliasedSymbol(symbol); } catch { return symbol; }
  }
  return symbol;
}

function symbolDeclaration(symbol: import("typescript").Symbol) {
  return symbol.declarations?.[0] ?? null;
}

function expressionName(ts: TypeScriptModule, expression: import("typescript").Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.getText().slice(0, 120);
}

function collectCycles(nodes: string[], edges: CallGraphEdge[], maxCycles: number) {
  if (maxCycles <= 0) return [];
  const graph = new Map<string, string[]>();
  for (const node of nodes) graph.set(node, []);
  for (const edge of edges) if (!edge.external && edge.resolved) graph.get(edge.from)?.push(edge.to);
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visiting = new Set<string>();
  const completed = new Set<string>();
  const seen = new Set<string>();
  const canonical = (cycle: string[]) => {
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join(" -> "));
    return rotations.sort()[0] ?? cycle.join(" -> ");
  };
  const dfs = (node: string) => {
    if (cycles.length >= maxCycles) return;
    if (completed.has(node) || visiting.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (cycles.length >= maxCycles) break;
      if (visiting.has(next)) {
        const start = stack.indexOf(next);
        if (start >= 0) {
          const cycle = [...stack.slice(start), next];
          const key = canonical(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      } else {
        dfs(next);
      }
    }
    completed.add(node);
    stack.pop();
    visiting.delete(node);
  };
  for (const node of nodes) {
    if (cycles.length >= maxCycles) break;
    if (!completed.has(node)) dfs(node);
  }
  return cycles;
}

function cacheKey(root: string, tsconfigPath: string | undefined, includeTests: boolean, maxFiles: number, maxCycles: number, includeExternal: boolean, files: string[]) {
  const stamps = files.map(fileStamp);
  const tsconfigStamp = tsconfigPath ? fileStamp(tsconfigPath) : `${path.join(root, "tsconfig.json")}:missing`;
  return [root, tsconfigStamp, String(includeTests), String(maxFiles), String(maxCycles), String(includeExternal), ...stamps].join("|");
}

export async function buildCallGraph(options: { root: string; includeTests?: boolean; includeExternal?: boolean; maxFiles?: number; maxCycles?: number }): Promise<CallGraphResult> {
  const ts = await loadTypeScript();
  const root = resolveToolPath(options.root, { access: "read" });
  if (!ts) return { available: false, reason: "typescript package is not available at runtime", root, scannedFiles: 0, truncated: false, nodes: [], edges: [], internalEdges: [], externalCalls: [], unresolvedCalls: [], cycles: [], mostCalled: [], mostCalling: [] };

  const includeTests = options.includeTests === true;
  const includeExternal = options.includeExternal === true;
  const maxFiles = Math.max(1, Math.min(2000, Math.trunc(options.maxFiles ?? 500)));
  const maxCycles = Math.max(0, Math.min(100, Math.trunc(options.maxCycles ?? 20)));
  const { tsconfigPath, program, files, truncated } = createProgram(ts, root, includeTests, maxFiles);
  const key = cacheKey(root, tsconfigPath, includeTests, maxFiles, maxCycles, includeExternal, files);
  const memory = memoryStore.get(key);
  if (memory) return { ...memory, cache: { hit: true, key, persistent: memory.cache?.persistent } };
  const persisted = readPersistentCache<CallGraphResult>("call-graph", key);
  if (persisted.value) {
    const result: CallGraphResult = { ...persisted.value, cache: { hit: true, key, persistent: persisted.meta } };
    remember(key, result);
    return result;
  }

  const checker = program.getTypeChecker();
  const nodes = new Map<string, CallableNode>();
  const nodeKeys = new WeakMap<import("typescript").Node, string>();
  const callableByDeclaration = new Map<import("typescript").Node, string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (!files.includes(sourceFile.fileName)) continue;
    const visit = (node: import("typescript").Node) => {
      const named = callableName(ts, node);
      if (named) {
        const keyForNode = callableKey(ts, root, node, named.name);
        const declaration = callableDeclarationNode(ts, node) ?? node;
        const { line, column } = lineColumn(ts, sourceFile, declaration.getStart(sourceFile));
        const exported = modifiersExported(ts, declaration) || Boolean(declaration.parent && modifiersExported(ts, declaration.parent));
        const callable: CallableNode = { key: keyForNode, file: normalizeRel(root, sourceFile.fileName), name: named.name, kind: named.kind, line, column, exported, text: lineText(sourceFile.text, line), calls: 0, calledBy: 0 };
        nodes.set(keyForNode, callable);
        nodeKeys.set(node, keyForNode);
        callableByDeclaration.set(declaration, keyForNode);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const edges: CallGraphEdge[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (!files.includes(sourceFile.fileName)) continue;
    const visit = (node: import("typescript").Node) => {
      if (ts.isCallExpression(node)) {
        const callerKey = findEnclosingCallable(ts, node, nodeKeys);
        if (callerKey) {
          const calleeName = expressionName(ts, node.expression);
          const rawSymbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
          const symbol = rawSymbol ? resolveAlias(ts, checker, rawSymbol) : null;
          const declaration = symbol ? symbolDeclaration(symbol) : null;
          let calleeKey: string | null = null;
          if (declaration && isInsideRoot(root, declaration.getSourceFile().fileName)) {
            const direct = callableByDeclaration.get(declaration);
            if (direct) calleeKey = direct;
            else {
              let maybe: import("typescript").Node | undefined = declaration;
              while (maybe && !calleeKey) {
                calleeKey = callableByDeclaration.get(maybe) ?? null;
                maybe = maybe.parent;
              }
            }
          }
          const { line, column } = lineColumn(ts, sourceFile, node.expression.getStart(sourceFile));
          const external = !calleeKey;
          if (!external || includeExternal) {
            const edge: CallGraphEdge = {
              from: callerKey,
              to: calleeKey ?? calleeName,
              caller: nodes.get(callerKey)?.name ?? callerKey,
              callee: calleeKey ? nodes.get(calleeKey)?.name ?? calleeName : calleeName,
              file: normalizeRel(root, sourceFile.fileName),
              line,
              column,
              external,
              resolved: Boolean(calleeKey),
              text: lineText(sourceFile.text, line),
            };
            edges.push(edge);
            const caller = nodes.get(callerKey);
            if (caller) caller.calls += 1;
            if (calleeKey) {
              const callee = nodes.get(calleeKey);
              if (callee) callee.calledBy += 1;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const nodeList = Array.from(nodes.values()).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  const internalEdges = edges.filter((edge) => !edge.external && edge.resolved);
  const externalCalls = edges.filter((edge) => edge.external);
  const unresolvedCalls = edges.filter((edge) => !edge.resolved);
  const result: CallGraphResult = {
    available: true,
    root,
    tsconfigPath,
    scannedFiles: files.length,
    truncated,
    cache: { hit: false, key },
    nodes: nodeList,
    edges,
    internalEdges,
    externalCalls,
    unresolvedCalls,
    cycles: collectCycles(nodeList.map((node) => node.key), internalEdges, maxCycles),
    mostCalled: nodeList.filter((node) => node.calledBy > 0).sort((a, b) => b.calledBy - a.calledBy).slice(0, 20).map(({ key, name, file, calledBy }) => ({ key, name, file, calledBy })),
    mostCalling: nodeList.filter((node) => node.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 20).map(({ key, name, file, calls }) => ({ key, name, file, calls })),
  };
  result.cache = { hit: false, key };
  const persistedWrite = writePersistentCache("call-graph", key, result);
  result.cache = { hit: false, key, persistent: persistedWrite };
  remember(key, result);
  return result;
}










