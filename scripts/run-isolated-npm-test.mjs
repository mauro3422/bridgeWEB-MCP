import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptName = process.argv[2];
if (!scriptName || !/^[a-zA-Z0-9:_-]+$/.test(scriptName)) {
  console.error("Usage: node scripts/run-isolated-npm-test.mjs <npm-script>");
  process.exit(2);
}

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mcp-test-"));
const dataDir = path.join(tempRoot, "data");
const logsDir = path.join(tempRoot, "logs");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const env = {
  ...process.env,
  BRIDGE_MCP_METRICS_DIR: dataDir,
  BRIDGE_MCP_LOG_DIR: logsDir,
  BRIDGE_MCP_METRICS_SQLITE: path.join(dataDir, "bridge-metrics.sqlite"),
  BRIDGE_MCP_MSSR_EVENTS_JSONL: path.join(logsDir, "mssr-events.jsonl"),
  BRIDGE_MCP_MSSR_STATE: path.join(dataDir, "mssr-observability-state.json"),
  BRIDGE_MCP_SKILL_HEALTH_PATH: path.join(dataDir, "skill-health.json"),
  BRIDGE_MCP_PROJECT_HEALTH_PATH: path.join(dataDir, "project-health.json"),
  BRIDGE_MCP_PROJECT_HEALTH_ROOT: root,
  BRIDGE_MCP_RUNTIME_HEALTH_PATH: path.join(dataDir, "runtime-health.json"),
  BRIDGE_MCP_PROJECT_SITUATION_PATH: path.join(dataDir, "project-situation.json"),
  BRIDGE_MCP_PROJECT_SITUATION_ROOT: root,
};

console.log(`[bridge-test-isolation] npm script=${scriptName}`);
console.log(`[bridge-test-isolation] observatoryRoot=${tempRoot}`);

const isWindows = process.platform === "win32";
const command = isWindows ? (process.env.ComSpec || "cmd.exe") : "npm";
const args = isWindows
  ? ["/d", "/s", "/c", `npm run ${scriptName}`]
  : ["run", scriptName];

const result = spawnSync(command, args, {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: false,
});

const exitCode = typeof result.status === "number" ? result.status : 1;
if (result.error) console.error(`[bridge-test-isolation] spawn failed: ${result.error.message}`);

const keepIsolation = process.env.BRIDGE_MCP_TEST_KEEP_ISOLATION === "1";
if (exitCode === 0 && !keepIsolation) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("[bridge-test-isolation] PASS; isolated observatory state removed.");
} else if (exitCode === 0) {
  console.log(`[bridge-test-isolation] PASS; preserving isolated state by request at ${tempRoot}`);
} else {
  console.error(`[bridge-test-isolation] FAIL exit=${exitCode}; preserving isolated state at ${tempRoot}`);
}

process.exit(exitCode);
