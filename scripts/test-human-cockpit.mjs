import assert from "node:assert/strict";
import { buildCapabilityInventory, buildHumanCockpitSnapshot } from "../dist/dashboard-cockpit.js";
import { renderDashboardHtml } from "../dist/dashboard.js";

const now = new Date("2026-09-24T04:00:00.000Z");
const observatoryRecent = {
  totals: { latest: "2026-09-24T03:59:00.000Z" },
  recent: [
    {
      traceId: "trace-open",
      eventType: "phase_completed",
      occurredAt: "2026-09-24T03:59:00.000Z",
      caller: "chatgpt-web",
      stage: "implement",
      ok: true,
      details: {
        workflowKey: "cockpit-open-work",
        completedPhases: ["discovery", "safety", "implementation"],
        summary: "Implementation complete; verification is next.",
      },
    },
    {
      traceId: "trace-open",
      eventType: "project_context_selection",
      occurredAt: "2026-09-24T03:58:30.000Z",
      caller: "chatgpt-web",
      stage: "implement",
      ok: true,
      details: { projectName: "bridge-mcp" },
    },
    {
      traceId: "trace-open",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:58:00.000Z",
      caller: "chatgpt-web",
      stage: "implement",
      ok: true,
      details: {
        workflowKey: "cockpit-open-work",
        requiredPhases: ["discovery", "safety", "implementation", "verification", "persistence", "maintenance"],
        completedPhases: ["discovery", "safety"],
        agentProfile: { model: "gpt-test", reasoningEffort: "high" },
      },
    },
    {
      traceId: "trace-reopened",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:57:00.000Z",
      caller: "chatgpt-web",
      stage: "resume",
      ok: true,
      details: {
        workflowKey: "reopened-after-outcome",
        intent: { summary: "Reopened workflow needs verification." },
        requiredPhases: ["discovery", "verification"],
        completedPhases: ["discovery"],
      },
    },
    {
      traceId: "trace-reopened",
      eventType: "outcome",
      occurredAt: "2026-09-24T03:56:00.000Z",
      caller: "chatgpt-web",
      stage: "close",
      ok: true,
      details: {
        completedPhases: ["discovery", "verification"],
        status: "success",
        summary: "Old outcome before later replan.",
      },
    },
    {
      traceId: "trace-resumed-after-reminder",
      eventType: "phase_completed",
      occurredAt: "2026-09-24T03:56:45.000Z",
      caller: "chatgpt-web",
      stage: "implement",
      ok: true,
      details: {
        completedPhases: ["discovery", "implementation"],
        summary: "Work resumed after an earlier reminder.",
      },
    },
    {
      traceId: "trace-resumed-after-reminder",
      eventType: "closure_reminder",
      occurredAt: "2026-09-24T03:56:30.000Z",
      caller: "chatgpt-web",
      stage: "implement",
      ok: false,
      details: { summary: "Earlier idle reminder." },
    },
    {
      traceId: "trace-resumed-after-reminder",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:56:15.000Z",
      caller: "chatgpt-web",
      stage: "implement",
      ok: true,
      details: {
        workflowKey: "resumed-work",
        requiredPhases: ["discovery", "implementation", "verification"],
        completedPhases: ["discovery"],
      },
    },
    {
      traceId: "trace-legacy-no-summary",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:55:30.000Z",
      caller: "chatgpt-web",
      stage: "start",
      ok: true,
      details: {
        workflowKey: "legacy-unlabeled-work",
        requiredPhases: ["discovery"],
        completedPhases: [],
      },
    },
    {
      traceId: "trace-closed",
      eventType: "outcome",
      occurredAt: "2026-09-24T03:55:00.000Z",
      caller: "chatgpt-web",
      stage: "close",
      ok: true,
      details: {
        workflowKey: "closed-work",
        completedPhases: ["discovery", "verification", "persistence"],
        status: "success",
        summary: "Closed correctly.",
      },
    },
    {
      traceId: "trace-closed",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:54:00.000Z",
      caller: "chatgpt-web",
      stage: "verify",
      ok: true,
      details: {
        workflowKey: "closed-work",
        requiredPhases: ["discovery", "verification", "persistence"],
        completedPhases: ["discovery", "verification"],
      },
    },
    {
      traceId: "trace-legacy-member",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:55:20.000Z",
      caller: "chatgpt-web",
      stage: "start",
      ok: true,
      details: {
        workflowKey: "legacy-unlabeled-work",
        requiredPhases: ["discovery"],
        completedPhases: [],
      },
    },
    {
      traceId: "trace-technical-skill",
      eventType: "skill_loaded",
      occurredAt: "2026-09-24T03:55:10.000Z",
      caller: "chatgpt-web",
      stage: "start",
      skillName: "mssr-agent-routing",
      ok: true,
      details: {},
    },
    {
      traceId: "trace-synthetic-fixture",
      eventType: "route_planned",
      occurredAt: "2026-09-24T03:55:05.000Z",
      caller: "chatgpt-web",
      stage: "verify",
      ok: true,
      details: {
        workflowKey: "workflow-guide-routing-fixture",
        requiredPhases: ["discovery", "verification"],
        completedPhases: ["discovery"],
      },
    },
  ],
};

