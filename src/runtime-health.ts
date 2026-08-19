import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateMssrInfrastructureOperationalAttention,
  evaluateMssrOperationalNoticeTransition,
  type MssrInfrastructureOperationalProjection,
  type MssrRestartOperationalState,
  type MssrTunnelOperationalState,
} from "@mauroprime/mssr";
import { SERVER_VERSION } from "./config.js";
import type { BridgeNoticeInput } from "./notices.js";
import { adaptMssrOperationalDecision } from "./operational-notices.js";
import { RUNTIME_BOOT_ID, RUNTIME_STARTED_AT } from "./runtime-identity.js";

import { bridgeRestartStatus, tunnelHealth } from "./tools/bridge-ops.js";
const DEFAULT_INTERVAL_MS = 60_000;
const MAX_SNAPSHOTS = 96;

export type RuntimeHealthTunnelObservation = {
  healthzOk: boolean;
  readyzOk: boolean;
};

export type RuntimeHealthRestartObservation = {
  pending: boolean;
  requestId?: string | null;
  lastAckId?: string | null;
  lastAckAction?: string | null;
};

export type RuntimeHealthSnapshot = {
  observedAt: string;
  runtime: {
    bootId: string;
    pid: number;
    version: string;
    startedAt: string;
    continuity: "stable" | "restarted";
  };
  tunnel: {
    state: MssrTunnelOperationalState;
    healthzOk: boolean;
    readyzOk: boolean;
  };
  restart: {
    state: MssrRestartOperationalState;
    pending: boolean;
    requestId: string | null;
    lastAckId: string | null;
    lastAckAction: string | null;
  };
  transport: "not-observed";
  projection: MssrInfrastructureOperationalProjection;
};

export type RuntimeHealthStore = {
  version: 1;
  policy: {
    metadataOnly: true;
    transportObservation: "external-only";
  };
  snapshots: RuntimeHealthSnapshot[];
};

export type RuntimeHealthObservation = {
  tunnel: RuntimeHealthTunnelObservation;
  restart: RuntimeHealthRestartObservation;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, max = 160): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function observeBridgeRuntimeHealth(): Promise<RuntimeHealthObservation> {
  const [tunnel, restart] = await Promise.all([
    tunnelHealth(),
    bridgeRestartStatus(process.cwd()),
  ]);
  const request = asRecord(restart.request);
  const lastAck = asRecord(restart.lastAck);
  return {
    tunnel: {
      healthzOk: tunnel.healthz.ok === true,
      readyzOk: tunnel.readyz.ok === true,
    },
    restart: {
      pending: restart.pending === true,
      requestId: boundedString(request?.id),
      lastAckId: boundedString(lastAck?.id),
      lastAckAction: boundedString(lastAck?.action, 120),
    },
  };
}
function storePath(): string {
  return path.resolve(process.env.BRIDGE_MCP_RUNTIME_HEALTH_PATH || path.join(process.cwd(), "data", "runtime-health.json"));
}

function emptyStore(): RuntimeHealthStore {
  return {
    version: 1,
    policy: { metadataOnly: true, transportObservation: "external-only" },
    snapshots: [],
  };
}

async function readStore(): Promise<RuntimeHealthStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(), "utf8")) as Partial<RuntimeHealthStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.snapshots)) return emptyStore();
    return {
      version: 1,
      policy: { metadataOnly: true, transportObservation: "external-only" },
      snapshots: parsed.snapshots.slice(-MAX_SNAPSHOTS),
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: RuntimeHealthStore): Promise<void> {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await fs.rename(temp, target);
}

export function classifyTunnelObservation(observation: RuntimeHealthTunnelObservation): MssrTunnelOperationalState {
  if (observation.healthzOk && observation.readyzOk) return "healthy";
  if (observation.healthzOk || observation.readyzOk) return "degraded";
  return "unavailable";
}

