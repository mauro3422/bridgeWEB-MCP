import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-project-reference-"));
const workspaceRoot = path.join(root, "workspace");
const storePath = path.join(root, "project-health.json");
process.env.BRIDGE_MCP_PROJECT_HEALTH_PATH = storePath;
process.env.BRIDGE_MCP_PROJECT_HEALTH_ROOT = workspaceRoot;

const workspaceStatus = {
  status: "absent",
  state: null,
  reason: null,
  updatedAt: null,
  replacedBy: null,
  source: ".mssr/PROJECT_STATE.md#Workspace status",
  error: null,
};

function project(name, relativeRoot = name) {
  return {
    name,
    relativeRoot,
    level: "ok",
    workspaceStatus,
    manifestStatus: "valid",
    coreEntries: 1,
    modules: 1,
    findingCount: 0,
    findingCodes: [],
    findings: [],
    freshnessManifestStatus: "absent",
    freshnessLevel: "ok",
    freshnessFindingCount: 0,
    freshnessFindingCodes: [],
    freshnessReviewDocuments: [],
    referenceAuditAvailable: false,
    referenceScannedMarkdown: 0,
    referenceCandidateCount: 0,
    referenceHighPriorityCount: 0,
    referenceMediumPriorityCount: 0,
    referenceLowPriorityCount: 0,
    referenceConnectedCount: 0,
    referenceAuditTruncated: false,
    referenceHighCandidates: [],
  };
}

try {
  await fs.mkdir(workspaceRoot, { recursive: true });
  const observedAt = "2026-09-28T01:45:00.000Z";
  const projects = [
    project("kode"),
    project("kode-editor-kernel"),
    project("kode-ktlas"),
    project("OmnySystem"),
    project("OmnySystem-benchmark-v2-snapshot"),
    project("OmnySystem-perf-verify"),
    project("mssr"),
    project("mssr-p7-context"),
    project("mssr-p7-reconcile"),
    project("blender-mcp"),
    project("blender-mcp-smoke"),
  ];
  await fs.writeFile(storePath, `${JSON.stringify({
    schemaVersion: 1,
    updatedAt: observedAt,
    workspaceRoot,
    snapshots: [{
      observedAt,
      workspaceRoot,
      counts: { projects: projects.length, initialized: projects.length, ok: projects.length, watch: 0, review: 0 },
      projects,
    }],
  }, null, 2)}\n`, "utf8");

  const { createDefaultToolRegistry } = await import("../dist/tool-registry.js");
  const registry = createDefaultToolRegistry();
  const tool = registry.tools.find((item) => item.name === "project_reference_resolve");
  assert.ok(tool, "project_reference_resolve must be registered");
  assert.equal(tool.annotations?.readOnlyHint, true, "project_reference_resolve must remain read-only");
  assert.equal(tool.annotations?.destructiveHint, false);

  const kode = await registry.call("project_reference_resolve", { reference: "Kode" });
  assert.equal(kode.status, "resolved");
  assert.equal(kode.selected.name, "kode");
  assert.equal(kode.selection.strategy, "exact");
  assert.equal(kode.nextAction.toolName, "project_context_load");
  assert.equal(kode.nextAction.arguments.projectRoot, path.resolve(workspaceRoot, "kode"));

  const omny = await registry.call("project_reference_resolve", { reference: "Omny" });
  assert.equal(omny.status, "resolved");
  assert.equal(omny.selected.name, "OmnySystem");
  assert.equal(omny.selection.strategy, "ranked-deterministic");
  assert.equal(omny.selection.semanticSelectorRecommended, false);
  assert.ok(omny.selection.margin >= 0.06, `Expected deterministic margin for Omny, got ${omny.selection.margin}`);

  const mssrP7 = await registry.call("project_reference_resolve", { reference: "mssr p7" });
  assert.equal(mssrP7.status, "ambiguous");
  assert.equal(mssrP7.selected, null);
  assert.equal(mssrP7.selection.semanticSelectorRecommended, true);
  assert.equal(mssrP7.nextAction.toolName, null);
  assert.deepEqual(
    mssrP7.candidates.slice(0, 2).map((item) => item.name).sort(),
    ["mssr-p7-context", "mssr-p7-reconcile"].sort(),
  );

  const blender = await registry.call("project_reference_resolve", { reference: "blender mcp" });
  assert.equal(blender.status, "resolved");
  assert.equal(blender.selected.name, "blender-mcp");
  assert.equal(blender.selection.strategy, "exact");

  const missing = await registry.call("project_reference_resolve", { reference: "project-that-does-not-exist" });
  assert.equal(missing.status, "not-found");
  assert.equal(missing.selected, null);
  assert.equal(missing.candidates.length, 0);

  console.log("project reference resolver regression passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
