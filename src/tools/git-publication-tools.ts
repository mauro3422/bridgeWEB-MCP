import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveToolPath, runProcess, runShellCommand, summarizeCommand, tailText } from "./shared/process.js";
import type { BridgeToolModule } from "./types.js";

const MAX_REPOSITORIES = 24;
const MAX_PATH_RULES = 512;
const MAX_VALIDATIONS = 12;
const APPLY_CONFIRMATION = "apply-listed-repositories";
const PUSH_CONFIRMATION = "push-listed-repositories";

const validationSchema = z.object({
  command: z.string().min(1).max(2_000),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
}).strict();

const pathPolicySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("explicit"),
    includePaths: z.array(z.string().min(1).max(500)).min(1).max(MAX_PATH_RULES),
    excludePaths: z.array(z.string().min(1).max(500)).max(MAX_PATH_RULES).default([]),
  }).strict(),
  z.object({
    mode: z.literal("staged-only"),
  }).strict(),
]);

const remoteSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).default("origin"),
  policy: z.enum(["optional", "required", "local-only"]).default("optional"),
  push: z.boolean().default(false),
  branch: z.string().regex(/^[A-Za-z0-9._\/-]{1,240}$/).optional(),
}).strict().default({ name: "origin", policy: "optional", push: false });

const repositorySchema = z.object({
  cwd: z.string().min(1).max(1_000),
  expectedHead: z.string().regex(/^[0-9a-fA-F]{40,64}$/).optional(),
  message: z.string().min(1).max(500),
  pathPolicy: pathPolicySchema,
  validations: z.array(validationSchema).max(MAX_VALIDATIONS).default([]),
  remote: remoteSchema,
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  repositories: z.array(repositorySchema).min(1).max(MAX_REPOSITORIES),
  continueOnFailure: z.boolean().default(false),
}).strict();

type PublicationManifest = z.infer<typeof manifestSchema>;
type RepositorySpec = z.infer<typeof repositorySchema>;

type GitCommandResult = Record<string, unknown>;

type RepositoryOutcome = {
  cwd: string;
  status: "ready" | "published" | "committed-local-only" | "failed" | "skipped";
  mode: "preflight" | "apply";
  headBefore?: string;
  headAfter?: string;
  branch?: string;
  trackingHead?: string;
  remoteHead?: string;
  changedPaths?: string[];
  includedPaths?: string[];
  excludedPaths?: string[];
  unclassifiedPaths?: string[];
  validations?: Array<Record<string, unknown>>;
  remote?: Record<string, unknown>;
  commit?: Record<string, unknown>;
  warnings?: string[];
  errorCategory?: string;
  error?: string;
};

function resultCode(result: GitCommandResult): number | null {
  return typeof result.code === "number" ? result.code : null;
}

function resultStdout(result: GitCommandResult): string {
  return String(result.stdout ?? "");
}

function resultStderr(result: GitCommandResult): string {
  return String(result.stderr ?? "");
}

function commandFailure(label: string, result: GitCommandResult): Error {
  const detail = tailText(resultStderr(result) || resultStdout(result), 4_000).trim();
  return new Error(`${label} failed with code ${String(result.code)}${detail ? `: ${detail}` : "."}`);
}

async function git(cwd: string, args: string[], stdin?: string | Buffer): Promise<GitCommandResult> {
  return await runProcess("git", args, cwd, 120_000, stdin);
}

async function gitRequired(cwd: string, args: string[], label: string, stdin?: string | Buffer): Promise<GitCommandResult> {
  const result = await git(cwd, args, stdin);
  if (resultCode(result) !== 0 || result.timedOut === true) throw commandFailure(label, result);
  return result;
}

function parseNul(text: string): string[] {
  return text.split("\0").map((item) => item.trim()).filter(Boolean);
}

function normalizeRepositoryPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`[safety-guard] Repository path must be a safe relative path: ${value}`);
  }
  return normalized;
}

function pathRuleMatches(candidate: string, rule: string): boolean {
  return candidate === rule || candidate.startsWith(`${rule}/`);
}

function matchesAny(candidate: string, rules: string[]): boolean {
  return rules.some((rule) => pathRuleMatches(candidate, rule));
}

async function assertSafeRepositoryPath(cwd: string, relative: string): Promise<void> {
  resolveToolPath(path.resolve(cwd, relative), { access: "read" });
}

async function listChangedPaths(cwd: string) {
  const [worktreeResult, stagedResult, untrackedResult] = await Promise.all([
    gitRequired(cwd, ["diff", "--name-only", "-z", "--no-ext-diff"], "git diff"),
    gitRequired(cwd, ["diff", "--cached", "--name-only", "-z", "--no-ext-diff"], "git diff --cached"),
    gitRequired(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], "git ls-files --others"),
  ]);
  const worktree = parseNul(resultStdout(worktreeResult)).map(normalizeRepositoryPath);
  const staged = parseNul(resultStdout(stagedResult)).map(normalizeRepositoryPath);
  const untracked = parseNul(resultStdout(untrackedResult)).map(normalizeRepositoryPath);
  const all = [...new Set([...worktree, ...staged, ...untracked])].sort();
  for (const item of all) await assertSafeRepositoryPath(cwd, item);
  return { worktree, staged, untracked, all };
}

