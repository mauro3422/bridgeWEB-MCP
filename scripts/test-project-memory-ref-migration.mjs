import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateProjectMemoryRefs } from "./migrate-project-memory-refs.mjs";

function hash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function extract(markdown, headings) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks = [];
  for (const requested of headings) {
    const matches = lines.map((line, index) => ({ line: line.trim(), index })).filter((item) => item.line === requested.trim());
    assert.equal(matches.length, 1);
    const start = matches[0].index;
    const level = /^(#{1,6})\s+/.exec(lines[start])?.[1].length;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const next = /^(#{1,6})\s+/.exec(lines[index].trim())?.[1].length ?? null;
      if (next !== null && next <= level) { end = index; break; }
    }
    chunks.push(lines.slice(start, end).join("\n").trim());
  }
  return chunks.join("\n\n");
}

function makeFakeMssr(projectRoot, specs) {
  return {
    extractProjectContextSections: extract,
    async planMssrProjectContextModularization() {
      const memory = await fs.readFile(path.join(projectRoot, ".mssr", "PROJECT_MEMORY.md"), "utf8");
      const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, ".mssr", "project-context.json"), "utf8"));
      const rootBackedIds = new Set(manifest.modules
        .filter((module) => module.kind === "memory" && module.source?.path === ".mssr/PROJECT_MEMORY.md")
        .map((module) => module.id));
      const activeSpecs = specs.filter((spec) => rootBackedIds.has(spec.id));
      return {
        health: { level: activeSpecs.length >= 2 ? "watch" : "ok", findings: activeSpecs.length >= 2 ? [{ code: "root-backed-memory-fanout" }] : [] },
        candidates: activeSpecs.map((spec) => {
          const content = extract(memory, [spec.heading]);
          return {
            action: "extract-indexed-section",
            entryId: spec.id,
            core: false,
            sourcePath: ".mssr/PROJECT_MEMORY.md",
            heading: spec.heading,
            chars: Buffer.byteLength(content, "utf8"),
            sha256: hash(content),
            topic: "decision",
            topicInferred: false,
            area: spec.area,
            suggestedPath: spec.target,
            suggestedModuleId: spec.id,
            preserveModuleId: true,
            preserveSelectorsFrom: spec.id,
            preserveKind: "memory",
            requiresCoreDecision: false,
          };
        }),
      };
    },
    async auditMssrProjectContextHealth() {
      const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, ".mssr", "project-context.json"), "utf8"));
      const rootBacked = manifest.modules.filter((module) => module.kind === "memory" && module.source?.path === ".mssr/PROJECT_MEMORY.md").length;
      return { level: rootBacked >= 2 ? "watch" : "ok", findings: rootBacked >= 2 ? [{ code: "root-backed-memory-fanout" }] : [] };
    },
  };
}

