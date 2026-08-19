import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateMssrConsistencyDecisionSupport,
  type MssrConsistencyBoundary,
  type MssrConsistencyDecisionSupport,
  type MssrConsistencyObservation,
} from "@mauroprime/mssr";
import { SERVER_VERSION } from "./config.js";
import type { BridgeNoticeInput } from "./notices.js";
import { createMssrConsistencyNoticeTracker } from "./mssr-consistency.js";

const DEFAULT_INTERVAL_MS = 60_000;
let latestReleaseConsistency: BridgeReleaseConsistencySnapshot | null = null;

export type BridgeReleaseConsistencySnapshot = {
  observedAt: string;
  boundary: MssrConsistencyBoundary;
  root: string;
  observations: MssrConsistencyObservation[];
  projection: MssrConsistencyDecisionSupport;
};

type PackageJson = {
  version?: unknown;
  dependencies?: Record<string, unknown>;
};

function bounded(value: unknown, max = 160): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

async function readText(filePath: string): Promise<{ state: "observed"; text: string } | { state: "unavailable" }> {
  try {
    return { state: "observed", text: await fs.readFile(filePath, "utf8") };
  } catch {
    return { state: "unavailable" };
  }
}

async function readJson(filePath: string): Promise<{ state: "observed"; value: PackageJson } | { state: "unavailable" | "unknown" }> {
  const loaded = await readText(filePath);
  if (loaded.state !== "observed") return loaded;
  try {
    const parsed = JSON.parse(loaded.text) as PackageJson;
    return parsed && typeof parsed === "object" ? { state: "observed", value: parsed } : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

function extractServerVersion(text: string): string | null {
  return bounded(text.match(/SERVER_VERSION\s*=\s*["']([^"']+)["']/)?.[1]);
}

function extractMssrDependencyVersion(value: unknown): string | null {
  const dependency = bounded(value, 240);
  if (!dependency) return null;
  const tarball = dependency.match(/mauroprime-mssr-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz/i)?.[1];
  if (tarball) return bounded(tarball);
  const exact = dependency.match(/^(?:\^|~)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)?.[1];
  return bounded(exact);
}

function observed(
  key: string,
  observer: string,
  role: MssrConsistencyObservation["role"],
  authority: MssrConsistencyObservation["authority"],
  value: string | null,
  required = false,
): MssrConsistencyObservation {
  return {
    key,
    observer,
    role,
    authority,
    state: value ? "observed" : "unknown",
    ...(value ? { value } : {}),
    ...(required ? { required: true } : {}),
  };
}

function unavailable(
  key: string,
  observer: string,
  role: MssrConsistencyObservation["role"],
  authority: MssrConsistencyObservation["authority"],
  required = false,
): MssrConsistencyObservation {
  return { key, observer, role, authority, state: "unavailable", ...(required ? { required: true } : {}) };
}

export async function collectBridgeReleaseConsistencyObservations(
  root = process.cwd(),
  runtimeVersion = SERVER_VERSION,
): Promise<MssrConsistencyObservation[]> {
  const resolvedRoot = path.resolve(root);
  const packagePath = path.join(resolvedRoot, "package.json");
  const sourceConfigPath = path.join(resolvedRoot, "src", "config.ts");
  const distConfigPath = path.join(resolvedRoot, "dist", "config.js");
  const installedMssrPath = path.join(resolvedRoot, "node_modules", "@mauroprime", "mssr", "package.json");

  const [packageJson, sourceConfig, distConfig, installedMssr] = await Promise.all([
    readJson(packagePath),
    readText(sourceConfigPath),
    readText(distConfigPath),
    readJson(installedMssrPath),
  ]);

  const observations: MssrConsistencyObservation[] = [];
  if (packageJson.state === "observed") {
    observations.push(observed("bridge.release-version", "package.json", "source", "canonical", bounded(packageJson.value.version), true));
    observations.push(observed(
      "bridge.mssr-package-version",
      "package.json#dependencies.@mauroprime/mssr",
      "source",
      "canonical",
      extractMssrDependencyVersion(packageJson.value.dependencies?.["@mauroprime/mssr"]),
      true,
    ));
  } else {
    observations.push(unavailable("bridge.release-version", "package.json", "source", "canonical", true));
    observations.push(unavailable("bridge.mssr-package-version", "package.json#dependencies.@mauroprime/mssr", "source", "canonical", true));
  }

  observations.push(sourceConfig.state === "observed"
    ? observed("bridge.release-version", "src/config.ts", "source", "replica", extractServerVersion(sourceConfig.text), true)
    : unavailable("bridge.release-version", "src/config.ts", "source", "replica", true));
  observations.push(distConfig.state === "observed"
    ? observed("bridge.release-version", "dist/config.js", "generated", "replica", extractServerVersion(distConfig.text), true)
    : unavailable("bridge.release-version", "dist/config.js", "generated", "replica", true));
  observations.push(observed("bridge.release-version", "live-runtime", "runtime", "replica", bounded(runtimeVersion), true));

  observations.push(installedMssr.state === "observed"
    ? observed("bridge.mssr-package-version", "node_modules/@mauroprime/mssr/package.json", "installed", "replica", bounded(installedMssr.value.version), true)
    : unavailable("bridge.mssr-package-version", "node_modules/@mauroprime/mssr/package.json", "installed", "replica", true));

  return observations;
}

export async function observeBridgeReleaseConsistency(options: {
  root?: string;
  runtimeVersion?: string;
  boundary?: MssrConsistencyBoundary;
  now?: Date;
} = {}): Promise<BridgeReleaseConsistencySnapshot> {
  const root = path.resolve(options.root ?? process.cwd());
  const boundary = options.boundary ?? "ordinary";
  const observations = await collectBridgeReleaseConsistencyObservations(root, options.runtimeVersion ?? SERVER_VERSION);
  const projection = evaluateMssrConsistencyDecisionSupport({ boundary, observations });
  return {
    observedAt: (options.now ?? new Date()).toISOString(),
    boundary,
    root,
    observations,
    projection,
  };
}

export function getReleaseConsistencyReport(): { latest: BridgeReleaseConsistencySnapshot | null } {
  return { latest: latestReleaseConsistency };
}

export function startReleaseConsistencyScheduler(options: {
  root?: string;
  runtimeVersion?: string;
  onNotice?: (notice: BridgeNoticeInput) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  observe?: (boundary: MssrConsistencyBoundary) => Promise<BridgeReleaseConsistencySnapshot>;
} = {}): { stop: () => void; runNow: () => Promise<void> } {
  const tracker = createMssrConsistencyNoticeTracker();
  let running = false;
  let firstSuccessfulObservation = true;
  const root = path.resolve(options.root ?? process.cwd());

  const observe = options.observe ?? ((boundary: MssrConsistencyBoundary) => observeBridgeReleaseConsistency({
    root,
    runtimeVersion: options.runtimeVersion ?? SERVER_VERSION,
    boundary,
  }));

  const runNow = async () => {
    if (running) return;
    running = true;
    try {
      const boundary: MssrConsistencyBoundary = firstSuccessfulObservation ? "post-restart" : "ordinary";
      const snapshot = await observe(boundary);
      latestReleaseConsistency = snapshot;
      const result = tracker.observe({
        subject: "bridge-release-consistency",
        source: "mssr-release-consistency",
        boundary: snapshot.boundary,
        observations: snapshot.observations,
        projectRoot: root,
        details: {
          observedAt: snapshot.observedAt,
          producer: "bridge-release-consistency",
        },
        message: `Bridge release consistency ${snapshot.projection.level.toUpperCase()}: ${snapshot.projection.reasonCodes.join(", ") || "package/source/dist/runtime e instalación MSSR coherentes"}.`,
        resolutionMessage: "Bridge release consistency volvió a un estado coherente; package/source/generated/installed/runtime ya no requieren atención C2c.",
      });
      if (result.notice) options.onNotice?.(result.notice);
      firstSuccessfulObservation = false;
    } finally {
      running = false;
    }
  };

  const handleError = (error: unknown) => options.onError?.(error);
  const timer = setInterval(
    () => void runNow().catch(handleError),
    Math.max(10_000, options.intervalMs ?? DEFAULT_INTERVAL_MS),
  );
  timer.unref?.();
  void runNow().catch(handleError);
  return { stop: () => clearInterval(timer), runNow };
}
