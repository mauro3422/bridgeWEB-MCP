import path from "node:path";

export type TypeScriptSymbolKind = "function" | "class" | "const" | "type" | "interface" | "enum" | "method";
export type TypeScriptSymbol = {
  name: string;
  kind: TypeScriptSymbolKind;
  line: number;
  exported: boolean;
  text: string;
};

export type TypeScriptImport = {
  module: string;
  line: number;
  typeOnly: boolean;
  defaultImport?: string;
  namespaceImport?: string;
  namedImports: string[];
};

export type TypeScriptExport = {
  line: number;
  typeOnly: boolean;
  names: string[];
  module?: string;
};

export type TypeScriptReference = {
  line: number;
  column: number;
  text: string;
  kind: "definition" | "import" | "export" | "call" | "type" | "reference";
};

type TypeScriptModule = typeof import("typescript");

type AnalysisResult = {
  available: boolean;
  file: string;
  language: "TypeScript" | "TSX" | "JavaScript" | "unknown";
  symbols: TypeScriptSymbol[];
  imports: TypeScriptImport[];
  exports: TypeScriptExport[];
  diagnostics: Array<{ line: number; message: string }>;
  reason?: string;
};

async function loadTypeScript(): Promise<TypeScriptModule | null> {
  try {
    return await import("typescript");
  } catch {
    return null;
  }
}

function scriptKindForPath(ts: TypeScriptModule, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function languageForPath(filePath: string): AnalysisResult["language"] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx") return "TSX";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "JavaScript";
  if (ext === ".ts") return "TypeScript";
  return "unknown";
}

function lineText(sourceText: string, line: number): string {
  return (sourceText.split(/\r?\n/)[line - 1] ?? "").trim().slice(0, 240);
}

function lineColumn(ts: TypeScriptModule, sourceFile: import("typescript").SourceFile, pos: number) {
  const location = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return { line: location.line + 1, column: location.character + 1 };
}

function modifiersOf(ts: TypeScriptModule, node: import("typescript").Node) {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function hasModifier(ts: TypeScriptModule, node: import("typescript").Node, kind: import("typescript").SyntaxKind) {
  return modifiersOf(ts, node).some((modifier) => modifier.kind === kind);
}

function isExported(ts: TypeScriptModule, node: import("typescript").Node) {
  return hasModifier(ts, node, ts.SyntaxKind.ExportKeyword) || hasModifier(ts, node, ts.SyntaxKind.DefaultKeyword);
}

function identifierName(node: import("typescript").Node | undefined) {
  return node && "text" in node && typeof node.text === "string" ? node.text : null;
}

function symbolFromNode(ts: TypeScriptModule, sourceFile: import("typescript").SourceFile, sourceText: string, node: import("typescript").Node, name: string, kind: TypeScriptSymbolKind): TypeScriptSymbol {
  const { line } = lineColumn(ts, sourceFile, node.getStart(sourceFile));
  return { name, kind, line, exported: isExported(ts, node), text: lineText(sourceText, line) };
}

function collectImport(ts: TypeScriptModule, sourceFile: import("typescript").SourceFile, sourceText: string, node: import("typescript").ImportDeclaration): TypeScriptImport | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;
  const clause = node.importClause;
  const namedImports: string[] = [];
  let namespaceImport: string | undefined;
  const defaultImport = clause?.name?.text;
  if (clause?.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) namespaceImport = clause.namedBindings.name.text;
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) namedImports.push(element.name.text);
    }
  }
  const { line } = lineColumn(ts, sourceFile, node.getStart(sourceFile));
  return { module: node.moduleSpecifier.text, line, typeOnly: clause?.isTypeOnly === true, defaultImport, namespaceImport, namedImports };
}

function collectExport(ts: TypeScriptModule, sourceFile: import("typescript").SourceFile, node: import("typescript").ExportDeclaration): TypeScriptExport {
  const names: string[] = [];
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) names.push(element.name.text);
  }
  const module = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  const { line } = lineColumn(ts, sourceFile, node.getStart(sourceFile));
  return { line, typeOnly: node.isTypeOnly === true, names, module };
}

function classifyIdentifier(ts: TypeScriptModule, node: import("typescript").Identifier): TypeScriptReference["kind"] {
  const parent = node.parent;
  if (!parent) return "reference";
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent)) && parent.name === node) return "definition";
  if (ts.isVariableDeclaration(parent) && parent.name === node) return "definition";
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return "import";
  if (ts.isExportSpecifier(parent)) return "export";
  if (ts.isCallExpression(parent) && parent.expression === node) return "call";
  if (ts.isTypeReferenceNode(parent)) return "type";
  return "reference";
}

export async function analyzeTypeScriptSource(filePath: string, sourceText: string): Promise<AnalysisResult> {
  const ts = await loadTypeScript();
  if (!ts) {
    return { available: false, file: filePath, language: languageForPath(filePath), symbols: [], imports: [], exports: [], diagnostics: [], reason: "typescript package is not available at runtime" };
  }

  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindForPath(ts, filePath));
  const symbols: TypeScriptSymbol[] = [];
  const imports: TypeScriptImport[] = [];
  const exports: TypeScriptExport[] = [];

  const visit = (node: import("typescript").Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, node.name.text, "function"));
    else if (ts.isClassDeclaration(node) && node.name) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, node.name.text, "class"));
    else if (ts.isInterfaceDeclaration(node)) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, node.name.text, "interface"));
    else if (ts.isTypeAliasDeclaration(node)) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, node.name.text, "type"));
    else if (ts.isEnumDeclaration(node)) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, node.name.text, "enum"));
    else if (ts.isMethodDeclaration(node)) {
      const name = identifierName(node.name);
      if (name) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, name, "method"));
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const name = identifierName(declaration.name);
        if (name) symbols.push(symbolFromNode(ts, sourceFile, sourceText, node, name, "const"));
      }
    } else if (ts.isImportDeclaration(node)) {
      const imported = collectImport(ts, sourceFile, sourceText, node);
      if (imported) imports.push(imported);
    } else if (ts.isExportDeclaration(node)) {
      exports.push(collectExport(ts, sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  const parseDiagnostics = ((sourceFile as unknown as { parseDiagnostics?: import("typescript").DiagnosticWithLocation[] }).parseDiagnostics ?? []);
  const diagnostics = parseDiagnostics.map((diagnostic) => {
    const { line } = lineColumn(ts, sourceFile, diagnostic.start ?? 0);
    return { line, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") };
  });

  return { available: true, file: filePath, language: languageForPath(filePath), symbols, imports, exports, diagnostics };
}

export async function findTypeScriptIdentifierReferences(filePath: string, sourceText: string, name: string): Promise<{ available: boolean; references: TypeScriptReference[]; reason?: string }> {
  const ts = await loadTypeScript();
  if (!ts) return { available: false, references: [], reason: "typescript package is not available at runtime" };
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKindForPath(ts, filePath));
  const references: TypeScriptReference[] = [];
  const visit = (node: import("typescript").Node) => {
    if (ts.isIdentifier(node) && node.text === name) {
      const { line, column } = lineColumn(ts, sourceFile, node.getStart(sourceFile));
      references.push({ line, column, text: lineText(sourceText, line), kind: classifyIdentifier(ts, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { available: true, references };
}
