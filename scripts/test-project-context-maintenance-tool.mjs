import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { projectContextToolModule } from "../dist/tools/project-context-tools.js";

const execFileAsync = promisify(execFile);
const workspace = path.join(process.cwd(), "sandbox", "project-context-maintenance-tool-test");

async function makeRepo(name) {
  const root = path.join(workspace, name);
  await fs.mkdir(root, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
  await projectContextToolModule.handlers.project_context_initialize({ root, scope: "project" });
  return root;
}

await fs.rm(workspace, { recursive: true, force: true });

try {
  const safeRoot = await makeRepo("safe");
  const memoryPath = path.join(safeRoot, ".mssr", "PROJECT_MEMORY.md");
  const manifestPath = path.join(safeRoot, ".mssr", "project-context.json");
  const sectionA = "## Decision A\n\nKeep A as durable project memory.";
  const sectionB = "## Decision B\n\nKeep B as durable project memory.";
  await fs.writeFile(memoryPath, `# Project Memory\n\n${sectionA}\n\n${sectionB}\n`, "utf8");

  const safeManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  safeManifest.modules = [
    {
      id: "decision-a",
      kind: "memory",
      topic: "decision",
      area: "routing",
      description: "Decision A memory.",
      source: { path: ".mssr/PROJECT_MEMORY.md", sections: ["## Decision A"] },
      domains: ["coding"],
      actions: ["maintain"],
      artifacts: ["project"],
      signals: ["warning-observed"],
      priority: 20,
      maxChars: 2000
    },
    {
      id: "decision-b",
      kind: "memory",
      topic: "decision",
      area: "routing",
      description: "Decision B memory.",
      source: { path: ".mssr/PROJECT_MEMORY.md", sections: ["## Decision B"] },
      domains: ["coding"],
      actions: ["maintain"],
      artifacts: ["project"],
      signals: ["warning-observed"],
      priority: 20,
      maxChars: 2000
    }
  ];
  await fs.writeFile(manifestPath, `${JSON.stringify(safeManifest, null, 2)}\n`, "utf8");

  const beforeHealth = await projectContextToolModule.handlers.project_context_health({ projectRoot: safeRoot });
  assert.equal(beforeHealth.findings.some((item) => item.code === "root-backed-memory-fanout"), true);

  const maintained = await projectContextToolModule.handlers.project_context_maintain({ projectRoot: safeRoot });
  assert.equal(maintained.status, "maintained");
  assert.equal(maintained.semanticRewrite, false);
  assert.equal(maintained.automaticScope, "exact-indexed-section-only");
  assert.deepEqual(maintained.applied.map((item) => item.entryId).sort(), ["decision-a", "decision-b"]);
  assert.equal(maintained.blockers.length, 0);

  const afterManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const moduleA = afterManifest.modules.find((item) => item.id === "decision-a");
  const moduleB = afterManifest.modules.find((item) => item.id === "decision-b");
  assert.match(moduleA.source.path, /^\.mssr\/knowledge\/decision\//);
  assert.match(moduleB.source.path, /^\.mssr\/knowledge\/decision\//);
  assert.equal((await fs.readFile(path.join(safeRoot, moduleA.source.path), "utf8")).trim(), sectionA);
  assert.equal((await fs.readFile(path.join(safeRoot, moduleB.source.path), "utf8")).trim(), sectionB);

  const afterHealth = await projectContextToolModule.handlers.project_context_health({ projectRoot: safeRoot });
  assert.equal(afterHealth.findings.some((item) => item.code === "root-backed-memory-fanout"), false);

  const pressuredRoot = await makeRepo("semantic-pressure");
  const pressuredManifestPath = path.join(pressuredRoot, ".mssr", "project-context.json");
  const historyRelative = ".mssr/knowledge/reference/history.md";
  const historyPath = path.join(pressuredRoot, historyRelative);
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(historyPath, `# History\n\n${"h".repeat(1980)}\n`, "utf8");
  const pressuredManifest = JSON.parse(await fs.readFile(pressuredManifestPath, "utf8"));
  pressuredManifest.modules = [{
    id: "history",
    kind: "memory",
    topic: "reference",
    area: "history",
    description: "Whole-file history under budget pressure.",
    source: { path: historyRelative },
    actions: ["maintain"],
    artifacts: ["project"],
    priority: 10,
    maxChars: 2200
  }];
  await fs.writeFile(pressuredManifestPath, `${JSON.stringify(pressuredManifest, null, 2)}\n`, "utf8");

  const historyBefore = await fs.readFile(historyPath, "utf8");
  const blocked = await projectContextToolModule.handlers.project_context_maintain({ projectRoot: pressuredRoot });
  assert.equal(blocked.status, "review-required");
  assert.equal(blocked.applied.length, 0);
  assert.equal(blocked.blockers.some((item) => item.entryId === "history" && item.reason === "whole-file-module-requires-semantic-segmentation"), true);
  assert.equal(await fs.readFile(historyPath, "utf8"), historyBefore);

  const tool = projectContextToolModule.tools.find((item) => item.name === "project_context_maintain");
  assert.ok(tool, "project_context_maintain must be exposed");
  assert.equal(tool.annotations?.readOnlyHint, false);
  assert.equal(tool.annotations?.destructiveHint, true);
  assert.equal(tool.inputSchema?.properties?.maxOperations?.maximum, 32);
  assert.match(tool.description, /exact already-indexed non-core Markdown sections/i);
  assert.match(tool.description, /never invents summaries, selectors or semantic segment boundaries/i);

  console.log("project context maintenance Bridge tool tests passed");
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
