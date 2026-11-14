import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeMssrProject } from "@mauroprime/mssr";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-context-plane-"));
process.env.CODEX_HOME = path.join(sandbox, "codex");
process.env.MSSR_FIRST_PARTY_SKILLS_ROOT = path.join(process.cwd(), "..", "mssr", "skills");
process.env.BRIDGE_MCP_METRICS_DIR = path.join(sandbox, "metrics");
process.env.BRIDGE_MCP_LOG_DIR = path.join(sandbox, "logs");
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "mssr-events.jsonl");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(sandbox, "metrics.sqlite");
process.env.BRIDGE_MCP_EVENTS_JSONL = path.join(sandbox, "events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(sandbox, "mssr-state.json");
process.env.BRIDGE_MCP_PATH_POLICY_DISABLED = "1";

const { skillCatalogToolModule } = await import("../dist/tools/skill-catalog-tools.js");
const plan = skillCatalogToolModule.handlers.skill_route_plan;
const bootstrap = skillCatalogToolModule.handlers.skill_bootstrap;
const ack = skillCatalogToolModule.handlers.mssr_context_ack;
const routeSchema = skillCatalogToolModule.tools.find((tool) => tool.name === "skill_route_plan")?.inputSchema;
const bootstrapSchema = skillCatalogToolModule.tools.find((tool) => tool.name === "skill_bootstrap")?.inputSchema;
assert.equal(routeSchema?.properties?.contextIncludeResearch?.type, "boolean", "route schema must expose explicit research opt-in");
assert.equal(bootstrapSchema?.properties?.contextIncludeResearch?.type, "boolean", "bootstrap schema must expose explicit research opt-in");

const projectRoot = path.join(sandbox, "bridge");
fs.mkdirSync(path.join(projectRoot, ".mssr"), { recursive: true });
const malformedRoot = path.join(sandbox, "malformed");
fs.mkdirSync(path.join(malformedRoot, ".mssr", "runtime"), { recursive: true });
const researchRoot = path.join(sandbox, "research-project");
fs.mkdirSync(path.join(researchRoot, ".git"), { recursive: true });
await initializeMssrProject(researchRoot);
const researchRef = ".mssr/knowledge/reference/paused-research.md";
fs.mkdirSync(path.dirname(path.join(researchRoot, researchRef)), { recursive: true });
fs.writeFileSync(path.join(researchRoot, researchRef), "# Paused research\n\nResearch-only context.\n", "utf8");
const researchManifestPath = path.join(researchRoot, ".mssr", "project-context.json");
const researchManifest = JSON.parse(fs.readFileSync(researchManifestPath, "utf8"));
researchManifest.modules.push({
  id: "paused-research-fixture",
  kind: "context",
  topic: "reference",
  area: "research",
  description: "Paused research context used by the Bridge adapter regression.",
  source: { path: researchRef },
  stages: ["verify"],
  domains: ["coding"],
  actions: ["review"],
  artifacts: ["code"],
  needs: [],
  signals: [],
  required: false,
  priority: 10,
  maxChars: 500,
  curationScope: "research",
});
fs.writeFileSync(researchManifestPath, `${JSON.stringify(researchManifest, null, 2)}\n`, "utf8");

const pendingMessage = (revision) => ({
  id: "context-plane-primary",
  kind: "continuation",
  severity: "attention",
  title: "Pending context-plane continuation",
  summary: "Must be redelivered until acknowledged on the durable project context plane.",
  evidence: [{
    kind: "project-state",
    ref: ".mssr/PROJECT_STATE.md#ContextPlane",
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
  fs.existsSync(path.join(projectRoot, ".mssr", "runtime", "context-inbox.json")),
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

const researchIntent = {
  domains: ["coding"],
  actions: ["review"],
  artifacts: ["code"],
  needs: ["unit-tests"],
  signals: ["nominal"],
  risk: "read-only",
  ambiguity: "low",
};
const researchRoute = await plan({
  task: "Review project research context",
  projectRoot: researchRoot,
  intent: researchIntent,
  caller: "codex-local",
  stage: "verify",
});
assert.equal(
  researchRoute.contextPlane.projectContext.selected.some((item) => item.ref === "paused-research-fixture"),
  false,
  "research modules must stay paused on route by default",
);
const optedInRoute = await plan({
  task: "Review project research context with explicit opt-in",
  projectRoot: researchRoot,
  intent: researchIntent,
  caller: "codex-local",
  stage: "verify",
  contextIncludeResearch: true,
});
assert.equal(
  optedInRoute.contextPlane.projectContext.selected.some((item) => item.ref === "paused-research-fixture"),
  true,
  "route must forward explicit research opt-in to the MSSR context plane",
);
assert.equal(optedInRoute.nextAction.arguments.contextIncludeResearch, true, "route continuation must preserve the explicit research opt-in");
const defaultBootstrap = await bootstrap({
  task: "Bootstrap project research context",
  projectRoot: researchRoot,
  intent: researchIntent,
  caller: "codex-local",
  stage: "verify",
});
assert.equal(
  defaultBootstrap.projectContext.documents.some((item) => item.id === "paused-research-fixture"),
  false,
  "bootstrap's delivered project context must keep research paused by default",
);
const optedInBootstrap = await bootstrap({
  task: "Bootstrap project research context with explicit opt-in",
  projectRoot: researchRoot,
  intent: researchIntent,
  caller: "codex-local",
  stage: "verify",
  contextIncludeResearch: true,
});
assert.equal(
  optedInBootstrap.projectContext.documents.some((item) => item.id === "paused-research-fixture"),
  true,
  "bootstrap must forward explicit research opt-in to the delivered project context",
);

fs.writeFileSync(path.join(malformedRoot, ".mssr", "runtime", "context-inbox.json"), "{ not valid json: missing quote", "utf8");
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
