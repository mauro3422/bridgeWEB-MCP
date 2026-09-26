import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type UnknownRecord = Record<string, unknown>;

const PHASE_ORDER = ["discovery", "safety", "implementation", "verification", "persistence", "maintenance"] as const;
type PhaseName = typeof PHASE_ORDER[number];

type LifecycleEvent = {
  traceId: string;
  eventType: string;
  occurredAt: string;
  caller: string | null;
  stage: string | null;
  skillName: string | null;
  ok: boolean | null;
  details: UnknownRecord;
};

export type CockpitGitState = {
  project: string;
  relativeRoot: string;
  branch: string | null;
  trackedChanges: number | null;
  untrackedChanges: number | null;
  clean: boolean | null;
  remotes: string[];
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  commitCount: number | null;
  latestCommitHash: string | null;
  latestCommitAt: string | null;
  latestCommitSubject: string | null;
  observedAt: string;
  error: string | null;
};

export function buildCapabilityInventory(input: {
  toolCatalog: unknown;
  skillHealth: unknown;
  workflowGuideCount?: number;
  observedAt?: string;
}) {
  const tools = asArray(input.toolCatalog).map(asRecord);
  const providerDependentFamilies = new Set([
    "blender",
    "godot",
    "roblox-studio-ops",
    "roblox-assets",
    "roblox-photo-capture",
    "remote-node",
    "tablet-whiteboard",
    "quietdesk",
    "windows-admin",
  ]);
  const families = new Map<string, { family: string; toolCount: number; readOnlyCount: number; mutableCount: number; lifecycle: Set<string> }>();
  for (const tool of tools) {
    const metadata = asRecord(tool.metadata);
    const annotations = asRecord(tool.annotations);
    const family = stringValue(metadata.family) ?? "other";
    const current = families.get(family) ?? { family, toolCount: 0, readOnlyCount: 0, mutableCount: 0, lifecycle: new Set<string>() };
    current.toolCount += 1;
    if (annotations.readOnlyHint === true) current.readOnlyCount += 1;
    else current.mutableCount += 1;
    const lifecycle = stringValue(metadata.lifecycle);
    if (lifecycle) current.lifecycle.add(lifecycle);
    families.set(family, current);
  }

  const skillRoot = asRecord(input.skillHealth);
  const skillLatest = asRecord(skillRoot.latest);
  const skillCounts = asRecord(skillLatest.counts);
  const skillReview = skillLatest.maintenanceRequired === true || skillLatest.healthReviewRecommended === true;
  const familyRows = [...families.values()]
    .map((family) => ({
      family: family.family,
      label: family.family.replace(/[-_]+/g, " ").replace(/^./, (value) => value.toUpperCase()),
      toolCount: family.toolCount,
      readOnlyCount: family.readOnlyCount,
      mutableCount: family.mutableCount,
      lifecycle: [...family.lifecycle].sort(),
      status: providerDependentFamilies.has(family.family) ? "review" : "available",
      basis: providerDependentFamilies.has(family.family)
        ? "registered-contract; live provider is intentionally not probed during dashboard refresh"
        : "registered runtime tool catalog",
    }))
    .sort((left, right) => right.toolCount - left.toolCount || left.family.localeCompare(right.family));

  return {
    schemaVersion: 1,
    observedAt: input.observedAt ?? new Date().toISOString(),
    sourceMode: "dynamic-owner-projection",
    toolCount: tools.length,
    familyCount: familyRows.length,
    workflowGuideCount: Math.max(0, Number(input.workflowGuideCount ?? 0) || 0),
    skills: {
      observedAt: stringValue(skillLatest.observedAt) ?? stringValue(skillRoot.updatedAt),
      catalogSkills: Number(skillCounts.catalogSkills ?? 0) || 0,
      ownedSkills: Number(skillCounts.ownedSkills ?? 0) || 0,
      explicitRouting: Number(skillCounts.explicitRouting ?? 0) || 0,
      status: skillReview ? "review" : "available",
      note: skillReview
        ? "Skill Health tiene mantenimiento/revisión pendiente; el catálogo sigue siendo evidencia, no una lista hardcodeada."
        : "Skill Health no reporta revisión estructural pendiente.",
    },
    families: familyRows,
    notes: [
      "Las capacidades se derivan del catálogo runtime y Skill Health; no se duplican en AGENTS ni en memoria de chat.",
      "Familias dependientes de Blender/Godot/Roblox u otros providers quedan en review hasta una comprobación live bajo demanda.",
    ],
  };
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return asArray(value).flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}

function phaseArray(value: unknown): PhaseName[] {
  const allowed = new Set<string>(PHASE_ORDER);
  return stringArray(value).filter((item): item is PhaseName => allowed.has(item));
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type HumanWorkState = "active" | "review-needed" | "paused" | "finished" | "experimental" | "abandoned-or-replaced";
type HumanWorkClassification = {
  state: HumanWorkState;
  confidence: "high" | "medium" | "low";
  basis: "mssr-lifecycle" | "project-health" | "recency" | "explicit-label" | "mixed" | "insufficient-evidence";
  observed: boolean;
  reason: string;
};

function hasExplicitExperimentMarker(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => /(^|[-_.:])(experiment|experimental|prototype|spike)([-_.:]|$)/i.test(value ?? ""));
}

function classifyOpenHumanTask(input: {
  needsClosureReview: boolean;
  workflowKey: string | null;
  taskKey: string;
  latestAt: string;
  latestStage: string | null;
  nextGate: string;
}, now: Date): HumanWorkClassification {
  if (input.needsClosureReview) {
    return {
      state: "review-needed",
      confidence: "high",
      basis: "mssr-lifecycle",
      observed: true,
      reason: "MSSR observó trabajo sustantivo y un recordatorio de cierre sin outcome posterior; requiere revisión humana, no auto-cierre.",
    };
  }
  if (hasExplicitExperimentMarker(input.workflowKey, input.taskKey)) {
    return {
      state: "experimental",
      confidence: "medium",
      basis: "explicit-label",
      observed: false,
      reason: "La identidad observable declara explícitamente experiment/prototype/spike; es una clasificación de organización, no lifecycle authority.",
    };
  }
  const latest = timestamp(input.latestAt);
  if (latest <= 0) {
    return {
      state: "review-needed",
      confidence: "low",
      basis: "insufficient-evidence",
      observed: false,
      reason: "No hay timestamp suficiente para clasificar esta tarea sin inventar estado; requiere revisión humana.",
    };
  }
  const ageMs = Math.max(0, now.getTime() - latest);
  if (["verify", "persist", "close"].includes(input.latestStage ?? "") || ["verificar", "persistir", "cerrar"].includes(input.nextGate)) {
    return {
      state: "active",
      confidence: ageMs <= 48 * 60 * 60 * 1000 ? "high" : "medium",
      basis: "mssr-lifecycle",
      observed: true,
      reason: `MSSR dejó un próximo gate explícito (${input.nextGate}); el tiempo transcurrido no autoriza a cerrarla.`,
    };
  }
  if (ageMs <= 18 * 60 * 60 * 1000) {
    return {
      state: "active",
      confidence: "medium",
      basis: "recency",
      observed: false,
      reason: "Actividad sustantiva reciente dentro de 18 h; se proyecta activa hasta observar un outcome o evidencia contraria.",
    };
  }
  if (ageMs >= 48 * 60 * 60 * 1000) {
    return {
      state: "paused",
      confidence: "low",
      basis: "recency",
      observed: false,
      reason: "No se observó actividad reciente por al menos 48 h. Pausada es una inferencia conservadora: no significa terminada.",
    };
  }
  return {
    state: "active",
    confidence: "low",
    basis: "recency",
    observed: false,
    reason: "Hay una traza humana abierta reciente, pero sin un gate fuerte suficiente para elevar la confianza.",
  };
}

