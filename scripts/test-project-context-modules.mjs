import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { assembleProjectContext } from "../dist/project-context-assembler.js";
import { workflowGuideToolModule } from "../dist/tools/workflow-guide-tools.js";

const root = path.join(process.cwd(), "sandbox", "project-context-modules-test");
const bridgeDir = path.join(root, ".bridge");

await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(bridgeDir, { recursive: true });

try {
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Agent rules\n\nAlways verify observable writes.\n", "utf8");
  await fs.writeFile(path.join(bridgeDir, "PROJECT_CONTEXT.md"), [
    "# Project context",
    "",
    "## Architecture",
    "Portable core plus host adapters.",
    "",
    "## Unrelated",
    "This should not be in the core selection.",
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(bridgeDir, "PROJECT_MEMORY.md"), [
    "# Project memory",
    "",
    "## Write safety",
    "For repository writes, create a bounded snapshot before broad refactors.",
    "",
    "## Required verification gate",
    "Required verification evidence must remain active even when the nominal project-context budget is smaller than this section. ".repeat(12),
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(bridgeDir, "PROJECT_STATE.md"), [
    "# Project state",
    "",
    "## Current implementation",
    "The modularization pass is active.",
    "",
    "## Roblox",
    "Unrelated Roblox state.",
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(bridgeDir, "project-context.json"), JSON.stringify({
    schemaVersion: 1,
    core: [
      {
        id: "architecture-core",
        kind: "context",
        description: "Minimal architecture facts.",
        source: { path: ".bridge/PROJECT_CONTEXT.md", sections: ["## Architecture"] },
      },
    ],
    modules: [
      {
        id: "write-safety",
        kind: "directive",
        description: "Extra write checks.",
        source: { path: ".bridge/PROJECT_MEMORY.md", sections: ["## Write safety"] },
        domains: ["coding"],
        actions: ["edit"],
        needs: ["integrity-verification"],
        stages: ["implement"],
        priority: 30,
      },
      {
        id: "required-verification-gate",
        kind: "directive",
        description: "Required verification evidence.",
        source: { path: ".bridge/PROJECT_MEMORY.md", sections: ["## Required verification gate"] },
        stages: ["verify"],
        required: true,
        priority: 80,
      },
      {
        id: "implementation-state",
        kind: "state",
        description: "Current implementation state.",
        source: { path: ".bridge/PROJECT_STATE.md", sections: ["## Current implementation"] },
        domains: ["coding"],
        actions: ["edit"],
        stages: ["implement"],
      },
      {
        id: "roblox-state",
        kind: "state",
        description: "Unrelated Roblox state.",
        source: { path: ".bridge/PROJECT_STATE.md", sections: ["## Roblox"] },
        domains: ["roblox"],
        actions: ["review"],
        stages: ["implement"],
      },
    ],
  }, null, 2), "utf8");

  const coreOnly = await assembleProjectContext({
    projectRoot: root,
    stage: "start",
    maxContextChars: 12_000,
  });
  assert.equal(coreOnly.mode, "modular");
  assert.equal(coreOnly.coreIncluded, true);
  assert.deepEqual(coreOnly.documents.map((item) => item.id), ["architecture-core"]);
  assert.equal(coreOnly.directives.length, 0);
  assert.equal(coreOnly.documents[0].text.includes("Unrelated"), false);

  const intent = {
    domains: ["coding"],
    actions: ["edit"],
    artifacts: ["code"],
    needs: ["integrity-verification"],
    signals: ["nominal"],
    risk: "write",
    ambiguity: "low",
  };
  const stageModules = await assembleProjectContext({
    projectRoot: root,
    intent,
    stage: "implement",
    maxContextChars: 12_000,
    includeCore: false,
  });
  assert.equal(stageModules.coreIncluded, false);
  assert.deepEqual(stageModules.directives.map((item) => item.id), ["write-safety"]);
  assert.deepEqual(stageModules.documents.map((item) => item.id), ["implementation-state"]);
  assert.equal(stageModules.decisions.find((item) => item.id === "roblox-state")?.reason, "intent-mismatch");
  const requiredOverflow = await assembleProjectContext({
    projectRoot: root,
    intent,
    stage: "verify",
    maxContextChars: 200,
    includeCore: false,
  });
  assert.deepEqual(requiredOverflow.directives.map((item) => item.id), ["required-verification-gate"]);
  assert.equal(requiredOverflow.requiredBudgetExceeded, true);
  assert.equal(requiredOverflow.totalCharsLoaded > 200, true);



  const loaded = await workflowGuideToolModule.handlers.project_context_load({
    projectRoot: root,
    task: "Refactor the coding architecture safely.",
    intent,
    stage: "implement",
    maxProjectContextChars: 12_000,
    includeGuides: false,
  });
  assert.equal(loaded.projectContextAssembly.mode, "modular");
  assert.equal(loaded.documents.some((item) => item.kind === "agents"), true);
  assert.equal(loaded.documents.some((item) => item.id === "architecture-core"), true);
  assert.equal(loaded.documents.some((item) => item.id === "implementation-state"), true);
  assert.deepEqual(loaded.projectDirectives.map((item) => item.id), ["write-safety"]);
  assert.equal(loaded.documents.some((item) => item.id === "roblox-state"), false);

  console.log("project context module tests passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
