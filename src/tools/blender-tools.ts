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
const DEFAULT_SOCKET_TIMEOUT_MS = 180_000;
const MAX_SOCKET_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_CODE_CHARS = 100_000;
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_BASE64_CHARS = 12 * 1024 * 1024;
const MAX_REVIEW_PREVIEW_BYTES = 4 * 1024 * 1024;
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

async function storeReferenceImage(args: { outputPath: string; base64: string; overwrite: boolean }) {
  const outputPath = resolveToolPath(args.outputPath, { access: "write" });
  const extension = path.extname(outputPath).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    throw new Error("Reference images must use .jpg, .jpeg, .png, or .webp");
  }
  if (!args.overwrite && await pathExists(outputPath)) throw new Error(`Reference image already exists: ${outputPath}`);

  const raw = args.base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
  if (raw.length === 0 || raw.length > MAX_REFERENCE_BASE64_CHARS) throw new Error("Reference image base64 payload is empty or too large");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length === 0 || buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error("Decoded reference image is empty or too large");
  validateReferenceImage(buffer, extension);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  return { outputPath, bytes: buffer.length, sha256: sha256(buffer), extension };
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
  try {
    const ping = await sendBlenderCommand("ping", {}, { port, timeoutMs: 1_000 });
    return { launched: false, alreadyConnected: true, port, ping };
  } catch {
    return await launchBlenderInstance(blendFile, port);
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

  return await runProcess(executable, processArgs, cwd, args.timeoutMs);
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
  const images = {
    front: resolveToolPath(args.frontImage, { access: "read" }),
    side: resolveToolPath(args.sideImage, { access: "read" }),
    back: resolveToolPath(args.backImage, { access: "read" }),
    threeQuarter: resolveToolPath(args.threeQuarterImage, { access: "read" }),
  };
  for (const [role, imagePath] of Object.entries(images)) await ensureFile(imagePath, `${role} reference image`);

  const outputBlend = resolveToolPath(args.outputBlend, { access: "write" });
  if (path.extname(outputBlend).toLowerCase() !== ".blend") throw new Error("outputBlend must use the .blend extension");
  if (!args.overwrite && await pathExists(outputBlend)) throw new Error(`Blend file already exists: ${outputBlend}`);
  await fs.mkdir(path.dirname(outputBlend), { recursive: true });

  const manifestPath = outputBlend.replace(/\.blend$/i, ".loop.json");
  const scriptPath = bridgeIntegrationPath("setup_character_references.py");
  const executable = blenderExecutable();
  await ensureFile(scriptPath, "Character reference setup script");
  await ensureFile(executable, "Blender executable");

  const processArgs = [
    "--background",
    "--python", scriptPath,
    "--",
    "--character-name", args.characterName,
    "--front", images.front,
    "--side", images.side,
    "--back", images.back,
    "--three-quarter", images.threeQuarter,
    "--output-blend", outputBlend,
    "--manifest", manifestPath,
    "--height", String(args.height),
    "--opacity", String(args.opacity),
  ];
  const processResult = await runProcess(executable, processArgs, path.dirname(outputBlend), 240_000);
  const processOutput = `${processResult.stdout ?? ""}\n${processResult.stderr ?? ""}`;
  const pythonFailed = /Traceback \(most recent call last\):|Error: Python:/i.test(processOutput);
  if (processResult.code !== 0 || processResult.timedOut || pythonFailed) {
    throw new Error(`Blender reference setup failed: ${processResult.stderr || processResult.stdout || processResult.error || "unknown error"}`);
  }

  const line = String(processResult.stdout ?? "").split(/\r?\n/).find((item) => item.startsWith("CHARACTER_REFERENCE_SETUP="));
  const generated = line ? JSON.parse(line.slice("CHARACTER_REFERENCE_SETUP=".length)) : null;
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

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.stage = stage;
  manifest.updatedAt = new Date().toISOString();
  manifest.open = { requested: args.openAfter, port: actualPort, result: opened, verification };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { stage, characterName: args.characterName, images, outputBlend, manifestPath, generated, opened, verification, port: actualPort };
}

async function characterLoopStatus(manifestPathInput: string) {
  const manifestPath = resolveToolPath(manifestPathInput, { access: "read" });
  await ensureFile(manifestPath, "Character loop manifest");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const paths = [manifest.outputBlend, ...Object.values(manifest.images ?? {}).map((item: any) => item?.path)].filter(Boolean) as string[];
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
      name: "blender_review_bundle",
      description: "Create a multi-view Blender review package in one call: orthographic renders, a contact sheet, and a manifest with geometry, materials, visibility, collections, rig, animation, diagnostics, hashes, and restored-scene confirmation.",
      inputSchema: {
        type: "object",
        properties: {
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
          port: { type: "number", default: DEFAULT_BLENDER_PORT, minimum: 1024, maximum: 65535 },
          timeoutMs: { type: "number", default: 300000, minimum: 1000, maximum: 600000 },
        },
        required: ["outputDir"],
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
    {
      name: "blender_store_reference_image",
      description: "Store a generated PNG/JPEG/WebP reference image from a base64 or data-URL payload into an allowed project path.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: { type: "string" },
          base64: { type: "string", maxLength: MAX_REFERENCE_BASE64_CHARS },
          overwrite: { type: "boolean", default: false },
        },
        required: ["outputPath", "base64"],
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
    blender_review_bundle: async (raw) => {
      const parsed = z.object({
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
        port: z.number().int().min(1024).max(65535).default(DEFAULT_BLENDER_PORT),
        timeoutMs: z.number().int().min(1000).max(600000).default(300000),
      }).parse(raw);
      if (new Set(parsed.views).size !== parsed.views.length) throw new Error("views must not contain duplicates");
      return await createReviewBundle(parsed);
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
    blender_store_reference_image: async (raw) => {
      const parsed = z.object({
        outputPath: z.string(),
        base64: z.string().min(1).max(MAX_REFERENCE_BASE64_CHARS),
        overwrite: z.boolean().default(false),
      }).parse(raw);
      return await storeReferenceImage(parsed);
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
