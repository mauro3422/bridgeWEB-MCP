import {
  evaluateMssrConsistencyDecisionSupport,
  evaluateMssrOperationalNoticeTransition,
  type MssrConsistencyAction,
  type MssrConsistencyBoundary,
  type MssrConsistencyDecisionSupport,
  type MssrConsistencyObservation,
} from "@mauroprime/mssr";
import type { BridgeNoticeAction, BridgeNoticeInput } from "./notices.js";
import { adaptMssrOperationalDecision } from "./operational-notices.js";

type JsonRecord = Record<string, unknown>;

export type MssrConsistencyNoticeObservation = {
  subject: string;
  source: string;
  boundary?: MssrConsistencyBoundary;
  observations: readonly MssrConsistencyObservation[];
  details?: JsonRecord;
  code?: string;
  errorCode?: string;
  resolutionCode?: string;
  message?: string;
  resolutionMessage?: string;
  projectRoot?: string | null;
};

export function bridgeActionForMssrConsistencyAction(
  action: MssrConsistencyAction,
  projectRoot?: string | null,
): BridgeNoticeAction {
  switch (action) {
    case "verify-live-runtime":
      return {
        label: "Verificar runtime Bridge",
        toolName: "bridge_health",
        arguments: { check: "all" },
        instruction: "Lee el runtime vivo antes de solicitar otro restart; un ack de watchdog no prueba por sí solo que se adoptaron los bytes/versiones pretendidos.",
      };
    case "rebuild-generated-artifact":
      return {
        label: "Reconstruir artefacto generado",
        instruction: "Ejecuta el build canónico del owner y vuelve a comparar source/generated antes de adoptar el runtime. Este aviso no ejecuta el build.",
      };
    case "refresh-installed-artifact":
      return {
        label: "Actualizar artefacto instalado",
        instruction: "Instala o refresca únicamente el paquete versionado verificado por el workflow normal y vuelve a comprobar paridad. Este aviso no instala nada.",
      };
    case "inspect-source-replica":
      return {
        label: "Comparar source y réplica",
        instruction: "Compara la autoridad canónica con la réplica señalada y determina cuál necesita regeneración o actualización; no sobrescribas la autoridad desde el aviso.",
      };
    case "inspect-canonical-authorities":
      return {
        label: "Resolver autoridades canónicas",
        instruction: "Hay dos autoridades declaradas como canónicas que no concuerdan. Resuelve ownership/source-of-truth antes de continuar; no elijas una por heurística.",
      };
    case "load-canonical-authority":
      return {
        label: "Cargar autoridad canónica",
        ...(projectRoot ? { toolName: "project_context_load", arguments: { projectRoot } } : {}),
        instruction: "Carga/lee la fuente canónica indicada antes de confiar en la réplica, memoria o receipt. El aviso no convierte evidencia histórica en verdad presente.",
      };
    case "revalidate-context-evidence":
      return {
        label: "Revalidar evidencia de contexto",
        ...(projectRoot ? { toolName: "project_context_load", arguments: { projectRoot } } : {}),
        instruction: "Revalida provenance/revision contra el owner actual y vuelve a cargar sólo el contexto necesario. Freshness del receipt no implica que su claim siga siendo consistente con el presente.",
      };
    case "review-stale-claim":
      return {
        label: "Revisar claim stale",
        instruction: "Conserva la evidencia histórica si sigue siendo útil, pero evita usarla como estado presente hasta reconciliarla con la autoridad actual.",
      };
    case "replan-current-context":
      return {
        label: "Replanificar contexto actual",
        instruction: "Replanifica la fase/tarea usando evidencia actualizada; no reutilices ciegamente un receipt o memory claim que C2c marcó como stale.",
      };
  }
}

export function buildMssrConsistencyReadyActions(
  projection: MssrConsistencyDecisionSupport,
  projectRoot?: string | null,
): BridgeNoticeAction[] {
  const result: BridgeNoticeAction[] = [];
  for (const recommendation of projection.recommendations) {
    if (recommendation.status !== "ready") continue;
    const action = bridgeActionForMssrConsistencyAction(recommendation.action, projectRoot);
    const identity = `${action.toolName ?? "instruction"}:${action.label}`;
    if (!result.some((item) => `${item.toolName ?? "instruction"}:${item.label}` === identity)) result.push(action);
    if (result.length >= 4) break;
  }
  return result;
}

function defaultMessage(projection: MssrConsistencyDecisionSupport): string {
  const codes = projection.reasonCodes.join(", ") || "sin inconsistencias";
  const next = projection.nextAction ? ` Próxima acción C2d: ${projection.nextAction}.` : "";
  return `C2c consistency ${projection.level.toUpperCase()}: ${codes}.${next} Freshness y consistencia presente se evalúan por separado.`;
}

export function createMssrConsistencyNoticeTracker() {
  const previousBySubject = new Map<string, MssrConsistencyDecisionSupport>();

  return {
    observe(input: MssrConsistencyNoticeObservation): {
      notice: BridgeNoticeInput | null;
      projection: MssrConsistencyDecisionSupport;
    } {
      const current = evaluateMssrConsistencyDecisionSupport({
        boundary: input.boundary ?? "ordinary",
        observations: input.observations,
      });
      const previous = previousBySubject.get(input.subject) ?? null;
      previousBySubject.set(input.subject, current);

      const decision = evaluateMssrOperationalNoticeTransition({
        subject: input.subject,
        source: input.source,
        code: current.level === "error"
          ? input.errorCode ?? input.code ?? "mssr-consistency-error"
          : input.code ?? "mssr-consistency-review",
        resolutionCode: input.resolutionCode ?? "mssr-consistency-resolved",
        currentLevel: current.level,
        previousLevel: previous?.level ?? null,
        currentFingerprint: current.fingerprint,
        previousFingerprint: previous?.fingerprint ?? null,
        notifyOnWatch: current.notifyOnWatch,
        message: input.message ?? defaultMessage(current),
        resolutionMessage: input.resolutionMessage ?? `C2c consistency de ${input.subject} volvió a un estado no accionable.`,
        recommendation: "Usa primero la acción C2d `ready` con mayor rango y vuelve a observar antes de avanzar a dependencias diferidas. El plan es advisory: C2c/C2d no autoriza escrituras, builds, instalaciones ni restarts.",
      });

      const notice = adaptMssrOperationalDecision(decision, {
        ...input.details,
        boundary: current.boundary,
        level: current.level,
        evidenceComplete: current.evidenceComplete,
        reasonCodes: current.reasonCodes,
        keysObserved: current.keysObserved,
        mismatches: current.mismatches,
        recommendedActions: current.recommendedActions,
        recommendationPolicy: current.recommendationPolicy,
        recommendationMode: current.recommendationMode,
        nextAction: current.nextAction,
        recommendations: current.recommendations,
        repairDeferred: current.repairDeferred,
        abstentionReasons: current.abstentionReasons,
        advisoryOnly: true,
        privacy: {
          rawFileContentsStored: false,
          rawMemoryStored: false,
          rawPromptStored: false,
          transcriptStored: false,
          privateReasoningStored: false,
        },
      }, decision.event === "resolved" ? [] : buildMssrConsistencyReadyActions(current, input.projectRoot));

      return { notice, projection: current };
    },

    clear(subject?: string): void {
      if (subject) previousBySubject.delete(subject);
      else previousBySubject.clear();
    },
  };
}
