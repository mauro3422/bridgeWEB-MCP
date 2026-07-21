import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { assertPathAllowed } from "./shared/path.js";
import { callRobloxMcpTool, listRobloxMcpTools, robloxMcpConnectionStatus, type RobloxMcpTool } from "../integrations/roblox-mcp-client.js";
import {
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_PHASES,
  SKILL_RISKS,
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

async function walkSkillFiles(root: string, source: SkillSource, maxDepth: number, origin?: string): Promise<SkillEntry[]> {
  if (!(await pathExists(root))) return [];
  const results: SkillEntry[] = [];
  const visitedDirectories = new Set<string>();
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || results.length >= MAX_DISCOVERED_SKILLS) return;
    let realDirectory: string;
    let entries: Dirent[];
    try {
      realDirectory = await fs.realpath(directory);
      assertPathAllowed(realDirectory, "read");
      const visitKey = process.platform === "win32" ? realDirectory.toLowerCase() : realDirectory;
      if (visitedDirectories.has(visitKey)) return;
      visitedDirectories.add(visitKey);
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
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
  return results;
}

async function discoverCodexSkills(): Promise<SkillEntry[]> {
  const home = codexHome();
  const normalRoot = path.join(home, "skills");
  const allNormal = await walkSkillFiles(normalRoot, "codex-local", 5, "Codex skills directory");
  for (const skill of allNormal) {
    const normalized = skill.path?.split(path.sep).map((part) => part.toLowerCase()) ?? [];
    if (normalized.includes(".system")) skill.source = "codex-system";
  }
  const pluginRoot = path.join(home, "plugins", "cache");
  const pluginSkills = await walkSkillFiles(pluginRoot, "codex-plugin", 8, "Codex plugin cache");
  return [...allNormal, ...pluginSkills];
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

async function discoverRobloxSkills(): Promise<SkillEntry[]> {
  const tools = await listRobloxMcpTools();
  return parseRobloxSkills(tools.find((tool) => tool.name === "skill"));
}

async function discoverAllSkills(includeRoblox = true): Promise<{ skills: SkillEntry[]; warnings: string[] }> {
  const warnings: string[] = [];
  const codex = await discoverCodexSkills();
  let roblox: SkillEntry[] = [];
  if (includeRoblox) {
    try {
      roblox = await discoverRobloxSkills();
    } catch (error) {
      warnings.push(`Roblox MCP skills unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { skills: [...codex, ...roblox], warnings };
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
  description: "Compact semantic classification inferred by the agent from the user's request. This is not chain-of-thought; provide only the structured outcome.",
  properties: {
    summary: { type: "string", maxLength: 600 },
    domains: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", enum: [...SKILL_DOMAINS] } },
    actions: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", enum: [...SKILL_ACTIONS] } },
    artifacts: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_ARTIFACTS] }, default: [] },
    needs: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_NEEDS] }, default: [] },
    risk: { type: "string", enum: [...SKILL_RISKS], default: "read-only" },
    ambiguity: { type: "string", enum: ["low", "medium", "high"], default: "low" },
  },
  required: ["domains", "actions"],
  additionalProperties: false,
} as const;

export const skillCatalogToolModule: BridgeToolModule = {
  name: "skill-catalog-and-roblox-proxy",
  tools: [
    {
      name: "skill_catalog",
      description: "List the unified skill catalog available to Mauro's workflow: local/system/plugin Codex SKILL.md files plus the Roblox-authored skills exposed by Roblox Studio MCP. Use when the user asks what skills exist, when resuming a specialized workflow, or when you need to discover whether a reusable procedure applies.",
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
      description: "Plan skill activation before substantial specialized work. The agent should first infer a compact structured intent from the user's request, even when the wording is incomplete, then call this tool. It deterministically applies routing metadata, dependencies, exclusions, workflow phases, source precedence, and completed-phase coverage. It does not expose or require chain-of-thought.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
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
      description: "Load the current phase of a structured skill route. Use at start, implementation, verification, persistence, close, or resume. It rescans the canonical Codex skills and live Roblox catalog, plans activation deterministically, and loads only active-phase skills; deferred skills remain in the returned plan to avoid context bloat. Provide structured intent whenever possible; lexical matching is a marked fallback only.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Current user message or concise task statement." },
          context: { type: "string", maxLength: 4000, description: "Bounded resolved context from the recent relevant conversation. For multi-turn specialized work, normally pass a 500-2000 character summary covering the accepted goal, constraints, completed work/current phase, and unresolved references, even when the current message is not an obvious acknowledgment. Omit only for a genuinely standalone first turn. Do not send hidden chain-of-thought, irrelevant history, or a full transcript." },
          intent: structuredIntentInputSchema,
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
      description: "Check the persistent Bridge-to-Roblox Studio MCP connection, server version, available Studio instances, current Studio state, and tool count. Use before Roblox edits or when the MCP appears disconnected or stale.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "roblox_mcp_tool_list",
      description: "List the live tools exposed by Roblox Studio MCP, including newly added tools and their schemas. Use when a Roblox capability may exist but is not represented by a dedicated Bridge tool.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional name/description filter." },
          includeSchemas: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_query",
      description: "Call a live Roblox Studio MCP tool only when its remote annotation marks it read-only. Use roblox_mcp_tool_list first to inspect the exact schema. This provides forward-compatible access to current and future Roblox query/inspection tools.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          arguments: { type: "object", additionalProperties: true, default: {} },
        },
        required: ["toolName"],
        additionalProperties: false,
      },
    },
    {
      name: "roblox_mcp_action",
      description: "Call a live non-read-only Roblox Studio MCP tool through the Bridge. Before using it, list Studios, verify the active instance and Edit/Play state, inspect the remote schema, and require confirmToolName to exactly match toolName. This is the forward-compatible mutation path for current and future Roblox tools.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          confirmToolName: { type: "string" },
          arguments: { type: "object", additionalProperties: true, default: {} },
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
      return { count: filtered.length, skills: filtered, warnings: discovered.warnings };
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
      return {
        ...audit,
        ok: audit.ok && discovered.warnings.length === 0,
        errors: [...discovered.warnings, ...audit.errors],
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
        stage: z.enum(SKILL_STAGES).catch("start").parse(args.stage ?? "start"),
        completedPhases: z.array(z.enum(SKILL_PHASES)).catch([]).parse(args.completedPhases ?? []),
        maxSkills: z.number().int().min(1).max(16).catch(8).parse(args.maxSkills ?? 8),
      });
      return { ...route, warnings: [...discovered.warnings, ...route.warnings] };
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
          loaded.push({
            skill: match,
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
        const codex = canonicalizeSkillEntries(await discoverCodexSkills()).entries;
        const entry = codex.find((skill) => skill.name === name);
        if (entry) return await loadCodexSkill(entry);
        if (source === "codex") throw new Error(`Codex skill not found: ${name}`);
      }
      const roblox = await discoverRobloxSkills();
      const entry = roblox.find((skill) => skill.name === name);
      if (!entry) throw new Error(`Roblox MCP skill not found: ${name}`);
      return {
        skill: entry,
        activationInstruction: "Treat the returned Roblox-authored skill as active guidance and follow it before writing code or taking action.",
        result: await callRobloxMcpTool("skill", { skill_name: name }),
      };
    },
    roblox_mcp_status: async () => {
      const status = await robloxMcpConnectionStatus();
      const [studios, studioState] = await Promise.all([
        callRobloxMcpTool("list_roblox_studios", {}),
        callRobloxMcpTool("get_studio_state", {}).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
      ]);
      return { ...status, studios, studioState };
    },
    roblox_mcp_tool_list: async (args) => {
      const tools = await listRobloxMcpTools();
      const query = typeof args.query === "string" ? normalize(args.query) : "";
      const includeSchemas = args.includeSchemas !== false;
      const filtered = tools
        .filter((tool) => !query || normalize(`${tool.name} ${tool.description ?? ""}`).includes(query))
        .map((tool) => includeSchemas ? tool : ({ name: tool.name, description: tool.description, annotations: tool.annotations }));
      return { count: filtered.length, tools: filtered };
    },
    roblox_mcp_query: async (args) => {
      const name = z.string().min(1).parse(args.toolName);
      const tools = await listRobloxMcpTools();
      const tool = remoteToolByName(tools, name);
      if (tool.annotations?.readOnlyHint !== true) throw new Error(`Roblox MCP tool '${name}' is not marked read-only; use roblox_mcp_action with explicit confirmation.`);
      return { tool: name, result: await callRobloxMcpTool(name, objectArgs(args.arguments)) };
    },
    roblox_mcp_action: async (args) => {
      const name = z.string().min(1).parse(args.toolName);
      const confirmName = z.string().min(1).parse(args.confirmToolName);
      if (confirmName !== name) throw new Error(`confirmToolName must exactly match '${name}'.`);
      const tools = await listRobloxMcpTools();
      const tool = remoteToolByName(tools, name);
      if (tool.annotations?.readOnlyHint === true) throw new Error(`Roblox MCP tool '${name}' is read-only; use roblox_mcp_query.`);
      return { tool: name, annotations: tool.annotations, result: await callRobloxMcpTool(name, objectArgs(args.arguments)) };
    },
  },
};