function classifyWeeklyProject(input: {
  name: string;
  healthLevel: string;
  substantiveTraceCount: number;
  closedTraceCount: number;
  workflowKeys: string[];
  latestAt: string | null;
  openTasks: Array<{ classification: HumanWorkClassification }>;
}, now: Date): HumanWorkClassification {
  if (input.openTasks.some((task) => task.classification.state === "review-needed")) {
    return {
      state: "review-needed",
      confidence: "high",
      basis: "mssr-lifecycle",
      observed: true,
      reason: "Al menos una tarea humana requiere revisión de cierre o clasificación; el proyecto no se auto-cierra.",
    };
  }
  if (input.openTasks.some((task) => task.classification.state === "active")) {
    return {
      state: "active",
      confidence: "medium",
      basis: "mixed",
      observed: false,
      reason: "El proyecto conserva al menos una tarea humana abierta y activa en la ventana observable.",
    };
  }
  if (input.openTasks.length > 0 && input.openTasks.every((task) => task.classification.state === "experimental")) {
    return {
      state: "experimental",
      confidence: "medium",
      basis: "explicit-label",
      observed: false,
      reason: "Todas las tareas humanas abiertas están etiquetadas explícitamente como experimento/prototipo/spike.",
    };
  }
  if (input.openTasks.some((task) => task.classification.state === "paused")) {
    return {
      state: "paused",
      confidence: "low",
      basis: "recency",
      observed: false,
      reason: "Sólo quedan tareas humanas abiertas sin actividad reciente; pausado no significa terminado.",
    };
  }
  if (hasExplicitExperimentMarker(...input.workflowKeys)) {
    return {
      state: "experimental",
      confidence: "low",
      basis: "explicit-label",
      observed: false,
      reason: "El historial semanal contiene una identidad explícita de experimento/prototipo/spike, sin evidencia más fuerte.",
    };
  }

  const latest = timestamp(input.latestAt);
  const ageMs = latest > 0 ? Math.max(0, now.getTime() - latest) : Number.POSITIVE_INFINITY;
  if (input.substantiveTraceCount > 0 && input.closedTraceCount >= input.substantiveTraceCount) {
    if (ageMs >= 48 * 60 * 60 * 1000) {
      return {
        state: "paused",
        confidence: "low",
        basis: "mixed",
        observed: false,
        reason: "La actividad sustantiva observada en la semana quedó cerrada y no hay tarea abierta reciente; se proyecta pausado, no proyecto terminado.",
      };
    }
    return {
      state: "review-needed",
      confidence: "low",
      basis: "mssr-lifecycle",
      observed: true,
      reason: "Las trazas sustantivas de la ventana cerraron, pero MSSR no posee autoridad para declarar terminado el proyecto global; falta clasificación explícita si se quiere marcar finished.",
    };
  }
  if (input.healthLevel === "review") {
    return {
      state: "review-needed",
      confidence: "low",
      basis: "project-health",
      observed: true,
      reason: "Project Context Health requiere revisión y no hay evidencia de trabajo suficiente para asignar otro estado. La salud de contexto no equivale al estado funcional del proyecto.",
    };
  }
  return {
    state: "review-needed",
    confidence: "low",
    basis: "insufficient-evidence",
    observed: false,
    reason: "La evidencia disponible no alcanza para distinguir activo, pausado, finished o abandonado/reemplazado sin una clasificación explícita del owner.",
  };
}

function normalizeEvent(value: unknown): LifecycleEvent | null {
  const row = asRecord(value);
  const traceId = stringValue(row.traceId);
  const eventType = stringValue(row.eventType);
  const occurredAt = stringValue(row.occurredAt);
  if (!traceId || !eventType || !occurredAt) return null;
  return {
    traceId,
    eventType,
    occurredAt,
    caller: stringValue(row.caller),
    stage: stringValue(row.stage),
    skillName: stringValue(row.skillName),
    ok: typeof row.ok === "boolean" ? row.ok : null,
    details: asRecord(row.details),
  };
}

function latestEvent(events: LifecycleEvent[], predicate?: (event: LifecycleEvent) => boolean): LifecycleEvent | null {
  const filtered = predicate ? events.filter(predicate) : events;
  return [...filtered].sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))[0] ?? null;
}

function latestArray(events: LifecycleEvent[], key: string, mapper: (value: unknown) => PhaseName[]): PhaseName[] {
  for (const event of [...events].sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))) {
    const parsed = mapper(event.details[key]);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

function latestString(events: LifecycleEvent[], key: string): string | null {
  for (const event of [...events].sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))) {
    const candidate = stringValue(event.details[key]);
    if (candidate) return candidate;
  }
  return null;
}

function traceProject(events: LifecycleEvent[]): string | null {
  const projectSelection = latestEvent(events, (event) => event.eventType === "project_context_selection");
  const direct = stringValue(projectSelection?.details.projectName);
  if (direct) return direct;
  for (const event of [...events].sort((left, right) => timestamp(right.occurredAt) - timestamp(left.occurredAt))) {
    const project = stringValue(event.details.project) || stringValue(event.details.projectName);
    if (project) return project;
  }
  return null;
}

