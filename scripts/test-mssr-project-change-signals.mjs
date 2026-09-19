import assert from "node:assert/strict";

import { evaluateMssrProjectKnowledgeMaintenance } from "@mauroprime/mssr";
import { isMssrRoutingSemanticOwnerPath } from "../dist/mssr-project-change-signals.js";

assert.equal(isMssrRoutingSemanticOwnerPath("docs/skill-routing/INCIDENTS.md"), false);
assert.equal(isMssrRoutingSemanticOwnerPath("docs/host-adapter-contract.md"), false);
assert.equal(isMssrRoutingSemanticOwnerPath("docs/mssr-adapter-notes.md"), false);
assert.equal(isMssrRoutingSemanticOwnerPath("config/skill-routing/skill-routing-overrides.json"), true);
assert.equal(isMssrRoutingSemanticOwnerPath("src/tools/skill-routing.ts"), true);
assert.equal(isMssrRoutingSemanticOwnerPath("src/host-adapter-contract.ts"), true);
assert.equal(isMssrRoutingSemanticOwnerPath("src/mssr-adapter.ts"), true);
assert.equal(isMssrRoutingSemanticOwnerPath("src/ordinary-feature.ts"), false);

function evaluateBridgeMaintenance(changedPaths) {
  return evaluateMssrProjectKnowledgeMaintenance({
    changedPaths,
    materialWrites: changedPaths.length,
    routingChanged: changedPaths.some(isMssrRoutingSemanticOwnerPath),
  });
}

const docsOnly = evaluateBridgeMaintenance(["docs/skill-routing/INCIDENTS.md"]);
assert.equal(
  docsOnly.targets.some((target) => target.target === "skill"),
  false,
  "documentation paths must remain outside routing/skill maintenance in the integrated Bridge + packaged MSSR flow",
);

const routingOwner = evaluateBridgeMaintenance(["src/tools/skill-routing.ts"]);
assert.equal(
  routingOwner.targets.some((target) => target.target === "skill" && target.reasons.includes("routing-semantics-changed")),
  true,
  "the actual Bridge routing owner must still raise routing semantics maintenance through the host signal",
);

console.log("Bridge + packaged MSSR project change signal tests PASS");
