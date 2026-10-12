import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-core-recovery-"));
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);
process.env.BRIDGE_MCP_METRICS_DIR = path.join(sandbox, "metrics");
process.env.BRIDGE_MCP_LOG_DIR = path.join(sandbox, "logs");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(sandbox, "metrics", "metrics.sqlite");
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(sandbox, "logs", "events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(sandbox, "metrics", "state.json");

const [
  { Client },
  { InMemoryTransport },
  { createBridgeServer },
  { projectContextToolModule },
  { updateProjectContextSection },
  metrics,
  observatory,
] = await Promise.all([
  import("@modelcontextprotocol/sdk/client/index.js"),
  import("@modelcontextprotocol/sdk/inMemory.js"),
  import("../dist/bridge-server.js"),
  import("../dist/tools/project-context-tools.js"),
  import("../dist/project-context-writer.js"),
  import("../dist/metrics.js"),
  import("../dist/mssr-observatory.js"),
]);
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");

async function callFresh(tool, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createBridgeServer();
  const client = new Client({ name: "mssr-core-recovery-qa", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const result = await client.callTool({ name: tool, arguments: args });
    const part = result.content?.find(x => x.type === "text")?.text;
    if (!part) throw new Error("Missing tool result");
    try { return JSON.parse(part); } catch { return { text: part }; }
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

const projectRoot = path.join(sandbox, "project");
const dir = path.join(projectRoot, ".mssr");
const target = path.join(dir, "PROJECT_CONTEXT.md");
const manifest = {
  schemaVersion: 1,
  core: [{
    id: "project-identity", kind: "context", description: "Stable identity",
    source: { path: ".mssr/PROJECT_CONTEXT.md", sections: ["## Identity"] },
    maxChars: 200,
  }],
  modules: [],
};
const huge = "## Identity\n\n" + "A".repeat(255) + "\n";
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(target, huge);
await fs.writeFile(path.join(dir, "project-context.json"), JSON.stringify(manifest, null, 2));
const options = { projectRoot, heading: "## Identity", content: "Stable identity.\n", expectedSha256: hash(huge) };

try {
  const failedBootstrap = await callFresh("project_context_load", { projectRoot, includeGuides: false });
  assert.match(failedBootstrap.error, /exceeds \d+ bytes/, "Fixture must reproduce the original core-overflow deadlock.");
  assert.equal(failedBootstrap.emergencyTool, "project_context_recover_core", "Failure must expose the restricted repair entrypoint.");
  const ordinaryWrite = await callFresh("write_text_file", { path: path.join(projectRoot, "bad.txt"), content: "blocked" });
  assert.equal(ordinaryWrite.status, "mssr-lifecycle-preflight-required", "Normal writes must remain blocked without a route.");
  assert.equal(await fs.stat(path.join(projectRoot, "bad.txt")).catch(() => null), null);

  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_recover_core({ ...options, expectedSha256: "0".repeat(64) }),
    /expectedSha256|Concurrent core change/,
    "Stale repair hash must fail",
  );
  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_recover_core({ ...options, content: "B".repeat(245) }),
    /budget|shrink|recovery/i,
    "Oversized proposed repair must fail",
  );
  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_recover_core({ ...options, heading: "## Other" }),
    /exact indexed core/,
    "Non-core targets must fail",
  );
  await assert.rejects(
    () => updateProjectContextSection({ projectRoot, kind: "context", heading: "## Identity", content: "B".repeat(290), expectedSha256: hash(huge) }),
    /budget preflight/i,
    "Regular project_context_update must not grow an overbudget core.",
  );
  assert.equal(await fs.readFile(target, "utf8"), huge, "Failed attempts must not change the original.");

  const fixed = await callFresh("project_context_recover_core", options);
  assert.equal(fixed.recovered, true, "Emergency recovery must be directly callable without bootstrap.");
  assert.equal(fixed.entryId, "project-identity");
  assert.ok(fixed.beforeBytes > 200 && fixed.afterBytes < 200);
  assert.equal(fixed.afterSha256, hash(await fs.readFile(target, "utf8")));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "project-context.json"), "utf8")), manifest);
  await assert.rejects(
    () => projectContextToolModule.handlers.project_context_recover_core({
      ...options, expectedSha256: fixed.afterSha256,
    }),
    /only when.*exceeds/i,
    "Once healed, recovery must cease to be available.",
  );

  // Ordinary updates in a healthy project are still permitted by the writer.
  const accepted = await updateProjectContextSection({
    projectRoot, kind: "context", heading: "## Identity",
    content: "Still small and truthful.", expectedSha256: fixed.afterSha256,
  });
  assert.equal(accepted.updated, true);
  // Stale ChatGPT connector catalogs may omit newly added dedicated tools.
  // Only a confirmed fallback targeting this exact recovery handler may
  // pass the otherwise mandatory lifecycle gate.
  const fallbackRoot = path.join(sandbox, "fallback-project");
  const fallbackDir = path.join(fallbackRoot, ".mssr");
  const fallbackTarget = path.join(fallbackDir, "PROJECT_CONTEXT.md");
  await fs.mkdir(fallbackDir, { recursive: true });
  await fs.writeFile(fallbackTarget, huge);
  await fs.writeFile(path.join(fallbackDir, "project-context.json"), JSON.stringify(manifest, null, 2));
  const fallbackArgs = { projectRoot: fallbackRoot, heading: "## Identity", content: "Recovered via delegated fallback.\n", expectedSha256: hash(huge) };
  const noCommandEscape = await callFresh("bridge_tool_action", {
    toolName: "write_text_file", confirmToolName: "write_text_file",
    arguments: { path: path.join(fallbackRoot, "not-authorized.txt"), content: "blocked" },
  });
  assert.equal(noCommandEscape.status, "mssr-lifecycle-preflight-required", "Arbitrary delegated writes must remain guarded.");
  assert.equal(await fs.stat(path.join(fallbackRoot, "not-authorized.txt")).catch(() => null), null);
  const delegated = await callFresh("bridge_tool_action", {
    toolName: "project_context_recover_core",
    confirmToolName: "project_context_recover_core",
    arguments: fallbackArgs,
  });
  const delegatedResult = delegated.result ?? delegated;
  assert.equal(delegatedResult.recovered, true, "Confirmed fallback must recover core even when route/bootstrap is blocked.");
  assert.equal(await fs.readFile(fallbackTarget, "utf8"), "## Identity\nRecovered via delegated fallback.\n");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(fallbackDir, "project-context.json"), "utf8")), manifest);

  console.log("MSSR core recovery PASS: ordinary and delegated writes blocked; exact confirmed fallback restores overbudget core; hashes/manifest protected; writer preflight prevents recurrence.");
} finally {
  observatory.closeMssrObservatoryForTests();
  metrics.closeMetricsForTests();
  await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
}