function traceSummary(events: LifecycleEvent[]): { text: string | null; source: "checkpoint" | "route-intent" | "none" } {
  const latestRoute = latestEvent(events, (event) => event.eventType === "route_planned");
  const routeAt = timestamp(latestRoute?.occurredAt);
  const summaryTypes = new Set(["outcome", "persistence", "verification", "phase_completed", "replan", "closure_reminder"]);
  const event = latestEvent(events, (candidate) => {
    if (!summaryTypes.has(candidate.eventType) || !stringValue(candidate.details.summary)) return false;
    return routeAt === 0 || timestamp(candidate.occurredAt) >= routeAt;
  });
  const checkpointSummary = stringValue(event?.details.summary);
  if (checkpointSummary) return { text: checkpointSummary, source: "checkpoint" };

  const routeIntent = asRecord(latestRoute?.details.intent);
  const routeSummary = stringValue(routeIntent.summary);
  if (routeSummary) return { text: routeSummary, source: "route-intent" };
  return { text: null, source: "none" };
}

function compactTraceTitle(value: string, maxLength = 84): string {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function humanizeWorkflowKey(value: string): string {
  return value
    .replace(/[-_.]+/g, " " )
    .replace(/\b(\d{8})\b/g, (date) => date.length === 8 ? date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6) : date)
    .replace(/\s+/g, " " )
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function isSyntheticWorkflowKey(value: string | null): boolean {
  if (!value) return false;
  return value.startsWith("__test_")
    || /(?:^|[-_.])fixture(?:$|[-_.])/i.test(value)
    || /^routing-latency-(?:plan-)?regression$/i.test(value);
}

function technicalTracePresentation(events: LifecycleEvent[]): { title: string; summary: string } {
  const latest = latestEvent(events);
  if (!latest) return { title: "Traza técnica MSSR", summary: "Traza técnica MSSR sin eventos observables." };
  const skillName = latest.skillName || stringValue(latest.details.skillName);
  if (latest.eventType === "skill_loaded") {
    return skillName
      ? { title: `Carga de skill · ${skillName}`, summary: `Traza técnica creada al cargar la skill «${skillName}».` }
      : { title: "Carga de skill MSSR", summary: "Traza técnica creada durante una carga de skill MSSR." };
  }
  if (latest.eventType === "context_assembly") {
    return { title: "Ensamblado de contexto MSSR", summary: "Traza técnica creada durante el ensamblado de contexto MSSR." };
  }
  if (latest.eventType === "project_context_selection") {
    const projectName = stringValue(latest.details.projectName) || stringValue(latest.details.project);
    return projectName
      ? { title: `Selección de contexto · ${projectName}`, summary: `Traza técnica de selección de contexto para «${projectName}».` }
      : { title: "Selección de contexto MSSR", summary: "Traza técnica creada durante una selección de contexto MSSR." };
  }
  if (latest.eventType.includes("reminder")) {
    return { title: "Recordatorio de cierre MSSR", summary: "Traza técnica asociada a un recordatorio de cierre o inactividad MSSR." };
  }
  const label = humanizeWorkflowKey(latest.eventType);
  return { title: `Evento MSSR · ${label}`, summary: `Traza técnica MSSR derivada del evento «${label}».` };
}

function traceDisplayName(input: {
  workflowKey: string | null;
  project: string | null;
  summary: string | null;
  technicalTitle: string;
}): { text: string; source: "workflow" | "summary" | "project" | "technical" } {
  if (input.workflowKey) return { text: humanizeWorkflowKey(input.workflowKey), source: "workflow" };
  if (input.summary) return { text: compactTraceTitle(input.summary), source: "summary" };
  if (input.project) return { text: `${input.project} · tarea MSSR`, source: "project" };
  return { text: input.technicalTitle, source: "technical" };
}

function traceLifecycle(traceId: string, events: LifecycleEvent[]) {
  const sorted = [...events].sort((left, right) => timestamp(left.occurredAt) - timestamp(right.occurredAt));
  const latest = sorted.at(-1)!;
  const latestRoute = latestEvent(sorted, (event) => event.eventType === "route_planned");
  const latestOutcome = latestEvent(sorted, (event) => event.eventType === "outcome");
  const latestReminder = latestEvent(sorted, (event) => event.eventType.includes("reminder") || event.eventType.includes("idle"));
  const closed = Boolean(latestOutcome && (!latestRoute || timestamp(latestOutcome.occurredAt) >= timestamp(latestRoute.occurredAt)));
  const requiredPhases = latestArray(sorted, "requiredPhases", phaseArray);
  const completedPhases = latestArray(sorted, "completedPhases", phaseArray);
  const completed = new Set(completedPhases);
  const nextPhase = requiredPhases.find((phase) => !completed.has(phase)) ?? null;
  const workflowKey = latestString(sorted, "workflowKey");
  const syntheticWorkflow = isSyntheticWorkflowKey(workflowKey);
  const agentProfile = asRecord(latestRoute?.details.agentProfile);
  const project = traceProject(sorted);
  const observedSummary = traceSummary(sorted);
  const technicalPresentation = technicalTracePresentation(sorted);
  const displayName = traceDisplayName({ workflowKey, project, summary: observedSummary.text, technicalTitle: technicalPresentation.title });
  const summary = observedSummary.text
    ?? (syntheticWorkflow && workflowKey
      ? `Prueba técnica MSSR: ${humanizeWorkflowKey(workflowKey)}. No representa una tarea de producto pendiente.`
      : workflowKey
        ? `Tarea MSSR: ${humanizeWorkflowKey(workflowKey)}. La descripción se derivó del workflow porque esta traza no registró un summary explícito.`
        : project
          ? `Tarea MSSR vinculada al proyecto «${project}». La descripción específica no quedó registrada en esta traza.`
          : technicalPresentation.summary);
  const summarySource = observedSummary.source === "none"
    ? (syntheticWorkflow ? "synthetic" : workflowKey ? "workflow" : project ? "project" : "technical")
    : observedSummary.source;
  const reminderIsLatest = Boolean(latestReminder && timestamp(latestReminder.occurredAt) >= timestamp(latest.occurredAt));
  const status = closed ? "closed" : reminderIsLatest ? "idle" : "active";
  const eventTypes = new Set(sorted.map((event) => event.eventType));
  const substantiveEventTypes = ["phase_completed", "verification", "persistence", "outcome", "friction", "replan"];
  const setupOnly = !substantiveEventTypes.some((eventType) => eventTypes.has(eventType));
  const verified = Boolean(latestEvent(sorted, (event) => event.eventType === "verification" && event.details.verificationPassed === true));
  const persisted = Boolean(latestEvent(sorted, (event) => event.eventType === "persistence" && event.details.persisted === true));
  const attentionKind = closed
    ? "closed"
    : syntheticWorkflow
      ? "intermediate"
      : nextPhase === "verification" || (!verified && requiredPhases.includes("verification") && completed.has("implementation"))
        ? "verify"
        : nextPhase === "persistence" || (verified && !persisted && requiredPhases.includes("persistence"))
          ? "persist"
          : requiredPhases.length > 0 && requiredPhases.every((phase) => completed.has(phase))
            ? "close"
            : setupOnly && !project && !workflowKey
              ? "intermediate"
              : "continue";

  return {
    traceId,
    displayName: displayName.text,
    displayNameSource: displayName.source,
    status,
    latestAt: latest.occurredAt,
    latestEventType: latest.eventType,
    caller: latest.caller || latestRoute?.caller || null,
    stage: latest.stage || latestRoute?.stage || null,
    workflowKey,
    workflowLabel: workflowKey ? humanizeWorkflowKey(workflowKey) : null,
    project,
    traceRole: syntheticWorkflow ? "synthetic-test" : setupOnly && !project && !workflowKey ? "technical-intermediate" : "task-trace",
    attentionKind,
    setupOnly,
    model: stringValue(agentProfile.model),
    reasoningEffort: stringValue(agentProfile.reasoningEffort),
    summary,
    summarySource,
    requiredPhases,
    completedPhases,
    nextPhase,
    checklist: PHASE_ORDER.map((phase) => ({
      phase,
      required: requiredPhases.includes(phase),
      completed: completed.has(phase),
      current: !closed && nextPhase === phase,
    })),
    closed,
    verified,
    persisted,
    maintenanceObserved: completed.has("maintenance"),
    evidenceRef: latestString(sorted, "evidenceRef"),
  };
}

function projectHealthMap(projectHealth: unknown): Map<string, UnknownRecord> {
  const root = asRecord(projectHealth);
  const latest = asRecord(root.latest);
  const projects = asArray(latest.projects).map(asRecord);
  return new Map(projects.flatMap((project) => {
    const name = stringValue(project.name);
    return name ? [[name.toLowerCase(), project] as const] : [];
  }));
}

export function buildHumanCockpitSnapshot(input: {
  observatoryRecent: unknown;
  projectHealth: unknown;
  gitStates?: CockpitGitState[];
  weeklySummary?: unknown;
  weeklyGitStates?: CockpitGitState[];
  capabilityInventory?: unknown;
  contextInventory?: unknown;
  now?: Date;
  traceLimit?: number;
}) {
  const recentRoot = asRecord(input.observatoryRecent);
  const events = asArray(recentRoot.recent).map(normalizeEvent).filter((event): event is LifecycleEvent => Boolean(event));
  const grouped = new Map<string, LifecycleEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.traceId) ?? [];
    bucket.push(event);
    grouped.set(event.traceId, bucket);
  }

  const rawTraces = [...grouped.entries()]
    .map(([traceId, traceEvents]) => traceLifecycle(traceId, traceEvents))
    .sort((left, right) => {
      const leftOpen = left.status === "closed" ? 0 : 1;
      const rightOpen = right.status === "closed" ? 0 : 1;
      return rightOpen - leftOpen || timestamp(right.latestAt) - timestamp(left.latestAt);
    });
  const workflowTraceCounts = new Map<string, number>();
  const workflowLatestTrace = new Map<string, string>();
  for (const trace of rawTraces) {
    if (!trace.workflowKey) continue;
    workflowTraceCounts.set(trace.workflowKey, (workflowTraceCounts.get(trace.workflowKey) ?? 0) + 1);
    const current = workflowLatestTrace.get(trace.workflowKey);
    const currentTrace = current ? rawTraces.find((candidate) => candidate.traceId === current) : null;
    if (!currentTrace || timestamp(trace.latestAt) > timestamp(currentTrace.latestAt)) workflowLatestTrace.set(trace.workflowKey, trace.traceId);
  }
  const traces = rawTraces
    .map((trace) => {
      const workflowTraceCount = trace.workflowKey ? (workflowTraceCounts.get(trace.workflowKey) ?? 1) : 1;
      const latestForWorkflow = trace.workflowKey ? workflowLatestTrace.get(trace.workflowKey) : null;
      const workflowMember = workflowTraceCount > 1 && trace.setupOnly && latestForWorkflow !== trace.traceId;
      return {
        ...trace,
        workflowTraceCount,
        traceRole: workflowMember ? "workflow-member" : trace.traceRole,
        attentionKind: workflowMember && !trace.closed ? "intermediate" : trace.attentionKind,
      };
    })
    .slice(0, Math.max(1, Math.min(20, input.traceLimit ?? 12)));

  const activeTraces = traces.filter((trace) => trace.status !== "closed");
  const projectMap = projectHealthMap(input.projectHealth);
  const gitByProject = new Map((input.gitStates ?? []).map((state) => [state.project.toLowerCase(), state]));
  const projectNames = [...new Set(traces.flatMap((trace) => trace.project ? [trace.project] : []))];
  const projects = projectNames.map((name) => {
    const health = projectMap.get(name.toLowerCase()) ?? {};
    const git = gitByProject.get(name.toLowerCase()) ?? null;
    const related = traces.filter((trace) => trace.project === name);
    const open = related.filter((trace) => trace.status !== "closed");
    return {
      name,
      activeTraces: open.length,
      recentTraces: related.length,
      healthLevel: stringValue(health.level) ?? "unknown",
      findingCount: Number(health.findingCount ?? 0) || 0,
      findingCodes: stringArray(health.findingCodes).slice(0, 6),
      referenceCandidateCount: Number(health.referenceCandidateCount ?? 0) || 0,
      referenceHighPriorityCount: Number(health.referenceHighPriorityCount ?? 0) || 0,
      referenceHighCandidates: stringArray(health.referenceHighCandidates).slice(0, 8),
      relativeRoot: stringValue(health.relativeRoot),
      branch: git?.branch ?? null,
      trackedChanges: git?.trackedChanges ?? null,
      untrackedChanges: git?.untrackedChanges ?? null,
      gitClean: git?.clean ?? null,
      gitObservedAt: git?.observedAt ?? null,
      gitError: git?.error ?? null,
    };
  }).sort((left, right) => right.activeTraces - left.activeTraces || right.findingCount - left.findingCount || left.name.localeCompare(right.name));

  const weeklyRoot = asRecord(input.weeklySummary);
  const weeklyHistory = asRecord(weeklyRoot.workHistory);
  const weeklyGitByProject = new Map((input.weeklyGitStates ?? []).map((state) => [state.project.toLowerCase(), state]));
  const weeklyProjects = asArray(weeklyHistory.projects).map(asRecord).flatMap((history) => {
    const name = stringValue(history.name);
    if (!name) return [];
    const health = projectMap.get(name.toLowerCase()) ?? {};
    const git = weeklyGitByProject.get(name.toLowerCase()) ?? null;
    const remotes = git?.remotes ?? [];
    const remoteState = !git
      ? "git-unavailable"
      : remotes.length === 0
        ? "local-only"
        : !git.upstream
          ? "remote-no-upstream"
          : Number(git.ahead ?? 0) > 0 && Number(git.behind ?? 0) > 0
            ? "diverged-local-tracking"
            : Number(git.ahead ?? 0) > 0
              ? "ahead-local-tracking"
              : Number(git.behind ?? 0) > 0
                ? "behind-local-tracking"
                : "aligned-local-tracking";
    const localChanges = Number(git?.trackedChanges ?? 0) + Number(git?.untrackedChanges ?? 0);
    const commitCount = Number(git?.commitCount ?? 0);
    const substantiveTraceCount = Number(history.substantiveTraceCount ?? 0) || 0;
    const pendingHint = !git
      ? "Git no observado"
      : localChanges > 0
        ? `${localChanges} cambios locales sin commit`
        : Number(git.ahead ?? 0) > 0
          ? `${git.ahead} commit(s) por delante del tracking local`
          : remotes.length === 0 && commitCount > 0
            ? "historia local sin remote configurado"
            : substantiveTraceCount > 0 && commitCount === 0
              ? "trabajo MSSR observado sin commit reciente"
              : "sin presión Git local observada";
    return [{
      name,
      latestAt: stringValue(history.latestAt),
      traceCount: Number(history.traceCount ?? 0) || 0,
      substantiveTraceCount,
      closedTraceCount: Number(history.closedTraceCount ?? 0) || 0,
      substantiveToolCalls: Number(history.substantiveToolCalls ?? 0) || 0,
      workflowKeys: stringArray(history.workflowKeys).slice(0, 12),
      latestSummary: stringValue(history.latestSummary),
      healthLevel: stringValue(health.level) ?? "unknown",
      branch: git?.branch ?? null,
      trackedChanges: git?.trackedChanges ?? null,
      untrackedChanges: git?.untrackedChanges ?? null,
      gitClean: git?.clean ?? null,
      remotes,
      upstream: git?.upstream ?? null,
      ahead: git?.ahead ?? null,
      behind: git?.behind ?? null,
      commitCount: git?.commitCount ?? null,
      latestCommitHash: git?.latestCommitHash ?? null,
      latestCommitAt: git?.latestCommitAt ?? null,
      latestCommitSubject: git?.latestCommitSubject ?? null,
      remoteState,
      pendingHint,
      gitObservedAt: git?.observedAt ?? null,
      gitError: git?.error ?? null,
    }];
  }).sort((left, right) => timestamp(right.latestAt) - timestamp(left.latestAt) || right.substantiveTraceCount - left.substantiveTraceCount);

  const weekly = {
    days: Number(weeklyHistory.days ?? weeklyRoot.days ?? 7) || 7,
    scope: stringValue(weeklyHistory.scope) ?? stringValue(weeklyRoot.scope) ?? "all",
    since: stringValue(weeklyHistory.since) ?? stringValue(weeklyRoot.since),
    traceCount: Number(weeklyHistory.traceCount ?? 0) || 0,
    substantiveTraceCount: Number(weeklyHistory.substantiveTraceCount ?? 0) || 0,
    openSubstantiveTraceCount: Number(weeklyHistory.openSubstantiveTraceCount ?? 0) || 0,
    humanOpenTraceCount: Number(weeklyHistory.humanOpenTraceCount ?? weeklyHistory.openSubstantiveTraceCount ?? 0) || 0,
    supportOpenTraceCount: Number(weeklyHistory.supportOpenTraceCount ?? 0) || 0,
    needsClosureReviewCount: Number(weeklyHistory.needsClosureReviewCount ?? 0) || 0,
    humanNeedsClosureReviewCount: Number(weeklyHistory.humanNeedsClosureReviewCount ?? weeklyHistory.needsClosureReviewCount ?? 0) || 0,
    projectCount: weeklyProjects.length,
    projects: weeklyProjects,
    note: stringValue(weeklyHistory.note) ?? "Resumen transversal de evidencia MSSR + Git local; no infiere finalización ni estado remoto fresco.",
  };

  const weeklyOpenTraces = asArray(weeklyHistory.openTraces).map(asRecord);
  const supportOpenTraceCount = weeklyOpenTraces.filter((row) => row.supportWorkflow === true).length;
  const supportNeedsClosureReviewCount = weeklyOpenTraces.filter((row) => row.supportWorkflow === true && row.needsClosureReview === true).length;
  const currentTraceById = new Map(traces.map((trace) => [trace.traceId, trace] as const));
  const taskGroups = new Map<string, {
    taskKey: string;
    taskKeySource: "explicit-mssr" | "derived-project-workflow" | "trace-fallback";
    project: string;
    projects: string[];
    workflowKey: string | null;
    workflowKeys: string[];
    traceIds: string[];
    parentTraceIds: string[];
    supersedesTraceIds: string[];
    latestAt: string;
    latestSummary: string | null;
    latestStage: string | null;
    caller: string | null;
    requiredPhases: string[];
    completedPhases: string[];
    evidenceRef: string | null;
    needsClosureReview: boolean;
    closureReminderCount: number;
    nextGate: string;
  }>();
  for (const row of weeklyOpenTraces) {
    const traceId = stringValue(row.traceId);
    const project = stringValue(row.project);
    if (!traceId || !project) continue;
    const workflowKey = stringValue(row.workflowKey);
    if (row.supportWorkflow === true) continue;
    const explicitTaskKey = stringValue(row.taskKey);
    const legacyTaskKey = workflowKey ? `${project.toLowerCase()}::${workflowKey}` : `${project.toLowerCase()}::trace:${traceId}`;
    const taskKey = explicitTaskKey ?? legacyTaskKey;
    const taskGroupKey = explicitTaskKey ? `explicit:${explicitTaskKey}` : `legacy:${legacyTaskKey}`;
    const taskKeySource = explicitTaskKey ? "explicit-mssr" : workflowKey ? "derived-project-workflow" : "trace-fallback";
    const parentTraceId = stringValue(row.parentTraceId);
    const supersedesTraceId = stringValue(row.supersedesTraceId);
    const currentTrace = currentTraceById.get(traceId);
    const needsClosureReview = row.needsClosureReview === true;
    const latestStage = stringValue(row.latestStage) || currentTrace?.stage || null;
    const nextGate = needsClosureReview
      ? "revisar cierre / registrar outcome"
      : currentTrace?.attentionKind === "verify"
        ? "verificar"
        : currentTrace?.attentionKind === "persist"
          ? "persistir"
          : currentTrace?.attentionKind === "close"
            ? "cerrar"
            : latestStage === "verify"
              ? "verificar"
              : latestStage === "persist"
                ? "persistir"
                : latestStage === "close"
                  ? "cerrar"
                  : "continuar";
    const latestAt = stringValue(row.latestAt) ?? "";
    const latestSummary = stringValue(row.summary);
    const existing = taskGroups.get(taskGroupKey);
    if (!existing) {
      taskGroups.set(taskGroupKey, {
        taskKey,
        taskKeySource,
        project,
        projects: [project],
        workflowKey,
        workflowKeys: workflowKey ? [workflowKey] : [],
        traceIds: [traceId],
        parentTraceIds: parentTraceId ? [parentTraceId] : [],
        supersedesTraceIds: supersedesTraceId ? [supersedesTraceId] : [],
        latestAt,
        latestSummary,
        latestStage,
        caller: stringValue(row.caller),
        requiredPhases: stringArray(row.requiredPhases),
        completedPhases: stringArray(row.completedPhases),
        evidenceRef: stringValue(row.evidenceRef),
        needsClosureReview,
        closureReminderCount: row.closureReminderObserved === true ? 1 : 0,
        nextGate,
      });
      continue;
    }
    existing.traceIds.push(traceId);
    if (!existing.projects.includes(project)) existing.projects.push(project);
    if (workflowKey && !existing.workflowKeys.includes(workflowKey)) existing.workflowKeys.push(workflowKey);
    if (parentTraceId && !existing.parentTraceIds.includes(parentTraceId)) existing.parentTraceIds.push(parentTraceId);
    if (supersedesTraceId && !existing.supersedesTraceIds.includes(supersedesTraceId)) existing.supersedesTraceIds.push(supersedesTraceId);
    existing.needsClosureReview = existing.needsClosureReview || needsClosureReview;
    if (row.closureReminderObserved === true) existing.closureReminderCount += 1;
    if (latestAt > existing.latestAt) {
      existing.project = project;
      existing.workflowKey = workflowKey;
      existing.latestAt = latestAt;
      existing.latestSummary = latestSummary;
      existing.latestStage = latestStage;
      existing.caller = stringValue(row.caller);
      existing.requiredPhases = stringArray(row.requiredPhases);
      existing.completedPhases = stringArray(row.completedPhases);
      existing.evidenceRef = stringValue(row.evidenceRef);
      existing.nextGate = nextGate;
    }
    if (needsClosureReview) existing.nextGate = "revisar cierre / registrar outcome";
  }
  const nowDate = input.now ?? new Date();
  const allOpenTasks = [...taskGroups.values()]
    .map((task) => ({
      ...task,
      classification: classifyOpenHumanTask(task, nowDate),
    }))
    .sort((left, right) => timestamp(right.latestAt) - timestamp(left.latestAt) || Number(right.needsClosureReview) - Number(left.needsClosureReview));
  const currentTasks = allOpenTasks.filter((task) => !task.needsClosureReview);
  const closureDebtTasks = allOpenTasks.filter((task) => task.needsClosureReview);
  const openTasks = currentTasks
    .slice(0, 24)
    .map((task) => ({
      ...task,
      resumePacket: {
        schemaVersion: 2,
        project: task.project,
        projects: task.projects,
        taskKey: task.taskKey,
        taskKeySource: task.taskKeySource,
        workflowKey: task.workflowKey,
        workflowKeys: task.workflowKeys,
        traceIds: task.traceIds,
        parentTraceIds: task.parentTraceIds,
        supersedesTraceIds: task.supersedesTraceIds,
        lastKnownSummary: task.latestSummary,
        lastKnownStage: task.latestStage,
        requiredPhases: task.requiredPhases,
        completedPhases: task.completedPhases,
        nextGate: task.nextGate,
        evidenceRef: task.evidenceRef,
        latestAt: task.latestAt,
      },
    }));
  const lifecycleDebt = closureDebtTasks.slice(0, 24).map((task) => ({
    ...task,
    resumePacket: {
      schemaVersion: 2,
      project: task.project,
      projects: task.projects,
      taskKey: task.taskKey,
      taskKeySource: task.taskKeySource,
      workflowKey: task.workflowKey,
      workflowKeys: task.workflowKeys,
      traceIds: task.traceIds,
      parentTraceIds: task.parentTraceIds,
      supersedesTraceIds: task.supersedesTraceIds,
      lastKnownSummary: task.latestSummary,
      lastKnownStage: task.latestStage,
      requiredPhases: task.requiredPhases,
      completedPhases: task.completedPhases,
      nextGate: "revisar si retomar / cerrar outcome",
      evidenceRef: task.evidenceRef,
      latestAt: task.latestAt,
    },
    debtReason: "Trabajo sustantivo quedó sin outcome MSSR posterior. Se conserva como deuda de lifecycle y no como trabajo activo hasta revisión; no se auto-cierra.",
  }));

  const workspaceStatePriority: Record<HumanWorkState, number> = {
    "review-needed": 6,
    active: 5,
    experimental: 4,
    paused: 3,
    "abandoned-or-replaced": 2,
    finished: 1,
  };
  const workspaceProjects = weeklyProjects.map((project) => {
    const projectKey = project.name.toLowerCase();
    const relatedTasks = currentTasks.filter((task) => task.projects.some((candidate) => candidate.toLowerCase() === projectKey));
    const classification = classifyWeeklyProject({
      name: project.name,
      healthLevel: project.healthLevel,
      substantiveTraceCount: project.substantiveTraceCount,
      closedTraceCount: project.closedTraceCount,
      workflowKeys: project.workflowKeys,
      latestAt: project.latestAt,
      openTasks: relatedTasks,
    }, nowDate);
    const nextTask = [...relatedTasks].sort((left, right) => {
      const leftPriority = workspaceStatePriority[left.classification.state];
      const rightPriority = workspaceStatePriority[right.classification.state];
      return rightPriority - leftPriority || timestamp(right.latestAt) - timestamp(left.latestAt);
    })[0] ?? null;
    const localChanges = Number(project.trackedChanges ?? 0) + Number(project.untrackedChanges ?? 0);
    const nextGate = nextTask?.nextGate
      ?? (classification.state === "review-needed"
        ? "revisar clasificación / cierre"
        : classification.state === "paused"
          ? "decidir si reactivar o mantener pausado"
          : classification.state === "experimental"
            ? "decidir si promover, conservar o descartar"
            : "sin próximo gate humano observado");
    return {
      ...project,
      classification,
      openTaskCount: relatedTasks.length,
      nextGate,
      gitPressure: localChanges,
      currentTasks: relatedTasks.slice(0, 4).map((task) => ({
        taskKey: task.taskKey,
        taskKeySource: task.taskKeySource,
        summary: task.latestSummary,
        latestAt: task.latestAt,
        nextGate: task.nextGate,
        classification: task.classification,
      })),
    };
  }).sort((left, right) => {
    const leftPriority = workspaceStatePriority[left.classification.state];
    const rightPriority = workspaceStatePriority[right.classification.state];
    return rightPriority - leftPriority || timestamp(right.latestAt) - timestamp(left.latestAt) || left.name.localeCompare(right.name);
  });
  const workspaceCounts = workspaceProjects.reduce<Record<HumanWorkState, number>>((acc, project) => {
    acc[project.classification.state] += 1;
    return acc;
  }, {
    active: 0,
    "review-needed": 0,
    paused: 0,
    finished: 0,
    experimental: 0,
    "abandoned-or-replaced": 0,
  });
  const workspaceMap = {
    schemaVersion: 1,
    scope: "observed-7d-plus-open",
    projectCount: workspaceProjects.length,
    counts: workspaceCounts,
    projects: workspaceProjects,
    policy: {
      automaticStates: ["active", "review-needed", "paused", "experimental"],
      explicitOwnerStates: ["finished", "abandoned-or-replaced"],
      note: "Finished y abandoned-or-replaced requieren evidencia explícita del owner; silencio, edad o Git limpio nunca alcanzan para declararlos.",
    },
  };

  const yesterdayDate = new Date(nowDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const todayKey = localDayKey(nowDate);
  const yesterdayKey = localDayKey(yesterdayDate);
  const dailyRows = asArray(weeklyHistory.daily).map(asRecord);
  const dayProjection = (key: string) => {
    const row = dailyRows.find((candidate) => stringValue(candidate.date) === key) ?? {};
    return {
      date: key,
      traceCount: Number(row.traceCount ?? 0) || 0,
      projectCount: Number(row.projectCount ?? 0) || 0,
      projects: stringArray(row.projects).slice(0, 20),
      workflowKeys: stringArray(row.workflowKeys).slice(0, 24),
      openTraceCount: Number(row.humanOpenTraceCount ?? row.openTraceCount ?? 0) || 0,
      supportOpenTraceCount: Number(row.supportOpenTraceCount ?? 0) || 0,
      needsClosureReviewCount: Number(row.humanNeedsClosureReviewCount ?? row.needsClosureReviewCount ?? 0) || 0,
      supportNeedsClosureReviewCount: Number(row.supportNeedsClosureReviewCount ?? 0) || 0,
      latestSummaries: asArray(row.latestSummaries).map(asRecord).flatMap((summary) => {
        const project = stringValue(summary.project);
        const text = stringValue(summary.summary);
        return project && text ? [{ project, summary: text }] : [];
      }).slice(0, 10),
    };
  };
  const morningBrief = {
    taskIdentityMode: "mssr-explicit-with-legacy-fallback",
    taskIdentityNote: "Explicit MSSR taskKey groups related traces when recorded; older history falls back to project + workflowKey, then traceId. Raw trace provenance and lineage remain visible.",
    today: dayProjection(todayKey),
    yesterday: dayProjection(yesterdayKey),
    openTaskCount: currentTasks.length,
    returnedTaskCount: openTasks.length,
    lifecycleDebtTaskCount: closureDebtTasks.length,
    lifecycleDebtReturnedCount: lifecycleDebt.length,
    needsClosureReviewCount: closureDebtTasks.length,
    supportOpenTraceCount,
    supportNeedsClosureReviewCount,
    supportNote: "Las trazas forenses/de recuperación siguen visibles en la evidencia semanal pero no inflan la lista de tareas humanas pendientes.",
    lifecycleDebtNote: "Una traza sin outcome no se presenta como trabajo activo: queda en deuda de lifecycle hasta revisión explícita, sin auto-cierre.",
    tasks: openTasks,
    lifecycleDebt,
  };

  const healthRoot = asRecord(input.projectHealth);
  const healthLatest = asRecord(healthRoot.latest);
  const healthProjects = asArray(healthLatest.projects).map(asRecord);
  const counts = asRecord(healthLatest.counts);
  const referenceAuditAvailable = healthProjects.some((project) => project.referenceAuditAvailable === true);
  const referenceTotals = healthProjects.reduce<{ total: number; high: number; medium: number; low: number }>((acc, project) => {
    acc.total += Number(project.referenceCandidateCount ?? 0) || 0;
    acc.high += Number(project.referenceHighPriorityCount ?? 0) || 0;
    acc.medium += Number(project.referenceMediumPriorityCount ?? 0) || 0;
    acc.low += Number(project.referenceLowPriorityCount ?? 0) || 0;
    return acc;
  }, { total: 0, high: 0, medium: 0, low: 0 });
  const highCandidates = healthProjects.flatMap((project) => stringArray(project.referenceHighCandidates).map((candidate) => ({
    project: stringValue(project.name) ?? "unknown",
    path: candidate,
  }))).slice(0, 12);
  const focus = activeTraces[0] ?? traces[0] ?? null;
  return {
    schemaVersion: 1,
    observedAt: (input.now ?? new Date()).toISOString(),
    authority: {
      mode: "projection-only",
      canonicalOwners: ["MSSR lifecycle/Project Context", "Bridge observability/runtime", "Git repository state"],
      writesProjectTruth: false,
      note: "Cockpit summarizes existing evidence; it never becomes project or lifecycle authority.",
    },
    counts: {
      traces: traces.length,
      active: traces.filter((trace) => trace.status === "active").length,
      idle: traces.filter((trace) => trace.status === "idle").length,
      closedRecent: traces.filter((trace) => trace.status === "closed").length,
      projects: projects.length,
      projectWatch: Number(counts.watch ?? 0) || 0,
      projectReview: Number(counts.review ?? 0) || 0,
    },
    focus,
    traces,
    projects,
    weekly,
    morningBrief,
    workspaceMap,
    capabilities: asRecord(input.capabilityInventory),
    contextInventory: asRecord(input.contextInventory),
    referenceLifecycle: {
      candidateReferenceProjectionAvailable: referenceAuditAvailable,
      candidates: referenceTotals,
      highCandidates,
      note: referenceAuditAvailable
        ? "Project Context Health exposes candidate-only document references. Counts are advisory: no candidate is linked or promoted automatically."
        : "The persisted Project Health snapshot predates reference-audit support or has not been refreshed yet.",
    },
    freshness: {
      lifecycle: stringValue(recentRoot.activeTotals && asRecord(recentRoot.activeTotals).latest) || stringValue(recentRoot.totals && asRecord(recentRoot.totals).latest),
      projectHealth: stringValue(healthRoot.updatedAt),
      git: input.gitStates?.map((item) => item.observedAt).sort().at(-1) ?? null,
      weeklyGit: input.weeklyGitStates?.map((item) => item.observedAt).sort().at(-1) ?? null,
    },
  };
}

