import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolRegistry } from "../dist/tool-registry.js";
import { createMssrProjectContextRefSplitToolModule } from "../dist/tools/mssr-project-context-ref-split-tools.js";

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-mssr-context-ref-split-"));
const projectRoot = path.join(fixtureRoot, "project");
const stateRoot = path.join(fixtureRoot, "state");
const sourceRef = ".mssr/knowledge/phase/current-phase.md";
const sourcePath = path.join(projectRoot, sourceRef);
const source = [
  "# Current Phase",
  "",
  `## Current\n\n${"Current verified state stays in the baseline. ".repeat(14)}`,
  "",
  `## Historical Alpha\n\n${"Alpha migration evidence and prior gate history. ".repeat(22)}`,
  "",
  `## Runtime Archive\n\n${"Older runtime diagnostics retained for selective recovery. ".repeat(18)}`,
  "",
  `## Previous Decisions\n\n${"Historical decisions remain accessible by exact indexed references. ".repeat(14)}`,
  "",
].join("\n");
const fakeProvider = {
  async curate({ blocks }) {
    return {
      schemaVersion: 1,
      provider: "fixture-jev",
      modelId: "fixture-model",
      blockJudgments: blocks.map((block) => {
        const current = /^## Current\b/.test(block.text);
        return {
          blockId: block.id,
          role: { value: current ? "current-state" : "history", confidence: 0.99 },
          destination: { value: current ? "state" : "knowledge-ref", confidence: 0.99 },
          protectedProbability: current ? 0.99 : 0.01,
          topic: { value: current ? "phase" : "reference", confidence: 0.99 },
        };
      }),
      pairJudgments: [],
    };
  },
};

try {
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, source, "utf8");
  const manifestPath = path.join(projectRoot, ".mssr", "project-context.json");
  const manifest = {
    schemaVersion: 1,
    core: [],
    modules: [{
      id: "project-current-phase",
      kind: "state",
      topic: "phase",
      description: "Current phase baseline with historical detail for selective references.",
      source: { path: sourceRef },
      domains: ["coding"],
      actions: ["review"],
      maxChars: 2_400,
    }],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const sourceBefore = await fs.readFile(sourcePath);
  const manifestBefore = await fs.readFile(manifestPath);
  const registry = createToolRegistry([createMssrProjectContextRefSplitToolModule({ provider: fakeProvider, stateRoot })]);

  const tool = registry.tools.find((item) => item.name === "mssr_project_context_ref_split_plan");
  assert.ok(tool, "Bridge registry should expose the package-owned planner");
  assert.deepEqual(tool.inputSchema.required, ["projectRoot", "moduleId"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.annotations?.readOnlyHint, false, "runtime plan persistence and Jev call are observable neutral effects");
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.metadata?.mssrLifecycle?.effect, "external-side-effect");

  const plan = await registry.call("mssr_project_context_ref_split_plan", { projectRoot, moduleId: "project-current-phase" });
  assert.equal(plan.status, "auto-safe");
  assert.equal(plan.advisoryOnly, true);
  assert.equal(plan.exactSourceTextOnly, true);
  assert.ok(plan.moves.length > 0);
  assert.ok(plan.decisions.some((decision) => decision.heading === "## Current" && decision.action === "keep"));
  assert.deepEqual(await fs.readFile(sourcePath), sourceBefore, "planning must not modify source Markdown");
  assert.deepEqual(await fs.readFile(manifestPath), manifestBefore, "planning must not modify the canonical project manifest");
  const persistedPlanPath = path.join(stateRoot, "semantic-curation-plans", `${plan.planId.replaceAll(":", "-")}.json`);
  const persistedPlan = JSON.parse(await fs.readFile(persistedPlanPath, "utf8"));
  assert.equal(persistedPlan.planId, plan.planId);
  assert.equal(JSON.stringify(persistedPlan).includes("Current verified state stays in the baseline"), false, "persisted plan must not copy full source prose");

  await assert.rejects(
    () => registry.call("mssr_project_context_ref_split_plan", { projectRoot, moduleId: "../unsafe" }),
    /moduleId|Invalid/i,
    "module ids must be strict and project-relative",
  );
  await assert.rejects(
    () => registry.call("mssr_project_context_ref_split_plan", { projectRoot, moduleId: "project-current-phase", unexpected: true }),
    /Unrecognized key|unexpected/i,
    "the Bridge contract must reject unknown fields",
  );
  console.log("MSSR project-context ref-split Bridge adapter tests passed.");
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
