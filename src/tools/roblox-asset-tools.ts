import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/process.js";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_ITEMS = 8;
const DEFAULT_API_KEY_ENV = "ROBLOX_OPEN_CLOUD_API_KEY";
const ASSETS_BASE_URL = "https://apis.roblox.com/assets/v1";

const uploadItemSchema = z.object({
  filePath: z.string().min(1),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  displayName: z.string().min(1).max(50),
  description: z.string().min(1).max(1000),
});

type UploadItem = z.infer<typeof uploadItemSchema>;

function readSecretEnvironmentVariable(name: string): string | undefined {
  const inherited = process.env[name]?.trim();
  if (inherited) return inherited;
  if (process.platform !== "win32") return undefined;

  try {
    const output = execFileSync(
      "reg.exe",
      ["query", "HKCU\\Environment", "/v", name],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const line = output
      .split(/\r?\n/)
      .find((candidate) => candidate.trimStart().startsWith(name));
    const value = line?.match(/^\s*\S+\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i)?.[1]?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".glb": return "model/gltf-binary";
    case ".gltf": return "model/gltf+json";
    case ".fbx": return "model/fbx";
    default: throw new Error(`Unsupported Roblox model extension: ${filePath}. Use .glb, .gltf, or .fbx.`);
  }
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function creatorPayload(creatorType: "user" | "group", creatorId: string) {
  return creatorType === "user" ? { userId: creatorId } : { groupId: creatorId };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Roblox Open Cloud returned non-JSON HTTP ${response.status}.`);
    }
  }
  if (!response.ok) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const message = typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : `HTTP ${response.status}`;
    throw new Error(`Roblox Open Cloud request failed: ${message}`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Roblox Open Cloud returned an unexpected response body.");
  }
  return body as Record<string, unknown>;
}

function operationId(operation: Record<string, unknown>): string {
  const raw = typeof operation.path === "string"
    ? operation.path
    : typeof operation.operationId === "string"
      ? operation.operationId
      : "";
  const id = raw.replace(/^operations\//, "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Roblox Open Cloud did not return a valid asset operation id.");
  }
  return id;
}

async function pollOperation(apiKey: string, id: string, timeoutMs: number, pollIntervalMs: number) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const response = await fetch(`${ASSETS_BASE_URL}/operations/${encodeURIComponent(id)}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(Math.min(30_000, Math.max(1_000, deadline - Date.now()))),
    });
    const operation = await readJsonResponse(response);
    if (operation.done === true) {
      if (operation.error && typeof operation.error === "object") {
        const error = operation.error as Record<string, unknown>;
        throw new Error(`Roblox asset operation failed: ${String(error.message ?? error.code ?? "unknown error")}`);
      }
      const result = operation.response;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Roblox asset operation completed without an asset response.");
      }
      const asset = result as Record<string, unknown>;
      const assetId = String(asset.assetId ?? "").trim();
      if (!/^\d+$/.test(assetId) || assetId === "0") {
        throw new Error("Roblox asset operation completed without a valid assetId.");
      }
      return { assetId, operation, attempts };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Roblox asset operation '${id}' did not complete within ${timeoutMs} ms.`);
}

async function readAsset(apiKey: string, assetId: string) {
  const response = await fetch(`${ASSETS_BASE_URL}/assets/${encodeURIComponent(assetId)}?readMask=description%2CdisplayName`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  return await readJsonResponse(response);
}

async function uploadOne(args: {
  item: UploadItem;
  apiKey: string;
  creatorType: "user" | "group";
  creatorId: string;
  timeoutMs: number;
  pollIntervalMs: number;
}) {
  const filePath = resolveToolPath(args.item.filePath, { access: "read" });
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Roblox asset source is not a file: ${filePath}`);
  if (stat.size <= 0 || stat.size > MAX_ASSET_BYTES) {
    throw new Error(`Roblox asset source must be 1-${MAX_ASSET_BYTES} bytes: ${filePath}`);
  }
  const bytes = await fs.readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== args.item.expectedSha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${filePath}: expected ${args.item.expectedSha256.toLowerCase()}, got ${digest}`);
  }
  const contentType = contentTypeFor(filePath);
  const request = {
    assetType: "Model",
    creationContext: {
      assetPrivacy: "private",
      creator: creatorPayload(args.creatorType, args.creatorId),
      expectedPrice: 0,
    },
    description: args.item.description,
    displayName: args.item.displayName,
  };
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
  form.append("fileContent", new Blob([bytes], { type: contentType }), path.basename(filePath));

  const uploadResponse = await fetch(`${ASSETS_BASE_URL}/assets`, {
    method: "POST",
    headers: { "x-api-key": args.apiKey },
    body: form,
    signal: AbortSignal.timeout(Math.min(args.timeoutMs, 60_000)),
  });
  const initialOperation = await readJsonResponse(uploadResponse);
  const id = operationId(initialOperation);
  const completed = await pollOperation(args.apiKey, id, args.timeoutMs, args.pollIntervalMs);
  const readback = await readAsset(args.apiKey, completed.assetId);
  if (String(readback.assetId ?? "") !== completed.assetId) {
    throw new Error(`Roblox asset readback identity mismatch for ${completed.assetId}.`);
  }
  return {
    filePath,
    bytes: bytes.length,
    sha256: digest,
    contentType,
    displayName: args.item.displayName,
    creatorType: args.creatorType,
    creatorId: args.creatorId,
    operationId: id,
    pollAttempts: completed.attempts,
    assetId: completed.assetId,
    assetUri: `rbxassetid://${completed.assetId}`,
    readback: {
      assetId: String(readback.assetId),
      assetType: readback.assetType ?? null,
      displayName: readback.displayName ?? null,
      description: readback.description ?? null,
      path: readback.path ?? null,
      moderationResult: readback.moderationResult ?? null,
    },
  };
}

