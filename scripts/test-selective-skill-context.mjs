import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assembleCodexSkillContext } from "../dist/skill-context-assembler.js";
import { structuredSkillIntentSchema } from "@mauroprime/mssr";

const skillsRoot = "C:\\Dev\\mauroprime-skills\\skills";
const intent = structuredSkillIntentSchema.parse({
  domains: ["skill-system", "agent-orchestration", "coding"],
  actions: ["edit", "maintain", "verify"],
  artifacts: ["skill", "mcp", "code"],
  needs: ["integrity-verification", "unit-tests"],
  signals: ["skill-gap", "reusable-pattern"],
  risk: "write",
  ambiguity: "low",
});

function skill(name) {
  return {
    name,
    description: `Fixture ${name}`,
    source: "codex-local",
    path: path.join(skillsRoot, name, "SKILL.md"),
  };
}

const selective = await assembleCodexSkillContext({
  skill: skill("mssr-agent-routing"),
  intent,
  stage: "implement",
  mode: "selective",
  references: "auto",
  remainingChars: 12_000,
});
assert.equal(selective.contextAssembly.manifestStatus, "loaded");
assert.equal(selective.contextAssembly.fallbackFull, false);
assert.equal(selective.contextAssembly.totalCharsLoaded < selective.contextAssembly.fullSkillChars, true);
assert.equal(selective.content.includes("## Maintain autoregistry and skills"), true);
assert.equal(selective.content.includes("## Keep long work visibly alive"), false);
assert.equal(selective.contextAssembly.selectedModules.includes("routing-maintenance"), true);

const coreOnly = await assembleCodexSkillContext({
  skill: skill("mssr-agent-routing"),
  intent,
  stage: "implement",
  mode: "selective",
  references: "none",
  remainingChars: 12_000,
});
assert.deepEqual(coreOnly.contextAssembly.selectedModules, []);
assert.equal(coreOnly.contextAssembly.moduleCharsLoaded, 0);
assert.equal(coreOnly.content.includes("## Maintain autoregistry and skills"), false);

const full = await assembleCodexSkillContext({
  skill: skill("mssr-agent-routing"),
  intent,
  stage: "implement",
  mode: "full",
  references: "auto",
  remainingChars: 12_000,
});
const exact = await fs.readFile(skill("mssr-agent-routing").path, "utf8");
assert.equal(full.content, exact);
assert.equal(full.contextAssembly.mode, "full");

const fallback = await assembleCodexSkillContext({
  skill: skill("roblox-playtest"),
  intent,
  stage: "implement",
  mode: "selective",
  references: "auto",
  remainingChars: 12_000,
});
assert.equal(fallback.contextAssembly.manifestStatus, "missing");
assert.equal(fallback.contextAssembly.fallbackFull, true);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mssr-skill-context-"));
try {
  const ambiguousDir = path.join(tempRoot, "ambiguous");
  await fs.mkdir(ambiguousDir, { recursive: true });
  const ambiguousPath = path.join(ambiguousDir, "SKILL.md");
  await fs.writeFile(ambiguousPath, "# Ambiguous\n\n## Core\n\nCore.\n\n## Repair owner\n\nRepair.\n\n## Create adapter\n\nAdapter.\n", "utf8");
  await fs.writeFile(path.join(ambiguousDir, "context-modules.json"), JSON.stringify({
    schemaVersion: 1,
    core: { sections: ["## Core"] },
    modules: [
      { id: "repair-owner", description: "Repair owner.", source: { sections: ["## Repair owner"] }, actions: ["edit"], signals: ["skill-gap"], exclusiveGroup: "capability-change" },
      { id: "create-adapter", description: "Create adapter.", source: { sections: ["## Create adapter"] }, actions: ["edit"], signals: ["skill-gap"], exclusiveGroup: "capability-change" },
    ],
  }), "utf8");
  const ambiguous = await assembleCodexSkillContext({
    skill: { name: "ambiguous", description: "ambiguous", source: "codex-local", path: ambiguousPath },
    intent,
    stage: "implement",
    mode: "selective",
    references: "auto",
    remainingChars: 12_000,
  });
  assert.deepEqual(ambiguous.contextAssembly.selectedModules, []);
  assert.deepEqual(ambiguous.contextAssembly.ambiguousGroups.map(({ group, candidates }) => ({ group, candidates })), [
    { group: "capability-change", candidates: ["create-adapter", "repair-owner"] },
  ]);
  assert.equal(ambiguous.content.includes("Repair owner"), false);
  assert.equal(ambiguous.content.includes("Create adapter"), false);

  const skillDir = path.join(tempRoot, "unsafe");
  await fs.mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  await fs.writeFile(skillPath, "# Unsafe\n\n## Core\n\nCore.\n", "utf8");
  await fs.writeFile(path.join(skillDir, "context-modules.json"), JSON.stringify({
    schemaVersion: 1,
    core: { sections: ["## Core"] },
    modules: [{
      id: "escape",
      description: "Must not escape the skill directory.",
      source: { path: "../secret.md" },
      signals: ["skill-gap"],
    }],
  }), "utf8");
  await fs.writeFile(path.join(tempRoot, "secret.md"), "secret", "utf8");
  await assert.rejects(() => assembleCodexSkillContext({
    skill: { name: "unsafe", description: "unsafe", source: "codex-local", path: skillPath },
    intent,
    stage: "implement",
    mode: "selective",
    references: "auto",
    remainingChars: 12_000,
  }), /escapes its skill directory/);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("selective skill context tests passed", {
  loaded: selective.contextAssembly.totalCharsLoaded,
  full: selective.contextAssembly.fullSkillChars,
  saved: selective.contextAssembly.estimatedCharsSaved,
  modules: selective.contextAssembly.selectedModules,
});
