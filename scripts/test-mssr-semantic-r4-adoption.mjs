import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  evaluateMssrSemanticConsistency,
  evaluateMssrSemanticShadowEvidence,
  produceMssrSemanticContextMessages,
  retrieveMssrSemanticCandidates,
} from "@mauroprime/mssr";

const installedPackage = JSON.parse(
  await fs.readFile(new URL("../node_modules/@mauroprime/mssr/package.json", import.meta.url), "utf8"),
);
assert.equal(installedPackage.version, "0.2.72", "Bridge must consume the exact MSSR 0.2.72 package");

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
assert.equal(messages.length, 1);
assert.equal(messages[0].kind, "roadmap-contradiction");
assert.equal(messages[0].advisoryActions.includes("inspect-reference"), true);
assert.equal(messages[0].advisoryActions.includes("replan"), true);

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

console.log("Bridge MSSR 0.2.72 R4 host-consumption adoption test passed.");
