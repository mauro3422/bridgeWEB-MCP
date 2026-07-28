import fs from "node:fs/promises";
import path from "node:path";
import {
  selectSkillContextModules,
  skillContextManifestSchema,
  type SkillContextSource,
  type SkillEntry,
  type SkillStage,
  type StructuredSkillIntent,
} from "@mauroprime/mssr";

const MANIFEST_NAME = "context-modules.json";
const MAX_SKILL_FILE_CHARS = 160_000;
const MAX_MODULE_FILE_CHARS = 80_000;
const UNBOUNDED_MODULE_BUDGET = Number.MAX_SAFE_INTEGER;

export type SkillContextMode = "selective" | "full";
export type SkillReferenceMode = "auto" | "none";
export type SkillContextPlanningMode = "global-required-core-first";

type ManifestStatus = "loaded" | "missing" | "invalid" | "disabled";
type AllocationTier =
  | "required-core"
  | "required-module"
  | "required-skill-module"
  | "optional-skill-core"
  | "optional-skill-module";

type ModuleDecision = {
  id: string;
  selected: boolean;
  score: number;
  chars: number;
  reason: string;
  matched?: string[];
  allocationTier?: AllocationTier;
};

type AmbiguousGroup = { group: string; candidates: string[]; score: number };

export type SkillContextAssemblyInfo = {
  mode: SkillContextMode;
  manifestStatus: ManifestStatus;
  fallbackFull: boolean;
  coreCharsLoaded: number;
  moduleCharsLoaded: number;
  totalCharsLoaded: number;
  fullSkillChars: number;
  estimatedCharsSaved: number;
  selectedModules: string[];
  moduleDecisions: Array<Record<string, unknown>>;
  ambiguousGroups: AmbiguousGroup[];
  budgetExceeded: boolean;
  planningMode: SkillContextPlanningMode;
  allocationTiers: AllocationTier[];
  duplicateCharsAvoided: number;
  skipped?: boolean;
  skippedReason?: string;
  candidateChars?: number;
  warning?: string;
};

export type SkillContextAssembly = {
  skill: SkillEntry;
  loaded: true;
  activationInstruction: string;
  content: string;
  contextAssembly: SkillContextAssemblyInfo;
};

export type SkippedSkillContextAssembly = {
  skill: SkillEntry;
  loaded: false;
  warning: string;
  contextAssembly: SkillContextAssemblyInfo;
};

export type PlannedSkillContext = SkillContextAssembly | SkippedSkillContextAssembly;

type PreparedModule = {
  id: string;
  content: string;
  assembledContent: string;
  chars: number;
  score: number;
  priority: number;
  required: boolean;
  matched: string[];
};

type PreparedSkillContext = {
  skill: SkillEntry;
  required: boolean;
  routeIndex: number;
  routeScore: number;
  mode: SkillContextMode;
  manifestStatus: ManifestStatus;
  fallbackFull: boolean;
  fullSkillText: string;
  baseContent: string;
  modules: PreparedModule[];
  moduleDecisions: ModuleDecision[];
  ambiguousGroups: AmbiguousGroup[];
  warning?: string;
};

type PlanningState = {
  prepared: PreparedSkillContext;
  loaded: boolean;
  selected: PreparedModule[];
  selectedIds: Set<string>;
  coveredText: string;
  duplicateCharsAvoided: number;
  allocationTiers: Set<AllocationTier>;
  skippedReason?: string;
  warning?: string;
};

export type GlobalSkillContextPlan = {
  planningMode: SkillContextPlanningMode;
  maxContextChars: number;
  requiredCoreReservedChars: number;
  requiredModuleReservedChars: number;
  optionalModuleCharsLoaded: number;
  optionalSkillCoreCharsLoaded: number;
  requiredOverflowChars: number;
  duplicateCharsAvoided: number;
  totalContextCharsLoaded: number;
  totalFullSkillChars: number;
  estimatedCharsSaved: number;
  remainingContextChars: number;
  budgetExceeded: boolean;
  globallySelectedModules: Array<{
    skill: string;
    module: string;
    tier: AllocationTier;
    score: number;
    chars: number;
  }>;
  skills: PlannedSkillContext[];
};

