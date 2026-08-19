import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planArchitectureImpactObservations } from "@mauroprime/mssr";
import {
  createBridgeArchitectureImpactFilesystemObserver,
  observeBridgeArchitectureImpactProject,
} from "../dist/architecture-impact-observer.js";

function sha256Revision(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-architecture-impact-"));
try {
  await fs.mkdir(path.join(root, ".mssr"), { recursive: true });
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });

  const authorityBytes = Buffer.from("# Alpha architecture\n", "utf8");
  const sourceBytes = Buffer.from("export const alpha = 1;\n", "utf8");
  const unavailableBytes = Buffer.from("export const unavailable = true;\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "alpha.md"), authorityBytes);
  await fs.writeFile(path.join(root, "src", "alpha.ts"), sourceBytes);
  await fs.writeFile(path.join(root, "src", "unavailable.ts"), unavailableBytes);
  await fs.writeFile(path.join(root, ".mssr", "architecture-impact.json"), `${JSON.stringify({
    schemaVersion: 1,
    architectures: [{
      architectureId: "alpha-plane",
      authorityRef: "docs/alpha.md",
      impactRefs: ["src/alpha.ts", "src/missing.ts", "src/unavailable.ts"],
    }],
  }, null, 2)}\n`, "utf8");

  let unavailableReadAttempts = 0;
  const observed = await observeBridgeArchitectureImpactProject({
    projectRoot: root,
    dependencies: {
      readFile: async (filePath) => {
        if (path.basename(filePath) === "unavailable.ts") {
          unavailableReadAttempts += 1;
          throw Object.assign(new Error("permission denied fixture"), { code: "EACCES" });
        }
        return fs.readFile(filePath);
      },
    },
  });

  assert.equal(observed.found, true);
  assert.equal(observed.evidence.length, 1);
  const evidence = observed.evidence[0];
  assert.equal(evidence.architectureId, "alpha-plane");
  assert.equal(evidence.relationshipClass, "declared");
  assert.equal(evidence.evidenceClass, "observed");
  assert.deepEqual(evidence.declared.impactRefs, ["src/alpha.ts", "src/missing.ts", "src/unavailable.ts"]);
  assert.deepEqual(evidence.observed.authority, {
    ref: "docs/alpha.md",
    availability: "available",
    revision: sha256Revision(authorityBytes),
  });
  assert.deepEqual(evidence.observed.impacts, [
    { ref: "src/alpha.ts", availability: "available", revision: sha256Revision(sourceBytes) },
    { ref: "src/missing.ts", availability: "missing" },
    { ref: "src/unavailable.ts", availability: "unavailable", reasonCode: "fs-eacces" },
  ]);
  assert.equal(unavailableReadAttempts, 1, "Bridge observer should inspect each declared ref once, not retry hidden I/O");
  assert.equal("sourceSetFingerprint" in evidence, false);
  assert.equal("possibleImpact" in evidence, false);
  assert.equal("notice" in evidence, false);

  const manifest = {
    schemaVersion: 1,
    architectures: [{
      architectureId: "safety-plane",
      authorityRef: "docs/alpha.md",
      impactRefs: ["src/alpha.ts"],
    }],
  };
  const [plan] = planArchitectureImpactObservations(manifest);
  const resolvedRoot = path.resolve(root);
  const outsideRoot = path.resolve(root, "..", "outside-architecture-impact-fixture");
  const unsafeObserver = createBridgeArchitectureImpactFilesystemObserver(root, {
    realpath: async (filePath) => path.resolve(filePath) === resolvedRoot
      ? resolvedRoot
      : path.join(outsideRoot, path.basename(filePath)),
    stat: async () => ({ isFile: () => true }),
    readFile: async () => Buffer.from("must-not-be-read"),
  });
  const unsafe = await unsafeObserver(plan);
  assert.deepEqual(unsafe.authority, {
    ref: "docs/alpha.md",
    availability: "unavailable",
    reasonCode: "path-outside-project",
  });
  assert.deepEqual(unsafe.impacts, [{
    ref: "src/alpha.ts",
    availability: "unavailable",
    reasonCode: "path-outside-project",
  }]);

  await fs.rm(path.join(root, ".mssr", "architecture-impact.json"));
  const absent = await observeBridgeArchitectureImpactProject({ projectRoot: root });
  assert.equal(absent.found, false);
  assert.deepEqual(absent.evidence, []);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("Bridge MSSR C2f-B filesystem observer: PASS");
