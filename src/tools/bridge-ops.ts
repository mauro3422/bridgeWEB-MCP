import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_RESTART_ACK_FILE,
  DEFAULT_RESTART_REQUEST_FILE,
  DEFAULT_TUNNEL_ADMIN_BASE_URL,
  SERVER_NAME,
  SERVER_VERSION,
} from "../config.js";
import type { BridgeToolModule } from "./types.js";
import { fileExists, resolveToolPath, runShellCommand, summarizeCommand, tailText } from "./shared/process.js";
import { gitStatus } from "./git-tools.js";
import { terminalList } from "./process-tools.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

async function tunnelHealth(baseUrl = DEFAULT_TUNNEL_ADMIN_BASE_URL) {
  const fetchEndpoint = async (name: string) => {
    const url = `${baseUrl}/${name}`;
    try {
      const response = await fetch(url);
      const text = await response.text();
      return { ok: response.ok, status: response.status, text: tailText(text, 2000) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  return { baseUrl, healthz: await fetchEndpoint("healthz"), readyz: await fetchEndpoint("readyz") };
}

function getRestartRequestPath(cwd?: string) {
  return path.resolve(cwd ? resolveToolPath(cwd) : process.cwd(), DEFAULT_RESTART_REQUEST_FILE);
}

function getRestartAckPath(cwd?: string) {
  return path.resolve(cwd ? resolveToolPath(cwd) : process.cwd(), DEFAULT_RESTART_ACK_FILE);
}

async function bridgeRequestRestart(reason: string, mode: "http" | "tunnel" | "full", cwd?: string) {
  const requestPath = getRestartRequestPath(cwd);
  const tempPath = `${requestPath}.${process.pid}.${Date.now()}.tmp`;
  const request = {
    id: randomUUID(),
    requestedAt: new Date().toISOString(),
    reason,
    mode,
    server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid },
    cwd: cwd ? resolveToolPath(cwd) : process.cwd(),
  };
  await fs.writeFile(tempPath, JSON.stringify(request, null, 2), "utf8");
  await fs.rename(tempPath, requestPath);
  return { requested: true, requestPath, request, note: "The MCP server only wrote a restart request file. The external watchdog must perform the actual restart." };
}

export async function bridgeRestartStatus(cwd?: string) {
  const requestPath = getRestartRequestPath(cwd);
  const ackPath = getRestartAckPath(cwd);
  const readJsonIfExists = async (filePath: string) => {
    if (!(await fileExists(filePath))) return null;
    const text = await fs.readFile(filePath, "utf8");
    const parseText = text.replace(/^\uFEFF/, "");
    try {
      return JSON.parse(parseText) as JsonValue;
    } catch {
      return { parseError: true, text: tailText(text, 4000) };
    }
  };
  return { requestPath, ackPath, pending: await fileExists(requestPath), request: await readJsonIfExists(requestPath), lastAck: await readJsonIfExists(ackPath) };
}

async function bridgeSelfCheck(cwd?: string) {
  const root = cwd ? resolveToolPath(cwd) : process.cwd();
  const typecheck = await runShellCommand("npm run check", root, 120_000);
  const build = await runShellCommand("npm run build", root, 120_000);
  const status = await gitStatus(root);
  const tunnel = await tunnelHealth();
  return {
    ok: typecheck.code === 0 && build.code === 0,
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    cwd: root,
    node: process.version,
    checks: { typecheck: summarizeCommand(typecheck), build: summarizeCommand(build) },
    git: status,
    tunnel,
    activeTerminals: terminalList(),
  };
}

export const bridgeOpsToolModule: BridgeToolModule = {
  name: "bridge-ops",
  tools: [
    { name: "tunnel_health", description: "Check tunnel-client local healthz and readyz endpoints using the configured tunnel admin URL by default.", inputSchema: { type: "object", properties: { baseUrl: { type: "string", default: DEFAULT_TUNNEL_ADMIN_BASE_URL } }, additionalProperties: false } },
    { name: "bridge_self_check", description: "Run typecheck, build, Git status, configured tunnel health, and terminal inventory.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
    { name: "bridge_request_restart", description: "Request a bridge restart by writing a restart-request file for the external watchdog. This tool does not restart or kill processes directly.", inputSchema: { type: "object", properties: { reason: { type: "string" }, mode: { type: "string", enum: ["http", "tunnel", "full"], default: "http" }, cwd: { type: "string" } }, required: ["reason"], additionalProperties: false } },
    { name: "bridge_restart_status", description: "Return pending restart-request and last restart-ack information for the bridge watchdog.", inputSchema: { type: "object", properties: { cwd: { type: "string" } }, additionalProperties: false } },
  ],
  handlers: {
    tunnel_health: async (args) => {
      const parsed = z.object({ baseUrl: z.string().default(DEFAULT_TUNNEL_ADMIN_BASE_URL) }).parse(args);
      return await tunnelHealth(parsed.baseUrl);
    },
    bridge_self_check: async (args) => {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return await bridgeSelfCheck(parsed.cwd);
    },
    bridge_request_restart: async (args) => {
      const parsed = z.object({ reason: z.string().min(1).max(500), mode: z.enum(["http", "tunnel", "full"]).default("http"), cwd: z.string().optional() }).parse(args);
      return await bridgeRequestRestart(parsed.reason, parsed.mode, parsed.cwd);
    },
    bridge_restart_status: async (args) => {
      const parsed = z.object({ cwd: z.string().optional() }).parse(args);
      return await bridgeRestartStatus(parsed.cwd);
    },
  },
};
