import {
  evaluateMssrToolFrictionOperationalAttention,
  type MssrToolFrictionObservation,
  type MssrToolFrictionOperationalProjection,
} from "@mauroprime/mssr";
import {
  classifyToolAuditError,
  type ToolFrictionMetricSnapshot,
} from "./metrics.js";

export type BridgeToolFrictionProjection = Readonly<{
  scope: ToolFrictionMetricSnapshot["scope"];
  days: number;
  since: string;
  metricsAvailable: boolean;
  observedFailures: number;
  classifiedFailures: number;
  ignoredUnclassifiedFailures: number;
  clusters: readonly MssrToolFrictionOperationalProjection[];
}>;

function sanitizeSchemaField(value: string | undefined): string | undefined {
  const bounded = String(value ?? "").trim().slice(0, 80);
  return /^[A-Za-z0-9_.-]+$/.test(bounded) ? bounded : undefined;
}

function zodField(error: string): string | undefined {
  const match = error.match(/"path"\s*:\s*\[\s*"([A-Za-z0-9_.-]{1,80})"/i);
  return sanitizeSchemaField(match?.[1]);
}

function zodCode(error: string): string | undefined {
  return error.match(/"code"\s*:\s*"([a-z0-9_-]{1,48})"/i)?.[1]?.toLowerCase();
}

/**
 * Reduce one locally-redacted Bridge error to a stable, bounded classification.
 * Numeric limits, file paths, commands, payloads and free-form error text are
 * intentionally discarded so equivalent incidents survive harmless wording or
 * limit changes without becoming portable telemetry.
 */
export function classifyBridgeToolFrictionSignature(errorValue: string | null | undefined): string | null {
  const error = String(errorValue ?? "");
  if (!error.trim()) return null;

  const code = zodCode(error);
  const field = zodField(error) ?? "input";
  if (code === "too_big") return `schema:${field}:maximum`;
  if (code === "too_small") return `schema:${field}:minimum`;
  if (code === "invalid_type") return `schema:${field}:type`;
  if (code === "unrecognized_keys") return "schema:input:unrecognized-keys";

  const category = classifyToolAuditError(error);
  if (category === "schema-validation") return `schema:${field}:validation`;
  if (category === "patch-conflict") return "patch:replacement-conflict";
  if (category === "target-not-found") return "target:not-found";
  if (category === "permission-or-risk-mismatch") return "policy:risk-mismatch";
  if (category === "timeout") return "runtime:timeout";
  if (category === "provider-unavailable") return "transport:provider-unavailable";
  if (category === "safety-guard") return "policy:safety-guard";
  if (category === "runtime-internal") return "runtime:internal";
  if (category === "expected-integrity-mismatch") return "integrity:mismatch";
  if (category === "stale-file-state") return "state:stale";
  if (category === "invalid-image-payload") return "image:invalid-payload";
  if (category === "source-file-unavailable") return "source:unavailable";
  if (category === "missing-upstream") return "git:missing-upstream";
  if (category === "no-remote-configured") return "git:no-remote";
  // A child process returning non-zero is normally evidence about the invoked
  // command/project, not about the Bridge tool contract itself. Keep it in the
  // aggregate audit, but do not route it as tool-maintenance friction.
  if (category === "process-exit") return null;

  // Unknown free-form text is deliberately not clustered: over-grouping unrelated
  // failures would create misleading maintenance evidence and could leak detail.
  return null;
}

export function buildBridgeToolFrictionProjection(
  snapshot: ToolFrictionMetricSnapshot,
  evaluatedAt = new Date().toISOString(),
  maxGroups = 100,
): BridgeToolFrictionProjection {
  const observations: MssrToolFrictionObservation[] = [];
  let ignoredUnclassifiedFailures = 0;

  for (const row of snapshot.rows) {
    const signature = classifyBridgeToolFrictionSignature(row.error);
    if (!signature) {
      ignoredUnclassifiedFailures += 1;
      continue;
    }
    observations.push({
      toolName: row.toolName,
      signature,
      observedAt: row.observedAt,
      ...(row.workflowKey ? { workflowKey: row.workflowKey } : {}),
      ...(row.traceId ? { traceId: row.traceId } : {}),
      severity: "error",
    });
  }

  return {
    scope: snapshot.scope,
    days: snapshot.days,
    since: snapshot.since,
    metricsAvailable: snapshot.sqliteAvailable,
    observedFailures: snapshot.rows.length,
    classifiedFailures: observations.length,
    ignoredUnclassifiedFailures,
    clusters: evaluateMssrToolFrictionOperationalAttention(observations, { evaluatedAt, maxGroups }),
  };
}
