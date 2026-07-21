import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callRobloxMcpTool } from "../integrations/roblox-mcp-client.js";
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
