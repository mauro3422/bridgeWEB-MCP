import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath, runProcess } from "./shared/process.js";

const DEFAULT_BLENDER_EXE = "D:\\SteamLibrary\\steamapps\\common\\Blender\\blender.exe";
const DEFAULT_BLENDER_HOST = "127.0.0.1";
const DEFAULT_BLENDER_PORT = 9877;
const STANDALONE_BLENDER_MCP_PORT = 9878;
const DEFAULT_SOCKET_TIMEOUT_MS = 180_000;
const MAX_SOCKET_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_CODE_CHARS = 100_000;
const MAX_REVIEW_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_FOCUS_PREVIEW_TOTAL_BYTES = 10 * 1024 * 1024;
const REVIEW_VIEW_NAMES = [
  "front",
  "right",
  "back",
  "left",
  "three-quarter",
  "three-quarter-left",
  "rear-three-quarter",
  "top",
] as const;

function blenderExecutable(): string {
  return path.resolve(process.env.BRIDGE_BLENDER_EXE || DEFAULT_BLENDER_EXE);
}

function bridgeIntegrationPath(fileName: string): string {
  return path.resolve(process.cwd(), "integrations", "blender", fileName);
}

async function ensureFile(filePath: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
async function blenderAutostartStatus(versionLine: string | null): Promise<Record<string, unknown>> {
  const match = versionLine?.match(/Blender\s+(\d+)\.(\d+)/i);
  const appData = process.env.APPDATA;
  if (!match || !appData) {
    return { supported: false, installed: false, reason: "Blender version or APPDATA could not be resolved" };
  }
  const versionFolder = `${match[1]}.${match[2]}`;
  const addonPath = path.join(
    appData,
    "Blender Foundation",
    "Blender",
    versionFolder,
    "scripts",
    "addons",
    "mauro_blender_bridge",
    "__init__.py",
  );
  try {
    const content = await fs.readFile(addonPath, "utf8");
    return {
      supported: true,
      installed: content.includes("MAURO_BLENDER_BRIDGE_ADDON=1"),
      mode: "enabled-addon",
      addonPath,
      versionFolder,
      bytes: Buffer.byteLength(content, "utf8"),
      sourceCurrent: content.toLowerCase().includes(bridgeIntegrationPath("mauro_blender_bridge.py").toLowerCase()),
    };
  } catch {
    return { supported: true, installed: false, mode: "enabled-addon", addonPath, versionFolder };
  }
}



function sha256(buffer: Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function validateReferenceImage(buffer: Buffer, extension: string): void {
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const expected = extension === ".png" ? isPng : extension === ".webp" ? isWebp : isJpeg;
  if (!expected) throw new Error(`Decoded bytes do not match the requested image extension: ${extension}`);
}

const REFERENCE_PACK_ROLES = [
  "front",
  "rear",
  "left",
  "right",
  "top",
  "bottom",
  "front_left_3q",
  "front_right_3q",
  "rear_left_3q",
  "rear_right_3q",
] as const;
const CONSTRUCTION_REFERENCE_ROLES = new Set(["front", "rear", "left", "right", "top", "bottom"]);

type ReferencePackRole = (typeof REFERENCE_PACK_ROLES)[number];
type ReferencePackItem = {
  role: ReferencePackRole;
  usage: "construction" | "design";
  projection: "orthographic" | "perspective";
  semanticQa?: { status?: "pass" | "pending" | "fail"; notes?: string[] };
  source?: { path?: string; width?: number; height?: number; bytes?: number; sha256?: string };
  output?: { path?: string; width?: number; height?: number; bytes?: number; sha256?: string; format?: string };
  quality?: { warnings?: string[] };
};

type ReferencePackManifest = {
  schemaVersion?: number;
  kind?: string;
  stage?: string;
  baseName?: string;
  assetKind?: string;
  settings?: Record<string, unknown>;
  masters?: { design?: ReferencePackRole; geometry?: ReferencePackRole };
  crossViewQuality?: { warnings?: string[]; pairs?: Array<{ warnings?: string[] }> };
  blockingErrors?: string[];
  items?: ReferencePackItem[];
};

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30 || buffer.subarray(12, 16).toString("ascii") !== "VP8X") return null;
  return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
}

async function inspectReferenceImageFile(filePathInput: string) {
  const filePath = resolveToolPath(filePathInput, { access: "read" });
  await ensureFile(filePath, "Reference-pack image");
  const extension = path.extname(filePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw new Error(`Unsupported reference image extension: ${extension}`);
  const buffer = await fs.readFile(filePath);
  validateReferenceImage(buffer, extension);
  const dimensions = extension === ".png" ? pngDimensions(buffer) : extension === ".webp" ? webpDimensions(buffer) : jpegDimensions(buffer);
  if (!dimensions) throw new Error(`Could not read reference image dimensions: ${filePath}`);
  return { filePath, bytes: buffer.length, sha256: sha256(buffer), ...dimensions };
}



async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen({ host: DEFAULT_BLENDER_HOST, port });
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port <= Math.min(65535, startPort + 20); port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No free Blender bridge port found from ${startPort} to ${Math.min(65535, startPort + 20)}`);
}

async function waitForBlender(port: number, timeoutMs = 45_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return await sendBlenderCommand("ping", {}, { port, timeoutMs: 1_500 });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Blender did not connect on port ${port}: ${String(lastError)}`);
}

