import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { projectContextToolModule } from "../dist/tools/project-context-tools.js";
import { workflowGuideToolModule } from "../dist/tools/workflow-guide-tools.js";

const execFileAsync = promisify(execFile);
const workspace = path.join(process.cwd(), "sandbox", "project-context-lifecycle-test");
const root = path.join(workspace, "nested", "fixture");

async function exists(filePath) {
  try { await fs.stat(filePath); return true; } catch { return false; }
}

await fs.rm(workspace, { recursive: true, force: true });
await fs.mkdir(path.join(root, ".bridge"), { recursive: true });

try {
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Fixture rules\n\nUse canonical MSSR project knowledge.\n", "utf8");
  await fs.writeFile(path.join(root, ".bridge", "mssr-context-inbox.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, ".bridge", "bridge-host-setting.json"), "{}\n", "utf8");
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });

  const before = await projectContextToolModule.handlers.project_context_health({ projectRoot: root });
  assert.equal(before.manifestStatus, "missing");
  assert.equal(before.level, "review");

  const initialized = await projectContextToolModule.handlers.project_context_initialize({
    root: workspace,
    scope: "workspace",
    maxDepth: 3,
  });
  assert.equal(initialized.projectCount, 1);
  assert.equal(initialized.initialized, 1);
  assert.equal(initialized.projects[0].projectRoot, root);
  assert.equal(await exists(path.join(root, ".mssr", "project-context.json")), true);
  assert.equal(await exists(path.join(root, ".mssr", "knowledge")), true);
  assert.equal(await exists(path.join(root, ".mssr", "runtime")), true);
  assert.equal(await exists(path.join(root, ".bridge", "mssr-context-inbox.json")), false);
  assert.equal(await exists(path.join(root, ".bridge", "bridge-host-setting.json")), true, "unrelated Bridge host state must survive MSSR cleanup");

  const health = await projectContextToolModule.handlers.project_context_health({ projectRoot: root });
  assert.equal(health.manifestStatus, "valid");
  assert.notEqual(health.level, "review", JSON.stringify(health.findings));

  const captured = await projectContextToolModule.handlers.project_context_capture({
    projectRoot: root,
    capture: {
      id: "routing-ownership",
      topic: "architecture",
      area: "routing",
      title: "Routing ownership",
      content: "Portable MSSR owns project-context selection and Bridge only adapts materialized records for the host.",
      kind: "memory",
      description: "Durable ownership rule for project-context routing.",
      domains: ["agent-orchestration"],
      actions: ["maintain", "review"],
      stages: ["implement", "verify", "close"],
      priority: 50,
    },
  });
  assert.equal(captured.captured, true);
  assert.match(captured.relativePath, /^\.mssr\/knowledge\/architecture\//);
  assert.equal(await exists(captured.targetPath), true);

  const loaded = await workflowGuideToolModule.handlers.project_context_load({
    projectRoot: root,
    task: "Review agent orchestration routing ownership.",
    intent: {
      domains: ["agent-orchestration"],
      actions: ["review"],
      artifacts: ["mcp"],
      needs: ["integrity-verification"],
      signals: ["nominal"],
      risk: "read-only",
      ambiguity: "low",
    },
    stage: "verify",
    includeGuides: false,
  });
  assert.equal(loaded.projectContextAssembly.mode, "modular");
  assert.equal(loaded.documents.some((item) => item.id === "routing-ownership"), true);
  assert.equal(loaded.projectContextHealth.manifestStatus, "valid");
  assert.notEqual(loaded.projectContextHealth.level, "review", JSON.stringify(loaded.projectContextHealth.findings));

  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_capture({
      projectRoot: root,
      capture: {
        id: "routing-ownership",
        topic: "architecture",
        area: "routing",
        title: "Routing ownership",
        content: "Unreviewed replacement must not overwrite the existing module.",
        kind: "memory",
        description: "Attempted overwrite.",
      },
    }),
    /already exists/,
  );

  const secondInit = await projectContextToolModule.handlers.project_context_initialize({ root, scope: "project" });
  assert.equal(secondInit.idempotent, true);

  console.log("project context lifecycle tests passed");
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
