import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  PROJECT_KNOWLEDGE_KINDS,
  PROJECT_CONTEXT_KINDS,
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_SIGNALS,
  SKILL_STAGES,
  evaluateProjectChangeConsistency,
  parseVersionChangelogMarkdown,
  projectContextManifestSchema,
} from "@mauroprime/mssr";
import { updateProjectContextSection } from "../project-context-writer.js";
import { resolveToolPath } from "./shared/path.js";
import type { BridgeToolModule } from "./types.js";

const execFileAsync = promisify(execFile);

const moduleRegistrationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/),
  kind: z.enum(PROJECT_CONTEXT_KINDS),
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
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function auditOneProject(projectRoot: string) {
  const agents = await pathExists(path.join(projectRoot, "AGENTS.md")) || await pathExists(path.join(projectRoot, "AGENTS.override.md"));
  const bridgeDir = path.join(projectRoot, ".bridge");
  const bridgeDirExists = await pathExists(bridgeDir);
  const knowledgeFiles = ["PROJECT_CONTEXT.md", "PROJECT_MEMORY.md", "PROJECT_STATE.md"];
  const existingKnowledgeFiles = bridgeDirExists
    ? (await Promise.all(knowledgeFiles.map(async (name) => (await pathExists(path.join(bridgeDir, name))) ? name : null))).filter((name): name is string => Boolean(name))
    : [];
  const manifestPath = path.join(bridgeDir, "project-context.json");
  let manifestStatus: "missing" | "valid" | "invalid" = "missing";
  let coreEntries = 0;
  let modules = 0;
  let manifestError: string | null = null;
  if (await pathExists(manifestPath)) {
    try {
      const manifest = projectContextManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")));
      manifestStatus = "valid";
      coreEntries = manifest.core.length;
      modules = manifest.modules.length;
    } catch (error) {
      manifestStatus = "invalid";
      manifestError = error instanceof Error ? error.message : String(error);
    }
  }

  const authorityStatus = manifestStatus === "valid"
    ? "modular"
    : manifestStatus === "invalid"
      ? "invalid"
      : existingKnowledgeFiles.length > 0
        ? "legacy"
        : bridgeDirExists
          ? "empty-bridge"
          : agents
            ? "not-initialized"
            : "unmanaged";
  const maintenanceRecommended = authorityStatus === "legacy" || authorityStatus === "invalid" || authorityStatus === "empty-bridge";
  const nextAction = authorityStatus === "legacy"
    ? "Register stable existing PROJECT_* sections into .bridge/project-context.json; keep legacy text as source until migrated and verified."
    : authorityStatus === "invalid"
      ? "Repair the manifest against the canonical MSSR schema before relying on modular retrieval."
      : authorityStatus === "empty-bridge"
        ? "Either remove the unused empty .bridge directory or initialize deliberate project context/state through project_context_update; do not create synthetic memory automatically."
        : authorityStatus === "not-initialized"
          ? "No project-memory authority is configured. Initialize it only if this repository needs durable cross-session project facts/state."
          : null;

  return {
    projectRoot,
    agents,
    bridgeDir: bridgeDirExists,
    knowledgeFiles: existingKnowledgeFiles,
    manifestStatus,
    manifestPath,
    coreEntries,
    modules,
    authorityStatus,
    maintenanceRecommended,
    nextAction,
    ...(manifestError ? { manifestError } : {}),
  };
}