async function gitText(root: string, args: string[], timeout = 1500): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    windowsHide: true,
    timeout,
    maxBuffer: 256 * 1024,
  });
  return String(result.stdout || "").trim();
}

async function gitTextOptional(root: string, args: string[], timeout = 1500): Promise<string | null> {
  try {
    return await gitText(root, args, timeout);
  } catch {
    return null;
  }
}

async function collectGitState(input: {
  projectName: string;
  relativeRoot: string;
  root: string;
  observedAt: string;
  since: string;
}): Promise<CockpitGitState> {
  try {
    const [branch, status, remoteText, upstream] = await Promise.all([
      gitText(input.root, ["branch", "--show-current"]),
      gitText(input.root, ["status", "--porcelain=v1", "--untracked-files=normal"], 2500),
      gitTextOptional(input.root, ["remote"]),
      gitTextOptional(input.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    ]);
    const statusLines = status ? status.split(/\r?\n/).filter(Boolean) : [];
    const trackedChanges = statusLines.filter((line) => !line.startsWith("??")).length;
    const untrackedChanges = statusLines.filter((line) => line.startsWith("??")).length;
    const remotes = (remoteText ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 12);

    let ahead: number | null = null;
    let behind: number | null = null;
    if (upstream) {
      const divergence = await gitTextOptional(input.root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], 2000);
      const values = divergence?.split(/\s+/).map((value) => Number(value)) ?? [];
      if (values.length >= 2 && values.every(Number.isFinite)) {
        ahead = values[0];
        behind = values[1];
      }
    }

    const sinceArg = `--since=${input.since}`;
    const [commitCountText, latestCommitText] = await Promise.all([
      gitTextOptional(input.root, ["rev-list", "--count", sinceArg, "HEAD"], 2500),
      gitTextOptional(input.root, ["log", "-1", "--format=%H%x1f%cI%x1f%s", sinceArg], 2500),
    ]);
    const parsedCommitCount = commitCountText === null ? Number.NaN : Number(commitCountText);
    const commitCount = Number.isFinite(parsedCommitCount) ? parsedCommitCount : null;
    const latestCommitParts = latestCommitText ? latestCommitText.split("\u001f") : [];

    return {
      project: input.projectName,
      relativeRoot: input.relativeRoot,
      branch: branch || null,
      trackedChanges,
      untrackedChanges,
      clean: trackedChanges === 0 && untrackedChanges === 0,
      remotes,
      upstream: upstream || null,
      ahead,
      behind,
      commitCount,
      latestCommitHash: latestCommitParts[0] || null,
      latestCommitAt: latestCommitParts[1] || null,
      latestCommitSubject: latestCommitParts.slice(2).join("\u001f").slice(0, 180) || null,
      observedAt: input.observedAt,
      error: null,
    };
  } catch (error) {
    return {
      project: input.projectName,
      relativeRoot: input.relativeRoot,
      branch: null,
      trackedChanges: null,
      untrackedChanges: null,
      clean: null,
      remotes: [],
      upstream: null,
      ahead: null,
      behind: null,
      commitCount: null,
      latestCommitHash: null,
      latestCommitAt: null,
      latestCommitSubject: null,
      observedAt: input.observedAt,
      error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  }
}

function projectRowsByName(projectHealth: unknown) {
  const healthRoot = asRecord(projectHealth);
  const latest = asRecord(healthRoot.latest);
  const workspaceRoot = stringValue(healthRoot.workspaceRoot) || stringValue(latest.workspaceRoot);
  const rows = asArray(latest.projects).map(asRecord);
  const byName = new Map(rows.flatMap((project) => {
    const name = stringValue(project.name);
    return name ? [[name.toLowerCase(), project] as const] : [];
  }));
  return { workspaceRoot, rows, byName };
}

export async function collectCockpitGitStates(input: {
  projectHealth: unknown;
  observatoryRecent: unknown;
  maxProjects?: number;
  now?: Date;
}): Promise<CockpitGitState[]> {
  const { workspaceRoot, rows } = projectRowsByName(input.projectHealth);
  if (!workspaceRoot) return [];

  const recentRoot = asRecord(input.observatoryRecent);
  const events = asArray(recentRoot.recent).map(normalizeEvent).filter((event): event is LifecycleEvent => Boolean(event));
  const grouped = new Map<string, LifecycleEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.traceId) ?? [];
    bucket.push(event);
    grouped.set(event.traceId, bucket);
  }
  const activeProjectNames = [...new Set([...grouped.entries()]
    .map(([traceId, traceEvents]) => traceLifecycle(traceId, traceEvents))
    .filter((trace) => trace.status !== "closed" && trace.project)
    .map((trace) => trace.project!.toLowerCase()))];

  const selected = rows
    .filter((project) => {
      const name = stringValue(project.name)?.toLowerCase();
      return Boolean(name && activeProjectNames.includes(name));
    })
    .slice(0, Math.max(1, Math.min(8, input.maxProjects ?? 6)));

  const now = input.now ?? new Date();
  const observedAt = now.toISOString();
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  return await Promise.all(selected.map(async (project) => {
    const projectName = stringValue(project.name) ?? "unknown";
    const relativeRoot = stringValue(project.relativeRoot) ?? projectName;
    const root = path.resolve(workspaceRoot, relativeRoot === "." ? "" : relativeRoot);
    return await collectGitState({ projectName, relativeRoot, root, observedAt, since });
  }));
}

