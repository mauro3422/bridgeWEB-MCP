import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { projectContextToolModule } from "../dist/tools/project-context-tools.js";
import { workflowGuideToolModule } from "../dist/tools/workflow-guide-tools.js";

const root = path.join(process.cwd(), "sandbox", "project-context-update-test");
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
await fs.writeFile(path.join(root, "AGENTS.md"), "# Rules\n\nKeep writes verifiable.\n", "utf8");

const intent = {
  domains: ["coding"],
  actions: ["edit"],
  artifacts: ["code"],
  needs: ["integrity-verification"],
  signals: ["nominal"],
  risk: "write",
  ambiguity: "low",
};

try {
  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_update({
      projectRoot: root,
      kind: "memory",
      heading: "## Must initialize first",
      content: "This write must fail before the MSSR project contract exists.",
    }),
    /project_context_initialize/,
  );

  const initialized = await projectContextToolModule.handlers.project_context_initialize({ root, scope: "project" });
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.manifestStatus, "valid");

  const created = await projectContextToolModule.handlers.project_context_update({
    projectRoot: root,
    kind: "memory",
    heading: "## Broad refactor safety",
    content: "Create a bounded snapshot before a broad refactor.",
    module: {
      id: "broad-refactor-safety",
      kind: "directive",
      description: "Require a bounded snapshot before broad coding refactors.",
      domains: ["coding"],
      actions: ["edit"],
      needs: ["integrity-verification"],
      stages: ["implement"],
      priority: 40,
    },
  });
  assert.equal(created.updated, true);
  assert.equal(created.section.created, true);
  assert.equal(created.manifest.created, true);
  assert.match(created.section.afterSha256, /^[0-9a-f]{64}$/);

  const memoryPath = path.join(root, ".mssr", "PROJECT_MEMORY.md");
  const memory = await fs.readFile(memoryPath, "utf8");
  assert.equal((memory.match(/## Broad refactor safety/g) ?? []).length, 1);
  const manifestPath = path.join(root, ".mssr", "project-context.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const createdModule = manifest.modules.find((item) => item.id === "broad-refactor-safety");
  assert.ok(createdModule);
  assert.equal(createdModule.source.path, ".mssr/PROJECT_MEMORY.md");
  assert.deepEqual(createdModule.source.sections, ["## Broad refactor safety"]);

  const loaded = await workflowGuideToolModule.handlers.project_context_load({
    projectRoot: root,
    task: "Refactor coding safely.",
    intent,
    stage: "implement",
    includeGuides: false,
  });
  assert.deepEqual(loaded.projectDirectives.map((item) => item.id), ["broad-refactor-safety"]);

  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_update({
      projectRoot: root,
      kind: "memory",
      heading: "## Broad refactor safety",
      content: "This stale writer must not win.",
      expectedSha256: "0".repeat(64),
    }),
    /changed concurrently/,
  );
  assert.equal((await fs.readFile(memoryPath, "utf8")).includes("stale writer"), false);

  const replaced = await projectContextToolModule.handlers.project_context_update({
    projectRoot: root,
    kind: "memory",
    heading: "## Broad refactor safety",
    content: "Create a bounded snapshot and verify its diff before a broad refactor.",
    expectedSha256: created.section.afterSha256,
    module: {
      id: "broad-refactor-safety",
      kind: "directive",
      description: "Require a bounded snapshot and diff before broad coding refactors.",
      domains: ["coding"],
      actions: ["edit"],
      needs: ["integrity-verification"],
      stages: ["implement"],
      priority: 50,
    },
  });
  assert.equal(replaced.section.replaced, true);
  assert.equal(replaced.manifest.replaced, true);
  const replacedMemory = await fs.readFile(memoryPath, "utf8");
  assert.equal((replacedMemory.match(/## Broad refactor safety/g) ?? []).length, 1);
  assert.equal(replacedMemory.includes("verify its diff"), true);
  const replacedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const replacedModule = replacedManifest.modules.find((item) => item.id === "broad-refactor-safety");
  assert.ok(replacedModule);
  assert.equal(replacedModule.priority, 50);

  console.log("project context update tests passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
