import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { assertPathAllowed } from "./shared/path.js";
import {
  callRobloxMcpTool,
  callRobloxMcpToolForStudio,
  inspectRobloxMcpTools,
  inspectRobloxStudioState,
  parseRobloxStudios,
  robloxMcpConnectionStatus,
  type RobloxMcpTool,
  type RobloxMcpToolCatalogHealth,
} from "../integrations/roblox-mcp-client.js";
import {
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_CALLERS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_PHASES,
  SKILL_RISKS,
  SKILL_SIGNALS,
  SKILL_STAGES,
  auditSkillRouting,
  canonicalizeSkillEntries,
  planSkillRoute,
  structuredSkillIntentSchema,
  type SkillEntry,
  type SkillSource,
} from "./skill-routing.js";
import {
  planCodexSkillContexts,
  type SkillContextMode,
  type SkillReferenceMode,
} from "../skill-context-assembler.js";
import {
  recordMssrRoute,
  recordMssrSkillLoad,
  resolveMssrTraceId,
} from "../mssr-observatory.js";
import { requireWorkflowKey } from "../runtime-identity.js";
import { buildMssrSystemAwareness } from "../mssr-system-awareness.js";

const MAX_SKILL_FILE_CHARS = 160_000;
const MAX_DISCOVERED_SKILLS = 600;
const routeResponseModes = ["compact", "debug"] as const;
const reasoningEfforts = ["low", "medium", "high", "xhigh", "max", "ultra", "unknown"] as const;

function agentProfile(args: Record<string, unknown>): Record<string, string> {
  return {
    model: z.string().trim().min(1).max(80).catch("unknown").parse(args.model ?? "unknown"),
    reasoningEffort: z.enum(reasoningEfforts).catch("unknown").parse(args.reasoningEffort ?? "unknown"),
  };
}

function compactRoutedSkill(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const skill = value as Record<string, unknown>;
  const reasons = [
    ...(Array.isArray(skill.requiredBy) ? skill.requiredBy : []),
    ...(Array.isArray(skill.reasons) ? skill.reasons : []),
  ].filter((item): item is string => typeof item === "string");
  return {
    name: skill.name,
    source: skill.source,
    phase: skill.phase,
    required: skill.required === true,
    reason: reasons.slice(0, 2).join("; "),
  };
}

function compactSkillRoute<T extends Record<string, unknown>>(route: T): Record<string, unknown> {
  const compactSkills = (value: unknown) => Array.isArray(value)
    ? value.map(compactRoutedSkill).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return {
    responseMode: "compact",
    traceId: route.traceId,
    workflowKey: route.workflowKey,
    stage: route.stage,
    caller: route.caller,
    agentProfile: route.agentProfile,
    classificationMode: route.classificationMode,
    contextUsed: route.contextUsed,
    contextCharacters: route.contextCharacters,
    classifier: route.classifier,
    semanticSignals: route.semanticSignals,
    intent: route.intent,
    workflows: route.workflows,
    activeSkills: compactSkills(route.activeSkills),
    deferredSkills: compactSkills(route.deferredSkills),
    matches: compactSkills(route.matches),
    loadOrder: route.loadOrder,
    deferredLoadOrder: route.deferredLoadOrder,
    selectionBudget: route.selectionBudget,
    coverage: route.coverage,
    selectionPolicy: route.selectionPolicy,
    executionGuidance: route.executionGuidance,
    nextAction: route.nextAction,
    warnings: route.warnings,
    activationInstruction: route.activationInstruction,
    sourceHealth: route.sourceHealth,
    systemAwareness: route.systemAwareness,
    __bridgeNotices: route.__bridgeNotices,
  };
}

function codexHome(): string {
  return path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return trimmed;
}

function frontmatterValue(text: string, key: string): string {
  if (!text.startsWith("---")) return "";
  const end = text.indexOf("\n---", 3);
  if (end < 0) return "";
  const block = text.slice(3, end);
  const lines = block.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const prefix = `${key.toLowerCase()}:`;
    const line = lines[index];
    if (!line.toLowerCase().startsWith(prefix)) continue;
    const initial = line.slice(prefix.length).trim();
    if (initial === ">" || initial === ">-" || initial === "|" || initial === "|-") {
      const collected: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (!/^\s+/.test(lines[cursor])) break;
        collected.push(lines[cursor].trim());
      }
      return collected.join(initial.startsWith("|") ? "\n" : " ").trim();
    }
    return unquote(initial);
  }
  return "";
}

async function readSkillEntry(skillPath: string, source: SkillSource, origin?: string): Promise<SkillEntry | null> {
  try {
    const stat = await fs.stat(skillPath);
    if (!stat.isFile() || stat.size > MAX_SKILL_FILE_CHARS * 4) return null;
    const text = await fs.readFile(skillPath, "utf8");
    const name = frontmatterValue(text, "name") || path.basename(path.dirname(skillPath));
    const description = frontmatterValue(text, "description");
    if (!name) return null;
    return { name, description, source, path: skillPath, origin };
  } catch {
    return null;
  }
}