const projectHealth = {
  updatedAt: "2026-09-24T03:50:00.000Z",
  workspaceRoot: "D:/Dev",
  latest: {
    counts: { projects: 2, initialized: 2, ok: 1, watch: 1, review: 0 },
    projects: [
      {
        name: "bridge-mcp",
        relativeRoot: "bridge-mcp",
        level: "watch",
        findingCount: 2,
        findingCodes: ["example-watch"],
        referenceAuditAvailable: true,
        referenceCandidateCount: 6,
        referenceHighPriorityCount: 1,
        referenceMediumPriorityCount: 3,
        referenceLowPriorityCount: 2,
        referenceHighCandidates: ["ROADMAP.md"],
      },
    ],
  },
};

const weeklySummary = {
  scope: "all",
  days: 7,
  since: "2026-09-17T04:00:00.000Z",
  workHistory: {
    scope: "all",
    days: 7,
    since: "2026-09-17T04:00:00.000Z",
    traceCount: 5,
    substantiveTraceCount: 4,
    openSubstantiveTraceCount: 3,
    humanOpenTraceCount: 2,
    supportOpenTraceCount: 1,
    needsClosureReviewCount: 2,
    humanNeedsClosureReviewCount: 1,
    projectCount: 1,
    projects: [{
      name: "bridge-mcp",
      latestAt: "2026-09-24T03:59:00.000Z",
      traceCount: 5,
      substantiveTraceCount: 4,
      closedTraceCount: 2,
      substantiveToolCalls: 11,
      workflowKeys: ["cockpit-open-work", "closed-work"],
      latestSummary: "Implementation complete; verification is next.",
      latestTraceId: "trace-open",
    }],
    openTraces: [
      {
        traceId: "trace-open",
        project: "bridge-mcp",
        workflowKey: "cockpit-open-work",
        taskKey: "human-task-cockpit-weekly",
        firstAt: "2026-09-23T22:00:00.000Z",
        latestAt: "2026-09-24T03:59:00.000Z",
        latestEventType: "phase_completed",
        latestStage: "implement",
        caller: "chatgpt-web",
        requiredPhases: ["discovery", "safety", "implementation", "verification", "persistence", "maintenance"],
        completedPhases: ["discovery", "safety", "implementation"],
        evidenceRef: "logs/context-layer-ts-check.log",
        closureReminderObserved: false,
        needsClosureReview: false,
        summary: "Implementation complete; verification is next.",
      },
      {
        traceId: "trace-open-retry",
        project: "bridge-mcp",
        workflowKey: "cockpit-open-work-retry",
        taskKey: "human-task-cockpit-weekly",
        parentTraceId: "trace-open",
        firstAt: "2026-09-24T03:58:30.000Z",
        latestAt: "2026-09-24T03:59:10.000Z",
        latestEventType: "route_planned",
        latestStage: "verify",
        caller: "chatgpt-web",
        requiredPhases: ["discovery", "safety", "implementation", "verification", "persistence", "maintenance"],
        completedPhases: ["discovery", "safety", "implementation"],
        evidenceRef: "logs/context-layer-ts-check.log",
        closureReminderObserved: false,
        needsClosureReview: false,
        summary: "Retry/resume trace for the same human task.",
      },
      {
        traceId: "trace-cut-chat",
        project: "bridge-mcp",
        workflowKey: "cut-chat-recovery",
        firstAt: "2026-09-23T18:00:00.000Z",
        latestAt: "2026-09-23T23:30:00.000Z",
        latestEventType: "closure_reminder",
        latestStage: "implement",
        caller: "chatgpt-web",
        requiredPhases: ["discovery", "implementation", "verification"],
        completedPhases: ["discovery", "implementation"],
        evidenceRef: "docs/context-cut-evidence.md",
        closureReminderObserved: true,
        needsClosureReview: true,
        summary: "Chat ended after implementation; verification was not recorded.",
      },
      {
        traceId: "trace-support-recovery",
        project: "bridge-mcp",
        workflowKey: "recent-work-recovery-bridge-mcp",
        supportWorkflow: true,
        firstAt: "2026-09-23T17:00:00.000Z",
        latestAt: "2026-09-23T23:45:00.000Z",
        latestEventType: "closure_reminder",
        latestStage: "close",
        caller: "chatgpt-web",
        requiredPhases: ["discovery", "verification"],
        completedPhases: ["discovery", "verification"],
        evidenceRef: "logs/recovery-helper.log",
        closureReminderObserved: true,
        needsClosureReview: true,
        summary: "Forensic helper trace lacks outcome but is not a human task.",
      },
    ],
    daily: [{
      date: "2026-09-23",
      latestAt: "2026-09-23T23:30:00.000Z",
      traceCount: 2,
      projectCount: 1,
      projects: ["bridge-mcp"],
      workflowKeys: ["cockpit-open-work", "cut-chat-recovery"],
      openTraceCount: 2,
      needsClosureReviewCount: 1,
      latestSummaries: [
        { project: "bridge-mcp", summary: "Chat ended after implementation; verification was not recorded." },
        { project: "bridge-mcp", summary: "Implementation complete; verification is next." },
      ],
    }],
  },
};
const capabilityInventory = buildCapabilityInventory({
  toolCatalog: [
    { name: "read_text_file", metadata: { family: "core", lifecycle: "stable" }, annotations: { readOnlyHint: true } },
    { name: "write_text_file", metadata: { family: "core", lifecycle: "stable" }, annotations: { readOnlyHint: false } },
    { name: "blender_status", metadata: { family: "blender", lifecycle: "stable" }, annotations: { readOnlyHint: true } },
  ],
  skillHealth: {
    updatedAt: "2026-09-24T03:50:00.000Z",
    latest: {
      observedAt: "2026-09-24T03:50:00.000Z",
      counts: { catalogSkills: 170, ownedSkills: 57, explicitRouting: 56 },
      maintenanceRequired: true,
      healthReviewRecommended: true,
    },
  },
  workflowGuideCount: 12,
  observedAt: "2026-09-24T04:00:00.000Z",
});

