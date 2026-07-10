import fs from "node:fs";
import path from "node:path";
import { readPersistentCache, writePersistentCache, type PersistentCacheMeta } from "./persistent-cache.js";
import { resolveToolPath } from "./path.js";

type TypeScriptModule = typeof import("typescript");

type SemanticReferenceKind = "definition" | "import" | "export" | "call" | "type" | "reference";

export type SemanticReference = {
  file: string;
  line: number;
  column: number;
  kind: SemanticReferenceKind;
  text: string;
};

export type SemanticDeclaration = {
  file: string;
  line: number;
  column: number;
  name: string;
  kind: string;
  exported: boolean;
  text: string;
};

export type SemanticSymbolGroup = {
  key: string;
  name: string;
  declarations: SemanticDeclaration[];
  references: SemanticReference[];
  nonDefinitionReferences: SemanticReference[];
};

export type SemanticIndex = {
  available: boolean;
  reason?: string;
  root: string;
  cache?: { hit: boolean; key: string; persistent?: PersistentCacheMeta };
  tsconfigPath?: string;
  scannedFiles: number;
  groups: SemanticSymbolGroup[];
};


const semanticIndexStore = new Map<string, SemanticIndex>();
const SEMANTIC_INDEX_STORE_MAX = 8;

function rememberSemanticIndex(key: string, index: SemanticIndex) {
  if (!semanticIndexStore.has(key) && semanticIndexStore.size >= SEMANTIC_INDEX_STORE_MAX) {
    const oldest = semanticIndexStore.keys().next().value;
    if (oldest) semanticIndexStore.delete(oldest);
  }
  semanticIndexStore.set(key, index);
}

