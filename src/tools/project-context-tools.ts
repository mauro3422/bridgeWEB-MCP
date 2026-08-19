import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  MSSR_PROJECT_AUTHORITY_FILES,
  PROJECT_CONTEXT_KINDS,
  PROJECT_CONTEXT_TOPICS,
  PROJECT_KNOWLEDGE_KINDS,
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_SIGNALS,
  SKILL_STAGES,
  auditMssrProjectContextHealth,
  discoverMssrWorkspaceRepositories,
  evaluateMssrProjectKnowledgeMaintenance,
  evaluateProjectChangeConsistency,
  initializeMssrProject,
  initializeMssrWorkspace,
  mssrProjectKnowledgeCaptureInputSchema,
  mssrProjectRelativePath,
  parseVersionChangelogMarkdown,
  planMssrProjectContextModularization,
} from "@mauroprime/mssr";
import { captureProjectKnowledge, updateProjectContextSection } from "../project-context-writer.js";
import { resolveToolPath } from "./shared/path.js";
import type { BridgeToolModule } from "./types.js";

const execFileAsync = promisify(execFile);

const moduleRegistrationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/),
  kind: z.enum(PROJECT_CONTEXT_KINDS),
  topic: z.enum(PROJECT_CONTEXT_TOPICS).optional(),
  area: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/).optional(),
  description: z.string().min(1).max(300),
  stages: z.array(z.enum(SKILL_STAGES)).max(6).default([]),
  domains: z.array(z.enum(SKILL_DOMAINS)).max(8).default([]),
  actions: z.array(z.enum(SKILL_ACTIONS)).max(12).default([]),
  artifacts: z.array(z.enum(SKILL_ARTIFACTS)).max(12).default([]),
  needs: z.array(z.enum(SKILL_NEEDS)).max(12).default([]),
  signals: z.array(z.enum(SKILL_SIGNALS)).max(12).default([]),
  required: z.boolean().default(false),
  priority: z.number().int().min(-100).max(100).default(0),
  maxChars: z.number().int().min(200).max(80_000).optional(),
  exclusiveGroup: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/).optional(),
}).strict().refine((value) => !(value.required && value.exclusiveGroup), {
  message: "Required project-context modules cannot belong to an exclusive group.",
});

async function pathExists(filePath: string): Promise<boolean> {
  try { await fs.stat(filePath); return true; } catch { return false; }
}

async function auditOneProject(projectRootInput: string) {
  const projectRoot = path.resolve(projectRootInput);
  const agents = await pathExists(path.join(projectRoot, "AGENTS.md")) || await pathExists(path.join(projectRoot, "AGENTS.override.md"));
  const mssrDirExists = await pathExists(path.join(projectRoot, ".mssr"));
  const health = await auditMssrProjectContextHealth(projectRoot);
  const initialized = health.manifestStatus === "valid";
  const authorityStatus = !initialized
    ? health.manifestStatus === "invalid" ? "invalid" : (agents || mssrDirExists ? "not-initialized" : "unmanaged")
    : health.level === "review" ? "review"
    : health.level === "watch" ? "watch"
    : "modular";
  const maintenanceRecommended = authorityStatus === "invalid" || authorityStatus === "review" || authorityStatus === "not-initialized";
  const nextAction = authorityStatus === "not-initialized"
    ? "Run project_context_initialize before relying on MSSR project knowledge. Initialization creates only bounded skeleton/control files; it does not invent project architecture or decisions."
    : authorityStatus === "invalid"
      ? "Repair or re-initialize .mssr/project-context.json before loading or writing durable project knowledge."
      : authorityStatus === "review"
        ? "Review Project Context Health findings and update/split/index only the canonical .mssr owner indicated by the evidence."
        : authorityStatus === "watch"
          ? "Project context remains usable; review the WATCH findings during normal maintenance rather than interrupting current work."
          : null;
  return {
    projectRoot,
    agents,
    projectHome: { canonicalDir: path.join(projectRoot, ".mssr"), canonicalDirExists: mssrDirExists },
    initialized,
    manifestStatus: health.manifestStatus,
    authorityStatus,
    maintenanceRecommended,
    nextAction,
    health,
  };
}

