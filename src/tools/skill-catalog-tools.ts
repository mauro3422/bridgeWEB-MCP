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
  inspectRobloxMcpToolsForDiscovery,
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
  normalizeMssrIntent,
  planSkillRoute,
  structuredSkillIntentSchema,
  type IntentNormalizationResult,
  type SkillEntry,
  type SkillSource,
} from "./skill-routing.js";
import {
  MSSR_FIRST_PARTY_SKILL_MANIFEST,
  MSSR_FIRST_PARTY_SKILL_NAMES,
  MSSR_SKILL_DECISIONS,
  MSSR_SKILL_DECISION_REASONS,
  isMssrFirstPartySkillName,
  mssrFirstPartySkillsRoot,
  mssrSkillDecisionSchema,
  planCodexSkillContexts,
  resolveSkillLoadSelection,
  shouldLoadProjectChangeHistory,
  type MssrSkillDecisionRecord,
  type SkillContextMode,
  type SkillReferenceMode,
} from "@mauroprime/mssr";
import { MSSR_CONTEXT_MESSAGE_INPUT_SCHEMA, selectBridgeMssrContextMessages } from "../mssr-context-messages.js";
import {
  hashMssrTask,
  recordMssrEvent,
  recordMssrProjectContextSelection,
  recordMssrRoute,
  recordMssrSkillDecision,
  recordMssrSkillLoad,
  resolveMssrTraceId,
} from "../mssr-observatory.js";
import { requireWorkflowKey } from "../runtime-identity.js";
import { buildMssrSystemAwareness, isRobloxMssrRoute } from "../mssr-system-awareness.js";
import { assembleProjectContext } from "../project-context-assembler.js";

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
    intentResolution: route.intentResolution,
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
    connectorExecution: route.connectorExecution,
    nextAction: route.nextAction,
    warnings: route.warnings,
    activationInstruction: route.activationInstruction,
    sourceHealth: route.sourceHealth,
    systemAwareness: route.systemAwareness,
    contextMessages: route.contextMessages,
    __bridgeNotices: route.__bridgeNotices,
  };
}

function connectorFallback(
  targetToolName: string,
  targetArguments: Record<string, unknown>,
  traceId: string,
  mode: "query" | "action" = "query",
): Record<string, unknown> {
  const wrapper = mode === "query" ? "bridge_tool_query" : "bridge_tool_action";
  return {
    policy: "direct-then-delegated",
    directToolName: targetToolName,
    instruction: `Call ${targetToolName} directly when it is present in the connector catalog. If it is absent, invoke ${wrapper} immediately with the exact fallback below; do not search the filesystem or retry guessed schemas first.`,
    fallback: {
      toolName: wrapper,
      arguments: {
        toolName: targetToolName,
        ...(mode === "action" ? { confirmToolName: targetToolName } : {}),
        traceId,
        arguments: targetArguments,
      },
    },
  };
}

