import fs from "node:fs/promises";
import path from "node:path";
import {
  projectContextManifestSchema,
  selectProjectContextModules,
  type ProjectContextCore,
  type ProjectContextModule,
  type ProjectContextSource,
  type SkillStage,
  type StructuredSkillIntent,
} from "@mauroprime/mssr";

const MANIFEST_PATH = path.join(".bridge", "project-context.json");
const MAX_SOURCE_CHARS = 80_000;
const UNBOUNDED_BUDGET = Number.MAX_SAFE_INTEGER;

export type ProjectContextDocument = {
  kind: "context" | "memory" | "state";
  id: string;
  path: string;
  text: string;
  source: "core" | "module";
};

export type ProjectDirective = {
  kind: "directive";
  id: string;
  path: string;
  text: string;
  matched: string[];
};

export type ProjectContextAssembly = {
  mode: "modular" | "legacy";
  manifestStatus: "loaded" | "missing" | "invalid";
  manifestPath: string;
  documents: ProjectContextDocument[];
  directives: ProjectDirective[];
  decisions: Array<Record<string, unknown>>;
  coreIncluded: boolean;
  coreCharsLoaded: number;
  moduleCharsLoaded: number;
  totalCharsLoaded: number;
  remainingContextChars: number;
  requiredBudgetExceeded: boolean;
  optionalContextOmitted: boolean;
  ambiguousGroups: Array<{ group: string; candidates: string[]; score: number }>;
  warning?: string;
};

function ensureInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Project context source escapes project root: ${candidate}`);
  }
  return resolvedCandidate;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+\S/.exec(line.trim());
  return match ? match[1].length : null;
}

export function extractProjectMarkdownSections(markdown: string, headings: string[]): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[] = [];
  for (const requested of headings) {
    const matches = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter((item) => item.line === requested.trim());
    if (matches.length !== 1) {
      throw new Error(`Expected one project-context heading '${requested}', found ${matches.length}.`);
    }
    const start = matches[0].index;
    const level = headingLevel(lines[start]);
    if (!level) throw new Error(`Project context section is not a markdown heading: ${requested}`);
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const nextLevel = headingLevel(lines[index]);
      if (nextLevel !== null && nextLevel <= level) {
        end = index;
        break;
      }
    }
    chunks.push(lines.slice(start, end).join("\n").trim());
  }
  return chunks.join("\n\n");
}

async function materializeSource(projectRoot: string, source: ProjectContextSource, maxChars?: number): Promise<{ path: string; text: string }> {
  const filePath = ensureInside(projectRoot, path.join(projectRoot, source.path));
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Project context source is not a file: ${filePath}`);
  const text = await fs.readFile(filePath, "utf8");
  const selected = source.sections?.length ? extractProjectMarkdownSections(text, source.sections) : text.trim();
  const limit = maxChars ?? MAX_SOURCE_CHARS;
  if (selected.length > limit) {
    throw new Error(`Project context source '${source.path}' exceeds ${limit} characters after selection.`);
  }
  return { path: filePath, text: selected };
}

async function materializeCore(projectRoot: string, core: ProjectContextCore[]) {
  return await Promise.all(core.map(async (entry) => {
    const materialized = await materializeSource(projectRoot, entry.source, entry.maxChars);
    return { entry, ...materialized, chars: materialized.text.length };
  }));
}

async function materializeEligibleModules(args: {
  projectRoot: string;
  modules: ProjectContextModule[];
  intent: StructuredSkillIntent;
  stage: SkillStage;
}) {
  const eligibility = selectProjectContextModules({
    modules: args.modules.map((module) => ({ ...module, chars: 0 })),
    intent: args.intent,
    stage: args.stage,
    maxModuleChars: UNBOUNDED_BUDGET,
  });
  const eligibleIds = new Set(eligibility.selected.map((module) => module.id));
  const materialized = await Promise.all(args.modules.filter((module) => eligibleIds.has(module.id)).map(async (module) => {
    const source = await materializeSource(args.projectRoot, module.source, module.maxChars);
    return { ...module, ...source, chars: source.text.length };
  }));
  return { materialized, eligibility };
}

