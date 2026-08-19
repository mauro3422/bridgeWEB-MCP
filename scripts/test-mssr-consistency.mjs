import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMssrConsistencyNoticeTracker } from "../dist/mssr-consistency.js";
import {
  collectBridgeReleaseConsistencyObservations,
  observeBridgeReleaseConsistency,
} from "../dist/release-consistency.js";

async function fixture({
  packageVersion = "0.6.103",
  sourceVersion = packageVersion,
  distVersion = packageVersion,
  declaredMssr = "0.2.24",
  installedMssr = declaredMssr,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-c2c-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "@mauroprime", "mssr"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "bridge-c2c-fixture",
    version: packageVersion,
    dependencies: { "@mauroprime/mssr": `file:vendor/mauroprime-mssr-${declaredMssr}.tgz` },
  }, null, 2));
  await fs.writeFile(path.join(root, "src", "config.ts"), `export const SERVER_VERSION = "${sourceVersion}";\n`);
  await fs.writeFile(path.join(root, "dist", "config.js"), `export const SERVER_VERSION = "${distVersion}";\n`);
  await fs.writeFile(path.join(root, "node_modules", "@mauroprime", "mssr", "package.json"), JSON.stringify({
    name: "@mauroprime/mssr",
    version: installedMssr,
  }, null, 2));
  return root;
}

const healthyRoot = await fixture();
try {
  const observations = await collectBridgeReleaseConsistencyObservations(healthyRoot, "0.6.103");
  assert.equal(observations.length, 6);
  const healthy = await observeBridgeReleaseConsistency({ root: healthyRoot, runtimeVersion: "0.6.103", boundary: "post-restart" });
  assert.equal(healthy.projection.level, "ok");
  assert.equal(healthy.projection.evidenceComplete, true);
  assert.deepEqual(healthy.projection.reasonCodes, []);
  assert.equal(healthy.projection.recommendationPolicy, "evidence-first-v1");
  assert.equal(healthy.projection.recommendationMode, "none");
  assert.equal(healthy.projection.nextAction, null);
  assert.deepEqual(healthy.projection.recommendations, []);
} finally {
  await fs.rm(healthyRoot, { recursive: true, force: true });
}

const staleRuntimeRoot = await fixture({ distVersion: "0.6.102" });
try {
  const stale = await observeBridgeReleaseConsistency({ root: staleRuntimeRoot, runtimeVersion: "0.6.102", boundary: "post-restart" });
  assert.equal(stale.projection.level, "error");
  assert.equal(stale.projection.reasonCodes.includes("generated-artifact-mismatch"), true);
  assert.equal(stale.projection.reasonCodes.includes("runtime-state-mismatch"), true);
  assert.equal(stale.projection.recommendedActions.includes("rebuild-generated-artifact"), true);
  assert.equal(stale.projection.recommendedActions.includes("verify-live-runtime"), true);
  assert.equal(stale.projection.mismatches.some((item) => item.observedObserver === "dist/config.js"), true);
  assert.equal(stale.projection.mismatches.some((item) => item.observedObserver === "live-runtime"), true);
  assert.equal(stale.projection.recommendationPolicy, "evidence-first-v1");
  assert.equal(stale.projection.nextAction, "rebuild-generated-artifact");
  assert.equal(stale.projection.recommendationMode, "repair");
  assert.equal(stale.projection.recommendations.find((item) => item.action === "rebuild-generated-artifact")?.status, "ready");
  assert.equal(stale.projection.recommendations.find((item) => item.action === "verify-live-runtime")?.status, "deferred");

  const staleNotice = createMssrConsistencyNoticeTracker().observe({
    subject: "fixture-stale-release",
    source: "fixture",
    boundary: "post-restart",
    observations: stale.observations,
  });
  assert.ok(staleNotice.notice);
  assert.equal(staleNotice.notice.details?.recommendationPolicy, "evidence-first-v1");
  assert.equal(staleNotice.notice.details?.nextAction, "rebuild-generated-artifact");
  assert.equal(staleNotice.notice.actions?.some((item) => item.label === "Reconstruir artefacto generado"), true);
  assert.equal(staleNotice.notice.actions?.some((item) => item.label === "Verificar runtime Bridge"), false, "deferred C2d actions must not be rendered as immediate notice actions");
} finally {
  await fs.rm(staleRuntimeRoot, { recursive: true, force: true });
}

