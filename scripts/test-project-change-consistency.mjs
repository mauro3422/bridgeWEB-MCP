import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectContextToolModule } from "../dist/tools/project-context-tools.js";
import { createToolRegistry } from "../dist/tool-registry.js";

const execFileAsync = promisify(execFile);
const root = path.join(process.cwd(), "sandbox", "project-change-consistency-test");
const bridgeDir = path.join(root, ".bridge");
const changelogDir = path.join(root, "changelogs");

await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(bridgeDir, { recursive: true });
await fs.mkdir(changelogDir, { recursive: true });

try {
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Rules\n\nKeep project knowledge reviewed.\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.2.3" }, null, 2), "utf8");
  await fs.writeFile(path.join(root, "src.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(bridgeDir, "PROJECT_CONTEXT.md"), "# Project context\n\n## Architecture\nFixture architecture.\n", "utf8");
  await fs.writeFile(path.join(bridgeDir, "PROJECT_MEMORY.md"), "# Project memory\n\n## Decisions\nFixture decisions.\n", "utf8");
  await fs.writeFile(path.join(bridgeDir, "PROJECT_STATE.md"), "# Project state\n\n## Current\nBaseline.\n", "utf8");
  await fs.writeFile(path.join(bridgeDir, "project-context.json"), JSON.stringify({
    schemaVersion: 1,
    core: [{ id: "architecture", kind: "context", description: "Architecture", source: { path: ".bridge/PROJECT_CONTEXT.md", sections: ["## Architecture"] } }],
    modules: [{ id: "current", kind: "state", description: "Current state", source: { path: ".bridge/PROJECT_STATE.md", sections: ["## Current"] }, actions: ["maintain"] }],
  }, null, 2), "utf8");
  await fs.writeFile(path.join(changelogDir, "INDEX.md"), "# Changelog index\n\n- [1.2.3](1.2.3.md) — fixture baseline.\n", "utf8");
  await fs.writeFile(path.join(changelogDir, "1.2.3.md"), [
    "# 1.2.3 — 2026-08-13",
    "",
    "## Contract",
    "",
    "- Summary: Fixture baseline.",
    "- Areas: fixture",
    "- PROJECT_CONTEXT: reviewed-none",
    "- PROJECT_MEMORY: reviewed-none",
    "- PROJECT_STATE: reviewed-none",
    "",
  ].join("\n"), "utf8");

  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["add", "."], { cwd: root, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: root, windowsHide: true });

  await fs.writeFile(path.join(root, "src.txt"), "changed without release note\n", "utf8");
  const stale = await projectContextToolModule.handlers.project_change_consistency({ projectRoot: root, mode: "persist" });
  assert.equal(stale.publishReady, false);
  assert.equal(stale.issues.some((issue) => issue.code === "current-version-changelog-not-updated" && issue.severity === "error"), true);

  await fs.writeFile(path.join(bridgeDir, "PROJECT_STATE.md"), "# Project state\n\n## Current\nChanged and reviewed.\n", "utf8");
  await fs.writeFile(path.join(changelogDir, "1.2.3.md"), [
    "# 1.2.3 — 2026-08-13",
    "",
    "## Contract",
    "",
    "- Summary: Change fixture behavior and refresh current state.",
    "- Areas: fixture, maintenance",
    "- PROJECT_CONTEXT: reviewed-none",
    "- PROJECT_MEMORY: reviewed-none",
    "- PROJECT_STATE: updated",
    "",
    "## Changes",
    "",
    "- Changed src.txt and refreshed the project state authority.",
    "",
  ].join("\n"), "utf8");

  const ready = await projectContextToolModule.handlers.project_change_consistency({ projectRoot: root, mode: "persist" });
  assert.equal(ready.publishReady, true, JSON.stringify(ready.issues));
  assert.equal(ready.issues.length, 0, JSON.stringify(ready.issues));
  assert.equal(ready.projectAuthority.authorityStatus, "modular");

  const registry = createToolRegistry([projectContextToolModule]);
  const delegatedReady = await registry.call("bridge_tool_query", {
    toolName: "project_change_consistency",
    arguments: { projectRoot: root, mode: "persist" },
  });
  assert.equal(delegatedReady.classification, "read-only");
  assert.equal(delegatedReady.result.publishReady, true, JSON.stringify(delegatedReady.result.issues));
  await assert.rejects(
    () => registry.call("bridge_tool_action", {
      toolName: "project_change_consistency",
      confirmToolName: "project_change_consistency",
      arguments: { projectRoot: root, mode: "persist" },
    }),
    /classified read-only/,
  );
  await assert.rejects(
    () => registry.call("bridge_tool_query", {
      toolName: "project_context_update",
      arguments: {},
    }),
    /not classified read-only/,
  );
  assert.throws(
    () => createToolRegistry([{
      name: "contradictory-risk-fixture",
      tools: [{
        name: "contradictory_risk_tool",
        description: "Fixture with contradictory final risk annotations.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: true },
      }],
      handlers: { contradictory_risk_tool: async () => ({ ok: true }) },
    }]),
    /contradictory risk annotations/,
  );

  await execFileAsync("git", ["add", "src.txt", ".bridge/PROJECT_STATE.md", "changelogs/1.2.3.md"], { cwd: root, windowsHide: true });
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Rules\n\nParallel unrelated edit.\n", "utf8");
  const staged = await projectContextToolModule.handlers.project_change_consistency({ projectRoot: root, mode: "persist", scope: "staged" });
  assert.equal(staged.publishReady, true, JSON.stringify(staged.issues));
  assert.equal(staged.scope, "staged");
  assert.equal(staged.changedPaths.includes("src.txt"), true);
  assert.equal(staged.changedPaths.includes(".bridge/PROJECT_STATE.md"), true);
  assert.equal(staged.changedPaths.includes("changelogs/1.2.3.md"), true);
  assert.equal(staged.changedPaths.includes("AGENTS.md"), false, "staged consistency must not attribute unrelated working-tree edits");

  console.log("project change consistency tests passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
