import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { bridgeOpsToolModule } from "../dist/tools/bridge-ops.js";
import { createBridgeToolCallContext } from "../dist/mcp-progress.js";
import { createToolRegistry } from "../dist/tool-registry.js";

const root = await fs.mkdtemp(path.join(process.cwd(), ".restart-notice-test-"));
const registry = createToolRegistry([bridgeOpsToolModule]);
try {
  const progressEvents = [];
  const requestPath = path.join(root, ".bridge-restart-request");
  const toolContext = createBridgeToolCallContext({ progressToken: "fixture-progress-token" }, {
    sendNotification: async (notification) => {
      progressEvents.push(notification);
      assert.equal(await fs.stat(requestPath).then(() => true, () => false), false, "the progress notice must precede the watchdog request file");
    },
  });
  assert.ok(toolContext?.sendProgress, "a progress token and request-scoped sender should enable progress delivery");
  const response = await registry.call("bridge_request_restart", {
    reason: "planned maintenance notice regression",
    mode: "http",
    cwd: root,
  }, toolContext);
  assert.equal(response.requested, true);
  assert.equal(response.maintenanceNotice.type, "planned-restart");
  assert.equal(response.maintenanceNotice.planned, true);
  assert.equal(response.maintenanceNotice.requestId, response.request.id);
  assert.equal(response.maintenanceNotice.mode, "http");
  assert.equal(response.maintenanceNotice.restartConfirmed, false);
  assert.match(response.maintenanceNotice.message, /planned Bridge restart/i);
  assert.match(response.maintenanceNotice.callerAction, /Wait until Bridge is ready/i);
  assert.match(response.maintenanceNotice.delivery, /same MCP response/i);
  assert.deepEqual(response.maintenanceNotice.preRestartProgress, { status: "sent-to-transport", deliveryConfirmed: false });
  assert.equal(progressEvents.length, 1);
  assert.deepEqual(progressEvents[0], {
    method: "notifications/progress",
    params: {
      progressToken: "fixture-progress-token",
      progress: 0,
      total: 1,
      message: "A planned Bridge restart is being requested. This connection may disconnect; wait for Bridge readiness before retrying.",
    },
  });
  const persisted = JSON.parse(await fs.readFile(response.requestPath, "utf8"));
  assert.equal(persisted.id, response.request.id);
  assert.equal("maintenanceNotice" in persisted, false, "delivery notice is response-only and must not alter watchdog request schema");

  const noTokenRoot = path.join(root, "without-progress-token");
  await fs.mkdir(noTokenRoot);
  const noTokenContext = createBridgeToolCallContext({}, { sendNotification: async () => { throw new Error("must not be called without a token"); } });
  assert.equal(noTokenContext, undefined);
  const noTokenResponse = await registry.call("bridge_request_restart", {
    reason: "no progress token fallback",
    mode: "http",
    cwd: noTokenRoot,
  }, noTokenContext);
  assert.equal(noTokenResponse.maintenanceNotice.preRestartProgress.status, "unavailable");
  assert.equal(noTokenResponse.requested, true, "lack of a progress token must preserve the response-notice path");

  const rejectedRoot = path.join(root, "rejected-progress");
  await fs.mkdir(rejectedRoot);
  const rejectedContext = createBridgeToolCallContext({ progressToken: 7 }, {
    sendNotification: async () => { throw new Error("transport closed"); },
  });
  const rejectedResponse = await registry.call("bridge_request_restart", {
    reason: "progress delivery failure fallback",
    mode: "http",
    cwd: rejectedRoot,
  }, rejectedContext);
  assert.equal(rejectedResponse.maintenanceNotice.preRestartProgress.status, "failed");
  assert.equal(rejectedResponse.requested, true, "a failed progress send must not block restart-request persistence");

  const delayedRoot = path.join(root, "delayed-progress");
  await fs.mkdir(delayedRoot);
  const delayedContext = createBridgeToolCallContext({ progressToken: "slow" }, { sendNotification: () => new Promise(() => {}) });
  const delayedResponse = await registry.call("bridge_request_restart", {
    reason: "progress timeout fallback",
    mode: "http",
    cwd: delayedRoot,
  }, delayedContext);
  assert.equal(delayedResponse.maintenanceNotice.preRestartProgress.status, "timed-out");
  assert.equal(delayedResponse.requested, true, "a slow progress send must not block restart-request persistence");

  const delegatedRoot = path.join(root, "delegated-action");
  await fs.mkdir(delegatedRoot);
  const delegatedContext = createBridgeToolCallContext({ progressToken: "delegated" }, { sendNotification: async () => {} });
  const delegatedResponse = await registry.call("bridge_tool_action", {
    toolName: "bridge_request_restart",
    confirmToolName: "bridge_request_restart",
    arguments: { reason: "delegated restart notice fallback", mode: "http", cwd: delegatedRoot },
  }, delegatedContext);
  assert.equal(delegatedResponse.result.requested, true);
  assert.equal(delegatedResponse.result.maintenanceNotice.preRestartProgress.status, "sent-to-transport", "explicit confirmed fallback should preserve request-scoped progress delivery");
  console.log("[restart-maintenance-notice] planned restart notice and reconnect guidance passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
