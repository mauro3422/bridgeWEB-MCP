import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { bridgeOpsToolModule } from "../dist/tools/bridge-ops.js";

const root = await fs.mkdtemp(path.join(process.cwd(), ".restart-notice-test-"));
try {
  const response = await bridgeOpsToolModule.handlers.bridge_request_restart({
    reason: "planned maintenance notice regression",
    mode: "http",
    cwd: root,
  });
  assert.equal(response.requested, true);
  assert.equal(response.maintenanceNotice.type, "planned-restart");
  assert.equal(response.maintenanceNotice.planned, true);
  assert.equal(response.maintenanceNotice.requestId, response.request.id);
  assert.equal(response.maintenanceNotice.mode, "http");
  assert.equal(response.maintenanceNotice.restartConfirmed, false);
  assert.match(response.maintenanceNotice.message, /planned Bridge restart/i);
  assert.match(response.maintenanceNotice.callerAction, /Wait until Bridge is ready/i);
  assert.match(response.maintenanceNotice.delivery, /same MCP response/i);
  const persisted = JSON.parse(await fs.readFile(response.requestPath, "utf8"));
  assert.equal(persisted.id, response.request.id);
  assert.equal("maintenanceNotice" in persisted, false, "delivery notice is response-only and must not alter watchdog request schema");
  console.log("[restart-maintenance-notice] planned restart notice and reconnect guidance passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