function sendBlenderCommand(
  type: string,
  params: Record<string, unknown> = {},
  options: { host?: string; port?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const host = options.host ?? DEFAULT_BLENDER_HOST;
  const port = options.port ?? DEFAULT_BLENDER_PORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;

  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing non-loopback Blender host: ${host}`);
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let receivedBytes = 0;
    const chunks: Buffer[] = [];

    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    const tryComplete = () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        const response = JSON.parse(raw) as { status?: string; message?: string; result?: unknown };
        if (response.status === "error") {
          finish(new Error(response.message || "Unknown error from Blender"));
          return;
        }
        finish(undefined, response.result ?? response);
      } catch (error) {
        if (!(error instanceof SyntaxError)) finish(error as Error);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for Blender at ${host}:${port}`));
    }, timeoutMs);

    socket.once("connect", () => {
      socket.write(JSON.stringify({ type, params }));
    });
    socket.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_SOCKET_RESPONSE_BYTES) {
        finish(new Error(`Blender response exceeded ${MAX_SOCKET_RESPONSE_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
      tryComplete();
    });
    socket.once("end", tryComplete);
    socket.once("error", (error) => {
      finish(new Error(`Could not communicate with Blender at ${host}:${port}: ${error.message}`));
    });
  });
}
type BlenderOperationMode = "reference-only" | "inspect" | "scene-write" | "foreground-capture";

type BlenderRuntimeActivity = {
  runtime_started_at?: string | null;
  last_command_at?: string | null;
  last_command_type?: string | null;
  last_file_load_at?: string | null;
  last_file_save_at?: string | null;
  last_scene_update_at?: string | null;
  last_scene_update_source?: string | null;
  last_human_or_external_update_at?: string | null;
  last_bridge_scene_update_at?: string | null;
};

type BlenderRuntimeState = {
  pid?: number;
  file?: string | null;
  is_saved?: boolean;
  is_dirty?: boolean;
  disk?: { exists?: boolean; modified_at?: string | null; bytes?: number | null };
  scene?: string | null;
  mode?: string | null;
  active_object?: string | null;
  activity?: BlenderRuntimeActivity;
};

type BlenderPing = {
  ok?: boolean;
  bridge?: string;
  version?: string;
  blender_version?: string;
  file?: string | null;
  runtime?: BlenderRuntimeState;
};

function normalizedBlendPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameBlendPath(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizedBlendPath(left);
  const normalizedRight = normalizedBlendPath(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

async function resolveExpectedBlendFile(input: string | undefined): Promise<string | null> {
  if (!input) return null;
  const resolved = resolveToolPath(input, { access: "read" });
  await ensureFile(resolved, "Expected Blender file");
  if (path.extname(resolved).toLowerCase() !== ".blend") throw new Error("expectedBlendFile must use the .blend extension");
  return resolved;
}

function secondsSinceIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 1000);
}

async function blenderProcessInventory(): Promise<Record<string, unknown>> {
  if (process.platform !== "win32") return { supported: false, count: null, instances: [] };
  const script = [
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name='blender.exe'\" | ForEach-Object {",
    "  $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue",
    "  [pscustomobject]@{",
    "    pid = [int]$_.ProcessId",
    "    executablePath = $_.ExecutablePath",
    "    commandLine = $_.CommandLine",
    "    mainWindowTitle = if ($process) { $process.MainWindowTitle } else { $null }",
    "    startTime = if ($process -and $process.StartTime) { $process.StartTime.ToUniversalTime().ToString('o') } else { $null }",
    "  }",
    "})",
    "ConvertTo-Json -InputObject $items -Compress -Depth 4",
  ].join("\n");
  const result = await runProcess("powershell.exe", ["-NoProfile", "-Command", script], process.cwd(), 10_000);
  if (result.code !== 0 || result.timedOut === true) {
    return { supported: true, count: null, instances: [], error: String(result.stderr || result.stdout || result.error || "process inventory failed") };
  }
  try {
    const parsed = JSON.parse(String(result.stdout ?? "[]").trim() || "[]") as unknown;
    const instances = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return { supported: true, count: instances.length, instances };
  } catch (error) {
    return { supported: true, count: null, instances: [], error: `Invalid Blender process inventory JSON: ${String(error)}` };
  }
}

function buildBlenderSessionVerdict(args: {
  connected: boolean;
  connection: BlenderPing | null;
  expectedBlendFile: string | null;
  operationMode: BlenderOperationMode;
  recentActivityWindowSeconds: number;
  allowRecentHumanActivity: boolean;
}) {
  const actualBlendFile = args.connection?.runtime?.file ?? args.connection?.file ?? null;
  const exactTargetMatch = args.expectedBlendFile ? sameBlendPath(actualBlendFile, args.expectedBlendFile) : null;
  const lastHumanOrExternalUpdateAt = args.connection?.runtime?.activity?.last_human_or_external_update_at ?? null;
  const humanOrExternalActivityAgeSeconds = secondsSinceIso(lastHumanOrExternalUpdateAt);
  const recentHumanOrExternalActivity = humanOrExternalActivityAgeSeconds !== null
    && humanOrExternalActivityAgeSeconds <= args.recentActivityWindowSeconds;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (args.operationMode === "reference-only") {
    reasons.push("Reference-only mode forbids opening, focusing, capturing, mutating, or saving the live Blender session.");
    if (args.connected) warnings.push("A Blender session is connected, but it must remain untouched while references are generated on disk.");
    return {
      allowed: true,
      blenderInteractionAllowed: false,
      operationMode: args.operationMode,
      actualBlendFile,
      expectedBlendFile: args.expectedBlendFile,
      exactTargetMatch,
      recentHumanOrExternalActivity,
      humanOrExternalActivityAgeSeconds,
      lastHumanOrExternalUpdateAt,
      reasons,
      warnings,
    };
  }

  if (!args.connected) reasons.push("No live Blender bridge is connected on the requested port.");
  if ((args.operationMode === "scene-write" || args.operationMode === "foreground-capture") && !args.expectedBlendFile) {
    reasons.push(`${args.operationMode} requires expectedBlendFile so the target cannot drift to another project.`);
  }
  if (args.expectedBlendFile && exactTargetMatch !== true) {
    reasons.push(`Connected Blender file does not match expectedBlendFile: ${String(actualBlendFile)} != ${args.expectedBlendFile}`);
  }
  if ((args.operationMode === "scene-write" || args.operationMode === "foreground-capture")
    && recentHumanOrExternalActivity
    && !args.allowRecentHumanActivity) {
    reasons.push(`Human-or-external scene activity was observed within ${args.recentActivityWindowSeconds} seconds; refusing focus or mutation without an explicit override.`);
  }
  if (args.connection?.runtime?.is_dirty) warnings.push("The connected Blender file has unsaved changes.");
  if (args.connection?.runtime?.is_saved === false) warnings.push("The connected Blender session has never been saved to a .blend path.");

  return {
    allowed: reasons.length === 0,
    blenderInteractionAllowed: reasons.length === 0,
    operationMode: args.operationMode,
    actualBlendFile,
    expectedBlendFile: args.expectedBlendFile,
    exactTargetMatch,
    recentHumanOrExternalActivity,
    humanOrExternalActivityAgeSeconds,
    lastHumanOrExternalUpdateAt,
    reasons,
    warnings,
  };
}

async function assertBlenderSession(args: {
  port: number;
  expectedBlendFile?: string;
  operationMode: Exclude<BlenderOperationMode, "reference-only">;
  recentActivityWindowSeconds?: number;
  allowRecentHumanActivity?: boolean;
}) {
  const expectedBlendFile = await resolveExpectedBlendFile(args.expectedBlendFile);
  const connection = await sendBlenderCommand("ping", {}, { port: args.port, timeoutMs: 2_500 }) as BlenderPing;
  const verdict = buildBlenderSessionVerdict({
    connected: true,
    connection,
    expectedBlendFile,
    operationMode: args.operationMode,
    recentActivityWindowSeconds: args.recentActivityWindowSeconds ?? 15,
    allowRecentHumanActivity: args.allowRecentHumanActivity ?? false,
  });
  if (!verdict.allowed) throw new Error(`Blender session guard rejected ${args.operationMode}: ${verdict.reasons.join(" ")}`);
  return { connection, verdict, expectedBlendFile };
}


async function blenderStatus(args: {
  port: number;
  expectedBlendFile?: string;
  operationMode: BlenderOperationMode;
  recentActivityWindowSeconds: number;
  allowRecentHumanActivity: boolean;
}) {
  const executable = blenderExecutable();
  let installed = false;
  let version: Record<string, unknown> | null = null;
  let detectedVersionLine: string | null = null;
  try {
    await ensureFile(executable, "Blender executable");
    installed = true;
    const processResult = await runProcess(executable, ["--version"], process.cwd(), 30_000);
    const versionLine = String(processResult.stdout ?? "")
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("Blender ")) ?? null;
    detectedVersionLine = versionLine;
    version = {
      ok: processResult.code === 0 && processResult.timedOut !== true,
      code: processResult.code,
      timedOut: processResult.timedOut,
      durationMs: processResult.durationMs,
      versionLine,
      error: processResult.error,
    };
  } catch (error) {
    version = { ok: false, error: String(error) };
  }

  let connection: BlenderPing | null = null;
  let connectionError: string | null = null;
  let connected = false;
  try {
    connection = await sendBlenderCommand("ping", {}, { port: args.port, timeoutMs: 2_500 }) as BlenderPing;
    connected = true;
  } catch (error) {
    connectionError = String(error);
  }

  const expectedBlendFile = await resolveExpectedBlendFile(args.expectedBlendFile);
  const verdict = buildBlenderSessionVerdict({
    connected,
    connection,
    expectedBlendFile,
    operationMode: args.operationMode,
    recentActivityWindowSeconds: args.recentActivityWindowSeconds,
    allowRecentHumanActivity: args.allowRecentHumanActivity,
  });
  const [autostart, processes] = await Promise.all([
    blenderAutostartStatus(detectedVersionLine),
    blenderProcessInventory(),
  ]);
  const processInstances = Array.isArray(processes.instances) ? processes.instances as Array<Record<string, unknown>> : [];
  const targetPid = connection?.runtime?.pid ?? null;
  const targetProcess = targetPid === null ? null : processInstances.find((item) => Number(item.pid) === targetPid) ?? null;
  const otherInstances = targetPid === null ? processInstances : processInstances.filter((item) => Number(item.pid) !== targetPid);

  return {
    installed,
    executable,
    version,
    autostart,
    processes: {
      ...processes,
      targetPid,
      targetProcess,
      otherInstanceCount: otherInstances.length,
      otherInstances,
      policy: "Additional Blender processes are warnings, not auto-closed; exact port, PID, and .blend path pin the agent target.",
    },
    session: verdict,
    interactive: {
      connected,
      host: DEFAULT_BLENDER_HOST,
      port: args.port,
      connection: connection ?? { error: connectionError },
      startupScript: bridgeIntegrationPath("startup.py"),
    },
  };
}

async function launchBlenderInstance(blendFile: string | undefined, port: number) {
  const executable = blenderExecutable();
  const startupScript = bridgeIntegrationPath("startup.py");
  await ensureFile(executable, "Blender executable");
  await ensureFile(startupScript, "Blender bridge startup script");

  const args: string[] = [];
  let resolvedBlendFile: string | null = null;
  if (blendFile) {
    resolvedBlendFile = resolveToolPath(blendFile, { access: "read" });
    await ensureFile(resolvedBlendFile, "Blend file");
    if (path.extname(resolvedBlendFile).toLowerCase() !== ".blend") throw new Error("blendFile must use the .blend extension");
    args.push(resolvedBlendFile);
  }
  args.push("--python", startupScript);

  const child = spawn(executable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env: { ...process.env, BRIDGE_BLENDER_PORT: String(port) },
  });
  child.unref();

  return {
    launched: true,
    pid: child.pid ?? null,
    executable,
    blendFile: resolvedBlendFile,
    startupScript,
    host: DEFAULT_BLENDER_HOST,
    port,
  };
}

async function openBlender(blendFile: string | undefined, port: number) {
  const requestedBlendFile = await resolveExpectedBlendFile(blendFile);
  try {
    const ping = await sendBlenderCommand("ping", {}, { port, timeoutMs: 1_000 }) as BlenderPing;
    const connectedBlendFile = ping.runtime?.file ?? ping.file ?? null;
    if (requestedBlendFile && !sameBlendPath(connectedBlendFile, requestedBlendFile)) {
      throw new Error(
        `Blender port ${port} is already owned by ${String(connectedBlendFile)}; refusing to redirect it to ${requestedBlendFile}. Use another port or switch/close that Blender instance explicitly.`,
      );
    }
    return { launched: false, alreadyConnected: true, port, blendFile: connectedBlendFile, exactTargetMatch: requestedBlendFile ? true : null, ping };
  } catch (error) {
    if (String(error).includes("already owned by")) throw error;
    return await launchBlenderInstance(requestedBlendFile ?? undefined, port);
  }
}

async function batchScript(args: {
  scriptPath: string;
  blendFile?: string;
  scriptArgs: string[];
  cwd?: string;
  timeoutMs: number;
}) {
  const executable = blenderExecutable();
  await ensureFile(executable, "Blender executable");

  const scriptPath = resolveToolPath(args.scriptPath, { access: "read" });
  await ensureFile(scriptPath, "Blender Python script");
  if (path.extname(scriptPath).toLowerCase() !== ".py") {
    throw new Error("scriptPath must use the .py extension");
  }

  let blendFile: string | null = null;
  if (args.blendFile) {
    blendFile = resolveToolPath(args.blendFile, { access: "read" });
    await ensureFile(blendFile, "Blend file");
    if (path.extname(blendFile).toLowerCase() !== ".blend") {
      throw new Error("blendFile must use the .blend extension");
    }
  }

  const cwd = resolveToolPath(args.cwd ?? path.dirname(scriptPath), { access: "cwd" });
  const processArgs = ["--background"];
  if (blendFile) processArgs.push(blendFile);
  processArgs.push("--python", scriptPath);
  if (args.scriptArgs.length > 0) processArgs.push("--", ...args.scriptArgs);

  const result = await runProcess(executable, processArgs, cwd, args.timeoutMs);
  const stderr = String(result.stderr ?? "");
  const stdout = String(result.stdout ?? "");
  const outputTail = `${stderr}\n${stdout}`.trim().slice(-4000);
  if (result.timedOut === true) throw new Error(`Blender batch script timed out: ${outputTail || "no process output"}`);
  if (result.code !== 0) throw new Error(`[script-runtime-error] Blender batch script exited with code ${String(result.code)}: ${outputTail || "no process output"}`);
  if (/Traceback \(most recent call last\):|Error: Python: Traceback/.test(`${stderr}\n${stdout}`)) {
    throw new Error(`[script-runtime-error] Blender exited with code 0 but the Python script reported a traceback: ${outputTail}`);
  }
  return { ...result, ok: true };
}

async function readReferencePackManifest(manifestPathInput: string) {
  const manifestPath = resolveToolPath(manifestPathInput, { access: "read" });
  await ensureFile(manifestPath, "Reference-pack manifest");
  if (path.extname(manifestPath).toLowerCase() !== ".json") throw new Error("Reference-pack manifest must use the .json extension");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ReferencePackManifest;
  return { manifestPath, manifest };
}

async function validateReferencePack(args: {
  manifestPath: string;
  requiredRoles: ReferencePackRole[];
  requireSemanticQa: boolean;
  strictWarnings: boolean;
}) {
  const { manifestPath, manifest } = await readReferencePackManifest(args.manifestPath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const itemResults: Array<Record<string, unknown>> = [];

  if (manifest.kind !== "blender-reference-pack") errors.push("manifest_kind_must_be_blender-reference-pack");
  if (manifest.schemaVersion !== 1) errors.push("unsupported_manifest_schema");
  if (!Array.isArray(manifest.items) || manifest.items.length < 2) errors.push("manifest_requires_at_least_two_items");
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const roles = new Set<string>();
  const constructionHashes = new Map<string, string>();
  let constructionCanvas: { width: number; height: number } | null = null;

  for (const item of items) {
    const role = item.role;
    if (!REFERENCE_PACK_ROLES.includes(role)) {
      errors.push(`unknown_role:${String(role)}`);
      continue;
    }
    if (roles.has(role)) errors.push(`duplicate_role:${role}`);
    roles.add(role);
    if (item.usage === "construction") {
      if (!CONSTRUCTION_REFERENCE_ROLES.has(role)) errors.push(`construction_role_not_axis_aligned:${role}`);
      if (item.projection !== "orthographic") errors.push(`construction_projection_not_orthographic:${role}`);
    }
    const qaStatus = item.semanticQa?.status ?? "pending";
    if (args.requireSemanticQa && qaStatus !== "pass") errors.push(`semantic_qa_${qaStatus}:${role}`);
    else if (qaStatus !== "pass") warnings.push(`semantic_qa_${qaStatus}:${role}`);

    const outputPath = item.output?.path;
    if (!outputPath) {
      errors.push(`missing_output_path:${role}`);
      continue;
    }
    try {
      const actual = await inspectReferenceImageFile(outputPath);
      if (item.output?.sha256 && item.output.sha256 !== actual.sha256) errors.push(`sha256_mismatch:${role}`);
      if (typeof item.output?.bytes === "number" && item.output.bytes !== actual.bytes) errors.push(`byte_count_mismatch:${role}`);
      if (typeof item.output?.width === "number" && item.output.width !== actual.width) errors.push(`width_mismatch:${role}`);
      if (typeof item.output?.height === "number" && item.output.height !== actual.height) errors.push(`height_mismatch:${role}`);
      if (item.usage === "construction") {
        if (!constructionCanvas) constructionCanvas = { width: actual.width, height: actual.height };
        else if (constructionCanvas.width !== actual.width || constructionCanvas.height !== actual.height) errors.push(`construction_canvas_mismatch:${role}`);
        const duplicateRole = constructionHashes.get(actual.sha256);
        if (duplicateRole && duplicateRole !== role) errors.push(`duplicate_construction_image:${duplicateRole}:${role}`);
        constructionHashes.set(actual.sha256, role);
      }
      itemResults.push({
        role,
        usage: item.usage,
        projection: item.projection,
        semanticQa: qaStatus,
        path: actual.filePath,
        width: actual.width,
        height: actual.height,
        bytes: actual.bytes,
        sha256: actual.sha256,
        warnings: item.quality?.warnings ?? [],
      });
      for (const warning of item.quality?.warnings ?? []) warnings.push(`${warning}:${role}`);
    } catch (error) {
      errors.push(`image_invalid:${role}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const role of args.requiredRoles) if (!roles.has(role)) errors.push(`required_role_missing:${role}`);
  const geometryMaster = manifest.masters?.geometry;
  const designMaster = manifest.masters?.design;
  if (geometryMaster && !roles.has(geometryMaster)) errors.push(`geometry_master_missing:${geometryMaster}`);
  if (designMaster && !roles.has(designMaster)) errors.push(`design_master_missing:${designMaster}`);
  for (const error of manifest.blockingErrors ?? []) errors.push(`manifest_blocking:${error}`);
  for (const warning of manifest.crossViewQuality?.warnings ?? []) warnings.push(`cross_view:${warning}`);
  for (const pair of manifest.crossViewQuality?.pairs ?? []) {
    for (const warning of pair.warnings ?? []) warnings.push(`pair:${warning}`);
  }
  if (args.strictWarnings && warnings.length > 0) errors.push(...warnings.map((warning) => `strict_warning:${warning}`));

  return {
    manifestPath,
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    requiredRoles: args.requiredRoles,
    requireSemanticQa: args.requireSemanticQa,
    strictWarnings: args.strictWarnings,
    itemCount: items.length,
    constructionCanvas,
    items: itemResults,
    manifest,
  };
}

async function installReferencePack(args: {
  manifestPath: string;
  outputBlend: string;
  layout: "axis_aligned" | "surround";
  displaySize: number;
  opacity: number;
  requiredRoles: ReferencePackRole[];
  requireSemanticQa: boolean;
  strictWarnings: boolean;
  overwrite: boolean;
  openAfter: boolean;
  port: number;
  timeoutMs: number;
}) {
  const validation = await validateReferencePack({
    manifestPath: args.manifestPath,
    requiredRoles: args.requiredRoles,
    requireSemanticQa: args.requireSemanticQa,
    strictWarnings: args.strictWarnings,
  });
  if (!validation.valid) throw new Error(`Reference pack is not installable: ${validation.errors.join("; ")}`);

  const outputBlend = resolveToolPath(args.outputBlend, { access: "write" });
  if (path.extname(outputBlend).toLowerCase() !== ".blend") throw new Error("outputBlend must use the .blend extension");
  if (!args.overwrite && await pathExists(outputBlend)) throw new Error(`Blend file already exists: ${outputBlend}`);
  await fs.mkdir(path.dirname(outputBlend), { recursive: true });
  const installManifestPath = outputBlend.replace(/\.blend$/i, ".reference-install.json");
  const scriptPath = bridgeIntegrationPath("setup_reference_pack.py");
  const executable = blenderExecutable();
  await ensureFile(scriptPath, "Reference-pack installation script");
  await ensureFile(executable, "Blender executable");

  const configPath = path.join(path.dirname(outputBlend), `.install-reference-pack-${crypto.randomUUID()}.json`);
  await fs.writeFile(configPath, JSON.stringify({
    manifestPath: validation.manifestPath,
    outputBlend,
    installManifestPath,
    layout: args.layout,
    displaySize: args.displaySize,
    opacity: args.opacity,
  }, null, 2), "utf8");

  try {
    const processResult = await runProcess(
      executable,
      ["--background", "--python", scriptPath, "--", "--config", configPath],
      path.dirname(outputBlend),
      args.timeoutMs,
    );
    const processOutput = `${processResult.stdout ?? ""}\n${processResult.stderr ?? ""}`;
    const pythonFailed = /Traceback \(most recent call last\):|Error: Python:/i.test(processOutput);
    if (processResult.code !== 0 || processResult.timedOut || pythonFailed) {
      throw new Error(`Blender reference-pack installation failed: ${processResult.stderr || processResult.stdout || processResult.error || "unknown error"}`);
    }
    const marker = String(processResult.stdout ?? "")
      .split(/\r?\n/)
      .find((item) => item.startsWith("REFERENCE_PACK_INSTALLED="));
    const generated = marker ? JSON.parse(marker.slice("REFERENCE_PACK_INSTALLED=".length)) : null;
    let opened: unknown = null;
    let verification: unknown = null;
    let stage = "blend_created";
    let actualPort: number | null = null;
    if (args.openAfter) {
      actualPort = await findAvailablePort(args.port);
      opened = await launchBlenderInstance(outputBlend, actualPort);
      verification = await waitForBlender(actualPort);
      stage = "opened_and_verified";
    }
    const installManifest = JSON.parse(await fs.readFile(installManifestPath, "utf8"));
    installManifest.stage = stage;
    installManifest.updatedAt = new Date().toISOString();
    installManifest.open = { requested: args.openAfter, port: actualPort, result: opened, verification };
    await fs.writeFile(installManifestPath, JSON.stringify(installManifest, null, 2), "utf8");
    return {
      stage,
      manifestPath: validation.manifestPath,
      outputBlend,
      installManifestPath,
      validation,
      generated,
      opened,
      verification,
      port: actualPort,
      process: { code: processResult.code, timedOut: processResult.timedOut, durationMs: processResult.durationMs },
    };
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => undefined);
  }
}


