import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const SKILL_PHASES = ["discovery", "safety", "implementation", "verification", "persistence", "maintenance"] as const;
export type SkillPhase = typeof SKILL_PHASES[number];
export const SKILL_STAGES = ["start", "implement", "verify", "persist", "close", "resume"] as const;
export type SkillStage = typeof SKILL_STAGES[number];

export const SKILL_DOMAINS = [
  "roblox", "blender", "figma", "github", "google-workspace", "openai-development", "artifacts",
  "browser", "coding", "opencode", "agent-orchestration", "skill-system", "other",
] as const;
export const SKILL_ACTIONS = [
  "discover", "design", "create", "edit", "review", "test", "debug", "optimize", "save", "recover",
  "publish", "coordinate", "maintain", "document", "analyze",
] as const;
export const SKILL_ARTIFACTS = [
  "code", "game", "ui", "animation", "model-3d", "asset", "document", "spreadsheet", "presentation",
  "diagram", "website", "skill", "mcp", "placement-system", "network-system", "resource-system",
] as const;
export const SKILL_NEEDS = [
  "official-docs", "safe-editing", "unit-tests", "playtest", "visual-qa", "device-testing", "performance",
  "scene-analysis", "backup", "history-recovery", "cross-agent", "human-approval",
] as const;
export const SKILL_RISKS = ["read-only", "write", "destructive", "external-side-effect"] as const;

export type SkillSource = "codex-local" | "codex-system" | "codex-plugin" | "roblox";
export type SkillEntry = {
  name: string;
  description: string;
  source: SkillSource;
  path?: string;
  origin?: string;
};

export const structuredSkillIntentSchema = z.object({
  summary: z.string().min(1).max(600).optional(),
  domains: z.array(z.enum(SKILL_DOMAINS)).min(1).max(8),
  actions: z.array(z.enum(SKILL_ACTIONS)).min(1).max(12),
  artifacts: z.array(z.enum(SKILL_ARTIFACTS)).max(12).default([]),
  needs: z.array(z.enum(SKILL_NEEDS)).max(12).default([]),
  risk: z.enum(SKILL_RISKS).default("read-only"),
  ambiguity: z.enum(["low", "medium", "high"]).default("low"),
}).strict();
export type StructuredSkillIntent = z.infer<typeof structuredSkillIntentSchema>;

const routeMetadataSchema = z.object({
  phase: z.enum(SKILL_PHASES).optional(),
  domains: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  needs: z.array(z.string()).default([]),
  requires: z.array(z.string()).default([]),
  complements: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
  negativeIntents: z.array(z.string()).default([]),
  requireNeedMatch: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(40),
  activation: z.enum(["on-demand", "always", "closing"]).default("on-demand"),
}).strict();

const conditionSchema = z.object({
  domains: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  needs: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  stages: z.array(z.enum(SKILL_STAGES)).optional(),
}).strict();

const workflowPhaseSchema = z.object({
  phase: z.enum(SKILL_PHASES),
  skills: z.array(z.string()).min(1),
  required: z.boolean().default(true),
  when: conditionSchema.optional(),
}).strict();

const routingConfigSchema = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  skills: z.record(z.string(), routeMetadataSchema).default({}),
  workflows: z.array(z.object({
    name: z.string().min(1),
    match: conditionSchema,
    phases: z.array(workflowPhaseSchema).min(1),
  }).strict()).default([]),
}).strict();

export type RouteMetadata = z.infer<typeof routeMetadataSchema>;
type RoutingConfig = z.infer<typeof routingConfigSchema>;
type Condition = z.infer<typeof conditionSchema>;
export type RoutingMetadataSource = "explicit" | "inferred";
export type RoutingRegistrySkill = SkillEntry & RouteMetadata & { routingMetadataSource: RoutingMetadataSource };

export type RoutedSkill = RoutingRegistrySkill & {
  score: number;
  reasons: string[];
  required: boolean;
  requiredBy: string[];
};

function codexHome(): string {
  return path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"));
}

function bridgeProjectRoot(): string {
  return path.resolve(process.env.BRIDGE_MCP_PROJECT_ROOT?.trim() || process.cwd());
}

export function routingConfigPath(): string {
  return path.resolve(process.env.BRIDGE_MCP_SKILL_ROUTING_PATH?.trim()
    || path.join(bridgeProjectRoot(), "config", "skill-routing", "skill-routing-overrides.json"));
}

export function routingFixturesPath(): string {
  return path.resolve(process.env.BRIDGE_MCP_SKILL_ROUTING_FIXTURES_PATH?.trim()
    || path.join(bridgeProjectRoot(), "config", "skill-routing", "skill-routing-fixtures.json"));
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalize).filter(Boolean));
}

