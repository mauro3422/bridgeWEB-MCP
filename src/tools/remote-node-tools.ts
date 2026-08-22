import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type SFTPWrapper } from "ssh2";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/path.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "..", "..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "data", "remote-nodes.json");
const MAX_OUTPUT_CHARS = 64_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_DISCOVERY_TCP_TIMEOUT_MS = 180;
const DISCOVERY_BATCH_SIZE = 32;

const nodeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const sha256FingerprintPattern = /^SHA256:[A-Za-z0-9+/]{43}$/;
const subnetPattern = /^(?:\d{1,3}\.){2}\d{1,3}$/;

const remoteNodeSchema = z.object({
  id: z.string().regex(nodeIdPattern),
  label: z.string().min(1).max(120).optional(),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
  identityFile: z.string().min(1).max(1024),
  expectedHostKeySha256: z.string().regex(sha256FingerprintPattern),
  discoverySubnet: z.string().regex(subnetPattern).optional(),
}).strict();

const remoteNodeConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  nodes: z.array(remoteNodeSchema).min(1).max(16),
}).strict();

type RemoteNode = z.infer<typeof remoteNodeSchema>;

type RemoteExecResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

type ResolvedRemoteNode = {
  node: RemoteNode;
  configuredHost: string;
  resolvedHost: string;
  discovered: boolean;
};

function appendBounded(current: string, chunk: Buffer | string, maxChars = MAX_OUTPUT_CHARS): string {
  const next = current + chunk.toString();
  if (next.length <= maxChars) return next;
  return next.slice(next.length - maxChars);
}

function expandEnvironmentPath(value: string): string {
  let expanded = value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? `%${name}%`);
  expanded = expanded.replace(/\$\{([^}]+)\}/g, (_match, name: string) => process.env[name] ?? "${" + name + "}");
  if (expanded === "~") return os.homedir();
  if (expanded.startsWith(`~${path.sep}`) || expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  return path.resolve(expanded);
}

function remoteConfigPath(): string {
  const configured = process.env.BRIDGE_REMOTE_NODES_FILE?.trim();
  return configured ? expandEnvironmentPath(configured) : DEFAULT_CONFIG_PATH;
}

export function sshHostKeyFingerprint(key: Buffer): string {
  const digest = crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

async function loadRemoteNodeConfig() {
  const configPath = remoteConfigPath();
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[remote-node-config-missing] Bridge remote-node config not readable at ${configPath}: ${detail}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[remote-node-config-invalid] Bridge remote-node config is not valid JSON: ${detail}`);
  }
  const parsed = remoteNodeConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`[remote-node-config-invalid] Bridge remote-node config failed validation: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return { configPath, config: parsed.data };
}

async function getRemoteNode(nodeId: string): Promise<RemoteNode> {
  const { config } = await loadRemoteNodeConfig();
  const node = config.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`[target-not-found] Unknown remote node '${nodeId}'. Configured node ids: ${config.nodes.map((candidate) => candidate.id).join(", ") || "none"}.`);
  }
  return node;
}