export const robloxAssetToolModule: BridgeToolModule = {
  name: "roblox-assets",
  tools: [{
    name: "roblox_asset_upload",
    description: "Upload a bounded batch of verified local GLB/GLTF/FBX files as private Roblox Model assets through the official Open Cloud Assets API. Requires exact SHA-256 values, explicit creator identity and confirmation, reads the API key only from an environment variable, polls each operation, and verifies every asset with a metadata readback. This creates external Roblox assets and may trigger moderation; never use it for unreviewed or cross-owner content.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_BATCH_ITEMS,
          items: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Allowed local .glb, .gltf, or .fbx file." },
              expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
              displayName: { type: "string", minLength: 1, maxLength: 50 },
              description: { type: "string", minLength: 1, maxLength: 1000 },
            },
            required: ["filePath", "expectedSha256", "displayName", "description"],
            additionalProperties: false,
          },
        },
        creatorType: { type: "string", enum: ["user", "group"] },
        creatorId: { type: "string", pattern: "^[0-9]+$" },
        confirmCreatorId: { type: "string", pattern: "^[0-9]+$", description: "Must exactly repeat creatorId." },
        confirmUpload: { type: "boolean", description: "Must be true to acknowledge external asset creation and moderation." },
        apiKeyEnv: { type: "string", default: DEFAULT_API_KEY_ENV, description: "Environment variable name containing the Open Cloud API key. The key itself is never accepted as an argument." },
        timeoutMs: { type: "number", default: 180000, minimum: 10000, maximum: 600000 },
        pollIntervalMs: { type: "number", default: 1000, minimum: 500, maximum: 10000 },
        manifestPath: { type: "string", description: "Optional allowed .json path for a secret-free upload/readback manifest." },
      },
      required: ["items", "creatorType", "creatorId", "confirmCreatorId", "confirmUpload"],
      additionalProperties: false,
    },
  }],
  handlers: {
    roblox_asset_upload: async (raw) => {
      const parsed = z.object({
        items: z.array(uploadItemSchema).min(1).max(MAX_BATCH_ITEMS),
        creatorType: z.enum(["user", "group"]),
        creatorId: z.string().regex(/^[0-9]+$/),
        confirmCreatorId: z.string().regex(/^[0-9]+$/),
        confirmUpload: z.literal(true),
        apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/).default(DEFAULT_API_KEY_ENV),
        timeoutMs: z.number().int().min(10_000).max(600_000).default(180_000),
        pollIntervalMs: z.number().int().min(500).max(10_000).default(1_000),
        manifestPath: z.string().optional(),
      }).parse(raw);
      if (parsed.creatorId !== parsed.confirmCreatorId) {
        throw new Error("confirmCreatorId must exactly match creatorId.");
      }
      const apiKey = readSecretEnvironmentVariable(parsed.apiKeyEnv);
      if (!apiKey) {
        throw new Error(`Roblox Open Cloud API key is not configured in environment variable '${parsed.apiKeyEnv}'.`);
      }

      const uniquePaths = new Set(parsed.items.map((item) => path.normalize(item.filePath).toLowerCase()));
      if (uniquePaths.size !== parsed.items.length) throw new Error("items contains duplicate file paths.");
      const uploaded = [];
      for (const item of parsed.items) {
        uploaded.push(await uploadOne({
          item,
          apiKey,
          creatorType: parsed.creatorType,
          creatorId: parsed.creatorId,
          timeoutMs: parsed.timeoutMs,
          pollIntervalMs: parsed.pollIntervalMs,
        }));
      }

      let manifestPath: string | null = null;
      if (parsed.manifestPath) {
        manifestPath = resolveToolPath(parsed.manifestPath, { access: "write" });
        if (path.extname(manifestPath).toLowerCase() !== ".json") throw new Error("manifestPath must use the .json extension.");
        await fs.mkdir(path.dirname(manifestPath), { recursive: true });
        const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporaryPath, JSON.stringify({
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            provider: "roblox-open-cloud-assets-v1",
            creatorType: parsed.creatorType,
            creatorId: parsed.creatorId,
            itemCount: uploaded.length,
            items: uploaded,
          }, null, 2), "utf8");
          await fs.rename(temporaryPath, manifestPath);
        } finally {
          await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        }
      }
      return {
        ok: true,
        provider: "roblox-open-cloud-assets-v1",
        externalAssetsCreated: uploaded.length,
        apiKeyEnv: parsed.apiKeyEnv,
        secretReturned: false,
        uploaded,
        manifestPath,
        verification: "Each operation completed with an assetId and was read back through GET /assets/v1/assets/{assetId}.",
      };
    },
  },
};
