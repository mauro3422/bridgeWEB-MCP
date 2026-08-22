import fs from "node:fs/promises";
import path from "node:path";
import {
  analyzeArchitectureTypeScriptSource,
  architectureImpactReviewedBaselineSchema,
  architectureInvariantGraphEvidenceSchema,
  architectureReviewedCurrentReceiptSchema,
  architectureStructuralReviewedBaselineSchema,
  buildMarkdownArchitectureStructuralEvidence,
  buildSymbolArchitectureStructuralEvidence,
  createArchitectureImpactReviewedBaseline,
  createArchitectureReviewedCurrentReceipt,
  createArchitectureStructuralReviewedBaseline,
  evaluateArchitectureHostAdoption,
  loadArchitectureImpactManifest,
  loadArchitectureInvariantManifest,
  loadArchitectureStructureManifest,
  loadProjectContextModuleManifest,
  mergeArchitectureStructuralEvidence,
  normalizeArchitectureSymbolAnalysisEvidence,
  planArchitectureHostAdoption,
  resolveArchitectureImpactProjectPath,
  type ArchitectureGraphHostEvidence,
  type ArchitectureHostAdoptionEvaluation,
  type ArchitectureHostAdoptionPlanItem,
  type ArchitectureImpactManifest,
  type ArchitectureImpactReviewedBaseline,
  type ArchitectureInvariantGraphEvidence,
  type ArchitectureInvariantManifest,
  type ArchitectureReviewedCurrentReceipt,
  type ArchitectureStructuralEvidence,
  type ArchitectureStructuralReviewedBaseline,
  type ArchitectureStructureManifest,
  type ProjectContextManifest,
} from "@mauroprime/mssr";
import { createBridgeArchitectureImpactFilesystemObserver, observeBridgeArchitectureImpactProject } from "./architecture-impact-observer.js";
import { buildImportGraph } from "./tools/shared/import-graph.js";

const REVIEW_STATE_SCHEMA_VERSION = 1 as const;
const GRAPH_ANALYZER_ID = "bridge-import-graph-v1";
const MAX_GRAPH_EDGES = 256;

const explicitPathWriters: Readonly<Record<string, readonly string[]>> = {
  write_text_file: ["path"],
  apply_patch: ["path"],
  edit_lines: ["path"],
  binary_file_write: ["outputPath"],
  git_restore_file: ["path"],
};

type StoredArchitectureReviewState = {
  schemaVersion: typeof REVIEW_STATE_SCHEMA_VERSION;
  architectureId: string;
  baseline: ArchitectureImpactReviewedBaseline;
  structuralBaseline?: ArchitectureStructuralReviewedBaseline;
  reviewedCurrentReceipt?: ArchitectureReviewedCurrentReceipt;
};

export type PreparedBridgeArchitectureImpact = {
  projectRoot: string;
  touchedRefs: string[];
  manifest: ArchitectureImpactManifest;
  structureManifest: ArchitectureStructureManifest | null;
  invariantManifest: ArchitectureInvariantManifest | null;
  projectContextManifest: ProjectContextManifest;
  plans: ArchitectureHostAdoptionPlanItem[];
};

export type BridgeArchitectureImpactEvaluationItem =
  | {
      architectureId: string;
      state: "baseline-review-required";
      matchedRefs: string[];
      contextRef?: string;
    }
  | {
      architectureId: string;
      state: "evaluated";
      matchedRefs: string[];
      evaluation: ArchitectureHostAdoptionEvaluation;
    };

export type BridgeArchitectureImpactEvaluationResult = {
  active: boolean;
  touchedRefs: string[];
  items: BridgeArchitectureImpactEvaluationItem[];
};

function normalizeCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectRelativeRef(projectRoot: string, value: string): string | null {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
  const relative = path.relative(normalizeCompare(projectRoot), normalizeCompare(absolute));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

export function resolveBridgeArchitectureTouchedRefs(
  projectRootInput: string,
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  const fields = explicitPathWriters[toolName];
  if (!fields) return [];
  const projectRoot = path.resolve(projectRootInput);
  const refs = new Set<string>();
  for (const field of fields) {
    const raw = args[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const ref = projectRelativeRef(projectRoot, raw.trim());
    if (ref) refs.add(ref);
  }
  return [...refs].sort();
}

function runtimeStatePath(projectRoot: string, architectureId: string): string {
  return path.join(projectRoot, ".mssr", "runtime", "architecture-impact", `${architectureId}.json`);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tempPath, text, "utf8");
  await fs.rename(tempPath, filePath);
  const readback = await fs.readFile(filePath, "utf8");
  if (readback !== text) throw new Error(`Architecture Impact runtime receipt readback mismatch: ${filePath}`);
}

function parseStoredReviewState(value: unknown, architectureId: string): StoredArchitectureReviewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Architecture Impact runtime review state must be an object.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REVIEW_STATE_SCHEMA_VERSION) throw new Error("Unsupported Architecture Impact runtime review state version.");
  if (record.architectureId !== architectureId) throw new Error(`Architecture Impact runtime review state architecture mismatch: ${String(record.architectureId)} vs ${architectureId}`);
  const baseline = architectureImpactReviewedBaselineSchema.parse(record.baseline);
  const structuralBaseline = record.structuralBaseline === undefined
    ? undefined
    : architectureStructuralReviewedBaselineSchema.parse(record.structuralBaseline);
  const reviewedCurrentReceipt = record.reviewedCurrentReceipt === undefined
    ? undefined
    : architectureReviewedCurrentReceiptSchema.parse(record.reviewedCurrentReceipt);
  return {
    schemaVersion: REVIEW_STATE_SCHEMA_VERSION,
    architectureId,
    baseline,
    ...(structuralBaseline ? { structuralBaseline } : {}),
    ...(reviewedCurrentReceipt ? { reviewedCurrentReceipt } : {}),
  };
}

