import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ToolPathAccess = "read" | "write" | "cwd" | "internal";

export type ResolveToolPathOptions = {
  access?: ToolPathAccess;
  baseDir?: string;
};

const DEFAULT_DENIED_NAMES = [
  ".env",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "service-account.json",
  "token.json",
  "client_secret.json",
];

function envList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalizePotentialPath(target: string): string {
  let current = path.resolve(target);
  const suffix: string[] = [];

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }

  try {
    const realBase = fs.realpathSync.native(current);
    return path.resolve(realBase, ...suffix);
  } catch {
    return path.resolve(target);
  }
}

function existingDirectoryCandidates(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const resolved = path.resolve(value);
    try {
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }
    unique.set(normalizeForCompare(resolved), resolved);
  }
  return Array.from(unique.values());
}

function defaultAllowedRoots(): string[] {
  const home = os.homedir();
  return existingDirectoryCandidates([
    path.resolve(process.cwd(), ".."),
    os.tmpdir(),
    path.join(home, "Documents", "Proyectos"),
    path.join(home, "Desktop", "Proyectos"),
  ]);
}

function defaultDeniedPaths(): string[] {
  const home = os.homedir();
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  return [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, ".aws"),
    path.join(home, ".azure"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    path.join(home, ".config", "gcloud"),
    path.join(home, "AppData", "Roaming", "gcloud"),
    path.join(home, "AppData", "Local", "Google", "Chrome", "User Data"),
    path.join(home, "AppData", "Local", "Microsoft", "Edge", "User Data"),
    path.join(home, "AppData", "Roaming", "Mozilla"),
    path.join(home, "AppData", "Roaming", "Microsoft", "Credentials"),
    path.join(home, "AppData", "Local", "Microsoft", "Credentials"),
    ...(systemRoot ? [systemRoot] : []),
  ].map((item) => path.resolve(item));
}

export function getPathPolicy(env: NodeJS.ProcessEnv = process.env) {
  const configuredRoots = envList(env.BRIDGE_MCP_ALLOWED_ROOTS);
  const configuredDeniedPaths = envList(env.BRIDGE_MCP_DENIED_PATHS);
  const configuredDeniedNames = String(env.BRIDGE_MCP_DENIED_NAMES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const allowedRoots = existingDirectoryCandidates(configuredRoots.length > 0 ? configuredRoots : defaultAllowedRoots());
  const deniedPaths = [...defaultDeniedPaths(), ...configuredDeniedPaths.map((item) => path.resolve(item))];
  const deniedNames = Array.from(new Set([...DEFAULT_DENIED_NAMES, ...configuredDeniedNames].map((item) => item.toLowerCase())));

  return {
    enabled: env.BRIDGE_MCP_PATH_POLICY_DISABLED !== "1",
    source: configuredRoots.length > 0 ? "BRIDGE_MCP_ALLOWED_ROOTS" : "safe defaults",
    allowedRoots,
    deniedPaths,
    deniedNames,
  };
}

function deniedNameInPath(target: string, deniedNames: string[]): string | null {
  const safeEnvironmentTemplates = new Set([".env.example", ".env.sample", ".env.template"]);
  const parts = path.resolve(target).split(/[\\/]+/).map((part) => part.toLowerCase());
  for (const part of parts) {
    if (safeEnvironmentTemplates.has(part)) continue;
    if (part === ".env" || part.startsWith(".env.")) return part;
    if (deniedNames.includes(part)) return part;
  }
  return null;
}

export function assertPathAllowed(target: string, access: ToolPathAccess = "read"): string {
  const resolved = path.resolve(target);
  const canonical = canonicalizePotentialPath(resolved);
  const policy = getPathPolicy();
  if (!policy.enabled || access === "internal") return resolved;

  const allowed = policy.allowedRoots.some((root) => {
    const canonicalRoot = canonicalizePotentialPath(root);
    return isWithin(normalizeForCompare(root), normalizeForCompare(resolved))
      && isWithin(normalizeForCompare(canonicalRoot), normalizeForCompare(canonical));
  });
  if (!allowed) {
    throw new Error(`Path is outside bridge-mcp allowed roots: ${resolved}. Allowed roots: ${policy.allowedRoots.join(", ")}`);
  }

  const deniedPath = policy.deniedPaths.find((item) => {
    const denied = canonicalizePotentialPath(item);
    return isWithin(normalizeForCompare(item), normalizeForCompare(resolved))
      || isWithin(normalizeForCompare(denied), normalizeForCompare(canonical));
  });
  if (deniedPath) throw new Error(`Path is denied by bridge-mcp policy: ${resolved} (matched ${deniedPath})`);

  const deniedName = deniedNameInPath(resolved, policy.deniedNames) ?? deniedNameInPath(canonical, policy.deniedNames);
  if (deniedName) throw new Error(`Path contains a denied sensitive filename '${deniedName}': ${resolved}`);

  return resolved;
}

export function resolveToolPath(inputPath: string, options: ResolveToolPathOptions = {}): string {
  if (!inputPath || typeof inputPath !== "string") throw new Error("Path must be a non-empty string.");
  const baseDir = options.baseDir ? path.resolve(options.baseDir) : process.cwd();
  const resolved = path.resolve(baseDir, inputPath);
  return assertPathAllowed(resolved, options.access ?? "read");
}

export function pathPolicyStatus() {
  const policy = getPathPolicy();
  return {
    ...policy,
    cwd: process.cwd(),
    tempRoot: os.tmpdir(),
    notes: [
      "The policy constrains paths and working directories used by explicit Bridge tools.",
      "run_command and terminal tools still execute a trusted shell inside an allowed cwd; this is not an operating-system sandbox.",
      "Set BRIDGE_MCP_ALLOWED_ROOTS using the platform path delimiter to replace the default allowed roots.",
    ],
  };
}