function intersects(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a?.length || !b.length) return false;
  const right = tokenSet(b);
  return a.some((value) => right.has(normalize(value)));
}

function conditionMatches(condition: Condition | undefined, intent: StructuredSkillIntent, stage: SkillStage): boolean {
  if (!condition) return true;
  if (condition.domains?.length && !intersects(condition.domains, intent.domains)) return false;
  if (condition.actions?.length && !intersects(condition.actions, intent.actions)) return false;
  if (condition.artifacts?.length && !intersects(condition.artifacts, intent.artifacts)) return false;
  if (condition.needs?.length && !intersects(condition.needs, intent.needs)) return false;
  if (condition.risks?.length && !condition.risks.includes(intent.risk)) return false;
  if (condition.stages?.length && !condition.stages.includes(stage)) return false;
  return true;
}

function versionVector(entry: SkillEntry): number[] {
  return (entry.path ?? "").match(/\d+/g)?.map(Number) ?? [];
}

function compareVersionsDescending(a: SkillEntry, b: SkillEntry): number {
  const av = versionVector(a);
  const bv = versionVector(b);
  const length = Math.max(av.length, bv.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (bv[index] ?? 0) - (av[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function compareEntries(a: SkillEntry, b: SkillEntry): number {
  const sourceRank: Record<SkillSource, number> = { "codex-local": 0, "codex-system": 1, roblox: 2, "codex-plugin": 3 };
  const sourceDiff = sourceRank[a.source] - sourceRank[b.source];
  if (sourceDiff) return sourceDiff;
  if (a.source === "codex-plugin" && b.source === "codex-plugin") {
    const remoteDiff = Number(!normalize(a.path ?? "").includes("remote")) - Number(!normalize(b.path ?? "").includes("remote"));
    if (remoteDiff) return remoteDiff;
    const versionDiff = compareVersionsDescending(a, b);
    if (versionDiff) return versionDiff;
  }
  return (a.path ?? "").localeCompare(b.path ?? "");
}

export function canonicalizeSkillEntries(skills: SkillEntry[]): { entries: SkillEntry[]; duplicates: Array<{ name: string; chosen: SkillEntry; alternatives: SkillEntry[] }> } {
  const groups = new Map<string, SkillEntry[]>();
  for (const skill of skills) {
    const group = groups.get(skill.name) ?? [];
    group.push(skill);
    groups.set(skill.name, group);
  }
  const entries: SkillEntry[] = [];
  const duplicates: Array<{ name: string; chosen: SkillEntry; alternatives: SkillEntry[] }> = [];
  for (const [name, group] of groups) {
    const sorted = [...group].sort(compareEntries);
    entries.push(sorted[0]);
    if (sorted.length > 1) duplicates.push({ name, chosen: sorted[0], alternatives: sorted.slice(1) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, duplicates };
}

async function loadRoutingConfig(): Promise<{ config: RoutingConfig; warnings: string[] }> {
  const configPath = routingConfigPath();
  try {
    const raw = JSON.parse(await fs.readFile(configPath, "utf8"));
    return { config: routingConfigSchema.parse(raw), warnings: [] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { config: { schemaVersion: 1, skills: {}, workflows: [] }, warnings: [`Skill routing config unavailable or invalid at ${configPath}: ${detail}`] };
  }
}

function inferredDomain(skill: SkillEntry): string[] {
  const text = normalize(`${skill.name} ${skill.description} ${skill.path ?? ""}`);
  const domains: Array<[string, RegExp]> = [
    ["roblox", /\broblox\b|\brbx\b/], ["blender", /\bblender\b/], ["figma", /\bfigma\b/],
    ["github", /\bgithub\b|\bgh\b/], ["google-workspace", /google drive|google docs|google sheets|google slides/],
    ["openai-development", /openai|chatgpt app|agents sdk/], ["artifacts", /spreadsheet|document|presentation|pdf|template/],
    ["browser", /browser|chrome|website|sites/], ["agent-orchestration", /agent|swarm|orchestrat|bridge/],
    ["skill-system", /skill|plugin creator|skill creator/],
  ];
  const matched = domains.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return matched.length ? matched : ["coding"];
}

function inferredPhase(skill: SkillEntry): SkillPhase {
  const text = normalize(`${skill.name} ${skill.description}`);
  if (/save|backup|recovery|publish|hosting|yeet/.test(text)) return "persistence";
  if (/maintenance|governance|creator|installer|submission/.test(text)) return "maintenance";
  if (/test|review|qa|audit|analysis|profil|troubleshoot|fix ci|comments/.test(text)) return "verification";
  if (/safe editing|collaboration|credential|api key/.test(text)) return "safety";
  if (/search|docs|discover|router|catalog|drive$|github$/.test(text)) return "discovery";
  return "implementation";
}

function inferredMetadata(skill: SkillEntry): RouteMetadata {
  const text = normalize(`${skill.name} ${skill.description}`);
  const actions: string[] = [];
  const actionPatterns: Array<[string, RegExp]> = [
    ["discover", /search|discover|find|catalog|lookup|docs/], ["design", /design|architect|plan|reference/],
    ["create", /create|build|generate|author|scaffold/], ["edit", /edit|modify|update|repair|fix|refactor/],
    ["review", /review|qa|inspect|audit/], ["test", /test|playtest|coverage/], ["debug", /debug|troubleshoot|failure/],
    ["optimize", /optimiz|profil|performance/], ["save", /save|backup|persist/], ["recover", /recover|rollback|restore/],
    ["publish", /publish|push|deploy|hosting|submission/], ["coordinate", /collaboration|coordinate|swarm|orchestrat/],
    ["maintain", /maintain|maintenance|governance|installer|creator/], ["document", /document|docs|memo|report/],
    ["analyze", /analysis|analytics|inspect|audit/],
  ];
  for (const [action, pattern] of actionPatterns) if (pattern.test(text)) actions.push(action);
  return {
    phase: inferredPhase(skill),
    domains: inferredDomain(skill),
    actions: actions.length ? actions : ["create"],
    artifacts: [],
    needs: [],
    requires: [],
    complements: [],
    excludes: [],
    negativeIntents: [],
    requireNeedMatch: false,
    priority: skill.source === "codex-local" ? 55 : skill.source === "roblox" ? 50 : skill.source === "codex-system" ? 45 : 25,
    activation: "on-demand",
  };
}

function mergeMetadata(base: RouteMetadata, override: RouteMetadata | undefined): RouteMetadata {
  if (!override) return base;
  return {
    ...base,
    ...override,
    domains: override.domains.length ? override.domains : base.domains,
    actions: override.actions.length ? override.actions : base.actions,
    artifacts: override.artifacts.length ? override.artifacts : base.artifacts,
    needs: override.needs.length ? override.needs : base.needs,
    requires: override.requires,
    complements: override.complements,
    excludes: override.excludes,
    negativeIntents: override.negativeIntents,
  };
}

export async function buildSkillRoutingRegistry(skills: SkillEntry[]) {
  const canonical = canonicalizeSkillEntries(skills);
  const loaded = await loadRoutingConfig();
  const explicitSkillNames = new Set(Object.keys(loaded.config.skills));
  const entries: RoutingRegistrySkill[] = canonical.entries.map((skill) => ({
    ...skill,
    ...mergeMetadata(inferredMetadata(skill), loaded.config.skills[skill.name]),
    routingMetadataSource: explicitSkillNames.has(skill.name) ? "explicit" : "inferred",
  }));
  return {
    entries,
    duplicates: canonical.duplicates,
    workflows: loaded.config.workflows,
    config: loaded.config,
    explicitSkillNames,
    configPath: routingConfigPath(),
    fixturesPath: routingFixturesPath(),
    warnings: loaded.warnings,
  };
}

function routingDependencyCycles(entries: RoutingRegistrySkill[]): string[][] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const state = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const canonicalKeys = new Set<string>();

  const visit = (name: string) => {
    const current = state.get(name) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const index = Math.max(0, stack.indexOf(name));
      const cycle = [...stack.slice(index), name];
      const body = cycle.slice(0, -1);
      const rotations = body.map((_, offset) => [...body.slice(offset), ...body.slice(0, offset)]);
      const canonical = rotations.map((rotation) => rotation.join(" -> ")).sort()[0] ?? cycle.join(" -> ");
      if (!canonicalKeys.has(canonical)) {
        canonicalKeys.add(canonical);
        cycles.push(cycle);
      }
      return;
    }
    state.set(name, 1);
    stack.push(name);
    for (const dependency of byName.get(name)?.requires ?? []) if (byName.has(dependency)) visit(dependency);
    stack.pop();
    state.set(name, 2);
  };

  for (const entry of entries) visit(entry.name);
  return cycles;
}

async function skillFileHealth(entry: RoutingRegistrySkill) {
  if (!entry.path || entry.source === "roblox") return null;
  try {
    const text = await fs.readFile(entry.path, "utf8");
    return {
      name: entry.name,
      source: entry.source,
      path: entry.path,
      lines: text.split(/\r?\n/).length,
      chars: text.length,
      descriptionMissing: !entry.description.trim(),
    };
  } catch {
    return { name: entry.name, source: entry.source, path: entry.path, lines: 0, chars: 0, descriptionMissing: !entry.description.trim(), unreadable: true };
  }
}

export async function auditSkillRouting(skills: SkillEntry[]) {
  const registry = await buildSkillRoutingRegistry(skills);
  const catalogNames = new Set(registry.entries.map((entry) => entry.name));
  const configuredNames = new Set(Object.keys(registry.config.skills));
  const knownNames = new Set([...catalogNames, ...configuredNames]);
  const ownedSources = new Set<SkillSource>(["codex-local"]);
  const unconfiguredOwnedSkills = registry.entries
    .filter((entry) => ownedSources.has(entry.source) && entry.routingMetadataSource === "inferred")
    .map((entry) => ({
      name: entry.name,
      source: entry.source,
      path: entry.path,
      suggestedMetadata: {
        phase: entry.phase,
        domains: entry.domains,
        actions: entry.actions,
        artifacts: entry.artifacts,
        needs: entry.needs,
        requires: entry.requires,
        complements: entry.complements,
        excludes: entry.excludes,
        negativeIntents: entry.negativeIntents,
        requireNeedMatch: entry.requireNeedMatch,
        priority: entry.priority,
        activation: entry.activation,
      },
    }));
  const inferredExternalSkills = registry.entries
    .filter((entry) => !ownedSources.has(entry.source) && entry.routingMetadataSource === "inferred")
    .map((entry) => ({ name: entry.name, source: entry.source }));
  const staleConfigEntries = Object.keys(registry.config.skills)
    .filter((name) => !catalogNames.has(name) && !name.startsWith("rbx-"));
  const missingReferences: Array<{ owner: string; relation: "requires" | "complements" | "excludes"; target: string }> = [];
  for (const entry of registry.entries) {
    for (const relation of ["requires", "complements", "excludes"] as const) {
      for (const target of entry[relation]) if (!knownNames.has(target)) missingReferences.push({ owner: entry.name, relation, target });
    }
  }
  const missingWorkflowSkills: Array<{ workflow: string; phase: SkillPhase; skill: string }> = [];
  for (const workflow of registry.workflows) {
    for (const phase of workflow.phases) {
      for (const skill of phase.skills) if (!knownNames.has(skill)) missingWorkflowSkills.push({ workflow: workflow.name, phase: phase.phase, skill });
    }
  }
  const cycles = routingDependencyCycles(registry.entries);
  const fileHealth = (await Promise.all(registry.entries.map(skillFileHealth))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const oversizedSkills = fileHealth.filter((item) => item.lines > 500 || item.chars > MAX_SAFE_SKILL_CHARS);
  const missingDescriptions = fileHealth.filter((item) => item.source === "codex-local" && item.descriptionMissing);
  const unreadableSkills = fileHealth.filter((item) => "unreadable" in item && item.unreadable);
  const errors = [
    ...registry.warnings,
    ...missingReferences.map((item) => `${item.owner}.${item.relation} references missing skill ${item.target}`),
    ...missingWorkflowSkills.map((item) => `Workflow ${item.workflow}/${item.phase} references missing skill ${item.skill}`),
    ...cycles.map((cycle) => `Dependency cycle: ${cycle.join(" -> ")}`),
    ...unreadableSkills.map((item) => `Unreadable skill file: ${item.name} (${item.path})`),
  ];
  const maintenanceReasons = [
    ...unconfiguredOwnedSkills.map((item) => `Owned skill lacks explicit routing metadata: ${item.name}`),
    ...staleConfigEntries.map((name) => `Routing config entry is stale: ${name}`),
    ...oversizedSkills.map((item) => `Skill may need splitting: ${item.name} (${item.lines} lines, ${item.chars} chars)`),
    ...missingDescriptions.map((item) => `Skill description is missing: ${item.name}`),
  ];
  return {
    ok: errors.length === 0,
    maintenanceRequired: maintenanceReasons.length > 0,
    counts: {
      catalogSkills: registry.entries.length,
      explicitRouting: registry.entries.filter((entry) => entry.routingMetadataSource === "explicit").length,
      inferredRouting: registry.entries.filter((entry) => entry.routingMetadataSource === "inferred").length,
      duplicateNames: registry.duplicates.length,
      workflows: registry.workflows.length,
    },
    paths: { config: registry.configPath, fixtures: registry.fixturesPath },
    errors,
    maintenanceReasons,
    unconfiguredOwnedSkills,
    inferredExternalSkills,
    staleConfigEntries,
    missingReferences,
    missingWorkflowSkills,
    cycles,
    oversizedSkills,
    missingDescriptions,
    duplicates: registry.duplicates,
  };
}

const MAX_SAFE_SKILL_CHARS = 120_000;

function fallbackIntent(task: string): StructuredSkillIntent {
  const text = normalize(task);
  const domains: StructuredSkillIntent["domains"] = [];
  if (/roblox|studio|luau|rbxl/.test(text)) domains.push("roblox");
  if (/blender|blend|modelado 3d/.test(text)) domains.push("blender");
  if (/figma/.test(text)) domains.push("figma");
  if (/github|pull request|\bpr\b|git/.test(text)) domains.push("github");
  if (/google drive|google docs|google sheets|google slides/.test(text)) domains.push("google-workspace");
  if (/openai|chatgpt app|agents sdk/.test(text)) domains.push("openai-development");
  if (/opencode/.test(text)) domains.push("opencode");
  if (/skill|skills|router|plugin/.test(text)) domains.push("skill-system");
  if (/agente|agent|codex|bridge|swarm/.test(text)) domains.push("agent-orchestration");
  if (!domains.length) domains.push("coding");

  const actions: StructuredSkillIntent["actions"] = [];
  const mapping: Array<[StructuredSkillIntent["actions"][number], RegExp]> = [
    ["discover", /buscar|search|discover|listar|leer|inspect/], ["design", /disenar|design|arquitect|plan/],
    ["create", /crear|create|build|generar|author/], ["edit", /editar|modificar|update|arreglar|fix|refactor/],
    ["review", /revisar|review|auditar|audit/], ["test", /probar|test|playtest|cobertura/],
    ["debug", /debug|fall|error|bug/], ["optimize", /optimizar|performance|rendimiento|profil/],
    ["save", /guardar|save|backup|respaldo/], ["recover", /recuperar|recovery|rollback|restore/],
    ["publish", /publicar|publish|deploy|push/], ["coordinate", /coordinar|codex.*chatgpt|bridge|agentes/],
    ["maintain", /mantener|actualizar skill|mejorar skill|governance/], ["document", /documentar|docs|informe|report/],
    ["analyze", /analizar|analysis|auditar|medir/],
  ];
  for (const [action, pattern] of mapping) if (pattern.test(text)) actions.push(action);
  if (!actions.length) actions.push("analyze");

  const artifacts: StructuredSkillIntent["artifacts"] = [];
  if (/\b(?:ui|interfaz|hud)\b/.test(text)) artifacts.push("ui");
  if (/animacion|animation|keyframe/.test(text)) artifacts.push("animation");
  if (/modelo|model|mesh|3d/.test(text)) artifacts.push("model-3d");
  if (/placement|colocar|construir|build mode|grilla/.test(text)) artifacts.push("placement-system");
  if (/cable|conexion|puerto|network|red/.test(text)) artifacts.push("network-system");
  if (/recurso|resource|nutriente|energia|logistica/.test(text)) artifacts.push("resource-system");
  if (/skill/.test(text)) artifacts.push("skill");
  if (/mcp|bridge/.test(text)) artifacts.push("mcp");
  if (!artifacts.length) artifacts.push(domains.includes("roblox") ? "game" : "code");

  const needs: StructuredSkillIntent["needs"] = [];
  if (/docs|documentacion|api|referencia/.test(text)) needs.push("official-docs");
  if (/unit test|prueba unitaria|cobertura/.test(text)) needs.push("unit-tests");
  if (/playtest|probar el juego|gameplay/.test(text)) needs.push("playtest");
  if (/visual|captura|screenshot|vista/.test(text)) needs.push("visual-qa");
  if (/device|movil|tablet|responsive|orientacion/.test(text)) needs.push("device-testing");
  if (/performance|rendimiento|fps|cpu|gpu/.test(text)) needs.push("performance");
  if (/scene analysis|memoria|memory|leak/.test(text)) needs.push("scene-analysis");
  if (/guardar|backup|respaldo|save/.test(text)) needs.push("backup");
  if (/historial|recuperar sesion|recovery/.test(text)) needs.push("history-recovery");
  if (/codex.*chatgpt|chatgpt.*codex|bridge|coordinar agentes/.test(text)) needs.push("cross-agent");

  const risk: StructuredSkillIntent["risk"] = /borrar|delete|destruct|rollback/.test(text)
    ? "destructive"
    : /crear|editar|modificar|guardar|publicar|write|update|fix/.test(text) ? "write" : "read-only";
  return { summary: task.slice(0, 600), domains: [...new Set(domains)], actions: [...new Set(actions)], artifacts: [...new Set(artifacts)], needs: [...new Set(needs)], risk, ambiguity: "high" };
}

const phaseOrder = new Map<SkillPhase, number>(SKILL_PHASES.map((phase, index) => [phase, index]));
const stagePhases: Record<SkillStage, SkillPhase[]> = {
  start: ["discovery", "safety", "implementation"],
  implement: ["safety", "implementation"],
  verify: ["verification"],
  persist: ["persistence"],
  close: ["verification", "persistence", "maintenance"],
  resume: [...SKILL_PHASES],
};

function intentTags(intent: StructuredSkillIntent): string[] {
  return [...intent.domains, ...intent.actions, ...intent.artifacts, ...intent.needs, intent.risk];
}

function scoreEntry(skill: SkillEntry & RouteMetadata, intent: StructuredSkillIntent, task: string): { score: number; reasons: string[]; excluded: boolean } {
  const reasons: string[] = [];
  const tags = intentTags(intent);
  if (skill.negativeIntents.some((item) => tokenSet(tags).has(normalize(item)))) {
    return { score: -1000, reasons: ["negative intent matched"], excluded: true };
  }

  let score = 0;
  let matched = false;
  let anchorMatched = false;
  const taskText = normalize(task);
  const explicitNameMatched = taskText.includes(normalize(skill.name));
  if (explicitNameMatched) {
    score += 30;
    matched = true;
    anchorMatched = true;
    reasons.push("skill named explicitly");
  }
  const dimensions: Array<[string, string[], string[], number, boolean]> = [
    ["domain", skill.domains, intent.domains, 18, false], ["action", skill.actions, intent.actions, 12, false],
    ["artifact", skill.artifacts, intent.artifacts, 10, true], ["need", skill.needs, intent.needs, 16, true],
  ];
  for (const [label, left, right, weight, isAnchor] of dimensions) {
    const rightTokens = tokenSet(right);
    const count = left.filter((item) => rightTokens.has(normalize(item))).length;
    if (count) {
      matched = true;
      if (isAnchor) anchorMatched = true;
      score += count * weight;
      reasons.push(`${count} ${label} match(es)`);
    }
  }
  const broadArtifacts = new Set(["code", "game", "asset", "document", "spreadsheet", "presentation", "skill", "mcp"]);
  const broadNeeds = new Set(["safe-editing", "playtest", "visual-qa", "backup", "cross-agent", "human-approval"]);
  const intentSpecificArtifacts = intent.artifacts.filter((artifact) => !broadArtifacts.has(artifact));
  const skillSpecificArtifacts = skill.artifacts.filter((artifact) => !broadArtifacts.has(artifact));
  const intentSpecificNeeds = intent.needs.filter((need) => !broadNeeds.has(need));
  const skillSpecificNeeds = skill.needs.filter((need) => !broadNeeds.has(need));
  const specificArtifactMatched = skillSpecificArtifacts.some((artifact) => intentSpecificArtifacts.includes(artifact as StructuredSkillIntent["artifacts"][number]));
  const specificNeedMatched = skillSpecificNeeds.some((need) => intentSpecificNeeds.includes(need as StructuredSkillIntent["needs"][number]));
  const anyNeedMatched = skill.needs.some((need) => intent.needs.includes(need as StructuredSkillIntent["needs"][number]));
  const domainMatched = skill.domains.some((domain) => intent.domains.includes(domain as StructuredSkillIntent["domains"][number]));
  const intentHasAnchors = intent.artifacts.length > 0 || intent.needs.length > 0;
  if (!matched || (intentHasAnchors && !anchorMatched)) return { score: 0, reasons, excluded: false };
  if (skill.requireNeedMatch && !anyNeedMatched && !explicitNameMatched) {
    return { score: 0, reasons: [...reasons, "explicit need gate failed"], excluded: false };
  }
  if (skill.domains.length > 0 && !domainMatched) return { score: 0, reasons: [...reasons, "domain gate failed"], excluded: false };
  if (intentSpecificArtifacts.length > 0 && !specificArtifactMatched && !specificNeedMatched) {
    return { score: 0, reasons: [...reasons, "specific artifact/need gate failed"], excluded: false };
  }
  score += Math.round(skill.priority / 5);
  reasons.push(`priority ${skill.priority}`);
  return { score, reasons, excluded: false };
}

function inferredRequiredPhases(intent: StructuredSkillIntent, stage: SkillStage): SkillPhase[] {
  const phases = new Set<SkillPhase>();
  if (!intent.domains.includes("other")) phases.add("discovery");
  if (intent.risk !== "read-only") phases.add("safety");
  if (intent.actions.some((action) => ["design", "create", "edit"].includes(action))) phases.add("implementation");
  if (intent.risk !== "read-only" || intent.actions.some((action) => ["review", "test", "debug", "optimize", "analyze"].includes(action))) phases.add("verification");
  if (intent.actions.some((action) => ["save", "recover", "publish"].includes(action)) || intent.needs.some((need) => ["backup", "history-recovery"].includes(need))) phases.add("persistence");
  if (intent.domains.includes("roblox") && intent.risk !== "read-only") phases.add("persistence");
  if (stage === "close") phases.add("maintenance");
  return [...phases].sort((a, b) => (phaseOrder.get(a) ?? 0) - (phaseOrder.get(b) ?? 0));
}

function dependencyOrder(selected: RoutedSkill[], byName: Map<string, RoutedSkill>): { order: RoutedSkill[]; cycles: string[][] } {
  const output: RoutedSkill[] = [];
  const cycles: string[][] = [];
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (skill: RoutedSkill) => {
    const current = state.get(skill.name) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const index = stack.indexOf(skill.name);
      cycles.push([...stack.slice(Math.max(0, index)), skill.name]);
      return;
    }
    state.set(skill.name, 1);
    stack.push(skill.name);
    for (const dependency of skill.requires) {
      const target = byName.get(dependency);
      if (target) visit(target);
    }
    stack.pop();
    state.set(skill.name, 2);
    output.push(skill);
  };
  for (const skill of selected) visit(skill);
  return { order: output, cycles };
}

export async function planSkillRoute(args: {
  task: string;
  context?: string;
  skills: SkillEntry[];
  intent?: unknown;
  stage?: SkillStage;
  completedPhases?: SkillPhase[];
  maxSkills?: number;
}) {
  const stage = z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start");
  const completedPhases = z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []);
  const maxSkills = z.number().int().min(1).max(16).catch(8).parse(args.maxSkills ?? 8);
  const context = z.string().max(4_000).catch("").parse(args.context ?? "").trim();
  const routingText = [args.task, context].filter(Boolean).join("\n\nResolved conversation context:\n");
  const classificationMode = args.intent ? "structured-semantic" : "lexical-fallback";
  const intent = args.intent ? structuredSkillIntentSchema.parse(args.intent) : fallbackIntent(routingText);
  const registry = await buildSkillRoutingRegistry(args.skills);
  const byNameBase = new Map(registry.entries.map((skill) => [skill.name, skill]));
  const requiredBy = new Map<string, string[]>();
  const requiredPhases = new Set<SkillPhase>(inferredRequiredPhases(intent, stage));
  const matchedWorkflows = registry.workflows.filter((workflow) => conditionMatches(workflow.match, intent, stage));
  for (const workflow of matchedWorkflows) {
    for (const rule of workflow.phases) {
      if (!conditionMatches(rule.when, intent, stage)) continue;
      if (rule.required) requiredPhases.add(rule.phase);
      for (const skillName of rule.skills) {
        const reasons = requiredBy.get(skillName) ?? [];
        reasons.push(`workflow:${workflow.name}:${rule.phase}`);
        requiredBy.set(skillName, reasons);
      }
    }
  }

  const scored: RoutedSkill[] = [];
  for (const skill of registry.entries) {
    const result = scoreEntry(skill, intent, routingText);
    if (result.excluded) continue;
    const requiredReasons = requiredBy.get(skill.name) ?? [];
    if (result.score <= 0 && !requiredReasons.length && skill.activation !== "always") continue;
    if (skill.activation === "closing" && stage !== "close") continue;
    scored.push({ ...skill, score: result.score, reasons: result.reasons, required: requiredReasons.length > 0, requiredBy: requiredReasons });
  }

  const byName = new Map(scored.map((skill) => [skill.name, skill]));
  for (const [name, reasons] of requiredBy) {
    if (byName.has(name)) continue;
    const base = byNameBase.get(name);
    if (base) {
      const routed: RoutedSkill = { ...base, score: 100, reasons: ["required by workflow"], required: true, requiredBy: reasons };
      scored.push(routed);
      byName.set(name, routed);
    }
  }

  scored.sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score || (phaseOrder.get(a.phase ?? "implementation") ?? 0) - (phaseOrder.get(b.phase ?? "implementation") ?? 0) || a.name.localeCompare(b.name));
  const requiredSelected = scored.filter((skill) => skill.required);
  const optionalSelected = scored.filter((skill) => !skill.required).slice(0, maxSkills);
  const selected: RoutedSkill[] = [...requiredSelected, ...optionalSelected];
  const rootSelectedNames = new Set(selected.map((skill) => skill.name));
  const selectedNames = new Set(rootSelectedNames);

  const dependencyQueue = [...selected];
  while (dependencyQueue.length > 0) {
    const skill = dependencyQueue.shift()!;
    for (const dependencyName of skill.requires) {
      if (selectedNames.has(dependencyName)) continue;
      let dependency = byName.get(dependencyName);
      if (!dependency) {
        const base = byNameBase.get(dependencyName);
        if (!base) continue;
        dependency = {
          ...base,
          score: 0,
          reasons: [`dependency of ${skill.name}`],
          required: true,
          requiredBy: [`dependency:${skill.name}`],
        };
        byName.set(dependencyName, dependency);
      }
      selected.push(dependency);
      selectedNames.add(dependencyName);
      dependencyQueue.push(dependency);
    }
  }

  const conflictWarnings: string[] = [];
  for (const skill of selected) {
    for (const excluded of skill.excludes) if (selectedNames.has(excluded)) conflictWarnings.push(`${skill.name} excludes ${excluded}`);
  }

  const ordered = dependencyOrder(selected, byName);
  const activePhases = new Set(stagePhases[stage].filter((phase) => !completedPhases.includes(phase)));
  const activeNames = new Set(ordered.order
    .filter((skill) => rootSelectedNames.has(skill.name) && activePhases.has(skill.phase ?? "implementation"))
    .map((skill) => skill.name));
  const addActiveDependencies = (skillName: string) => {
    const skill = byName.get(skillName);
    if (!skill) return;
    for (const dependencyName of skill.requires) {
      if (!activeNames.has(dependencyName)) {
        activeNames.add(dependencyName);
        addActiveDependencies(dependencyName);
      }
    }
  };
  for (const skillName of [...activeNames]) addActiveDependencies(skillName);
  const activeSkills = ordered.order.filter((skill) => activeNames.has(skill.name));
  const deferredSkills = ordered.order.filter((skill) => !activeNames.has(skill.name));

  const phasePlan = SKILL_PHASES.map((phase) => {
    const skills = ordered.order.filter((skill) => (skill.phase ?? "implementation") === phase);
    const required = requiredPhases.has(phase);
    const status = completedPhases.includes(phase) ? "completed" : activePhases.has(phase) ? "active" : required ? "pending" : skills.length ? "optional" : "not-required";
    return { phase, required, status, skills: skills.map((skill) => ({ name: skill.name, source: skill.source, score: skill.score, required: skill.required, reasons: [...skill.requiredBy, ...skill.reasons] })) };
  });

  const coveredPhases = new Set(ordered.order.map((skill) => skill.phase ?? "implementation"));
  const missingRequiredPhases = [...requiredPhases].filter((phase) => !completedPhases.includes(phase) && !coveredPhases.has(phase));
  const inferredActiveWarnings = activeSkills
    .filter((skill) => skill.routingMetadataSource === "inferred")
    .map((skill) => `Active skill '${skill.name}' is using inferred routing metadata; run skill_route_audit and add an explicit entry if this is a durable workflow.`);
  return {
    task: args.task,
    contextUsed: context.length > 0,
    contextCharacters: context.length,
    contextSummary: context || undefined,
    contextPolicy: "bounded-resolved-summary",
    selectionPolicy: {
      required: "Apply workflow-required skills and transitive dependencies unless a higher-priority safety rule or unavailable capability makes them impossible; report any skip explicitly.",
      optional: "The agent may skip an optional active skill when it is clearly irrelevant or impractical for the current phase; keep the reason concise and continue with the smallest sufficient set.",
      deferred: "Do not load deferred skills until their workflow phase becomes active.",
    },
    classificationMode,
    intent,
    stage,
    registry: {
      canonicalSkills: registry.entries.length,
      duplicateNames: registry.duplicates.length,
      routingConfigPath: registry.configPath,
      routingFixturesPath: registry.fixturesPath,
      liveRescan: true,
    },
    workflows: matchedWorkflows.map((workflow) => workflow.name),
    phasePlan,
    activeSkills,
    deferredSkills,
    loadOrder: activeSkills.map((skill) => skill.name),
    deferredLoadOrder: deferredSkills.map((skill) => skill.name),
    coverage: {
      requiredPhases: [...requiredPhases].sort((a, b) => (phaseOrder.get(a) ?? 0) - (phaseOrder.get(b) ?? 0)),
      completedPhases,
      activePhases: [...activePhases],
      missingRequiredPhases,
    },
    warnings: [...registry.warnings, ...conflictWarnings, ...inferredActiveWarnings, ...ordered.cycles.map((cycle) => `Skill dependency cycle: ${cycle.join(" -> ")}`)],
    activationInstruction: classificationMode === "structured-semantic"
      ? "Use loadOrder for the current phase. Re-plan at verification, persistence, or close instead of loading every deferred skill now."
      : "This plan used lexical fallback. Before mutations, the agent should infer and resubmit a structured intent object when possible.",
  };
}