async function setupCharacterReferences(args: {
  characterName: string;
  frontImage: string;
  sideImage: string;
  backImage: string;
  threeQuarterImage: string;
  outputBlend: string;
  height: number;
  opacity: number;
  overwrite: boolean;
  openAfter: boolean;
  port: number;
}) {
  const outputBlend = resolveToolPath(args.outputBlend, { access: "write" });
  if (path.extname(outputBlend).toLowerCase() !== ".blend") throw new Error("outputBlend must use the .blend extension");
  const manifestPath = outputBlend.replace(/\.blend$/i, ".loop.json");
  if (!args.overwrite && await pathExists(manifestPath)) throw new Error(`Character reference manifest already exists: ${manifestPath}`);
  await fs.mkdir(path.dirname(outputBlend), { recursive: true });

  const compatibilityInputs: Array<{
    role: ReferencePackRole;
    inputPath: string;
    usage: "construction" | "design";
    projection: "orthographic" | "perspective";
  }> = [
    { role: "front", inputPath: args.frontImage, usage: "construction", projection: "orthographic" },
    { role: "right", inputPath: args.sideImage, usage: "construction", projection: "orthographic" },
    { role: "rear", inputPath: args.backImage, usage: "construction", projection: "orthographic" },
    { role: "front_right_3q", inputPath: args.threeQuarterImage, usage: "design", projection: "perspective" },
  ];
  const items: ReferencePackItem[] = [];
  for (const input of compatibilityInputs) {
    const image = await inspectReferenceImageFile(input.inputPath);
    items.push({
      role: input.role,
      usage: input.usage,
      projection: input.projection,
      semanticQa: { status: "pass", notes: ["Accepted by legacy character-reference compatibility wrapper"] },
      source: { path: image.filePath, width: image.width, height: image.height, bytes: image.bytes, sha256: image.sha256 },
      output: { path: image.filePath, width: image.width, height: image.height, bytes: image.bytes, sha256: image.sha256, format: path.extname(image.filePath).slice(1) },
      quality: { warnings: [] },
    });
  }
  const pack: ReferencePackManifest & { characterName: string; outputBlend: string } = {
    schemaVersion: 1,
    kind: "blender-reference-pack",
    stage: "prepared",
    baseName: args.characterName,
    assetKind: "character",
    characterName: args.characterName,
    outputBlend,
    settings: { alignment: "baseline", compatibilityWrapper: true },
    masters: { geometry: "front", design: "front_right_3q" },
    crossViewQuality: { warnings: [], pairs: [] },
    blockingErrors: [],
    items,
  };
  await fs.writeFile(manifestPath, JSON.stringify(pack, null, 2), "utf8");
  const installed = await installReferencePack({
    manifestPath,
    outputBlend,
    layout: "axis_aligned",
    displaySize: args.height,
    opacity: args.opacity,
    requiredRoles: ["front", "right", "rear"],
    requireSemanticQa: true,
    strictWarnings: false,
    overwrite: args.overwrite,
    openAfter: args.openAfter,
    port: args.port,
    timeoutMs: 240_000,
  });
  const finalManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  finalManifest.stage = installed.stage;
  finalManifest.installManifestPath = installed.installManifestPath;
  finalManifest.open = { requested: args.openAfter, port: installed.port, verification: installed.verification };
  finalManifest.updatedAt = new Date().toISOString();
  await fs.writeFile(manifestPath, JSON.stringify(finalManifest, null, 2), "utf8");
  return { ...installed, characterName: args.characterName, manifestPath, compatibilityWrapper: true };
}

