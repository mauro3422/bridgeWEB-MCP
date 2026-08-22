import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBridgeServer } from "../dist/bridge-server.js";
import {
  evaluatePreparedBridgeArchitectureImpact,
  prepareBridgeArchitectureImpactHostAdoption,
  reviewBridgeArchitectureImpactBaseline,
} from "../dist/architecture-impact-host-adapter.js";

const fixtureRoot = path.join(process.cwd(), ".mssr", "runtime", `architecture-host-adoption-test-${process.pid}`);
const writeJson = async (relative, value) => {
  const target = path.join(fixtureRoot, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const write = async (relative, text) => {
  const target = path.join(fixtureRoot, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text, "utf8");
};

try {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await write("docs/architecture.md", "# Fixture architecture\n\nHost adapter stays observation-only.\n");
  await write("docs/context.md", "# Fixture context\n\nLoad this only when architecture review is active.\n");
  await write("src/adapter.ts", "export function run(value: number): number {\n  return value + 1;\n}\n");
  await write("src/observer.ts", "export function observe(): string { return 'ok'; }\n");
  await write("src/forbidden.ts", "export const forbidden = true;\n");
  await writeJson(".mssr/project-context.json", {
    schemaVersion: 1,
    core: [],
    modules: [{
      id: "fixture-architecture-context",
      kind: "context",
      description: "Fixture Architecture Impact review context.",
      source: { path: "docs/context.md" },
      stages: [], domains: [], actions: [], artifacts: [], needs: [], signals: [],
      required: false,
      priority: 10,
    }],
  });
  await writeJson(".mssr/architecture-impact.json", {
    schemaVersion: 1,
    architectures: [{
      architectureId: "fixture-host-adapter",
      authorityRef: "docs/architecture.md",
      contextRef: "fixture-architecture-context",
      impactRefs: ["src/adapter.ts", "src/observer.ts"],
    }],
  });
  await writeJson(".mssr/architecture-structure.json", {
    schemaVersion: 1,
    architectures: [{
      architectureId: "fixture-host-adapter",
      implementation: [{
        ref: "src/adapter.ts",
        selectors: [{ kind: "symbol", language: "typescript", name: "run", aspect: "body" }],
      }],
    }],
  });
  await writeJson(".mssr/architecture-invariants.json", {
    schemaVersion: 1,
    invariants: [{
      invariantId: "fixture-no-forbidden-import",
      architectureId: "fixture-host-adapter",
      relationshipClass: "declared",
      description: "Fixture adapter must not import forbidden module.",
      kind: "forbid-edge",
      edgeKind: "import",
      sourceRef: "src/adapter.ts",
      targetRef: "src/forbidden.ts",
    }],
  });

  const adapterPath = path.join(fixtureRoot, "src", "adapter.ts");
  const prepare = () => prepareBridgeArchitectureImpactHostAdoption({
    projectRoot: fixtureRoot,
    toolName: "apply_patch",
    args: { path: adapterPath },
  });

  const irrelevant = await prepareBridgeArchitectureImpactHostAdoption({
    projectRoot: fixtureRoot,
    toolName: "apply_patch",
    args: { path: path.join(fixtureRoot, "src", "forbidden.ts") },
  });
  assert.equal(irrelevant, null, "undeclared touched refs must not activate Architecture Impact");

  const beforeBaseline = await prepare();
  assert.ok(beforeBaseline);
  const missingBaseline = await evaluatePreparedBridgeArchitectureImpact(beforeBaseline);
  assert.equal(missingBaseline.items[0]?.state, "baseline-review-required");

  const reviewed = await reviewBridgeArchitectureImpactBaseline({
    projectRoot: fixtureRoot,
    architectureId: "fixture-host-adapter",
    reviewed: true,
  });
  assert.equal(reviewed.structural, true, "explicit review should persist a structural baseline when structure is declared");
  assert.ok(reviewed.receiptPath.includes(path.join(".mssr", "runtime", "architecture-impact")));

  const noisePlan = await prepare();
  assert.ok(noisePlan);
  await write("src/adapter.ts", "// non-structural comment\nexport function run(value: number): number {\n  return value + 1;\n}\n");
  const noise = await evaluatePreparedBridgeArchitectureImpact(noisePlan);
  const noiseItem = noise.items[0];
  assert.equal(noiseItem?.state, "evaluated");
  if (!noiseItem || noiseItem.state !== "evaluated") throw new Error("noise evaluation missing");
  assert.equal(noiseItem.evaluation.projection.status, "possible-impact");
  assert.equal(noiseItem.evaluation.structuralRefinement?.level, "watch");
  assert.equal(noiseItem.evaluation.attentionLevel, "watch");
  assert.equal(noiseItem.evaluation.reviewRequired, false);
  assert.equal(noiseItem.evaluation.contextFeedback, null);
  assert.equal(noiseItem.evaluation.semanticOwner, "mssr");
  assert.equal(noiseItem.evaluation.canonicalRewriteAllowed, false);

  const invariantPlan = await prepare();
  assert.ok(invariantPlan);
  await write("src/adapter.ts", "import { forbidden } from './forbidden.js';\n// non-structural comment\nexport function run(value: number): number {\n  return forbidden ? value + 1 : value;\n}\n");
  const invariantResult = await evaluatePreparedBridgeArchitectureImpact(invariantPlan);
  const invariantItem = invariantResult.items[0];
  assert.equal(invariantItem?.state, "evaluated");
  if (!invariantItem || invariantItem.state !== "evaluated") throw new Error("invariant evaluation missing");
  assert.equal(invariantItem.evaluation.attentionLevel, "review");
  assert.equal(invariantItem.evaluation.invariants[0]?.status, "violated");
  assert.equal(invariantItem.evaluation.invariants[0]?.reasonCode, "forbidden-edge-observed");
  assert.equal(invariantItem.evaluation.derivedGraph?.canonicalReviewEligible, false);
  assert.ok(invariantItem.evaluation.contextFeedback);
  assert.deepEqual(
    invariantItem.evaluation.contextFeedback?.requests.map((request) => request.role).sort(),
    ["authority", "context"],
  );
  assert.equal(invariantItem.evaluation.contextFeedback?.requests.find((request) => request.role === "context")?.contextRef, "fixture-architecture-context");

  await write("src/adapter.ts", "export function run(value: number): number {\n  return value + 1;\n}\n");
  const structuralPlan = await prepare();
  assert.ok(structuralPlan);
  await write("src/adapter.ts", "export function run(value: number): number {\n  return value + 2;\n}\n");
  const structuralResult = await evaluatePreparedBridgeArchitectureImpact(structuralPlan);
  const structuralItem = structuralResult.items[0];
  assert.equal(structuralItem?.state, "evaluated");
  if (!structuralItem || structuralItem.state !== "evaluated") throw new Error("structural evaluation missing");
  assert.equal(structuralItem.evaluation.structuralRefinement?.level, "review");
  assert.equal(structuralItem.evaluation.attentionLevel, "review");
  assert.equal(structuralItem.evaluation.replanRequired, true);
  assert.ok(structuralItem.evaluation.contextFeedback?.requests.length);

  await write("src/adapter.ts", "export function run(value: number): number {\n  return value + 1;\n}\n");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBridgeServer();
  const client = new Client({ name: "openai-mcp", version: "1.0.0" }, { capabilities: {} });
  const requestMeta = { "openai/session": `architecture-impact-live-${process.pid}` };
  const payload = (result) => {
    const text = result.content?.find((part) => part.type === "text")?.text;
    assert.equal(typeof text, "string", "expected a text MCP result");
    return JSON.parse(text);
  };
  const call = async (name, args = {}) => payload(await client.callTool({ name, arguments: args, _meta: requestMeta }));
  let rotatedClient = null;
  let rotatedServer = null;
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const workflowKey = `architecture-impact-live-${process.pid}`;
    await call("project_context_load", {
      projectRoot: fixtureRoot,
      task: "Load the fixture before live Architecture Impact mutation proof.",
      workflowKey,
    });
    const bootstrap = await call("skill_bootstrap", {
      task: "Open the live Architecture Impact mutation proof route.",
      context: "The fixture has a reviewed Architecture Impact baseline and the next explicit-path writer must inherit this project root from the active workflow.",
      intent: {
        summary: "Verify Architecture Impact project-root inheritance for an explicit-path writer.",
        domains: ["coding", "filesystem", "agent-orchestration"],
        actions: ["edit", "verify", "test"],
        artifacts: ["code", "mcp", "project"],
        needs: ["safe-editing", "integrity-verification", "unit-tests"],
        signals: ["nominal"],
        risk: "write",
        ambiguity: "low",
      },
      caller: "chatgpt-web",
      stage: "start",
      workflowKey,
      maxSkills: 8,
    });
    assert.match(bootstrap.traceId, /^mssr-/);

    await client.close();
    await server.close();
    const [rotatedClientTransport, rotatedServerTransport] = InMemoryTransport.createLinkedPair();
    rotatedServer = createBridgeServer();
    rotatedClient = new Client({ name: "openai-mcp", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([rotatedServer.connect(rotatedServerTransport), rotatedClient.connect(rotatedClientTransport)]);
    const rotatedCall = async (name, args = {}) => payload(await rotatedClient.callTool({ name, arguments: args, _meta: requestMeta }));

    const liveMutation = await rotatedCall("apply_patch", {
      path: adapterPath,
      oldText: "  return value + 1;",
      newText: "  return value + 2;",
      expectedReplacements: 1,
    });
    assert.equal(
      liveMutation.bridgeNotices?.items?.some((notice) => notice.code === "mssr-architecture-impact-review") ?? false,
      true,
      "project_context_load -> bootstrap on one MCP instance -> writer on another instance with the same host session must inherit the process-wide workflow/root and emit Architecture Impact REVIEW",
    );
    const restored = await rotatedCall("apply_patch", {
      path: adapterPath,
      oldText: "  return value + 2;",
      newText: "  return value + 1;",
      expectedReplacements: 1,
    });
    assert.equal(
      restored.bridgeNotices?.items?.some((notice) => notice.code === "mssr-architecture-impact-review") ?? false,
      false,
      "restoring the exact reviewed structural baseline must not emit a fresh Architecture Impact REVIEW",
    );
  } finally {
    await rotatedClient?.close().catch(() => {});
    await rotatedServer?.close().catch(() => {});
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }

  console.log("Architecture Impact Bridge host-adoption regression passed.");
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
