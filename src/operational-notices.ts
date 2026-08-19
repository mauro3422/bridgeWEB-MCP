import { createHash } from "node:crypto";
import {
  evaluateMssrOperationalNoticeTransition,
  parseMssrNoticeV1,
  type MssrOperationalNoticeDecision,
} from "@mauroprime/mssr";
import type { BridgeNoticeInput } from "./notices.js";
import type { ProjectHealthItem, ProjectHealthSnapshot } from "./project-health.js";
import type { SkillHealthItem, SkillHealthSnapshot } from "./skill-health.js";

const HEALTH_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

function hashParts(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 20);
}

function skillFingerprint(item: SkillHealthItem): string {
  return hashParts([
    item.status,
    item.contextManifestStatus,
    ...[...item.reasonCodes].sort(),
  ]);
}

function projectFingerprint(item: ProjectHealthItem): string {
  return hashParts([
    item.level,
    item.manifestStatus,
    ...item.findings
      .map((finding) => `${finding.code}:${finding.target}`)
      .sort(),
  ]);
}

export function adaptMssrOperationalDecision(
  decision: MssrOperationalNoticeDecision,
  details: Record<string, unknown>,
  actions: BridgeNoticeInput["actions"],
): BridgeNoticeInput | null {
  const candidate = decision.notice;
  if (!candidate) return null;
  const mssrNotice = parseMssrNoticeV1(candidate);
  return {
    severity: mssrNotice.severity,
    code: mssrNotice.code,
    source: mssrNotice.source,
    message: mssrNotice.message,
    details: {
      ...details,
      mssrNoticeSchemaVersion: mssrNotice.schemaVersion,
      mssrNoticeId: mssrNotice.noticeId,
      subject: mssrNotice.subject,
      recommendation: mssrNotice.recommendation || null,
      event: mssrNotice.details.event,
      previousLevel: mssrNotice.details.previousLevel,
      currentLevel: mssrNotice.details.currentLevel,
      fingerprint: mssrNotice.details.fingerprint,
      advisoryOnly: true,
    },
    actions,
    mssrNotice,
    dedupeKey: mssrNotice.dedupeKey,
    ttlMs: HEALTH_NOTICE_TTL_MS,
  };
}

function skillDecision(current: SkillHealthItem, previous: SkillHealthItem | null): MssrOperationalNoticeDecision {
  return evaluateMssrOperationalNoticeTransition({
    subject: `skill:${current.name}`,
    source: "mssr-skill-health",
    code: "mssr-skill-health-review",
    resolutionCode: "mssr-skill-health-resolved",
    currentLevel: current.status,
    previousLevel: previous?.status ?? null,
    currentFingerprint: skillFingerprint(current),
    previousFingerprint: previous ? skillFingerprint(previous) : null,
    message: `Skill Health requiere revisar ${current.name}: ${current.reasonCodes.join(", ") || "structural-review"}. No se modificó ninguna skill ni routing automáticamente.`,
    resolutionMessage: `Skill Health: ${current.name} salió del nivel REVIEW y ahora está ${current.status.toUpperCase()}.`,
    recommendation: current.recommendation,
  });
}

export function buildSkillHealthNoticeInputs(
  current: SkillHealthSnapshot,
  previous: SkillHealthSnapshot | null,
): BridgeNoticeInput[] {
  const previousByName = new Map((previous?.skills ?? []).map((item) => [item.name, item]));
  const notices: BridgeNoticeInput[] = [];

  for (const item of current.skills) {
    const before = previousByName.get(item.name) ?? null;
    const decision = skillDecision(item, before);
    const notice = adaptMssrOperationalDecision(decision, {
      observedAt: current.observedAt,
      skill: item.name,
      currentStatus: item.status,
      previousStatus: before?.status ?? null,
      reasonCodes: item.reasonCodes,
      contextManifestStatus: item.contextManifestStatus,
      contextModuleCount: item.contextModuleCount,
      referenceFiles: item.referenceFiles,
      advisoryOnly: true,
    }, [{
      label: "Revisar Skill Health",
      toolName: "skill_route_audit",
      instruction: "Inspecciona la evidencia estructural antes de editar. WATCH queda como observación; REVIEW requiere una decisión humana/agente explícita. No autoedites skills ni routing desde el aviso.",
    }]);
    if (notice) notices.push(notice);
  }

  return notices;
}

function projectDecision(current: ProjectHealthItem, previous: ProjectHealthItem | null): MssrOperationalNoticeDecision {
  return evaluateMssrOperationalNoticeTransition({
    subject: `project:${current.relativeRoot}`,
    source: "mssr-project-health",
    code: "mssr-project-health-review",
    resolutionCode: "mssr-project-health-resolved",
    currentLevel: current.level,
    previousLevel: previous?.level ?? null,
    currentFingerprint: projectFingerprint(current),
    previousFingerprint: previous ? projectFingerprint(previous) : null,
    message: `Project Context Health requiere revisar ${current.relativeRoot}: ${current.findingCodes.join(", ") || "structural-review"}. Es evidencia estructural; no se escribió contexto automáticamente.`,
    resolutionMessage: `Project Context Health: ${current.relativeRoot} salió del nivel REVIEW y ahora está ${current.level.toUpperCase()}.`,
    recommendation: current.findings[0]?.recommendation,
  });
}

export function buildProjectHealthNoticeInputs(
  current: ProjectHealthSnapshot,
  previous: ProjectHealthSnapshot | null,
): BridgeNoticeInput[] {
  const previousByRoot = new Map((previous?.projects ?? []).map((item) => [item.relativeRoot, item]));
  const notices: BridgeNoticeInput[] = [];

  for (const item of current.projects) {
    const before = previousByRoot.get(item.relativeRoot) ?? null;
    const decision = projectDecision(item, before);
    const notice = adaptMssrOperationalDecision(decision, {
      observedAt: current.observedAt,
      workspaceRoot: current.workspaceRoot,
      project: item.name,
      relativeRoot: item.relativeRoot,
      currentLevel: item.level,
      previousLevel: before?.level ?? null,
      findingCodes: item.findingCodes,
      findings: item.findings.slice(0, 12),
      advisoryOnly: true,
    }, [{
      label: "Revisar Project Context Health",
      toolName: "project_context_audit",
      arguments: { workspaceRoot: current.workspaceRoot, maxDepth: 4 },
      instruction: "Audita el proyecto y usa project_context_modularization_plan cuando haya presión estructural. No autoescribas core ni conocimiento no indexado.",
    }]);
    if (notice) notices.push(notice);
  }

  return notices;
}