export async function assembleProjectContext(args: {
  projectRoot: string;
  intent?: StructuredSkillIntent;
  stage: SkillStage;
  maxContextChars: number;
  includeCore?: boolean;
}): Promise<ProjectContextAssembly> {
  const projectRoot = path.resolve(args.projectRoot);
  const manifestPath = path.join(projectRoot, MANIFEST_PATH);
  if (!(await pathExists(manifestPath))) {
    const bridgeDir = path.dirname(manifestPath);
    const hasBridgeAuthority = await pathExists(bridgeDir);
    const legacyFiles = ["PROJECT_CONTEXT.md", "PROJECT_MEMORY.md", "PROJECT_STATE.md"];
    const existingLegacyFiles = hasBridgeAuthority
      ? (await Promise.all(legacyFiles.map(async (name) => (await pathExists(path.join(bridgeDir, name))) ? name : null))).filter((name): name is string => Boolean(name))
      : [];
    const warning = hasBridgeAuthority
      ? existingLegacyFiles.length > 0
        ? `Project context is using legacy full-document fallback because .bridge/project-context.json is missing. Existing authorities: ${existingLegacyFiles.join(", ")}. Register stable sections deliberately before relying on modular retrieval.`
        : "Project has a .bridge authority directory but no project-context manifest or PROJECT_CONTEXT/PROJECT_MEMORY/PROJECT_STATE documents. Initialize durable project knowledge deliberately when this repository needs cross-session state; do not invent empty memory automatically."
      : undefined;
    return {
      mode: "legacy",
      manifestStatus: "missing",
      manifestPath,
      documents: [],
      directives: [],
      decisions: [],
      coreIncluded: false,
      coreCharsLoaded: 0,
      moduleCharsLoaded: 0,
      totalCharsLoaded: 0,
      remainingContextChars: args.maxContextChars,
      requiredBudgetExceeded: false,
      optionalContextOmitted: false,
      ambiguousGroups: [],
      ...(warning ? { warning } : {}),
    };
  }

  let manifest;
  try {
    manifest = projectContextManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  } catch (error) {
    return {
      mode: "legacy",
      manifestStatus: "invalid",
      manifestPath,
      documents: [],
      directives: [],
      decisions: [],
      coreIncluded: false,
      coreCharsLoaded: 0,
      moduleCharsLoaded: 0,
      totalCharsLoaded: 0,
      remainingContextChars: args.maxContextChars,
      requiredBudgetExceeded: false,
      optionalContextOmitted: false,
      ambiguousGroups: [],
      warning: `Invalid project-context manifest; using legacy full-document fallback: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const coreIncluded = args.includeCore !== false;
  const core = coreIncluded ? await materializeCore(projectRoot, manifest.core) : [];
  const coreCharsLoaded = core.reduce((sum, item) => sum + item.chars, 0);
  const maxContextChars = Math.max(0, Math.floor(args.maxContextChars));
  const moduleBudget = Math.max(0, maxContextChars - coreCharsLoaded);
  const documents: ProjectContextDocument[] = core.map(({ entry, path: sourcePath, text }) => ({
    kind: entry.kind,
    id: entry.id,
    path: sourcePath,
    text,
    source: "core",
  }));
  const directives: ProjectDirective[] = [];

  if (!args.intent) {
    return {
      mode: "modular",
      manifestStatus: "loaded",
      manifestPath,
      documents,
      directives,
      decisions: manifest.modules.map((module) => ({ id: module.id, selected: false, reason: "intent-required" })),
      coreIncluded,
      coreCharsLoaded,
      moduleCharsLoaded: 0,
      totalCharsLoaded: coreCharsLoaded,
      remainingContextChars: Math.max(0, maxContextChars - coreCharsLoaded),
      requiredBudgetExceeded: coreCharsLoaded > maxContextChars,
      optionalContextOmitted: manifest.modules.length > 0,
      ambiguousGroups: [],
    };
  }

  const eligible = await materializeEligibleModules({
    projectRoot,
    modules: manifest.modules,
    intent: args.intent,
    stage: args.stage,
  });
  const materializedById = new Map(eligible.materialized.map((module) => [module.id, module]));
  const requiredModuleChars = eligible.materialized
    .filter((module) => module.required)
    .reduce((sum, module) => sum + module.chars, 0);
  const finalSelection = selectProjectContextModules({
    modules: eligible.materialized,
    intent: args.intent,
    stage: args.stage,
    // Required project modules may overflow visibly, but optional modules never receive
    // extra budget because of that overflow. Required entries are ranked first.
    maxModuleChars: Math.max(moduleBudget, requiredModuleChars),
  });
  const selectedIds = new Set(finalSelection.selected.map((module) => module.id));

  for (const selected of finalSelection.selected) {
    const module = materializedById.get(selected.id);
    if (!module) continue;
    if (module.kind === "directive") {
      directives.push({ kind: "directive", id: module.id, path: module.path, text: module.text, matched: finalSelection.decisions.find((item) => item.id === module.id)?.matched ?? [] });
    } else {
      documents.push({ kind: module.kind, id: module.id, path: module.path, text: module.text, source: "module" });
    }
  }

  const decisions = manifest.modules.map((module) => {
    const semanticDecision = eligible.eligibility.decisions.find((item) => item.id === module.id);
    if (!materializedById.has(module.id)) return semanticDecision ?? { id: module.id, selected: false, reason: "intent-mismatch" };
    return finalSelection.decisions.find((item) => item.id === module.id) ?? { id: module.id, selected: selectedIds.has(module.id), reason: "selected" };
  });
  const moduleCharsLoaded = finalSelection.selectedChars;

  return {
    mode: "modular",
    manifestStatus: "loaded",
    manifestPath,
    documents,
    directives,
    decisions,
    coreIncluded,
    coreCharsLoaded,
    moduleCharsLoaded,
    totalCharsLoaded: coreCharsLoaded + moduleCharsLoaded,
    remainingContextChars: Math.max(0, maxContextChars - coreCharsLoaded - moduleCharsLoaded),
    requiredBudgetExceeded: coreCharsLoaded + requiredModuleChars > maxContextChars,
    optionalContextOmitted: finalSelection.decisions.some((item) => item.reason === "budget-exceeded" && !manifest.modules.find((module) => module.id === item.id)?.required),
    ambiguousGroups: finalSelection.ambiguousGroups,
  };
}