const staleInstallRoot = await fixture({ installedMssr: "0.2.22" });
try {
  const stale = await observeBridgeReleaseConsistency({ root: staleInstallRoot, runtimeVersion: "0.6.103", boundary: "post-restart" });
  assert.equal(stale.projection.level, "error");
  assert.equal(stale.projection.reasonCodes.includes("installed-artifact-mismatch"), true);
  assert.equal(stale.projection.recommendedActions.includes("refresh-installed-artifact"), true);
  assert.equal(stale.projection.nextAction, "refresh-installed-artifact");
  assert.equal(stale.projection.recommendations[0].risk, "high");
  assert.equal(stale.projection.recommendations[0].blastRadius, "high");
} finally {
  await fs.rm(staleInstallRoot, { recursive: true, force: true });
}

const tracker = createMssrConsistencyNoticeTracker();
const historicalInput = {
  subject: "fixture-historical-release",
  source: "fixture",
  boundary: "context-load",
  observations: [
    { key: "bridge.release-version", observer: "package.json", role: "source", authority: "canonical", state: "observed", value: "0.6.103" },
    { key: "bridge.release-version", observer: "receipt:old", role: "receipt", authority: "historical", state: "observed", value: "0.6.99" },
  ],
  details: { marker: "bounded-marker" },
};
const opened = tracker.observe(historicalInput);
assert.equal(opened.projection.level, "review");
assert.ok(opened.notice);
assert.equal(opened.notice.code, "mssr-consistency-review");
assert.equal(opened.projection.recommendationPolicy, "evidence-first-v1");
assert.equal(opened.projection.nextAction, "revalidate-context-evidence");
assert.equal(opened.notice.details?.recommendationPolicy, "evidence-first-v1");
assert.equal(opened.notice.details?.nextAction, "revalidate-context-evidence");
assert.equal(opened.notice.details?.advisoryOnly, true);
assert.equal(opened.notice.actions?.[0]?.label, "Revalidar evidencia de contexto");
assert.equal(opened.notice.actions?.some((item) => item.label === "Revalidar evidencia de contexto"), true);

const stable = tracker.observe(historicalInput);
assert.equal(stable.notice, null, "same semantic mismatch must remain quiet after first delivery");

const resolved = tracker.observe({
  ...historicalInput,
  observations: [
    { key: "bridge.release-version", observer: "package.json", role: "source", authority: "canonical", state: "observed", value: "0.6.103" },
    { key: "bridge.release-version", observer: "receipt:old", role: "receipt", authority: "historical", state: "observed", value: "0.6.103" },
  ],
});
assert.equal(resolved.projection.level, "ok");
assert.ok(resolved.notice);
assert.equal(resolved.notice.code, "mssr-consistency-resolved");
assert.deepEqual(resolved.notice.actions, []);

const privacy = JSON.stringify(opened.notice);
assert.equal(privacy.includes("rawFileContentsStored"), true);
assert.equal(privacy.includes("rawMemoryStored"), true);
assert.equal(privacy.includes("privateReasoningStored"), true);
assert.equal(privacy.includes("whole-secret-memory-body"), false);

const missingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-c2c-missing-"));
try {
  const missing = await observeBridgeReleaseConsistency({ root: missingRoot, runtimeVersion: "0.6.103", boundary: "post-restart" });
  assert.notEqual(missing.projection.level, "ok");
  assert.equal(missing.projection.evidenceComplete, false);
  assert.equal(missing.projection.reasonCodes.includes("canonical-authority-unavailable"), true);
} finally {
  await fs.rm(missingRoot, { recursive: true, force: true });
}

console.log("Bridge MSSR C2c consistency adapter: PASS");