async function readStoredReviewState(projectRoot: string, architectureId: string): Promise<StoredArchitectureReviewState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(runtimeStatePath(projectRoot, architectureId), "utf8")) as unknown;
    return parseStoredReviewState(parsed, architectureId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

async function loadOptionalManifests(projectRoot: string, impactManifest: ArchitectureImpactManifest): Promise<{
  structureManifest: ArchitectureStructureManifest | null;
  invariantManifest: ArchitectureInvariantManifest | null;
  projectContextManifest: ProjectContextManifest;
}> {
  const [structure, invariants, projectContext] = await Promise.all([
    loadArchitectureStructureManifest(projectRoot, impactManifest),
    loadArchitectureInvariantManifest(projectRoot, impactManifest),
    loadProjectContextModuleManifest(projectRoot),
  ]);
  if (!projectContext.found) {
    throw new Error(`Architecture Impact host adoption requires initialized project context: ${projectContext.path}`);
  }
  return {
    structureManifest: structure.found ? structure.manifest : null,
    invariantManifest: invariants.found ? invariants.manifest : null,
    projectContextManifest: projectContext.manifest,
  };
}

export async function prepareBridgeArchitectureImpactHostAdoption(options: {
  projectRoot: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<PreparedBridgeArchitectureImpact | null> {
  const projectRoot = path.resolve(options.projectRoot);
  const touchedRefs = resolveBridgeArchitectureTouchedRefs(projectRoot, options.toolName, options.args);
  if (touchedRefs.length === 0) return null;

  const loaded = await loadArchitectureImpactManifest(projectRoot);
  if (!loaded.found) return null;
  const optional = await loadOptionalManifests(projectRoot, loaded.manifest);
  const plans = planArchitectureHostAdoption(loaded.manifest, touchedRefs, {
    structureManifest: optional.structureManifest,
    invariantManifest: optional.invariantManifest,
  });
  if (plans.length === 0) return null;
  return {
    projectRoot,
    touchedRefs,
    manifest: loaded.manifest,
    ...optional,
    plans,
  };
}

function revisionForRef(plan: ArchitectureHostAdoptionPlanItem, raw: Awaited<ReturnType<ReturnType<typeof createBridgeArchitectureImpactFilesystemObserver>>>, ref: string): string | null {
  if (raw.authority.ref === ref && raw.authority.availability === "available") return raw.authority.revision;
  const impact = raw.impacts.find((item) => item.ref === ref);
  return impact?.availability === "available" ? impact.revision : null;
}

async function collectStructuralEvidence(
  prepared: PreparedBridgeArchitectureImpact,
  plan: ArchitectureHostAdoptionPlanItem,
  rawObservation: Awaited<ReturnType<ReturnType<typeof createBridgeArchitectureImpactFilesystemObserver>>>,
): Promise<ArchitectureStructuralEvidence | undefined> {
  if (!prepared.structureManifest || !plan.optionalEvidence.structural) return undefined;
  const pieces: ArchitectureStructuralEvidence[] = [];

  const authorityRevision = revisionForRef(plan, rawObservation, plan.observationPlan.authorityRef);
  if (plan.optionalEvidence.structural.authorityAnchors.length > 0 && authorityRevision) {
    const authorityText = await fs.readFile(resolveArchitectureImpactProjectPath(prepared.projectRoot, plan.observationPlan.authorityRef), "utf8");
    pieces.push(buildMarkdownArchitectureStructuralEvidence({
      architectureId: plan.touch.architectureId,
      authorityRef: plan.observationPlan.authorityRef,
      sourceRevision: authorityRevision,
      markdown: authorityText,
      anchorIds: plan.optionalEvidence.structural.authorityAnchors,
    }));
  }

  for (const analysisPlan of plan.optionalEvidence.structural.symbolAnalysisPlans) {
    const sourceRevision = revisionForRef(plan, rawObservation, analysisPlan.ref);
    if (!sourceRevision) continue;
    const sourceText = await fs.readFile(resolveArchitectureImpactProjectPath(prepared.projectRoot, analysisPlan.ref), "utf8");
    const hostEvidence = await analyzeArchitectureTypeScriptSource({ plan: analysisPlan, sourceText, sourceRevision });
    const normalized = normalizeArchitectureSymbolAnalysisEvidence(prepared.manifest, prepared.structureManifest, hostEvidence);
    pieces.push(buildSymbolArchitectureStructuralEvidence(normalized));
  }

  return pieces.length > 0 ? mergeArchitectureStructuralEvidence(plan.touch.architectureId, pieces) : undefined;
}

function declaredRefsFor(prepared: PreparedBridgeArchitectureImpact, architectureId: string): Set<string> {
  const entry = prepared.manifest.architectures.find((item) => item.architectureId === architectureId);
  if (!entry) return new Set();
  return new Set([entry.authorityRef, ...entry.impactRefs]);
}

async function collectGraphEvidence(
  prepared: PreparedBridgeArchitectureImpact,
  architectureId: string,
): Promise<{ derived: ArchitectureGraphHostEvidence; invariant: ArchitectureInvariantGraphEvidence }> {
  const declared = declaredRefsFor(prepared, architectureId);
  const graph = await buildImportGraph({
    root: prepared.projectRoot,
    filePattern: "*.ts",
    includeTests: false,
    includeExternal: false,
    maxFiles: 1000,
    maxCycles: 0,
    resolutionEngine: "typescript",
  });
  const edges = graph.internalEdges
    .filter((edge) => declared.has(edge.from))
    .slice(0, MAX_GRAPH_EDGES)
    .map((edge) => ({ kind: "import" as const, sourceRef: edge.from, targetRef: edge.to }));
  const unresolvedScoped = graph.unresolved.some((edge) => declared.has(edge.from));
  const complete = !graph.truncated && !unresolvedScoped && graph.internalEdges.filter((edge) => declared.has(edge.from)).length <= MAX_GRAPH_EDGES;
  const derived: ArchitectureGraphHostEvidence = {
    schemaVersion: 1,
    architectureId,
    relationshipClass: "derived",
    evidenceClass: "observed",
    analyzerId: GRAPH_ANALYZER_ID,
    edges,
  };
  const invariant = architectureInvariantGraphEvidenceSchema.parse({
    schemaVersion: 1,
    architectureId,
    relationshipClass: "declared",
    evidenceClass: "observed",
    analyzerId: GRAPH_ANALYZER_ID,
    coverage: complete ? "complete" : "partial",
    edges,
  });
  return { derived, invariant };
}

export async function evaluatePreparedBridgeArchitectureImpact(
  prepared: PreparedBridgeArchitectureImpact,
): Promise<BridgeArchitectureImpactEvaluationResult> {
  const observer = createBridgeArchitectureImpactFilesystemObserver(prepared.projectRoot);
  const items: BridgeArchitectureImpactEvaluationItem[] = [];
  for (const plan of prepared.plans) {
    const reviewState = await readStoredReviewState(prepared.projectRoot, plan.touch.architectureId);
    if (!reviewState) {
      items.push({
        architectureId: plan.touch.architectureId,
        state: "baseline-review-required",
        matchedRefs: plan.touch.matchedRefs.map((item) => item.ref),
        ...(plan.touch.contextRef ? { contextRef: plan.touch.contextRef } : {}),
      });
      continue;
    }
    const rawObservation = await observer(plan.observationPlan);
    const structuralEvidence = reviewState.structuralBaseline
      ? await collectStructuralEvidence(prepared, plan, rawObservation)
      : undefined;
    const graph = plan.optionalEvidence.invariants || plan.optionalEvidence.derivedGraph
      ? await collectGraphEvidence(prepared, plan.touch.architectureId)
      : undefined;
    const evaluation = evaluateArchitectureHostAdoption({
      architectureManifest: prepared.manifest,
      plan,
      baseline: reviewState.baseline,
      hostEvidence: rawObservation,
      reviewedCurrentReceipt: reviewState.reviewedCurrentReceipt,
      projectContextManifest: prepared.projectContextManifest,
      structureManifest: prepared.structureManifest,
      structuralBaseline: reviewState.structuralBaseline,
      structuralEvidence,
      derivedGraphEvidence: graph?.derived,
      invariantManifest: prepared.invariantManifest,
      invariantGraphEvidence: graph?.invariant,
    });
    items.push({
      architectureId: plan.touch.architectureId,
      state: "evaluated",
      matchedRefs: plan.touch.matchedRefs.map((item) => item.ref),
      evaluation,
    });
  }
  return { active: true, touchedRefs: prepared.touchedRefs, items };
}

async function collectFullStructuralEvidence(
  projectRoot: string,
  manifest: ArchitectureImpactManifest,
  structureManifest: ArchitectureStructureManifest,
  architectureId: string,
  observation: Awaited<ReturnType<typeof observeBridgeArchitectureImpactProject>>,
): Promise<ArchitectureStructuralEvidence | undefined> {
  if (!observation.found) return undefined;
  const evidence = observation.evidence.find((item) => item.architectureId === architectureId);
  const architecture = manifest.architectures.find((item) => item.architectureId === architectureId);
  const structure = structureManifest.architectures.find((item) => item.architectureId === architectureId);
  if (!evidence || !architecture || !structure) return undefined;
  const pieces: ArchitectureStructuralEvidence[] = [];
  const authorityAnchors = structure.authorityAnchors ?? [];
  if (authorityAnchors.length > 0 && evidence.observed.authority.availability === "available") {
    const markdown = await fs.readFile(resolveArchitectureImpactProjectPath(projectRoot, architecture.authorityRef), "utf8");
    pieces.push(buildMarkdownArchitectureStructuralEvidence({
      architectureId,
      authorityRef: architecture.authorityRef,
      sourceRevision: evidence.observed.authority.revision,
      markdown,
      anchorIds: authorityAnchors,
    }));
  }
  for (const implementation of structure.implementation ?? []) {
    const observed = evidence.observed.impacts.find((item) => item.ref === implementation.ref);
    if (!observed || observed.availability !== "available") continue;
    const plan = planArchitectureHostAdoption(manifest, [implementation.ref], { structureManifest })
      .find((item) => item.touch.architectureId === architectureId)
      ?.optionalEvidence.structural?.symbolAnalysisPlans.find((item) => item.ref === implementation.ref);
    if (!plan) continue;
    const sourceText = await fs.readFile(resolveArchitectureImpactProjectPath(projectRoot, implementation.ref), "utf8");
    const hostEvidence = await analyzeArchitectureTypeScriptSource({ plan, sourceText, sourceRevision: observed.revision });
    pieces.push(buildSymbolArchitectureStructuralEvidence(normalizeArchitectureSymbolAnalysisEvidence(manifest, structureManifest, hostEvidence)));
  }
  return pieces.length > 0 ? mergeArchitectureStructuralEvidence(architectureId, pieces) : undefined;
}

export async function reviewBridgeArchitectureImpactBaseline(options: {
  projectRoot: string;
  architectureId: string;
  reviewed: true;
}): Promise<{ architectureId: string; receiptPath: string; structural: boolean }> {
  if (options.reviewed !== true) throw new Error("Bridge Architecture Impact baseline review requires reviewed=true.");
  const projectRoot = path.resolve(options.projectRoot);
  const loaded = await loadArchitectureImpactManifest(projectRoot);
  if (!loaded.found) throw new Error("Architecture Impact manifest not found.");
  const observation = await observeBridgeArchitectureImpactProject({ projectRoot });
  if (!observation.found) throw new Error("Architecture Impact observation is unavailable.");
  const evidence = observation.evidence.find((item) => item.architectureId === options.architectureId);
  if (!evidence) throw new Error(`Unknown Architecture Impact architecture: ${options.architectureId}`);
  const baseline = createArchitectureImpactReviewedBaseline(evidence, { reviewed: true });
  const structure = await loadArchitectureStructureManifest(projectRoot, loaded.manifest);
  let structuralBaseline: ArchitectureStructuralReviewedBaseline | undefined;
  if (structure.found) {
    const structuralEvidence = await collectFullStructuralEvidence(projectRoot, loaded.manifest, structure.manifest, options.architectureId, observation);
    if (structuralEvidence) {
      structuralBaseline = createArchitectureStructuralReviewedBaseline({
        impactManifest: loaded.manifest,
        structureManifest: structure.manifest,
        coarseBaseline: baseline,
        evidence: structuralEvidence,
        review: { reviewed: true },
      });
    }
  }
  const state: StoredArchitectureReviewState = {
    schemaVersion: REVIEW_STATE_SCHEMA_VERSION,
    architectureId: options.architectureId,
    baseline,
    ...(structuralBaseline ? { structuralBaseline } : {}),
  };
  const receiptPath = runtimeStatePath(projectRoot, options.architectureId);
  await writeJsonAtomic(receiptPath, state);
  return { architectureId: options.architectureId, receiptPath, structural: Boolean(structuralBaseline) };
}

export async function recordBridgeArchitectureReviewedCurrent(options: {
  projectRoot: string;
  architectureId: string;
  evaluation: ArchitectureHostAdoptionEvaluation;
  reviewedAt: string;
  decision: "reviewed-current";
}): Promise<{ architectureId: string; receiptPath: string }> {
  if (options.decision !== "reviewed-current") throw new Error("Bridge Architecture Impact reviewed-current persistence requires an explicit reviewed-current decision.");
  const projectRoot = path.resolve(options.projectRoot);
  const state = await readStoredReviewState(projectRoot, options.architectureId);
  if (!state) throw new Error(`Architecture Impact baseline review state is missing for ${options.architectureId}.`);
  const reviewedCurrentReceipt = createArchitectureReviewedCurrentReceipt(options.evaluation.projection, {
    decision: "reviewed-current",
    reviewedAt: options.reviewedAt,
  });
  const next: StoredArchitectureReviewState = { ...state, reviewedCurrentReceipt };
  const receiptPath = runtimeStatePath(projectRoot, options.architectureId);
  await writeJsonAtomic(receiptPath, next);
  return { architectureId: options.architectureId, receiptPath };
}