async function auditWorkspaceProjectContexts(workspaceRootInput: string, includeUnmanaged: boolean) {
  const workspaceRoot = resolveToolPath(workspaceRootInput, { access: "read" });
  const stat = await fs.stat(workspaceRoot);
  if (!stat.isDirectory()) throw new Error(`workspaceRoot is not a directory: ${workspaceRoot}`);
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectRoot = path.join(workspaceRoot, entry.name);
    if (!(await pathExists(path.join(projectRoot, ".git")))) continue;
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
    projectCount: projects.length,
    counts,
    maintenanceRecommended: projects.filter((project) => project.maintenanceRecommended).map((project) => project.projectRoot),
    policy: "Audit is read-only. Missing modular context is evidence, not permission to invent or rewrite project memory. Use project_context_update for deliberate stable-section writes and module registration.",
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
  const gitDir = path.join(projectRoot, ".git");
  if (!(await pathExists(gitDir))) throw new Error(`projectRoot is not a Git repository: ${projectRoot}`);
  const version = await readPackageVersion(projectRoot);
  const changedPaths = await gitChangedPaths(projectRoot, scope);
  const authority = await auditOneProject(projectRoot);
  const changelogPath = version ? path.join(projectRoot, "changelogs", `${version}.md`) : null;
  const indexPath = path.join(projectRoot, "changelogs", "INDEX.md");
  let changelog = null;
  let changelogParseError: string | null = null;
  if (changelogPath && await pathExists(changelogPath)) {
    try {
      changelog = parseVersionChangelogMarkdown(await fs.readFile(changelogPath, "utf8"));
    } catch (error) {
      changelogParseError = error instanceof Error ? error.message : String(error);
    }
  }
  const indexText = await pathExists(indexPath) ? await fs.readFile(indexPath, "utf8") : "";
  const indexContainsVersion = Boolean(version && new RegExp(`(?:^|\\W)${version.replace(/\./g, "\\.")}(?:\\W|$)`).test(indexText));
  const base = evaluateProjectChangeConsistency({
    packageVersion: version,
    changelog,
    indexContainsVersion,
    changedPaths,
    authorityPaths: {
      context: ".bridge/PROJECT_CONTEXT.md",
      memory: ".bridge/PROJECT_MEMORY.md",
      state: ".bridge/PROJECT_STATE.md",
    },
  });
  const issues = [...base.issues];
  if (changelogParseError) issues.push({ code: "invalid-version-changelog", severity: "error" as const, message: changelogParseError });
  if (!await pathExists(indexPath)) issues.push({ code: "missing-changelog-index", severity: "error" as const, message: "Missing changelogs/INDEX.md." });

  const currentChangelogRelative = version ? `changelogs/${version}.md`.toLowerCase() : null;
  const substantiveChangedPaths = changedPaths.filter((item) => {
    const normalized = item.toLowerCase();
    return !normalized.startsWith("changelogs/") && !normalized.startsWith(".bridge/") && normalized !== "changelog.md";
  });
  if (substantiveChangedPaths.length > 0 && currentChangelogRelative && !changedPaths.some((item) => item.toLowerCase() === currentChangelogRelative)) {
    issues.push({
      code: "current-version-changelog-not-updated",
      severity: mode === "persist" ? "error" as const : "warning" as const,
      message: `Substantive Git changes exist but ${currentChangelogRelative} is not in the observed change set. Add a bounded release summary before persistence.`,
    });
  }
  if (["legacy", "invalid", "empty-bridge"].includes(authority.authorityStatus)) {
    issues.push({
      code: "project-authority-maintenance-due",
      severity: mode === "persist" ? "error" as const : "warning" as const,
      message: authority.nextAction ?? `Project authority status is ${authority.authorityStatus}.`,
    });
  }

  return {
    projectRoot,
    mode,
    scope,
    packageVersion: version,
    changedPaths: changedPaths.slice(0, 300),
    substantiveChangedPaths: substantiveChangedPaths.slice(0, 300),
    changelog: {
      path: changelogPath,
      indexPath,
      parsed: changelog,
      parseError: changelogParseError,
      indexContainsVersion,
    },
    projectAuthority: authority,
    ok: !issues.some((issue) => issue.severity === "error"),
    publishReady: mode === "persist" && !issues.some((issue) => issue.severity === "error"),
    issues,
    policy: "Every release must summarize substantive changes and explicitly declare PROJECT_CONTEXT/PROJECT_MEMORY/PROJECT_STATE impact. 'reviewed-none' is an explicit review result; 'pending' blocks persistence. The gate never writes memory or changelogs automatically.",
  };
}

