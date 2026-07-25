import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callRobloxMcpTool, callRobloxMcpToolForStudio } from "../integrations/roblox-mcp-client.js";
import { resolveToolPath, runProcess, summarizeCommand } from "./shared/process.js";
import type { BridgeToolModule } from "./types.js";

type StudioInfo = { id: string; name: string; active?: boolean };

type FileSnapshot = {
  size: number;
  mtime: string;
  sha256: string;
};

function resultText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return content
    .filter((item): item is { type: string; text?: string } => Boolean(item && typeof item === "object" && "type" in item))
    .map((item) => item.type === "text" ? String(item.text ?? "") : "")
    .filter(Boolean)
    .join("\n");
}

function resultIsError(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { isError?: unknown }).isError === true);
}

type RobloxImagePayload = { data: string; mimeType: string };

export function extractRobloxMcpImage(value: unknown): RobloxImagePayload | null {
  const visited = new WeakSet<object>();
  const visit = (current: unknown): RobloxImagePayload | null => {
    if (!current || typeof current !== "object") return null;
    if (visited.has(current)) return null;
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (record.type === "image" && typeof record.data === "string") {
      const mimeType = typeof record.mimeType === "string"
        ? record.mimeType
        : typeof record.mime_type === "string"
          ? record.mime_type
          : "image/png";
      return { data: record.data, mimeType };
    }
    if (Array.isArray(current)) {
      for (const child of current) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    for (const child of Object.values(record)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(value);
}

async function pathExists(filePath: string): Promise<boolean> {
  return await fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
}

async function saveRobloxCaptureImage(outputPath: string, image: RobloxImagePayload, overwrite: boolean): Promise<FileSnapshot> {
  if (!overwrite && await pathExists(outputPath)) throw new Error(`Capture file already exists: ${outputPath}`);
  const rawBase64 = image.data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
  const bytes = Buffer.from(rawBase64, "base64");
  if (bytes.length === 0) throw new Error("Roblox Studio MCP returned an empty image payload.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
    if (overwrite) await fs.rm(outputPath, { force: true });
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return await snapshot(outputPath);
}

function parseStudioList(result: unknown): StudioInfo[] {
  const text = resultText(result);
  try {
    const parsed = JSON.parse(text) as { studios?: unknown };
    if (!Array.isArray(parsed.studios)) return [];
    return parsed.studios
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({ id: String(item.id ?? ""), name: String(item.name ?? ""), active: item.active === true }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

async function snapshot(filePath: string): Promise<FileSnapshot> {
  const [bytes, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
  return {
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function changed(before: FileSnapshot, after: FileSnapshot): boolean {
  return before.size !== after.size || before.mtime !== after.mtime || before.sha256 !== after.sha256;
}

async function waitForDiskChange(filePath: string, before: FileSnapshot, timeoutMs: number): Promise<FileSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let latest = before;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    latest = await snapshot(filePath);
    if (changed(before, latest)) return latest;
  }
  return latest;
}

async function ensureActiveEditStudio(placeName: string, stopPlay: boolean) {
  const listed = await callRobloxMcpTool("list_roblox_studios", {});
  if (resultIsError(listed)) throw new Error(`Could not list Roblox Studios: ${resultText(listed)}`);
  const studios = parseStudioList(listed);
  const matches = studios.filter((studio) => studio.name.toLowerCase() === placeName.toLowerCase());
  if (matches.length === 0) {
    throw new Error(`No connected Roblox Studio instance exactly matched '${placeName}'. Connected: ${studios.map((item) => item.name).join(", ") || "none"}`);
  }
  if (matches.length > 1) throw new Error(`Multiple connected Roblox Studio instances matched '${placeName}'.`);
  const studio = matches[0];
  if (!studio.active) {
    const selected = await callRobloxMcpTool("set_active_studio", { studio_id: studio.id });
    if (resultIsError(selected)) throw new Error(`Could not activate Studio '${placeName}': ${resultText(selected)}`);
  }

  let stateResult = await callRobloxMcpTool("get_studio_state", {});
  let state = resultText(stateResult);
  if (/Current Studio Mode:\s*Play/i.test(state)) {
    if (!stopPlay) throw new Error("Roblox Studio is in Play mode. Set stopPlay=true or stop Play manually before saving.");
    const stopped = await callRobloxMcpTool("start_stop_play", { is_start: false });
    if (resultIsError(stopped)) throw new Error(`Could not stop Play mode: ${resultText(stopped)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    stateResult = await callRobloxMcpTool("get_studio_state", {});
    state = resultText(stateResult);
  }
  if (!/Current Studio Mode:\s*Edit/i.test(state)) throw new Error(`Studio did not reach Edit mode: ${state}`);
  return { studio, state };
}

export const robloxStudioToolModule: BridgeToolModule = {
  name: "roblox-studio-ops",
  tools: [
    {
      name: "roblox_studio_window_capture_save",
      description: "Capture only the visible Roblox Studio window that exactly matches an open local place, optionally position the Edit camera first through the persistent Studio MCP connection, and save a verified local PNG. Use when Studio MCP screen_capture is unavailable or hangs and the visual iteration loop still requires trustworthy evidence.",
      inputSchema: {
        type: "object",
        properties: {
          placePath: { type: "string", description: "Exact local .rbxl or .rbxlx path currently open in Studio." },
          outputPath: { type: "string", description: "Allowed local .png path to write." },
          cameraPosition: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Optional [x,y,z] Edit camera position. Must be provided together with lookAtPosition." },
          lookAtPosition: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Optional [x,y,z] Edit camera target. Must be provided together with cameraPosition." },
          cropLeft: { type: "number", default: 0, minimum: 0, maximum: 4000 },
          cropTop: { type: "number", default: 0, minimum: 0, maximum: 4000 },
          cropRight: { type: "number", default: 0, minimum: 0, maximum: 4000 },
          cropBottom: { type: "number", default: 0, minimum: 0, maximum: 4000 },
          settleMs: { type: "number", default: 650, minimum: 100, maximum: 5000 },
          overwrite: { type: "boolean", default: false, description: "Replace an existing capture file." },
        },
        required: ["placePath", "outputPath"],
        additionalProperties: false,
      },
    },
    {
      name: "roblox_screen_capture_save",
      description: "Capture the current Roblox Studio edit-time viewport through the persistent Studio MCP connection and save the image to an allowed local .png path. The image payload is consumed inside the Bridge so large base64 data is not returned through the connector. Use this for resilient visual iteration and evidence capture.",
      inputSchema: {
        type: "object",
        properties: {
          outputPath: { type: "string", description: "Allowed local .png path to write." },
          captureId: { type: "string", description: "Capture identifier forwarded to Roblox Studio MCP." },
          cameraPosition: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Optional [x,y,z] camera position. Must be provided together with lookAtPosition." },
          lookAtPosition: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Optional [x,y,z] look-at target. Must be provided together with cameraPosition." },
          studioId: { type: "string", description: "Optional explicit Studio id; required when multiple Studios are connected." },
          overwrite: { type: "boolean", default: false, description: "Replace an existing capture file." },
        },
        required: ["outputPath", "captureId"],
        additionalProperties: false,
      },
    },
    {
      name: "roblox_place_save",
      description: "Save one open local Roblox Studio .rbxl/.rbxlx place through a narrow verified Ctrl+S operation. This is not generic computer control: it requires an exact place path confirmation, matches the connected Studio and window title, forces Edit mode, focuses only that Roblox Studio window, sends only Ctrl+S, and verifies the place file timestamp/hash. Use after persistent Studio edits when disk save must be proven separately from Edit DataModel and Play verification.",
      inputSchema: {
        type: "object",
        properties: {
          placePath: { type: "string", description: "Exact local .rbxl or .rbxlx path currently open in Studio." },
          confirmPlacePath: { type: "string", description: "Must resolve to the exact same path as placePath." },
          stopPlay: { type: "boolean", default: true, description: "Stop Play and return Studio to Edit before saving." },
          verifyTimeoutMs: { type: "number", default: 5000, minimum: 1000, maximum: 20000 },
        },
        required: ["placePath", "confirmPlacePath"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    roblox_studio_window_capture_save: async (args) => {
      if (process.platform !== "win32") throw new Error("roblox_studio_window_capture_save currently supports Windows only.");
      const parsed = z.object({
        placePath: z.string().min(1),
        outputPath: z.string().min(1),
        cameraPosition: z.array(z.number().finite()).length(3).optional(),
        lookAtPosition: z.array(z.number().finite()).length(3).optional(),
        cropLeft: z.number().int().min(0).max(4000).default(0),
        cropTop: z.number().int().min(0).max(4000).default(0),
        cropRight: z.number().int().min(0).max(4000).default(0),
        cropBottom: z.number().int().min(0).max(4000).default(0),
        settleMs: z.number().int().min(100).max(5000).default(650),
        overwrite: z.boolean().default(false),
      }).parse(args);
      if (Boolean(parsed.cameraPosition) !== Boolean(parsed.lookAtPosition)) {
        throw new Error("cameraPosition and lookAtPosition must be provided together.");
      }

      const placePath = resolveToolPath(parsed.placePath, { access: "read" });
      const placeExtension = path.extname(placePath).toLowerCase();
      if (placeExtension !== ".rbxl" && placeExtension !== ".rbxlx") throw new Error("placePath must end in .rbxl or .rbxlx.");
      const placeStat = await fs.stat(placePath);
      if (!placeStat.isFile()) throw new Error(`placePath is not a file: ${placePath}`);

      const outputPath = resolveToolPath(parsed.outputPath, { access: "write" });
      if (path.extname(outputPath).toLowerCase() !== ".png") throw new Error("outputPath must use the .png extension.");
      if (!parsed.overwrite && await pathExists(outputPath)) throw new Error(`Capture file already exists: ${outputPath}`);

      const studio = await ensureActiveEditStudio(path.basename(placePath), true);
      let cameraApplied = false;
      let cameraResultText: string | null = null;
      if (parsed.cameraPosition && parsed.lookAtPosition) {
        const [px, py, pz] = parsed.cameraPosition;
        const [lx, ly, lz] = parsed.lookAtPosition;
        const code = [
          "local camera = workspace.CurrentCamera",
          "if not camera then error('Workspace.CurrentCamera is unavailable') end",
          "camera.CameraType = Enum.CameraType.Scriptable",
          `camera.CFrame = CFrame.lookAt(Vector3.new(${px}, ${py}, ${pz}), Vector3.new(${lx}, ${ly}, ${lz}))`,
          "pcall(function() game:GetService('Selection'):Set({}) end)",
          "return {ok=true, cameraPosition={camera.CFrame.Position.X,camera.CFrame.Position.Y,camera.CFrame.Position.Z}}",
        ].join("\n");
        const cameraCall = await callRobloxMcpToolForStudio("execute_luau", {
          datamodel_type: "Edit",
          code,
        }, {
          studioId: studio.studio.id,
          requireExplicitWhenMultiple: true,
        });
        if (resultIsError(cameraCall.result)) throw new Error(`Could not position the Roblox Studio camera: ${resultText(cameraCall.result)}`);
        cameraResultText = resultText(cameraCall.result);
        cameraApplied = true;
      }

      if (parsed.overwrite) await fs.rm(outputPath, { force: true });
      const scriptPath = path.resolve(process.cwd(), "scripts", "roblox-studio-window-capture.ps1");
      const commandResult = await runProcess(
        "powershell.exe",
        [
          "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
          "-PlacePath", placePath,
          "-OutputPath", outputPath,
          "-SettleMs", String(parsed.settleMs),
          "-CropLeft", String(parsed.cropLeft),
          "-CropTop", String(parsed.cropTop),
          "-CropRight", String(parsed.cropRight),
          "-CropBottom", String(parsed.cropBottom),
        ],
        process.cwd(),
        20_000,
      );
      const commandSummary = summarizeCommand(commandResult);
      if (!commandSummary.ok) {
        throw new Error(`Roblox Studio window capture failed: ${commandSummary.stderrTail || commandSummary.stdoutTail || commandSummary.error || "unknown error"}`);
      }

      const bytes = await fs.readFile(outputPath);
      const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
        throw new Error("Roblox Studio window capture did not produce a valid PNG file.");
      }
      const file = await snapshot(outputPath);
      return {
        ok: true,
        placePath,
        outputPath,
        studio: studio.studio,
        studioState: studio.state,
        cameraApplied,
        cameraResult: cameraResultText,
        crop: {
          left: parsed.cropLeft,
          top: parsed.cropTop,
          right: parsed.cropRight,
          bottom: parsed.cropBottom,
        },
        file,
        inputAction: commandSummary,
        verification: "A valid PNG was written from the exact matched Roblox Studio window and verified by signature, size, timestamp, and SHA-256.",
      };
    },
    roblox_screen_capture_save: async (args) => {
      const parsed = z.object({
        outputPath: z.string().min(1),
        captureId: z.string().min(1),
        cameraPosition: z.array(z.number()).length(3).optional(),
        lookAtPosition: z.array(z.number()).length(3).optional(),
        studioId: z.string().min(1).optional(),
        overwrite: z.boolean().default(false),
      }).parse(args);
      if (Boolean(parsed.cameraPosition) !== Boolean(parsed.lookAtPosition)) {
        throw new Error("cameraPosition and lookAtPosition must be provided together.");
      }
      const outputPath = resolveToolPath(parsed.outputPath, { access: "write" });
      if (path.extname(outputPath).toLowerCase() !== ".png") throw new Error("outputPath must use the .png extension.");
      const remoteArguments: Record<string, unknown> = { capture_id: parsed.captureId };
      if (parsed.cameraPosition && parsed.lookAtPosition) {
        remoteArguments.camera_position = parsed.cameraPosition;
        remoteArguments.look_at_position = parsed.lookAtPosition;
      }
      const capture = await callRobloxMcpToolForStudio("screen_capture", remoteArguments, {
        studioId: parsed.studioId,
        requireExplicitWhenMultiple: true,
      });
      if (resultIsError(capture.result)) throw new Error(`Roblox screen_capture failed: ${resultText(capture.result)}`);
      const image = extractRobloxMcpImage(capture.result);
      if (!image) throw new Error("Roblox screen_capture returned no image payload.");
      const saved = await saveRobloxCaptureImage(outputPath, image, parsed.overwrite);
      return {
        ok: true,
        outputPath,
        captureId: parsed.captureId,
        mimeType: image.mimeType,
        bytes: saved.size,
        sha256: saved.sha256,
        mtime: saved.mtime,
        studio: capture.studio,
        switchedStudio: capture.switchedStudio,
        restoredStudio: capture.restoredStudio,
      };
    },
    roblox_place_save: async (args) => {
      if (process.platform !== "win32") throw new Error("roblox_place_save currently supports Windows only.");
      const requestedPath = z.string().min(1).parse(args.placePath);
      const confirmedPath = z.string().min(1).parse(args.confirmPlacePath);
      const placePath = resolveToolPath(requestedPath, { access: "read" });
      const confirmed = resolveToolPath(confirmedPath, { access: "read" });
      if (path.normalize(placePath).toLowerCase() !== path.normalize(confirmed).toLowerCase()) {
        throw new Error("confirmPlacePath must exactly match placePath after resolution.");
      }
      const extension = path.extname(placePath).toLowerCase();
      if (extension !== ".rbxl" && extension !== ".rbxlx") throw new Error("placePath must end in .rbxl or .rbxlx.");
      const stat = await fs.stat(placePath);
      if (!stat.isFile()) throw new Error(`placePath is not a file: ${placePath}`);

      const stopPlay = args.stopPlay !== false;
      const verifyTimeoutMs = z.number().int().min(1000).max(20000).catch(5000).parse(args.verifyTimeoutMs ?? 5000);
      const placeName = path.basename(placePath);
      const studio = await ensureActiveEditStudio(placeName, stopPlay);
      const before = await snapshot(placePath);
      const scriptPath = path.resolve(process.cwd(), "scripts", "roblox-studio-save.ps1");
      const commandResult = await runProcess(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PlacePath", placePath],
        process.cwd(),
        15_000,
      );
      const commandSummary = summarizeCommand(commandResult);
      if (!commandSummary.ok) {
        throw new Error(`Roblox Studio save input failed: ${commandSummary.stderrTail || commandSummary.stdoutTail || commandSummary.error || "unknown error"}`);
      }
      const after = await waitForDiskChange(placePath, before, verifyTimeoutMs);
      const diskChanged = changed(before, after);
      return {
        ok: diskChanged,
        savedAndVerified: diskChanged,
        placePath,
        studio: studio.studio,
        studioState: studio.state,
        before,
        after,
        diskChanged,
        inputAction: commandSummary,
        verification: diskChanged
          ? "The local place file changed after the scoped Ctrl+S action; disk persistence is verified."
          : "No place-file change was observed. The place may already have been clean, or Studio did not persist the edit. Do not claim that a pending change was saved.",
      };
    },
  },
};