function mssrConnectorPaths(traceId: string): Record<string, unknown> {
  return {
    policy: "direct-then-delegated",
    instruction: "Use a dedicated MSSR tool when the connector exposes it. If absent, dispatch it immediately through the listed wrapper. Wrapper reachability is fallback usage, not direct exposure.",
    query: [
      "skill_route_audit",
      "skill_route_vocabulary",
      "skill_route_plan",
      "skill_bootstrap",
      "mssr_observatory_query",
      "mssr_trace_evidence",
    ],
    action: ["mssr_trace_record", "mssr_observatory_epoch_start"],
    wrapperControl: { traceId },
    schemaPolicy: "The route-produced fallback arguments are authoritative. Call bridge_tool_schema only after schema-validation or when no exact fallback arguments were supplied.",
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

type MssrFirstPartySkillDiscovery = {
  skills: SkillEntry[];
  warnings: string[];
  root: string;
};

/**
 * Reads only the package-declared MSSR skill paths. This intentionally does not
 * use Bridge's broad allowed-root policy: an installed package may resolve
 * outside the Bridge workspace, but every realpath remains constrained to the
 * exact root returned by MSSR's own package API.
 */
async function discoverMssrFirstPartySkills(): Promise<MssrFirstPartySkillDiscovery> {
  const root = mssrFirstPartySkillsRoot();
  const warnings: string[] = [];
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.realpath(root);
  } catch (error) {
    return {
      skills: [],
      warnings: [`MSSR first-party skills root unavailable: ${root}: ${error instanceof Error ? error.message : String(error)}`],
      root,
    };
  }

  const skills: SkillEntry[] = [];
  for (const { name } of MSSR_FIRST_PARTY_SKILL_MANIFEST.skills) {
    if (!MSSR_FIRST_PARTY_SKILL_NAMES.has(name) || !isMssrFirstPartySkillName(name)) {
      warnings.push(`MSSR first-party manifest rejected an unreserved skill name: ${name}`);
      continue;
    }
    const candidate = path.join(root, name, "SKILL.md");
    let location: string;
    try {
      location = await fs.realpath(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      warnings.push(code === "ENOENT"
        ? `MSSR first-party skill is missing from its package root: ${name}`
        : `MSSR first-party skill is unreadable (${name}): ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isWithinRoot(canonicalRoot, location)) {
      warnings.push(`MSSR first-party skill resolves outside its package root: ${name}`);
      continue;
    }
    const skill = await readSkillEntry(location, "mssr-first-party", "MSSR first-party package");
    if (!skill || skill.name !== name || !isMssrFirstPartySkillName(skill.name)) {
      warnings.push(`MSSR first-party skill metadata does not match its reserved manifest entry: ${name}`);
      continue;
    }
    skills.push(skill);
  }
  return { skills, warnings, root: canonicalRoot };
}

type LocalSkillDiscovery = {
  skills: SkillEntry[];
  warnings: string[];
  codex: Awaited<ReturnType<typeof discoverCodexSkills>>;
  mssr: MssrFirstPartySkillDiscovery;
};

async function discoverLocalSkills(): Promise<LocalSkillDiscovery> {
  const [mssr, codex] = await Promise.all([discoverMssrFirstPartySkills(), discoverCodexSkills()]);
  return {
    skills: [...mssr.skills, ...codex.skills],
    warnings: [...mssr.warnings, ...codex.warnings],
    codex,
    mssr,
  };
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
  mssr: {
    status: "healthy" | "degraded";
    skillCount: number;
    manifestSkillCount: number;
    warningCount: number;
    root: string;
  };
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

function shouldDiscoverRoblox(
  args: Record<string, unknown>,
  selectedSources: SkillSource[] | null,
  intent: unknown,
): boolean {
  if (selectedSources) return selectedSources.includes("roblox");
  if (args.intent !== undefined) return isRobloxMssrRoute(intent);
  return true;
}

async function discoverRobloxSkills(): Promise<{ skills: SkillEntry[]; health: RobloxMcpToolCatalogHealth }> {
  const health = await inspectRobloxMcpToolsForDiscovery();
  const skills = parseRobloxSkills(health.tools.find((tool) => tool.name === "skill"));
  return { skills, health };
}

async function discoverAllSkills(includeRoblox = true): Promise<{ skills: SkillEntry[]; warnings: string[]; sourceHealth: SkillSourceHealth }> {
  const warnings: string[] = [];
  const local = await discoverLocalSkills();
  warnings.push(...local.warnings);
  let roblox: SkillEntry[] = [];
  const sourceHealth: SkillSourceHealth = {
    mssr: {
      status: local.mssr.warnings.length > 0 ? "degraded" : "healthy",
      skillCount: local.mssr.skills.length,
      manifestSkillCount: MSSR_FIRST_PARTY_SKILL_MANIFEST.skills.length,
      warningCount: local.mssr.warnings.length,
      root: local.mssr.root,
    },
    codex: {
      status: local.codex.warnings.length > 0 ? "degraded" : "healthy",
      skillCount: local.codex.skills.length,
      warningCount: local.codex.warnings.length,
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
  return { skills: [...local.skills, ...roblox], warnings, sourceHealth };
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
  const discovered = await discoverLocalSkills();
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
  const allowed = new Set<SkillSource>(["mssr-first-party", "codex-local", "codex-system", "codex-plugin", "roblox"]);
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
  description: "Compact semantic classification inferred by the agent from the user's request. Canonical values are preferred. Bridge safely normalizes a bounded set of unambiguous aliases and returns a correction-ready retry for ambiguous or unknown values; it never guesses an ambiguous intent.",
  properties: {
    summary: { type: "string", maxLength: 600 },
    domains: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 80 }, description: `Prefer canonical values: ${SKILL_DOMAINS.join(", ")}.` },
    actions: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 80 }, description: `Prefer canonical values: ${SKILL_ACTIONS.join(", ")}.` },
    artifacts: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 80 }, default: [], description: `Prefer canonical values: ${SKILL_ARTIFACTS.join(", ")}.` },
    needs: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 80 }, default: [], description: `Prefer canonical values: ${SKILL_NEEDS.join(", ")}.` },
    signals: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 80 }, default: ["nominal"], description: `Prefer canonical values: ${SKILL_SIGNALS.join(", ")}. Do not combine nominal with non-nominal signals.` },
    risk: { type: "string", minLength: 1, maxLength: 80, default: "read-only", description: `Prefer canonical values: ${SKILL_RISKS.join(", ")}.` },
    ambiguity: { type: "string", minLength: 1, maxLength: 80, default: "low", description: "Prefer canonical values: low, medium, high." },
  },
  additionalProperties: false,
} as const;

function recordIntentResolution(args: {
  traceId: string;
  task: string;
  caller: unknown;
  stage: unknown;
  model: unknown;
  reasoningEffort: unknown;
  result: IntentNormalizationResult;
}): void {
  if (args.result.status !== "normalized" && args.result.status !== "correction-required") return;
  recordMssrEvent({
    traceId: args.traceId,
    eventType: args.result.status === "normalized" ? "intent_normalized" : "intent_correction_required",
    caller: typeof args.caller === "string" ? args.caller : undefined,
    stage: typeof args.stage === "string" ? args.stage : undefined,
    classificationMode: "structured-semantic",
    taskHash: hashMssrTask(args.task),
    ok: args.result.status === "normalized",
    details: {
      status: args.result.status,
      aliasIds: args.result.changes.map((change) => change.id).slice(0, 24),
      changedFields: [...new Set(args.result.changes.map((change) => change.field))],
      unresolvedFields: [...new Set(args.result.issues.map((issue) => issue.field))],
      issueCodes: args.result.issues.map((issue) => issue.code).slice(0, 24),
      issueCount: args.result.issues.length,
      agentProfile: {
        model: typeof args.model === "string" ? args.model.slice(0, 80) : "unknown",
        reasoningEffort: typeof args.reasoningEffort === "string" ? args.reasoningEffort.slice(0, 20) : "unknown",
      },
      privacy: "Arbitrary invalid values are returned to the caller but are not stored in telemetry.",
    },
  });
}

function resolveIntentOrRecovery(args: Record<string, unknown>, toolName: "skill_recommend" | "skill_route_plan" | "skill_bootstrap", task: string) {
  const traceId = resolveMssrTraceId(args.traceId);
  const result = normalizeMssrIntent(args.intent);
  recordIntentResolution({
    traceId,
    task,
    caller: args.caller,
    stage: args.stage,
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    result,
  });
  if (result.status !== "correction-required") {
    return { traceId, intent: result.intent, resolution: result, recovery: null };
  }
  const retryArguments = {
    ...args,
    traceId,
    intent: result.retryIntent,
  };
  return {
    traceId,
    intent: undefined,
    resolution: result,
    recovery: {
      routed: false,
      traceId,
      intentResolution: {
        status: result.status,
        normalizedAliases: result.changes,
        unresolved: result.issues,
      },
      recoveryAction: {
        label: "Corregir intent y reintentar",
        toolName,
        arguments: retryArguments,
        instruction: "Elige valores canónicos para los campos unresolved y reintenta esta llamada. Bridge no ejecutó routing ni cargó skills.",
      },
      vocabularyAction: {
        toolName: "skill_route_vocabulary",
        arguments: {},
        instruction: "Consulta el vocabulario completo sólo si los candidatos devueltos no bastan.",
      },
    },
  };
}

export const skillCatalogToolModule: BridgeToolModule = {
  name: "skill-catalog-and-roblox-proxy",
  tools: [
    {
      name: "skill_catalog",
      description: "List the unified skill catalog available to Mauro's workflow: bundled MSSR first-party skills, local/system/plugin Codex SKILL.md files, plus Roblox-authored skills exposed by Roblox Studio MCP. Returns per-source health and warns when a requested live source is degraded. Use when the user asks what skills exist, when resuming a specialized workflow, or when you need to discover whether a reusable procedure applies.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional name/description filter." },
          sources: { type: "array", items: { type: "string", enum: ["mssr-first-party", "codex-local", "codex-system", "codex-plugin", "roblox"] } },
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
      description: "Plan skill activation before substantial specialized work. The agent should first infer a compact structured intent from the user's request, including explicit semantic signals, even when the wording is incomplete, then call this tool. Use signal nominal only when no error, warning, uncertainty, friction, recovery need, capability gap, or reusable pattern is present. It deterministically applies routing metadata, dependencies, exclusions, workflow phases, source precedence, and completed-phase coverage. Optional MSSR Context Messages v1 are strict provider/host evidence selected by portable MSSR against the normalized intent and stage; Bridge returns the complete selection and piggybacks selected messages as advisory notices without executing actions or persisting proposals. For Roblox routes, the response also includes a short-lived systemAwareness snapshot of Bridge, Roblox MCP catalog, connected Studios, active target and Edit/Play mode, with deduplicated notices only for actionable states. It does not expose or require chain-of-thought.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          projectRoot: { type: "string", description: "Optional repository root already loaded with project_context_load. When provided, MSSR can select modular project context/directives for this route stage." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other", description: "Client executing the route. Use codex-local or opencode-local for those local hosts, chatgpt-web when local access is mediated by Bridge, or other when unknown." },
          model: { type: "string", maxLength: 80, description: "Observable host-reported model identifier, for example gpt-5.6-terra or gpt-5.6-sol. Use unknown when the host cannot prove it." },
          reasoningEffort: { type: "string", enum: reasoningEfforts, default: "unknown", description: "Observable host-reported reasoning effort. Never infer it from latency or answer length." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxSkills: { type: "number", default: 8, minimum: 1, maximum: 16 },
          maxProjectContextChars: { type: "number", default: 12000, minimum: 2000, maximum: 80000, description: "Character budget for modular project core plus project modules selected for this stage." },
          contextMessages: MSSR_CONTEXT_MESSAGE_INPUT_SCHEMA,
          maxContextMessages: { type: "number", default: 12, minimum: 0, maximum: 32 },
          maxContextMessageChars: { type: "number", default: 6000, minimum: 0, maximum: 20000 },
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
      description: "Load the current phase of a structured MSSR route. It globally plans selective Codex skill context from context-modules.json manifests and, when projectRoot is supplied, also re-selects project context/memory/state/directive modules from .bridge/project-context.json for the same stage and structured intent without duplicating the already-loaded project core. Optional MSSR Context Messages v1 are validated and selected by portable MSSR, returned as complete advisory evidence, and piggybacked only when selected; Bridge never executes their advisory actions or persists their proposals. Required skill cores are reserved first; optional procedural context remains budgeted. Projects without a modular manifest keep the observable legacy project-context fallback loaded by project_context_load. The response reports skill-context savings plus scoped project-context decisions. Deferred skills and project modules remain metadata-only.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          projectRoot: { type: "string", description: "Optional repository root already loaded with project_context_load. When provided, MSSR can select modular project context/directives for this route stage." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other", description: "Client executing the route. Use codex-local or opencode-local for those local hosts, chatgpt-web when local access is mediated by Bridge, or other when unknown." },
          model: { type: "string", maxLength: 80, description: "Observable host-reported model identifier, for example gpt-5.6-terra or gpt-5.6-sol. Use unknown when the host cannot prove it." },
          reasoningEffort: { type: "string", enum: reasoningEfforts, default: "unknown", description: "Observable host-reported reasoning effort. Never infer it from latency or answer length." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxSkills: { type: "number", default: 8, minimum: 1, maximum: 16 },
          maxProjectContextChars: { type: "number", default: 12000, minimum: 2000, maximum: 80000, description: "Character budget for modular project core plus project modules selected for this stage." },
          contextMessages: MSSR_CONTEXT_MESSAGE_INPUT_SCHEMA,
          maxContextMessages: { type: "number", default: 12, minimum: 0, maximum: 32 },
          maxContextMessageChars: { type: "number", default: 6000, minimum: 0, maximum: 20000 },
          contentMode: { type: "string", enum: ["selective", "full"], default: "selective", description: "Use selective to assemble manifest-guided core/modules. Use full only for explicit diagnosis, compatibility comparison, or recovery." },
          includeReferences: { type: "string", enum: ["auto", "none"], default: "auto", description: "Auto selects matching manifest modules. None loads only the declared core while preserving routing." },
          maxContextChars: { type: "number", default: 24000, minimum: 4000, maximum: 100000, description: "Global character budget for assembled Codex skill context. Required cores are never silently truncated; budget overflow is reported." },
          selectionMode: { type: "string", enum: ["auto", "host-gated"], description: "Optional skill context selection policy. ChatGPT Web defaults to host-gated: required roots load with their dependencies, optional roots require an accepted decision, and dependency-only skills inherit the root decision. Auto preserves compatibility for other callers." },
          skillDecisions: {
            type: "array",
            maxItems: 32,
            description: "Bounded host decisions for optional routed roots. Required roots are workflow obligations and cannot be skipped; dependency-only skills inherit their root decision.",
            items: {
              type: "object",
              properties: {
                skillName: { type: "string", minLength: 1, maxLength: 160 },
                decision: { type: "string", enum: [...MSSR_SKILL_DECISIONS] },
                reasonCode: { type: "string", enum: [...MSSR_SKILL_DECISION_REASONS] },
                reasonSummary: { type: "string", minLength: 1, maxLength: 240 },
                stage: { type: "string", enum: [...SKILL_STAGES] },
              },
              required: ["skillName", "decision", "reasonCode"],
              additionalProperties: false,
            },
          },
          workflowKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$", description: "Optional stable workflow id shared by related traces, for example mauroprime-system-loop. It is local observability metadata, not a ChatGPT conversation id." },
          traceId: { type: "string", description: "Optional existing MSSR trace id for a replan. A new id is generated when omitted." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "skill_load",
      description: "Load one skill as active guidance and record the load in the MSSR trace. Pass the traceId returned by routing whenever available. In auto mode, reserved MSSR first-party names resolve to their bundled package source before external Codex catalogs; filesystem skills read the exact SKILL.md, while Roblox-authored skills invoke the live Roblox Studio MCP skill tool.",
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
      const intentResult = resolveIntentOrRecovery(args, "skill_recommend", task);
      if (intentResult.recovery) return intentResult.recovery;
      const selectedSources = sourceFilter(args.sources);
      const maxResults = z.number().int().min(1).max(16).catch(8).parse(args.maxResults ?? 8);
      const responseMode = z.enum(routeResponseModes).catch("compact").parse(args.responseMode ?? "compact");
      const discovered = await discoverAllSkills(shouldDiscoverRoblox(args, selectedSources, intentResult.intent));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const route = await planSkillRoute({
        task,
        context: z.string().max(4_000).catch("").parse(args.context ?? ""),
        skills,
        intent: intentResult.intent,
        caller: z.enum(SKILL_CALLERS).catch("other").parse(args.caller ?? "other"),
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: maxResults,
      });
      const traceId = intentResult.traceId;
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
        intentResolution: intentResult.resolution.status === "normalized" ? {
          status: "normalized",
          normalizedAliases: intentResult.resolution.changes,
        } : { status: intentResult.resolution.status },
        matches,
        sourceHealth: discovered.sourceHealth,
        warnings: [...discovered.warnings, ...route.warnings],
        connectorExecution: mssrConnectorPaths(traceId),
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
        && ["degraded", "unavailable"].includes(discovered.sourceHealth.roblox.status),
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
      const intentResult = resolveIntentOrRecovery(args, "skill_route_plan", task);
      if (intentResult.recovery) return intentResult.recovery;
      const selectedSources = sourceFilter(args.sources);
      const responseMode = z.enum(routeResponseModes).catch("compact").parse(args.responseMode ?? "compact");
      const discovered = await discoverAllSkills(shouldDiscoverRoblox(args, selectedSources, intentResult.intent));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const route = await planSkillRoute({
        task,
        context: z.string().max(4_000).catch("").parse(args.context ?? ""),
        skills,
        intent: intentResult.intent,
        caller: z.enum(SKILL_CALLERS).catch("other").parse(args.caller ?? "other"),
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: z.number().int().min(1).max(16).catch(8).parse(args.maxSkills ?? 8),
      });
      const traceId = intentResult.traceId;
      const profile = agentProfile(args);
      const workflowKey = requireWorkflowKey(args.workflowKey);
      const observedRoute = { ...route, agentProfile: profile, workflowKey: workflowKey ?? null };
      const systemAwareness = await buildMssrSystemAwareness({
        intent: route.intent,
        workflows: route.workflows,
        robloxHealth: discovered.sourceHealth.roblox,
      });
      const contextMessages = selectBridgeMssrContextMessages({
        messages: args.contextMessages,
        intent: structuredSkillIntentSchema.parse(route.intent),
        stage: route.stage,
        maxMessages: args.maxContextMessages,
        maxChars: args.maxContextMessageChars,
      });
      recordMssrRoute({ traceId, action: "plan", task, route: observedRoute as unknown as Record<string, unknown> });
      const bootstrapArguments = {
        task,
        projectRoot: args.projectRoot,
        context: args.context ?? "",
        intent: intentResult.intent,
        caller: args.caller ?? "other",
        model: args.model,
        reasoningEffort: args.reasoningEffort ?? "unknown",
        stage: route.stage,
        completedPhases: args.completedPhases ?? [],
        sources: args.sources,
        maxSkills: args.maxSkills ?? 8,
        maxProjectContextChars: args.maxProjectContextChars ?? 12_000,
        contextMessages: args.contextMessages,
        maxContextMessages: args.maxContextMessages ?? 12,
        maxContextMessageChars: args.maxContextMessageChars ?? 6_000,
        selectionMode: (args.caller ?? "other") === "chatgpt-web" ? "host-gated" : "auto",
        traceId,
        workflowKey,
      };
      const response = {
        ...observedRoute,
        traceId,
        intentResolution: intentResult.resolution.status === "normalized" ? {
          status: "normalized",
          normalizedAliases: intentResult.resolution.changes,
        } : { status: intentResult.resolution.status },
        sourceHealth: discovered.sourceHealth,
        systemAwareness: systemAwareness.status,
        contextMessages: contextMessages?.selection ?? null,
        __bridgeNotices: [...systemAwareness.notices, ...(contextMessages?.notices ?? [])],
        warnings: [...discovered.warnings, ...route.warnings],
        connectorExecution: connectorFallback("skill_bootstrap", bootstrapArguments, traceId),
        nextAction: {
          label: "Cargar automáticamente las skills de la fase",
          toolName: "skill_bootstrap",
          arguments: bootstrapArguments,
          fallback: connectorFallback("skill_bootstrap", bootstrapArguments, traceId).fallback,
          instruction: "Usa esta acción cuando necesites aplicar la ruta: llama skill_bootstrap directamente si aparece; si no, usa inmediatamente el fallback bridge_tool_query incluido. No busques schemas ni hagas skill_load manual uno por uno salvo error de validación o recuperación focal.",
        },
      };
      return responseMode === "debug" ? { ...response, responseMode } : compactSkillRoute(response);
    },
    skill_bootstrap: async (args) => {
      const task = z.string().min(1).parse(args.task);
      const intentResult = resolveIntentOrRecovery(args, "skill_bootstrap", task);
      if (intentResult.recovery) return intentResult.recovery;
      const caller = z.enum(SKILL_CALLERS).catch("other").parse(args.caller ?? "other");
      const selectedSources = sourceFilter(args.sources);
      const discovered = await discoverAllSkills(shouldDiscoverRoblox(args, selectedSources, intentResult.intent));
      const skills = discovered.skills.filter((skill) => !selectedSources || selectedSources.includes(skill.source));
      const route = await planSkillRoute({
        task,
        context: z.string().max(4_000).catch("").parse(args.context ?? ""),
        skills,
        intent: intentResult.intent,
        caller,
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: z.number().int().min(1).max(16).catch(8).parse(args.maxSkills ?? 8),
      });
      const traceId = intentResult.traceId;
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
      const maxProjectContextChars = z.number().int().min(2_000).max(80_000).catch(12_000).parse(args.maxProjectContextChars ?? 12_000);
      const routedIntent = structuredSkillIntentSchema.parse(route.intent);
      const contextMessages = selectBridgeMssrContextMessages({
        messages: args.contextMessages,
        intent: routedIntent,
        stage: route.stage,
        maxMessages: args.maxContextMessages,
        maxChars: args.maxContextMessageChars,
      });
      const projectRoot = typeof args.projectRoot === "string" && args.projectRoot.trim()
        ? path.resolve(args.projectRoot.trim())
        : null;
      if (projectRoot) assertPathAllowed(projectRoot, "read");
      const projectContextAssembly = projectRoot
        ? await assembleProjectContext({
            projectRoot,
            intent: routedIntent,
            stage: route.stage,
            maxContextChars: maxProjectContextChars,
            includeCore: false,
          })
        : null;
      const changeHistorySelection = shouldLoadProjectChangeHistory({ intent: routedIntent, stage: route.stage });
      const projectChangeHistory: {
        selected: boolean;
        reasons: string[];
        index: { path: string; text: string } | null;
        current: { version: string; path: string; text: string } | null;
      } = { selected: changeHistorySelection.load, reasons: changeHistorySelection.reasons, index: null, current: null };
      if (projectRoot && changeHistorySelection.load) {
        const indexPath = path.join(projectRoot, "changelogs", "INDEX.md");
        try {
          projectChangeHistory.index = { path: indexPath, text: (await fs.readFile(indexPath, "utf8")).slice(0, 20_000) };
        } catch {
          // Missing changelog history is surfaced by project_change_consistency; bootstrap remains usable.
        }
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
          if (typeof pkg?.version === "string") {
            const currentPath = path.join(projectRoot, "changelogs", `${pkg.version}.md`);
            projectChangeHistory.current = { version: pkg.version, path: currentPath, text: (await fs.readFile(currentPath, "utf8")).slice(0, 20_000) };
          }
        } catch {
          // Projects without package metadata or a current release note simply omit the current version document.
        }
      }
      const observedRoute = { ...route, agentProfile: profile, workflowKey: workflowKey ?? null, projectRoot };
      recordMssrRoute({ traceId, action: "bootstrap", task, route: observedRoute as unknown as Record<string, unknown> });
      if (projectRoot && projectContextAssembly?.decisions.length) {
        recordMssrProjectContextSelection({
          traceId,
          caller,
          stage: route.stage,
          projectName: path.basename(projectRoot),
          decisions: projectContextAssembly.decisions,
        });
      }
      const activeByName = new Map(route.activeSkills.map((skill) => [skill.name, skill]));
      const selectionMode = z.enum(["auto", "host-gated"])
        .catch(caller === "chatgpt-web" ? "host-gated" : "auto")
        .parse(args.selectionMode ?? (caller === "chatgpt-web" ? "host-gated" : "auto"));
      const suppliedDecisions = z.array(mssrSkillDecisionSchema).max(32).parse(args.skillDecisions ?? []) as MssrSkillDecisionRecord[];
      const optionalRoots = new Set(route.activeSkills
        .filter((match) => match.selectedAsRoot === true && match.required !== true)
        .map((match) => match.name));
      const requiredRoots = new Set(route.activeSkills
        .filter((match) => match.selectedAsRoot === true && match.required === true)
        .map((match) => match.name));
      const suppliedDecisionBySkill = new Map<string, MssrSkillDecisionRecord>();
      for (const rawDecision of suppliedDecisions) {
        if (suppliedDecisionBySkill.has(rawDecision.skillName)) {
          throw new Error(`Duplicate MSSR skill decision for '${rawDecision.skillName}'.`);
        }
        if (requiredRoots.has(rawDecision.skillName)) {
          throw new Error(`Required MSSR skill '${rawDecision.skillName}' is a workflow obligation and must not be host-gated.`);
        }
        if (!optionalRoots.has(rawDecision.skillName)) {
          throw new Error(`MSSR skill decision references a non-root optional candidate: ${rawDecision.skillName}`);
        }
        suppliedDecisionBySkill.set(rawDecision.skillName, { ...rawDecision, stage: route.stage });
      }

      const decisions: MssrSkillDecisionRecord[] = [];
      if (selectionMode === "host-gated") {
        for (const decision of suppliedDecisionBySkill.values()) {
          decisions.push(decision);
          recordMssrSkillDecision({ traceId, caller, decision });
        }
      } else {
        for (const decision of suppliedDecisions) {
          decisions.push({ ...decision, stage: route.stage });
          recordMssrSkillDecision({ traceId, caller, decision: { ...decision, stage: route.stage } });
        }
      }
      const decisionBySkill = new Map(decisions.map((decision) => [decision.skillName, decision]));
      const loadSelection = resolveSkillLoadSelection(route, selectionMode, decisions);
      const eligibleLoadOrder = [...loadSelection.eligibleLoadOrder];
      const skippedCandidates = route.activeSkills
        .filter((match) => match.selectedAsRoot === true && match.required !== true && decisionBySkill.get(match.name)?.decision === "skipped")
        .map((match) => ({ skill: match.name, ...(decisionBySkill.get(match.name) ?? {}) }));
      const pendingCandidates = route.activeSkills
        .filter((match) => match.selectedAsRoot === true && match.required !== true && selectionMode === "host-gated" && !decisionBySkill.has(match.name))
        .map((match) => ({ skill: match.name, decisionState: "absent" as const }));
      const loaded: Array<Record<string, unknown>> = [];
      const codexMatches = eligibleLoadOrder.flatMap((name, routeIndex) => {
        const match = activeByName.get(name);
        return match && match.source !== "roblox" ? [{ match, routeIndex }] : [];
      });
      const codexPlan = await planCodexSkillContexts({
        skills: codexMatches.map(({ match, routeIndex }) => ({
          skill: match,
          required: selectionMode === "host-gated" ? true : match.required === true,
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

      for (const name of eligibleLoadOrder) {
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
          moduleDecisions: contextInfo.moduleDecisions as Array<Record<string, unknown>>,
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
        intentResolution: intentResult.resolution.status === "normalized" ? {
          status: "normalized",
          normalizedAliases: intentResult.resolution.changes,
        } : { status: intentResult.resolution.status },
        canonicalCodexSkillRoot: path.join(codexHome(), "skills"),
        loaded,
        selection: {
          ...loadSelection,
          decisions,
          skippedCandidates,
          pendingCandidates,
          policy: selectionMode === "host-gated"
            ? "Required roots are obligations; optional roots without a host decision remain pending, while only explicit accepted/skipped decisions are recorded as telemetry."
            : "Compatibility mode: the complete routed dependency closure may load without an explicit host decision.",
        },
        contextAssembly: {
          mode: contentMode,
          includeReferences: referenceMode,
          ...codexPlan,
          skills: contextAssemblySkills,
        },
        projectContext: projectContextAssembly ? {
          projectRoot,
          stage: route.stage,
          ...projectContextAssembly,
          activationInstruction: projectContextAssembly.mode === "modular"
            ? "Treat selected project context/memory/state as scoped repository facts. Treat project directives as active only for this MSSR stage and intent; they refine execution but cannot weaken user instructions, AGENTS, safety, approvals, or verification."
            : "No modular project-context manifest is active for this repository; rely on project_context_load legacy documents already loaded by the host.",
        } : null,
        projectChangeHistory,
        contextMessages: contextMessages?.selection ?? null,
        sourceHealth: discovered.sourceHealth,
        systemAwareness: systemAwareness.status,
        __bridgeNotices: [...systemAwareness.notices, ...(contextMessages?.notices ?? [])],
        warnings: [
          ...discovered.warnings,
          ...route.warnings,
          ...(projectContextAssembly?.warning ? [projectContextAssembly.warning] : []),
        ],
        connectorExecution: mssrConnectorPaths(traceId),
        activationInstruction: loaded.length > 0
          ? "The loaded skills and selected project modules govern only the current phase. Project directives are scoped refinements, never higher-precedence authorization. Bridge carries the active trace in-session and uniquely recovers it across stateless calls when safe. Call skill_bootstrap again at verify, persist, close, a material failure, or a newly discovered capability need so both skill context and project context can be re-selected; pass traceId explicitly after restart or when multiple candidates exist."
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
        const discoveredLocal = await discoverLocalSkills();
        const local = canonicalizeSkillEntries(discoveredLocal.skills).entries;
        const entry = local.find((skill) => skill.name === name);
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
