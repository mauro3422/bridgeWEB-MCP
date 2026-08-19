import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MSSR_FIRST_PARTY_SKILL_MANIFEST } from "@mauroprime/mssr";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mssr-first-party-"));
const codexHome = path.join(sandbox, "codex");
const firstPartyRoot = path.join(sandbox, "packaged-mssr-skills");
const metricsDir = path.join(sandbox, "metrics");
const logDir = path.join(sandbox, "logs");

process.env.CODEX_HOME = codexHome;
process.env.MSSR_FIRST_PARTY_SKILLS_ROOT = firstPartyRoot;
process.env.BRIDGE_MCP_METRICS_DIR = metricsDir;
process.env.BRIDGE_MCP_LOG_DIR = logDir;
process.env.BRIDGE_MCP_MSSR_EVENTS_JSONL = path.join(process.env.BRIDGE_MCP_LOG_DIR, "mssr-events.jsonl");
process.env.BRIDGE_MCP_METRICS_SQLITE = path.join(metricsDir, "bridge-metrics.sqlite");
process.env.BRIDGE_MCP_EVENTS_JSONL = path.join(logDir, "bridge-events.jsonl");
process.env.BRIDGE_MCP_MSSR_STATE = path.join(metricsDir, "mssr-observability-state.json");
process.env.BRIDGE_MCP_ALLOWED_ROOTS = [sandbox, process.cwd()].join(path.delimiter);

function writeSkill(root, name, description, marker) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${marker}\n`, "utf8");
}

for (const { name } of MSSR_FIRST_PARTY_SKILL_MANIFEST.skills) {
  writeSkill(firstPartyRoot, name, `Bundled MSSR first-party fixture for ${name}.`, `FIRST_PARTY_PAYLOAD:${name}`);
}

// This deliberately divergent catalog entry must remain visible as an audit
// error, but never become the auto-loaded implementation of the reserved name.
writeSkill(path.join(codexHome, "skills"), "mssr-agent-routing", "Divergent external shadow fixture.", "EXTERNAL_SHADOW_PAYLOAD");

const [{ skillCatalogToolModule }, { closeMssrObservatoryForTests }, { closeMetricsForTests }] = await Promise.all([
  import("../dist/tools/skill-catalog-tools.js"),
  import("../dist/mssr-observatory.js"),
  import("../dist/metrics.js"),
]);

const catalog = skillCatalogToolModule.handlers.skill_catalog;
const load = skillCatalogToolModule.handlers.skill_load;
const routePlan = skillCatalogToolModule.handlers.skill_route_plan;
const audit = skillCatalogToolModule.handlers.skill_route_audit;
assert.ok(catalog && load && routePlan && audit);

try {
  const listed = await catalog({ sources: ["mssr-first-party"], maxResults: 20 });
  assert.equal(listed.count, MSSR_FIRST_PARTY_SKILL_MANIFEST.skills.length, "catalog must discover the bundled manifest without a Codex-home copy");
  assert.equal(listed.sourceHealth.mssr.status, "healthy");
  assert.equal(listed.sourceHealth.mssr.skillCount, MSSR_FIRST_PARTY_SKILL_MANIFEST.skills.length);
  assert.deepEqual(
    new Set(listed.skills.map((skill) => skill.name)),
    new Set(MSSR_FIRST_PARTY_SKILL_MANIFEST.skills.map((skill) => skill.name)),
  );
  assert.ok(listed.skills.every((skill) => skill.source === "mssr-first-party"));

  const routed = await routePlan({
    task: "Maintain MSSR routing and verify a first-party packaged skill.",
    context: "Bridge must route the package-owned MSSR guidance without relying on CODEX_HOME.",
    intent: {
      summary: "Route and verify bundled MSSR skills.",
      domains: ["skill-system", "agent-orchestration", "coding"],
      actions: ["edit", "test", "verify", "maintain"],
      artifacts: ["skill", "code", "mcp"],
      needs: ["integrity-verification", "unit-tests"],
      signals: ["warning-observed", "replan-needed"],
      risk: "write",
      ambiguity: "low",
    },
    caller: "chatgpt-web",
    stage: "implement",
    sources: ["mssr-first-party"],
  });
  assert.ok(routed.activeSkills.some((skill) => skill.name === "mssr-agent-routing" && skill.source === "mssr-first-party"));

  const loaded = await load({ name: "mssr-agent-routing", source: "auto" });
  assert.equal(loaded.skill.source, "mssr-first-party");
  assert.match(loaded.content, /FIRST_PARTY_PAYLOAD:mssr-agent-routing/);
  assert.doesNotMatch(loaded.content, /EXTERNAL_SHADOW_PAYLOAD/);

  const conflict = await audit({ sources: ["mssr-first-party", "codex-local"] });
  assert.equal(conflict.ok, false, "a divergent external reserved name must remain an explicit routing error");
  assert.ok(
    conflict.errors.some((error) => error.includes("reserved-first-party-conflict") || error.includes("reserved MSSR first-party") || error.includes("Reserved first-party skill name is shadowed")),
    `expected explicit reserved-name conflict, got: ${JSON.stringify(conflict.errors)}`,
  );

  console.log(JSON.stringify({
    ok: true,
    firstPartySkills: listed.count,
    autoLoadedSource: loaded.skill.source,
    conflictErrors: conflict.errors,
  }, null, 2));
} finally {
  closeMssrObservatoryForTests();
  closeMetricsForTests();
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
