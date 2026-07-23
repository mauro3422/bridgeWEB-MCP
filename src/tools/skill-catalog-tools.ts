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
  type SkillEntry,
  type SkillSource,
} from "./skill-routing.js";

const MAX_SKILL_FILE_CHARS = 160_000;
const MAX_DISCOVERED_SKILLS = 600;

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
    const match = lines[index].match(new RegExp(`^${key}:\\s*(.*)$`, "i"));
    if (!match) continue;
    const initial = match[1].trim();
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
    "mauroprime-bridge-collaboration": /mauroprime|bridge|codex.*chatgpt|chatgpt.*codex|coordinar agentes|historial de codex|sesion de codex/,
    "shared-skill-governance": /crear skill|actualizar skill|mejorar skill|generalizar skill|skills compartidas|skill bootstrap|gobernanza de skills|catalogo de skills/,
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
      description: "Recommend relevant Codex and Roblox MCP skills for a task. Use before substantial specialized work when a skill may encode a safer or more complete loop, especially for Roblox Studio, Blender, asset review, animation, QA, or repeatable maintenance workflows.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user request or intended workflow." },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxResults: { type: "number", default: 8, minimum: 1, maximum: 30 },
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
      name: "skill_route_plan",
      description: "Plan skill activation before substantial specialized work. The agent should first infer a compact structured intent from the user's request, including explicit semantic signals, even when the wording is incomplete, then call this tool. Use signal nominal only when no error, warning, uncertainty, friction, recovery need, capability gap, or reusable pattern is present. It deterministically applies routing metadata, dependencies, exclusions, workflow phases, source precedence, and completed-phase coverage. It does not expose or require chain-of-thought.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other", description: "Client executing the route. Use codex-local when direct shell/filesystem tools exist, chatgpt-web when local access is mediated by Bridge, or other when unknown." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxSkills: { type: "number", default: 8, minimum: 1, maximum: 16 },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "skill_bootstrap",
      description: "Load the current phase of a structured skill route. Use at start, implementation, verification, persistence, close, or resume. It rescans the canonical Codex skills and live Roblox catalog, plans activation deterministically, and loads only active-phase skills; deferred skills remain in the returned plan to avoid context bloat. Provide structured intent with explicit semantic signals whenever possible; use nominal only for a clean request. Lexical matching is a marked fallback only.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
          caller: { type: "string", enum: [...SKILL_CALLERS], default: "other", description: "Client executing the route. Use codex-local when direct shell/filesystem tools exist, chatgpt-web when local access is mediated by Bridge, or other when unknown." },
          stage: { type: "string", enum: [...SKILL_STAGES], default: "start" },
          completedPhases: { type: "array", items: { type: "string", enum: [...SKILL_PHASES] }, default: [] },
          sources: { type: "array", items: { type: "string", enum: ["codex-local", "codex-system", "codex-plugin", "roblox"] } },
          maxSkills: { type: "number", default: 8, minimum: 1, maximum: 16 },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
    {
      name: "skill_load",
      description: "Load one skill as active guidance. For Codex skills this reads the exact SKILL.md; for Roblox-authored skills this invokes the Roblox Studio MCP skill tool. Use only after naming or recommending the skill, and load it before writing code or taking the covered action.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          source: { type: "string", enum: ["auto", "codex", "roblox"], default: "auto" },
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
      const maxResults = z.number().int().min(1).max(30).catch(8).parse(args.maxResults ?? 8);
      const discovered = await discoverAllSkills(!selectedSources || selectedSources.includes("roblox"));
      const canonical = canonicalizeSkillEntries(discovered.skills).entries;
      const matches = canonical
        .filter((skill) => !selectedSources || selectedSources.includes(skill.source))
        .map((skill) => ({ ...skill, ...skillScore(task, skill) }))
        .filter((skill) => skill.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, maxResults);
      return {
        task,
        matches,
        sourceHealth: discovered.sourceHealth,
        warnings: discovered.warnings,
        activationInstruction: matches[0]
          ? "Load the highest relevant skill(s) with skill_load before taking the covered action. Local Codex and Roblox-authored skills can be combined."
          : "No skill matched strongly; continue without forcing an unrelated workflow.",
      };
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
    skill_route_plan: async (args) => {
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
      return { ...route, sourceHealth: discovered.sourceHealth, warnings: [...discovered.warnings, ...route.warnings] };
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
      const activeByName = new Map(route.activeSkills.map((skill) => [skill.name, skill]));
      const loaded: Array<Record<string, unknown>> = [];
      for (const name of route.loadOrder) {
        const match = activeByName.get(name);
        if (!match) continue;
        if (match.source === "roblox") {
          if (discovered.sourceHealth.roblox?.status !== "healthy") {
            loaded.push({
              skill: match,
              loaded: false,
              warning: `Roblox skill '${match.name}' was discovered from cached metadata but was not invoked because the live source is ${discovered.sourceHealth.roblox?.status ?? "unavailable"}.`,
            });
            continue;
          }
          loaded.push({
            skill: match,
            loaded: true,
            activationInstruction: "Treat the returned Roblox-authored skill as active guidance for this task phase.",
            result: await callRobloxMcpTool("skill", { skill_name: match.name }),
          });
        } else {
          loaded.push(await loadCodexSkill(match));
        }
      }
      return {
        ...route,
        canonicalCodexSkillRoot: path.join(codexHome(), "skills"),
        loaded,
        sourceHealth: discovered.sourceHealth,
        warnings: [...discovered.warnings, ...route.warnings],
        activationInstruction: loaded.length > 0
          ? "The loaded skills govern only the current workflow phase. Execute the task, then call skill_bootstrap again with stage=verify, persist, or close and the completedPhases list instead of carrying every deferred skill in context."
          : route.activationInstruction,
      };
    },
    skill_load: async (args) => {
      const name = z.string().min(1).parse(args.name);
      const source = z.enum(["auto", "codex", "roblox"]).catch("auto").parse(args.source ?? "auto");
      if (source !== "roblox") {
        const discoveredCodex = await discoverCodexSkills();
        const codex = canonicalizeSkillEntries(discoveredCodex.skills).entries;
        const entry = codex.find((skill) => skill.name === name);
        if (entry) return await loadCodexSkill(entry);
        if (source === "codex") throw new Error(`Codex skill not found: ${name}`);
      }
      const roblox = await discoverRobloxSkills();
      const entry = roblox.skills.find((skill) => skill.name === name);
      if (!entry) throw new Error(`Roblox MCP skill not found: ${name}`);
      if (roblox.health.status !== "healthy") {
        throw new Error(`Roblox MCP skill '${name}' is visible only through cached metadata; live skill loading is unavailable while source status is ${roblox.health.status}.`);
      }
      return {
        skill: entry,
        loaded: true,
        activationInstruction: "Treat the returned Roblox-authored skill as active guidance and follow it before writing code or taking action.",
        result: await callRobloxMcpTool("skill", { skill_name: name }),
      };
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
