import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRuntimeHealthNoticeInput,
  buildRuntimeHealthSnapshot,
  captureRuntimeHealth,
  getRuntimeHealthReport,
} from "../dist/runtime-health.js";

const healthyObservation = {
  tunnel: { healthzOk: true, readyzOk: true },
  restart: { pending: false },
};

const baseline = buildRuntimeHealthSnapshot(healthyObservation, null, new Date("2026-08-15T20:00:00Z"));
assert.equal(baseline.projection.level, "ok");
assert.equal(buildRuntimeHealthNoticeInput(baseline, null), null, "first healthy baseline stays quiet");

const stable = buildRuntimeHealthSnapshot(healthyObservation, baseline, new Date("2026-08-15T20:01:00Z"));
assert.equal(stable.runtime.continuity, "stable");
assert.equal(stable.projection.level, "ok");
assert.equal(buildRuntimeHealthNoticeInput(stable, baseline), null);

const previousBoot = structuredClone(baseline);
previousBoot.runtime.bootId = "previous-runtime-boot";
const restarted = buildRuntimeHealthSnapshot(healthyObservation, previousBoot, new Date("2026-08-15T20:02:00Z"));
assert.equal(restarted.runtime.continuity, "restarted");
assert.equal(restarted.projection.level, "watch");
assert.equal(restarted.projection.notifyOnWatch, true);
const restartNotice = buildRuntimeHealthNoticeInput(restarted, previousBoot);
assert.equal(restartNotice?.code, "mssr-infrastructure-health-review");
assert.equal(restartNotice?.severity, "info");
assert.equal(restartNotice?.details?.event, "opened");
assert.equal(restartNotice?.details?.reasonCodes?.includes("runtime-restarted"), true);

const pendingRestart = buildRuntimeHealthSnapshot({
  tunnel: { healthzOk: true, readyzOk: true },
  restart: { pending: true, requestId: "restart-1" },
}, baseline, new Date("2026-08-15T20:03:00Z"));
assert.equal(pendingRestart.projection.level, "review");
const pendingNotice = buildRuntimeHealthNoticeInput(pendingRestart, baseline);
assert.equal(pendingNotice?.severity, "warning");
assert.equal(pendingNotice?.details?.event, "opened");

const degradedTunnel = buildRuntimeHealthSnapshot({
  tunnel: { healthzOk: true, readyzOk: false },
  restart: { pending: false },
}, baseline, new Date("2026-08-15T20:04:00Z"));
assert.equal(degradedTunnel.tunnel.state, "degraded");
assert.equal(degradedTunnel.projection.level, "review");

const unavailableTunnel = buildRuntimeHealthSnapshot({
  tunnel: { healthzOk: false, readyzOk: false },
  restart: { pending: false },
}, baseline, new Date("2026-08-15T20:05:00Z"));
assert.equal(unavailableTunnel.tunnel.state, "unavailable");
assert.equal(unavailableTunnel.projection.level, "error");

const recovered = buildRuntimeHealthSnapshot(healthyObservation, pendingRestart, new Date("2026-08-15T20:06:00Z"));
assert.equal(recovered.projection.level, "ok");
const recoveredNotice = buildRuntimeHealthNoticeInput(recovered, pendingRestart);
assert.equal(recoveredNotice?.code, "mssr-infrastructure-health-resolved");
assert.equal(recoveredNotice?.severity, "info");
assert.equal(recoveredNotice?.details?.event, "resolved");
assert.equal(recoveredNotice?.actions?.length ?? 0, 0);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runtime-health-"));
const store = path.join(root, "runtime-health.json");
const forbidden = "PRIVATE_RESTART_REASON_502_PAYLOAD_MUST_NOT_PERSIST";
const previousStorePath = process.env.BRIDGE_MCP_RUNTIME_HEALTH_PATH;
try {
  process.env.BRIDGE_MCP_RUNTIME_HEALTH_PATH = store;
  await captureRuntimeHealth({
    tunnel: { healthzOk: true, readyzOk: true },
    restart: { pending: false, requestId: "request-metadata", lastAckId: "ack-metadata", lastAckAction: "restart-http" },
  });
  const report = await getRuntimeHealthReport();
  assert.equal(report.version, 1);
  assert.equal(report.policy.metadataOnly, true);
  assert.equal(report.policy.transportObservation, "external-only");
  assert.ok(report.latest);
  const stored = await fs.readFile(store, "utf8");
  assert.equal(stored.includes(forbidden), false);
  assert.equal(stored.includes("restartReason"), false);
  assert.equal(stored.includes("requestPayload"), false);
  assert.equal(stored.includes("prompt"), false);
} finally {
  if (previousStorePath === undefined) delete process.env.BRIDGE_MCP_RUNTIME_HEALTH_PATH;
  else process.env.BRIDGE_MCP_RUNTIME_HEALTH_PATH = previousStorePath;
  await fs.rm(root, { recursive: true, force: true });
}

console.log("Bridge runtime/infrastructure health tests PASS");