assert.equal(capabilityInventory.toolCount, 3);
assert.equal(capabilityInventory.familyCount, 2);
assert.equal(capabilityInventory.workflowGuideCount, 12);
assert.equal(capabilityInventory.skills.status, "review");
assert.equal(capabilityInventory.families.find((item) => item.family === "core")?.status, "available");
assert.equal(capabilityInventory.families.find((item) => item.family === "blender")?.status, "review");


const cockpit = buildHumanCockpitSnapshot({
  observatoryRecent,
  projectHealth,
  gitStates: [{
    project: "bridge-mcp",
    relativeRoot: "bridge-mcp",
    branch: "main",
    trackedChanges: 4,
    untrackedChanges: 0,
    clean: false,
    remotes: ["origin"],
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    commitCount: 2,
    latestCommitHash: "1234567890abcdef",
    latestCommitAt: "2026-09-23T03:00:00.000Z",
    latestCommitSubject: "dashboard checkpoint",
    observedAt: "2026-09-24T03:59:30.000Z",
    error: null,
  }],
  weeklySummary,
  capabilityInventory,
  contextInventory: {
    schemaVersion: 1,
    mode: "cached",
    refreshReason: "missing",
    refreshedAt: "2026-09-24T03:58:00.000Z",
    sourceLatestAt: "2026-09-24T03:57:00.000Z",
    maxAgeMs: 3600000,
    dailySnapshotCount: 7,
  },
  weeklyGitStates: [{
    project: "bridge-mcp",
    relativeRoot: "bridge-mcp",
    branch: "main",
    trackedChanges: 4,
    untrackedChanges: 1,
    clean: false,
    remotes: ["origin"],
    upstream: "origin/main",
    ahead: 2,
    behind: 0,
    commitCount: 3,
    latestCommitHash: "abcdef1234567890",
    latestCommitAt: "2026-09-23T23:00:00.000Z",
    latestCommitSubject: "human cockpit weekly projection",
    observedAt: "2026-09-24T03:59:30.000Z",
    error: null,
  }],
  now,
});

