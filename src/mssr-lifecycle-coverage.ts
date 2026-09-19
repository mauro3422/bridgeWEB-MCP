import { evaluateMssrLifecycleActivation } from "@mauroprime/mssr";
import type { MssrTraceSessionSnapshot } from "./mssr-trace-context.js";
import type { BridgeToolSchema } from "./tools/types.js";

export type BridgeMssrLifecyclePreflightInput = {
  tool: BridgeToolSchema;
  trace: MssrTraceSessionSnapshot;
  projectScoped: boolean;
};

export type BridgeMssrLifecyclePreflight = {
  intercepted: boolean;
  originalTool: string;
  effect: string;
  scale: string;
  traceId: string | null;
  routePresent: boolean;
  decision: ReturnType<typeof evaluateMssrLifecycleActivation>;
  nextTool: "skill_bootstrap" | "mssr_trace_evidence" | "mssr_observatory_query" | null;
  instruction: string | null;
};

function traceState(trace: MssrTraceSessionSnapshot): "none" | "compatible" {
  return trace.active && !trace.closed && Boolean(trace.traceId) ? "compatible" : "none";
}

function preflightInstruction(
  action: ReturnType<typeof evaluateMssrLifecycleActivation>["action"],
  traceId: string | null,
): { nextTool: BridgeMssrLifecyclePreflight["nextTool"]; instruction: string | null } {
  if (action === "inspect-traces") {
    return traceId
      ? {
          nextTool: "mssr_trace_evidence",
          instruction: "Inspecciona la traza indicada y conserva su owner; no migres project/workflow para satisfacer esta operación.",
        }
      : {
          nextTool: "mssr_observatory_query",
          instruction: "Resuelve primero una traza inequívoca para este proyecto/workflow; no adivines entre tareas concurrentes.",
        };
  }
  if (action === "ensure-trace-and-route") {
    return {
      nextTool: "skill_bootstrap",
      instruction: "Ejecuta skill_bootstrap con la tarea e intent MSSR estructurado actuales. Procesa el contexto/skills devueltos y luego reintenta la operación original; Bridge no ejecutó la mutación.",
    };
  }
  if (action === "ensure-route") {
    return {
      nextTool: "skill_bootstrap",
      instruction: "Reusa la traceId actual en skill_bootstrap con la tarea/intención resueltas para cargar la ruta/fase requerida. Procesa el contexto y luego reintenta la operación original.",
    };
  }
  if (action === "replan-managed-route") {
    return {
      nextTool: "skill_bootstrap",
      instruction: "Replanifica la fase MSSR sobre la traceId actual, procesa las obligaciones devueltas y luego reintenta la operación original.",
    };
  }
  return { nextTool: null, instruction: null };
}

export function evaluateBridgeMssrLifecyclePreflight(input: BridgeMssrLifecyclePreflightInput): BridgeMssrLifecyclePreflight {
  const metadata = input.tool.metadata?.mssrLifecycle ?? { effect: "unknown" as const, scale: "unknown" as const };
  const trace = traceState(input.trace);
  const routePresent = trace === "compatible" && input.trace.routeCount > 0 && input.trace.missingRequiredSkills.length === 0;
  const decision = evaluateMssrLifecycleActivation({
    effect: metadata.effect,
    scale: metadata.scale,
    trace,
    route: routePresent ? "present" : "none",
    projectScoped: input.projectScoped,
    phaseBoundary: false,
  });
  const intercepted = decision.mode === "review"
    || (decision.lifecycleRequired && decision.action !== "continue-managed-route");
  const recovery = preflightInstruction(decision.action, input.trace.traceId);
  return {
    intercepted,
    originalTool: input.tool.name,
    effect: metadata.effect,
    scale: metadata.scale,
    traceId: input.trace.traceId,
    routePresent,
    decision,
    nextTool: intercepted ? recovery.nextTool : null,
    instruction: intercepted ? recovery.instruction : null,
  };
}