function resolveInsideSkill(skillDir: string, relativePath: string): string {
  const resolved = path.resolve(skillDir, relativePath);
  const relative = path.relative(skillDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Skill context path escapes its skill directory: ${relativePath}`);
  }
  return resolved;
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+\S/.exec(line.trim());
  return match ? match[1].length : null;
}

export function extractMarkdownSections(markdown: string, headings: string[]): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[] = [];
  for (const requested of headings) {
    const matches = lines
      .map((line, index) => ({ line: line.trim(), index }))
      .filter((item) => item.line === requested.trim());
    if (matches.length !== 1) {
      throw new Error(`Expected one markdown heading '${requested}', found ${matches.length}.`);
    }
    const start = matches[0].index;
    const level = headingLevel(lines[start]);
    if (!level) throw new Error(`Context section is not a markdown heading: ${requested}`);
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

async function readBoundedText(filePath: string, maxChars: number): Promise<string> {
  const text = await fs.readFile(filePath, "utf8");
  if (text.length > maxChars) throw new Error(`Skill context source exceeds ${maxChars} characters: ${filePath}`);
  return text;
}

async function materializeSource(args: {
  source: SkillContextSource;
  skillDir: string;
  fullSkillText: string;
  maxChars?: number;
}): Promise<string> {
  const maxChars = args.maxChars ?? MAX_MODULE_FILE_CHARS;
  const text = args.source.path
    ? await readBoundedText(resolveInsideSkill(args.skillDir, args.source.path), maxChars)
    : extractMarkdownSections(args.fullSkillText, args.source.sections ?? []);
  if (text.length > maxChars) throw new Error(`Materialized skill context exceeds ${maxChars} characters.`);
  return text.trim();
}

function compareModules(
  a: { module: PreparedModule; state: PlanningState },
  b: { module: PreparedModule; state: PlanningState },
): number {
  return b.module.score - a.module.score
    || b.module.priority - a.module.priority
    || b.state.prepared.routeScore - a.state.prepared.routeScore
    || a.state.prepared.routeIndex - b.state.prepared.routeIndex
    || a.state.prepared.skill.name.localeCompare(b.state.prepared.skill.name)
    || a.module.id.localeCompare(b.module.id);
}

function moduleAlreadyCovered(state: PlanningState, module: PreparedModule): boolean {
  const content = module.content.trim();
  return content.length > 0 && state.coveredText.includes(content);
}

function updateDecision(
  state: PlanningState,
  module: PreparedModule,
  patch: Partial<ModuleDecision>,
): void {
  const index = state.prepared.moduleDecisions.findIndex((item) => item.id === module.id);
  if (index < 0) return;
  state.prepared.moduleDecisions[index] = {
    ...state.prepared.moduleDecisions[index],
    ...patch,
  };
}

function selectModule(state: PlanningState, module: PreparedModule, tier: AllocationTier): number {
  if (state.selectedIds.has(module.id)) return 0;
  if (moduleAlreadyCovered(state, module)) {
    state.duplicateCharsAvoided += module.chars;
    updateDecision(state, module, {
      selected: false,
      chars: 0,
      reason: "already-covered-by-loaded-context",
      allocationTier: tier,
    });
    return 0;
  }
  state.selected.push(module);
  state.selectedIds.add(module.id);
  state.coveredText = `${state.coveredText}\n\n${module.content}`;
  state.allocationTiers.add(tier);
  updateDecision(state, module, {
    selected: true,
    reason: "selected",
    allocationTier: tier,
  });
  return module.chars;
}

function omitModule(state: PlanningState, module: PreparedModule, reason: string, tier: AllocationTier): void {
  updateDecision(state, module, {
    selected: false,
    reason,
    allocationTier: tier,
  });
}

function finalContent(state: PlanningState): string {
  return [state.prepared.baseContent, ...state.selected.map((module) => module.assembledContent)]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function prepareDecisionRecords(selection: ReturnType<typeof selectSkillContextModules>): ModuleDecision[] {
  return selection.decisions.map((item) => ({
    id: item.id,
    selected: item.selected,
    score: item.score,
    chars: item.chars,
    reason: item.reason,
    matched: item.matched,
  }));
}

async function prepareCodexSkillContext(args: {
  skill: SkillEntry;
  required: boolean;
  routeIndex: number;
  routeScore: number;
  intent: StructuredSkillIntent;
  stage: SkillStage;
  mode: SkillContextMode;
  references: SkillReferenceMode;
}): Promise<PreparedSkillContext> {
  if (!args.skill.path) throw new Error(`Codex skill has no readable path: ${args.skill.name}`);
  const fullSkillText = await readBoundedText(args.skill.path, MAX_SKILL_FILE_CHARS);
  if (args.mode === "full") {
    return {
      skill: args.skill,
      required: args.required,
      routeIndex: args.routeIndex,
      routeScore: args.routeScore,
      mode: "full",
      manifestStatus: "disabled",
      fallbackFull: false,
      fullSkillText,
      baseContent: fullSkillText,
      modules: [],
      moduleDecisions: [],
      ambiguousGroups: [],
    };
  }

  const skillDir = path.dirname(args.skill.path);
  const manifestPath = path.join(skillDir, MANIFEST_NAME);
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        skill: args.skill,
        required: args.required,
        routeIndex: args.routeIndex,
        routeScore: args.routeScore,
        mode: "full",
        manifestStatus: "missing",
        fallbackFull: true,
        fullSkillText,
        baseContent: fullSkillText,
        modules: [],
        moduleDecisions: [],
        ambiguousGroups: [],
        warning: "No context-modules.json manifest; loaded full SKILL.md for compatibility.",
      };
    }
    throw error;
  }

  let manifest;
  try {
    manifest = skillContextManifestSchema.parse(JSON.parse(manifestRaw));
  } catch (error) {
    return {
      skill: args.skill,
      required: args.required,
      routeIndex: args.routeIndex,
      routeScore: args.routeScore,
      mode: "full",
      manifestStatus: "invalid",
      fallbackFull: true,
      fullSkillText,
      baseContent: fullSkillText,
      modules: [],
      moduleDecisions: [],
      ambiguousGroups: [],
      warning: `Invalid context-modules.json; loaded full SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const core = await materializeSource({ source: manifest.core, skillDir, fullSkillText, maxChars: MAX_SKILL_FILE_CHARS });
  const skillHeader = `# Active skill context: ${args.skill.name}`;
  const baseContent = [skillHeader, core].join("\n\n").trim();
  if (args.references === "none") {
    return {
      skill: args.skill,
      required: args.required,
      routeIndex: args.routeIndex,
      routeScore: args.routeScore,
      mode: "selective",
      manifestStatus: "loaded",
      fallbackFull: false,
      fullSkillText,
      baseContent,
      modules: [],
      moduleDecisions: manifest.modules.map((module) => ({
        id: module.id,
        selected: false,
        score: 0,
        chars: 0,
        reason: "references-disabled",
        matched: [],
      })),
      ambiguousGroups: [],
    };
  }

  const materialized = await Promise.all(manifest.modules.map(async (module) => {
    const content = await materializeSource({ source: module.source, skillDir, fullSkillText, maxChars: module.maxChars });
    const assembledContent = `## Selected context module: ${module.id}\n\n${content}`;
    return {
      ...module,
      content,
      assembledContent,
      chars: assembledContent.length + 2,
    };
  }));
  const selection = selectSkillContextModules({
    modules: materialized.map(({ content: _content, assembledContent: _assembledContent, ...module }) => module),
    intent: args.intent,
    stage: args.stage,
    maxModuleChars: UNBOUNDED_MODULE_BUDGET,
  });
  const selectedById = new Map(selection.selected.map((module) => [module.id, module]));
  const modules: PreparedModule[] = materialized
    .filter((module) => selectedById.has(module.id))
    .map((module) => {
      const selected = selectedById.get(module.id)!;
      const decision = selection.decisions.find((item) => item.id === module.id)!;
      return {
        id: module.id,
        content: module.content,
        assembledContent: module.assembledContent,
        chars: module.chars,
        score: decision.score,
        priority: module.priority ?? 0,
        required: module.required === true,
        matched: decision.matched,
      };
    });

  return {
    skill: args.skill,
    required: args.required,
    routeIndex: args.routeIndex,
    routeScore: args.routeScore,
    mode: "selective",
    manifestStatus: "loaded",
    fallbackFull: false,
    fullSkillText,
    baseContent,
    modules,
    moduleDecisions: prepareDecisionRecords(selection),
    ambiguousGroups: selection.ambiguousGroups,
  };
}

function toResult(state: PlanningState, maxContextChars: number): PlannedSkillContext {
  const prepared = state.prepared;
  if (!state.loaded) {
    const candidateChars = prepared.baseContent.length
      + prepared.modules.filter((module) => module.required).reduce((sum, module) => sum + module.chars, 0);
    const warning = state.warning
      ?? `Optional skill '${prepared.skill.name}' context was skipped because its minimum package of ${candidateChars} characters did not fit the global budget.`;
    return {
      skill: prepared.skill,
      loaded: false,
      warning,
      contextAssembly: {
        mode: prepared.mode,
        manifestStatus: prepared.manifestStatus,
        fallbackFull: prepared.fallbackFull,
        coreCharsLoaded: 0,
        moduleCharsLoaded: 0,
        totalCharsLoaded: 0,
        fullSkillChars: prepared.fullSkillText.length,
        estimatedCharsSaved: prepared.fullSkillText.length,
        selectedModules: [],
        moduleDecisions: prepared.moduleDecisions,
        ambiguousGroups: prepared.ambiguousGroups,
        budgetExceeded: true,
        planningMode: "global-required-core-first",
        allocationTiers: [],
        duplicateCharsAvoided: state.duplicateCharsAvoided,
        skipped: true,
        skippedReason: state.skippedReason ?? "optional-context-exceeds-budget",
        candidateChars,
        warning,
      },
    };
  }

  const content = prepared.mode === "full" ? prepared.baseContent : finalContent(state);
  const moduleCharsLoaded = Math.max(0, content.length - prepared.baseContent.length);
  return {
    skill: prepared.skill,
    loaded: true,
    activationInstruction: prepared.mode === "full"
      ? "Treat the returned SKILL.md as active procedural guidance for the current task. Apply it together with higher-priority safety and project instructions."
      : "Treat the assembled core and selected modules as active guidance for this task phase. Omitted modules are not active unless loaded explicitly.",
    content,
    contextAssembly: {
      mode: prepared.mode,
      manifestStatus: prepared.manifestStatus,
      fallbackFull: prepared.fallbackFull,
      coreCharsLoaded: prepared.baseContent.length,
      moduleCharsLoaded,
      totalCharsLoaded: content.length,
      fullSkillChars: prepared.fullSkillText.length,
      estimatedCharsSaved: Math.max(0, prepared.fullSkillText.length - content.length),
      selectedModules: state.selected.map((module) => module.id),
      moduleDecisions: prepared.moduleDecisions,
      ambiguousGroups: prepared.ambiguousGroups,
      budgetExceeded: content.length > maxContextChars
        || prepared.moduleDecisions.some((item) => item.reason === "budget-exceeded"),
      planningMode: "global-required-core-first",
      allocationTiers: [...state.allocationTiers],
      duplicateCharsAvoided: state.duplicateCharsAvoided,
      warning: prepared.warning,
    },
  };
}

export async function planCodexSkillContexts(args: {
  skills: Array<{
    skill: SkillEntry;
    required: boolean;
    routeIndex: number;
    routeScore: number;
  }>;
  intent: StructuredSkillIntent;
  stage: SkillStage;
  mode: SkillContextMode;
  references: SkillReferenceMode;
  maxContextChars: number;
}): Promise<GlobalSkillContextPlan> {
  const prepared = await Promise.all(args.skills.map((item) => prepareCodexSkillContext({
    ...item,
    intent: args.intent,
    stage: args.stage,
    mode: args.mode,
    references: args.references,
  })));
  const states = prepared.map<PlanningState>((item) => ({
    prepared: item,
    loaded: false,
    selected: [],
    selectedIds: new Set(),
    coveredText: "",
    duplicateCharsAvoided: 0,
    allocationTiers: new Set(),
  }));
  const requiredStates = states.filter((state) => state.prepared.required);
  const optionalStates = states.filter((state) => !state.prepared.required);
  let used = 0;
  let requiredCoreReservedChars = 0;
  let requiredModuleReservedChars = 0;
  let optionalModuleCharsLoaded = 0;
  let optionalSkillCoreCharsLoaded = 0;
  const globallySelectedModules: GlobalSkillContextPlan["globallySelectedModules"] = [];

  for (const state of requiredStates) {
    state.loaded = true;
    state.coveredText = state.prepared.baseContent;
    state.allocationTiers.add("required-core");
    used += state.prepared.baseContent.length;
    requiredCoreReservedChars += state.prepared.baseContent.length;
  }

  const requiredModules = requiredStates
    .flatMap((state) => state.prepared.modules.filter((module) => module.required).map((module) => ({ state, module })))
    .sort(compareModules);
  for (const candidate of requiredModules) {
    const chars = selectModule(candidate.state, candidate.module, "required-module");
    used += chars;
    requiredModuleReservedChars += chars;
    if (chars > 0) globallySelectedModules.push({
      skill: candidate.state.prepared.skill.name,
      module: candidate.module.id,
      tier: "required-module",
      score: candidate.module.score,
      chars,
    });
  }

  let remaining = Math.max(0, args.maxContextChars - used);
  const requiredOptionalModules = requiredStates
    .flatMap((state) => state.prepared.modules.filter((module) => !module.required).map((module) => ({ state, module })))
    .sort(compareModules);
  for (const candidate of requiredOptionalModules) {
    if (moduleAlreadyCovered(candidate.state, candidate.module)) {
      selectModule(candidate.state, candidate.module, "required-skill-module");
      continue;
    }
    if (candidate.module.chars <= remaining) {
      const chars = selectModule(candidate.state, candidate.module, "required-skill-module");
      used += chars;
      remaining = Math.max(0, remaining - chars);
      optionalModuleCharsLoaded += chars;
      if (chars > 0) globallySelectedModules.push({
        skill: candidate.state.prepared.skill.name,
        module: candidate.module.id,
        tier: "required-skill-module",
        score: candidate.module.score,
        chars,
      });
    } else {
      omitModule(candidate.state, candidate.module, "budget-exceeded", "required-skill-module");
    }
  }

  optionalStates.sort((a, b) => b.prepared.routeScore - a.prepared.routeScore
    || a.prepared.routeIndex - b.prepared.routeIndex
    || a.prepared.skill.name.localeCompare(b.prepared.skill.name));
  for (const state of optionalStates) {
    const requiredForSkill = state.prepared.modules.filter((module) => module.required).sort((a, b) => compareModules(
      { state, module: a },
      { state, module: b },
    ));
    let minimumChars = state.prepared.baseContent.length;
    let simulatedCovered = state.prepared.baseContent;
    for (const module of requiredForSkill) {
      if (!simulatedCovered.includes(module.content.trim())) {
        minimumChars += module.chars;
        simulatedCovered += `\n\n${module.content}`;
      }
    }
    if (minimumChars > remaining) {
      state.skippedReason = "optional-context-exceeds-budget";
      state.warning = `Optional skill '${state.prepared.skill.name}' context was skipped because its minimum package of ${minimumChars} characters exceeds the remaining global budget of ${remaining}.`;
      for (const module of state.prepared.modules) {
        omitModule(state, module, "optional-skill-not-loaded", module.required ? "required-module" : "optional-skill-module");
      }
      continue;
    }
    state.loaded = true;
    state.coveredText = state.prepared.baseContent;
    state.allocationTiers.add("optional-skill-core");
    used += state.prepared.baseContent.length;
    remaining = Math.max(0, remaining - state.prepared.baseContent.length);
    optionalSkillCoreCharsLoaded += state.prepared.baseContent.length;
    for (const module of requiredForSkill) {
      const chars = selectModule(state, module, "required-module");
      used += chars;
      remaining = Math.max(0, remaining - chars);
      requiredModuleReservedChars += chars;
      if (chars > 0) globallySelectedModules.push({
        skill: state.prepared.skill.name,
        module: module.id,
        tier: "required-module",
        score: module.score,
        chars,
      });
    }
  }

  const optionalSkillModules = optionalStates
    .filter((state) => state.loaded)
    .flatMap((state) => state.prepared.modules.filter((module) => !module.required).map((module) => ({ state, module })))
    .sort(compareModules);
  for (const candidate of optionalSkillModules) {
    if (moduleAlreadyCovered(candidate.state, candidate.module)) {
      selectModule(candidate.state, candidate.module, "optional-skill-module");
      continue;
    }
    if (candidate.module.chars <= remaining) {
      const chars = selectModule(candidate.state, candidate.module, "optional-skill-module");
      used += chars;
      remaining = Math.max(0, remaining - chars);
      optionalModuleCharsLoaded += chars;
      if (chars > 0) globallySelectedModules.push({
        skill: candidate.state.prepared.skill.name,
        module: candidate.module.id,
        tier: "optional-skill-module",
        score: candidate.module.score,
        chars,
      });
    } else {
      omitModule(candidate.state, candidate.module, "budget-exceeded", "optional-skill-module");
    }
  }

  const skills = states
    .sort((a, b) => a.prepared.routeIndex - b.prepared.routeIndex)
    .map((state) => toResult(state, args.maxContextChars));
  const totalContextCharsLoaded = skills.reduce((sum, item) => sum + item.contextAssembly.totalCharsLoaded, 0);
  const totalFullSkillChars = skills.reduce((sum, item) => sum + item.contextAssembly.fullSkillChars, 0);
  const estimatedCharsSaved = skills.reduce((sum, item) => sum + item.contextAssembly.estimatedCharsSaved, 0);
  const duplicateCharsAvoided = skills.reduce((sum, item) => sum + item.contextAssembly.duplicateCharsAvoided, 0);
  const requiredOverflowChars = Math.max(0, requiredCoreReservedChars + requiredModuleReservedChars - args.maxContextChars);

  return {
    planningMode: "global-required-core-first",
    maxContextChars: args.maxContextChars,
    requiredCoreReservedChars,
    requiredModuleReservedChars,
    optionalModuleCharsLoaded,
    optionalSkillCoreCharsLoaded,
    requiredOverflowChars,
    duplicateCharsAvoided,
    totalContextCharsLoaded,
    totalFullSkillChars,
    estimatedCharsSaved,
    remainingContextChars: Math.max(0, args.maxContextChars - totalContextCharsLoaded),
    budgetExceeded: totalContextCharsLoaded > args.maxContextChars
      || skills.some((item) => item.contextAssembly.budgetExceeded),
    globallySelectedModules,
    skills,
  };
}

export async function assembleCodexSkillContext(args: {
  skill: SkillEntry;
  intent: StructuredSkillIntent;
  stage: SkillStage;
  mode: SkillContextMode;
  references: SkillReferenceMode;
  remainingChars: number;
}): Promise<SkillContextAssembly> {
  const plan = await planCodexSkillContexts({
    skills: [{ skill: args.skill, required: true, routeIndex: 0, routeScore: 0 }],
    intent: args.intent,
    stage: args.stage,
    mode: args.mode,
    references: args.references,
    maxContextChars: Math.max(0, Math.floor(args.remainingChars)),
  });
  const result = plan.skills[0];
  if (!result || !result.loaded) throw new Error(`Required skill context was unexpectedly skipped: ${args.skill.name}`);
  return result;
}