async function characterLoopStatus(manifestPathInput: string) {
  const manifestPath = resolveToolPath(manifestPathInput, { access: "read" });
  await ensureFile(manifestPath, "Character loop manifest");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const itemPaths = Array.isArray(manifest.items)
    ? manifest.items.map((item: any) => item?.output?.path ?? item?.source?.path)
    : [];
  const legacyImagePaths = Object.values(manifest.images ?? {}).map((item: any) => item?.path);
  const paths = [manifest.outputBlend, manifest.installManifestPath, ...itemPaths, ...legacyImagePaths].filter(Boolean) as string[];
  const files = await Promise.all(paths.map(async (filePath) => {
    try {
      const stat = await fs.stat(filePath);
      return { path: filePath, exists: stat.isFile(), bytes: stat.size };
    } catch {
      return { path: filePath, exists: false, bytes: null };
    }
  }));
  return { manifestPath, stage: manifest.stage ?? "unknown", characterName: manifest.characterName ?? null, files, manifest };
}

function generatedReviewPrefix(): string {
  return `blender-review-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")}`;
}

async function createReviewBundle(args: {
  outputDir: string;
  filePrefix?: string;
  views: Array<(typeof REVIEW_VIEW_NAMES)[number]>;
  targetCollections: string[];
  targetObjects: string[];
  resolution: number;
  margin: number;
  transparentBackground: boolean;
  createContactSheet: boolean;
  includePreview: boolean;
  overwrite: boolean;
  port: number;
  timeoutMs: number;
}) {
  const outputDir = resolveToolPath(args.outputDir, { access: "write" });
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = bridgeIntegrationPath("create_review_bundle.py");
  await ensureFile(scriptPath, "Blender review-bundle script");

  const filePrefix = args.filePrefix?.trim() || generatedReviewPrefix();
  const config = {
    output_dir: outputDir,
    file_prefix: filePrefix,
    views: args.views,
    target_collections: args.targetCollections,
    target_objects: args.targetObjects,
    resolution: args.resolution,
    margin: args.margin,
    transparent_background: args.transparentBackground,
    create_contact_sheet: args.createContactSheet,
    overwrite: args.overwrite,
  };
  const encodedConfig = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  const code = [
    "import base64, json, runpy",
    `config = json.loads(base64.b64decode(${JSON.stringify(encodedConfig)}).decode('utf-8'))`,
    `result = runpy.run_path(${JSON.stringify(scriptPath)})['create_review_bundle'](config)`,
  ].join("\n");

  const commandResult = await sendBlenderCommand(
    "execute_code",
    { code },
    { port: args.port, timeoutMs: args.timeoutMs },
  );
  const commandObject = commandResult && typeof commandResult === "object"
    ? commandResult as Record<string, unknown>
    : null;
  const bundle = commandObject?.result && typeof commandObject.result === "object"
    ? commandObject.result as Record<string, unknown>
    : null;
  if (!bundle || bundle.stage !== "review_bundle_created") {
    throw new Error("Blender did not return a valid review bundle");
  }

  const manifest = bundle.manifest && typeof bundle.manifest === "object"
    ? bundle.manifest as Record<string, unknown>
    : null;
  const manifestPath = typeof manifest?.path === "string" ? manifest.path : null;
  if (!manifestPath) throw new Error("Review bundle did not return a manifest path");
  await ensureFile(manifestPath, "Blender review manifest");

  const contact = bundle.contact_sheet && typeof bundle.contact_sheet === "object"
    ? bundle.contact_sheet as Record<string, unknown>
    : null;
  const contactPath = typeof contact?.path === "string" ? contact.path : null;
  let preview: Record<string, unknown> | null = null;
  let imageAttachment: Record<string, unknown> | null = null;
  if (args.includePreview && contactPath) {
    await ensureFile(contactPath, "Blender review contact sheet");
    const stat = await fs.stat(contactPath);
    if (stat.size <= MAX_REVIEW_PREVIEW_BYTES) {
      const data = await fs.readFile(contactPath);
      preview = {
        path: contactPath,
        mimeType: "image/png",
        bytes: data.length,
        sha256: sha256(data),
        attachedToToolResult: true,
      };
      imageAttachment = { type: "image", mimeType: "image/png", data: data.toString("base64") };
    } else {
      preview = {
        path: contactPath,
        mimeType: "image/png",
        bytes: stat.size,
        attachedToToolResult: false,
        warning: `Preview exceeds ${MAX_REVIEW_PREVIEW_BYTES} bytes`,
      };
    }
  }

  return {
    bundle,
    preview,
    __bridgeImages: imageAttachment ? [imageAttachment] : [],
  };
}

async function inspectBlenderRig(args: {
  armatureName?: string;
  boneLimit: number;
  includeActions: boolean;
  port: number;
  timeoutMs: number;
}) {
  const requestedName = args.armatureName?.trim() || null;
  const code = [
    "import bpy, re",
    `requested_name = ${JSON.stringify(requestedName)}`,
    `bone_limit = ${args.boneLimit}`,
    `include_actions = ${args.includeActions ? "True" : "False"}`,
    "armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']",
    "if requested_name:",
    "    rig = bpy.data.objects.get(requested_name)",
    "    if rig is None or rig.type != 'ARMATURE': raise RuntimeError(f'Armature not found: {requested_name}')",
    "else:",
    "    if len(armatures) != 1: raise RuntimeError(f'armatureName is required when the scene has {len(armatures)} armatures')",
    "    rig = armatures[0]",
    "bones = []",
    "for bone in list(rig.data.bones)[:bone_limit]:",
    "    pose = rig.pose.bones.get(bone.name)",
    "    constraints = []",
    "    if pose:",
    "        for constraint in pose.constraints:",
    "            constraints.append({'name': constraint.name, 'type': constraint.type, 'target': getattr(getattr(constraint, 'target', None), 'name', None), 'subtarget': getattr(constraint, 'subtarget', None) or None, 'influence': round(float(getattr(constraint, 'influence', 1.0)), 6)})",
    "    bones.append({'name': bone.name, 'parent': bone.parent.name if bone.parent else None, 'children': [child.name for child in bone.children], 'head_local': [round(float(v), 6) for v in bone.head_local], 'tail_local': [round(float(v), 6) for v in bone.tail_local], 'use_deform': bool(bone.use_deform), 'use_connect': bool(bone.use_connect), 'rotation_mode': pose.rotation_mode if pose else None, 'constraints': constraints})",
    "def action_stats(action):",
    "    fcurves = []",
    "    if hasattr(action, 'layers'):",
    "        for layer in action.layers:",
    "            for strip in layer.strips:",
    "                if hasattr(strip, 'channelbags'):",
    "                    for channelbag in strip.channelbags:",
    "                        fcurves.extend(list(channelbag.fcurves))",
    "    elif hasattr(action, 'fcurves'):",
    "        fcurves = list(action.fcurves)",
    "    paths = sorted({curve.data_path for curve in fcurves})",
    "    animated_bones = sorted({match.group(1) for path in paths for match in [re.match(r'pose\\.bones\\[\\\"(.+?)\\\"\\]', path)] if match})",
    "    return {'name': action.name, 'frame_range': [round(float(v), 4) for v in action.frame_range], 'users': int(action.users), 'fcurves': len(fcurves), 'keyframes': sum(len(curve.keyframe_points) for curve in fcurves), 'animated_bones': animated_bones, 'data_paths': paths[:300], 'data_paths_truncated': len(paths) > 300}",
    "active_action = rig.animation_data.action.name if rig.animation_data and rig.animation_data.action else None",
    "nla_tracks = []",
    "if rig.animation_data:",
    "    for track in rig.animation_data.nla_tracks:",
    "        nla_tracks.append({'name': track.name, 'mute': bool(track.mute), 'strips': [{'name': strip.name, 'action': strip.action.name if strip.action else None, 'frame_start': round(float(strip.frame_start), 4), 'frame_end': round(float(strip.frame_end), 4)} for strip in track.strips]})",
    "result = {'rig': rig.name, 'bone_count': len(rig.data.bones), 'bones_returned': len(bones), 'bones_truncated': len(rig.data.bones) > bone_limit, 'bones': bones, 'active_action': active_action, 'nla_tracks': nla_tracks, 'actions': [action_stats(action) for action in bpy.data.actions] if include_actions else [], 'scene_frame_range': [int(bpy.context.scene.frame_start), int(bpy.context.scene.frame_end)], 'current_frame': int(bpy.context.scene.frame_current), 'blender_version': bpy.app.version_string}",
  ].join("\n");
  const execution = await sendBlenderCommand("execute_code", { code }, { port: args.port, timeoutMs: args.timeoutMs });
  const payload = execution && typeof execution === "object" ? execution as Record<string, unknown> : null;
  const result = payload?.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : null;
  if (!result || typeof result.rig !== "string") throw new Error("Blender did not return a valid rig inspection result");
  return result;
}