async function auditWorkspaceProjectContexts(workspaceRootInput: string, includeUnmanaged: boolean, maxDepth: number) {
  const workspaceRoot = resolveToolPath(workspaceRootInput, { access: "read" });
  const stat = await fs.stat(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`workspaceRoot is not a directory: ${workspaceRoot}`);
  const roots = await discoverMssrWorkspaceRepositories(workspaceRoot, maxDepth);
  const projects = [];
  for (const projectRoot of roots) {
    const audited = await auditOneProject(projectRoot);
    if (includeUnmanaged || audited.authorityStatus !== "unmanaged") projects.push(audited);
  }
  projects.sort((a, b) => a.projectRoot.localeCompare(b.projectRoot));
  const counts = projects.reduce((acc, project) => {
    acc[project.authorityStatus] = (acc[project.authorityStatus] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return {
    workspaceRoot,
    maxDepth,
    discoveredGitRepositories: roots.length,
    projectCount: projects.length,
    counts,
    maintenanceRecommended: projects.filter((project) => project.maintenanceRecommended).map((project) => project.projectRoot),
    policy: "Audit is read-only and canonical-only. Missing/invalid MSSR initialization or Project Context Health debt is evidence for an explicit maintenance action, never permission to read .bridge fallback or synthesize project truth.",
    projects,
  };
}

async function gitChangedPaths(projectRoot: string, scope: "working-tree" | "staged"): Promise<string[]> {
  if (scope === "staged") {
    const { stdout } = await execFileAsync("git", ["diff", "--cached", "--name-only", "--no-renames"], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.replace(/\\/g, "/"));
  }
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
    const body = line.length > 3 ? line.slice(3) : line;
    const renamed = body.includes(" -> ") ? body.split(" -> ").at(-1)! : body;
    return renamed.replace(/^"|"$/g, "").replace(/\\/g, "/");
  });
}

async function readPackageVersion(projectRoot: string): Promise<string | null> {
  const packagePath = path.join(projectRoot, "package.json");
  if (!(await pathExists(packagePath))) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(packagePath, "utf8"));
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function auditProjectChangeConsistency(projectRootInput: string, mode: "review" | "persist", scope: "working-tree" | "staged") {
  const projectRoot = resolveToolPath(projectRootInput, { access: "read" });
  if (!(await pathExists(path.join(projectRoot, ".git")))) throw new Error(`projectRoot is not a Git repository: ${projectRoot}`);
  const version = await readPackageVersion(projectRoot);
  const changedPaths = await gitChangedPaths(projectRoot, scope);
  const authority = await auditOneProject(projectRoot);
  const changelogPath = version ? path.join(projectRoot, "changelogs", `${version}.md`) : null;
  const indexPath = path.join(projectRoot, "changelogs", "INDEX.md");
  let changelog = null;
  let changelogParseError: string | null = null;
  if (changelogPath && await pathExists(changelogPath)) {
    try { changelog = parseVersionChangelogMarkdown(await fs.readFile(changelogPath, "utf8")); }
    catch (error) { changelogParseError = error instanceof Error ? error.message : String(error); }
  }
  const indexText = await pathExists(indexPath) ? await fs.readFile(indexPath, "utf8") : "";
  const indexContainsVersion = Boolean(version && new RegExp(`(?:^|\\W)${version.replace(/\./g, "\\.")}(?:\\W|$)`).test(indexText));
  const base = evaluateProjectChangeConsistency({
    packageVersion: version,
    changelog,
    indexContainsVersion,
    changedPaths,
    authorityPaths: {
      context: mssrProjectRelativePath(MSSR_PROJECT_AUTHORITY_FILES.context),
      memory: mssrProjectRelativePath(MSSR_PROJECT_AUTHORITY_FILES.memory),
      state: mssrProjectRelativePath(MSSR_PROJECT_AUTHORITY_FILES.state),
    },
  });
  const issues = [...base.issues];
  if (changelogParseError) issues.push({ code: "invalid-version-changelog", severity: "error" as const, message: changelogParseError });
  if (!await pathExists(indexPath)) issues.push({ code: "missing-changelog-index", severity: "error" as const, message: "Missing changelogs/INDEX.md." });

  const currentChangelogRelative = version ? `changelogs/${version}.md`.toLowerCase() : null;
  const substantiveChangedPaths = changedPaths.filter((item) => {
    const normalized = item.toLowerCase();
    return !normalized.startsWith("changelogs/") && !normalized.startsWith(".mssr/") && normalized !== "changelog.md";
  });
  if (substantiveChangedPaths.length > 0 && currentChangelogRelative && !changedPaths.some((item) => item.toLowerCase() === currentChangelogRelative)) {
    issues.push({
      code: "current-version-changelog-not-updated",
      severity: mode === "persist" ? "error" as const : "warning" as const,
      message: `Substantive Git changes exist but ${currentChangelogRelative} is not in the observed change set. Add a bounded release summary before persistence.`,
    });
  }
  if (!authority.initialized || authority.health.level === "review") {
    issues.push({
      code: "project-authority-maintenance-due",
      severity: mode === "persist" ? "error" as const : "warning" as const,
      message: authority.nextAction ?? `Project authority status is ${authority.authorityStatus}.`,
    });
  }

  const maintenanceAdvisory = evaluateMssrProjectKnowledgeMaintenance({
    changedPaths,
    toolNames: [],
    materialWrites: substantiveChangedPaths.length,
    packageChanged: changedPaths.some((item) => ["package.json", "package-lock.json"].includes(item.toLowerCase())),
    runtimeChanged: false,
    routingChanged: changedPaths.some((item) => item.toLowerCase().includes("skill-routing") || item.toLowerCase().includes("host-adapter-contract")),
    skillStructureChanged: changedPaths.some((item) => /(?:^|\/)skills\/[^/]+\/(?:skill\.md|context-modules\.json|references\/)/i.test(item.replace(/\\/g, "/"))),
    contextFreshnessIssues: 0,
    projectInitialized: authority.initialized,
    projectContextHealth: authority.health.level,
    userCorrections: 0,
  });
  if (maintenanceAdvisory.level === "required") {
    issues.push({ code: "project-knowledge-review-required", severity: "error" as const, message: `MSSR project-knowledge review is required for: ${maintenanceAdvisory.targets.map((target) => `${target.target}:${target.level}`).join(", ")}.` });
  } else if (maintenanceAdvisory.level === "review") {
    issues.push({ code: "project-knowledge-review-due", severity: "warning" as const, message: `MSSR recommends a reviewed project-knowledge pass for: ${maintenanceAdvisory.targets.map((target) => target.target).join(", ")}. This advisory does not auto-write any authority.` });
  }

  return {
    projectRoot,
    mode,
    scope,
    packageVersion: version,
    changedPaths: changedPaths.slice(0, 300),
    substantiveChangedPaths: substantiveChangedPaths.slice(0, 300),
    changelog: { path: changelogPath, indexPath, parsed: changelog, parseError: changelogParseError, indexContainsVersion },
    projectAuthority: authority,
    maintenanceAdvisory,
    ok: !issues.some((issue) => issue.severity === "error"),
    publishReady: mode === "persist" && !issues.some((issue) => issue.severity === "error"),
    issues,
    policy: "Every release must summarize substantive changes and explicitly declare PROJECT_CONTEXT/PROJECT_MEMORY/PROJECT_STATE impact. Project context must also be initialized and free of REVIEW-level structural debt. The gate never writes memory or changelogs automatically.",
  };
}

const captureJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
    topic: { type: "string", enum: [...PROJECT_CONTEXT_TOPICS] },
    area: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,79}$" },
    title: { type: "string", minLength: 1, maxLength: 160 },
    content: { type: "string", minLength: 1, maxLength: 20000 },
    kind: { type: "string", enum: [...PROJECT_CONTEXT_KINDS] },
    description: { type: "string", minLength: 1, maxLength: 300 },
    stages: { type: "array", items: { type: "string", enum: [...SKILL_STAGES] }, maxItems: 6, default: [] },
    domains: { type: "array", items: { type: "string", enum: [...SKILL_DOMAINS] }, maxItems: 8, default: [] },
    actions: { type: "array", items: { type: "string", enum: [...SKILL_ACTIONS] }, maxItems: 12, default: [] },
    artifacts: { type: "array", items: { type: "string", enum: [...SKILL_ARTIFACTS] }, maxItems: 12, default: [] },
    needs: { type: "array", items: { type: "string", enum: [...SKILL_NEEDS] }, maxItems: 12, default: [] },
    signals: { type: "array", items: { type: "string", enum: [...SKILL_SIGNALS] }, maxItems: 12, default: [] },
    required: { type: "boolean", default: false },
    priority: { type: "number", minimum: -100, maximum: 100, default: 20 },
    maxChars: { type: "number", minimum: 200, maximum: 20000 },
    exclusiveGroup: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
  },
  required: ["id", "topic", "title", "content"],
  additionalProperties: false,
} as const;

