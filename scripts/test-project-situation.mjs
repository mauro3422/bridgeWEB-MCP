import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEmptyMssrContextInboxState } from "@mauroprime/mssr";
import {
  buildProjectSituationNoticeInputs,
  captureProjectSituationIfDue,
  collectProjectSituationSnapshot,
  getProjectSituationReport,
} from "../dist/project-situation.js";

const workspaceRoot = path.resolve("D:/Dev-test-workspace");
const projectRoot = path.join(workspaceRoot, "alpha");
const owner = projectRoot;
const now = new Date("2026-08-16T18:00:00.000Z");

function canonicalMemory(revision = "memory-new") {
  return {
    id: "project-memory:.mssr-project-memory.md",
    sourceKind: "project-memory",
    ref: ".mssr/PROJECT_MEMORY.md",
    title: "Project Memory",
    summary: "SECRET_BODY_SHOULD_NOT_PERSIST",
    canonicalOwner: owner,
    provenance: "project",
    availability: true,
    authoritative: true,
    observedAt: now.toISOString(),
    revision,
    stages: [], domains: [], actions: [], artifacts: [], needs: [], signals: [],
    severity: "info",
    required: false,
    priority: 0,
    estimatedChars: 100,
  };
}

function receipt(revision, overrides = {}) {
  return {
    messageId: "memory-context",
    messageKind: "context-request",
    acknowledgedAt: "2026-08-16T17:05:00.000Z",
    selectedCount: 1,
    firstSelectedAt: "2026-08-16T17:00:00.000Z",
    lastSelectedAt: "2026-08-16T17:00:00.000Z",
    expiresAt: "2026-08-17T17:00:00.000Z",
    sources: [{
      kind: "project-memory",
      ref: ".mssr/PROJECT_MEMORY.md",
      summary: "SECRET_RECEIPT_BODY_SHOULD_NOT_PERSIST",
      canonicalOwner: owner,
      provenance: "project",
      freshness: "fresh",
      observedAt: "2026-08-16T17:00:00.000Z",
      revision,
    }],
    ...overrides,
  };
}

function inboxWith(deliveries) {
  return { ...createEmptyMssrContextInboxState(), deliveries };
}

function deps(deliveries, revision = "memory-new") {
  return {
    discover: async () => [projectRoot],
    loadInbox: async () => inboxWith(deliveries),
    collectRepository: async () => ({ observations: [canonicalMemory(revision)] }),
  };
}

const stale = await collectProjectSituationSnapshot({
  workspaceRoot,
  now,
  dependencies: deps([receipt("memory-old")]),
});
assert.equal(stale.counts.projects, 1);
assert.equal(stale.counts.activeContext, 1);
assert.equal(stale.projects[0].level, "review");
assert.equal(stale.projects[0].noticeClass, "context-refresh");
assert.equal(stale.projects[0].nextAction, "revalidate-context-evidence");
assert.deepEqual(stale.projects[0].staleRefs, [".mssr/PROJECT_MEMORY.md"]);
assert.ok(stale.projects[0].readyActions.includes("revalidate-context-evidence"));

const opened = buildProjectSituationNoticeInputs(stale, null);
assert.equal(opened.length, 1);
assert.equal(opened[0].code, "mssr-project-situation-review");
assert.equal(opened[0].details?.primaryCategory, "project-memory");
assert.equal(opened[0].details?.noticeClass, "context-refresh");
assert.equal(opened[0].actions?.[0]?.toolName, "project_context_load");
assert.deepEqual(opened[0].actions?.[0]?.arguments, { projectRoot });

const stableAgain = buildProjectSituationNoticeInputs(stale, stale);
assert.equal(stableAgain.length, 0, "stable REVIEW with the same semantic fingerprint must stay silent");

const refreshed = await collectProjectSituationSnapshot({
  workspaceRoot,
  now: new Date("2026-08-16T18:05:00.000Z"),
  dependencies: deps([receipt("memory-new", { lastSelectedAt: "2026-08-16T18:04:00.000Z" })]),
});
assert.equal(refreshed.projects[0].level, "ok");
const resolved = buildProjectSituationNoticeInputs(refreshed, stale);
assert.equal(resolved.length, 1);
assert.equal(resolved[0].code, "mssr-project-situation-resolved");
assert.equal(resolved[0].actions?.length ?? 0, 0);

const expired = await collectProjectSituationSnapshot({
  workspaceRoot,
  now,
  dependencies: deps([receipt("memory-old", { expiresAt: "2026-08-15T18:00:00.000Z", acknowledgedAt: "2026-06-01T18:00:00.000Z" })]),
});
assert.equal(expired.projects[0].level, "ok");
assert.equal(expired.projects[0].activeReceiptCount, 0);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-project-situation-"));
const storePath = path.join(tempRoot, "project-situation.json");
try {
  const first = await captureProjectSituationIfDue({
    force: true,
    filePath: storePath,
    workspaceRoot,
    now,
    dependencies: deps([receipt("memory-old")]),
  });
  assert.equal(first.captured, true);
  const second = await captureProjectSituationIfDue({
    force: true,
    filePath: storePath,
    workspaceRoot,
    now: new Date("2026-08-16T18:05:00.000Z"),
    dependencies: deps([receipt("memory-old")]),
  });
  assert.equal(second.captured, true);
  assert.equal(buildProjectSituationNoticeInputs(second.latest, second.previous).length, 0, "persisted previous snapshot must suppress reopening the same REVIEW after a host restart");
  const report = await getProjectSituationReport(storePath);
  assert.equal(report.snapshotCount, 2);
  const raw = await fs.readFile(storePath, "utf8");
  assert.equal(raw.includes("SECRET_BODY_SHOULD_NOT_PERSIST"), false);
  assert.equal(raw.includes("SECRET_RECEIPT_BODY_SHOULD_NOT_PERSIST"), false);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("Bridge C2e project Situation watcher: PASS");