async function createAnimationReview(args: {
  outputDir: string;
  filePrefix?: string;
  frames: number[];
  view: (typeof REVIEW_VIEW_NAMES)[number];
  targetCollections: string[];
  targetObjects: string[];
  resolution: number;
  margin: number;
  transparentBackground: boolean;
  createContactSheet: boolean;
  overwrite: boolean;
  port: number;
  timeoutMs: number;
}) {
  const outputDir = resolveToolPath(args.outputDir, { access: "write" });
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = bridgeIntegrationPath("create_animation_review.py");
  await ensureFile(scriptPath, "Blender animation-review script");
  const filePrefix = args.filePrefix?.trim()
    || `blender-animation-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")}`;
  const config = {
    output_dir: outputDir,
    file_prefix: filePrefix,
    frames: args.frames,
    view: args.view,
    target_collections: args.targetCollections,
    target_objects: args.targetObjects,
    resolution: args.resolution,
    margin: args.margin,
    transparent_background: args.transparentBackground,
    create_contact_sheet: args.createContactSheet,
    overwrite: args.overwrite,
  };
  const configJson = JSON.stringify(config);
  const code = [
    "import json, runpy",
    `config = json.loads(${JSON.stringify(configJson)})`,
    `result = runpy.run_path(${JSON.stringify(scriptPath)})['create_animation_review'](config)`,
  ].join("\n");
  const commandResult = await sendBlenderCommand(
    "execute_code",
    { code },
    { port: args.port, timeoutMs: args.timeoutMs },
  );
  const commandObject = commandResult && typeof commandResult === "object"
    ? commandResult as Record<string, unknown>
    : null;
  const review = commandObject?.result && typeof commandObject.result === "object"
    ? commandObject.result as Record<string, unknown>
    : null;
  if (!review || review.stage !== "animation_review_created") {
    throw new Error("Blender did not return a valid animation-review package");
  }
  const manifest = review.manifest && typeof review.manifest === "object"
    ? review.manifest as Record<string, unknown>
    : null;
  const manifestPath = typeof manifest?.path === "string" ? manifest.path : null;
  if (!manifestPath) throw new Error("Animation review did not return a manifest path");
  await ensureFile(manifestPath, "Blender animation-review manifest");
  const contact = review.contact_sheet && typeof review.contact_sheet === "object"
    ? review.contact_sheet as Record<string, unknown>
    : null;
  const contactPath = typeof contact?.path === "string" ? contact.path : null;
  if (args.createContactSheet && !contactPath) throw new Error("Animation review did not return a contact sheet path");
  if (contactPath) await ensureFile(contactPath, "Blender animation-review contact sheet");
  return {
    review,
    preview: contactPath ? {
      path: contactPath,
      mimeType: "image/png",
      bytes: typeof contact?.bytes === "number" ? contact.bytes : null,
      sha256: typeof contact?.sha256 === "string" ? contact.sha256 : null,
      transport: "use-image_file_attach",
    } : null,
  };
}

async function keyframeBlenderIk(args: {
  armatureName: string;
  actionName?: string;
  endBone: string;
  target: [number, number, number];
  frame: number;
  chainLength: number;
  clampToReach: boolean;
  reachMargin: number;
  aimBone?: string;
  aimTarget?: [number, number, number];
  saveBlend: boolean;
  port: number;
  timeoutMs: number;
}) {
  const configJson = JSON.stringify({
    armature_name: args.armatureName,
    action_name: args.actionName ?? null,
    end_bone: args.endBone,
    target: args.target,
    frame: args.frame,
    chain_length: args.chainLength,
    clamp_to_reach: args.clampToReach,
    reach_margin: args.reachMargin,
    aim_bone: args.aimBone ?? null,
    aim_target: args.aimTarget ?? null,
    save_blend: args.saveBlend,
  });
  const code = [
    "import bpy, json, math",
    "from mathutils import Vector",
    `cfg = json.loads(${JSON.stringify(configJson)})`,
    "rig = bpy.data.objects.get(cfg['armature_name'])",
    "if rig is None or rig.type != 'ARMATURE': raise RuntimeError(f\"Armature not found: {cfg['armature_name']}\")",
    "rig.animation_data_create()",
    "if cfg['action_name']:",
    "    action = bpy.data.actions.get(cfg['action_name'])",
    "    if action is None: raise RuntimeError(f\"Action not found: {cfg['action_name']}\")",
    "    rig.animation_data.action = action",
    "else:",
    "    action = rig.animation_data.action",
    "    if action is None: raise RuntimeError('No active action; provide actionName')",
    "end = rig.pose.bones.get(cfg['end_bone'])",
    "if end is None: raise RuntimeError(f\"Pose bone not found: {cfg['end_bone']}\")",
    "frame = int(cfg['frame'])",
    "scene = bpy.context.scene",
    "if frame < scene.frame_start or frame > scene.frame_end: raise RuntimeError(f'Frame {frame} outside scene range {scene.frame_start}..{scene.frame_end}')",
    "scene.frame_set(frame)",
    "bpy.context.view_layer.update()",
    "chain = []",
    "cursor = end",
    "for _ in range(int(cfg['chain_length'])):",
    "    if cursor is None: break",
    "    chain.append(cursor)",
    "    cursor = cursor.parent",
    "if len(chain) != int(cfg['chain_length']): raise RuntimeError(f\"Requested chainLength={cfg['chain_length']} but only {len(chain)} bones are available from {cfg['end_bone']}\")",
    "root = chain[-1]",
    "root_head = rig.matrix_world @ root.head",
    "requested = Vector(cfg['target'])",
    "max_reach = sum(float(pb.length) for pb in chain)",
    "margin = float(cfg['reach_margin'])",
    "allowed_reach = max_reach * margin",
    "offset = requested - root_head",
    "requested_distance = float(offset.length)",
    "clamped = False",
    "effective = requested.copy()",
    "if cfg['clamp_to_reach'] and requested_distance > allowed_reach and requested_distance > 1e-9:",
    "    effective = root_head + offset.normalized() * allowed_reach",
    "    clamped = True",
    "target_obj = None",
    "ik = None",
    "aim_obj = None",
    "aim_constraint = None",
    "try:",
    "    target_obj = bpy.data.objects.new('__BRIDGE_TEMP_IK_TARGET__', None)",
    "    scene.collection.objects.link(target_obj)",
    "    target_obj.location = effective",
    "    ik = end.constraints.new('IK')",
    "    ik.name = '__BRIDGE_TEMP_IK__'",
    "    ik.target = target_obj",
    "    ik.chain_count = int(cfg['chain_length'])",
    "    ik.use_tail = True",
    "    ik.influence = 1.0",
    "    bpy.context.view_layer.update()",
    "    solved = {pb.name: pb.matrix.copy() for pb in chain}",
    "    end.constraints.remove(ik)",
    "    ik = None",
    "    bpy.data.objects.remove(target_obj, do_unlink=True)",
    "    target_obj = None",
    "    bpy.context.view_layer.update()",
    "    for pb in reversed(chain):",
    "        pb.rotation_mode = 'QUATERNION'",
    "        pb.matrix = solved[pb.name]",
    "        bpy.context.view_layer.update()",
    "        pb.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=pb.name)",
    "    if cfg['aim_bone']:",
    "        if not cfg['aim_target']: raise RuntimeError('aimTarget is required when aimBone is provided')",
    "        aim_bone = rig.pose.bones.get(cfg['aim_bone'])",
    "        if aim_bone is None: raise RuntimeError(f\"Pose bone not found: {cfg['aim_bone']}\")",
    "        aim_obj = bpy.data.objects.new('__BRIDGE_TEMP_AIM_TARGET__', None)",
    "        scene.collection.objects.link(aim_obj)",
    "        aim_obj.location = Vector(cfg['aim_target'])",
    "        aim_constraint = aim_bone.constraints.new('DAMPED_TRACK')",
    "        aim_constraint.name = '__BRIDGE_TEMP_AIM__'",
    "        aim_constraint.target = aim_obj",
    "        aim_constraint.track_axis = 'TRACK_Y'",
    "        aim_constraint.influence = 1.0",
    "        bpy.context.view_layer.update()",
    "        aimed_matrix = aim_bone.matrix.copy()",
    "        aim_bone.constraints.remove(aim_constraint)",
    "        aim_constraint = None",
    "        bpy.data.objects.remove(aim_obj, do_unlink=True)",
    "        aim_obj = None",
    "        bpy.context.view_layer.update()",
    "        aim_bone.rotation_mode = 'QUATERNION'",
    "        aim_bone.matrix = aimed_matrix",
    "        bpy.context.view_layer.update()",
    "        aim_bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=aim_bone.name)",
    "    curves = []",
    "    if hasattr(action, 'layers'):",
    "        for layer in action.layers:",
    "            for strip in layer.strips:",
    "                if hasattr(strip, 'channelbags'):",
    "                    for channelbag in strip.channelbags: curves.extend(list(channelbag.fcurves))",
    "    elif hasattr(action, 'fcurves'):",
    "        curves = list(action.fcurves)",
    "    touched_keys = 0",
    "    for curve in curves:",
    "        for key in curve.keyframe_points:",
    "            if abs(float(key.co.x) - frame) < 1e-5:",
    "                key.interpolation = 'BEZIER'",
    "                if hasattr(key, 'handle_left_type'): key.handle_left_type = 'AUTO_CLAMPED'",
    "                if hasattr(key, 'handle_right_type'): key.handle_right_type = 'AUTO_CLAMPED'",
    "                touched_keys += 1",
    "    scene.frame_set(frame)",
    "    bpy.context.view_layer.update()",
    "    actual = rig.matrix_world @ end.tail",
    "    actual_error = float((actual - effective).length)",
    "    if cfg['save_blend']:",
    "        if not bpy.data.filepath: raise RuntimeError('Cannot save an unnamed .blend')",
    "        bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)",
    "    result = {'armature': rig.name, 'action': action.name, 'frame': frame, 'end_bone': end.name, 'chain': [pb.name for pb in reversed(chain)], 'requested_target': [round(float(v), 6) for v in requested], 'effective_target': [round(float(v), 6) for v in effective], 'actual_endpoint': [round(float(v), 6) for v in actual], 'max_reach': round(max_reach, 6), 'allowed_reach': round(allowed_reach, 6), 'requested_distance': round(requested_distance, 6), 'reach_ratio': round(requested_distance / max_reach, 6) if max_reach > 1e-9 else None, 'clamped': clamped, 'actual_error': round(actual_error, 6), 'aim_bone': cfg['aim_bone'], 'aim_target': cfg['aim_target'], 'keyframes_touched': touched_keys, 'saved': bool(cfg['save_blend']), 'blender_version': bpy.app.version_string}",
    "finally:",
    "    if ik is not None and end and ik in end.constraints: end.constraints.remove(ik)",
    "    if target_obj is not None and target_obj.name in bpy.data.objects: bpy.data.objects.remove(target_obj, do_unlink=True)",
    "    if aim_constraint is not None and cfg['aim_bone'] and rig.pose.bones.get(cfg['aim_bone']) and aim_constraint in rig.pose.bones[cfg['aim_bone']].constraints: rig.pose.bones[cfg['aim_bone']].constraints.remove(aim_constraint)",
    "    if aim_obj is not None and aim_obj.name in bpy.data.objects: bpy.data.objects.remove(aim_obj, do_unlink=True)",
  ].join("\n");
  const execution = await sendBlenderCommand("execute_code", { code }, { port: args.port, timeoutMs: args.timeoutMs });
  const payload = execution && typeof execution === "object" ? execution as Record<string, unknown> : null;
  const result = payload?.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : null;
  if (!result || typeof result.end_bone !== "string") throw new Error("Blender did not return a valid IK keyframe result");
  return result;
}