function fileStamp(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    return `${path.resolve(filePath)}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return `${path.resolve(filePath)}:missing`;
  }
}

function semanticIndexStoreKey(root: string, includeTests: boolean, maxFiles: number, name: string | undefined, tsconfigPath: string | undefined, files: string[]) {
  return [root, String(includeTests), String(maxFiles), name ?? "", tsconfigPath ?? "", ...files.map(fileStamp)].join("|");
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

function findTsConfig(ts: TypeScriptModule, root: string) {
  return ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
}

function createProgram(ts: TypeScriptModule, root: string, includeTests: boolean, maxFiles: number) {
  const tsconfigPath = findTsConfig(ts, root);
  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, " "));
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
    const files = parsed.fileNames.filter((file) => isProjectSource(root, file, includeTests)).slice(0, maxFiles);
    return { tsconfigPath, program: ts.createProgram(files, parsed.options), files };
  }
  const fallbackFiles: string[] = [];
  const walk = (dir: string) => {
    if (fallbackFiles.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (fallbackFiles.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "build", ".git"].includes(entry.name)) walk(full);
      } else if (entry.isFile() && isProjectSource(root, full, includeTests)) {
        fallbackFiles.push(full);
      }
    }
  };
  walk(root);
  return { tsconfigPath: undefined, program: ts.createProgram(fallbackFiles, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }), files: fallbackFiles };
}

function lineText(sourceText: string, line: number) {
  return (sourceText.split(/\r?\n/)[line - 1] ?? "").trim().slice(0, 240);
}

function lineColumn(ts: TypeScriptModule, sourceFile: import("typescript").SourceFile, pos: number) {
  const loc = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return { line: loc.line + 1, column: loc.character + 1 };
}

function symbolKey(root: string, symbol: import("typescript").Symbol) {
  const declarations = symbol.declarations ?? [];
  const declaration = declarations[0];
  if (!declaration) return `unknown:${symbol.name}`;
  const file = declaration.getSourceFile().fileName;
  return `${normalizeRel(root, file)}:${declaration.pos}:${declaration.end}:${symbol.name}`;
}

function resolveAlias(ts: TypeScriptModule, checker: import("typescript").TypeChecker, symbol: import("typescript").Symbol) {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function symbolAtIdentifier(
  ts: TypeScriptModule,
  checker: import("typescript").TypeChecker,
  node: import("typescript").Identifier,
): import("typescript").Symbol | undefined {
  const parent = node.parent;
  if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    return checker.getShorthandAssignmentValueSymbol(parent) ?? checker.getSymbolAtLocation(node);
  }
  return checker.getSymbolAtLocation(node);
}

function modifierExported(ts: TypeScriptModule, node: import("typescript").Node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function declarationKind(ts: TypeScriptModule, node: import("typescript").Node) {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) return "const";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) return "import";
  return "symbol";
}

function declarationForIdentifier(ts: TypeScriptModule, node: import("typescript").Identifier) {
  const parent = node.parent;
  if (!parent) return null;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent)) && parent.name === node) return parent;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return parent;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return parent;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return parent;
  return null;
}

function referenceKind(ts: TypeScriptModule, node: import("typescript").Identifier): SemanticReferenceKind {
  const parent = node.parent;
  if (!parent) return "reference";
  if (declarationForIdentifier(ts, node)) return "definition";
  if (ts.isExportSpecifier(parent)) return "export";
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return "import";
  if (ts.isCallExpression(parent) && parent.expression === node) return "call";
  if (ts.isTypeReferenceNode(parent)) return "type";
  return "reference";
}

function declarationFromNode(ts: TypeScriptModule, root: string, sourceFile: import("typescript").SourceFile, node: import("typescript").Node, name: string): SemanticDeclaration {
  const { line, column } = lineColumn(ts, sourceFile, node.getStart(sourceFile));
  return {
    file: normalizeRel(root, sourceFile.fileName),
    line,
    column,
    name,
    kind: declarationKind(ts, node),
    exported: modifierExported(ts, node) || Boolean((node.parent && modifierExported(ts, node.parent))),
    text: lineText(sourceFile.text, line),
  };
}

export async function buildSemanticIndex(options: { root: string; includeTests?: boolean; maxFiles?: number; name?: string }): Promise<SemanticIndex> {
  const ts = await loadTypeScript();
  const root = resolveToolPath(options.root, { access: "read" });
  if (!ts) return { available: false, reason: "typescript package is not available at runtime", root, scannedFiles: 0, groups: [] };
  const maxFiles = Math.max(1, Math.min(2000, Math.trunc(options.maxFiles ?? 500)));
  const includeTests = options.includeTests === true;
  const { tsconfigPath, program, files } = createProgram(ts, root, includeTests, maxFiles);
  const storeKey = semanticIndexStoreKey(root, includeTests, maxFiles, options.name, tsconfigPath, files);
  const stored = semanticIndexStore.get(storeKey);
  if (stored) return { ...stored, cache: { hit: true, key: storeKey } };
  const persisted = readPersistentCache<SemanticIndex>("semantic-index", storeKey);
  if (persisted.value) {
    const result: SemanticIndex = { ...persisted.value, cache: { hit: true, key: storeKey, persistent: persisted.meta } };
    rememberSemanticIndex(storeKey, result);
    return result;
  }
  const checker = program.getTypeChecker();
  const groups = new Map<string, SemanticSymbolGroup>();

  const ensureGroup = (key: string, name: string) => {
    const current = groups.get(key);
    if (current) return current;
    const created: SemanticSymbolGroup = { key, name, declarations: [], references: [], nonDefinitionReferences: [] };
    groups.set(key, created);
    return created;
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (!files.includes(sourceFile.fileName)) continue;
    const visit = (node: import("typescript").Node) => {
      if (ts.isIdentifier(node) && (!options.name || node.text === options.name)) {
        const rawSymbol = symbolAtIdentifier(ts, checker, node);
        if (rawSymbol) {
          const symbol = resolveAlias(ts, checker, rawSymbol);
          const key = symbolKey(root, symbol);
          const group = ensureGroup(key, symbol.name || node.text);
          const { line, column } = lineColumn(ts, sourceFile, node.getStart(sourceFile));
          const kind = referenceKind(ts, node);
          const reference: SemanticReference = { file: normalizeRel(root, sourceFile.fileName), line, column, kind, text: lineText(sourceFile.text, line) };
          group.references.push(reference);
          if (kind !== "definition" && kind !== "export") group.nonDefinitionReferences.push(reference);
          const declaration = declarationForIdentifier(ts, node);
          if (declaration) {
            const decl = declarationFromNode(ts, root, sourceFile, declaration, node.text);
            if (!group.declarations.some((item) => item.file === decl.file && item.line === decl.line && item.column === decl.column && item.name === decl.name)) {
              group.declarations.push(decl);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const result: SemanticIndex = { available: true, root, tsconfigPath, scannedFiles: files.length, groups: Array.from(groups.values()), cache: { hit: false, key: storeKey } };
  result.cache = { hit: false, key: storeKey };
  const persistedWrite = writePersistentCache("semantic-index", storeKey, result);
  result.cache = { hit: false, key: storeKey, persistent: persistedWrite };
  rememberSemanticIndex(storeKey, result);
  return result;
}

export async function semanticImpact(options: { root: string; name: string; includeTests?: boolean; maxFiles?: number }) {
  const index = await buildSemanticIndex({ root: options.root, includeTests: options.includeTests, maxFiles: options.maxFiles });
  if (!index.available) return { ...index, definitions: [], totalReferences: 0, filesWithReferences: [], duplicateDefinitions: 0 };
  const groups = index.groups.filter((group) => group.name === options.name || group.declarations.some((decl) => decl.name === options.name));
  const definitions = groups.flatMap((group) => group.declarations.map((decl) => ({ ...decl, symbolKey: group.key })));
  const allReferences = groups.flatMap((group) => group.references.map((ref) => ({ ...ref, symbolKey: group.key })));
  const files = new Map<string, typeof allReferences>();
  for (const ref of allReferences) {
    const current = files.get(ref.file) ?? [];
    current.push(ref);
    files.set(ref.file, current);
  }
  return {
    available: true,
    root: index.root,
    tsconfigPath: index.tsconfigPath,
    scannedFiles: index.scannedFiles,
    cache: index.cache,
    semanticSymbolCount: groups.length,
    definitions,
    duplicateDefinitions: definitions.length,
    totalReferences: allReferences.length,
    callReferences: allReferences.filter((ref) => ref.kind === "call").length,
    importReferences: allReferences.filter((ref) => ref.kind === "import").length,
    typeReferences: allReferences.filter((ref) => ref.kind === "type").length,
    filesWithReferences: Array.from(files.entries()).map(([file, references]) => ({ file, count: references.length, references })),
    groups,
  };
}

export async function semanticDeadCode(options: { root: string; includeTests?: boolean; includeExported?: boolean; maxFiles?: number; maxCandidates?: number }) {
  const index = await buildSemanticIndex({ root: options.root, includeTests: options.includeTests, maxFiles: options.maxFiles });
  if (!index.available) return { ...index, candidates: [] };
  const maxCandidates = Math.max(1, Math.min(500, Math.trunc(options.maxCandidates ?? 100)));
  const candidates = [];
  for (const group of index.groups) {
    if (candidates.length >= maxCandidates) break;
    const declaration = group.declarations[0];
    if (!declaration) continue;
    if (declaration.kind === "import" || declaration.kind === "method") continue;
    if (declaration.exported && options.includeExported !== true) continue;
    if (group.nonDefinitionReferences.length === 0) {
      candidates.push({
        symbolKey: group.key,
        file: declaration.file,
        name: declaration.name,
        kind: declaration.kind,
        line: declaration.line,
        exported: declaration.exported,
        references: group.nonDefinitionReferences.length,
        confidence: declaration.exported ? "low" : "high",
        reason: declaration.exported ? "Exported symbol has no semantic references inside the TypeScript program; external/package usage is still possible." : "Local symbol has no semantic references outside its declaration in the TypeScript program.",
        text: declaration.text,
      });
    }
  }
  return { available: true, root: index.root, tsconfigPath: index.tsconfigPath, scannedFiles: index.scannedFiles, candidates };
}
