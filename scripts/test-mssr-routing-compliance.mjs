import assert from "node:assert/strict";

import { createMssrRoutingComplianceNoticeTracker } from "../dist/mssr-routing-compliance.js";

function observe(tracker, overrides = {}, extra = {}) {
  return tracker.observe({
    subject: extra.subject ?? "routing-chain:test-session:test-project:chatgpt-web",
    source: "test-mssr-routing-compliance",
    traceId: extra.traceId ?? null,
    observation: {
      trace: "matched",
      route: "present",
      boundary: "ordinary",
      requiredSkills: [],
      loadedSkills: [],
      requiredPhases: [],
      completedPhases: [],
      ...overrides,
    },
    ...extra,
  });
}

{
  const tracker = createMssrRoutingComplianceNoticeTracker();
  const quietWatch = observe(tracker, { trace: "not-applicable", route: "missing" });
  assert.equal(quietWatch.projection.level, "watch");
  assert.equal(quietWatch.notice, null, "ordinary unrouted evidence must stay quiet");

  const review = observe(tracker, { trace: "not-applicable", route: "missing", boundary: "substantial-tool" });
  assert.equal(review.projection.level, "review");
  assert.equal(review.notice?.severity, "warning");
  assert.equal(review.notice?.code, "mssr-routing-compliance-review");
  assert.deepEqual(review.notice?.details?.reasonCodes, ["route-missing", "substantial-tool-without-route"]);
  assert.ok(review.notice?.actions?.some((action) => action.toolName === "skill_bootstrap"));

  const stableReview = observe(tracker, { trace: "not-applicable", route: "missing", boundary: "substantial-tool" });
  assert.equal(stableReview.projection.level, "review");
  assert.equal(stableReview.notice, null, "stable actionable evidence must not spam repeated notices");

  const resolved = observe(tracker, { trace: "matched", route: "present", boundary: "ordinary" }, { traceId: "mssr-test-trace" });
  assert.equal(resolved.projection.level, "ok");
  assert.equal(resolved.notice?.severity, "info");
  assert.equal(resolved.notice?.code, "mssr-routing-compliance-resolved");
}

{
  const tracker = createMssrRoutingComplianceNoticeTracker();
  const missing = observe(tracker, {
    boundary: "phase-boundary",
    requiredSkills: ["skill-b", "skill-a"],
    loadedSkills: ["skill-b"],
  }, {
    subject: "routing-trace:mssr-required-test",
    traceId: "mssr-required-test",
    code: "mssr-required-skill-not-loaded",
  });
  assert.equal(missing.projection.level, "review");
  assert.deepEqual(missing.projection.recommendedRequiredSkills, ["skill-a"]);
  assert.equal(missing.notice?.code, "mssr-required-skill-not-loaded");
  assert.ok(missing.notice?.actions?.some((action) => action.toolName === "skill_load" && action.arguments?.name === "skill-a"));

  const changedMissing = observe(tracker, {
    boundary: "phase-boundary",
    requiredSkills: ["skill-c", "skill-b", "skill-a"],
    loadedSkills: ["skill-b"],
  }, {
    subject: "routing-trace:mssr-required-test",
    traceId: "mssr-required-test",
    code: "mssr-required-skill-not-loaded",
  });
  assert.equal(changedMissing.notice?.severity, "warning", "a material semantic fingerprint change must surface again");
  assert.deepEqual(changedMissing.projection.recommendedRequiredSkills, ["skill-a", "skill-c"]);

  const optionalOnly = observe(tracker, {
    boundary: "phase-boundary",
    selectedSkills: ["optional-skill"],
    loadedSkills: [],
  }, {
    subject: "routing-trace:optional-only",
  });
  assert.equal(optionalOnly.projection.level, "ok");
  assert.equal(optionalOnly.notice, null);
}

{
  const tracker = createMssrRoutingComplianceNoticeTracker();
  const mismatch = observe(tracker, { trace: "mismatch", route: "present", boundary: "phase-boundary" }, {
    subject: "routing-trace:mismatch",
    traceId: "mssr-mismatch-active",
    code: "mssr-trace-mismatch",
    errorCode: "mssr-trace-mismatch",
  });
  assert.equal(mismatch.projection.level, "error");
  assert.equal(mismatch.notice?.severity, "error");
  assert.equal(mismatch.notice?.code, "mssr-trace-mismatch");
  assert.ok(mismatch.notice?.actions?.some((action) => action.toolName === "mssr_trace_evidence"));
  assert.ok(mismatch.notice?.actions?.some((action) => action.toolName === "skill_bootstrap"));
}

{
  const tracker = createMssrRoutingComplianceNoticeTracker();
  const outcome = observe(tracker, {
    trace: "missing",
    route: "missing",
    boundary: "outcome",
  }, {
    subject: "routing-host:test:outcome",
    code: "mssr-outcome-without-route",
    errorCode: "mssr-outcome-without-route",
  });
  assert.equal(outcome.projection.level, "error");
  assert.equal(outcome.notice?.code, "mssr-outcome-without-route");
  assert.deepEqual(outcome.projection.reasonCodes, ["outcome-without-route", "route-missing", "trace-missing"]);
}

console.log("Bridge MSSR routing compliance adapter: PASS");