async function createFocusReview(args: {
  outputDir: string;
  filePrefix?: string;
  focusMode: "auto" | "selection" | "active-object" | "cursor";
  maxSize: number;
  contextScale: number;
  zoomScale: number;
  includePreview: boolean;
  overwrite: boolean;
  port: number;
  timeoutMs: number;
}) {
  const outputDir = resolveToolPath(args.outputDir, { access: "write" });
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = bridgeIntegrationPath("create_focus_review.py");
  await ensureFile(scriptPath, "Blender focus-review script");

  const filePrefix = args.filePrefix?.trim()
    || `blender-focus-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")}`;
  const config = {
    output_dir: outputDir,
    file_prefix: filePrefix,
    focus_mode: args.focusMode,
    max_size: args.maxSize,
    context_scale: args.contextScale,
    zoom_scale: args.zoomScale,
    overwrite: args.overwrite,
  };
  const encodedConfig = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  const code = [
    "import base64, json, runpy",
    `config = json.loads(base64.b64decode(${JSON.stringify(encodedConfig)}).decode('utf-8'))`,
    `result = runpy.run_path(${JSON.stringify(scriptPath)})['create_focus_review'](config)`,
  ].join("\n");

  const commandResult = await sendBlenderCommand(
    "execute_code",
    { code },
    { port: args.port, timeoutMs: args.timeoutMs },
  );
  const commandObject = commandResult && typeof commandResult === "object"
    ? commandResult as Record<string, unknown>
    : null;
  const focusReview = commandObject?.result && typeof commandObject.result === "object"
    ? commandObject.result as Record<string, unknown>
    : null;
  if (!focusReview || focusReview.stage !== "focus_review_created") {
    throw new Error("Blender did not return a valid focus-review package");
  }

  const manifest = focusReview.manifest && typeof focusReview.manifest === "object"
    ? focusReview.manifest as Record<string, unknown>
    : null;
  const manifestPath = typeof manifest?.path === "string" ? manifest.path : null;
  if (!manifestPath) throw new Error("Focus review did not return a manifest path");
  await ensureFile(manifestPath, "Blender focus-review manifest");

  const captures = focusReview.captures && typeof focusReview.captures === "object"
    ? focusReview.captures as Record<string, unknown>
    : {};
  const previews: Array<Record<string, unknown>> = [];
  const imageAttachments: Array<Record<string, unknown>> = [];
  let attachedBytes = 0;

  for (const role of ["general", "context", "zoom"] as const) {
    const capture = captures[role] && typeof captures[role] === "object"
      ? captures[role] as Record<string, unknown>
      : null;
    const capturePath = typeof capture?.path === "string" ? capture.path : null;
    if (!capturePath) throw new Error(`Focus review did not return the ${role} capture path`);
    await ensureFile(capturePath, `Blender focus-review ${role} image`);
    const stat = await fs.stat(capturePath);
    const expectedSha256 = typeof capture?.sha256 === "string" ? capture.sha256 : null;
    const item: Record<string, unknown> = {
      role,
      path: capturePath,
      mimeType: "image/png",
      bytes: stat.size,
      sha256: expectedSha256,
      attachedToToolResult: false,
    };

    if (args.includePreview && attachedBytes + stat.size <= MAX_FOCUS_PREVIEW_TOTAL_BYTES) {
      const data = await fs.readFile(capturePath);
      const actualSha256 = sha256(data);
      if (expectedSha256 && actualSha256 !== expectedSha256) {
        throw new Error(`Focus-review ${role} image hash mismatch`);
      }
      attachedBytes += data.length;
      item.sha256 = actualSha256;
      item.attachedToToolResult = true;
      imageAttachments.push({ type: "image", mimeType: "image/png", data: data.toString("base64") });
    } else if (args.includePreview) {
      item.warning = `Preview attachment budget exceeded ${MAX_FOCUS_PREVIEW_TOTAL_BYTES} bytes`;
    }
    previews.push(item);
  }

  return {
    focusReview,
    previews,
    __bridgeImages: imageAttachments,
  };
}

