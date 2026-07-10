import path from "node:path";
import { z } from "zod";
import { DEFAULT_GIT_REMOTE_URL } from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { assertPathAllowed, resolveToolPath } from "./shared/path.js";
import { runProcess, tailText } from "./shared/process.js";

function assertSafeGitRemote(remote: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) throw new Error(`Unsafe git remote name: ${remote}`);
}

function assertSafeGitHubUrl(repoUrl: string) {
  const parsed = new URL(repoUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("Only https://github.com/... remotes are allowed by bridge-mcp git tools.");
  }
}

function assertSafeRef(ref: string, label = "ref") {
  const value = ref.trim();
  if (!value || value.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(value) || value.length > 240) {
    throw new Error(`Unsafe Git ${label}: ${ref}`);
  }
  return value;
}

function projectRoot(cwd?: string) {
  return resolveToolPath(cwd ?? process.cwd(), { access: "cwd" });
}

function repoRelativePath(root: string, inputPath: string) {
  const resolved = resolveToolPath(inputPath, { access: "read", baseDir: root });
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Git path must remain inside the repository: ${inputPath}`);
  }
  return relative.replace(/\\/g, "/");
}

function parseNulPaths(result: Record<string, unknown>) {
  return String(result.stdout ?? "").split("\0").filter(Boolean);
}

function filterSensitiveRepoPaths(root: string, candidates: string[]) {
  const safe: string[] = [];
  const denied: Array<{ path: string; reason: string }> = [];
  for (const candidate of Array.from(new Set(candidates))) {
    try {
      const resolved = path.resolve(root, candidate);
      assertPathAllowed(resolved, "read");
      const relative = path.relative(root, resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escaped repository root");
      safe.push(relative.replace(/\\/g, "/"));
    } catch (error) {
      denied.push({ path: candidate.replace(/\\/g, "/"), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { safe, denied };
}

function emptyGitResult(command: string, cwd: string) {
  return { command, cwd, code: 0, signal: null, timedOut: false, durationMs: 0, stdout: "", stderr: "" };
}

function bounded(result: Record<string, unknown>, maxChars: number) {
  return {
    ...result,
    stdout: tailText(String(result.stdout ?? ""), maxChars),
    stderr: tailText(String(result.stderr ?? ""), Math.min(maxChars, 20_000)),
  };
}

export async function gitStatus(cwd?: string) {
  return await runProcess("git", ["status", "--short", "--branch"], projectRoot(cwd));
}

async function gitDiff(cwd: string | undefined, staged: boolean, ref: string | undefined, paths: string[], maxChars: number) {
  const root = projectRoot(cwd);
  const prefix = ["diff"];
  if (staged) prefix.push("--cached");
  if (ref) prefix.push(assertSafeRef(ref));

  let selected: string[];
  let deniedPaths: Array<{ path: string; reason: string }> = [];
  if (paths.length > 0) {
    selected = paths.map((item) => repoRelativePath(root, item));
  } else {
    const discovery = await runProcess("git", [...prefix, "--name-only", "-z", "--"], root, 120_000);
    if (discovery.code !== 0) return bounded(discovery, maxChars);
    const filtered = filterSensitiveRepoPaths(root, parseNulPaths(discovery));
    selected = filtered.safe;
    deniedPaths = filtered.denied;
  }

  const result = selected.length > 0
    ? await runProcess("git", [...prefix, "--", ...selected], root, 120_000)
    : emptyGitResult(`git ${prefix.join(" ")}`, root);
  return { ...bounded(result, maxChars), deniedPaths };
}

async function gitLog(cwd: string | undefined, limit: number, ref: string | undefined, maxChars: number) {
  const root = projectRoot(cwd);
  const args = ["log", `-${limit}`, "--date=iso-strict", "--pretty=format:%h%x09%ad%x09%an%x09%s"];
  if (ref) args.push(assertSafeRef(ref));
  return bounded(await runProcess("git", args, root), maxChars);
}

async function gitShowCommit(cwd: string | undefined, ref: string, includePatch: boolean, maxChars: number) {
  const root = projectRoot(cwd);
  const safeRef = assertSafeRef(ref);
  const discovery = await runProcess("git", ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", safeRef], root, 120_000);
  if (discovery.code !== 0) return bounded(discovery, maxChars);
  const filtered = filterSensitiveRepoPaths(root, parseNulPaths(discovery));
  const args = ["show", "--date=iso-strict", "--format=fuller"];
  if (!includePatch) args.push("--stat", "--summary");
  if (filtered.safe.length === 0) args.push("--no-patch");
  args.push(safeRef);
  if (filtered.safe.length > 0) args.push("--", ...filtered.safe);
  const result = await runProcess("git", args, root, 120_000);
  return { ...bounded(result, maxChars), deniedPaths: filtered.denied };
}

async function gitCompareBranches(cwd: string | undefined, base: string, head: string, maxChars: number) {
  const root = projectRoot(cwd);
  const safeBase = assertSafeRef(base, "base ref");
  const safeHead = assertSafeRef(head, "head ref");
  const range = `${safeBase}...${safeHead}`;
  const [discovery, commits] = await Promise.all([
    runProcess("git", ["diff", "--name-only", "-z", range, "--"], root, 120_000),
    runProcess("git", ["log", "--oneline", "--decorate", `${safeBase}..${safeHead}`], root, 120_000),
  ]);
  if (discovery.code !== 0) return { base: safeBase, head: safeHead, diff: bounded(discovery, maxChars), commits: bounded(commits, maxChars), deniedPaths: [] };
  const filtered = filterSensitiveRepoPaths(root, parseNulPaths(discovery));
  const diff = filtered.safe.length > 0
    ? await runProcess("git", ["diff", "--stat", "--summary", range, "--", ...filtered.safe], root, 120_000)
    : emptyGitResult(`git diff --stat --summary ${range}`, root);
  return { base: safeBase, head: safeHead, diff: bounded(diff, maxChars), commits: bounded(commits, maxChars), deniedPaths: filtered.denied };
}

async function gitCreateBranch(cwd: string | undefined, name: string, startPoint: string | undefined, checkout: boolean) {
  const root = projectRoot(cwd);
  const safeName = assertSafeRef(name, "branch name");
  const validation = await runProcess("git", ["check-ref-format", "--branch", safeName], root);
  if (validation.code !== 0) return { created: false, validation };
  const args = checkout ? ["switch", "-c", safeName] : ["branch", safeName];
  if (startPoint) args.push(assertSafeRef(startPoint, "start point"));
  const result = await runProcess("git", args, root, 120_000);
  return { created: result.code === 0, branch: safeName, checkout, result, status: await gitStatus(root) };
}

async function gitRestoreFile(cwd: string | undefined, filePath: string, source: string, staged: boolean, worktree: boolean) {
  if (!staged && !worktree) throw new Error("At least one of staged or worktree must be true.");
  const root = projectRoot(cwd);
  const relative = repoRelativePath(root, filePath);
  const args = ["restore", `--source=${assertSafeRef(source, "restore source")}`];
  if (staged) args.push("--staged");
  if (worktree) args.push("--worktree");
  args.push("--", relative);
  const result = await runProcess("git", args, root, 120_000);
  return { restored: result.code === 0, path: relative, source, staged, worktree, result, status: await gitStatus(root) };
}

async function gitSetRemote(repoUrl: string, remote = "origin", cwd?: string) {
  assertSafeGitRemote(remote);
  assertSafeGitHubUrl(repoUrl);
  const root = projectRoot(cwd);
  const current = await runProcess("git", ["remote", "get-url", remote], root);
  const action = current.code === 0 ? "set-url" : "add";
  const updated = await runProcess("git", ["remote", action, remote, repoUrl], root);
  return { action, remote, repoUrl, result: updated };
}

async function gitCommitAll(message: string, cwd?: string) {
  const root = projectRoot(cwd);
  const [worktree, staged, untracked] = await Promise.all([
    runProcess("git", ["diff", "--name-only", "-z", "--"], root, 120_000),
    runProcess("git", ["diff", "--cached", "--name-only", "-z", "--"], root, 120_000),
    runProcess("git", ["ls-files", "--others", "--exclude-standard", "-z"], root, 120_000),
  ]);
  const discoveryFailure = [worktree, staged, untracked].find((result) => result.code !== 0);
  if (discoveryFailure) return { committed: false, reason: "failed to inspect changed paths", discovery: discoveryFailure };
  const filtered = filterSensitiveRepoPaths(root, [
    ...parseNulPaths(worktree),
    ...parseNulPaths(staged),
    ...parseNulPaths(untracked),
  ]);
  if (filtered.denied.length > 0) {
    return { committed: false, reason: "sensitive paths require manual review and are not staged by git_commit_all", deniedPaths: filtered.denied, status: await gitStatus(root) };
  }
  if (filtered.safe.length === 0) return { committed: false, reason: "working tree clean", status: await gitStatus(root) };

  const add = await runProcess("git", ["add", "-A", "--", ...filtered.safe], root, 120_000);
  if (add.code !== 0) return { committed: false, add };
  const commit = await runProcess("git", ["commit", "-m", message], root, 120_000);
  return { committed: commit.code === 0, commit, status: await gitStatus(root) };
}

async function gitPushCurrentBranch(remote = "origin", branch?: string, cwd?: string) {
  assertSafeGitRemote(remote);
  const root = projectRoot(cwd);
  const branchResult = branch ? { code: 0, stdout: assertSafeRef(branch, "branch") } : await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
  if (branchResult.code !== 0) return { pushed: false, branchResult };
  const resolvedBranch = String(branchResult.stdout ?? "").trim() || "main";
  const push = await runProcess("git", ["push", "-u", remote, resolvedBranch], root, 120_000);
  return { pushed: push.code === 0, remote, branch: resolvedBranch, push };
}

export const gitToolModule: BridgeToolModule = {
  name: "git",
  tools: [
    { name: "git_status", description: "Return short Git status for the current project.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
    { name: "git_diff", description: "Return a bounded Git diff while omitting and reporting paths denied by the sensitive-path policy; optionally staged, against a ref, or limited to repository paths.", inputSchema: { type: "object", properties: { cwd: { type: "string" }, staged: { type: "boolean", default: false }, ref: { type: "string" }, paths: { type: "array", items: { type: "string" }, maxItems: 50 }, maxChars: { type: "number", default: 50000, minimum: 1000, maximum: 200000 } }, additionalProperties: false } },
    { name: "git_log", description: "Return recent Git commits with hash, timestamp, author, and subject.", inputSchema: { type: "object", properties: { cwd: { type: "string" }, limit: { type: "number", default: 20, minimum: 1, maximum: 200 }, ref: { type: "string" }, maxChars: { type: "number", default: 50000, minimum: 1000, maximum: 200000 } }, additionalProperties: false } },
    { name: "git_show_commit", description: "Inspect one Git commit with metadata and either a summary or bounded patch, omitting and reporting sensitive denied paths.", inputSchema: { type: "object", properties: { cwd: { type: "string" }, ref: { type: "string", default: "HEAD" }, includePatch: { type: "boolean", default: false }, maxChars: { type: "number", default: 50000, minimum: 1000, maximum: 200000 } }, additionalProperties: false } },
    { name: "git_compare_branches", description: "Compare two Git refs using sensitive-path-filtered three-dot diff statistics and commits unique to the head ref.", inputSchema: { type: "object", properties: { cwd: { type: "string" }, base: { type: "string" }, head: { type: "string" }, maxChars: { type: "number", default: 50000, minimum: 1000, maximum: 200000 } }, required: ["base", "head"], additionalProperties: false } },
    { name: "git_create_branch", description: "Create a validated Git branch and optionally switch to it.", inputSchema: { type: "object", properties: { cwd: { type: "string" }, name: { type: "string" }, startPoint: { type: "string" }, checkout: { type: "boolean", default: true } }, required: ["name"], additionalProperties: false } },
    { name: "git_restore_file", description: "Restore one repository file from a validated Git source into the index and/or working tree.", inputSchema: { type: "object", properties: { cwd: { type: "string" }, path: { type: "string" }, source: { type: "string", default: "HEAD" }, staged: { type: "boolean", default: false }, worktree: { type: "boolean", default: true } }, required: ["path"], additionalProperties: false } },
    { name: "git_set_remote", description: "Add or update a GitHub HTTPS remote for the current project.", inputSchema: { type: "object", properties: { repoUrl: { type: "string", default: DEFAULT_GIT_REMOTE_URL }, remote: { type: "string", default: "origin" }, cwd: { type: "string" } }, additionalProperties: false } },
    { name: "git_commit_all", description: "Stage all changed repository paths and create a commit, but refuse the operation when any changed path is denied by the sensitive-path policy.", inputSchema: { type: "object", properties: { message: { type: "string" }, cwd: { type: "string" } }, required: ["message"], additionalProperties: false } },
    { name: "git_push_current_branch", description: "Push the current Git branch to a remote using local credentials.", inputSchema: { type: "object", properties: { remote: { type: "string", default: "origin" }, branch: { type: "string" }, cwd: { type: "string" } }, additionalProperties: false } },
  ],
  handlers: {
    git_status: async (args) => gitStatus(z.object({ cwd: z.string().optional() }).parse(args).cwd),
    git_diff: async (args) => { const p = z.object({ cwd: z.string().optional(), staged: z.boolean().default(false), ref: z.string().optional(), paths: z.array(z.string()).max(50).default([]), maxChars: z.number().int().min(1000).max(200000).default(50000) }).parse(args); return gitDiff(p.cwd, p.staged, p.ref, p.paths, p.maxChars); },
    git_log: async (args) => { const p = z.object({ cwd: z.string().optional(), limit: z.number().int().min(1).max(200).default(20), ref: z.string().optional(), maxChars: z.number().int().min(1000).max(200000).default(50000) }).parse(args); return gitLog(p.cwd, p.limit, p.ref, p.maxChars); },
    git_show_commit: async (args) => { const p = z.object({ cwd: z.string().optional(), ref: z.string().default("HEAD"), includePatch: z.boolean().default(false), maxChars: z.number().int().min(1000).max(200000).default(50000) }).parse(args); return gitShowCommit(p.cwd, p.ref, p.includePatch, p.maxChars); },
    git_compare_branches: async (args) => { const p = z.object({ cwd: z.string().optional(), base: z.string(), head: z.string(), maxChars: z.number().int().min(1000).max(200000).default(50000) }).parse(args); return gitCompareBranches(p.cwd, p.base, p.head, p.maxChars); },
    git_create_branch: async (args) => { const p = z.object({ cwd: z.string().optional(), name: z.string(), startPoint: z.string().optional(), checkout: z.boolean().default(true) }).parse(args); return gitCreateBranch(p.cwd, p.name, p.startPoint, p.checkout); },
    git_restore_file: async (args) => { const p = z.object({ cwd: z.string().optional(), path: z.string(), source: z.string().default("HEAD"), staged: z.boolean().default(false), worktree: z.boolean().default(true) }).parse(args); return gitRestoreFile(p.cwd, p.path, p.source, p.staged, p.worktree); },
    git_set_remote: async (args) => { const p = z.object({ repoUrl: z.string().default(DEFAULT_GIT_REMOTE_URL), remote: z.string().default("origin"), cwd: z.string().optional() }).parse(args); return gitSetRemote(p.repoUrl, p.remote, p.cwd); },
    git_commit_all: async (args) => { const p = z.object({ message: z.string().min(1).max(200), cwd: z.string().optional() }).parse(args); return gitCommitAll(p.message, p.cwd); },
    git_push_current_branch: async (args) => { const p = z.object({ remote: z.string().default("origin"), branch: z.string().optional(), cwd: z.string().optional() }).parse(args); return gitPushCurrentBranch(p.remote, p.branch, p.cwd); },
  },
};
