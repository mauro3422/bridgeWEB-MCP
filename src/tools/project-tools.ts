import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { pathPolicyStatus, resolveToolPath } from "./shared/path.js";
import { runProcess } from "./shared/process.js";
import { writeTextAndVerify } from "./shared/text-files.js";

const PROFILE_FILE = ".bridge-project.json";

async function exists(filePath: string) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function dependencyNames(packageJson: Record<string, unknown> | null) {
  return new Set([
    ...Object.keys(stringRecord(packageJson?.dependencies)),
    ...Object.keys(stringRecord(packageJson?.devDependencies)),
  ]);
}

function detectFrameworks(dependencies: Set<string>, files: Set<string>) {
  const rules: Array<[string, string[]]> = [
    ["React", ["react"]], ["Next.js", ["next"]], ["Vue", ["vue"]], ["Nuxt", ["nuxt"]],
    ["Angular", ["@angular/core"]], ["Svelte", ["svelte"]], ["Express", ["express"]],
    ["Fastify", ["fastify"]], ["NestJS", ["@nestjs/core"]], ["Electron", ["electron"]],
    ["Three.js", ["three"]], ["Phaser", ["phaser"]], ["Vite", ["vite"]],
    ["TypeScript", ["typescript"]], ["Pytest", ["pytest"]], ["Django", ["django"]],
    ["Flask", ["flask"]], ["FastAPI", ["fastapi"]],
  ];
  const found = rules.filter(([, names]) => names.some((name) => dependencies.has(name))).map(([label]) => label);
  if (files.has("manage.py") && !found.includes("Django")) found.push("Django");
  return found;
}

function commandsFromScripts(scripts: Record<string, string>, packageManager: string | null) {
  const prefix = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : packageManager === "bun" ? "bun run" : "npm run";
  const command = (name: string) => scripts[name] ? `${prefix} ${name}` : null;
  return {
    install: packageManager === "pnpm" ? "pnpm install" : packageManager === "yarn" ? "yarn install" : packageManager === "bun" ? "bun install" : packageManager ? "npm install" : null,
    dev: command("dev") ?? command("start"),
    build: command("build"),
    test: command("test"),
    lint: command("lint"),
    typecheck: command("check") ?? command("typecheck"),
  };
}

async function projectProfile(projectRoot?: string) {
  const root = resolveToolPath(projectRoot ?? process.cwd(), { access: "read" });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  const packageJsonPath = path.join(root, "package.json");
  const packageJson = names.has("package.json") ? await readJson(packageJsonPath) : null;
  const scripts = stringRecord(packageJson?.scripts);
  const dependencies = dependencyNames(packageJson);
  const packageManager = names.has("pnpm-lock.yaml") ? "pnpm"
    : names.has("yarn.lock") ? "yarn"
      : names.has("bun.lockb") || names.has("bun.lock") ? "bun"
        : names.has("package-lock.json") || packageJson ? "npm" : null;

  const languages = new Set<string>();
  if (packageJson || names.has("tsconfig.json")) languages.add(names.has("tsconfig.json") ? "TypeScript" : "JavaScript");
  if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("setup.py")) languages.add("Python");
  if (names.has("Cargo.toml")) languages.add("Rust");
  if (names.has("go.mod")) languages.add("Go");
  if (Array.from(names).some((name) => /\.(csproj|sln)$/i.test(name))) languages.add("C#");
  if (Array.from(names).some((name) => /CMakeLists\.txt|\.cpp$|\.c$/i.test(name))) languages.add("C/C++");

  const gitRoot = names.has(".git") || await exists(path.join(root, ".git"));
  const branchResult = gitRoot ? await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], root) : null;
  const statusResult = gitRoot ? await runProcess("git", ["status", "--short", "--branch"], root) : null;
  const storedPath = path.join(root, PROFILE_FILE);
  const stored = await readJson(storedPath);
  const importantFiles = [
    "README.md", "AGENTS.md", "package.json", "tsconfig.json", "pyproject.toml", "requirements.txt",
    "Cargo.toml", "go.mod", "docker-compose.yml", "Dockerfile", PROFILE_FILE,
  ].filter((name) => names.has(name));

  return {
    root,
    name: typeof packageJson?.name === "string" ? packageJson.name : path.basename(root),
    description: typeof packageJson?.description === "string" ? packageJson.description : null,
    languages: Array.from(languages),
    frameworks: detectFrameworks(dependencies, names),
    packageManager,
    scripts,
    commands: commandsFromScripts(scripts, packageManager),
    importantFiles,
    git: gitRoot ? {
      branch: String(branchResult?.stdout ?? "").trim() || null,
      status: String(statusResult?.stdout ?? "").trim(),
    } : null,
    storedProfile: stored,
    profilePath: storedPath,
  };
}

async function saveProjectProfile(projectRoot: string | undefined, overrides: Record<string, unknown>) {
  const detected = await projectProfile(projectRoot);
  const payload = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    detected: {
      name: detected.name,
      languages: detected.languages,
      frameworks: detected.frameworks,
      packageManager: detected.packageManager,
      commands: detected.commands,
      importantFiles: detected.importantFiles,
    },
    overrides,
  };
  const result = await writeTextAndVerify(path.join(detected.root, PROFILE_FILE), `${JSON.stringify(payload, null, 2)}\n`, false);
  return { saved: true, profilePath: path.join(detected.root, PROFILE_FILE), payload, result };
}

export const projectToolModule: BridgeToolModule = {
  name: "project",
  tools: [
    { name: "path_policy_status", description: "Show active allowed roots, denied paths, denied sensitive filenames, and path-policy guidance.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "project_profile", description: "Detect a project's languages, frameworks, package manager, scripts, commands, important files, Git state, and saved Bridge profile.", inputSchema: { type: "object", properties: { projectRoot: { type: "string" } }, additionalProperties: false } },
    { name: "project_profile_save", description: "Save a .bridge-project.json profile containing detected project commands plus explicit overrides.", inputSchema: { type: "object", properties: { projectRoot: { type: "string" }, overrides: { type: "object", additionalProperties: true, default: {} } }, additionalProperties: false } },
  ],
  handlers: {
    path_policy_status: () => pathPolicyStatus(),
    project_profile: async (args) => projectProfile(z.object({ projectRoot: z.string().optional() }).parse(args).projectRoot),
    project_profile_save: async (args) => { const p = z.object({ projectRoot: z.string().optional(), overrides: z.record(z.unknown()).default({}) }).parse(args); return saveProjectProfile(p.projectRoot, p.overrides); },
  },
};