function classifyPaths(spec: RepositorySpec, changed: Awaited<ReturnType<typeof listChangedPaths>>) {
  if (spec.pathPolicy.mode === "staged-only") {
    const unclassified = [...new Set([...changed.worktree, ...changed.untracked])].sort();
    return {
      included: [...new Set(changed.staged)].sort(),
      excluded: [] as string[],
      unclassified,
    };
  }
  const includeRules = spec.pathPolicy.includePaths.map(normalizeRepositoryPath);
  const excludeRules = spec.pathPolicy.excludePaths.map(normalizeRepositoryPath);
  const included: string[] = [];
  const excluded: string[] = [];
  const unclassified: string[] = [];
  for (const candidate of changed.all) {
    if (matchesAny(candidate, excludeRules)) excluded.push(candidate);
    else if (matchesAny(candidate, includeRules)) included.push(candidate);
    else unclassified.push(candidate);
  }
  const excludedStaged = changed.staged.filter((candidate) => matchesAny(candidate, excludeRules));
  if (excludedStaged.length > 0) {
    throw new Error(`[stale-file-state] Excluded paths are already staged: ${excludedStaged.join(", ")}. Unstage them before retrying.`);
  }
  return { included, excluded, unclassified };
}

async function currentHead(cwd: string): Promise<string> {
  const result = await gitRequired(cwd, ["rev-parse", "HEAD"], "git rev-parse HEAD");
  return resultStdout(result).trim();
}

async function currentBranch(cwd: string): Promise<string> {
  const result = await gitRequired(cwd, ["branch", "--show-current"], "git branch --show-current");
  const branch = resultStdout(result).trim();
  if (!branch) throw new Error("[stale-file-state] Repository is in detached HEAD state; publication requires a named branch.");
  return branch;
}

async function remoteUrl(cwd: string, name: string): Promise<string | null> {
  const result = await git(cwd, ["remote", "get-url", name]);
  return resultCode(result) === 0 ? resultStdout(result).trim() : null;
}

async function runValidations(cwd: string, validations: RepositorySpec["validations"]) {
  const results: Array<Record<string, unknown>> = [];
  for (const validation of validations) {
    const result = await runShellCommand(validation.command, cwd, validation.timeoutMs);
    const summary = { command: validation.command, ...summarizeCommand(result) };
    results.push(summary);
    if (summary.ok !== true) throw new Error(`Validation failed: ${validation.command}`);
  }
  return results;
}

async function loadManifest(args: Record<string, unknown>): Promise<PublicationManifest> {
  const direct = args.manifest;
  const manifestPath = args.manifestPath;
  if (Boolean(direct) === Boolean(manifestPath)) {
    throw new Error("Exactly one of manifest or manifestPath is required.");
  }
  if (manifestPath !== undefined) {
    if (typeof manifestPath !== "string" || !manifestPath.trim()) throw new Error("manifestPath must be a non-empty string.");
    const resolved = resolveToolPath(manifestPath, { access: "read" });
    const parsed = JSON.parse(await fs.readFile(resolved, "utf8"));
    return manifestSchema.parse(parsed);
  }
  return manifestSchema.parse(direct);
}

async function repositoryPreflight(spec: RepositorySpec, mode: "preflight" | "apply") {
  const cwd = resolveToolPath(spec.cwd, { access: "cwd" });
  const inside = await gitRequired(cwd, ["rev-parse", "--is-inside-work-tree"], "git repository preflight");
  if (resultStdout(inside).trim() !== "true") throw new Error(`Not a Git worktree: ${cwd}`);
  const head = await currentHead(cwd);
  if (mode === "apply" && !spec.expectedHead) {
    throw new Error(`[stale-file-state] expectedHead is required in apply mode. Run preflight and copy its exact headBefore value.`);
  }
  if (spec.expectedHead && head.toLowerCase() !== spec.expectedHead.toLowerCase()) {
    throw new Error(`[stale-file-state] HEAD changed. Expected ${spec.expectedHead}, current ${head}. Re-run preflight.`);
  }
  const changed = await listChangedPaths(cwd);
  const classified = classifyPaths(spec, changed);
  if (classified.unclassified.length > 0) {
    throw new Error(`[safety-guard] Unclassified repository paths: ${classified.unclassified.join(", ")}`);
  }
  if (classified.included.length === 0) throw new Error("No included or staged changes are available to publish.");
  const branch = spec.remote.branch ?? await currentBranch(cwd);
  const configuredRemote = await remoteUrl(cwd, spec.remote.name);
  if (spec.remote.policy === "required" && !configuredRemote) {
    throw new Error(`[no-remote-configured] Required Git remote '${spec.remote.name}' is not configured.`);
  }
  if (spec.remote.push && spec.remote.policy === "local-only") {
    throw new Error("[safety-guard] remote.push cannot be true when remote.policy is local-only.");
  }
  const validations = await runValidations(cwd, spec.validations);
  return { cwd, head, branch, configuredRemote, changed, classified, validations };
}

