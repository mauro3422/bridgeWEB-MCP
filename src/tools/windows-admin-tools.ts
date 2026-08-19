import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";

const PROFILE_NAMES = ["amd-dxc-cache", "windows-update-download", "edgecore-stale"] as const;
type WindowsAdminCacheProfile = (typeof PROFILE_NAMES)[number];

function localAppDataRoot(): string {
  return path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"));
}

export function resolveWindowsAdminCacheProfile(profile: WindowsAdminCacheProfile): string {
  switch (profile) {
    case "amd-dxc-cache":
      return path.resolve(localAppDataRoot(), "AMD", "DxcCache");
    case "windows-update-download":
      return path.resolve(process.env.WINDIR || "C:\\Windows", "SoftwareDistribution", "Download");
    case "edgecore-stale":
      return path.resolve(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "EdgeCore");
  }
}

async function directoryStats(target: string) {
  let files = 0;
  let bytes = 0;
  const largest: Array<{ name: string; bytes: number }> = [];
  const pending = [target];

  try {
    await fs.access(target);
  } catch (error) {
    return {
      exists: false,
      files: 0,
      bytes: 0,
      largest,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  while (pending.length > 0) {
    const current = pending.pop()!;
    let dirents;
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      const entryPath = path.join(current, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!dirent.isFile()) continue;

      try {
        const stat = await fs.stat(entryPath);
        files += 1;
        bytes += stat.size;
        largest.push({ name: path.relative(target, entryPath), bytes: stat.size });
        largest.sort((a, b) => b.bytes - a.bytes);
        if (largest.length > 12) largest.length = 12;
      } catch {
        files += 1;
      }
    }
  }

  return { exists: true, files, bytes, largest };
}

function projectRootFromModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function quotePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function runElevatedLauncher(launcherPath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const projectRoot = projectRootFromModule();
    const escapedLauncher = quotePowerShellLiteral(launcherPath);
    const command = [
      `$argLine='-NoProfile -ExecutionPolicy Bypass -File "${escapedLauncher}"'`,
      `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argLine -PassThru -Wait`,
      `exit $p.ExitCode`,
    ].join("; ");

    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      shell: false,
      windowsHide: false,
      cwd: projectRoot,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish({ launched: false, error: error.message }));
    child.once("close", (code, signal) => finish({ launched: true, code, signal, stdout, stderr }));
  });
}

async function runStorageAudit() {
  if (process.platform !== "win32") throw new Error("windows_admin_storage_audit is only available on Windows.");

  const projectRoot = projectRootFromModule();
  const resultDir = path.join(projectRoot, "data", "windows-admin-requests");
  await fs.mkdir(resultDir, { recursive: true });
  const requestId = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const resultPath = path.join(resultDir, `${requestId}.json`);
  const launcherPath = path.join(resultDir, `${requestId}.ps1`);
  const helperPath = path.join(projectRoot, "scripts", "windows-admin-storage-audit.ps1");
  const launcher = [
    "$ErrorActionPreference = 'Stop'",
    `& '${quotePowerShellLiteral(helperPath)}' -ResultPath '${quotePowerShellLiteral(resultPath)}'`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n");
  await fs.writeFile(launcherPath, launcher, "utf8");

  let launch: Record<string, unknown>;
  try {
    launch = await runElevatedLauncher(launcherPath);
  } finally {
    await fs.rm(launcherPath, { force: true });
  }

  let elevatedResult: Record<string, unknown> | null = null;
  try {
    const raw = (await fs.readFile(resultPath, "utf8")).replace(/^\uFEFF/, "");
    elevatedResult = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // UAC cancellation or helper failure can leave no receipt.
  }

  return { requestId, launch, elevatedResult };
}

async function cleanupKnownCache(profile: WindowsAdminCacheProfile, dryRun: boolean) {
  if (process.platform !== "win32") throw new Error("windows_admin_cache_cleanup is only available on Windows.");
  const target = resolveWindowsAdminCacheProfile(profile);
  const before = await directoryStats(target);
  if (dryRun || !before.exists) return { profile, target, dryRun: true, before };

  const projectRoot = projectRootFromModule();
  const resultDir = path.join(projectRoot, "data", "windows-admin-requests");
  await fs.mkdir(resultDir, { recursive: true });
  const requestId = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const resultPath = path.join(resultDir, `${requestId}.json`);
  const launcherPath = path.join(resultDir, `${requestId}.ps1`);
  const helperPath = path.join(projectRoot, "scripts", "windows-admin-cache-cleanup.ps1");
  const launcher = [
    "$ErrorActionPreference = 'Stop'",
    `& '${quotePowerShellLiteral(helperPath)}' -Profile '${quotePowerShellLiteral(profile)}' -ResultPath '${quotePowerShellLiteral(resultPath)}'`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n");
  await fs.writeFile(launcherPath, launcher, "utf8");

  let launch: Record<string, unknown>;
  try {
    launch = await runElevatedLauncher(launcherPath);
  } finally {
    await fs.rm(launcherPath, { force: true });
  }

  let elevatedResult: Record<string, unknown> | null = null;
  try {
    const raw = (await fs.readFile(resultPath, "utf8")).replace(/^\uFEFF/, "");
    elevatedResult = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // UAC cancellation or helper failure can leave no result file; post-verification remains authoritative.
  }
  const after = await directoryStats(target);
  return { profile, target, dryRun: false, requestId, launch, elevatedResult, before, after };
}

export const windowsAdminToolModule: BridgeToolModule = {
  name: "windows-admin",
  tools: [
    {
      name: "windows_admin_cache_status",
      description: "Inspect one Bridge-approved Windows cache profile without elevation. Supports AMD DXC cache, Windows Update download cache, and stale Microsoft EdgeCore cleanup targets.",
      inputSchema: {
        type: "object",
        properties: { profile: { type: "string", enum: [...PROFILE_NAMES] } },
        required: ["profile"],
        additionalProperties: false,
      },
    },
    {
      name: "windows_admin_storage_audit",
      description: "Run a fixed read-only elevated Windows system-storage audit. It reports C: usage, pagefile allocation, VSS shadow storage, Reserved Storage, recovery configuration, and protected directory summaries. It accepts no paths or commands and makes no system changes.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "windows_admin_cache_cleanup",
      description: "Clean one Bridge-approved protected Windows cache profile. Defaults to dry-run. Apply mode launches a visible UAC prompt and an elevated, profile-scoped helper; arbitrary paths and arbitrary elevated commands are not accepted.",
      inputSchema: {
        type: "object",
        properties: {
          profile: { type: "string", enum: [...PROFILE_NAMES] },
          dryRun: { type: "boolean", default: true },
        },
        required: ["profile"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    windows_admin_cache_status: async (args) => {
      const parsed = z.object({ profile: z.enum(PROFILE_NAMES) }).parse(args);
      const target = resolveWindowsAdminCacheProfile(parsed.profile);
      return { profile: parsed.profile, target, ...(await directoryStats(target)) };
    },
    windows_admin_storage_audit: async (args) => {
      z.object({}).strict().parse(args);
      return await runStorageAudit();
    },
    windows_admin_cache_cleanup: async (args) => {
      const parsed = z.object({ profile: z.enum(PROFILE_NAMES), dryRun: z.boolean().default(true) }).parse(args);
      return await cleanupKnownCache(parsed.profile, parsed.dryRun);
    },
  },
};