async function readPrivateKey(node: RemoteNode): Promise<Buffer> {
  const identityFile = expandEnvironmentPath(node.identityFile);
  try {
    return await fs.readFile(identityFile);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[remote-node-identity-missing] SSH identity for '${node.id}' is not readable: ${detail}`);
  }
}

function connectClient(node: RemoteNode, host: string, privateKey: Buffer, readyTimeout = DEFAULT_CONNECT_TIMEOUT_MS): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch { /* best effort */ }
      reject(error);
    };
    client.once("ready", () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });
    client.once("error", (error) => {
      fail(new Error(`[remote-node-connect-failed] ${node.id}@${host}:${node.port}: ${error.message}`));
    });
    client.connect({
      host,
      port: node.port,
      username: node.username,
      privateKey,
      readyTimeout,
      keepaliveInterval: 5_000,
      keepaliveCountMax: 2,
      hostVerifier: (key: Buffer) => sshHostKeyFingerprint(key) === node.expectedHostKeySha256,
    });
  });
}

async function canOpenTcp(host: string, port: number, timeoutMs = DEFAULT_DISCOVERY_TCP_TIMEOUT_MS): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function scanSubnetForSsh(subnet: string, port: number): Promise<string[]> {
  const hosts = Array.from({ length: 254 }, (_item, index) => `${subnet}.${index + 1}`);
  const open: string[] = [];
  for (let start = 0; start < hosts.length; start += DISCOVERY_BATCH_SIZE) {
    const batch = hosts.slice(start, start + DISCOVERY_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (host) => ({ host, open: await canOpenTcp(host, port) })));
    open.push(...results.filter((item) => item.open).map((item) => item.host));
  }
  return open;
}

async function resolveRemoteNode(node: RemoteNode, discover: boolean, connectTimeoutMs: number): Promise<ResolvedRemoteNode> {
  const privateKey = await readPrivateKey(node);
  try {
    const client = await connectClient(node, node.host, privateKey, connectTimeoutMs);
    client.end();
    return { node, configuredHost: node.host, resolvedHost: node.host, discovered: false };
  } catch (configuredError) {
    if (!discover || !node.discoverySubnet) throw configuredError;
    const candidates = (await scanSubnetForSsh(node.discoverySubnet, node.port)).filter((host) => host !== node.host);
    const matches: string[] = [];
    for (const candidate of candidates) {
      try {
        const client = await connectClient(node, candidate, privateKey, connectTimeoutMs);
        client.end();
        matches.push(candidate);
        if (matches.length > 1) break;
      } catch {
        // Not our pinned node or authentication failed; keep scanning.
      }
    }
    if (matches.length === 1) {
      return { node, configuredHost: node.host, resolvedHost: matches[0], discovered: true };
    }
    if (matches.length > 1) {
      throw new Error(`[remote-node-discovery-ambiguous] More than one SSH host matched the pinned identity for '${node.id}': ${matches.join(", ")}. Refusing to choose automatically.`);
    }
    throw new Error(`[remote-node-discovery-failed] Configured host ${node.host} failed and no unique host in ${node.discoverySubnet}.0/24 matched the pinned SSH identity.`);
  }
}

async function execOnClient(client: Client, command: string, timeoutMs: number): Promise<RemoteExecResult> {
  const startedAt = Date.now();
  return await new Promise<RemoteExecResult>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(new Error(`[remote-node-exec-failed] ${error.message}`));
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { stream.close(); } catch { /* best effort */ }
        resolve({ exitCode: null, signal: null, stdout, stderr, timedOut: true, durationMs: Date.now() - startedAt });
      }, timeoutMs);
      stream.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
      stream.stderr.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
      stream.once("close", (code: number | undefined, signal: string | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: typeof code === "number" ? code : null,
          signal: signal ?? null,
          stdout,
          stderr,
          timedOut: false,
          durationMs: Date.now() - startedAt,
        });
      });
      stream.once("error", (streamError: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`[remote-node-exec-failed] ${streamError.message}`));
      });
    });
  });
}

async function execRemote(resolved: ResolvedRemoteNode, command: string, timeoutMs: number): Promise<RemoteExecResult> {
  const privateKey = await readPrivateKey(resolved.node);
  const client = await connectClient(resolved.node, resolved.resolvedHost, privateKey, Math.min(timeoutMs, 15_000));
  try {
    return await execOnClient(client, command, timeoutMs);
  } finally {
    client.end();
  }
}

function parseKeyValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function parseFiniteInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const STATUS_COMMAND = [
  "printf 'hostname=%s\\n' \"$(hostname)\"",
  "printf 'user=%s\\n' \"$(id -un)\"",
  "printf 'kernel=%s\\n' \"$(uname -sr)\"",
  "printf 'arch=%s\\n' \"$(uname -m)\"",
  "printf 'cpus=%s\\n' \"$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || printf '0')\"",
  "printf 'cpu_model=%s\\n' \"$(awk -F: '/model name|Hardware/ {value=$2; sub(/^[[:space:]]+/, \"\", value); print value; exit}' /proc/cpuinfo)\"",
  "printf 'mem_total_kb=%s\\n' \"$(awk '/MemTotal:/ {print $2}' /proc/meminfo)\"",
  "printf 'mem_available_kb=%s\\n' \"$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)\"",
  "printf 'disk_available_bytes=%s\\n' \"$(df -B1 --output=avail / 2>/dev/null | tail -n 1 | tr -d ' ')\"",
  "printf 'uptime_seconds=%s\\n' \"$(cut -d. -f1 /proc/uptime)\"",
  "printf 'distro=%s\\n' \"$(. /etc/os-release 2>/dev/null; printf '%s' \"${PRETTY_NAME:-unknown}\")\"",
  "printf 'steamcmd=%s\\n' \"$(command -v steamcmd 2>/dev/null || true)\"",
  "printf 'java=%s\\n' \"$(command -v java 2>/dev/null || true)\"",
  "printf 'pzserver=%s\\n' \"$(command -v start-server.sh 2>/dev/null || find \"$HOME\" -maxdepth 4 -type f -name start-server.sh -print -quit 2>/dev/null || true)\"",
].join("; ");

async function remoteNodeStatus(nodeId: string, discover: boolean, connectTimeoutMs: number) {
  const node = await getRemoteNode(nodeId);
  const resolved = await resolveRemoteNode(node, discover, connectTimeoutMs);
  const result = await execRemote(resolved, STATUS_COMMAND, Math.max(5_000, connectTimeoutMs * 2));
  if (result.timedOut) throw new Error(`[remote-node-timeout] Status probe timed out for '${node.id}'.`);
  if (result.exitCode !== 0) throw new Error(`[remote-node-status-failed] Status probe exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`);
  const values = parseKeyValueLines(result.stdout);
  const memTotalKb = parseFiniteInt(values.mem_total_kb);
  const memAvailableKb = parseFiniteInt(values.mem_available_kb);
  return {
    nodeId: node.id,
    label: node.label ?? null,
    configuredHost: resolved.configuredHost,
    resolvedHost: resolved.resolvedHost,
    discovered: resolved.discovered,
    ssh: {
      port: node.port,
      username: node.username,
      hostKeyPinned: true,
      authenticated: true,
    },
    system: {
      hostname: values.hostname ?? null,
      user: values.user ?? null,
      distro: values.distro ?? null,
      kernel: values.kernel ?? null,
      arch: values.arch ?? null,
      cpuLogical: parseFiniteInt(values.cpus),
      cpuModel: values.cpu_model || null,
      memoryTotalBytes: memTotalKb === null ? null : memTotalKb * 1024,
      memoryAvailableBytes: memAvailableKb === null ? null : memAvailableKb * 1024,
      diskAvailableBytes: parseFiniteInt(values.disk_available_bytes),
      uptimeSeconds: parseFiniteInt(values.uptime_seconds),
    },
    capabilities: {
      steamcmd: values.steamcmd || null,
      java: values.java || null,
      projectZomboidServerScript: values.pzserver || null,
    },
    probeDurationMs: result.durationMs,
  };
}

function sftpAsync(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(new Error(`[remote-node-sftp-failed] ${error.message}`));
      else resolve(sftp);
    });
  });
}

function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<import("ssh2").Stats | null> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (!error) {
        resolve(stats);
        return;
      }
      const code = (error as { code?: string | number }).code;
      if (code === 2 || code === "ENOENT") resolve(null);
      else reject(error);
    });
  });
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (!error) resolve();
      else reject(error);
    });
  });
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, directory: string) {
  const normalized = path.posix.normalize(directory);
  const segments = normalized.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    const existing = await sftpStat(sftp, current);
    if (existing) continue;
    await sftpMkdir(sftp, current);
  }
}

function sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) reject(new Error(`[remote-node-upload-failed] ${error.message}`));
      else resolve();
    });
  });
}

function validateRemoteAbsolutePath(value: string): string {
  if (!value.startsWith("/")) throw new Error("remotePath must be an absolute POSIX path.");
  if (value.split("/").includes("..")) throw new Error("remotePath must not contain parent traversal.");
  return path.posix.normalize(value);
}

async function uploadRemoteFile(resolved: ResolvedRemoteNode, localInput: string, remoteInput: string, overwrite: boolean) {
  const localPath = resolveToolPath(localInput, { access: "read" });
  const localStat = await fs.stat(localPath);
  if (!localStat.isFile()) throw new Error(`localPath must be a regular file: ${localPath}`);
  const remotePath = validateRemoteAbsolutePath(remoteInput);
  const privateKey = await readPrivateKey(resolved.node);
  const client = await connectClient(resolved.node, resolved.resolvedHost, privateKey);
  let sftp: SFTPWrapper | null = null;
  try {
    sftp = await sftpAsync(client);
    const existing = await sftpStat(sftp, remotePath);
    if (existing && !overwrite) throw new Error(`[remote-node-target-exists] Remote target already exists: ${remotePath}. Set overwrite=true only when replacement is intended.`);
    await ensureRemoteDirectory(sftp, path.posix.dirname(remotePath));
    await sftpFastPut(sftp, localPath, remotePath);
    const readback = await sftpStat(sftp, remotePath);
    if (!readback || readback.size !== localStat.size) {
      throw new Error(`[remote-node-upload-readback-failed] Remote size mismatch for ${remotePath}: expected ${localStat.size}, got ${readback?.size ?? "missing"}.`);
    }
    return {
      nodeId: resolved.node.id,
      resolvedHost: resolved.resolvedHost,
      discovered: resolved.discovered,
      localPath,
      remotePath,
      bytes: localStat.size,
      overwrite,
      verified: true,
    };
  } finally {
    try { sftp?.end(); } catch { /* best effort */ }
    client.end();
  }
}

export const remoteNodeToolModule: BridgeToolModule = {
  name: "remote-node",
  tools: [
    {
      name: "remote_node_list",
      description: "List Bridge-owned configured remote nodes without exposing private-key contents or secret material. Use this before remote_node_status/exec/upload when the node id is unknown.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "remote_node_status",
      description: "Verify a configured remote node over SSH with a pinned host-key fingerprint and key authentication, then return bounded Linux hardware/runtime capability data. Can discover a moved LAN host inside its configured /24 subnet without depending on Kairos.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", pattern: nodeIdPattern.source },
          discover: { type: "boolean", default: true },
          connectTimeoutMs: { type: "number", minimum: 1000, maximum: 15000, default: DEFAULT_CONNECT_TIMEOUT_MS },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
    {
      name: "remote_node_exec",
      description: "Execute one bounded shell command on a Bridge-configured remote node over pinned-key SSH. Requires exact node confirmation, accepts no arbitrary host/user/key arguments, and never returns private-key material.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", pattern: nodeIdPattern.source },
          confirmNodeId: { type: "string", pattern: nodeIdPattern.source },
          command: { type: "string", minLength: 1, maxLength: 12000 },
          discover: { type: "boolean", default: true },
          timeoutMs: { type: "number", minimum: 1000, maximum: MAX_COMMAND_TIMEOUT_MS, default: DEFAULT_COMMAND_TIMEOUT_MS },
        },
        required: ["nodeId", "confirmNodeId", "command"],
        additionalProperties: false,
      },
    },
    {
      name: "remote_node_upload_file",
      description: "Upload one allowed local file to a Bridge-configured remote node using SFTP over pinned-key SSH, creating remote parent directories and verifying the final byte size. Requires exact node confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", pattern: nodeIdPattern.source },
          confirmNodeId: { type: "string", pattern: nodeIdPattern.source },
          localPath: { type: "string", minLength: 1, maxLength: 2048 },
          remotePath: { type: "string", minLength: 1, maxLength: 2048 },
          overwrite: { type: "boolean", default: false },
          discover: { type: "boolean", default: true },
        },
        required: ["nodeId", "confirmNodeId", "localPath", "remotePath"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    remote_node_list: async () => {
      const { configPath, config } = await loadRemoteNodeConfig();
      return {
        configPath,
        nodes: config.nodes.map((node) => ({
          id: node.id,
          label: node.label ?? null,
          host: node.host,
          port: node.port,
          username: node.username,
          discoverySubnet: node.discoverySubnet ?? null,
          hostKeyPinned: true,
          identityConfigured: Boolean(node.identityFile),
        })),
      };
    },
    remote_node_status: async (args) => {
      const parsed = z.object({
        nodeId: z.string().regex(nodeIdPattern),
        discover: z.boolean().default(true),
        connectTimeoutMs: z.number().int().min(1000).max(15000).default(DEFAULT_CONNECT_TIMEOUT_MS),
      }).strict().parse(args);
      return await remoteNodeStatus(parsed.nodeId, parsed.discover, parsed.connectTimeoutMs);
    },
    remote_node_exec: async (args) => {
      const parsed = z.object({
        nodeId: z.string().regex(nodeIdPattern),
        confirmNodeId: z.string().regex(nodeIdPattern),
        command: z.string().min(1).max(12000),
        discover: z.boolean().default(true),
        timeoutMs: z.number().int().min(1000).max(MAX_COMMAND_TIMEOUT_MS).default(DEFAULT_COMMAND_TIMEOUT_MS),
      }).strict().parse(args);
      if (parsed.confirmNodeId !== parsed.nodeId) throw new Error(`confirmNodeId must exactly match '${parsed.nodeId}'.`);
      const node = await getRemoteNode(parsed.nodeId);
      const resolved = await resolveRemoteNode(node, parsed.discover, Math.min(parsed.timeoutMs, 15_000));
      const result = await execRemote(resolved, parsed.command, parsed.timeoutMs);
      return {
        nodeId: node.id,
        resolvedHost: resolved.resolvedHost,
        discovered: resolved.discovered,
        commandChars: parsed.command.length,
        ...result,
      };
    },
    remote_node_upload_file: async (args) => {
      const parsed = z.object({
        nodeId: z.string().regex(nodeIdPattern),
        confirmNodeId: z.string().regex(nodeIdPattern),
        localPath: z.string().min(1).max(2048),
        remotePath: z.string().min(1).max(2048),
        overwrite: z.boolean().default(false),
        discover: z.boolean().default(true),
      }).strict().parse(args);
      if (parsed.confirmNodeId !== parsed.nodeId) throw new Error(`confirmNodeId must exactly match '${parsed.nodeId}'.`);
      const node = await getRemoteNode(parsed.nodeId);
      const resolved = await resolveRemoteNode(node, parsed.discover, DEFAULT_CONNECT_TIMEOUT_MS);
      return await uploadRemoteFile(resolved, parsed.localPath, parsed.remotePath, parsed.overwrite);
    },
  },
};