type SkillWalkResult = { skills: SkillEntry[]; warnings: string[] };

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function walkSkillFiles(root: string, source: SkillSource, maxDepth: number, origin?: string): Promise<SkillWalkResult> {
  if (!(await pathExists(root))) return { skills: [], warnings: [] };
  const results: SkillEntry[] = [];
  const warnings: string[] = [];
  const visitedDirectories = new Set<string>();
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.realpath(root);
  } catch (error) {
    return { skills: [], warnings: [`Skill root unavailable (${origin ?? source}): ${root}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || results.length >= MAX_DISCOVERED_SKILLS) return;
    let realDirectory: string;
    let entries: Dirent[];
    try {
      realDirectory = await fs.realpath(directory);
      // Plugin packages are managed runtime inputs. Permit read-only discovery only
      // while the resolved directory remains inside the exact plugin cache root;
      // do not broaden the Bridge's general filesystem policy to all of .codex.
      if (source === "codex-plugin") {
        if (!isWithinRoot(canonicalRoot, realDirectory)) throw new Error(`plugin directory resolves outside cache root: ${realDirectory}`);
      } else {
        assertPathAllowed(realDirectory, "read");
      }
      const visitKey = process.platform === "win32" ? realDirectory.toLowerCase() : realDirectory;
      if (visitedDirectories.has(visitKey)) return;
      visitedDirectories.add(visitKey);
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (depth === 0) warnings.push(`Skill root unreadable (${origin ?? source}): ${root}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_DISCOVERED_SKILLS) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        const skill = await readSkillEntry(fullPath, source, origin);
        if (skill) results.push(skill);
        continue;
      }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        const target = await fs.stat(fullPath);
        if (target.isDirectory()) await walk(fullPath, depth + 1);
      } catch {
        // Broken or disallowed links are ignored during discovery.
      }
    }
  };
  await walk(root, 0);
  return { skills: results, warnings };
}

async function discoverCodexSkills(): Promise<{ skills: SkillEntry[]; warnings: string[] }> {
  const home = codexHome();
  const normalRoot = path.join(home, "skills");
  const normal = await walkSkillFiles(normalRoot, "codex-local", 5, "Codex skills directory");
  for (const skill of normal.skills) {
    const normalized = skill.path?.split(path.sep).map((part) => part.toLowerCase()) ?? [];
    if (normalized.includes(".system")) skill.source = "codex-system";
  }
  const pluginRoot = path.join(home, "plugins", "cache");
  const plugins = await walkSkillFiles(pluginRoot, "codex-plugin", 8, "Codex plugin cache");
  return { skills: [...normal.skills, ...plugins.skills], warnings: [...normal.warnings, ...plugins.warnings] };
}

function parseRobloxSkills(tool: RobloxMcpTool | undefined): SkillEntry[] {
  const description = tool?.description ?? "";
  const regex = /<skill>\s*<name>([\s\S]*?)<\/name>\s*<source>([\s\S]*?)<\/source>\s*<description>([\s\S]*?)<\/description>\s*<\/skill>/gi;
  const skills: SkillEntry[] = [];
  for (const match of description.matchAll(regex)) {
    skills.push({
      name: match[1].trim(),
      description: match[3].trim(),
      source: "roblox",
      origin: match[2].trim() || "Roblox Studio MCP",
    });
  }
  return skills;
}

type SkillSourceHealth = {
  codex: {
    status: "healthy" | "degraded";
    skillCount: number;
    warningCount: number;
  };
  roblox?: {
    status: RobloxMcpToolCatalogHealth["status"];
    liveToolCount: number;
    effectiveToolCount: number;
    skillCount: number;
    usingCachedTools: boolean;
    warning?: string;
  };
};

function robloxHealthSummary(health: RobloxMcpToolCatalogHealth, skillCount: number): NonNullable<SkillSourceHealth["roblox"]> {
  return {
    status: health.status,
    liveToolCount: health.liveToolCount,
    effectiveToolCount: health.effectiveToolCount,
    skillCount,
    usingCachedTools: health.usingCachedTools,
    warning: health.warning,
  };
}

async function discoverRobloxSkills(): Promise<{ skills: SkillEntry[]; health: RobloxMcpToolCatalogHealth }> {
  const health = await inspectRobloxMcpTools();
  const skills = parseRobloxSkills(health.tools.find((tool) => tool.name === "skill"));
  return { skills, health };
}

