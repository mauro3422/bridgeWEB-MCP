import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-context-plane-"));
process.env.CODEX_HOME = path.join(sandbox, "codex");
process.env.MSSR_FIRST_PARTY_SKILLS_ROOT = path.join(process.cwd(), "..", "mssr", "skills");
process.env.BRIDGE_MCP_METRICS_DIR = path.join(sandbox, "metrics");
process.env.BRIDGE_MCP_LOG_DIR = path.join(sandbox, "logs");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(sandbox, "metrics.sqlite");
process.env.BRIDGE_MCP_EVENTS_JSONL = path.join(sandbox, "events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(sandbox, "mssr-state.json");
process.env.BRIDGE_MCP_PATH_POLICY_DISABLED = "1";

const { skillCatalogToolModule } = await import("../dist/tools/skill-catalog-tools.js");
const plan = skillCatalogToolModule.handlers.skill_route_plan;
const ack = skillCatalogToolModule.handlers.mssr_context_ack;

const projectRoot = path.join(sandbox, "bridge");
fs.mkdirSync(path.join(projectRoot, ".bridge"), { recursive: true });
const malformedRoot = path.join(sandbox, "malformed");
fs.mkdirSync(path.join(malformedRoot, ".bridge"), { recursive: true });

const pendingMessage = (revision) => ({
  id: "context-plane-primary",
  kind: "continuation",
  severity: "attention",
  title: "Pending context-plane continuation",
  summary: "Must be redelivered until acknowledged on the durable project context plane.",
  evidence: [{
    kind: "project-state",
    ref: ".bridge/PROJECT_STATE.md#ContextPlane",
    summary: "Pending context-plane continuation requires durable delivery.",
    canonicalOwner: "bridge-mcp",
    provenance: "project",
    freshness: "stale",
    revision,
  }],
  advisoryActions: ["load-context"],
  domains: ["skill-system"],
  actions: ["review"],
  priority: 20,
  dedupeKey: "context-plane-primary",
});
const matchingIntent = {
  domains: ["skill-system"],
  actions: ["review"],
  signals: ["provider-refresh-needed"],
  risk: "read-only",
};
const unrelatedIntent = {
  domains: ["roblox"],
  actions: ["analyze"],
  signals: ["nominal"],
  risk: "read-only",
};
const route = (task, intent, contextMessages) => plan({
  task,
  projectRoot,
  intent,
  caller: "codex-local",
  ...(contextMessages !== undefined ? { contextMessages } : {}),
});
const deliveredIds = (result) => JSON.stringify(
  result?.contextPlane?.contextMessages?.selected ?? result?.contextMessages?.selected ?? [],
);

const seeded = await route("Route the skill-system review", matchingIntent, [pendingMessage("abc123")]);
assert.equal(seeded.contextPlane?.advisoryOnly, true, "the project context plane must be advisory-only seeding");
assert.match(deliveredIds(seeded), /context-plane-primary/, "a matching task must deliver the pending context message");
assert.ok(
  fs.existsSync(path.join(projectRoot, ".bridge", "mssr-context-inbox.json")),
  "the durable context inbox manifest must exist explicitly after delivery",
);

const unrelated = await route("Inspect a Roblox scene", unrelatedIntent, [pendingMessage("abc123")]);
assert.doesNotMatch(deliveredIds(unrelated), /context-plane-primary/, "an unrelated task must not receive delivery even when the message is offered");

const redelivered = await route("Route the skill-system review again", matchingIntent, [pendingMessage("abc123")]);
assert.match(deliveredIds(redelivered), /context-plane-primary/, "identical pending evidence must be redelivered before it is acknowledged");

const ackResult = await ack({ projectRoot, messageIds: ["context-plane-primary"] });
assert.match(JSON.stringify(ackResult), /context-plane-primary/, "mssr_context_ack must record a delivery receipt for the exact delivered id");

const afterAck = await route("Route the skill-system review after ack", matchingIntent, [pendingMessage("abc123")]);
assert.doesNotMatch(deliveredIds(afterAck), /context-plane-primary/, "identical acknowledged evidence must be suppressed when re-offered");

const changedRevision = await route("Route the skill-system review with new revision", matchingIntent, [pendingMessage("abc124")]);
assert.match(deliveredIds(changedRevision), /context-plane-primary/, "evidence must reappear when its revision or content changes");

fs.writeFileSync(path.join(malformedRoot, ".bridge", "mssr-context-inbox.json"), "{ not valid json: missing quote", "utf8");
await assert.rejects(
  () => plan({
    task: "Route the skill-system review",
    projectRoot: malformedRoot,
    intent: matchingIntent,
    caller: "codex-local",
    contextMessages: [pendingMessage("abc123")],
  }),
  undefined,
  "a malformed durable context inbox manifest must fail closed instead of resuming silently",
);

console.log("Bridge MSSR context plane tests passed");
process.exit(0);