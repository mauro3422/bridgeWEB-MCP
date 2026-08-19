import {
  evaluateMssrOperationalNoticeTransition,
  evaluateMssrRoutingComplianceOperationalAttention,
  type MssrRoutingComplianceObservation,
  type MssrRoutingComplianceOperationalProjection,
} from "@mauroprime/mssr";
import type { BridgeNoticeAction, BridgeNoticeInput } from "./notices.js";

type JsonRecord = Record<string, unknown>;

type RoutingComplianceNoticeObservation = {
  subject: string;
  source: string;
  observation: MssrRoutingComplianceObservation;
  traceId?: string | null;
  details?: JsonRecord;
  code?: string;
  errorCode?: string;
  resolutionCode?: string;
  message?: string;
  resolutionMessage?: string;
};

function actionList(
  projection: MssrRoutingComplianceOperationalProjection,
  traceId?: string | null,
): BridgeNoticeAction[] {
  const actions: BridgeNoticeAction[] = [];
  const add = (action: BridgeNoticeAction) => {
    if (!actions.some((item) => item.label === action.label && item.toolName === action.toolName)) actions.push(action);
  };

  if (projection.recommendedActions.includes("inspect-traces")) {
    add(traceId
      ? {
          label: "Inspeccionar traza MSSR",
          toolName: "mssr_trace_evidence",
          arguments: { traceId },
          instruction: "Verifica la identidad/lifecycle de esta traza antes de continuar o reasignar trabajo.",
        }
      : {
          label: "Inspeccionar trazas MSSR",
          toolName: "mssr_observatory_query",
          instruction: "Identifica una única traza compatible; no adivines entre tareas o agentes concurrentes.",
        });
  }

  if (projection.recommendedActions.includes("start-route") || projection.recommendedActions.includes("bootstrap-current-phase")) {
    add({
      label: "Cargar fase MSSR",
      toolName: "skill_bootstrap",
      instruction: traceId
        ? "Reusa la traceId actual y la tarea/intención resueltas; carga automáticamente las skills requeridas de la fase antes de continuar."
        : "Abre una ruta con la tarea e intent estructurado actuales; carga automáticamente las skills requeridas antes de continuar trabajo sustancial.",
    });
  }

  if (projection.recommendedActions.includes("load-required-skills")) {
    for (const name of projection.recommendedRequiredSkills.slice(0, 2)) {
      add({
        label: `Cargar ${name}`,
        toolName: "skill_load",
        ...(traceId ? { arguments: { name, traceId, required: true } } : {}),
        instruction: traceId
          ? "Carga esta skill requerida sobre la traza activa. Si la fase cambió, prefiere skill_bootstrap para reensamblar el contexto completo."
          : "Primero recupera/crea una traza inequívoca; luego carga la skill requerida o usa skill_bootstrap.",
      });
    }
  }

  if (projection.recommendedActions.includes("complete-required-phases") || projection.recommendedActions.includes("replan-current-trace")) {
    add({
      label: "Replanificar traza MSSR",
      toolName: "skill_bootstrap",
      instruction: "Reusa la traza/tarea correctas, avanza a la fase correspondiente y completa las obligaciones pendientes antes de cerrar.",
    });
  }

  if (projection.recommendedActions.includes("record-or-resume-outcome")) {
    add(traceId
      ? {
          label: "Revisar cierre de traza",
          toolName: "mssr_trace_evidence",
          arguments: { traceId },
          instruction: "Decide si debes reanudar esta tarea o completar su outcome antes de reemplazarla por otra ruta.",
        }
      : {
          label: "Revisar trazas abiertas",
          toolName: "mssr_observatory_query",
          instruction: "Resuelve la traza previa sin outcome antes de atribuir trabajo sustancial a una tarea nueva.",
        });
  }

  return actions.slice(0, 4);
}

function defaultMessage(projection: MssrRoutingComplianceOperationalProjection): string {
  const skills = projection.recommendedRequiredSkills.length > 0
    ? ` Skills requeridas faltantes: ${projection.recommendedRequiredSkills.join(", ")}.`
    : "";
  return `Routing compliance ${projection.level.toUpperCase()}: ${projection.reasonCodes.join(", ") || "sin anomalías"}.${skills}`;
}

export function createMssrRoutingComplianceNoticeTracker() {
  const previousBySubject = new Map<string, MssrRoutingComplianceOperationalProjection>();

  return {
    observe(input: RoutingComplianceNoticeObservation): { notice: BridgeNoticeInput | null; projection: MssrRoutingComplianceOperationalProjection } {
      const current = evaluateMssrRoutingComplianceOperationalAttention(input.observation);
      const previous = previousBySubject.get(input.subject) ?? null;
      previousBySubject.set(input.subject, current);

      const decision = evaluateMssrOperationalNoticeTransition({
        subject: input.subject,
        source: input.source,
        code: current.level === "error"
          ? input.errorCode ?? input.code ?? "mssr-routing-compliance-error"
          : input.code ?? "mssr-routing-compliance-review",
        resolutionCode: input.resolutionCode ?? "mssr-routing-compliance-resolved",
        currentLevel: current.level,
        previousLevel: previous?.level ?? null,
        currentFingerprint: current.fingerprint,
        previousFingerprint: previous?.fingerprint ?? null,
        notifyOnWatch: current.notifyOnWatch,
        message: input.message ?? defaultMessage(current),
        resolutionMessage: input.resolutionMessage ?? `Routing compliance de ${input.subject} volvió a un estado no accionable.`,
        recommendation: "Usa la evidencia y las acciones sugeridas para recuperar routing/trace/skills; la proyección no autoriza mutaciones ni ejecución por sí sola.",
      });

      if (!decision.notice) return { notice: null, projection: current };
      return {
        projection: current,
        notice: {
          severity: decision.notice.severity,
          code: decision.notice.code,
          source: decision.notice.source,
          message: decision.notice.message,
          details: {
            ...input.details,
            ...decision.notice.details,
            traceId: input.traceId ?? null,
            trace: current.trace,
            route: current.route,
            boundary: current.boundary,
            reasonCodes: current.reasonCodes,
            recommendedRequiredSkills: current.recommendedRequiredSkills,
            missingRequiredPhases: current.missingRequiredPhases,
            recommendedActions: current.recommendedActions,
          },
          actions: actionList(current, input.traceId),
          dedupeKey: decision.notice.dedupeKey,
        },
      };
    },

    clear(subject?: string): void {
      if (subject) previousBySubject.delete(subject);
      else previousBySubject.clear();
    },
  };
}