async function applyRepository(spec: RepositorySpec, preflight: Awaited<ReturnType<typeof repositoryPreflight>>): Promise<RepositoryOutcome> {
  const { cwd, head, branch, configuredRemote, changed, classified, validations } = preflight;
  if (spec.pathPolicy.mode === "explicit") {
    const stdin = `${classified.included.join("\0")}\0`;
    await gitRequired(cwd, ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], "git add exact manifest paths", stdin);
  }
  const postStage = await listChangedPaths(cwd);
  const remaining = [...new Set([...postStage.worktree, ...postStage.untracked])].sort();
  if (spec.pathPolicy.mode === "staged-only" && remaining.length > 0) {
    throw new Error(`[stale-file-state] staged-only apply requires a clean unstaged worktree: ${remaining.join(", ")}`);
  }
  if (spec.pathPolicy.mode === "explicit") {
    const excludeRules = spec.pathPolicy.excludePaths.map(normalizeRepositoryPath);
    const unexpectedRemaining = remaining.filter((candidate) => !matchesAny(candidate, excludeRules));
    if (unexpectedRemaining.length > 0) {
      throw new Error(`[stale-file-state] Included paths remained unstaged or new unclassified paths appeared: ${unexpectedRemaining.join(", ")}`);
    }
  }
  const commit = await gitRequired(cwd, ["commit", "-m", spec.message], "git commit");
  const headAfter = await currentHead(cwd);
  if (headAfter === head) throw new Error("[expected-integrity-mismatch] Git commit completed without changing HEAD.");

  const warnings: string[] = [];
  if (!spec.remote.push || spec.remote.policy === "local-only" || !configuredRemote) {
    if (spec.remote.push && !configuredRemote) warnings.push(`[no-remote-configured] Remote '${spec.remote.name}' is absent; commit retained locally.`);
    return {
      cwd,
      mode: "apply",
      status: "committed-local-only",
      headBefore: head,
      headAfter,
      branch,
      changedPaths: changed.all,
      includedPaths: classified.included,
      excludedPaths: classified.excluded,
      validations,
      remote: { name: spec.remote.name, url: configuredRemote, policy: spec.remote.policy, pushed: false },
      warnings,
      commit: summarizeCommand(commit),
    };
  }

  await gitRequired(cwd, ["push", "-u", spec.remote.name, branch], "git push");
  const tracking = await gitRequired(cwd, ["rev-parse", "@{u}"], "git rev-parse tracking branch");
  const trackingHead = resultStdout(tracking).trim();
  const remoteRef = `refs/heads/${branch}`;
  const remote = await gitRequired(cwd, ["ls-remote", "--heads", spec.remote.name, remoteRef], "git ls-remote verification");
  const remoteHead = resultStdout(remote).trim().split(/\s+/)[0] ?? "";
  if (!trackingHead || !remoteHead || headAfter !== trackingHead || headAfter !== remoteHead) {
    throw new Error(`[expected-integrity-mismatch] Publication readback mismatch: HEAD=${headAfter}, tracking=${trackingHead || "missing"}, remote=${remoteHead || "missing"}.`);
  }
  return {
    cwd,
    mode: "apply",
    status: "published",
    headBefore: head,
    headAfter,
    branch,
    trackingHead,
    remoteHead,
    changedPaths: changed.all,
    includedPaths: classified.included,
    excludedPaths: classified.excluded,
    validations,
    remote: { name: spec.remote.name, url: configuredRemote, policy: spec.remote.policy, pushed: true },
  };
}

function categoryFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const explicit = message.match(/^\[([a-z0-9-]+)\]/i)?.[1];
  return explicit ?? "process-exit";
}

