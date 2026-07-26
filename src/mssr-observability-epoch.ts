import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MSSR_TRACE_CONTRACT_VERSION = "trace-contract-v1";

export type MssrObservabilityEpochState = {
  schemaVersion: 1;
  contractVersion: string;
  activeEpoch: string;
  baselineAt: string;
  createdAt: string;
  legacyScope: "preserved";
};

const metricsDir = path.resolve(process.env.BRIDGE_MCP_METRICS_DIR || path.join(process.cwd(), "data"));
export const mssrObservabilityStatePath = path.resolve(
  process.env.BRIDGE_MCP_MSSR_STATE || path.join(metricsDir, "mssr-observability-state.json"),
);

let cachedState: MssrObservabilityEpochState | null = null;

function createState(now = new Date().toISOString()): MssrObservabilityEpochState {
  const timestamp = now.replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    schemaVersion: 1,
    contractVersion: MSSR_TRACE_CONTRACT_VERSION,
    activeEpoch: `${MSSR_TRACE_CONTRACT_VERSION}-${timestamp}-${randomUUID().slice(0, 8)}`,
    baselineAt: now,
    createdAt: now,
    legacyScope: "preserved",
  };
}

function validState(value: unknown): value is MssrObservabilityEpochState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.schemaVersion === 1
    && state.contractVersion === MSSR_TRACE_CONTRACT_VERSION
    && typeof state.activeEpoch === "string"
    && /^[A-Za-z0-9._:-]{6,160}$/.test(state.activeEpoch)
    && typeof state.baselineAt === "string"
    && Number.isFinite(Date.parse(state.baselineAt))
    && typeof state.createdAt === "string"
    && state.legacyScope === "preserved";
}

function writeState(state: MssrObservabilityEpochState): void {
  fs.mkdirSync(path.dirname(mssrObservabilityStatePath), { recursive: true });
  const temporaryPath = `${mssrObservabilityStatePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, mssrObservabilityStatePath);
  const readback = JSON.parse(fs.readFileSync(mssrObservabilityStatePath, "utf8")) as unknown;
  if (!validState(readback) || readback.activeEpoch !== state.activeEpoch) {
    throw new Error(`MSSR observability epoch readback failed: ${mssrObservabilityStatePath}`);
  }
}

export function getMssrObservabilityEpoch(): MssrObservabilityEpochState {
  if (cachedState) return cachedState;
  try {
    const parsed = JSON.parse(fs.readFileSync(mssrObservabilityStatePath, "utf8")) as unknown;
    if (validState(parsed)) {
      cachedState = parsed;
      return cachedState;
    }
  } catch {
    // Missing, stale, or invalid state starts a new logical epoch without deleting legacy telemetry.
  }

  const state = createState();
  writeState(state);
  cachedState = state;
  return state;
}

export function startMssrObservabilityEpoch(): {
  previous: MssrObservabilityEpochState;
  current: MssrObservabilityEpochState;
} {
  const previous = getMssrObservabilityEpoch();
  const current = createState();
  writeState(current);
  cachedState = current;
  return { previous, current };
}

export function resetMssrObservabilityEpochForTests(): void {
  cachedState = null;
}
