import { SERVER_VERSION } from "./config.js";
import {
  inspectRobloxStudioState,
  type RobloxStudioInstance,
} from "./integrations/roblox-mcp-client.js";
import type { BridgeNoticeInput } from "./notices.js";

export type MssrSystemTargetState =
  | "catalog-unavailable"
  | "catalog-degraded"
  | "studio-inspection-failed"
  | "studio-warming-up"
  | "no-studio"
  | "single-studio-inactive"
  | "multiple-studios-no-active"
  | "active-edit"
  | "active-play"
  | "active-unknown";

type RobloxSourceHealth = {
  status: "healthy" | "degraded" | "unavailable";
  liveToolCount: number;
  effectiveToolCount: number;
  skillCount: number;
  usingCachedTools: boolean;
  warning?: string;
};

type SystemAwarenessInput = {
  intent: unknown;
  workflows?: unknown;
  robloxHealth?: RobloxSourceHealth;
};

type StudioInspection = {
  studios: RobloxStudioInstance[];
  activeStudio: RobloxStudioInstance | null;
  studioState: unknown | null;
  warning?: string;
  error?: string;
};

export type MssrSystemAwarenessStatus = {
  generatedAt: string;
  freshness: "live" | "cached-5s";
  trigger: "mssr-roblox-route";
  overallStatus: "healthy" | "attention" | "degraded" | "unavailable";
  summary: string;
  bridge: {
    status: "healthy";
    version: string;
    evidence: "current-mcp-tool-call";
  };
  roblox: {
    catalog: RobloxSourceHealth;
    target: {
      state: MssrSystemTargetState;
      studios: RobloxStudioInstance[];
      activeStudio: RobloxStudioInstance | null;
      mode: "Edit" | "Play" | "Unknown";
      recoverableWithoutRestart: boolean;
      recommendedAction: string;
      warning?: string;
      error?: string;
    };
  };
};

export type MssrSystemAwarenessResult = {
  status?: MssrSystemAwarenessStatus;
  notices: BridgeNoticeInput[];
};

const SNAPSHOT_TTL_MS = 5_000;
const STUDIO_WARMUP_GRACE_MS = 10_000;
let cachedSnapshot: { capturedAtMs: number; status: MssrSystemAwarenessStatus } | null = null;
let lastObservedState: MssrSystemTargetState | null = null;
let firstNoStudioAtMs: number | null = null;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isRobloxMssrRoute(intent: unknown, workflows: unknown = []): boolean {
  const record = intent && typeof intent === "object" && !Array.isArray(intent)
    ? intent as Record<string, unknown>
    : {};
  return stringArray(record.domains).includes("roblox")
    || stringArray(workflows).some((workflow) => workflow.startsWith("roblox-"));
}

function collectText(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) collectText(item, output);
}

export function parseRobloxStudioMode(studioState: unknown): "Edit" | "Play" | "Unknown" {
  const text: string[] = [];
  collectText(studioState, text);
  const match = text.join("\n").match(/Current Studio Mode:\s*(Edit|Play)/i);
  if (!match) return "Unknown";
  return match[1].toLowerCase() === "play" ? "Play" : "Edit";
}

export function classifyRobloxTargetState(input: {
  catalogStatus: RobloxSourceHealth["status"];
  studios: RobloxStudioInstance[];
  activeStudio: RobloxStudioInstance | null;
  mode: "Edit" | "Play" | "Unknown";
  inspectionError?: string;
}): MssrSystemTargetState {
  if (input.catalogStatus === "unavailable") return "catalog-unavailable";
  if (input.catalogStatus === "degraded") return "catalog-degraded";
  if (input.inspectionError) return "studio-inspection-failed";
  if (input.studios.length === 0) return "no-studio";
  if (!input.activeStudio) {
    return input.studios.length === 1 ? "single-studio-inactive" : "multiple-studios-no-active";
  }
  if (input.mode === "Edit") return "active-edit";
  if (input.mode === "Play") return "active-play";
  return "active-unknown";
}