export const projectContextToolModule: BridgeToolModule = {
  name: "project-context",
  tools: [
    {
      name: "project_context_audit",
      description: "Read-only governance audit for project-memory/context authorities under one workspace root. Scans immediate Git repositories, validates .bridge/project-context.json against the canonical MSSR schema, distinguishes modular, legacy, invalid, empty-bridge, not-initialized and unmanaged projects, and reports migration/maintenance debt without creating or rewriting memory.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceRoot: { type: "string", description: "Workspace containing project repositories as immediate child directories, for example D:\\Dev." },
          includeUnmanaged: { type: "boolean", default: false, description: "Include Git repositories that have neither AGENTS nor .bridge project-memory authorities." },
        },
        required: ["workspaceRoot"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_change_consistency",
      description: "Read-only post-change gate for one Git repository. Compares the current package version, changelogs/<version>.md, changelogs/INDEX.md, a working-tree or staged Git change set, and .bridge project-knowledge authorities. In persist mode, substantive changes without a current release summary, pending PROJECT_* impact, invalid/missing changelog structure, or unresolved legacy project authority block publish readiness. Use scope=staged for the final commit gate when unrelated parallel work exists. It never writes memory or changelogs automatically.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Git repository root to audit." },
          mode: { type: "string", enum: ["review", "persist"], default: "review", description: "review emits advisory drift warnings; persist upgrades release/memory governance debt into a publication gate." },
          scope: { type: "string", enum: ["working-tree", "staged"], default: "working-tree", description: "Git evidence set. Use staged for the final commit/publish gate so unrelated working-tree changes from another task are not attributed to this release." },
        },
        required: ["projectRoot"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "project_context_update",
      description: "Safely upsert one stable Markdown section in .bridge/PROJECT_CONTEXT.md, PROJECT_MEMORY.md, or PROJECT_STATE.md. Supports optimistic concurrency with expectedSha256 and can atomically create/update the corresponding .bridge/project-context.json module metadata so a context, memory, state, or scoped directive becomes selectable by MSSR. Use for deliberate durable project-memory maintenance, not raw transcripts, logs, secrets, or broad repository rules that belong in AGENTS.md.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Repository root containing or receiving the .bridge project knowledge files." },
          kind: { type: "string", enum: [...PROJECT_KNOWLEDGE_KINDS], description: "Physical durable knowledge file to update: context=facts, memory=decisions/lessons, state=mutable current status." },
          heading: { type: "string", pattern: "^#{1,6}\\s+\\S(?:.*\\S)?$", maxLength: 160, description: "Exact stable Markdown heading used as the section identity, for example '## Broad refactor safety'." },
          content: { type: "string", maxLength: 80000, description: "Replacement body for the section. Upsert is idempotent by exact heading; duplicate headings fail closed." },
          expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$", description: "Optional optimistic concurrency hash of the current target Markdown file. A mismatch aborts without writing." },
          module: {
            type: "object",
            description: "Optional MSSR module registration. Source path/section are derived from kind+heading and cannot be overridden. Use kind=directive only for narrow project-specific conditional instructions; broad permanent rules belong in AGENTS.md.",
            properties: {
              id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
              kind: { type: "string", enum: [...PROJECT_CONTEXT_KINDS] },
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
  ],
  handlers: {
    project_context_audit: async (raw) => {
      const parsed = z.object({
        workspaceRoot: z.string().min(1),
        includeUnmanaged: z.boolean().default(false),
      }).strict().parse(raw);
      return await auditWorkspaceProjectContexts(parsed.workspaceRoot, parsed.includeUnmanaged);
    },
    project_change_consistency: async (raw) => {
      const parsed = z.object({
        projectRoot: z.string().min(1),
        mode: z.enum(["review", "persist"]).default("review"),
        scope: z.enum(["working-tree", "staged"]).default("working-tree"),
      }).strict().parse(raw);
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
  },
};
