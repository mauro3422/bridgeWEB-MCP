import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { initializeMssrProject } from "@mauroprime/mssr";
import { collectBridgeDocumentFreshness } from "../dist/document-freshness-host.js";
import { collectProjectHealthSnapshot } from "../dist/project-health.js";

const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  await execFileAsync("git", ["-C", root, ...args], { windowsHide: true, timeout: 10000 });
}

async function commitAll(root, message) {
  await git(root, "add", "-A");
  await git(root, "commit", "-m", message);
}

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-document-freshness-"));
const projectRoot = path.join(workspaceRoot, "alpha");
try {
  await fs.mkdir(projectRoot, { recursive: true });
  await git(projectRoot, "init");
  await git(projectRoot, "config", "user.email", "bridge-test@example.invalid");
  await git(projectRoot, "config", "user.name", "Bridge Test");
  const init = await initializeMssrProject(projectRoot, { initializeMissing: true, cleanupLegacyArtifacts: true });
  assert.equal(init.initialized, true);

  await fs.mkdir(path.join(projectRoot, "docs"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "docs", "STATUS.md"), "# Current status\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "src", "impl.ts"), "export const version = 1;\n", "utf8");
  await fs.writeFile(path.join(projectRoot, ".mssr", "document-freshness.json"), JSON.stringify({
    schemaVersion: 1,
    documents: [{
      documentId: "status-current",
      documentRef: "docs/STATUS.md",
      kind: "status",
      impactRefs: ["src/impl.ts"],
    }],
  }, null, 2) + "\n", "utf8");
  await commitAll(projectRoot, "baseline current status");

  const baseline = await collectBridgeDocumentFreshness(projectRoot);
  assert.equal(baseline.manifestStatus, "valid");
  assert.equal(baseline.evaluation?.level, "ok");
  assert.deepEqual(baseline.evaluation?.findings, []);

  await fs.writeFile(path.join(projectRoot, "src", "impl.ts"), "export const version = 2;\n", "utf8");
  const dirtyImpact = await collectBridgeDocumentFreshness(projectRoot);
  assert.equal(dirtyImpact.evaluation?.level, "review");
  assert.equal(dirtyImpact.evaluation?.findings[0]?.code, "impact-ref-newer");
  assert.equal(dirtyImpact.evaluation?.semanticContradictionProven, false);
  assert.equal(dirtyImpact.evaluation?.canonicalRewriteAllowed, false);

  await commitAll(projectRoot, "implementation changed");
  const committedImpact = await collectBridgeDocumentFreshness(projectRoot);
  assert.equal(committedImpact.evaluation?.level, "review");
  assert.equal(committedImpact.evaluation?.findings[0]?.code, "impact-ref-newer");

  const healthAfterImpact = await collectProjectHealthSnapshot({ workspaceRoot, maxDepth: 2, now: new Date("2026-09-19T00:00:00Z") });
  assert.equal(healthAfterImpact.projects.length, 1);
  assert.equal(healthAfterImpact.projects[0].level, "review");
  assert.equal(healthAfterImpact.projects[0].freshnessLevel, "review");
  assert.equal(healthAfterImpact.projects[0].freshnessManifestStatus, "valid");
  assert.ok(healthAfterImpact.projects[0].findingCodes.includes("document-freshness-impact-ref-newer"));
  assert.deepEqual(healthAfterImpact.projects[0].freshnessReviewDocuments, ["docs/STATUS.md"]);

  await fs.writeFile(path.join(projectRoot, "docs", "STATUS.md"), "# Current status\n\nReviewed for version 2.\n", "utf8");
  await commitAll(projectRoot, "review current status");
  const reviewed = await collectBridgeDocumentFreshness(projectRoot);
  assert.equal(reviewed.evaluation?.level, "ok");

  await fs.appendFile(path.join(projectRoot, "docs", "STATUS.md"), "\nDraft review in progress.\n", "utf8");
  const documentDirty = await collectBridgeDocumentFreshness(projectRoot);
  assert.equal(documentDirty.evaluation?.level, "watch");
  assert.equal(documentDirty.evaluation?.findings[0]?.code, "freshness-unknown");

  await git(projectRoot, "checkout", "--", "docs/STATUS.md");
  await fs.writeFile(path.join(projectRoot, ".mssr", "document-freshness.json"), "{ invalid json", "utf8");
  const invalid = await collectBridgeDocumentFreshness(projectRoot);
  assert.equal(invalid.manifestStatus, "invalid");
  assert.equal(invalid.evaluation, null);
} finally {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

console.log("Bridge Document Freshness host adoption tests PASS");
