import { z } from "zod";
import { DEFAULT_GIT_REMOTE_URL } from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { runProcess } from "./shared/process.js";

function assertSafeGitRemote(remote: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) throw new Error(`Unsafe git remote name: ${remote}`);
}

function assertSafeGitHubUrl(repoUrl: string) {
  const parsed = new URL(repoUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("Only https://github.com/... remotes are allowed by bridge-mcp git tools.");
  }
}

export async function gitStatus(cwd?: string) {
  return await runProcess("git", ["status", "--short", "--branch"], cwd);
}

async function gitSetRemote(repoUrl: string, remote = "origin", cwd?: string) {
  assertSafeGitRemote(remote);
  assertSafeGitHubUrl(repoUrl);
  const current = await runProcess("git", ["remote", "get-url", remote], cwd);
  const action = current.code === 0 ? "set-url" : "add";
  const updated = await runProcess("git", ["remote", action, remote, repoUrl], cwd);
  return { action, remote, repoUrl, result: updated };
}

async function gitCommitAll(message: string, cwd?: string) {
  const add = await runProcess("git", ["add", "-A"], cwd, 120_000);
  if (add.code !== 0) return { committed: false, add };
  const porcelain = await runProcess("git", ["status", "--porcelain"], cwd);
  if (String(porcelain.stdout ?? "").trim().length === 0) {
    return { committed: false, reason: "working tree clean", status: await gitStatus(cwd) };
  }
  const commit = await runProcess("git", ["commit", "-m", message], cwd, 120_000);
  return { committed: commit.code === 0, commit, status: await gitStatus(cwd) };
}

async function gitPushCurrentBranch(remote = "origin", branch?: string, cwd?: string) {
  assertSafeGitRemote(remote);
  const branchResult = branch ? { code: 0, stdout: branch } : await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (branchResult.code !== 0) return { pushed: false, branchResult };
  const resolvedBranch = String(branchResult.stdout ?? "").trim() || "main";
  const push = await runProcess("git", ["push", "-u", remote, resolvedBranch], cwd, 120_000);
  return { pushed: push.code === 0, remote, branch: resolvedBranch, push };
}

export const gitToolModule: BridgeToolModule = {
  name: "git",
  tools: [
    { name: "git_status", description: "Return short Git status for the current project.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
    { name: "git_set_remote", description: "Add or update a GitHub HTTPS remote for the current project.", inputSchema: { type: "object", properties: { repoUrl: { type: "string", default: DEFAULT_GIT_REMOTE_URL }, remote: { type: "string", default: "origin" }, cwd: { type: "string" } }, additionalProperties: false } },
    { name: "git_commit_all", description: "Stage all changes and create a Git commit if the working tree is dirty.", inputSchema: { type: "object", properties: { message: { type: "string" }, cwd: { type: "string" } }, required: ["message"], additionalProperties: false } },
    { name: "git_push_current_branch", description: "Push the current Git branch to a remote using local credentials.", inputSchema: { type: "object", properties: { remote: { type: "string", default: "origin" }, branch: { type: "string" }, cwd: { type: "string" } }, additionalProperties: false } },
  ],
  handlers: {
    git_status: async (args) => {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return await gitStatus(parsed.cwd);
    },
    git_set_remote: async (args) => {
      const parsed = z.object({ repoUrl: z.string().default(DEFAULT_GIT_REMOTE_URL), remote: z.string().default("origin"), cwd: z.string().optional() }).parse(args);
      return await gitSetRemote(parsed.repoUrl, parsed.remote, parsed.cwd);
    },
    git_commit_all: async (args) => {
      const parsed = z.object({ message: z.string().min(1).max(200), cwd: z.string().optional() }).parse(args);
      return await gitCommitAll(parsed.message, parsed.cwd);
    },
    git_push_current_branch: async (args) => {
      const parsed = z.object({ remote: z.string().default("origin"), branch: z.string().optional(), cwd: z.string().optional() }).parse(args);
      return await gitPushCurrentBranch(parsed.remote, parsed.branch, parsed.cwd);
    },
  },
};