assert.equal(cockpit.authority.mode, "projection-only");
assert.equal(cockpit.authority.writesProjectTruth, false);
assert.equal(cockpit.traces.slice(0, 3).every((trace) => trace.status !== "closed"), true, "open/idle traces should remain ahead of recent closed work");
assert.equal(cockpit.focus?.traceId, "trace-open");
assert.equal(cockpit.focus?.nextPhase, "verification");
assert.equal(cockpit.focus?.completedPhases.includes("implementation"), true);
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-reopened")?.closed, false, "a later route must reopen an older outcome");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-reopened")?.nextPhase, "verification");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-reopened")?.summary, "Reopened workflow needs verification.", "a reopened task should use the current route intent summary, not an older terminal summary");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-reopened")?.summarySource, "route-intent");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-reopened")?.displayName, "Reopened after outcome");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-reopened")?.attentionKind, "verify");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-resumed-after-reminder")?.status, "active", "activity after a reminder must clear the idle projection");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-legacy-no-summary")?.displayName, "Legacy unlabeled work");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-legacy-no-summary")?.summarySource, "workflow");
assert.match(cockpit.traces.find((trace) => trace.traceId === "trace-legacy-no-summary")?.summary ?? "", /Legacy unlabeled work/);
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-legacy-no-summary")?.attentionKind, "continue", "the newest trace for a repeated workflow remains the actionable root");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-legacy-member")?.attentionKind, "intermediate", "older setup-only traces in the same workflow are members, not separate pending tasks");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-legacy-member")?.traceRole, "workflow-member");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-technical-skill")?.displayName, "Carga de skill · mssr-agent-routing");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-technical-skill")?.summarySource, "technical");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-technical-skill")?.attentionKind, "intermediate");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-synthetic-fixture")?.traceRole, "synthetic-test");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-synthetic-fixture")?.attentionKind, "intermediate");
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-synthetic-fixture")?.summarySource, "synthetic");
assert.match(cockpit.traces.find((trace) => trace.traceId === "trace-synthetic-fixture")?.summary ?? "", /Prueba técnica MSSR/);
assert.equal(cockpit.traces.find((trace) => trace.traceId === "trace-closed")?.closed, true);
assert.equal(cockpit.projects[0].name, "bridge-mcp");
assert.equal(cockpit.projects[0].trackedChanges, 4);
assert.equal(cockpit.counts.projectWatch, 1);
assert.equal(cockpit.referenceLifecycle.candidateReferenceProjectionAvailable, true);
assert.deepEqual(cockpit.referenceLifecycle.candidates, { total: 6, high: 1, medium: 3, low: 2 });
assert.deepEqual(cockpit.referenceLifecycle.highCandidates, [{ project: "bridge-mcp", path: "ROADMAP.md" }]);
assert.equal(cockpit.projects[0].referenceCandidateCount, 6);
assert.equal(cockpit.projects[0].referenceHighPriorityCount, 1);
assert.equal(cockpit.weekly.days, 7);
assert.equal(cockpit.weekly.scope, "all");
assert.equal(cockpit.weekly.projectCount, 1);
assert.equal(cockpit.weekly.substantiveTraceCount, 4);
assert.equal(cockpit.weekly.projects[0].name, "bridge-mcp");
assert.equal(cockpit.weekly.projects[0].commitCount, 3);
assert.equal(cockpit.weekly.projects[0].remoteState, "ahead-local-tracking");
assert.match(cockpit.weekly.projects[0].pendingHint, /5 cambios locales sin commit/);
assert.match(cockpit.weekly.projects[0].latestCommitSubject ?? "", /weekly projection/);
assert.equal(cockpit.morningBrief.yesterday.date, "2026-09-23");
assert.equal(cockpit.morningBrief.yesterday.projectCount, 1);
assert.equal(cockpit.morningBrief.yesterday.needsClosureReviewCount, 1);
assert.equal(cockpit.morningBrief.openTaskCount, 1);
assert.equal(cockpit.morningBrief.lifecycleDebtTaskCount, 1);
assert.equal(cockpit.morningBrief.taskIdentityMode, "mssr-explicit-with-legacy-fallback");
assert.match(cockpit.morningBrief.taskIdentityNote, /Explicit MSSR taskKey/);
const explicitTask = cockpit.morningBrief.tasks.find((task) => task.taskKey === "human-task-cockpit-weekly");
assert.ok(explicitTask, "explicit MSSR task identity should project into the active morning brief");
assert.equal(explicitTask.taskKeySource, "explicit-mssr");
assert.deepEqual(explicitTask.traceIds.sort(), ["trace-open", "trace-open-retry"]);
assert.deepEqual(explicitTask.parentTraceIds, ["trace-open"]);
assert.deepEqual(explicitTask.projects, ["bridge-mcp"]);
assert.equal(explicitTask.resumePacket.schemaVersion, 2);
assert.deepEqual(explicitTask.resumePacket.workflowKeys.sort(), ["cockpit-open-work", "cockpit-open-work-retry"]);
assert.equal(cockpit.morningBrief.needsClosureReviewCount, 1);
assert.equal(cockpit.morningBrief.supportOpenTraceCount, 1);
assert.equal(cockpit.morningBrief.supportNeedsClosureReviewCount, 1);
assert.equal(cockpit.morningBrief.tasks.some((task) => task.workflowKey === "recent-work-recovery-bridge-mcp"), false, "forensic support traces must not inflate human task backlog");
assert.equal(cockpit.capabilities.toolCount, 3);
assert.equal(cockpit.capabilities.workflowGuideCount, 12);
assert.equal(cockpit.contextInventory.mode, "cached");
assert.equal(cockpit.contextInventory.dailySnapshotCount, 7);
const cutChatTask = cockpit.morningBrief.lifecycleDebt.find((task) => task.workflowKey === "cut-chat-recovery");
assert.ok(cutChatTask, "cut chat task should remain reconstructable as lifecycle debt");
assert.equal(cutChatTask.needsClosureReview, true);
assert.equal(cutChatTask.resumePacket.nextGate, "revisar si retomar / cerrar outcome");
assert.equal(cutChatTask.resumePacket.project, "bridge-mcp");
assert.equal(cutChatTask.resumePacket.lastKnownSummary, "Chat ended after implementation; verification was not recorded.");
assert.deepEqual(cutChatTask.resumePacket.completedPhases, ["discovery", "implementation"]);
assert.equal(cutChatTask.resumePacket.evidenceRef, "docs/context-cut-evidence.md");
assert.equal(cockpit.workspaceMap.scope, "observed-7d-plus-open");
assert.equal(cockpit.workspaceMap.projectCount, 1);
assert.equal(cockpit.workspaceMap.counts.active, 1);
assert.equal(cockpit.workspaceMap.counts["review-needed"], 0);
assert.equal(cockpit.workspaceMap.projects[0].name, "bridge-mcp");
assert.equal(cockpit.workspaceMap.projects[0].classification.state, "active");
assert.equal(cockpit.workspaceMap.projects[0].openTaskCount, 1);
assert.equal(cockpit.workspaceMap.projects[0].gitPressure, 5);
assert.equal(cockpit.workspaceMap.projects[0].nextGate, "verificar");
assert.deepEqual(cockpit.workspaceMap.policy.explicitOwnerStates, ["finished", "abandoned-or-replaced"]);

const html = renderDashboardHtml();
assert.match(html, /data-tab="cockpit">Dónde estoy<\/button>/);
assert.match(html, /id="panel-cockpit"/);
assert.match(html, /id="cockpit-traces"/);
assert.match(html, /id=\"cockpit-weekly-summary\"/);
assert.match(html, /id=\"cockpit-weekly-projects\"/);
assert.match(html, /Qué hicimos esta semana/);
assert.match(html, /cockpit-return-summary/);
assert.match(html, /cockpit-yesterday/);
assert.match(html, /cockpit-open-tasks/);
assert.match(html, /cockpit-lifecycle-debt/);
assert.match(html, /Al volver/);
assert.match(html, /cockpit-capability-summary/);
assert.match(html, /cockpit-capability-families/);
assert.match(html, /Qué puede hacer el sistema hoy/);
assert.match(html, /cockpit-workspace-summary/);
assert.match(html, /cockpit-workspace-projects/);
assert.match(html, /En qué está cada proyecto/);
assert.match(html, /referenceCounts\.medium/);
assert.match(html, /referenceCounts\.low/);
assert.match(html, /renderCockpit\(cockpit\)/);

console.log("human cockpit projection tests passed");
