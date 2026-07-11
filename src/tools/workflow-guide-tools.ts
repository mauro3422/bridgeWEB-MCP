import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/process.js";

const GUIDE_SCHEMA_VERSION = 1;
const MAX_GUIDES = 200;
const MAX_GUIDE_TEXT_CHARS = 120_000;
const MAX_PHASES = 24;

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(80);
const phaseNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(80);

const guideManifestSchema = z.object({
  schemaVersion: z.literal(GUIDE_SCHEMA_VERSION),
  name: slugSchema,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1200),
  activation: z.object({
    keywords: z.array(z.string().min(1).max(100)).max(80).default([]),
    phrases: z.array(z.string().min(1).max(240)).max(40).default([]),
    negativeKeywords: z.array(z.string().min(1).max(100)).max(40).default([]),
    examples: z.array(z.string().min(1).max(500)).max(30).default([]),
  }),
  entrypoint: z.string().min(1).max(240).default("GUIDE.md"),
  phases: z.record(z.string(), z.string()).default({}),
  recommendedTools: z.array(z.string().min(1).max(120)).max(80).default([]),
  scopeNotes: z.string().max(1200).optional(),
});

type GuideManifest = z.infer<typeof guideManifestSchema>;
type GuideScope = "project" | "global";

type DiscoveredGuide = {
  scope: GuideScope;
  directory: string;
  manifestPath: string;
  manifest: GuideManifest;
};

function globalGuideRoot(): string {
  return path.resolve(process.cwd(), "integrations", "workflow-guides");
}

function projectGuideRoot(projectRoot: string): string {
  const resolvedProjectRoot = resolveToolPath(projectRoot, { access: "read" });
  return path.join(resolvedProjectRoot, ".bridge", "workflow-guides");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 2));
}

function ensureInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(prefix)) {
    throw new Error(`Guide file escaped its root: ${resolvedCandidate}`);
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

async function readBoundedText(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Guide path is not a file: ${filePath}`);
  if (stat.size > MAX_GUIDE_TEXT_CHARS * 4) throw new Error(`Guide file is too large: ${filePath}`);
  const text = await fs.readFile(filePath, "utf8");
  if (text.length > MAX_GUIDE_TEXT_CHARS) throw new Error(`Guide text exceeds ${MAX_GUIDE_TEXT_CHARS} characters: ${filePath}`);
  return text;
}

async function readGuide(directory: string, scope: GuideScope): Promise<DiscoveredGuide | null> {
  const manifestPath = path.join(directory, "guide.json");
  if (!(await pathExists(manifestPath))) return null;
  const raw = JSON.parse(await readBoundedText(manifestPath));
  const manifest = guideManifestSchema.parse(raw);
  if (path.basename(directory) !== manifest.name) {
    throw new Error(`Guide directory '${path.basename(directory)}' does not match manifest name '${manifest.name}'`);
  }
  return { scope, directory, manifestPath, manifest };
}

async function discoverInRoot(root: string, scope: GuideScope): Promise<DiscoveredGuide[]> {
  if (!(await pathExists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const guides: DiscoveredGuide[] = [];
  for (const entry of entries.slice(0, MAX_GUIDES)) {
    if (!entry.isDirectory()) continue;
    const guide = await readGuide(path.join(root, entry.name), scope);
    if (guide) guides.push(guide);
  }
  return guides;
}

async function discoverGuides(projectRoot?: string): Promise<DiscoveredGuide[]> {
  const projectGuides = projectRoot ? await discoverInRoot(projectGuideRoot(projectRoot), "project") : [];
  const globalGuides = await discoverInRoot(globalGuideRoot(), "global");
  const merged = new Map<string, DiscoveredGuide>();
  for (const guide of globalGuides) merged.set(guide.manifest.name, guide);
  for (const guide of projectGuides) merged.set(guide.manifest.name, guide);
  return [...merged.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

function scoreGuide(task: string, guide: DiscoveredGuide) {
  const normalizedTask = normalizeText(task);
  const taskTokens = tokenize(task);
  let score = 0;
  const reasons: string[] = [];

  const nameText = normalizeText(`${guide.manifest.name} ${guide.manifest.title}`);
  if (nameText && normalizedTask.includes(nameText)) {
    score += 8;
    reasons.push("guide name/title appears in task");
  }

  for (const phrase of guide.manifest.activation.phrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase && normalizedTask.includes(normalizedPhrase)) {
      score += 6;
      reasons.push(`phrase:${phrase}`);
    }
  }

  for (const keyword of guide.manifest.activation.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) continue;
    const keywordTokens = normalizedKeyword.split(/\s+/);
    const matched = keywordTokens.every((token) => taskTokens.has(token)) || normalizedTask.includes(normalizedKeyword);
    if (matched) {
      score += keywordTokens.length > 1 ? 3 : 2;
      reasons.push(`keyword:${keyword}`);
    }
  }

  for (const example of guide.manifest.activation.examples) {
    const exampleTokens = tokenize(example);
    if (exampleTokens.size === 0) continue;
    let overlap = 0;
    for (const token of exampleTokens) if (taskTokens.has(token)) overlap += 1;
    const ratio = overlap / exampleTokens.size;
    if (ratio >= 0.5) {
      score += 4;
      reasons.push("similar to activation example");
      break;
    }
    if (ratio >= 0.3) {
      score += 2;
      reasons.push("partially similar to activation example");
      break;
    }
  }

  for (const negative of guide.manifest.activation.negativeKeywords) {
    const normalizedNegative = normalizeText(negative);
    if (normalizedNegative && normalizedTask.includes(normalizedNegative)) {
      score -= 6;
      reasons.push(`negative:${negative}`);
    }
  }

  return { score, reasons };
}

function reusablePattern(task: string) {
  const normalized = normalizeText(task);
  const signals = [
    "siempre", "cada vez", "a futuro", "en el futuro", "repetir", "reutilizar", "plantilla",
    "pipeline", "workflow", "skill", "guia", "guía", "automatizar", "loop", "proceso",
    "pasos", "patron", "patrón", "cuando detecte", "rutina", "hook", "estandarizar",
    "standardize", "every time", "from now on", "reusable", "repeatable",
  ];
  const matchedSignals = signals.filter((signal) => normalized.includes(normalizeText(signal)));
  return {
    detected: matchedSignals.length > 0,
    score: matchedSignals.length,
    signals: matchedSignals,
  };
}

async function recommendGuide(args: { task: string; projectRoot?: string; maxResults: number }) {
  const guides = await discoverGuides(args.projectRoot);
  const ranked = guides
    .map((guide) => {
      const scored = scoreGuide(args.task, guide);
      return {
        name: guide.manifest.name,
        title: guide.manifest.title,
        description: guide.manifest.description,
        scope: guide.scope,
        score: scored.score,
        reasons: scored.reasons,
        recommendedTools: guide.manifest.recommendedTools,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.scope === "project" ? -1 : 1))
    .slice(0, args.maxResults);

  const pattern = reusablePattern(args.task);
  const bestDomainGuide = ranked.find((item) => item.name !== "workflow-guide-builder") ?? null;
  const builderGuide = ranked.find((item) => item.name === "workflow-guide-builder") ?? null;
  const shouldLoadExisting = Boolean(bestDomainGuide && bestDomainGuide.score >= 4);
  const createNewRecommended = !shouldLoadExisting && pattern.detected;

  return {
    task: args.task,
    searchedScopes: args.projectRoot ? ["project", "global"] : ["global"],
    guideCount: guides.length,
    reusablePattern: pattern,
    matches: ranked,
    recommendation: shouldLoadExisting
      ? { action: "load_existing", guide: bestDomainGuide?.name, builderGuide: null, reason: "A domain guide matched the task strongly." }
      : createNewRecommended
        ? { action: "propose_new", guide: null, builderGuide: builderGuide?.name ?? "workflow-guide-builder", reason: "The task looks repeatable but no domain guide matched strongly." }
        : { action: "none", guide: null, builderGuide: null, reason: "No strong reusable-workflow signal or domain guide match was found." },
  };
}

async function findGuide(name: string, projectRoot?: string): Promise<DiscoveredGuide> {
  const guides = await discoverGuides(projectRoot);
  const guide = guides.find((item) => item.manifest.name === name);
  if (!guide) throw new Error(`Workflow guide not found: ${name}`);
  return guide;
}

async function loadGuide(args: {
  name: string;
  phase?: string;
  projectRoot?: string;
  projectContextPath?: string;
  includeManifest: boolean;
}) {
  const guide = await findGuide(args.name, args.projectRoot);
  const entrypointPath = ensureInside(guide.directory, path.join(guide.directory, guide.manifest.entrypoint));
  const entrypoint = await readBoundedText(entrypointPath);

  let phaseDocument: { phase: string; path: string; text: string } | null = null;
  if (args.phase) {
    const relativePath = guide.manifest.phases[args.phase];
    if (!relativePath) {
      throw new Error(`Guide '${args.name}' has no phase '${args.phase}'. Available: ${Object.keys(guide.manifest.phases).join(", ") || "none"}`);
    }
    const phasePath = ensureInside(guide.directory, path.join(guide.directory, relativePath));
    phaseDocument = { phase: args.phase, path: phasePath, text: await readBoundedText(phasePath) };
  }

  let projectContext: { path: string; text: string } | null = null;
  if (args.projectContextPath) {
    const contextPath = resolveToolPath(args.projectContextPath, { access: "read" });
    projectContext = { path: contextPath, text: await readBoundedText(contextPath) };
  }

  return {
    guide: guide.manifest.name,
    title: guide.manifest.title,
    scope: guide.scope,
    activationInstruction: [
      "Treat the returned guide and optional phase document as active instructions for this task.",
      "Use the recommended tools in the described order.",
      "Project-specific context overrides generic examples but must not weaken safety or verification requirements.",
      "Do not claim an artifact or side effect exists until a tool result confirms it.",
    ].join(" "),
    availablePhases: Object.keys(guide.manifest.phases),
    recommendedTools: guide.manifest.recommendedTools,
    manifest: args.includeManifest ? guide.manifest : undefined,
    entrypoint: { path: entrypointPath, text: entrypoint },
    phaseDocument,
    projectContext,
  };
}

function guideMarkdown(args: {
  title: string;
  description: string;
  phases: Array<{ name: string; goal: string; instructions?: string }>;
  recommendedTools: string[];
}) {
  const phases = args.phases.length
    ? args.phases.map((phase, index) => `${index + 1}. **${phase.name}** — ${phase.goal}`).join("\n")
    : "1. **execute** — Follow the workflow goal and verify the result.";

  return `# ${args.title}

## Purpose

${args.description}

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

${phases}

## Tool policy

Recommended tools:

${args.recommendedTools.length ? args.recommendedTools.map((tool) => `- \`${tool}\``).join("\n") : "- Select the smallest safe tool set needed for the workflow."}

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update \`guide.json\` when activation patterns, phases, or recommended tools change.
`;
}

async function createGuide(args: {
  scope: GuideScope;
  projectRoot?: string;
  name: string;
  title: string;
  description: string;
  keywords: string[];
  triggerPhrases: string[];
  negativeKeywords: string[];
  examples: string[];
  phases: Array<{ name: string; goal: string; instructions?: string }>;
  recommendedTools: string[];
  overwrite: boolean;
}) {
  if (args.scope === "project" && !args.projectRoot) throw new Error("projectRoot is required for project-scoped guides");
  const root = args.scope === "global" ? globalGuideRoot() : projectGuideRoot(args.projectRoot!);
  const directory = path.join(root, args.name);
  const existingGuide = await pathExists(directory);
  if (existingGuide && !args.overwrite) throw new Error(`Workflow guide already exists: ${directory}`);

  const tempDirectory = path.join(root, `.tmp-${args.name}-${crypto.randomUUID()}`);
  await fs.mkdir(path.join(tempDirectory, "phases"), { recursive: true });

  const phases: Record<string, string> = {};
  for (const phase of args.phases) {
    const fileName = `phases/${phase.name}.md`;
    phases[phase.name] = fileName;
    const phaseText = `# ${phase.name}

## Goal

${phase.goal}

## Instructions

${phase.instructions?.trim() || "Follow the guide goal, use the declared tools, verify outputs, and record resumable state."}
`;
    await fs.writeFile(path.join(tempDirectory, ...fileName.split("/")), phaseText, "utf8");
  }

  const manifest: GuideManifest = {
    schemaVersion: GUIDE_SCHEMA_VERSION,
    name: args.name,
    title: args.title,
    description: args.description,
    activation: {
      keywords: args.keywords,
      phrases: args.triggerPhrases,
      negativeKeywords: args.negativeKeywords,
      examples: args.examples,
    },
    entrypoint: "GUIDE.md",
    phases,
    recommendedTools: args.recommendedTools,
    scopeNotes: args.scope === "global"
      ? "Global guide available to all projects connected through Mauro's Bridge MCP."
      : "Project guide; overrides a global guide with the same name while this projectRoot is supplied.",
  };

  await fs.writeFile(path.join(tempDirectory, "guide.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(tempDirectory, "GUIDE.md"), guideMarkdown(args), "utf8");
  await fs.mkdir(root, { recursive: true });
  if (existingGuide && args.overwrite) await fs.rm(directory, { recursive: true, force: true });
  await fs.rename(tempDirectory, directory);

  return {
    created: true,
    scope: args.scope,
    directory,
    manifestPath: path.join(directory, "guide.json"),
    entrypointPath: path.join(directory, "GUIDE.md"),
    phases: Object.keys(phases),
    manifest,
  };
}

export const workflowGuideToolModule: BridgeToolModule = {
  name: "workflow-guides",
  tools: [
    {
      name: "workflow_guide_recommend",
      description: "Use this when a user describes a repeatable multi-step process, says it should happen every time or in future, asks for a skill/pipeline/template/hook, or when an existing reusable workflow may apply. Searches project and global guides, scores activation patterns, and recommends loading an existing guide or proposing a new one.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "The user's current request or workflow description." },
          projectRoot: { type: "string", description: "Optional project root; project guides override global guides." },
          maxResults: { type: "number", default: 5, minimum: 1, maximum: 20 },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "workflow_guide_load",
      description: "Use this after workflow_guide_recommend selects a guide, or when the user explicitly names one. Loads the versioned guide prompt, an optional phase document, recommended tools, and optional project context so ChatGPT can follow it as active instructions.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Guide slug." },
          phase: { type: "string", description: "Optional phase key from the guide manifest." },
          projectRoot: { type: "string", description: "Optional project root used to discover project-specific guides first." },
          projectContextPath: { type: "string", description: "Optional allowed file containing project-specific brief or configuration." },
          includeManifest: { type: "boolean", default: true },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "workflow_guide_create",
      description: "Use this only when the user asks to create/save a reusable skill-like workflow guide, or explicitly approves a recommendation to do so. Scaffolds a versioned global Bridge MCP guide or project-specific guide with activation triggers, phases, recommended tools, and resumable verification instructions.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["global", "project"], default: "project" },
          projectRoot: { type: "string" },
          name: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          title: { type: "string" },
          description: { type: "string" },
          keywords: { type: "array", items: { type: "string" }, default: [] },
          triggerPhrases: { type: "array", items: { type: "string" }, default: [] },
          negativeKeywords: { type: "array", items: { type: "string" }, default: [] },
          examples: { type: "array", items: { type: "string" }, default: [] },
          phases: {
            type: "array",
            maxItems: MAX_PHASES,
            items: {
              type: "object",
              properties: {
                name: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
                goal: { type: "string" },
                instructions: { type: "string" },
              },
              required: ["name", "goal"],
              additionalProperties: false,
            },
            default: [],
          },
          recommendedTools: { type: "array", items: { type: "string" }, default: [] },
          overwrite: { type: "boolean", default: false },
        },
        required: ["name", "title", "description"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    workflow_guide_recommend: async (raw) => {
      const parsed = z.object({
        task: z.string().min(1).max(10_000),
        projectRoot: z.string().optional(),
        maxResults: z.number().int().min(1).max(20).default(5),
      }).parse(raw);
      return await recommendGuide(parsed);
    },
    workflow_guide_load: async (raw) => {
      const parsed = z.object({
        name: slugSchema,
        phase: phaseNameSchema.optional(),
        projectRoot: z.string().optional(),
        projectContextPath: z.string().optional(),
        includeManifest: z.boolean().default(true),
      }).parse(raw);
      return await loadGuide(parsed);
    },
    workflow_guide_create: async (raw) => {
      const parsed = z.object({
        scope: z.enum(["global", "project"]).default("project"),
        projectRoot: z.string().optional(),
        name: slugSchema,
        title: z.string().min(1).max(160),
        description: z.string().min(1).max(1200),
        keywords: z.array(z.string().min(1).max(100)).max(80).default([]),
        triggerPhrases: z.array(z.string().min(1).max(240)).max(40).default([]),
        negativeKeywords: z.array(z.string().min(1).max(100)).max(40).default([]),
        examples: z.array(z.string().min(1).max(500)).max(30).default([]),
        phases: z.array(z.object({
          name: phaseNameSchema,
          goal: z.string().min(1).max(1000),
          instructions: z.string().max(8000).optional(),
        })).max(MAX_PHASES).default([]),
        recommendedTools: z.array(z.string().min(1).max(120)).max(80).default([]),
        overwrite: z.boolean().default(false),
      }).parse(raw);
      return await createGuide(parsed);
    },
  },
};