export const blenderToolModule: BridgeToolModule = {
  name: "blender",
  tools: [
    {
      name: "blender_status",
      description: "Inspect Blender installation, live target identity, exact .blend path, PID/port ownership, dirty/save state, disk modification time, recent human-or-external activity, and other Blender processes. Use operationMode=reference-only when Mauro is modeling and the agent must generate references without focusing or touching Blender.",
      inputSchema: {
        type: "object",
        properties: {
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          expectedBlendFile: { type: "string", description: "Optional exact .blend path used to detect target drift." },
          operationMode: { type: "string", enum: ["reference-only", "inspect", "scene-write", "foreground-capture"], default: "inspect" },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
    },
    {
      name: "blender_open",
      description: "Launch Blender with the Mauro local bridge enabled. Optionally open a .blend file inside allowed roots.",
      inputSchema: {
        type: "object",
        properties: {
          blendFile: { type: "string" },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "blender_scene_info",
      description: "Inspect the exact connected Blender scene after verifying that expectedBlendFile matches the live target. expectedBlendFile is required as one non-empty plain-string .blend path; obtain the current path from blender_status when uncertain rather than passing null, an object, or guessing. Returns objects, geometry totals, runtime identity, dirty/save state, and recent activity evidence.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string", minLength: 1, description: "Required exact .blend path as a non-empty plain string. Use blender_status first when the current live file is unknown." },
          objectLimit: { type: "number", default: 100, minimum: 1, maximum: 1000 },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
        },
        required: ["expectedBlendFile"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_activity_trace",
      description: "Control or read Mauro's bounded in-memory semantic Blender activity trace for teaching/debugging while he models. Captures observed Blender operators with safe numeric/bool/enum properties, configured shortcut candidates, mode/tool/selection/object transforms, Edit Mesh selected vertices/topology and viewport state changes. It never captures raw keystrokes, typed text, passwords, or OS-global input. expectedBlendFile must exactly match the connected .blend.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string", minLength: 1 },
          action: { type: "string", enum: ["status", "start", "stop", "read", "clear"], default: "read" },
          limit: { type: "number", default: 100, minimum: 1, maximum: 500 },
          sinceSequence: { type: "number", minimum: 0 },
          clearOnStart: { type: "boolean", default: false },
          port: { type: "number", default: STANDALONE_BLENDER_MCP_PORT, minimum: 1024, maximum: 65535 },
        },
        required: ["expectedBlendFile"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      metadata: {
        role: "provider-proxy",
        family: "blender",
        lifecycle: "experimental",
        usage: { prerequisites: ["The standalone Mauro Blender add-on must be loaded with activity_trace support."], preflightTools: ["blender_status"] },
        mssrLifecycle: { effect: "inspect", scale: "trivial" },
      },
    },
    {
      name: "blender_rig_inspect",
      description: "Inspect one armature in the exact connected .blend without mutating it. Returns bone hierarchy/rest coordinates, pose rotation modes, constraints, active action/NLA state, and Blender-4/5-compatible action F-Curve/keyframe summaries so an agent can animate without guessing rig names or versioned Action APIs.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string", minLength: 1 },
          armatureName: { type: "string", description: "Optional armature object name. Required when the scene contains multiple armatures." },
          boneLimit: { type: "number", default: 300, minimum: 1, maximum: 1000 },
          includeActions: { type: "boolean", default: true },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 30000, minimum: 1000, maximum: 120000 },
        },
        required: ["expectedBlendFile"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_ik_keyframe",
      description: "Keyframe an existing armature chain toward a world-space target at one frame using temporary Blender IK, then bake the solved rotations into the real action and remove all temporary constraints/targets. Reports chain reach, optional reach clamping, actual endpoint error, and can optionally aim one bone at a second target. Use after rig inspection when direct FK rotation would require guessing local axes.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string", minLength: 1 },
          armatureName: { type: "string", minLength: 1 },
          actionName: { type: "string", minLength: 1 },
          endBone: { type: "string", minLength: 1 },
          target: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          frame: { type: "number" },
          chainLength: { type: "number", default: 2, minimum: 1, maximum: 8 },
          clampToReach: { type: "boolean", default: true },
          reachMargin: { type: "number", default: 0.98, minimum: 0.5, maximum: 1 },
          aimBone: { type: "string", minLength: 1 },
          aimTarget: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          saveBlend: { type: "boolean", default: false },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 30000, minimum: 1000, maximum: 120000 },
        },
        required: ["expectedBlendFile", "armatureName", "endBone", "target", "frame"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_viewport_screenshot",
      description: "Capture the exact connected Blender 3D viewport only after expectedBlendFile, PID and port match and no recent human-or-external activity is detected. This operation must temporarily focus Blender; never use it while Mauro is modeling or in reference-only mode, and confirm semantic correctness by reviewing the saved pixels.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string" },
          outputPath: { type: "string" },
          maxSize: { type: "number", default: 1200, minimum: 200, maximum: 4096 },
          settleMs: { type: "number", default: 650, minimum: 100, maximum: 5000 },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
        },
        required: ["expectedBlendFile", "outputPath"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_focus_review",
      description: "Capture Mauro's exact current viewport plus focused context and close detail only after expectedBlendFile matches and recent activity guards allow foreground control. This changes viewport framing and focuses Blender temporarily; never use it in reference-only mode or while Mauro is actively modeling.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string" },
          outputDir: { type: "string", description: "Allowed directory where the three PNGs and focus manifest will be written." },
          filePrefix: { type: "string", description: "Optional stable prefix. When omitted, a timestamped prefix is generated." },
          focusMode: { type: "string", enum: ["auto", "selection", "active-object", "cursor"], default: "auto" },
          maxSize: { type: "number", default: 1200, minimum: 200, maximum: 4096 },
          contextScale: { type: "number", default: 1, minimum: 0.25, maximum: 4 },
          zoomScale: { type: "number", default: 1, minimum: 0.25, maximum: 4 },
          includePreview: { type: "boolean", default: true },
          overwrite: { type: "boolean", default: false },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 180000, minimum: 1000, maximum: 600000 },
        },
        required: ["expectedBlendFile", "outputDir"],
        additionalProperties: false,
      },
    },

    {
      name: "blender_review_bundle",
      description: "Create a multi-view review package from the exact expected .blend after session guards confirm target identity and no recent human-or-external editing. The helper restores scene state, but it must not run while Mauro is actively modeling.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string" },
          outputDir: { type: "string", description: "Allowed directory where review images and the JSON manifest will be written." },
          filePrefix: { type: "string", description: "Optional stable prefix. When omitted, a timestamped prefix is generated." },
          views: {
            type: "array",
            items: { type: "string", enum: [...REVIEW_VIEW_NAMES] },
            default: ["front", "right", "back", "three-quarter"],
            minItems: 1,
            maxItems: 8,
          },
          targetCollections: { type: "array", items: { type: "string" }, default: [], maxItems: 20 },
          targetObjects: { type: "array", items: { type: "string" }, default: [], maxItems: 200 },
          resolution: { type: "number", default: 800, minimum: 320, maximum: 2048 },
          margin: { type: "number", default: 1.18, minimum: 1.01, maximum: 2 },
          transparentBackground: { type: "boolean", default: false },
          createContactSheet: { type: "boolean", default: true },
          includePreview: { type: "boolean", default: true },
          overwrite: { type: "boolean", default: false },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 300000, minimum: 1000, maximum: 600000 },
        },
        required: ["expectedBlendFile", "outputDir"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_animation_review",
      description: "Render the same exact Blender animation at selected frames from one fixed orthographic camera, write per-frame PNGs plus a contact sheet and JSON manifest, then restore frame/camera/render/visibility state. Use this to judge pose progression, arcs and continuity without camera reframing hiding motion. Returned images stay on disk; inspect them with image_file_attach rather than encoded image payloads.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string", minLength: 1 },
          outputDir: { type: "string", description: "Allowed directory for frame renders, contact sheet and manifest." },
          filePrefix: { type: "string", description: "Optional stable prefix; timestamped when omitted." },
          frames: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 24 },
          view: { type: "string", enum: [...REVIEW_VIEW_NAMES], default: "three-quarter" },
          targetCollections: { type: "array", items: { type: "string" }, default: [], maxItems: 20 },
          targetObjects: { type: "array", items: { type: "string" }, default: [], maxItems: 200 },
          resolution: { type: "number", default: 640, minimum: 320, maximum: 1600 },
          margin: { type: "number", default: 1.18, minimum: 1.01, maximum: 2 },
          transparentBackground: { type: "boolean", default: false },
          createContactSheet: { type: "boolean", default: true },
          overwrite: { type: "boolean", default: false },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 300000, minimum: 1000, maximum: 600000 },
        },
        required: ["expectedBlendFile", "outputDir", "frames"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_execute_code",
      description: "Execute bounded Python in the exact connected .blend. operationMode=inspect is read-only by contract; operationMode=scene-write requires exact target identity and blocks recent human-or-external activity unless explicitly overridden.",
      inputSchema: {
        type: "object",
        properties: {
          expectedBlendFile: { type: "string" },
          code: { type: "string", maxLength: MAX_CODE_CHARS },
          operationMode: { type: "string", enum: ["inspect", "scene-write"], default: "inspect" },
          recentActivityWindowSeconds: { type: "number", default: 15, minimum: 0, maximum: 3600 },
          allowRecentHumanActivity: { type: "boolean", default: false },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: DEFAULT_SOCKET_TIMEOUT_MS, minimum: 1000, maximum: 600000 },
        },
        required: ["expectedBlendFile", "code"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_batch_script",
      description: "Run an allowed Python script through Blender in background mode, optionally against an allowed .blend file.",
      inputSchema: {
        type: "object",
        properties: {
          scriptPath: { type: "string" },
          blendFile: { type: "string" },
          scriptArgs: { type: "array", items: { type: "string" }, default: [] },
          cwd: { type: "string" },
          timeoutMs: { type: "number", default: 180000, minimum: 1000, maximum: 600000 },
        },
        required: ["scriptPath"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_validate_reference_pack",
      description: "Read and validate a prepared Blender reference-pack manifest without changing Blender or disk. Verifies canonical roles, semantic-QA state, cardinal orthographic construction views, image signatures, dimensions, hashes, shared construction canvas, duplicate cardinal images, required roles, and manifest warnings.",
      inputSchema: {
        type: "object",
        properties: {
          manifestPath: { type: "string" },
          requiredRoles: { type: "array", items: { type: "string", enum: [...REFERENCE_PACK_ROLES] }, default: ["front"], maxItems: 10 },
          requireSemanticQa: { type: "boolean", default: true },
          strictWarnings: { type: "boolean", default: false },
        },
        required: ["manifestPath"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_install_reference_pack",
      description: "Validate and install a prepared reference pack into a new Blender working scene. Axis-aligned construction views share origin planes, use opposite-side visibility, orthographic-only display, depth behind geometry, locked selection, and no render; perspective design masters remain separate and hidden by default.",
      inputSchema: {
        type: "object",
        properties: {
          manifestPath: { type: "string" },
          outputBlend: { type: "string" },
          layout: { type: "string", enum: ["axis_aligned", "surround"], default: "axis_aligned" },
          displaySize: { type: "number", default: 2, minimum: 0.1, maximum: 100 },
          opacity: { type: "number", default: 0.45, minimum: 0.05, maximum: 1 },
          requiredRoles: { type: "array", items: { type: "string", enum: [...REFERENCE_PACK_ROLES] }, default: ["front"], maxItems: 10 },
          requireSemanticQa: { type: "boolean", default: true },
          strictWarnings: { type: "boolean", default: false },
          overwrite: { type: "boolean", default: false },
          openAfter: { type: "boolean", default: true },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 240000, minimum: 1000, maximum: 600000 },
        },
        required: ["manifestPath", "outputBlend"],
        additionalProperties: false,
      },
    },

    {
      name: "blender_setup_character_references",
      description: "Atomically validate four character views, create a resumable Blender reference scene, save its manifest, open Blender, and verify the local connection.",
      inputSchema: {
        type: "object",
        properties: {
          characterName: { type: "string" },
          frontImage: { type: "string" },
          sideImage: { type: "string" },
          backImage: { type: "string" },
          threeQuarterImage: { type: "string" },
          outputBlend: { type: "string" },
          height: { type: "number", default: 6, minimum: 0.5, maximum: 50 },
          opacity: { type: "number", default: 0.55, minimum: 0.05, maximum: 1 },
          overwrite: { type: "boolean", default: false },
          openAfter: { type: "boolean", default: true },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65515 },
        },
        required: ["characterName", "frontImage", "sideImage", "backImage", "threeQuarterImage", "outputBlend"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_character_loop_status",
      description: "Read a character-reference loop manifest and report exactly which stage and files are complete or missing.",
      inputSchema: {
        type: "object",
        properties: { manifestPath: { type: "string" } },
        required: ["manifestPath"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    blender_status: async (raw) => {
      const parsed = z.object({
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        expectedBlendFile: z.string().optional(),
        operationMode: z.enum(["reference-only", "inspect", "scene-write", "foreground-capture"]).default("inspect"),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
      }).parse(raw);
      return await blenderStatus(parsed);
    },
    blender_open: async (raw) => {
      const parsed = z.object({
        blendFile: z.string().optional(),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
      }).parse(raw);
      return await openBlender(parsed.blendFile, parsed.port);
    },
    blender_scene_info: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string().min(1),
        objectLimit: z.number().int().min(1).max(1000).default(100),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
      }).parse(raw);
      const session = await assertBlenderSession({ port: parsed.port, expectedBlendFile: parsed.expectedBlendFile, operationMode: "inspect" });
      const sceneInfo = await sendBlenderCommand("get_scene_info", { object_limit: parsed.objectLimit }, { port: parsed.port });
      return { session: session.verdict, sceneInfo };
    },
    blender_activity_trace: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string().min(1),
        action: z.enum(["status", "start", "stop", "read", "clear"]).default("read"),
        limit: z.number().int().min(1).max(500).default(100),
        sinceSequence: z.number().int().min(0).optional(),
        clearOnStart: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(STANDALONE_BLENDER_MCP_PORT),
      }).parse(raw);
      const session = await assertBlenderSession({ port: parsed.port, expectedBlendFile: parsed.expectedBlendFile, operationMode: "inspect" });
      const trace = await sendBlenderCommand("activity_trace", {
        action: parsed.action,
        limit: parsed.limit,
        since_sequence: parsed.sinceSequence ?? null,
        clear: parsed.clearOnStart,
      }, { port: parsed.port });
      return { session: session.verdict, trace };
    },
    blender_rig_inspect: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string().min(1),
        armatureName: z.string().min(1).max(180).optional(),
        boneLimit: z.number().int().min(1).max(1000).default(300),
        includeActions: z.boolean().default(true),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(30000),
      }).parse(raw);
      const session = await assertBlenderSession({ port: parsed.port, expectedBlendFile: parsed.expectedBlendFile, operationMode: "inspect" });
      const rig = await inspectBlenderRig(parsed);
      return { session: session.verdict, rig };
    },
    blender_ik_keyframe: async (raw) => {
      const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
      const parsed = z.object({
        expectedBlendFile: z.string().min(1),
        armatureName: z.string().min(1).max(180),
        actionName: z.string().min(1).max(180).optional(),
        endBone: z.string().min(1).max(180),
        target: vector3,
        frame: z.number().int(),
        chainLength: z.number().int().min(1).max(8).default(2),
        clampToReach: z.boolean().default(true),
        reachMargin: z.number().min(0.5).max(1).default(0.98),
        aimBone: z.string().min(1).max(180).optional(),
        aimTarget: vector3.optional(),
        saveBlend: z.boolean().default(false),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(120000).default(30000),
      }).superRefine((value, ctx) => {
        if (Boolean(value.aimBone) !== Boolean(value.aimTarget)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "aimBone and aimTarget must be provided together", path: [value.aimBone ? "aimTarget" : "aimBone"] });
        }
      }).parse(raw);
      const session = await assertBlenderSession({
        port: parsed.port,
        expectedBlendFile: parsed.expectedBlendFile,
        operationMode: "scene-write",
        recentActivityWindowSeconds: parsed.recentActivityWindowSeconds,
        allowRecentHumanActivity: parsed.allowRecentHumanActivity,
      });
      const ik = await keyframeBlenderIk(parsed);
      return { session: session.verdict, ik };
    },
    blender_viewport_screenshot: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string(),
        outputPath: z.string(),
        maxSize: z.number().int().min(200).max(4096).default(1200),
        settleMs: z.number().int().min(100).max(5000).default(650),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
      }).parse(raw);
      const session = await assertBlenderSession({
        port: parsed.port,
        expectedBlendFile: parsed.expectedBlendFile,
        operationMode: "foreground-capture",
        recentActivityWindowSeconds: parsed.recentActivityWindowSeconds,
        allowRecentHumanActivity: parsed.allowRecentHumanActivity,
      });
      const outputPath = resolveToolPath(parsed.outputPath, { access: "write" });
      if (path.extname(outputPath).toLowerCase() !== ".png") throw new Error("outputPath must use the .png extension");
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      const captureContext = z.object({
        pid: z.number().int().positive(),
        file: z.string().nullable().optional(),
        region: z.object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          width: z.number().int().min(64),
          height: z.number().int().min(64),
        }),
        viewport: z.object({
          perspective: z.string(),
          rotation: z.array(z.number()).length(4),
          location: z.array(z.number()).length(3),
          distance: z.number(),
        }),
        capture_contract: z.object({
          backend: z.literal("exact-window-client-region"),
          requires_foreground: z.literal(true),
          freshness: z.string(),
        }),
      }).passthrough().parse(
        await sendBlenderCommand("get_viewport_capture_context", {}, { port: parsed.port }),
      );

      const scriptPath = path.resolve(process.cwd(), "scripts", "blender-viewport-window-capture.ps1");
      await ensureFile(scriptPath, "Blender viewport window-capture script");
      const commandResult = await runProcess(
        "powershell.exe",
        [
          "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
          "-TargetProcessId", String(captureContext.pid),
          "-OutputPath", outputPath,
          "-ViewportX", String(captureContext.region.x),
          "-ViewportY", String(captureContext.region.y),
          "-ViewportWidth", String(captureContext.region.width),
          "-ViewportHeight", String(captureContext.region.height),
          "-SettleMs", String(parsed.settleMs),
          "-MaxSize", String(parsed.maxSize),
        ],
        process.cwd(),
        Math.max(15_000, parsed.settleMs + 10_000),
      );
      if (commandResult.code !== 0 || commandResult.timedOut === true) {
        throw new Error(`Blender viewport window capture failed: ${String(commandResult.stderr || commandResult.stdout || commandResult.error || "unknown error")}`);
      }
      const jsonLine = String(commandResult.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (!jsonLine) throw new Error("Blender viewport window capture returned no JSON evidence");
      let captureEvidence: unknown;
      try {
        captureEvidence = JSON.parse(jsonLine);
      } catch (error) {
        throw new Error(`Blender viewport window capture returned invalid JSON: ${String(error)}`);
      }
      const stat = await fs.stat(outputPath);
      return {
        session: session.verdict,
        outputPath,
        bytes: stat.size,
        settleMs: parsed.settleMs,
        maxSize: parsed.maxSize,
        viewport: captureContext.viewport,
        captureContract: captureContext.capture_contract,
        captureEvidence,
      };
    },
    blender_focus_review: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string(),
        outputDir: z.string(),
        filePrefix: z.string().min(1).max(96).optional(),
        focusMode: z.enum(["auto", "selection", "active-object", "cursor"]).default("auto"),
        maxSize: z.number().int().min(200).max(4096).default(1200),
        contextScale: z.number().min(0.25).max(4).default(1),
        zoomScale: z.number().min(0.25).max(4).default(1),
        includePreview: z.boolean().default(true),
        overwrite: z.boolean().default(false),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(DEFAULT_SOCKET_TIMEOUT_MS),
      }).parse(raw);
      const session = await assertBlenderSession({
        port: parsed.port,
        expectedBlendFile: parsed.expectedBlendFile,
        operationMode: "foreground-capture",
        recentActivityWindowSeconds: parsed.recentActivityWindowSeconds,
        allowRecentHumanActivity: parsed.allowRecentHumanActivity,
      });
      const review = await createFocusReview(parsed);
      return { session: session.verdict, ...review };
    },

    blender_review_bundle: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string(),
        outputDir: z.string(),
        filePrefix: z.string().min(1).max(96).optional(),
        views: z.array(z.enum(REVIEW_VIEW_NAMES)).min(1).max(8).default(["front", "right", "back", "three-quarter"]),
        targetCollections: z.array(z.string().min(1).max(180)).max(20).default([]),
        targetObjects: z.array(z.string().min(1).max(180)).max(200).default([]),
        resolution: z.number().int().min(320).max(2048).default(800),
        margin: z.number().min(1.01).max(2).default(1.18),
        transparentBackground: z.boolean().default(false),
        createContactSheet: z.boolean().default(true),
        includePreview: z.boolean().default(true),
        overwrite: z.boolean().default(false),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(300000),
      }).parse(raw);
      if (new Set(parsed.views).size !== parsed.views.length) throw new Error("views must not contain duplicates");
      const session = await assertBlenderSession({
        port: parsed.port,
        expectedBlendFile: parsed.expectedBlendFile,
        operationMode: "scene-write",
        recentActivityWindowSeconds: parsed.recentActivityWindowSeconds,
        allowRecentHumanActivity: parsed.allowRecentHumanActivity,
      });
      const review = await createReviewBundle(parsed);
      return { session: session.verdict, ...review };
    },
    blender_animation_review: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string().min(1),
        outputDir: z.string().min(1),
        filePrefix: z.string().min(1).max(96).optional(),
        frames: z.array(z.number().int()).min(1).max(24),
        view: z.enum(REVIEW_VIEW_NAMES).default("three-quarter"),
        targetCollections: z.array(z.string().min(1).max(180)).max(20).default([]),
        targetObjects: z.array(z.string().min(1).max(180)).max(200).default([]),
        resolution: z.number().int().min(320).max(1600).default(640),
        margin: z.number().min(1.01).max(2).default(1.18),
        transparentBackground: z.boolean().default(false),
        createContactSheet: z.boolean().default(true),
        overwrite: z.boolean().default(false),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(300000),
      }).parse(raw);
      if (new Set(parsed.frames).size !== parsed.frames.length) throw new Error("frames must not contain duplicates");
      const session = await assertBlenderSession({
        port: parsed.port,
        expectedBlendFile: parsed.expectedBlendFile,
        operationMode: "scene-write",
        recentActivityWindowSeconds: parsed.recentActivityWindowSeconds,
        allowRecentHumanActivity: parsed.allowRecentHumanActivity,
      });
      const review = await createAnimationReview(parsed);
      return { session: session.verdict, ...review };
    },
    blender_execute_code: async (raw) => {
      const parsed = z.object({
        expectedBlendFile: z.string(),
        code: z.string().min(1).max(MAX_CODE_CHARS),
        operationMode: z.enum(["inspect", "scene-write"]).default("inspect"),
        recentActivityWindowSeconds: z.number().int().min(0).max(3600).default(15),
        allowRecentHumanActivity: z.boolean().default(false),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(DEFAULT_SOCKET_TIMEOUT_MS),
      }).parse(raw);
      const session = await assertBlenderSession({
        port: parsed.port,
        expectedBlendFile: parsed.expectedBlendFile,
        operationMode: parsed.operationMode,
        recentActivityWindowSeconds: parsed.recentActivityWindowSeconds,
        allowRecentHumanActivity: parsed.allowRecentHumanActivity,
      });
      const execution = await sendBlenderCommand("execute_code", { code: parsed.code }, { port: parsed.port, timeoutMs: parsed.timeoutMs });
      const payload = execution && typeof execution === "object" ? execution as Record<string, unknown> : { result: execution };
      return { session: session.verdict, ...payload };
    },
    blender_batch_script: async (raw) => {
      const parsed = z.object({
        scriptPath: z.string(),
        blendFile: z.string().optional(),
        scriptArgs: z.array(z.string()).max(100).default([]),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(600000).default(180000),
      }).parse(raw);
      return await batchScript(parsed);
    },
    blender_validate_reference_pack: async (raw) => {
      const parsed = z.object({
        manifestPath: z.string(),
        requiredRoles: z.array(z.enum(REFERENCE_PACK_ROLES)).max(10).default(["front"]),
        requireSemanticQa: z.boolean().default(true),
        strictWarnings: z.boolean().default(false),
      }).parse(raw);
      if (new Set(parsed.requiredRoles).size !== parsed.requiredRoles.length) throw new Error("requiredRoles must not contain duplicates");
      return await validateReferencePack(parsed);
    },
    blender_install_reference_pack: async (raw) => {
      const parsed = z.object({
        manifestPath: z.string(),
        outputBlend: z.string(),
        layout: z.enum(["axis_aligned", "surround"]).default("axis_aligned"),
        displaySize: z.number().min(0.1).max(100).default(2),
        opacity: z.number().min(0.05).max(1).default(0.45),
        requiredRoles: z.array(z.enum(REFERENCE_PACK_ROLES)).max(10).default(["front"]),
        requireSemanticQa: z.boolean().default(true),
        strictWarnings: z.boolean().default(false),
        overwrite: z.boolean().default(false),
        openAfter: z.boolean().default(true),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(240000),
      }).parse(raw);
      if (new Set(parsed.requiredRoles).size !== parsed.requiredRoles.length) throw new Error("requiredRoles must not contain duplicates");
      return await installReferencePack(parsed);
    },

    blender_setup_character_references: async (raw) => {
      const parsed = z.object({
        characterName: z.string().min(1).max(120),
        frontImage: z.string(),
        sideImage: z.string(),
        backImage: z.string(),
        threeQuarterImage: z.string(),
        outputBlend: z.string(),
        height: z.number().min(0.5).max(50).default(6),
        opacity: z.number().min(0.05).max(1).default(0.55),
        overwrite: z.boolean().default(false),
        openAfter: z.boolean().default(true),
        port: z.number().int().min(1024).max(65515).default(DEFAULT_BLENDER_PORT),
      }).parse(raw);
      return await setupCharacterReferences(parsed);
    },
    blender_character_loop_status: async (raw) => {
      const parsed = z.object({ manifestPath: z.string() }).parse(raw);
      return await characterLoopStatus(parsed.manifestPath);
    },
  },
};