function statePresentation(state: MssrSystemTargetState, studios: RobloxStudioInstance[]): {
  overallStatus: MssrSystemAwarenessStatus["overallStatus"];
  summary: string;
  recoverableWithoutRestart: boolean;
  recommendedAction: string;
} {
  switch (state) {
    case "active-edit":
      return { overallStatus: "healthy", summary: "Bridge y Roblox MCP sanos; Studio activo en Edit.", recoverableWithoutRestart: true, recommendedAction: "continue" };
    case "active-play":
      return { overallStatus: "healthy", summary: "Bridge y Roblox MCP sanos; Studio activo en Play con Client/Server disponibles.", recoverableWithoutRestart: true, recommendedAction: "continue" };
    case "single-studio-inactive":
      return { overallStatus: "attention", summary: `Roblox MCP está sano y ${studios[0]?.name ?? "un Studio"} está conectado, pero todavía no fue seleccionado como target.`, recoverableWithoutRestart: true, recommendedAction: "probe-get-studio-state" };
    case "multiple-studios-no-active":
      return { overallStatus: "attention", summary: "Hay varios Studios conectados y ninguno está seleccionado; se requiere un studioId explícito.", recoverableWithoutRestart: true, recommendedAction: "list-and-select-studio" };
    case "studio-warming-up":
      return { overallStatus: "attention", summary: "Roblox MCP está iniciando y todavía espera que Studio registre una instancia; no hace falta reiniciar.", recoverableWithoutRestart: true, recommendedAction: "wait-and-recheck" };
    case "no-studio":
      return { overallStatus: "attention", summary: "StudioMCP responde, pero no hay una instancia de Roblox Studio registrada después de la ventana de inicio.", recoverableWithoutRestart: true, recommendedAction: "open-or-reconnect-studio" };
    case "catalog-degraded":
      return { overallStatus: "degraded", summary: "El catálogo Roblox MCP está degradado o usando metadata no plenamente viva.", recoverableWithoutRestart: true, recommendedAction: "refresh-roblox-mcp-status" };
    case "catalog-unavailable":
      return { overallStatus: "unavailable", summary: "Roblox Studio MCP no está disponible para esta ruta MSSR.", recoverableWithoutRestart: false, recommendedAction: "diagnose-roblox-mcp" };
    case "studio-inspection-failed":
      return { overallStatus: "degraded", summary: "El catálogo Roblox MCP responde, pero falló la inspección de instancias Studio.", recoverableWithoutRestart: true, recommendedAction: "retry-roblox-mcp-status" };
    case "active-unknown":
      return { overallStatus: "attention", summary: "Studio está activo, pero el modo Edit/Play no pudo determinarse.", recoverableWithoutRestart: true, recommendedAction: "probe-get-studio-state" };
  }
}