export const projectContextToolModule: BridgeToolModule = {
  name: "project-context",
  tools: [
    {
      name: "project_context_audit",
      description: "Read-only recursive governance audit for MSSR project knowledge under one workspace root. Uses portable MSSR repository discovery and Project Context Health; reports initialized/modular, watch/review, invalid, not-initialized or unmanaged repositories. It never reads .bridge as active project authority and never creates or rewrites project knowledge.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Workspace containing Git repositories, for example D:\\Dev." },
          includeUnmanaged: { type: "boolean", default: false },
          maxDepth: { type: "number", minimum: 0, maximum: 6, default: 2 },
        },
        required: ["workspaceRoot"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_context_health",
      description: "Run portable MSSR Project Context Health for one repository. Reports ok/watch/review plus missing/invalid initialization, legacy MSSR artifacts, oversized authorities/modules, missing sources and unindexed .mssr/knowledge files. Read-only and advisory.",
      inputSchema: { type: "object", properties: { projectRoot: { type: "string" } }, required: ["projectRoot"], additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_context_modularization_plan",
      description: "Read-only MSSR planner for Project Context Health pressure. It proposes exact hash-addressed moves of already-indexed sections from growing PROJECT_* authorities into .mssr/knowledge/<topic>/, preserves parent selectors/kind, identifies core decisions separately, and lists large unindexed sections for review. It never mutates or semantically rewrites project knowledge.",
      inputSchema: { type: "object", properties: { projectRoot: { type: "string" } }, required: ["projectRoot"], additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_context_initialize",
      description: "Explicitly initialize or normalize the canonical MSSR project-context contract for one repository or a recursively discovered workspace. Creates only bounded .mssr control skeletons when missing, separates .mssr/knowledge from .mssr/runtime, and can remove only the bounded set of known old MSSR-owned .bridge artifacts. Durable legacy data is never erased when no canonical counterpart exists; such cleanup blocks for review. Unrelated Bridge-specific .bridge content is never touched.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string" },
          scope: { type: "string", enum: ["project", "workspace"], default: "project" },
          initializeMissing: { type: "boolean", default: true },
          cleanupLegacyArtifacts: { type: "boolean", default: true },
          maxDepth: { type: "number", minimum: 0, maximum: 6, default: 2 },
        },
        required: ["root"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_change_consistency",
      description: "Read-only post-change gate for one Git repository. Compares the current package version, changelog contract, Git change set, canonical .mssr authorities, initialization state and Project Context Health. In persist mode unresolved release/authority debt blocks publish readiness. It never writes project knowledge or changelogs.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          mode: { type: "string", enum: ["review", "persist"], default: "review" },
          scope: { type: "string", enum: ["working-tree", "staged"], default: "working-tree" },
        },
        required: ["projectRoot"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_context_update",
      description: "Safely upsert one stable Markdown section in an already initialized canonical .mssr/PROJECT_CONTEXT.md, PROJECT_MEMORY.md, or PROJECT_STATE.md. Supports optimistic concurrency and optional module registration. It never reads .bridge fallback and refuses to create an ad-hoc project contract; run project_context_initialize first.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          kind: { type: "string", enum: [...PROJECT_KNOWLEDGE_KINDS] },
          heading: { type: "string", pattern: "^#{1,6}\\s+\\S(?:.*\\S)?$", maxLength: 160 },
          content: { type: "string", maxLength: 80000 },
          expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
          module: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
              kind: { type: "string", enum: [...PROJECT_CONTEXT_KINDS] },
              topic: { type: "string", enum: [...PROJECT_CONTEXT_TOPICS] },
              area: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,79}$" },
              description: { type: "string", minLength: 1, maxLength: 300 },
              stages: { type: "array", items: { type: "string", enum: [...SKILL_STAGES] }, maxItems: 6, default: [] },
              domains: { type: "array", items: { type: "string", enum: [...SKILL_DOMAINS] }, maxItems: 8, default: [] },
              actions: { type: "array", items: { type: "string", enum: [...SKILL_ACTIONS] }, maxItems: 12, default: [] },
              artifacts: { type: "array", items: { type: "string", enum: [...SKILL_ARTIFACTS] }, maxItems: 12, default: [] },
              needs: { type: "array", items: { type: "string", enum: [...SKILL_NEEDS] }, maxItems: 12, default: [] },
              signals: { type: "array", items: { type: "string", enum: [...SKILL_SIGNALS] }, maxItems: 12, default: [] },
              required: { type: "boolean", default: false },
              priority: { type: "number", minimum: -100, maximum: 100, default: 0 },
              maxChars: { type: "number", minimum: 200, maximum: 80000 },
              exclusiveGroup: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
            },
            required: ["id", "kind", "description"],
            additionalProperties: false,
          },
        },
        required: ["projectRoot", "kind", "heading", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "project_context_capture",
      description: "Persist one reviewed durable project statement as an indexed .mssr/knowledge/<topic>/ module. Portable MSSR plans the topic/kind/path/module; Bridge performs a hash-checked content+manifest transaction with rollback. Existing targets require expectedTargetSha256. Never use for raw conversations, hidden reasoning, secrets, large logs or transient tool output.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          capture: captureJsonSchema,
          expectedTargetSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
          expectedManifestSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        },
        required: ["projectRoot", "capture"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    project_context_audit: async (raw) => {
      const parsed = z.object({ workspaceRoot: z.string().min(1), includeUnmanaged: z.boolean().default(false), maxDepth: z.number().int().min(0).max(6).default(2) }).strict().parse(raw);
      return await auditWorkspaceProjectContexts(parsed.workspaceRoot, parsed.includeUnmanaged, parsed.maxDepth);
    },
    project_context_health: async (raw) => {
      const parsed = z.object({ projectRoot: z.string().min(1) }).strict().parse(raw);
      const projectRoot = resolveToolPath(parsed.projectRoot, { access: "read" });
      return await auditMssrProjectContextHealth(projectRoot);
    },
    project_context_modularization_plan: async (raw) => {
      const parsed = z.object({ projectRoot: z.string().min(1) }).strict().parse(raw);
      const projectRoot = resolveToolPath(parsed.projectRoot, { access: "read" });
      return await planMssrProjectContextModularization(projectRoot);
    },
    project_context_initialize: async (raw) => {
      const parsed = z.object({
        root: z.string().min(1),
        scope: z.enum(["project", "workspace"]).default("project"),
        initializeMissing: z.boolean().default(true),
        cleanupLegacyArtifacts: z.boolean().default(true),
        maxDepth: z.number().int().min(0).max(6).default(2),
      }).strict().parse(raw);
      const root = resolveToolPath(parsed.root, { access: "write" });
      return parsed.scope === "workspace"
        ? await initializeMssrWorkspace(root, { initializeMissing: parsed.initializeMissing, cleanupLegacyArtifacts: parsed.cleanupLegacyArtifacts, maxDepth: parsed.maxDepth })
        : await initializeMssrProject(root, { initializeMissing: parsed.initializeMissing, cleanupLegacyArtifacts: parsed.cleanupLegacyArtifacts });
    },
    project_change_consistency: async (raw) => {
      const parsed = z.object({ projectRoot: z.string().min(1), mode: z.enum(["review", "persist"]).default("review"), scope: z.enum(["working-tree", "staged"]).default("working-tree") }).strict().parse(raw);
      return await auditProjectChangeConsistency(parsed.projectRoot, parsed.mode, parsed.scope);
    },
    project_context_update: async (raw) => {
      const parsed = z.object({
        projectRoot: z.string().min(1),
        kind: z.enum(PROJECT_KNOWLEDGE_KINDS),
        heading: z.string().regex(/^#{1,6}\s+\S(?:.*\S)?$/).max(160),
        content: z.string().max(80_000),
        expectedSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        module: moduleRegistrationSchema.optional(),
      }).strict().parse(raw);
      return await updateProjectContextSection(parsed);
    },
    project_context_capture: async (raw) => {
      const parsed = z.object({
        projectRoot: z.string().min(1),
        capture: mssrProjectKnowledgeCaptureInputSchema,
        expectedTargetSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        expectedManifestSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
      }).strict().parse(raw);
      const projectRoot = resolveToolPath(parsed.projectRoot, { access: "write" });
      return await captureProjectKnowledge({ ...parsed, projectRoot });
    },
  },
};
