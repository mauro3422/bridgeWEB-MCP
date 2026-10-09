import path from "node:path";
import { getProjectHealthReport, PROJECT_HEALTH_INTERVAL_MS } from "./project-health.js";

export type ProjectReferenceCandidate = {
  name: string;
  relativeRoot: string;
  projectRoot: string;
  healthLevel: "ok" | "watch" | "review";
  workspaceStatus: {
    status: "absent" | "valid" | "invalid";
    state: "finished" | "abandoned-or-replaced" | null;
    replacedBy: string | null;
  };
  match: {
    basis: "exact" | "prefix" | "tokens" | "contains";
    score: number;
  };
};

export type ProjectReferenceResolution = {
  schemaVersion: 1;
  reference: string;
  normalizedReference: string;
  status: "resolved" | "ambiguous" | "not-found" | "unavailable";
  source: {
    kind: "project-health";
    observedAt: string | null;
    workspaceRoot: string | null;
    snapshotCount: number;
  };
  selected: ProjectReferenceCandidate | null;
  candidates: ProjectReferenceCandidate[];
  selection: {
    strategy: "exact" | "ranked-deterministic" | "insufficient-margin" | "no-match" | "no-snapshot" | "stale-snapshot";
    confidence: "high" | "medium" | "low" | "none";
    margin: number | null;
    deterministic: true;
    semanticSelectorRecommended: boolean;
  };
  nextAction: {
    toolName: "project_context_load" | null;
    arguments: { projectRoot: string } | null;
    instruction: string;
  };
};

type ProjectHealthReport = Awaited<ReturnType<typeof getProjectHealthReport>>;

function normalizeReference(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string): string {
  return normalizeReference(value).replace(/\s+/g, "");
}

function scoreName(reference: string, candidate: string): { basis: ProjectReferenceCandidate["match"]["basis"]; score: number } | null {
  const refNormalized = normalizeReference(reference);
  const candidateNormalized = normalizeReference(candidate);
  const refCompact = compact(reference);
  const candidateCompact = compact(candidate);
  if (!refCompact || !candidateCompact) return null;

  if (refNormalized === candidateNormalized || refCompact === candidateCompact) return { basis: "exact", score: 1000 };

  if (candidateCompact.startsWith(refCompact)) {
    const distancePenalty = Math.min(180, Math.max(0, candidateCompact.length - refCompact.length) * 6);
    return { basis: "prefix", score: 850 - distancePenalty };
  }

  const refTokens = refNormalized.split(" ").filter(Boolean);
  const candidateTokens = candidateNormalized.split(" ").filter(Boolean);
  if (refTokens.length > 0 && refTokens.every((token) => candidateTokens.some((candidateToken) => candidateToken.startsWith(token)))) {
    return { basis: "tokens", score: 720 - Math.min(120, Math.max(0, candidateTokens.length - refTokens.length) * 20) };
  }

  const index = candidateCompact.indexOf(refCompact);
  if (index >= 0) return { basis: "contains", score: 620 - Math.min(160, index * 12) };
  return null;
}

function roundedScore(score: number): number {
  return Math.max(0, Math.min(1, Number((score / 1000).toFixed(3))));
}