export async function collectWeeklyGitStates(input: {
  projectHealth: unknown;
  weeklySummary: unknown;
  maxProjects?: number;
  now?: Date;
}): Promise<CockpitGitState[]> {
  const { workspaceRoot, byName } = projectRowsByName(input.projectHealth);
  if (!workspaceRoot) return [];

  const weeklyRoot = asRecord(input.weeklySummary);
  const history = asRecord(weeklyRoot.workHistory);
  const maxProjects = Math.max(1, Math.min(20, input.maxProjects ?? 12));
  const names = asArray(history.projects)
    .map(asRecord)
    .flatMap((project) => {
      const name = stringValue(project.name);
      return name ? [name] : [];
    })
    .slice(0, maxProjects);
  const now = input.now ?? new Date();
  const observedAt = now.toISOString();
  const since = stringValue(history.since) ?? stringValue(weeklyRoot.since) ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();

  return await Promise.all(names.flatMap((name) => {
    const project = byName.get(name.toLowerCase());
    if (!project) return [];
    const relativeRoot = stringValue(project.relativeRoot) ?? name;
    const root = path.resolve(workspaceRoot, relativeRoot === "." ? "" : relativeRoot);
    return [collectGitState({ projectName: name, relativeRoot, root, observedAt, since })];
  }));
}
