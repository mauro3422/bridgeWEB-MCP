import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath, runProcess } from "./shared/process.js";

const DEFAULT_BLENDER_EXE = "D:\\SteamLibrary\\steamapps\\common\\Blender\\blender.exe";
const DEFAULT_BLENDER_HOST = "127.0.0.1";
const DEFAULT_BLENDER_PORT = 9877;
const DEFAULT_SOCKET_TIMEOUT_MS = 180_000;
const MAX_SOCKET_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_CODE_CHARS = 100_000;

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

async function blenderStatus(port: number) {
  const executable = blenderExecutable();
  let installed = false;
  let version: Record<string, unknown> | null = null;
  try {
    await ensureFile(executable, "Blender executable");
    installed = true;
    const processResult = await runProcess(executable, ["--version"], process.cwd(), 30_000);
    const versionLine = String(processResult.stdout ?? "")
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("Blender ")) ?? null;
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

  let connection: unknown = null;
  let connected = false;
  try {
    connection = await sendBlenderCommand("ping", {}, { port, timeoutMs: 2_500 });
    connected = true;
  } catch (error) {
    connection = { error: String(error) };
  }

  return {
    installed,
    executable,
    version,
    interactive: {
      connected,
      host: DEFAULT_BLENDER_HOST,
      port,
      connection,
      startupScript: bridgeIntegrationPath("startup.py"),
    },
  };
}

async function openBlender(blendFile: string | undefined, port: number) {
  try {
    const ping = await sendBlenderCommand("ping", {}, { port, timeoutMs: 1_000 });
    return { launched: false, alreadyConnected: true, port, ping };
  } catch {
    // Expected when Blender is not yet running with the local bridge.
  }

  const executable = blenderExecutable();
  const startupScript = bridgeIntegrationPath("startup.py");
  await ensureFile(executable, "Blender executable");
  await ensureFile(startupScript, "Blender bridge startup script");

  const args: string[] = [];
  let resolvedBlendFile: string | null = null;
  if (blendFile) {
    resolvedBlendFile = resolveToolPath(blendFile, { access: "read" });
    await ensureFile(resolvedBlendFile, "Blend file");
    if (path.extname(resolvedBlendFile).toLowerCase() !== ".blend") {
      throw new Error("blendFile must use the .blend extension");
    }
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
    note: "Blender launches asynchronously; call blender_status until interactive.connected is true.",
  };
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

  return await runProcess(executable, processArgs, cwd, args.timeoutMs);
}

export const blenderToolModule: BridgeToolModule = {
  name: "blender",
  tools: [
    {
      name: "blender_status",
      description: "Check the configured Blender installation and whether the local interactive Blender bridge is connected.",
      inputSchema: {
        type: "object",
        properties: {
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
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
      description: "Inspect objects, mesh counts, armatures, actions and totals from the connected Blender scene.",
      inputSchema: {
        type: "object",
        properties: {
          objectLimit: { type: "number", default: 100, minimum: 1, maximum: 1000 },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "blender_viewport_screenshot",
      description: "Capture the connected Blender 3D viewport to a PNG path inside allowed roots.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: { type: "string" },
          maxSize: { type: "number", default: 1200, minimum: 200, maximum: 4096 },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
        },
        required: ["outputPath"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_execute_code",
      description: "Execute bounded Python code in the connected Blender main thread and return stdout plus an optional result variable.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", maxLength: MAX_CODE_CHARS },
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: DEFAULT_SOCKET_TIMEOUT_MS, minimum: 1000, maximum: 600000 },
        },
        required: ["code"],
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
  ],
  handlers: {
    blender_status: async (raw) => {
      const parsed = z.object({ port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT) }).parse(raw);
      return await blenderStatus(parsed.port);
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
        objectLimit: z.number().int().min(1).max(1000).default(100),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
      }).parse(raw);
      return await sendBlenderCommand("get_scene_info", { object_limit: parsed.objectLimit }, { port: parsed.port });
    },
    blender_viewport_screenshot: async (raw) => {
      const parsed = z.object({
        outputPath: z.string(),
        maxSize: z.number().int().min(200).max(4096).default(1200),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
      }).parse(raw);
      const outputPath = resolveToolPath(parsed.outputPath, { access: "write" });
      if (path.extname(outputPath).toLowerCase() !== ".png") throw new Error("outputPath must use the .png extension");
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const result = await sendBlenderCommand("get_viewport_screenshot", {
        filepath: outputPath,
        max_size: parsed.maxSize,
      }, { port: parsed.port });
      const stat = await fs.stat(outputPath);
      return { result, outputPath, bytes: stat.size };
    },
    blender_execute_code: async (raw) => {
      const parsed = z.object({
        code: z.string().min(1).max(MAX_CODE_CHARS),
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(DEFAULT_SOCKET_TIMEOUT_MS),
      }).parse(raw);
      return await sendBlenderCommand("execute_code", { code: parsed.code }, { port: parsed.port, timeoutMs: parsed.timeoutMs });
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
  },
};

