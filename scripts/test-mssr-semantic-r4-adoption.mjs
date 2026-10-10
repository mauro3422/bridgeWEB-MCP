import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import {
  MSSR_SEMANTIC_EXPERIENCE_MODE,
  classifyMssrSemanticExperienceDeterministically,
  createMssrSemanticExperienceObservation,
  evaluateMssrSemanticConsistency,
  evaluateMssrSemanticShadowEvidence,
  produceMssrSemanticContextMessages,
  retrieveMssrSemanticCandidates,
} from "@mauroprime/mssr";

const bridgePackage = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await fs.readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const mssrSpecifier = bridgePackage.dependencies?.["@mauroprime/mssr"];
const mssrMatch = typeof mssrSpecifier === "string"
  ? mssrSpecifier.match(/^file:(vendor\/mauroprime-mssr-(\d+\.\d+\.\d+)\.tgz)$/)
  : null;
assert.ok(mssrMatch, "Bridge must pin MSSR to a versioned local release-gate artifact");
const [, vendorRelativePath, expectedVersion] = mssrMatch;
const installedPackage = JSON.parse(
  await fs.readFile(new URL("../node_modules/@mauroprime/mssr/package.json", import.meta.url), "utf8"),
);
assert.equal(installedPackage.version, expectedVersion, `Bridge must consume its pinned MSSR ${expectedVersion} package`);
const vendorTarball = await fs.readFile(new URL(`../${vendorRelativePath}`, import.meta.url));
assert.equal(expectedVersion, "0.2.112", "Bridge must adopt the current verified MSSR release");
assert.equal(vendorTarball.byteLength, 1_121_628, "Bridge must vendor the exact MSSR 0.2.112 release-gate size");
assert.equal(
  createHash("sha256").update(vendorTarball).digest("hex"),
  "78a49828f9f27ebb3a3966b1a163ad9e24f7a3a8c38f1a8a4633d985106fd088",
  "Bridge must vendor the byte-identical MSSR 0.2.112 release-gate artifact",
);
const lockedMssr = packageLock.packages?.["node_modules/@mauroprime/mssr"];
assert.equal(lockedMssr?.version, expectedVersion, "package-lock.json must pin the same MSSR version as package.json");
assert.equal(lockedMssr?.resolved, mssrSpecifier, "package-lock.json must point to the exact MSSR tarball selected by package.json");
assert.equal(
  lockedMssr?.integrity,
  `sha512-${createHash("sha512").update(vendorTarball).digest("base64")}`,
  `Bridge must vendor the exact locked MSSR ${expectedVersion} artifact`,
);

const roadmapEvaluation = evaluateMssrSemanticConsistency({
  boundary: "ordinary",
  claims: [
    {
      kind: "state-value",
      subject: "roadmap.r4",
      source: "project-state",
      sourceRef: ".mssr/PROJECT_STATE.md#roadmap.r4",
      authority: "canonical",
      value: "completed",
    },
    {
      kind: "state-value",
      subject: "roadmap.r4",
      source: "project-context",
      sourceRef: "ROADMAP.md#r4",
      authority: "replica",
      value: "pending",
    },
  ],
});
assert.equal(roadmapEvaluation.findings.length, 1);
assert.equal(roadmapEvaluation.findings[0].evidenceTier, "proven");
assert.equal(roadmapEvaluation.canonicalRewriteAllowed, false);

const messages = produceMssrSemanticContextMessages({
  evaluation: roadmapEvaluation,
  observedAt: "2026-09-19T20:00:00-03:00",
});
const repeatedMessages = produceMssrSemanticContextMessages({
  evaluation: roadmapEvaluation,
  observedAt: "2026-09-19T20:05:00-03:00",
});
assert.equal(messages.length, 1);
assert.equal(messages[0].kind, "roadmap-contradiction");
assert.equal(messages[0].advisoryActions.includes("inspect-reference"), true);
assert.equal(messages[0].advisoryActions.includes("replan"), true);
assert.equal(
  messages[0].dedupeKey,
  repeatedMessages[0].dedupeKey,
  "Bridge must preserve stable semantic message identity across repeated observations",
);

const resolvedRoadmap = evaluateMssrSemanticConsistency({
  boundary: "ordinary",
  claims: roadmapEvaluation.activeClaims.map((claim) => ({ ...claim, value: "completed" })),
});
assert.equal(
  produceMssrSemanticContextMessages({
    evaluation: resolvedRoadmap,
    observedAt: "2026-09-19T20:10:00-03:00",
  }).length,
  0,
  "A resolved contradiction must become silent instead of leaving stale semantic noise",
);

const claims = [
  {
    kind: "release-version",
    subject: "bridge.release.source",
    source: "source",
    sourceRef: "package.json",
    authority: "canonical",
    value: "0.6.140",
  },
  {
    kind: "release-version",
    subject: "bridge.release.runtime",
    source: "runtime",
    sourceRef: "bridge-health",
    authority: "replica",
    value: "0.6.140",
  },
];
const candidates = retrieveMssrSemanticCandidates({
  claims,
  relations: [
    {
      id: "bridge-source-mirrors-runtime",
      kind: "mirrors",
      fromSubject: "bridge.release.source",
      toSubject: "bridge.release.runtime",
      owner: "mssr",
      sourceRef: "bridge-host-adoption-test",
      required: true,
    },
  ],
});
assert.equal(candidates.candidates[0].method, "declared-relation");
assert.equal(candidates.candidates[0].truthAuthority, false);
assert.equal(candidates.lexicalTruthAuthority, false);

const shadow = evaluateMssrSemanticShadowEvidence({
  schemaVersion: 1,
  candidateId: "bridge-r4-host-adoption",
  modelId: "test-only-shadow",
  modelRevision: "fixture-v1",
  label: "entails",
  score: 0.99,
  sourceRefs: ["package.json", "bridge-health"],
  observedAt: "2026-09-19T20:00:00-03:00",
});
assert.equal(shadow.evidenceClass, "derived");
assert.equal(shadow.evidenceTier, "candidate");
assert.equal(shadow.routingInfluence, false);
assert.equal(shadow.truthAuthority, false);
assert.equal(shadow.directNoticeAuthority, false);
assert.equal(shadow.canonicalRewriteAllowed, false);

const semanticExperience = createMssrSemanticExperienceObservation({
  projectKey: "bridge-mcp",
  decisionKind: "context-selection",
  feature: {
    subjectKind: "project-context",
    candidateKinds: ["baseline", "reference"],
    signals: ["host-adoption"],
    flags: { installed: true },
    buckets: { release: "0.2.89" },
  },
  proposal: {
    value: "baseline",
    confidence: 0.9,
    provider: "bridge-host",
    modelId: "adoption-smoke",
  },
});
assert.equal(MSSR_SEMANTIC_EXPERIENCE_MODE, "verified-shadow-experience");
assert.equal(semanticExperience.verification.status, "unknown");
assert.equal(semanticExperience.authorityInfluence, false);
assert.equal(semanticExperience.routingInfluence, false);
assert.equal(semanticExperience.autoApplyAllowed, false);
const semanticFallback = classifyMssrSemanticExperienceDeterministically({
  decisionKind: "context-selection",
  feature: semanticExperience.feature,
});
assert.equal(semanticFallback.basis, "abstain");
assert.equal(semanticFallback.value, null);
assert.equal(semanticFallback.reviewRequired, true);
assert.equal(semanticFallback.autoApplyAllowed, false);

console.log(`Bridge MSSR ${expectedVersion} R4 and semantic-shadow host-consumption tests passed.`);
