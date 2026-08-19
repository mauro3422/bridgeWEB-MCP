import assert from "node:assert/strict";
import { buildProjectHealthNoticeInputs, buildSkillHealthNoticeInputs } from "../dist/operational-notices.js";

function skill(status, reasonCodes = []) {
  return {
    name: "fixture-skill",
    source: "fixture",
    status,
    reasonCodes,
    recommendation: "Review fixture skill structure.",
    lines: 100,
    chars: 1000,
    contextManifestStatus: "indexed",
    contextModuleCount: 2,
    referenceFiles: 1,
    referenceChars: 400,
  };
}

function skillSnapshot(item, observedAt = "2026-08-15T20:00:00.000Z") {
  return {
    observedAt,
    counts: { ownedSkills: 1 },
    maintenanceRequired: false,
    healthReviewRecommended: item.status === "review",
    sourceWarnings: [],
    skills: [item],
  };
}

function project(level, findings = []) {
  return {
    name: "fixture-project",
    relativeRoot: "fixture-project",
    level,
    manifestStatus: "valid",
    coreEntries: 2,
    modules: 3,
    findingCount: findings.length,
    findingCodes: [...new Set(findings.map((item) => item.code))].sort(),
    findings,
  };
}

function projectSnapshot(item, observedAt = "2026-08-15T20:00:00.000Z") {
  return {
    observedAt,
    workspaceRoot: "D:/Dev",
    counts: {
      projects: 1,
      initialized: 1,
      ok: item.level === "ok" ? 1 : 0,
      watch: item.level === "watch" ? 1 : 0,
      review: item.level === "review" ? 1 : 0,
    },
    projects: [item],
  };
}

const initialSkillReview = buildSkillHealthNoticeInputs(skillSnapshot(skill("review", ["oversized-skill"])), null);
assert.equal(initialSkillReview.length, 1);
assert.equal(initialSkillReview[0].code, "mssr-skill-health-review");
assert.equal(initialSkillReview[0].severity, "warning");
assert.equal(initialSkillReview[0].details?.event, "opened");
assert.equal(initialSkillReview[0].details?.advisoryOnly, true);
assert.equal(initialSkillReview[0].actions?.[0]?.toolName, "skill_route_audit");

const stableSkillReview = buildSkillHealthNoticeInputs(
  skillSnapshot(skill("review", ["oversized-skill"]), "2026-08-16T20:00:00.000Z"),
  skillSnapshot(skill("review", ["oversized-skill"])),
);
assert.equal(stableSkillReview.length, 0, "unchanged daily REVIEW must stay quiet after the first observation");

const changedSkillReview = buildSkillHealthNoticeInputs(
  skillSnapshot(skill("review", ["oversized-skill", "full-fallback"]), "2026-08-16T20:00:00.000Z"),
  skillSnapshot(skill("review", ["oversized-skill"])),
);
assert.equal(changedSkillReview.length, 1);
assert.equal(changedSkillReview[0].details?.event, "changed");

const resolvedSkill = buildSkillHealthNoticeInputs(
  skillSnapshot(skill("ok"), "2026-08-16T20:00:00.000Z"),
  skillSnapshot(skill("review", ["oversized-skill"])),
);
assert.equal(resolvedSkill.length, 1);
assert.equal(resolvedSkill[0].code, "mssr-skill-health-resolved");
assert.equal(resolvedSkill[0].severity, "info");
assert.equal(resolvedSkill[0].details?.event, "resolved");

assert.equal(buildSkillHealthNoticeInputs(skillSnapshot(skill("watch", ["growth"])), null).length, 0, "WATCH stays quiet by default");

const reviewFinding = { code: "oversized-authority", target: ".mssr/PROJECT_STATE.md", recommendation: "Modularize reviewed state." };
const initialProjectReview = buildProjectHealthNoticeInputs(projectSnapshot(project("review", [reviewFinding])), null);
assert.equal(initialProjectReview.length, 1);
assert.equal(initialProjectReview[0].code, "mssr-project-health-review");
assert.equal(initialProjectReview[0].details?.event, "opened");
assert.equal(initialProjectReview[0].actions?.[0]?.toolName, "project_context_audit");
assert.equal(initialProjectReview[0].actions?.[0]?.arguments?.workspaceRoot, "D:/Dev");

const stableProjectReview = buildProjectHealthNoticeInputs(
  projectSnapshot(project("review", [reviewFinding]), "2026-08-16T20:00:00.000Z"),
  projectSnapshot(project("review", [reviewFinding])),
);
assert.equal(stableProjectReview.length, 0);

const changedProjectReview = buildProjectHealthNoticeInputs(
  projectSnapshot(project("review", [reviewFinding, { code: "oversized-module", target: "state-module", recommendation: "Extract reviewed module." }]), "2026-08-16T20:00:00.000Z"),
  projectSnapshot(project("review", [reviewFinding])),
);
assert.equal(changedProjectReview.length, 1);
assert.equal(changedProjectReview[0].details?.event, "changed");

const resolvedProject = buildProjectHealthNoticeInputs(
  projectSnapshot(project("watch", [{ code: "growth", target: "context", recommendation: "Observe." }]), "2026-08-16T20:00:00.000Z"),
  projectSnapshot(project("review", [reviewFinding])),
);
assert.equal(resolvedProject.length, 1);
assert.equal(resolvedProject[0].code, "mssr-project-health-resolved");
assert.equal(resolvedProject[0].details?.event, "resolved");
assert.equal(resolvedProject[0].details?.advisoryOnly, true);

console.log("Bridge Operational Notice Plane health adapters PASS");