async function discoverAllSkills(includeRoblox = true): Promise<{ skills: SkillEntry[]; warnings: string[]; sourceHealth: SkillSourceHealth }> {
  const warnings: string[] = [];
  const codex = await discoverCodexSkills();
  warnings.push(...codex.warnings);
  let roblox: SkillEntry[] = [];
  const sourceHealth: SkillSourceHealth = {
    codex: {
      status: codex.warnings.length > 0 ? "degraded" : "healthy",
      skillCount: codex.skills.length,
      warningCount: codex.warnings.length,
    },
  };
  if (includeRoblox) {
    try {
      const discovered = await discoverRobloxSkills();
      roblox = discovered.skills;
      sourceHealth.roblox = robloxHealthSummary(discovered.health, roblox.length);
      if (discovered.health.warning) warnings.push(discovered.health.warning);
    } catch (error) {
      const warning = `Roblox MCP skills unavailable: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      sourceHealth.roblox = {
        status: "unavailable",
        liveToolCount: 0,
        effectiveToolCount: 0,
        skillCount: 0,
        usingCachedTools: false,
        warning,
      };
    }
  }
  return { skills: [...codex.skills, ...roblox], warnings, sourceHealth };
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length >= 2));
}

function skillScore(task: string, skill: SkillEntry): { score: number; reasons: string[] } {
  const taskText = normalize(task);
  const taskTokens = tokens(task);
  const nameText = normalize(skill.name);
  const descriptionText = normalize(skill.description);
  let score = 0;
  const reasons: string[] = [];
  if (nameText && taskText.includes(nameText)) {
    score += 10;
    reasons.push("name appears in task");
  }
  const nameTokens = [...tokens(skill.name)];
  const nameOverlap = nameTokens.filter((token) => taskTokens.has(token)).length;
  if (nameOverlap) {
    score += nameOverlap * 3;
    reasons.push(`${nameOverlap} name token(s) matched`);
  }
  const descriptionTokens = [...tokens(skill.description)];
  const descriptionOverlap = descriptionTokens.filter((token) => taskTokens.has(token)).length;
  if (descriptionOverlap) {
    score += Math.min(8, descriptionOverlap);
    reasons.push(`${descriptionOverlap} description token(s) matched`);
  }
  const localIntentPatterns: Record<string, RegExp> = {
    "roblox-connection-network-authoring": /conexion|conectar|conectable|cable|puerto|socket|tuberia|pipe|beam|link|enlace|grafo|network|red de nodos/,
    "roblox-placement-system-authoring": /placement|colocar|colocacion|construir|fantasma|ghost|snap|rotar|rotacion|superficie|footprint|preview de objeto/,
    "roblox-resource-network-test": /recurso|resource|produccion|productor|consumo|consumidor|almacen|storage|transportar|distribuir|flujo|logistica|nutriente|energia|power grid/,
    "roblox-save-backup-recovery": /guardar|guardado|save|ctrl s|backup|respaldo|copia segura|recuperar|recovery|autosave|persistir|rollback/,
    "mauroprime-bridge-collaboration": /mauroprime|bridge|codex.*chatgpt|chatgpt.*codex|coordinar agentes|historial de codex|sesion de codex|migracion de proyecto|mover proyecto|project root migration/,
    "shared-skill-governance": /crear skill|actualizar skill|mejorar skill|generalizar skill|skills compartidas|skill bootstrap|gobernanza de skills|catalogo de skills/,
    "skill-maintenance-loop": /cerrar.{0,40}iteracion|iteracion.{0,60}(?:friccion|incidente|error|bug)|registrar.{0,40}(?:incidente|friccion|bug)|(?:incidente|friccion|bug).{0,40}(?:skill|routing|tool|lifecycle)|mantenimiento.{0,30}(?:skill|capacidad)|skill gap|repeated friction|manual workaround|lifecycle defect/,
  };
  const localPattern = localIntentPatterns[skill.name];
  if (localPattern?.test(taskText)) {
    score += 10;
    reasons.push("shared/local skill intent matched");
  }

  const narrowSkillRequirements: Record<string, RegExp> = {
    "roblox-animation-frame-review": /animacion|animation|frame|keyframe|pose|rig/,
    "roblox-asset-review": /asset|modelo|model|audio|decal|mesh|creator store|inventario/,
    "roblox-locomotion-camera-review": /caminar|correr|sprint|dash|locomotion|walk|run|camera|camara/,
    "roblox-model-turnaround-review": /turnaround|frente|espalda|costado|silueta|proporcion|modelo 3d/,
    "roblox-placement-ui-review": /placement|colocar|colocacion|ghost|fantasma|cursor|hud|rotar|snap|preview/,
    "roblox-technique-animation-authoring": /tecnica|technique|ability|habilidad|keyframe|r6|r15|cooldown/,
    "roblox-ui-ux": /\bui\b|ux|interfaz|hud|screen ?gui|surface ?gui|billboard ?gui|icono|layout|responsive/,
  };
  const requiredPattern = narrowSkillRequirements[skill.name];
  if (requiredPattern && !requiredPattern.test(taskText)) {
    score -= 8;
    reasons.push("narrow skill excluded because its core intent is absent");
  }

  if (skill.source === "roblox") {
    const intentPatterns: Record<string, RegExp> = {
      "rbx-create-skill": /(?:crear|crea|editar|actualizar|renombrar|author|modify|update|rename).{0,40}(?:skill|habilidad)|(?:skill|habilidad).{0,40}(?:crear|crea|editar|actualizar|renombrar|author|modify|update|rename)/,
      "rbx-device-simulator-lua": /device|dispositivo|movil|mobile|tablet|orientation|orientacion|responsive|form factor|simulador/,
      "rbx-docs-search": /documentacion|documentation|docs|api|referencia|reference|como se usa|how to/,
      "rbx-perf-profiling": /performance|rendimiento|microprofiler|profil|fps|cpu|gpu|frame time|alloc|cuello de botella/,
      "rbx-scene-analysis": /scene analysis|analisis de escena|memoria|memory|leak|fuga|render|instancias|unparented|audio assets|animation assets/,
      "rbx-unit-test": /unit test|prueba unitaria|pruebas unitarias|test coverage|cobertura|module ?script.*test|test.*module ?script/,
    };
    const pattern = intentPatterns[skill.name];
    if (pattern?.test(taskText)) {
      score += 8;
      reasons.push("Roblox skill intent matched");
    }
    if (skill.name === "rbx-unit-test" && !pattern?.test(taskText) && /playtest|jugar|gameplay|visual|ui|probar/.test(taskText)) {
      score -= 8;
      reasons.push("unit tests excluded for ordinary playtest/visual QA");
    }
  }
  if (descriptionText && taskText.includes(descriptionText)) score += 4;
  return { score, reasons };
}

export async function findExistingSkillCoverage(task: string, maxResults = 5) {
  const discovered = await discoverCodexSkills();
  const ranked = canonicalizeSkillEntries(discovered.skills).entries
    .map((skill) => ({ ...skill, ...skillScore(task, skill) }))
    .filter((skill) => skill.score >= 12)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(maxResults, 20)));
  return {
    covered: ranked.length > 0,
    threshold: 12,
    matches: ranked,
    warnings: discovered.warnings,
  };
}

function sourceFilter(value: unknown): SkillSource[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const allowed = new Set<SkillSource>(["codex-local", "codex-system", "codex-plugin", "roblox"]);
  return value.filter((item): item is SkillSource => typeof item === "string" && allowed.has(item as SkillSource));
}

function remoteToolByName(tools: RobloxMcpTool[], name: string): RobloxMcpTool {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Roblox MCP tool not found: ${name}`);
  return tool;
}

async function requireLiveRemoteTool(name: string): Promise<RobloxMcpTool> {
  const health = await inspectRobloxMcpTools();
  if (health.status !== "healthy") {
    throw new Error(`Roblox MCP live tool catalog is ${health.status}; cached schemas cannot authorize or dispatch '${name}'. Refresh roblox_mcp_status after Studio recovers.`);
  }
  return remoteToolByName(health.tools, name);
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be a JSON object.");
  return value as Record<string, unknown>;
}

async function loadCodexSkill(entry: SkillEntry) {
  if (!entry.path) throw new Error(`Codex skill has no readable path: ${entry.name}`);
  const text = await fs.readFile(entry.path, "utf8");
  if (text.length > MAX_SKILL_FILE_CHARS) throw new Error(`Skill exceeds ${MAX_SKILL_FILE_CHARS} characters: ${entry.path}`);
  return {
    skill: entry,
    loaded: true,
    activationInstruction: "Treat the returned SKILL.md as active procedural guidance for the current task. Apply it together with higher-priority safety and project instructions.",
    content: text,
  };
}

const structuredIntentInputSchema = {
  type: "object",
  description: "Compact semantic classification inferred by the agent from the user's request. This is not chain-of-thought; provide only the structured outcome. Always declare at least one signal; use nominal only when no anomaly, doubt, friction, gap, or reusable pattern is present.",
  properties: {
    summary: { type: "string", maxLength: 600 },
    domains: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", enum: [...SKILL_DOMAINS] } },
    actions: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", enum: [...SKILL_ACTIONS] } },
    artifacts: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_ARTIFACTS] }, default: [] },
    needs: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_NEEDS] }, default: [] },
    signals: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", enum: [...SKILL_SIGNALS] }, default: ["nominal"], description: "Observable semantic conditions used to route verification, recovery, maintenance, and skill creation. Do not combine nominal with non-nominal signals." },
    risk: { type: "string", enum: [...SKILL_RISKS], default: "read-only" },
    ambiguity: { type: "string", enum: ["low", "medium", "high"], default: "low" },
  },
  required: ["domains", "actions", "signals"],
  additionalProperties: false,
} as const;

