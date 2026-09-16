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
import { parseTunnelMetricsSummary } from "../dist/tools/bridge-ops.js";

const tunnelMetrics = parseTunnelMetricsSummary(`
process_start_time_seconds 123
command_end_to_end_latency_milliseconds_count{request_method="initialize",tunnel_service_status="200",latency_type="enqueue_to_response"} 9
command_end_to_end_latency_milliseconds_count{latency_type="enqueue_to_response",request_method="initialize",tunnel_service_status="502"} 2
command_end_to_end_latency_milliseconds_count{channel="secondary",request_method="initialize",latency_type="enqueue_to_response",tunnel_service_status="502"} 1
command_end_to_end_latency_milliseconds_count{request_method="tools/call",latency_type="enqueue_to_response",tunnel_service_status="200"} 8
command_end_to_end_latency_milliseconds_count{request_method="tools/call",latency_type="enqueue_to_response",tunnel_service_status="400"} 1
command_end_to_end_latency_milliseconds_count{request_method="tools/call",latency_type="enqueue_to_response",tunnel_service_status="502"} 3
command_end_to_end_latency_milliseconds_count{request_method="notifications/initialized",latency_type="enqueue_to_response",tunnel_service_status="202"} 7
command_end_to_end_latency_milliseconds_count{request_method="notifications/initialized",latency_type="enqueue_to_response",tunnel_service_status="502"} 1
http_client_request_duration_seconds_count{http_request_method="POST",http_route="/mcp",server_address="127.0.0.1",server_port="3001"} 6
http_client_request_duration_seconds_count{network_protocol_version="2",http_request_method="POST",http_route="/mcp",server_address="127.0.0.1",server_port="3001"} 1
http_client_request_duration_seconds_count{http_request_method="POST",http_response_status_code="200",http_route="/mcp",server_address="127.0.0.1",server_port="3001"} 17
http_client_request_duration_seconds_count{http_request_method="POST",http_route="/mcp",server_address="api.openai.com"} 999
commands_enqueued_total 44
commands_polled_total 44
commands_queue_length 0
commands_queue_capacity 20
dispatcher_worker_pool_occupancy 1
dispatcher_worker_pool_capacity 10
commands_poll_last_successful_timestamp_seconds 122.5
`);
assert.equal(tunnelMetrics.processStartTimeSeconds, 123);
assert.equal(tunnelMetrics.endToEnd.initialize["502"], 3);
assert.equal(tunnelMetrics.endToEnd.toolsCall["502"], 3);
assert.equal(tunnelMetrics.localMcpPost.noStatus, 7);
assert.equal(tunnelMetrics.localMcpPost.statuses["200"], 17);
assert.equal(tunnelMetrics.transportFailures.tunnelService502, 7);
assert.equal(tunnelMetrics.transportFailures.countsMatch, true);
assert.equal(tunnelMetrics.controlPlane.queueLength, 0);
assert.equal(tunnelMetrics.controlPlane.workerCapacity, 10);

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
