import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-context-messages-"));
process.env.CODEX_HOME = path.join(sandbox, "codex");
process.env.MSSR_FIRST_PARTY_SKILLS_ROOT = path.join(process.cwd(), "..", "mssr", "skills");
process.env.BRIDGE_MCP_METRICS_DIR = path.join(sandbox, "metrics");
process.env.BRIDGE_MCP_LOG_DIR = path.join(sandbox, "logs");
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "mssr-events.jsonl");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(sandbox, "metrics.sqlite");
process.env.BRIDGE_MCP_EVENTS_JSONL = path.join(sandbox, "events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(sandbox, "mssr-state.json");

const { skillCatalogToolModule } = await import("../dist/tools/skill-catalog-tools.js");
const plan = skillCatalogToolModule.handlers.skill_route_plan;
const bootstrap = skillCatalogToolModule.handlers.skill_bootstrap;
const reviewProposal = skillCatalogToolModule.handlers.mssr_context_proposal_review;
const evidence = {
  kind: "project-state",
  ref: ".mssr/PROJECT_STATE.md#Provider",
  summary: "Provider requires a fresh readback.",
  canonicalOwner: "bridge-mcp",
  provenance: "project",
  freshness: "stale",
  revision: "abc123",
};
const messages = [
  {
    id: "provider-stale-primary",
    kind: "provider-degraded",
    severity: "attention",
    title: "Provider catalog may be stale",
    summary: "Refresh provider metadata before relying on its schemas.",
    evidence: [evidence],
    advisoryActions: ["refresh-provider"],
    domains: ["skill-system"],
    actions: ["review"],
    priority: 10,
    dedupeKey: "provider-stale",
  },
  {
    id: "provider-stale-duplicate",
    kind: "provider-degraded",
    severity: "warning",
    title: "Duplicate stale provider evidence",
    summary: "This duplicate must remain a decision, not a second notice.",
    evidence: [evidence],
    domains: ["skill-system"],
    actions: ["review"],
    dedupeKey: "provider-stale",
  },
];
const input = {
  task: "Review provider health",
  intent: { domains: ["skill-system"], actions: ["review"], signals: ["provider-refresh-needed"], risk: "read-only" },
  caller: "codex-local",
  sources: ["mssr-first-party"],
  contextMessages: messages,
};

const planned = await plan(input);
assert.equal(planned.contextMessages.advisoryOnly, true);
assert.equal(planned.contextMessages.selected.length, 1);
assert.equal(planned.contextMessages.decisions.find((item) => item.id === "provider-stale-duplicate")?.reason, "deduplicated");
assert.equal(planned.__bridgeNotices.filter((notice) => notice.source === "mssr-context-message-v1").length, 1);
assert.equal(planned.__bridgeNotices.find((notice) => notice.source === "mssr-context-message-v1")?.severity, "info", "attention must not be elevated");
const plannedNotice = planned.__bridgeNotices.find((notice) => notice.source === "mssr-context-message-v1");
assert.equal(plannedNotice.details.evidence[0].canonicalOwner, "bridge-mcp");
assert.equal(plannedNotice.actions, undefined, "portable advisory actions must not become executable Bridge actions");

const bootstrapped = await bootstrap({ ...input, traceId: planned.traceId });
assert.equal(bootstrapped.contextMessages.selected.length, 1);
assert.equal(bootstrapped.contextMessages.decisions, undefined, "compact bootstrap must not repeat per-candidate context-message decisions");
assert.equal(bootstrapped.contextMessages.decisionSummary.total, 2);
assert.equal(bootstrapped.contextMessages.decisionSummary.selected, 1);
assert.equal(bootstrapped.__bridgeNotices.filter((notice) => notice.source === "mssr-context-message-v1").length, 1);

const proposalEvidence = { ...evidence, freshness: "fresh" };
const proposal = {
  id: "proposal-project-state",
  kind: "persistence-proposal",
  title: "Review project state persistence",
  summary: "Keep the proposal reviewable by the canonical repository owner.",
  evidence: [proposalEvidence],
  persistenceProposal: {
    target: "project-state",
    summary: "Review a bounded project state update.",
    evidence: [proposalEvidence],
    reviewRequired: true,
  },
};
const proposalReview = await reviewProposal({ messages: [proposal] });
assert.equal(proposalReview.reviews[0].disposition, "review-ready");
assert.equal(proposalReview.reviews[0].reviewRequired, true);
assert.equal(proposalReview.autoWriteAllowed, false);
const staleProposalReview = await reviewProposal({
  messages: [{ ...proposal, id: "proposal-project-state-stale", persistenceProposal: { ...proposal.persistenceProposal, evidence: [{ ...proposalEvidence, freshness: "stale" }] } }],
});
assert.equal(staleProposalReview.reviews[0].disposition, "refresh-required");

await assert.rejects(
  () => plan({ ...input, contextMessages: [{ ...messages[0], evidence: [{ ...evidence, unexpected: true }] }] }),
  /unrecognized|unexpected/i,
  "strict portable evidence must reject unknown fields",
);

console.log("Bridge MSSR context messages tests passed");