function noticeForStatus(status: MssrSystemAwarenessStatus, previousState: MssrSystemTargetState | null): BridgeNoticeInput[] {
  const state = status.roblox.target.state;
  if (state === previousState) return [];

  if ((state === "active-edit" || state === "active-play") && previousState && previousState !== "active-edit" && previousState !== "active-play" && previousState !== "studio-warming-up") {
    return [{
      severity: "info",
      code: "mssr-system-recovered",
      source: "mssr-system-awareness",
      message: status.summary,
      details: { previousState, state, mode: status.roblox.target.mode, studio: status.roblox.target.activeStudio?.name ?? null },
      dedupeKey: `mssr-system-recovered:${previousState}:${state}`,
      ttlMs: 5 * 60 * 1000,
    }];
  }

  if (state === "active-edit" || state === "active-play" || state === "studio-warming-up") return [];

  const common = {
    source: "mssr-system-awareness",
    details: {
      state,
      studios: status.roblox.target.studios.map((studio) => ({ id: studio.id, name: studio.name, active: studio.active })),
      recoverableWithoutRestart: status.roblox.target.recoverableWithoutRestart,
      recommendedAction: status.roblox.target.recommendedAction,
    },
    dedupeKey: `mssr-system-awareness:${state}`,
    ttlMs: 10 * 60 * 1000,
  } satisfies Partial<BridgeNoticeInput>;

  if (state === "single-studio-inactive") {
    return [{
      ...common,
      severity: "info",
      code: "mssr-roblox-target-inactive",
      message: `${status.summary} No hace falta reiniciar.`,
      actions: [{
        label: "Activar y leer Studio",
        toolName: "roblox_mcp_query",
        arguments: { toolName: "get_studio_state", arguments: {} },
        instruction: "Selecciona la única instancia conectada y lee su modo sin reiniciar Studio ni el Bridge.",
      }],
    } as BridgeNoticeInput];
  }

  if (state === "multiple-studios-no-active") {
    return [{
      ...common,
      severity: "warning",
      code: "mssr-roblox-target-ambiguous",
      message: status.summary,
      actions: [{ label: "Listar Studios", toolName: "roblox_mcp_studio_list", arguments: {}, instruction: "Elige un studioId explícito antes de mutar." }],
    } as BridgeNoticeInput];
  }

  if (state === "no-studio") {
    return [{ ...common, severity: "warning", code: "mssr-roblox-studio-missing", message: status.summary } as BridgeNoticeInput];
  }

  return [{
    ...common,
    severity: state === "catalog-unavailable" ? "error" : "warning",
    code: `mssr-roblox-${state}`,
    message: status.summary,
    actions: [{ label: "Verificar Roblox MCP", toolName: "roblox_mcp_status", arguments: {}, instruction: "Obtén evidencia fresca antes de reiniciar procesos." }],
  } as BridgeNoticeInput];
}

export async function buildMssrSystemAwareness(input: SystemAwarenessInput): Promise<MssrSystemAwarenessResult> {
  if (!isRobloxMssrRoute(input.intent, input.workflows)) return { notices: [] };

  const now = Date.now();
  if (cachedSnapshot && now - cachedSnapshot.capturedAtMs <= SNAPSHOT_TTL_MS) {
    return {
      status: { ...cachedSnapshot.status, freshness: "cached-5s" },
      notices: [],
    };
  }

  const catalog = input.robloxHealth ?? {
    status: "unavailable" as const,
    liveToolCount: 0,
    effectiveToolCount: 0,
    skillCount: 0,
    usingCachedTools: false,
    warning: "Roblox source health was not provided by MSSR discovery.",
  };

  let inspection: StudioInspection = { studios: [], activeStudio: null, studioState: null };
  if (catalog.status !== "unavailable") {
    inspection = await inspectRobloxStudioState().catch((error) => ({
      studios: [],
      activeStudio: null,
      studioState: null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const mode = parseRobloxStudioMode(inspection.studioState);
  let state = classifyRobloxTargetState({
    catalogStatus: catalog.status,
    studios: inspection.studios,
    activeStudio: inspection.activeStudio,
    mode,
    inspectionError: inspection.error,
  });
  if (state === "no-studio") {
    firstNoStudioAtMs ??= now;
    if (now - firstNoStudioAtMs < STUDIO_WARMUP_GRACE_MS) state = "studio-warming-up";
  } else {
    firstNoStudioAtMs = null;
  }
  const presentation = statePresentation(state, inspection.studios);
  const status: MssrSystemAwarenessStatus = {
    generatedAt: new Date(now).toISOString(),
    freshness: "live",
    trigger: "mssr-roblox-route",
    overallStatus: presentation.overallStatus,
    summary: presentation.summary,
    bridge: {
      status: "healthy",
      version: SERVER_VERSION,
      evidence: "current-mcp-tool-call",
    },
    roblox: {
      catalog,
      target: {
        state,
        studios: inspection.studios,
        activeStudio: inspection.activeStudio,
        mode,
        recoverableWithoutRestart: presentation.recoverableWithoutRestart,
        recommendedAction: presentation.recommendedAction,
        warning: inspection.warning,
        error: inspection.error,
      },
    },
  };

  const notices = noticeForStatus(status, lastObservedState);
  lastObservedState = state;
  cachedSnapshot = { capturedAtMs: now, status };
  return { status, notices };
}