export function resolveProjectReferenceFromHealth(
  report: ProjectHealthReport,
  reference: string,
  maxCandidates = 8,
  now = new Date(),
): ProjectReferenceResolution {
  const normalizedReference = normalizeReference(reference);
  const workspaceRoot = report.workspaceRoot || report.latest?.workspaceRoot || null;
  const observedAt = report.latest?.observedAt ?? report.updatedAt ?? null;
  const source = {
    kind: "project-health" as const,
    observedAt,
    workspaceRoot,
    snapshotCount: report.snapshotCount,
  };

  if (!normalizedReference || !workspaceRoot || !report.latest) {
    return {
      schemaVersion: 1,
      reference,
      normalizedReference,
      status: "unavailable",
      source,
      selected: null,
      candidates: [],
      selection: { strategy: "no-snapshot", confidence: "none", margin: null, deterministic: true, semanticSelectorRecommended: false },
      nextAction: {
        toolName: null,
        arguments: null,
        instruction: "Project Health has no usable workspace snapshot. Refresh the existing Project Health projection before resolving a project reference.",
      },
    };
  }

  const observedAtMs = observedAt ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(observedAtMs) || now.getTime() - observedAtMs >= PROJECT_HEALTH_INTERVAL_MS) {
    return {
      schemaVersion: 1,
      reference,
      normalizedReference,
      status: "unavailable",
      source,
      selected: null,
      candidates: [],
      selection: { strategy: "stale-snapshot", confidence: "none", margin: null, deterministic: true, semanticSelectorRecommended: false },
      nextAction: {
        toolName: null,
        arguments: null,
        instruction: "The stored Project Health inventory is missing a valid observation time or is at least 24 hours old. Wait for the Project Health scheduler to refresh it; this read-only resolver will not scan the workspace or guess a project root.",
      },
    };
  }

  const ranked = report.latest.projects
    .map((project) => {
      const byName = scoreName(reference, project.name);
      const byRoot = scoreName(reference, project.relativeRoot);
      const match = !byName ? byRoot : !byRoot || byName.score >= byRoot.score ? byName : byRoot;
      if (!match) return null;
      return {
        name: project.name,
        relativeRoot: project.relativeRoot,
        projectRoot: path.resolve(workspaceRoot, project.relativeRoot),
        healthLevel: project.level,
        workspaceStatus: {
          status: project.workspaceStatus.status,
          state: project.workspaceStatus.state,
          replacedBy: project.workspaceStatus.replacedBy,
        },
        match: { basis: match.basis, score: roundedScore(match.score) },
        rawScore: match.score,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((a, b) => b.rawScore - a.rawScore || a.relativeRoot.length - b.relativeRoot.length || a.relativeRoot.localeCompare(b.relativeRoot));

  const bounded = ranked.slice(0, Math.max(1, Math.min(16, Math.floor(maxCandidates))));
  const candidates = bounded.map(({ rawScore: _rawScore, ...candidate }) => candidate);
  if (bounded.length === 0) {
    return {
      schemaVersion: 1,
      reference,
      normalizedReference,
      status: "not-found",
      source,
      selected: null,
      candidates: [],
      selection: { strategy: "no-match", confidence: "none", margin: null, deterministic: true, semanticSelectorRecommended: false },
      nextAction: { toolName: null, arguments: null, instruction: "No known Project Health entry matches this reference. Do not invent a project root." },
    };
  }

  const best = bounded[0];
  const next = bounded[1] ?? null;
  const marginRaw = next ? best.rawScore - next.rawScore : best.rawScore;
  const margin = Number((marginRaw / 1000).toFixed(3));
  const exact = best.rawScore === 1000 && (!next || next.rawScore < 1000);
  const deterministicWinner = exact || !next || (best.rawScore >= 800 && marginRaw >= 60);

  if (deterministicWinner) {
    const selected = candidates[0];
    return {
      schemaVersion: 1,
      reference,
      normalizedReference,
      status: "resolved",
      source,
      selected,
      candidates,
      selection: {
        strategy: exact ? "exact" : "ranked-deterministic",
        confidence: exact ? "high" : "medium",
        margin,
        deterministic: true,
        semanticSelectorRecommended: false,
      },
      nextAction: {
        toolName: "project_context_load",
        arguments: { projectRoot: selected.projectRoot },
        instruction: "Load this exact owner project context before substantial work; existing Bridge/MSSR routing should continue from that context.",
      },
    };
  }

  return {
    schemaVersion: 1,
    reference,
    normalizedReference,
    status: "ambiguous",
    source,
    selected: null,
    candidates,
    selection: {
      strategy: "insufficient-margin",
      confidence: "low",
      margin,
      deterministic: true,
      semanticSelectorRecommended: true,
    },
    nextAction: {
      toolName: null,
      arguments: null,
      instruction: "The deterministic resolver found multiple plausible owners. Use bounded task/lifecycle evidence or a future semantic selector such as Jev; do not guess. Once selected, call project_context_load with the exact returned projectRoot.",
    },
  };
}

export async function resolveWorkspaceProjectReference(reference: string, maxCandidates = 8): Promise<ProjectReferenceResolution> {
  return resolveProjectReferenceFromHealth(await getProjectHealthReport(), reference, maxCandidates);
}
