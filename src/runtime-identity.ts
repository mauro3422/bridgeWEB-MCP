import { randomUUID } from "node:crypto";

export const RUNTIME_BOOT_ID = randomUUID();
export const RUNTIME_STARTED_AT = new Date().toISOString();

const WORKFLOW_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;

export function normalizeWorkflowKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80);
  return WORKFLOW_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

export function requireWorkflowKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = normalizeWorkflowKey(value);
  if (!normalized) {
    throw new Error("workflowKey must normalize to 2-80 lowercase letters, numbers, dots, underscores, or hyphens.");
  }
  return normalized;
}

export function resolveMetricWorkflowKey(args: {
  startsNewRoute: boolean;
  traceId?: string | null;
  traceWorkflowKey?: string | null;
  explicitWorkflowKey?: unknown;
  sessionWorkflowKey?: unknown;
  localWorkflowKey?: unknown;
}): string | undefined {
  if (!args.startsNewRoute && args.traceId) {
    return normalizeWorkflowKey(args.traceWorkflowKey) ?? "unscoped";
  }
  if (args.startsNewRoute) return normalizeWorkflowKey(args.explicitWorkflowKey);
  return normalizeWorkflowKey(args.explicitWorkflowKey)
    ?? normalizeWorkflowKey(args.sessionWorkflowKey)
    ?? normalizeWorkflowKey(args.localWorkflowKey);
}

const TASK_KEY_PATTERN = /^task_[0-9a-f]{16}$/;

function normalizeTaskKey(value: unknown): string | undefined {
  return typeof value === "string" && TASK_KEY_PATTERN.test(value) ? value : undefined;
}

export function resolveMetricTaskKey(args: {
  startsNewRoute: boolean;
  traceId?: string | null;
  traceTaskHash?: string | null;
  explicitTaskKey?: unknown;
  sessionTaskKey?: unknown;
  localTaskKey?: unknown;
}): string | undefined {
  if (!args.startsNewRoute && args.traceId && typeof args.traceTaskHash === "string" && /^[0-9a-f]{64}$/.test(args.traceTaskHash)) {
    return `task_${args.traceTaskHash.slice(0, 16)}`;
  }
  if (args.startsNewRoute) return normalizeTaskKey(args.explicitTaskKey);
  return normalizeTaskKey(args.explicitTaskKey)
    ?? normalizeTaskKey(args.sessionTaskKey)
    ?? normalizeTaskKey(args.localTaskKey);
}
