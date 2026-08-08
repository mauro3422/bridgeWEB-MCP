import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assembleCodexSkillContext, planCodexSkillContexts } from "@mauroprime/mssr";
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

  const plannerDirs = ["first-required", "second-required"];
  const plannerSpecs = [
    {
      name: plannerDirs[0],
      markdown: `# First required\n\n## Core\n\nFirst required core.\n\n## Low priority\n\n${"low ".repeat(260)}\n`,
      module: { id: "low-priority", heading: "## Low priority", priority: 1 },
      routeScore: 500,
    },
    {
      name: plannerDirs[1],
      markdown: `# Second required\n\n## Core\n\nSecond required core.\n\n## High priority\n\n${"high ".repeat(150)}\n`,
      module: { id: "high-priority", heading: "## High priority", priority: 90 },
      routeScore: 10,
    },
  ];
  const plannerSkills = [];
  for (const [routeIndex, spec] of plannerSpecs.entries()) {
    const directory = path.join(tempRoot, spec.name);
    await fs.mkdir(directory, { recursive: true });
    const skillPath = path.join(directory, "SKILL.md");
    await fs.writeFile(skillPath, spec.markdown, "utf8");
    await fs.writeFile(path.join(directory, "context-modules.json"), JSON.stringify({
      schemaVersion: 1,
      core: { sections: ["## Core"] },
      modules: [{
        id: spec.module.id,
        description: `${spec.module.id} fixture.`,
        source: { sections: [spec.module.heading] },
        actions: ["edit"],
        signals: ["skill-gap"],
        priority: spec.module.priority,
      }],
    }), "utf8");
    plannerSkills.push({
      skill: { name: spec.name, description: spec.name, source: "codex-local", path: skillPath },
      required: true,
      routeIndex,
      routeScore: spec.routeScore,
    });
  }
  const unconstrainedPlan = await planCodexSkillContexts({
    skills: plannerSkills,
    intent,
    stage: "implement",
    mode: "selective",
    references: "auto",
    maxContextChars: 50_000,
  });
  const unconstrainedByName = new Map(unconstrainedPlan.skills.map((item) => [item.skill.name, item]));
  const requiredCoreChars = [...unconstrainedByName.values()].reduce((sum, item) => sum + item.contextAssembly.coreCharsLoaded, 0);
  const highChars = unconstrainedByName.get("second-required").contextAssembly.moduleDecisions.find((item) => item.id === "high-priority").chars;
  const constrainedPlan = await planCodexSkillContexts({
    skills: plannerSkills,
    intent,
    stage: "implement",
    mode: "selective",
    references: "auto",
    maxContextChars: requiredCoreChars + highChars + 4,
  });
  const constrainedByName = new Map(constrainedPlan.skills.map((item) => [item.skill.name, item]));
  assert.equal(constrainedPlan.planningMode, "global-required-core-first");
  assert.equal(constrainedByName.get("first-required").loaded, true);
  assert.equal(constrainedByName.get("second-required").loaded, true);
  assert.deepEqual(constrainedByName.get("second-required").contextAssembly.selectedModules, ["high-priority"]);
  assert.deepEqual(constrainedByName.get("first-required").contextAssembly.selectedModules, []);
  assert.equal(
    constrainedByName.get("first-required").contextAssembly.moduleDecisions.find((item) => item.id === "low-priority").reason,
    "budget-exceeded",
  );
  assert.equal(constrainedPlan.requiredCoreReservedChars, requiredCoreChars);
  assert.equal(constrainedPlan.budgetExceeded, false, 'Omitting only optional context must not report a required bootstrap overflow.');
  assert.equal(constrainedPlan.requiredBudgetExceeded, false);
  assert.equal(constrainedPlan.optionalContextOmitted, true);
  assert.equal(constrainedByName.get("first-required").contextAssembly.budgetExceeded, false);
  assert.equal(constrainedByName.get("first-required").contextAssembly.requiredBudgetExceeded, false);
  assert.equal(constrainedByName.get("first-required").contextAssembly.optionalContextOmitted, true);
  assert.equal(constrainedPlan.globallySelectedModules[0].module, "high-priority");

  const overlapDir = path.join(tempRoot, "overlap");
  await fs.mkdir(overlapDir, { recursive: true });
  const overlapPath = path.join(overlapDir, "SKILL.md");
  await fs.writeFile(overlapPath, "# Overlap\n\n## Core\n\nAlways required.\n\n### Repeated procedure\n\nDo this exactly once.\n\n## Other\n\nOther text.\n", "utf8");
  await fs.writeFile(path.join(overlapDir, "context-modules.json"), JSON.stringify({
    schemaVersion: 1,
    core: { sections: ["## Core"] },
    modules: [{
      id: "repeated-procedure",
      description: "Must not duplicate content already inside the core.",
      source: { sections: ["### Repeated procedure"] },
      actions: ["edit"],
      signals: ["skill-gap"],
      priority: 50,
    }],
  }), "utf8");
  const overlapPlan = await planCodexSkillContexts({
    skills: [{
      skill: { name: "overlap", description: "overlap", source: "codex-local", path: overlapPath },
      required: true,
      routeIndex: 0,
      routeScore: 1,
    }],
    intent,
    stage: "implement",
    mode: "selective",
    references: "auto",
    maxContextChars: 12_000,
  });
  const overlap = overlapPlan.skills[0];
  assert.equal(overlap.loaded, true);
  assert.deepEqual(overlap.contextAssembly.selectedModules, []);
  assert.equal(
    overlap.contextAssembly.moduleDecisions.find((item) => item.id === "repeated-procedure").reason,
    "already-covered-by-loaded-context",
  );
  assert.equal(overlap.contextAssembly.duplicateCharsAvoided > 0, true);
  assert.equal(overlap.content.match(/Do this exactly once\./g)?.length, 1);


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