async function writeFixture(root) {
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.mkdir(path.join(root, ".mssr", "knowledge", "decision"), { recursive: true });
  const memoryA = "## Decision A\n\nKeep A as durable memory.";
  const memoryB = "## Decision B\n\nKeep B as durable memory.";
  await fs.writeFile(path.join(root, ".mssr", "PROJECT_MEMORY.md"), `# Project Memory\n\n${memoryA}\n\n${memoryB}\n\n## Core invariant\n\nKeep this in root.\n`, "utf8");
  const manifest = {
    schemaVersion: 1,
    core: [],
    modules: [
      {
        id: "decision-a",
        kind: "memory",
        topic: "decision",
        area: "routing",
        description: "Decision A.",
        source: { path: ".mssr/PROJECT_MEMORY.md", sections: ["## Decision A"] },
        stages: ["implement"],
        domains: ["coding"],
        actions: ["maintain"],
        artifacts: ["project"],
        needs: ["integrity-verification"],
        signals: ["reusable-pattern"],
        required: false,
        priority: 20,
        maxChars: 1000,
      },
      {
        id: "decision-b",
        kind: "memory",
        topic: "decision",
        area: "runtime",
        description: "Decision B.",
        source: { path: ".mssr/PROJECT_MEMORY.md", sections: ["## Decision B"] },
        stages: ["verify"],
        domains: ["filesystem"],
        actions: ["verify"],
        artifacts: ["repository"],
        needs: ["unit-tests"],
        signals: ["warning-observed"],
        required: false,
        priority: 40,
        maxChars: 1000,
      },
    ],
  };
  await fs.writeFile(path.join(root, ".mssr", "project-context.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { memoryA, memoryB, manifest };
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-memory-ref-migration-"));
try {
  const root = path.join(temp, "success");
  const { memoryA, memoryB, manifest } = await writeFixture(root);
  const specs = [
    { id: "decision-a", heading: "## Decision A", target: ".mssr/knowledge/decision/decision-a.md", area: "routing" },
    { id: "decision-b", heading: "## Decision B", target: ".mssr/knowledge/decision/decision-b.md", area: "runtime" },
  ];
  const mssr = makeFakeMssr(root, specs);
  const memoryBefore = await fs.readFile(path.join(root, ".mssr", "PROJECT_MEMORY.md"), "utf8");
  const manifestBefore = await fs.readFile(path.join(root, ".mssr", "project-context.json"), "utf8");

  const check = await migrateProjectMemoryRefs({ projectRoot: root, mssr, apply: false, expectedIds: ["decision-a", "decision-b"] });
  assert.equal(check.safeCandidateCount, 2);
  assert.equal(check.applied, false);
  assert.equal(await fs.readFile(path.join(root, ".mssr", "PROJECT_MEMORY.md"), "utf8"), memoryBefore);
  assert.equal(await fs.readFile(path.join(root, ".mssr", "project-context.json"), "utf8"), manifestBefore);

  const applied = await migrateProjectMemoryRefs({ projectRoot: root, mssr, apply: true, expectedIds: ["decision-a", "decision-b"] });
  assert.equal(applied.applied, true);
  assert.equal(applied.postflight.payloadParity, true);
  assert.equal(applied.postflight.selectorMetadataParity, true);
  assert.equal(applied.postflight.rootBackedMemoryFanout, false);
  assert.equal((await fs.readFile(path.join(root, specs[0].target), "utf8")).trim(), memoryA);
  assert.equal((await fs.readFile(path.join(root, specs[1].target), "utf8")).trim(), memoryB);

  const afterManifest = JSON.parse(await fs.readFile(path.join(root, ".mssr", "project-context.json"), "utf8"));
  for (const before of manifest.modules) {
    const after = afterManifest.modules.find((module) => module.id === before.id);
    assert.ok(after);
    assert.deepEqual({ ...after, source: undefined }, { ...before, source: undefined });
    assert.equal(after.source.path, specs.find((spec) => spec.id === before.id).target);
    assert.equal(after.source.sections, undefined);
  }
  const afterMemory = await fs.readFile(path.join(root, ".mssr", "PROJECT_MEMORY.md"), "utf8");
  assert.equal(afterMemory.includes("## Decision A"), false);
  assert.equal(afterMemory.includes("## Decision B"), false);
  assert.equal(afterMemory.includes("## Core invariant"), true);

  await assert.rejects(
    migrateProjectMemoryRefs({ projectRoot: root, mssr, apply: true }),
    /Apply requires an explicit expectedIds set/,
    "Apply must require the exact reviewed candidate set instead of migrating newly appeared memories implicitly",
  );
  const second = await migrateProjectMemoryRefs({ projectRoot: root, mssr, apply: true, expectedIds: [] });
  assert.equal(second.safeCandidateCount, 0, "Second run must be idempotent after refs are adopted");
  assert.equal(second.applied, false);

  const collision = path.join(temp, "collision");
  await writeFixture(collision);
  await fs.writeFile(path.join(collision, ".mssr", "knowledge", "decision", "decision-a.md"), "different content\n", "utf8");
  const collisionMssr = makeFakeMssr(collision, specs);
  await assert.rejects(
    migrateProjectMemoryRefs({ projectRoot: collision, mssr: collisionMssr, apply: true, expectedIds: ["decision-a", "decision-b"] }),
    /Existing target differs from source payload/,
  );
  const collisionManifest = JSON.parse(await fs.readFile(path.join(collision, ".mssr", "project-context.json"), "utf8"));
  assert.equal(collisionManifest.modules.every((module) => module.source.path === ".mssr/PROJECT_MEMORY.md"), true, "Collision must abort before manifest/root mutation");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

console.log("Bridge project memory ref migration tests PASS");