export function buildRuntimeHealthSnapshot(
  observation: RuntimeHealthObservation,
  previous: RuntimeHealthSnapshot | null,
  now = new Date(),
): RuntimeHealthSnapshot {
  const continuity = previous && previous.runtime.bootId !== RUNTIME_BOOT_ID ? "restarted" : "stable";
  const tunnelState = classifyTunnelObservation(observation.tunnel);
  const restartState: MssrRestartOperationalState = observation.restart.pending ? "pending" : "none";
  const projection = evaluateMssrInfrastructureOperationalAttention({
    tunnel: tunnelState,
    runtime: continuity,
    restart: restartState,
    transport: "not-observed",
  });

  return {
    observedAt: now.toISOString(),
    runtime: {
      bootId: RUNTIME_BOOT_ID,
      pid: process.pid,
      version: SERVER_VERSION,
      startedAt: RUNTIME_STARTED_AT,
      continuity,
    },
    tunnel: {
      state: tunnelState,
      healthzOk: observation.tunnel.healthzOk,
      readyzOk: observation.tunnel.readyzOk,
    },
    restart: {
      state: restartState,
      pending: observation.restart.pending,
      requestId: observation.restart.requestId?.slice(0, 160) || null,
      lastAckId: observation.restart.lastAckId?.slice(0, 160) || null,
      lastAckAction: observation.restart.lastAckAction?.slice(0, 120) || null,
    },
    transport: "not-observed",
    projection,
  };
}

export function buildRuntimeHealthNoticeInput(
  current: RuntimeHealthSnapshot,
  previous: RuntimeHealthSnapshot | null,
): BridgeNoticeInput | null {
  const decision = evaluateMssrOperationalNoticeTransition({
    subject: "bridge-infrastructure",
    source: "mssr-runtime-health",
    code: "mssr-infrastructure-health-review",
    resolutionCode: "mssr-infrastructure-health-resolved",
    currentLevel: current.projection.level,
    previousLevel: previous?.projection.level ?? null,
    currentFingerprint: current.projection.fingerprint,
    previousFingerprint: previous?.projection.fingerprint ?? null,
    notifyOnWatch: current.projection.notifyOnWatch || previous?.projection.notifyOnWatch === true,
    message: `Bridge infrastructure requiere atención: ${current.projection.reasonCodes.join(", ") || current.projection.level}. Un síntoma de transporte no prueba por sí solo que una operación haya fallado.`,
    resolutionMessage: "Bridge infrastructure volvió a un estado operacional sin atención pendiente.",
    recommendation: current.restart.pending
      ? "Espera/inspecciona el ack del watchdog antes de solicitar otro restart."
      : "Correlaciona tunnel/runtime/restart con métricas de la operación antes de reiniciar o atribuir una falla.",
  });

  return adaptMssrOperationalDecision(decision, {
    observedAt: current.observedAt,
    tunnel: current.tunnel,
    runtime: {
      version: current.runtime.version,
      continuity: current.runtime.continuity,
    },
    restart: current.restart,
    transport: current.transport,
    reasonCodes: current.projection.reasonCodes,
    advisoryOnly: true,
    privacy: {
      promptStored: false,
      restartReasonStored: false,
      requestPayloadStored: false,
    },
  }, decision.event === "resolved" ? [] : [{
    label: "Verificar Bridge",
    toolName: "bridge_health",
    arguments: { check: "all" },
    instruction: "Verifica tunnel, runtime y restart. No solicites otro restart si ya existe uno pendiente y no atribuyas una respuesta perdida a una operación fallida sin evidencia adicional.",
  }]);
}

export async function captureRuntimeHealth(
  observation: RuntimeHealthObservation,
): Promise<{ current: RuntimeHealthSnapshot; previous: RuntimeHealthSnapshot | null; notice: BridgeNoticeInput | null }> {
  const store = await readStore();
  const previous = store.snapshots.at(-1) ?? null;
  const current = buildRuntimeHealthSnapshot(observation, previous);
  const notice = buildRuntimeHealthNoticeInput(current, previous);
  const next: RuntimeHealthStore = {
    ...emptyStore(),
    snapshots: [...store.snapshots, current].slice(-MAX_SNAPSHOTS),
  };
  await writeStore(next);
  return { current, previous, notice };
}

export async function getRuntimeHealthReport(): Promise<RuntimeHealthStore & { latest: RuntimeHealthSnapshot | null }> {
  const store = await readStore();
  return { ...store, latest: store.snapshots.at(-1) ?? null };
}

export function startRuntimeHealthScheduler(options: {
  observe: () => Promise<RuntimeHealthObservation>;
  onNotice?: (notice: BridgeNoticeInput) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}): { stop: () => void; runNow: () => Promise<void> } {
  let running = false;
  const runNow = async () => {
    if (running) return;
    running = true;
    try {
      const result = await captureRuntimeHealth(await options.observe());
      if (result.notice) options.onNotice?.(result.notice);
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
