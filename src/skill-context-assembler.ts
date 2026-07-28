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

export type SkillContextMode = "selective" | "full";
export type SkillReferenceMode = "auto" | "none";

export type SkillContextAssembly = {
  skill: SkillEntry;
  loaded: true;
  activationInstruction: string;
  content: string;
  contextAssembly: {
    mode: SkillContextMode;
    manifestStatus: "loaded" | "missing" | "invalid" | "disabled";
    fallbackFull: boolean;
    coreCharsLoaded: number;
    moduleCharsLoaded: number;
    totalCharsLoaded: number;
    fullSkillChars: number;
    estimatedCharsSaved: number;
    selectedModules: string[];
    moduleDecisions: Array<Record<string, unknown>>;
    ambiguousGroups: Array<{ group: string; candidates: string[]; score: number }>;
    budgetExceeded: boolean;
    warning?: string;
  };
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

function fullAssembly(
  skill: SkillEntry,
  fullSkillText: string,
  status: SkillContextAssembly["contextAssembly"]["manifestStatus"],
  remainingChars: number,
  warning?: string,
): SkillContextAssembly {
  return {
    skill,
    loaded: true,
    activationInstruction: "Treat the returned SKILL.md as active procedural guidance for the current task. Apply it together with higher-priority safety and project instructions.",
    content: fullSkillText,
    contextAssembly: {
      mode: "full",
      manifestStatus: status,
      fallbackFull: status !== "disabled",
      coreCharsLoaded: fullSkillText.length,
      moduleCharsLoaded: 0,
      totalCharsLoaded: fullSkillText.length,
      fullSkillChars: fullSkillText.length,
      estimatedCharsSaved: 0,
      selectedModules: [],
      moduleDecisions: [],
      ambiguousGroups: [],
      budgetExceeded: fullSkillText.length > Math.max(0, remainingChars),
      warning,
    },
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
  if (!args.skill.path) throw new Error(`Codex skill has no readable path: ${args.skill.name}`);
  const fullSkillText = await readBoundedText(args.skill.path, MAX_SKILL_FILE_CHARS);
  if (args.mode === "full") return fullAssembly(args.skill, fullSkillText, "disabled", args.remainingChars);

  const skillDir = path.dirname(args.skill.path);
  const manifestPath = path.join(skillDir, MANIFEST_NAME);
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fullAssembly(args.skill, fullSkillText, "missing", args.remainingChars, "No context-modules.json manifest; loaded full SKILL.md for compatibility.");
    }
    throw error;
  }

  let manifest;
  try {
    manifest = skillContextManifestSchema.parse(JSON.parse(manifestRaw));
  } catch (error) {
    const warning = `Invalid context-modules.json; loaded full SKILL.md: ${error instanceof Error ? error.message : String(error)}`;
    return fullAssembly(args.skill, fullSkillText, "invalid", args.remainingChars, warning);
  }

  const core = await materializeSource({ source: manifest.core, skillDir, fullSkillText, maxChars: MAX_SKILL_FILE_CHARS });
  const skillHeader = `# Active skill context: ${args.skill.name}`;
  const baseContent = [skillHeader, core].join("\n\n").trim();
  const materialized = args.references === "none"
    ? []
    : await Promise.all(manifest.modules.map(async (module) => {
        const content = await materializeSource({ source: module.source, skillDir, fullSkillText, maxChars: module.maxChars });
        const assembledContent = `## Selected context module: ${module.id}\n\n${content}`;
        return { ...module, chars: assembledContent.length + 2, content, assembledContent };
      }));
  const availableForModules = Math.max(0, Math.floor(args.remainingChars) - baseContent.length);
  const selection = selectSkillContextModules({
    modules: materialized.map(({ content: _content, assembledContent: _assembledContent, ...module }) => module),
    intent: args.intent,
    stage: args.stage,
    maxModuleChars: availableForModules,
  });
  const selectedIds = new Set(selection.selected.map((module) => module.id));
  const selected = materialized.filter((module) => selectedIds.has(module.id));
  const content = [
    baseContent,
    ...selected.map((module) => module.assembledContent),
  ].join("\n\n").trim();
  const moduleCharsLoaded = Math.max(0, content.length - baseContent.length);

  return {
    skill: args.skill,
    loaded: true,
    activationInstruction: "Treat the assembled core and selected modules as active guidance for this task phase. Omitted modules are not active unless loaded explicitly.",
    content,
    contextAssembly: {
      mode: "selective",
      manifestStatus: "loaded",
      fallbackFull: false,
      coreCharsLoaded: core.length,
      moduleCharsLoaded,
      totalCharsLoaded: content.length,
      fullSkillChars: fullSkillText.length,
      estimatedCharsSaved: Math.max(0, fullSkillText.length - content.length),
      selectedModules: selected.map((module) => module.id),
      moduleDecisions: selection.decisions,
      ambiguousGroups: selection.ambiguousGroups,
      budgetExceeded: content.length > args.remainingChars || selection.decisions.some((item) => item.reason === "budget-exceeded"),
    },
  };
}