export const skillCatalogToolModule: BridgeToolModule = {
  name: "skill-catalog-and-roblox-proxy",
  tools: [
    {
      name: "skill_catalog",
      description: "List the unified skill catalog available to Mauro's workflow: local/system/plugin Codex SKILL.md files plus the Roblox-authored skills exposed by Roblox Studio MCP. Returns per-source health and warns when a requested live source is degraded. Use when the user asks what skills exist, when resuming a specialized workflow, or when you need to discover whether a reusable procedure applies.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional name/description filter." },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxResults: { type: "number", default: 100, minimum: 1, maximum: 600 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "skill_recommend",
      description: "Compatibility entrypoint for MSSR routing. Prefer a compact structured intent for substantial specialized work; when omitted, the result is explicitly marked lexical-fallback. Returns a phase-scoped route, ordered matches, a traceId, and source health so the same trace can be carried into skill_load, verification, persistence, and outcome checkpoints.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user request or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved continuation context, never a full transcript or hidden reasoning." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other" },
          model: { type: "string", maxLength: 80, description: "Observable host-reported model identifier, for example gpt-5.6-terra or gpt-5.6-sol. Use unknown when the host cannot prove it." },
          reasoningEffort: { type: "string", enum: reasoningEfforts, default: "unknown", description: "Observable host-reported reasoning effort. Never infer it from latency or answer length." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxResults: { type: "number", default: 8, minimum: 1, maximum: 16 },
          responseMode: { type: "string", enum: routeResponseModes, default: "compact", description: "compact returns the actionable phase route; debug includes full scores, metadata and phase diagnostics." },
          workflowKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$", description: "Optional stable workflow id shared by related traces, for example mauroprime-system-loop. It is local observability metadata, not a ChatGPT conversation id." },
          traceId: { type: "string", description: "Optional existing MSSR trace id for a replan. A new id is generated when omitted." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "skill_route_audit",
      description: "Audit the live skill catalog against the Git-tracked routing contract. Detect unconfigured owned skills, stale config entries, missing dependencies/workflow references, cycles, unreadable or oversized skills, duplicates, and inferred routing that needs review. Run after adding, renaming, deleting, or materially changing a skill, and as a required verification gate before committing routing changes.",
      inputSchema: {
        type: "object",
        properties: {
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
        },
        additionalProperties: false,
      },
    },
    {
      name: "skill_route_vocabulary",
      description: "Return the canonical closed MSSR vocabulary for structured intent and workflow phase fields. Use before writing routing metadata or fixtures so domains, actions, artifacts, needs, signals, risks, stages, phases, and callers are validated before the full routing suite.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "skill_route_plan",
      description: "Plan skill activation before substantial specialized work. The agent should first infer a compact structured intent from the user's request, including explicit semantic signals, even when the wording is incomplete, then call this tool. Use signal nominal only when no error, warning, uncertainty, friction, recovery need, capability gap, or reusable pattern is present. It deterministically applies routing metadata, dependencies, exclusions, workflow phases, source precedence, and completed-phase coverage. For Roblox routes, the response also includes a short-lived systemAwareness snapshot of Bridge, Roblox MCP catalog, connected Studios, active target and Edit/Play mode, with deduplicated notices only for actionable states. It does not expose or require chain-of-thought.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other", description: "Client executing the route. Use codex-local when direct shell/filesystem tools exist, chatgpt-web when local access is mediated by Bridge, or other when unknown." },
          model: { type: "string", maxLength: 80, description: "Observable host-reported model identifier, for example gpt-5.6-terra or gpt-5.6-sol. Use unknown when the host cannot prove it." },
          reasoningEffort: { type: "string", enum: reasoningEfforts, default: "unknown", description: "Observable host-reported reasoning effort. Never infer it from latency or answer length." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxSkills: { type: "number", default: 8, minimum: 1, maximum: 16 },
          responseMode: { type: "string", enum: routeResponseModes, default: "compact", description: "compact returns the actionable phase route; debug includes full scores, metadata and phase diagnostics." },
          workflowKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$", description: "Optional stable workflow id shared by related traces, for example mauroprime-system-loop. It is local observability metadata, not a ChatGPT conversation id." },
          traceId: { type: "string", description: "Optional existing MSSR trace id for a replan. A new id is generated when omitted." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "skill_bootstrap",
      description: "Load the current phase of a structured skill route. By default it globally plans selective Codex context from context-modules.json manifests: reserve every required skill core first, then required modules, globally rank optional modules, and admit optional skill packages only when they fit. Skills without manifests fall back to the full SKILL.md for compatibility; contentMode=full preserves the explicit legacy/debug path. The response reports savings, skips, overflow, duplicate avoidance, and allocation tiers. For Roblox routes it also returns a cached-at-most-five-seconds systemAwareness snapshot and delivers deduplicated recovery notices when the target, catalog, or Studio state needs attention. Deferred skills remain metadata-only.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other", description: "Client executing the route. Use codex-local when direct shell/filesystem tools exist, chatgpt-web when local access is mediated by Bridge, or other when unknown." },
          model: { type: "string", maxLength: 80, description: "Observable host-reported model identifier, for example gpt-5.6-terra or gpt-5.6-sol. Use unknown when the host cannot prove it." },
          reasoningEffort: { type: "string", enum: reasoningEfforts, default: "unknown", description: "Observable host-reported reasoning effort. Never infer it from latency or answer length." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxSkills: { type: "number", default: 8, minimum: 1, maximum: 16 },
          contentMode: { type: "string", enum: ["selective", "full"], default: "selective", description: "Use selective to assemble manifest-guided core/modules. Use full only for explicit diagnosis, compatibility comparison, or recovery." },
          includeReferences: { type: "string", enum: ["auto", "none"], default: "auto", description: "Auto selects matching manifest modules. None loads only the declared core while preserving routing." },
          maxContextChars: { type: "number", default: 24000, minimum: 4000, maximum: 100000, description: "Global character budget for assembled Codex skill context. Required cores are never silently truncated; budget overflow is reported." },
          workflowKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$", description: "Optional stable workflow id shared by related traces, for example mauroprime-system-loop. It is local observability metadata, not a ChatGPT conversation id." },
          traceId: { type: "string", description: "Optional existing MSSR trace id for a replan. A new id is generated when omitted." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "skill_load",
      description: "Load one skill as active guidance and record the load in the MSSR trace. Pass the traceId returned by routing whenever available. For Codex skills this reads the exact SKILL.md; for Roblox-authored skills this invokes the live Roblox Studio MCP skill tool.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          source: { type: "string", enum: ["auto", "codex", "roblox"], default: "auto" },
          traceId: { type: "string", description: "Trace id returned by skill_recommend, skill_route_plan, or skill_bootstrap. Omission creates an observable orphan-load trace." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          required: { type: "boolean", default: false, description: "Whether the route marked this skill required." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_status",
      description: "Check process, Studio, and live tool-catalog health for the persistent Bridge-to-Roblox Studio MCP connection. Distinguishes healthy, degraded with last-known schemas, and unavailable states. Use before Roblox edits or when the MCP appears disconnected or stale.",
      inputSchema: {
        type: "object",
        properties: {
          refresh: { type: "boolean", default: false, description: "Bypass the short health cache and retry tools/list once with a fresh StudioMCP child connection when needed." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_tool_list",
      description: "List tools exposed by Roblox Studio MCP, including schemas and source health. When live tools/list is empty, retries once and may return explicitly marked last-known schemas instead of silently appearing healthy. Use when a Roblox capability may exist but is not represented by a dedicated Bridge tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional name/description filter." },
          includeSchemas: { type: "boolean", default: true },
          refresh: { type: "boolean", default: false, description: "Bypass the short health cache and perform a fresh bounded tools/list probe." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_studio_list",
      description: "List every Roblox Studio instance visible to the Bridge-owned StudioMCP connection, including stable instance ids and the active target. Use before proxied calls when more than one Studio window may be open.",
      inputSchema: {
        type: "object",
        properties: {
          refresh: { type: "boolean", default: false, description: "Require a fresh healthy tool-catalog probe before listing Studio instances." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_query",
      description: "Call a live Roblox Studio MCP tool only when its current live annotation marks it read-only. Optionally pins the call atomically to studioId so concurrent ChatGPT/Codex sessions cannot redirect it between selection and execution. Cached schemas are never used to authorize dispatch.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          arguments: { type: "object", additionalProperties: true, default: {} },
          studioId: { type: "string", description: "Optional exact id from roblox_mcp_studio_list. Recommended whenever multiple Studio instances are open." },
        },
        required: ["toolName"],
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_action",
      description: "Call a live non-read-only Roblox Studio MCP tool through the Bridge. Requires current live schema authorization and exact tool-name confirmation. If multiple Studio instances exist, studioId is mandatory; selection and execution are serialized atomically across Bridge clients.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          confirmToolName: { type: "string" },
          arguments: { type: "object", additionalProperties: true, default: {} },
          studioId: { type: "string", description: "Exact id from roblox_mcp_studio_list. Required when multiple Studio instances are connected." },
        },
        required: ["toolName", "confirmToolName"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    skill_catalog: async (args) => {
      const selectedSources = sourceFilter(args.sources);
      const discovered = await discoverAllSkills(!selectedSources || selectedSources.includes("roblox"));
      const query = typeof args.query === "string" ? normalize(args.query) : "";
      const maxResults = z.number().int().min(1).max(600).catch(100).parse(args.maxResults ?? 100);
      const filtered = discovered.skills
        .filter((skill) => !selectedSources || selectedSources.includes(skill.source))
        .filter((skill) => !query || normalize(`${skill.name} ${skill.description} ${skill.source}`).includes(query))
        .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
        .slice(0, maxResults);
      return { count: filtered.length, skills: filtered, sourceHealth: discovered.sourceHealth, warnings: discovered.warnings };
    },
    skill_recommend: async (args) => {
      const task = z.string().min(1).parse(args.task);
      const selectedSources = sourceFilter(args.sources);
      const maxResults = z.number().int().min(1).max(16).catch(8).parse(args.maxResults ?? 8);
      const responseMode = z.enum(routeResponseModes).catch("compact").parse(args.responseMode ?? "compact");
      const discovered = await discoverAllSkills(!selectedSources || selectedSources.includes("roblox"));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const route = await planSkillRoute({
        task,
        context: z.string().max(4_000).catch("").parse(args.context ?? ""),
        skills,
        intent: args.intent,
        caller: z.enum(SKILL_CALLERS).catch("other").parse(args.caller ?? "other"),
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: maxResults,
      });
      const traceId = resolveMssrTraceId(args.traceId);
      const profile = agentProfile(args);
      const workflowKey = requireWorkflowKey(args.workflowKey);
      const observedRoute = { ...route, agentProfile: profile, workflowKey: workflowKey ?? null };
      recordMssrRoute({ traceId, action: "recommend", task, route: observedRoute as unknown as Record<string, unknown> });
      const matches = [...route.activeSkills, ...route.deferredSkills]
        .filter((skill, index, all) => all.findIndex((candidate) => candidate.name === skill.name) === index)
        .slice(0, maxResults);
      const response = {
        ...observedRoute,
        traceId,
        matches,
        sourceHealth: discovered.sourceHealth,
        warnings: [...discovered.warnings, ...route.warnings],
        activationInstruction: route.classificationMode === "structured-semantic"
          ? "Use loadOrder for the active phase. Bridge automatically propagates traceId in-session and across stateless calls only when one compatible process-shared trace exists; provide it explicitly after restart, for ambiguous candidates, or deliberate trace selection. Re-plan after a stage change, material failure, new capability need, or verification/persistence boundary."
          : "This recommendation used lexical fallback. Before mutations, infer a compact structured intent and call skill_recommend or skill_route_plan again; Bridge will retain or uniquely recover the active trace when safe.",
      };
      return responseMode === "debug" ? { ...response, responseMode } : compactSkillRoute(response);
    },
    skill_route_audit: async (args) => {
      const selectedSources = sourceFilter(args.sources);
      const discovered = await discoverAllSkills(!selectedSources || selectedSources.includes("roblox"));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const audit = await auditSkillRouting(skills);
      const robloxDegraded = Boolean(
        (!selectedSources || selectedSources.includes("roblox"))
        && discovered.sourceHealth.roblox
        && discovered.sourceHealth.roblox.status !== "healthy",
      );
      const sourceMaintenanceReasons = robloxDegraded
        ? [discovered.sourceHealth.roblox?.warning ?? "Roblox MCP source is degraded."]
        : [];
      return {
        ...audit,
        ok: audit.ok && discovered.warnings.length === 0,
        maintenanceRequired: audit.maintenanceRequired || sourceMaintenanceReasons.length > 0,
        errors: [...discovered.warnings, ...audit.errors],
        maintenanceReasons: [...audit.maintenanceReasons, ...sourceMaintenanceReasons],
        sourceHealth: discovered.sourceHealth,
      };
    },
    skill_route_vocabulary: async () => ({
      schemaVersion: 1,
      domains: [...SKILL_DOMAINS],
      actions: [...SKILL_ACTIONS],
      artifacts: [...SKILL_ARTIFACTS],
      needs: [...SKILL_NEEDS],
      signals: [...SKILL_SIGNALS],
      risks: [...SKILL_RISKS],
      stages: [...SKILL_STAGES],
      phases: [...SKILL_PHASES],
      callers: [...SKILL_CALLERS],
      note: "These values are closed vocabulary. Reuse them exactly in structured intents and routing fixtures.",
    }),
    skill_route_plan: async (args) => {
      const task = z.string().min(1).parse(args.task);
      const selectedSources = sourceFilter(args.sources);
      const responseMode = z.enum(routeResponseModes).catch("compact").parse(args.responseMode ?? "compact");
      const discovered = await discoverAllSkills(!selectedSources || selectedSources.includes("roblox"));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const route = await planSkillRoute({
        task,
        context: z.string().max(4_000).catch("").parse(args.context ?? ""),
        skills,
        intent: args.intent,
        caller: z.enum(SKILL_CALLERS).catch("other").parse(args.caller ?? "other"),
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: z.number().int().min(1).max(16).catch(8).parse(args.maxSkills ?? 8),
      });
      const traceId = resolveMssrTraceId(args.traceId);
      const profile = agentProfile(args);
      const workflowKey = requireWorkflowKey(args.workflowKey);
      const observedRoute = { ...route, agentProfile: profile, workflowKey: workflowKey ?? null };
      const systemAwareness = await buildMssrSystemAwareness({
        intent: route.intent,
        workflows: route.workflows,
        robloxHealth: discovered.sourceHealth.roblox,
      });
      recordMssrRoute({ traceId, action: "plan", task, route: observedRoute as unknown as Record<string, unknown> });
      const response = {
        ...observedRoute,
        traceId,
        sourceHealth: discovered.sourceHealth,
        systemAwareness: systemAwareness.status,
        __bridgeNotices: systemAwareness.notices,
        warnings: [...discovered.warnings, ...route.warnings],
        nextAction: {
          label: "Cargar automáticamente las skills de la fase",
          toolName: "skill_bootstrap",
          arguments: {
            task,
            context: args.context ?? "",
            intent: args.intent,
            caller: args.caller ?? "other",
            model: args.model,
            reasoningEffort: args.reasoningEffort ?? "unknown",
            stage: route.stage,
            completedPhases: args.completedPhases ?? [],
            sources: args.sources,
            maxSkills: args.maxSkills ?? 8,
            traceId,
            workflowKey,
            responseMode,
          },
          instruction: "Usa esta acción cuando necesites aplicar la ruta: skill_bootstrap carga todas las skills de la fase sobre la misma traza. No hagas skill_load manual uno por uno salvo recuperación focal.",
        },
      };
      return responseMode === "debug" ? { ...response, responseMode } : compactSkillRoute(response);
    },
    skill_bootstrap: async (args) => {
      const task = z.string().min(1).parse(args.task);
      const selectedSources = sourceFilter(args.sources);
      const discovered = await discoverAllSkills(!selectedSources || selectedSources.includes("roblox"));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const route = await planSkillRoute({
        task,
        context: z.string().max(4_000).catch("").parse(args.context ?? ""),
        skills,
        intent: args.intent,
        caller: z.enum(SKILL_CALLERS).catch("other").parse(args.caller ?? "other"),
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: z.number().int().min(1).max(16).catch(8).parse(args.maxSkills ?? 8),
      });
      const traceId = resolveMssrTraceId(args.traceId);
      const profile = agentProfile(args);
      const workflowKey = requireWorkflowKey(args.workflowKey);
      const systemAwareness = await buildMssrSystemAwareness({
        intent: route.intent,
        workflows: route.workflows,
        robloxHealth: discovered.sourceHealth.roblox,
      });
      const contentMode = z.enum(["selective", "full"]).catch("selective").parse(args.contentMode ?? "selective") as SkillContextMode;
      const referenceMode = z.enum(["auto", "none"]).catch("auto").parse(args.includeReferences ?? "auto") as SkillReferenceMode;
      const maxContextChars = z.number().int().min(4_000).max(100_000).catch(24_000).parse(args.maxContextChars ?? 24_000);
      const routedIntent = structuredSkillIntentSchema.parse(route.intent);
      const observedRoute = { ...route, agentProfile: profile, workflowKey: workflowKey ?? null };
      recordMssrRoute({ traceId, action: "bootstrap", task, route: observedRoute as unknown as Record<string, unknown> });
      const activeByName = new Map(route.activeSkills.map((skill) => [skill.name, skill]));
      const loaded: Array<Record<string, unknown>> = [];
      const codexMatches = route.loadOrder.flatMap((name, routeIndex) => {
        const match = activeByName.get(name);
        return match && match.source !== "roblox" ? [{ match, routeIndex }] : [];
      });
      const codexPlan = await planCodexSkillContexts({
        skills: codexMatches.map(({ match, routeIndex }) => ({
          skill: match,
          required: match.required === true,
          routeIndex,
          routeScore: Number((match as { score?: number }).score ?? 0),
        })),
        intent: routedIntent,
        stage: route.stage,
        mode: contentMode,
        references: referenceMode,
        maxContextChars,
      });
      const codexByName = new Map(codexPlan.skills.map((item) => [item.skill.name, item]));
      const contextAssemblySkills: Array<Record<string, unknown>> = [];

      for (const name of route.loadOrder) {
        const match = activeByName.get(name);
        if (!match) continue;
        if (match.source === "roblox") {
          if (discovered.sourceHealth.roblox?.status !== "healthy") {
            const warning = `Roblox skill '${match.name}' was discovered from cached metadata but was not invoked because the live source is ${discovered.sourceHealth.roblox?.status ?? "unavailable"}.`;
            loaded.push({ skill: match, loaded: false, warning });
            recordMssrSkillLoad({ traceId, skillName: match.name, source: match.source, stage: route.stage, required: match.required, loaded: false, via: "skill_bootstrap", warning });
            continue;
          }
          try {
            const result = await callRobloxMcpTool("skill", { skill_name: match.name });
            loaded.push({ skill: match, loaded: true, activationInstruction: "Treat the returned Roblox-authored skill as active guidance for this task phase.", result });
            recordMssrSkillLoad({ traceId, skillName: match.name, source: match.source, stage: route.stage, required: match.required, loaded: true, via: "skill_bootstrap" });
          } catch (error) {
            recordMssrSkillLoad({ traceId, skillName: match.name, source: match.source, stage: route.stage, required: match.required, loaded: false, via: "skill_bootstrap", warning: error instanceof Error ? error.message : String(error) });
            throw error;
          }
          continue;
        }

        const planned = codexByName.get(match.name);
        if (!planned) throw new Error(`Global context planner did not return routed skill: ${match.name}`);
        loaded.push(planned as unknown as Record<string, unknown>);
        const contextInfo = planned.contextAssembly;
        contextAssemblySkills.push({ name: match.name, required: match.required === true, ...contextInfo });
        recordMssrSkillLoad({
          traceId,
          skillName: match.name,
          source: match.source,
          stage: route.stage,
          required: match.required,
          loaded: planned.loaded,
          via: "skill_bootstrap",
          warning: planned.loaded ? contextInfo.warning : planned.warning,
          contentMode: contextInfo.mode,
          coreCharsLoaded: contextInfo.coreCharsLoaded,
          moduleCharsLoaded: contextInfo.moduleCharsLoaded,
          totalCharsLoaded: contextInfo.totalCharsLoaded,
          fullSkillChars: contextInfo.fullSkillChars,
          estimatedCharsSaved: contextInfo.estimatedCharsSaved,
          selectedModules: contextInfo.selectedModules,
          manifestStatus: contextInfo.manifestStatus,
          ambiguousGroups: contextInfo.ambiguousGroups,
          budgetExceeded: contextInfo.budgetExceeded,
          skipped: contextInfo.skipped,
          skippedReason: contextInfo.skippedReason,
          candidateChars: contextInfo.candidateChars,
          planningMode: contextInfo.planningMode,
          allocationTiers: contextInfo.allocationTiers,
          duplicateCharsAvoided: contextInfo.duplicateCharsAvoided,
        });
      }
      return {
        ...observedRoute,
        traceId,
        canonicalCodexSkillRoot: path.join(codexHome(), "skills"),
        loaded,
        contextAssembly: {
          mode: contentMode,
          includeReferences: referenceMode,
          ...codexPlan,
          skills: contextAssemblySkills,
        },
        sourceHealth: discovered.sourceHealth,
        systemAwareness: systemAwareness.status,
        __bridgeNotices: systemAwareness.notices,
        warnings: [...discovered.warnings, ...route.warnings],
        activationInstruction: loaded.length > 0
          ? "The loaded skills govern only the current phase. Bridge carries the active trace in-session and uniquely recovers it across stateless calls when safe. Call skill_bootstrap again only at verify, persist, close, a material failure, or a newly discovered capability need; pass traceId explicitly after restart or when multiple candidates exist."
          : route.activationInstruction,
      };
    },
    skill_load: async (args) => {
      const name = z.string().min(1).parse(args.name);
      const source = z.enum(["auto", "codex", "roblox"]).catch("auto").parse(args.source ?? "auto");
      const stage = z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start");
      const required = args.required === true;
      const traceId = resolveMssrTraceId(args.traceId);
      if (source !== "roblox") {
        const discoveredCodex = await discoverCodexSkills();
        const codex = canonicalizeSkillEntries(discoveredCodex.skills).entries;
        const entry = codex.find((skill) => skill.name === name);
        if (entry) {
          try {
            const result = await loadCodexSkill(entry);
            recordMssrSkillLoad({ traceId, skillName: name, source: entry.source, stage, required, loaded: true, via: "skill_load" });
            return { ...result, traceId };
          } catch (error) {
            recordMssrSkillLoad({ traceId, skillName: name, source: entry.source, stage, required, loaded: false, via: "skill_load", warning: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }
        if (source === "codex") {
          recordMssrSkillLoad({ traceId, skillName: name, source: "codex", stage, required, loaded: false, via: "skill_load", warning: "Codex skill not found." });
          throw new Error(`Codex skill not found: ${name}`);
        }
      }
      const roblox = await discoverRobloxSkills();
      const entry = roblox.skills.find((skill) => skill.name === name);
      if (!entry) {
        recordMssrSkillLoad({ traceId, skillName: name, source: "roblox", stage, required, loaded: false, via: "skill_load", warning: "Roblox MCP skill not found." });
        throw new Error(`Roblox MCP skill not found: ${name}`);
      }
      if (roblox.health.status !== "healthy") {
        const warning = `Roblox MCP skill '${name}' is visible only through cached metadata; live skill loading is unavailable while source status is ${roblox.health.status}.`;
        recordMssrSkillLoad({ traceId, skillName: name, source: entry.source, stage, required, loaded: false, via: "skill_load", warning });
        throw new Error(warning);
      }
      try {
        const result = await callRobloxMcpTool("skill", { skill_name: name });
        recordMssrSkillLoad({ traceId, skillName: name, source: entry.source, stage, required, loaded: true, via: "skill_load" });
        return { skill: entry, loaded: true, traceId, activationInstruction: "Treat the returned Roblox-authored skill as active guidance and follow it before writing code or taking action.", result };
      } catch (error) {
        recordMssrSkillLoad({ traceId, skillName: name, source: entry.source, stage, required, loaded: false, via: "skill_load", warning: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    roblox_mcp_status: async (args) => {
      const status = await robloxMcpConnectionStatus({ forceRefresh: args.refresh === true });
      if (status.status !== "healthy") return { ...status, studios: [], studioState: null };
      const studioInspection = await inspectRobloxStudioState().catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
      return {
        ...status,
        studios: "studios" in studioInspection ? studioInspection.studios : [],
        activeStudio: "activeStudio" in studioInspection ? studioInspection.activeStudio : null,
        studioState: "studioState" in studioInspection ? studioInspection.studioState : null,
        studioWarning: "warning" in studioInspection ? studioInspection.warning : undefined,
        studioError: "error" in studioInspection ? studioInspection.error : undefined,
      };
    },
    roblox_mcp_tool_list: async (args) => {
      const health = await inspectRobloxMcpTools({ force: args.refresh === true });
      const tools = health.tools;
      const query = typeof args.query === "string" ? normalize(args.query) : "";
      const includeSchemas = args.includeSchemas !== false;
      const filtered = tools
        .filter((tool) => !query || normalize(`${tool.name} ${tool.description ?? ""}`).includes(query))
        .map((tool) => includeSchemas ? tool : ({ name: tool.name, description: tool.description, annotations: tool.annotations }));
      return {
        status: health.status,
        count: filtered.length,
        liveToolCount: health.liveToolCount,
        usingCachedTools: health.usingCachedTools,
        tools: filtered,
        warnings: health.warning ? [health.warning] : [],
      };
    },
    roblox_mcp_studio_list: async (args) => {
      const health = await inspectRobloxMcpTools({ force: args.refresh === true });
      if (health.status !== "healthy") {
        throw new Error(`Roblox MCP Studio discovery requires a live catalog; current status is ${health.status}.`);
      }
      const result = await callRobloxMcpTool("list_roblox_studios", {});
      const studios = parseRobloxStudios(result);
      return {
        status: health.status,
        count: studios.length,
        activeStudioId: studios.find((studio) => studio.active)?.id ?? null,
        multipleStudios: studios.length > 1,
        studios,
      };
    },
    roblox_mcp_query: async (args) => {
      const name = z.string().min(1).parse(args.toolName);
      if (name === "set_active_studio") throw new Error("Use studioId targeting instead of proxying set_active_studio directly.");
      const tool = await requireLiveRemoteTool(name);
      if (tool.annotations?.readOnlyHint !== true) throw new Error(`Roblox MCP tool '${name}' is not marked read-only; use roblox_mcp_action with explicit confirmation.`);
      const targeted = await callRobloxMcpToolForStudio(name, objectArgs(args.arguments), {
        studioId: typeof args.studioId === "string" ? args.studioId : undefined,
      });
      return { tool: name, annotations: tool.annotations, ...targeted };
    },
    roblox_mcp_action: async (args) => {
      const name = z.string().min(1).parse(args.toolName);
      const confirmName = z.string().min(1).parse(args.confirmToolName);
      if (confirmName !== name) throw new Error(`confirmToolName must exactly match '${name}'.`);
      if (name === "set_active_studio") throw new Error("Use studioId targeting instead of proxying set_active_studio directly.");
      const tool = await requireLiveRemoteTool(name);
      if (tool.annotations?.readOnlyHint === true) throw new Error(`Roblox MCP tool '${name}' is read-only; use roblox_mcp_query.`);
      const targeted = await callRobloxMcpToolForStudio(name, objectArgs(args.arguments), {
        studioId: typeof args.studioId === "string" ? args.studioId : undefined,
        requireExplicitWhenMultiple: true,
      });
      return { tool: name, annotations: tool.annotations, ...targeted };
    },
  },
};