async function publishManifest(args: Record<string, unknown>) {
  const mode = args.mode === undefined ? "preflight" : z.enum(["preflight", "apply"]).parse(args.mode);
  const manifest = await loadManifest(args);
  const roots = manifest.repositories.map((item) => resolveToolPath(item.cwd, { access: "cwd" }));
  const duplicates = roots.filter((item, index) => roots.indexOf(item) !== index);
  if (duplicates.length > 0) throw new Error(`[safety-guard] Duplicate repository roots in manifest: ${[...new Set(duplicates)].join(", ")}`);
  const anyPush = manifest.repositories.some((item) => item.remote.push);
  if (mode === "apply") {
    if (args.confirmApply !== APPLY_CONFIRMATION) throw new Error(`[safety-guard] confirmApply must exactly equal '${APPLY_CONFIRMATION}'.`);
    if (anyPush && args.confirmPush !== PUSH_CONFIRMATION) throw new Error(`[safety-guard] confirmPush must exactly equal '${PUSH_CONFIRMATION}' when any repository requests push.`);
  }

  const outcomes: RepositoryOutcome[] = [];
  let stopped = false;
  for (const spec of manifest.repositories) {
    if (stopped) {
      outcomes.push({ cwd: resolveToolPath(spec.cwd, { access: "cwd" }), mode, status: "skipped", error: "Skipped after an earlier repository failed." });
      continue;
    }
    try {
      const preflight = await repositoryPreflight(spec, mode);
      if (mode === "preflight") {
        outcomes.push({
          cwd: preflight.cwd,
          mode,
          status: "ready",
          headBefore: preflight.head,
          branch: preflight.branch,
          changedPaths: preflight.changed.all,
          includedPaths: preflight.classified.included,
          excludedPaths: preflight.classified.excluded,
          unclassifiedPaths: preflight.classified.unclassified,
          validations: preflight.validations,
          remote: {
            name: spec.remote.name,
            url: preflight.configuredRemote,
            policy: spec.remote.policy,
            pushRequested: spec.remote.push,
            outcomeWithoutRemote: spec.remote.policy === "required" ? "failure" : "committed-local-only",
          },
        });
      } else {
        outcomes.push(await applyRepository(spec, preflight));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({
        cwd: resolveToolPath(spec.cwd, { access: "cwd" }),
        mode,
        status: "failed",
        errorCategory: categoryFromError(error),
        error: message,
      });
      if (!manifest.continueOnFailure) stopped = true;
    }
  }

  const successful = outcomes.filter((item) => ["ready", "published", "committed-local-only"].includes(item.status)).length;
  const failed = outcomes.filter((item) => item.status === "failed").length;
  const overallStatus = failed === 0 ? "success" : successful === 0 ? "failed" : "partial";
  return {
    mode,
    overallStatus,
    repositoryCount: outcomes.length,
    successful,
    failed,
    skipped: outcomes.filter((item) => item.status === "skipped").length,
    confirmations: {
      apply: APPLY_CONFIRMATION,
      push: anyPush ? PUSH_CONFIRMATION : null,
    },
    invariants: {
      forcePush: false,
      arbitraryAddAll: false,
      directRemoteVerification: true,
      crossRepositoryAtomicity: false,
    },
    outcomes,
  };
}

export const gitPublicationToolModule: BridgeToolModule = {
  name: "git-publication",
  tools: [{
    name: "git_multi_repo_publish",
    description: "Preflight or apply one bounded manifest-driven Git publication across multiple repositories. Requires explicit path classification or staged-only policy, validates every repository, never force-pushes, preserves no-remote repositories as verified local-only commits, and verifies pushed HEAD/tracking/direct remote refs. Apply mode requires exact confirmation strings and expected HEAD values from preflight.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["preflight", "apply"], default: "preflight" },
        manifest: { type: "object", description: "Inline schemaVersion=1 publication manifest.", additionalProperties: true },
        manifestPath: { type: "string", description: "Allowed local JSON path containing the publication manifest." },
        confirmApply: { type: "string", description: `Required in apply mode; exactly '${APPLY_CONFIRMATION}'.` },
        confirmPush: { type: "string", description: `Required when any repository requests push; exactly '${PUSH_CONFIRMATION}'.` },
      },
      additionalProperties: false,
    },
    metadata: {
      role: "dedicated",
      family: "git",
      lifecycle: "stable",
      usage: {
        prerequisites: [
          "Run mode=preflight first and copy every exact headBefore into expectedHead before apply.",
          "Classify all changed paths explicitly or use staged-only with a clean unstaged worktree.",
          "Use apply only after reviewing all per-repository validations, remote policies, and confirmation strings.",
        ],
        preflightTools: ["git_status", "git_show_commit", "git_compare_branches"],
        recovery: [
          { code: "stale-file-state", toolName: "git_status", instruction: "Reinspect the repository and regenerate the manifest from a fresh preflight; never reuse a stale expectedHead." },
          { code: "no-remote-configured", toolName: "git_status", instruction: "Either configure the intended remote explicitly or choose optional/local-only policy." },
          { code: "expected-integrity-mismatch", toolName: "git_compare_branches", instruction: "Compare local, tracking and remote refs before any retry; do not force-push automatically." },
        ],
      },
    },
  }],
  handlers: {
    git_multi_repo_publish: publishManifest,
  },
};
