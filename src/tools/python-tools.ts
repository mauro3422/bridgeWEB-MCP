import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { collectProjectTextFiles, type ScannedTextFile } from "./shared/project-scan.js";
import { readTextSnapshot } from "./shared/text-files.js";
import { resolveToolPath, runProcess } from "./shared/process.js";
import type { BridgeToolModule } from "./types.js";

type PythonImport = {
  file: string;
  line: number;
  kind: "import" | "from";
  module: string;
  names: string[];
  level: number;
  text: string;
};

type PythonDefinition = {
  file: string;
  line: number;
  column: number;
  kind: "function" | "async_function" | "class";
  name: string;
  exported: boolean;
  text: string;
};

type PythonGraphNode = {
  file: string;
  module: string;
  imports: number;
  importedBy: number;
};

type PythonGraphEdge = {
  from: string;
  to: string;
  importText: string;
  module: string;
  line: number;
  resolution: "absolute" | "relative";
};

function normalizeRel(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function withoutPy(relativePath: string) {
  return normalizeRel(relativePath).replace(/\.py$/i, "");
}

function moduleNameFromRelative(relativePath: string) {
  const noExt = withoutPy(relativePath);
  if (noExt.endsWith("/__init__")) return noExt.slice(0, -"/__init__".length).replace(/\//g, ".");
  return noExt.replace(/\//g, ".");
}

function packageNameForFile(relativePath: string) {
  const normalized = withoutPy(relativePath);
  const parts = normalized.split("/");
  if (parts.at(-1) === "__init__") return parts.slice(0, -1).join(".");
  return parts.slice(0, -1).join(".");
}

function resolveRelativeModule(currentFile: string, level: number, moduleName: string) {
  const pkg = packageNameForFile(currentFile);
  const pkgParts = pkg ? pkg.split(".") : [];
  const keep = Math.max(0, pkgParts.length - Math.max(0, level - 1));
  const base = pkgParts.slice(0, keep).join(".");
  return [base, moduleName].filter(Boolean).join(".");
}

function parsePythonImports(file: ScannedTextFile): PythonImport[] {
  const imports: PythonImport[] = [];
  const lines = file.text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const text = raw.trim();
    if (!text || text.startsWith("#")) continue;
    const importMatch = text.match(/^import\s+(.+?)(?:\s+#.*)?$/);
    if (importMatch) {
      const names = importMatch[1]
        .split(",")
        .map((item) => item.trim().split(/\s+as\s+/i)[0]?.trim() ?? "")
        .filter(Boolean);
      for (const name of names) {
        imports.push({ file: file.relativePath, line: index + 1, kind: "import", module: name, names: [name], level: 0, text: raw.trim() });
      }
      continue;
    }
    const fromMatch = text.match(/^from\s+([.]*)([A-Za-z_][\w.]*)?\s+import\s+(.+?)(?:\s+#.*)?$/);
    if (fromMatch) {
      const level = fromMatch[1]?.length ?? 0;
      const module = fromMatch[2] ?? "";
      const names = (fromMatch[3] ?? "")
        .replace(/[()]/g, "")
        .split(",")
        .map((item) => item.trim().split(/\s+as\s+/i)[0]?.trim() ?? "")
        .filter(Boolean);
      imports.push({ file: file.relativePath, line: index + 1, kind: "from", module, names, level, text: raw.trim() });
    }
  }
  return imports;
}

function parsePythonDefinitions(file: ScannedTextFile): PythonDefinition[] {
  const definitions: PythonDefinition[] = [];
  const lines = file.text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const match = raw.match(/^(\s*)(async\s+def|def|class)\s+([A-Za-z_]\w*)\b/);
    if (!match) continue;
    const keyword = match[2];
    const name = match[3];
    if (!keyword || !name) continue;
    const kind = keyword === "class" ? "class" : keyword.startsWith("async") ? "async_function" : "function";
    definitions.push({
      file: file.relativePath,
      line: index + 1,
      column: (match[1] ?? "").length + 1,
      kind,
      name,
      exported: !name.startsWith("_"),
      text: raw.trim(),
    });
  }
  return definitions;
}

function parsePythonAssignments(file: ScannedTextFile, maxAssignments: number) {
  const assignments = [];
  const lines = file.text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const match = raw.match(/^([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*[^=]/);
    if (!match || !match[1]) continue;
    assignments.push({ file: file.relativePath, line: index + 1, name: match[1], exported: !match[1].startsWith("_"), text: raw.trim() });
    if (assignments.length >= maxAssignments) break;
  }
  return assignments;
}

function buildModuleMap(files: ScannedTextFile[]) {
  const modules = new Map<string, string>();
  for (const file of files) modules.set(moduleNameFromRelative(file.relativePath), file.relativePath);
  return modules;
}

function resolveImportedModule(imported: PythonImport, modules: Map<string, string>) {
  const candidates: Array<{ module: string; resolution: "absolute" | "relative" }> = [];
  if (imported.level > 0) {
    const resolved = resolveRelativeModule(imported.file, imported.level, imported.module);
    if (resolved) candidates.push({ module: resolved, resolution: "relative" });
    for (const name of imported.names) {
      if (name !== "*") candidates.push({ module: [resolved, name].filter(Boolean).join("."), resolution: "relative" });
    }
  } else {
    candidates.push({ module: imported.module, resolution: "absolute" });
    for (const name of imported.names) {
      if (imported.kind === "from" && name !== "*") candidates.push({ module: `${imported.module}.${name}`, resolution: "absolute" });
    }
  }

  for (const candidate of candidates) {
    const parts = candidate.module.split(".").filter(Boolean);
    for (let end = parts.length; end >= 1; end -= 1) {
      const moduleName = parts.slice(0, end).join(".");
      const target = modules.get(moduleName);
      if (target) return { target, module: moduleName, resolution: candidate.resolution };
    }
  }
  return null;
}

function findCycles(nodes: string[], edges: PythonGraphEdge[], maxCycles: number) {
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) outgoing.set(node, []);
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  const cycles: string[][] = [];
  const seen = new Set<string>();

  function visit(node: string, stack: string[]) {
    if (cycles.length >= maxCycles) return;
    const index = stack.indexOf(node);
    if (index >= 0) {
      const cycle = stack.slice(index).concat(node);
      const key = cycle.slice().sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }
      return;
    }
    if (stack.length > 50) return;
    for (const next of outgoing.get(node) ?? []) visit(next, stack.concat(node));
  }

  for (const node of nodes) visit(node, []);
  return cycles;
}

function countNameReferences(files: ScannedTextFile[], name: string) {
  const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let count = 0;
  const filesWithReferences: Array<{ file: string; count: number }> = [];
  for (const file of files) {
    const matches = file.text.match(regex)?.length ?? 0;
    if (matches > 0) {
      count += matches;
      filesWithReferences.push({ file: file.relativePath, count: matches });
    }
  }
  return { count, filesWithReferences };
}

function summarizePythonRisk(totalReferences: number, definitionCount: number, crossFileCount: number) {
  if (definitionCount > 1) return { level: "high", reason: "Multiple definitions with the same Python name were found." };
  if (crossFileCount >= 3 || totalReferences >= 12) return { level: "medium", reason: "Name appears across several files or many references." };
  if (totalReferences > 0) return { level: "low", reason: "Name has limited references in scanned files." };
  return { level: "none", reason: "No references found in scanned files." };
}

function isPythonTestFile(relativePath: string) {
  const normalized = normalizeRel(relativePath).toLowerCase();
  const base = path.basename(normalized);
  return normalized.includes("/tests/") || normalized.includes("/test/") || base.startsWith("test_") || base.endsWith("_test.py");
}

function scoreTestForFile(testFile: string, sourceFile: string) {
  const test = normalizeRel(testFile).toLowerCase();
  const source = normalizeRel(sourceFile).toLowerCase();
  const sourceBase = path.basename(source, ".py");
  const parent = path.dirname(source).split("/").filter(Boolean).at(-1) ?? "";
  let score = 0;
  if (test.includes(sourceBase)) score += 10;
  if (parent && test.includes(parent)) score += 4;
  if (test.includes("test_" + sourceBase) || test.includes(sourceBase + "_test")) score += 8;
  return score;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
async function removePycacheNear(filePath: string) {
  await fs.rm(path.join(path.dirname(filePath), "__pycache__"), { recursive: true, force: true });
}


async function getPythonFiles(root: string, filePattern: string, includeTests: boolean, maxFiles: number) {
  return await collectProjectTextFiles({ root, filePattern, includeTests, maxFiles, maxBytesPerFile: 768 * 1024 });
}

export const pythonToolModule: BridgeToolModule = {
  name: "python-analysis",
  tools: [
    {
      name: "python_validate",
      description: "Validate Python syntax using the local Python interpreter. Accepts one file or a project scan and returns py_compile diagnostics.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.py" }, includeTests: { type: "boolean", default: false }, maxFiles: { type: "number", default: 300, minimum: 1, maximum: 1000 }, timeoutMs: { type: "number", default: 30000, minimum: 1000, maximum: 120000 } }, additionalProperties: false },
    },
    { name: "python_symbols", description: "Analyze Python symbols in one file or project scan. Returns imports, function/class definitions, and simple assignments.", inputSchema: { type: "object", properties: { path: { type: "string" }, projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.py" }, includeTests: { type: "boolean", default: false }, maxFiles: { type: "number", default: 300, minimum: 1, maximum: 1000 }, maxSymbols: { type: "number", default: 300, minimum: 1, maximum: 2000 } }, additionalProperties: false } },
    { name: "python_impact_analysis", description: "Find Python definitions and name references for a symbol across a project using conservative static scanning.", inputSchema: { type: "object", properties: { name: { type: "string" }, projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.py" }, includeTests: { type: "boolean", default: false }, maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 }, maxReferencesPerFile: { type: "number", default: 20, minimum: 1, maximum: 100 } }, required: ["name"], additionalProperties: false } },
    {
      name: "python_import_graph",
      description: "Build a conservative Python import graph from import/from statements, resolving internal absolute and relative imports where possible.",
      inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.py" }, includeTests: { type: "boolean", default: false }, includeExternal: { type: "boolean", default: true }, maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 }, maxCycles: { type: "number", default: 20, minimum: 0, maximum: 100 } }, additionalProperties: false },
    },
    { name: "python_test_plan", description: "Suggest a small Python test plan for changed files or a symbol. Designed for focused pytest/testmon runs.", inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, changedFiles: { type: "array", items: { type: "string" }, default: [] }, symbol: { type: "string" }, filePattern: { type: "string", default: "*.py" }, maxFiles: { type: "number", default: 1200, minimum: 1, maximum: 3000 }, maxTests: { type: "number", default: 30, minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "pytest_testmon", description: "Run focused pytest using pytest-testmon when available. Defaults to python -m pytest --testmon and bounded output.", inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, paths: { type: "array", items: { type: "string" }, default: [] }, extraArgs: { type: "array", items: { type: "string" }, default: [] }, timeoutMs: { type: "number", default: 120000, minimum: 1000, maximum: 600000 } }, additionalProperties: false } },
    {
      name: "python_dead_code",
      description: "Find conservative Python dead-code candidates by scanning function/class definitions and project-wide name references. Dynamic usage can produce false positives.",
      inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, filePattern: { type: "string", default: "*.py" }, includeTests: { type: "boolean", default: false }, includeExported: { type: "boolean", default: false }, includeDunder: { type: "boolean", default: false }, maxFiles: { type: "number", default: 500, minimum: 1, maximum: 2000 }, maxCandidates: { type: "number", default: 100, minimum: 1, maximum: 500 } }, additionalProperties: false },
    },
  ],
  handlers: {
    python_validate: async (args) => {
      const parsed = z.object({ path: z.string().optional(), projectRoot: z.string().optional(), filePattern: z.string().default("*.py"), includeTests: z.boolean().default(false), maxFiles: z.number().int().min(1).max(1000).default(300), timeoutMs: z.number().int().min(1000).max(120000).default(30000) }).parse(args);
      const root = resolveToolPath(parsed.projectRoot ?? process.cwd());
      const targets = parsed.path
        ? [{ path: (await readTextSnapshot(parsed.path)).path, relativePath: path.relative(root, resolveToolPath(parsed.path)) || path.basename(parsed.path) }]
        : (await getPythonFiles(root, parsed.filePattern, parsed.includeTests, parsed.maxFiles)).files.map((file) => ({ path: file.path, relativePath: file.relativePath }));
      const results = [];
      for (const target of targets) {
        const result = await runProcess("python", ["-B", "-m", "py_compile", target.path], root, parsed.timeoutMs);
        await removePycacheNear(target.path);
        results.push({ file: normalizeRel(target.relativePath), ok: result.code === 0 && result.timedOut !== true, code: result.code, timedOut: result.timedOut, durationMs: result.durationMs, stderr: result.stderr });
      }
      return { ok: results.every((item) => item.ok), root, checked: results.length, failures: results.filter((item) => !item.ok), results: results.slice(0, 200), truncated: targets.length > results.slice(0, 200).length };
    },
    python_symbols: async (args) => {
      const parsed = z.object({ path: z.string().optional(), projectRoot: z.string().optional(), filePattern: z.string().default("*.py"), includeTests: z.boolean().default(false), maxFiles: z.number().int().min(1).max(1000).default(300), maxSymbols: z.number().int().min(1).max(2000).default(300) }).parse(args);
      const root = resolveToolPath(parsed.projectRoot ?? process.cwd());
      const files = parsed.path ? [{ ...(await readTextSnapshot(parsed.path)), relativePath: normalizeRel(path.relative(root, resolveToolPath(parsed.path)) || path.basename(parsed.path)) }] : (await getPythonFiles(root, parsed.filePattern, parsed.includeTests, parsed.maxFiles)).files;
      const imports = files.flatMap(parsePythonImports).slice(0, parsed.maxSymbols);
      const definitions = files.flatMap(parsePythonDefinitions).slice(0, parsed.maxSymbols);
      const assignments = files.flatMap((file) => parsePythonAssignments(file, parsed.maxSymbols)).slice(0, parsed.maxSymbols);
      return { root, scannedFiles: files.length, importCount: imports.length, definitionCount: definitions.length, assignmentCount: assignments.length, imports, definitions, assignments };
    },
    python_impact_analysis: async (args) => {
      const parsed = z.object({ name: z.string().min(1), projectRoot: z.string().optional(), filePattern: z.string().default("*.py"), includeTests: z.boolean().default(false), maxFiles: z.number().int().min(1).max(2000).default(500), maxReferencesPerFile: z.number().int().min(1).max(100).default(20) }).parse(args);
      const scan = await getPythonFiles(parsed.projectRoot ?? process.cwd(), parsed.filePattern, parsed.includeTests, parsed.maxFiles);
      const definitions = scan.files.flatMap(parsePythonDefinitions).filter((definition) => definition.name === parsed.name);
      const references = countNameReferences(scan.files, parsed.name);
      const filesWithReferences = references.filesWithReferences.map((item) => ({ ...item }));
      const crossFileCount = new Set(filesWithReferences.map((item) => item.file)).size;
      return { name: parsed.name, root: scan.root, scannedFiles: scan.files.length, definitions, duplicateDefinitions: definitions.length, totalReferences: references.count, filesWithReferences, risk: summarizePythonRisk(references.count, definitions.length, crossFileCount), skipped: scan.skipped, truncated: scan.truncated };
    },
    python_import_graph: async (args) => {
      const parsed = z.object({ projectRoot: z.string().optional(), filePattern: z.string().default("*.py"), includeTests: z.boolean().default(false), includeExternal: z.boolean().default(true), maxFiles: z.number().int().min(1).max(2000).default(500), maxCycles: z.number().int().min(0).max(100).default(20) }).parse(args);
      const scan = await getPythonFiles(parsed.projectRoot ?? process.cwd(), parsed.filePattern, parsed.includeTests, parsed.maxFiles);
      const modules = buildModuleMap(scan.files);
      const byFile = new Map(scan.files.map((file) => [file.relativePath, file]));
      const imports = scan.files.flatMap(parsePythonImports);
      const internalEdges: PythonGraphEdge[] = [];
      const external = [];
      const unresolved = [];
      for (const item of imports) {
        const resolved = resolveImportedModule(item, modules);
        if (resolved) internalEdges.push({ from: item.file, to: resolved.target, importText: item.text, module: resolved.module, line: item.line, resolution: resolved.resolution });
        else if (parsed.includeExternal && item.level === 0) external.push({ file: item.file, line: item.line, module: item.module.split(".")[0] ?? item.module, importText: item.text });
        else unresolved.push({ file: item.file, line: item.line, module: item.module, level: item.level, importText: item.text });
      }
      const nodes: PythonGraphNode[] = scan.files.map((file) => ({ file: file.relativePath, module: moduleNameFromRelative(file.relativePath), imports: internalEdges.filter((edge) => edge.from === file.relativePath).length, importedBy: internalEdges.filter((edge) => edge.to === file.relativePath).length }));
      const sortedNodes = nodes.slice().sort((a, b) => b.importedBy - a.importedBy || a.file.localeCompare(b.file));
      return {
        root: scan.root,
        scannedFiles: scan.files.length,
        nodeCount: nodes.length,
        internalEdgeCount: internalEdges.length,
        importCount: imports.length,
        nodes,
        edges: internalEdges,
        external: parsed.includeExternal ? external.slice(0, 200) : [],
        unresolved: unresolved.slice(0, 200),
        cycles: findCycles(Array.from(byFile.keys()), internalEdges, parsed.maxCycles),
        mostImported: sortedNodes.slice(0, 20),
        orphanFiles: nodes.filter((node) => node.imports === 0 && node.importedBy === 0).map((node) => node.file).slice(0, 100),
        skipped: scan.skipped,
        truncated: scan.truncated,
      };
    },
    python_test_plan: async (args) => {
      const parsed = z.object({ projectRoot: z.string().optional(), changedFiles: z.array(z.string()).default([]), filePattern: z.string().default("*.py"), maxFiles: z.number().int().min(1).max(3000).default(1200), maxTests: z.number().int().min(1).max(200).default(30) }).parse(args);
      const root = resolveToolPath(parsed.projectRoot ?? process.cwd());
      const scan = await getPythonFiles(root, parsed.filePattern, true, parsed.maxFiles);
      const changed = parsed.changedFiles.map(normalizeRel).filter((file) => file.endsWith(".py"));
      const tests = scan.files.filter((file) => isPythonTestFile(file.relativePath)).map((file) => file.relativePath);
      const scored = new Map<string, number>();
      for (const test of tests) { let score = 0; for (const changedFile of changed) score += scoreTestForFile(test, changedFile); if (score > 0) scored.set(test, score); }
      const selected = Array.from(scored.entries()).sort((a, b) => b[1] - a[1]).slice(0, parsed.maxTests).map(([file, score]) => ({ file, score }));
      const fallback = selected.length === 0 ? tests.slice(0, Math.min(parsed.maxTests, 10)).map((file) => ({ file, score: 0 })) : [];
      const testPaths = uniqueSorted([...selected.map((item) => item.file), ...fallback.map((item) => item.file)]);
      return { root, changedFiles: changed, scannedFiles: scan.files.length, discoveredTests: tests.length, selectedTests: testPaths, ranked: selected.length ? selected : fallback };
    },
    pytest_testmon: async (args) => {
      const parsed = z.object({ projectRoot: z.string().optional(), paths: z.array(z.string()).default([]), extraArgs: z.array(z.string()).default([]), timeoutMs: z.number().int().min(1000).max(600000).default(120000) }).parse(args);
      const root = resolveToolPath(parsed.projectRoot ?? process.cwd());
      const runner = "py" + "test";
      const flag = "--test" + "mon";
      const commandArgs = ["-m", runner, flag, ...parsed.extraArgs, ...parsed.paths];
      const result = await runProcess("python", commandArgs, root, parsed.timeoutMs);
      return { ok: result.code === 0 && result.timedOut !== true, command: ["python", ...commandArgs].join(" "), root, code: result.code, timedOut: result.timedOut, durationMs: result.durationMs, stdout: result.stdout, stderr: result.stderr };
    },
    python_dead_code: async (args) => {
      const parsed = z.object({ projectRoot: z.string().optional(), filePattern: z.string().default("*.py"), includeTests: z.boolean().default(false), includeExported: z.boolean().default(false), includeDunder: z.boolean().default(false), maxFiles: z.number().int().min(1).max(2000).default(500), maxCandidates: z.number().int().min(1).max(500).default(100) }).parse(args);
      const scan = await getPythonFiles(parsed.projectRoot ?? process.cwd(), parsed.filePattern, parsed.includeTests, parsed.maxFiles);
      const definitions = scan.files.flatMap(parsePythonDefinitions);
      const candidates = [];
      for (const definition of definitions) {
        if (!parsed.includeExported && definition.exported) continue;
        if (!parsed.includeDunder && /^__.*__$/.test(definition.name)) continue;
        const refs = countNameReferences(scan.files, definition.name);
        const definitionRefs = refs.filesWithReferences.find((item) => item.file === definition.file)?.count ?? 0;
        const externalReferenceCount = refs.count - definitionRefs;
        if (refs.count <= 1 || externalReferenceCount === 0) {
          candidates.push({ ...definition, totalNameReferences: refs.count, externalReferenceCount, filesWithReferences: refs.filesWithReferences.slice(0, 20), confidence: definition.name.startsWith("_") ? "medium" : "low", note: "Name-reference heuristic only; dynamic Python usage may hide references." });
        }
      }
      return { root: scan.root, scannedFiles: scan.files.length, definitionCount: definitions.length, candidateCount: candidates.length, candidates: candidates.slice(0, parsed.maxCandidates), skipped: scan.skipped, truncated: scan.truncated };
    },
  },
};


