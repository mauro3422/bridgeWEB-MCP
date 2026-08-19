import fs from "node:fs/promises";
import path from "node:path";
import {
  MSSR_PROJECT_CONTROL_FILES,
  loadProjectContextModules,
  projectContextManifestSchema,
  resolveMssrProjectFile,
  type ProjectContextCore,
  type ProjectContextSource,
  type SkillStage,
  type StructuredSkillIntent,
} from "@mauroprime/mssr";

const MAX_SOURCE_CHARS = 80_000;

export type ProjectContextDocument = {
  kind: "context" | "memory" | "state";
  id: string;
  path: string;
  text: string;
  source: "core" | "module";
  topic?: string;
  area?: string;
};

export type ProjectDirective = {
  kind: "directive";
  id: string;
  path: string;
  text: string;
  matched: string[];
  topic?: string;
  area?: string;
};

export type ProjectContextAssembly = {
  mode: "modular" | "uninitialized";
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

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+\S/.exec(line.trim());
  return match ? match[1].length : null;
}

export function extractProjectMarkdownSections(markdown: string, headings: string[]): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[] = [];
  for (const requested of headings) {
    const matches = lines.map((line, index) => ({ line: line.trim(), index })).filter((item) => item.line === requested.trim());
    if (matches.length !== 1) throw new Error(`Expected one project-context heading '${requested}', found ${matches.length}.`);
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
  if (Buffer.byteLength(selected, "utf8") > limit) throw new Error(`Project context source '${source.path}' exceeds ${limit} bytes after selection.`);
  return { path: filePath, text: selected };
}

async function materializeCore(projectRoot: string, core: ProjectContextCore[]) {
  return await Promise.all(core.map(async (entry) => {
    const materialized = await materializeSource(projectRoot, entry.source, entry.maxChars);
    return { entry, ...materialized, chars: Buffer.byteLength(materialized.text, "utf8") };
  }));
}

function emptyAssembly(args: {
  manifestStatus: "missing" | "invalid";
  manifestPath: string;
  maxContextChars: number;
  warning: string;
}): ProjectContextAssembly {
  return {
    mode: "uninitialized",
    manifestStatus: args.manifestStatus,
    manifestPath: args.manifestPath,
    documents: [],
    directives: [],
    decisions: [],
    coreIncluded: false,
    coreCharsLoaded: 0,
    moduleCharsLoaded: 0,
    totalCharsLoaded: 0,
    remainingContextChars: Math.max(0, Math.floor(args.maxContextChars)),
    requiredBudgetExceeded: false,
    optionalContextOmitted: false,
    ambiguousGroups: [],
    warning: args.warning,
  };
}

export async function assembleProjectContext(args: {
  projectRoot: string;
  intent?: StructuredSkillIntent;
  stage: SkillStage;
  maxContextChars: number;
  includeCore?: boolean;
}): Promise<ProjectContextAssembly> {
  const projectRoot = path.resolve(args.projectRoot);
  const manifestResolution = await resolveMssrProjectFile(projectRoot, MSSR_PROJECT_CONTROL_FILES.projectContextManifest);
  const manifestPath = manifestResolution.absolutePath;
  const maxContextChars = Math.max(0, Math.floor(args.maxContextChars));

  if (manifestResolution.source === "missing") {
    return emptyAssembly({
      manifestStatus: "missing",
      manifestPath,
      maxContextChars,
      warning: "MSSR project context is not initialized. Run project_context_initialize before relying on project knowledge; Bridge will not fall back to .bridge or arbitrary project documents.",
    });
  }

  let manifest;
  try {
    manifest = projectContextManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  } catch (error) {
    return emptyAssembly({
      manifestStatus: "invalid",
      manifestPath,
      maxContextChars,
      warning: `Invalid MSSR project-context manifest. Repair or re-initialize the contract before loading project knowledge: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const coreIncluded = args.includeCore !== false;
  if (!args.intent) {
    const core = coreIncluded ? await materializeCore(projectRoot, manifest.core) : [];
    const documents: ProjectContextDocument[] = core.map(({ entry, path: sourcePath, text }) => ({
      kind: entry.kind,
      id: entry.id,
      path: sourcePath,
      text,
      source: "core",
      ...(entry.topic ? { topic: entry.topic } : {}),
      ...(entry.area ? { area: entry.area } : {}),
    }));
    const coreCharsLoaded = core.reduce((sum, item) => sum + item.chars, 0);
    return {
      mode: "modular",
      manifestStatus: "loaded",
      manifestPath,
      documents,
      directives: [],
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

  // Portable MSSR owns semantic eligibility, budget ordering, required overflow,
  // ambiguity and module decisions. Bridge only maps materialized records into its
  // host-facing document/directive representation.
  const loaded = await loadProjectContextModules({
    projectRoot,
    intent: args.intent,
    stage: args.stage,
    maxChars: maxContextChars,
    includeCore: coreIncluded,
  });
  if (loaded.manifestStatus !== "loaded") {
    return emptyAssembly({
      manifestStatus: "missing",
      manifestPath: loaded.manifestPath,
      maxContextChars,
      warning: "MSSR project context became unavailable during selection. Re-run project_context_health/initialize before continuing.",
    });
  }

  const documents: ProjectContextDocument[] = [];
  const directives: ProjectDirective[] = [];
  for (const record of loaded.core) {
    if (record.kind === "directive") continue;
    documents.push({
      kind: record.kind,
      id: record.ref,
      path: path.resolve(projectRoot, record.sourcePath),
      text: record.content,
      source: "core",
      ...(record.topic ? { topic: record.topic } : {}),
      ...(record.area ? { area: record.area } : {}),
    });
  }
  for (const record of loaded.selected) {
    const decision = loaded.decisions.find((item) => item.id === record.ref);
    if (record.kind === "directive") {
      directives.push({
        kind: "directive",
        id: record.ref,
        path: path.resolve(projectRoot, record.sourcePath),
        text: record.content,
        matched: decision?.matched ?? [],
        ...(record.topic ? { topic: record.topic } : {}),
        ...(record.area ? { area: record.area } : {}),
      });
    } else {
      documents.push({
        kind: record.kind,
        id: record.ref,
        path: path.resolve(projectRoot, record.sourcePath),
        text: record.content,
        source: "module",
        ...(record.topic ? { topic: record.topic } : {}),
        ...(record.area ? { area: record.area } : {}),
      });
    }
  }

  const coreCharsLoaded = loaded.core.reduce((sum, record) => sum + record.bytes, 0);
  const moduleCharsLoaded = loaded.selected.reduce((sum, record) => sum + record.bytes, 0);
  return {
    mode: "modular",
    manifestStatus: "loaded",
    manifestPath: loaded.manifestPath,
    documents,
    directives,
    decisions: loaded.decisions as Array<Record<string, unknown>>,
    coreIncluded,
    coreCharsLoaded,
    moduleCharsLoaded,
    totalCharsLoaded: coreCharsLoaded + moduleCharsLoaded,
    remainingContextChars: loaded.remainingChars,
    requiredBudgetExceeded: loaded.requiredBudgetExceeded.length > 0 || loaded.requiredOverflow.length > 0,
    optionalContextOmitted: loaded.decisions.some((item) => item.reason === "budget-exceeded"),
    ambiguousGroups: loaded.ambiguousExclusiveGroups,
  };
}
