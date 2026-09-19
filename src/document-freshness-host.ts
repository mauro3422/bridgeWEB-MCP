import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  documentFreshnessManifestSchema,
  evaluateDocumentFreshness,
  type DocumentFreshnessEvaluation,
  type DocumentFreshnessManifest,
  type DocumentFreshnessObservation,
} from "@mauroprime/mssr";

const execFileAsync = promisify(execFile);
const DEFAULT_MANIFEST_RELATIVE = ".mssr/document-freshness.json";

type GitPathEvidence = {
  available: boolean;
  revision: string | null;
  commit: string | null;
  dirty: boolean;
};

export type BridgeDocumentFreshnessSnapshot = {
  manifestStatus: "absent" | "valid" | "invalid";
  manifestPath: string;
  manifest: DocumentFreshnessManifest | null;
  observations: DocumentFreshnessObservation[];
  evaluation: DocumentFreshnessEvaluation | null;
  error: string | null;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      windowsHide: true,
      maxBuffer: 256 * 1024,
      timeout: 5000,
    });
    return String(result.stdout ?? "").trim();
  } catch {
    return null;
  }
}

async function collectGitPathEvidence(projectRoot: string, ref: string): Promise<GitPathEvidence> {
  const absolute = path.resolve(projectRoot, ...ref.split("/"));
  if (!await fileExists(absolute)) {
    return { available: false, revision: null, commit: null, dirty: false };
  }

  const [commit, status] = await Promise.all([
    git(projectRoot, ["log", "-1", "--format=%H", "--", ref]),
    git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--", ref]),
  ]);
  const dirty = Boolean(status);
  let revision: string | null = null;
  if (commit) revision = dirty ? `${commit}+worktree` : commit;
  else if (dirty) revision = "worktree-untracked";
  else revision = "available-no-git-revision";

  return { available: true, revision, commit: commit || null, dirty };
}

async function isAncestor(projectRoot: string, older: string, newer: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", projectRoot, "merge-base", "--is-ancestor", older, newer], {
      windowsHide: true,
      maxBuffer: 64 * 1024,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

async function relationToDocument(
  projectRoot: string,
  document: GitPathEvidence,
  impact: GitPathEvidence,
): Promise<"not-newer" | "newer" | "unknown"> {
  if (!document.available || !impact.available) return "unknown";

  // A worktree-modified document is itself under review, so Git cannot prove ordering.
  if (document.dirty) return "unknown";
  if (impact.dirty) return "newer";
  if (!document.commit || !impact.commit) return "unknown";
  if (document.commit === impact.commit) return "not-newer";
  if (await isAncestor(projectRoot, document.commit, impact.commit)) return "newer";
  if (await isAncestor(projectRoot, impact.commit, document.commit)) return "not-newer";
  return "unknown";
}

export async function collectBridgeDocumentFreshness(
  projectRoot: string,
  manifestRelative = DEFAULT_MANIFEST_RELATIVE,
): Promise<BridgeDocumentFreshnessSnapshot> {
  const root = path.resolve(projectRoot);
  const manifestPath = path.resolve(root, ...manifestRelative.split("/"));
  if (!await fileExists(manifestPath)) {
    return {
      manifestStatus: "absent",
      manifestPath,
      manifest: null,
      observations: [],
      evaluation: null,
      error: null,
    };
  }

  let manifest: DocumentFreshnessManifest;
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest = documentFreshnessManifestSchema.parse(raw);
  } catch (error) {
    return {
      manifestStatus: "invalid",
      manifestPath,
      manifest: null,
      observations: [],
      evaluation: null,
      error: error instanceof Error ? error.message.slice(0, 500) : "invalid document freshness manifest",
    };
  }

  const observations: DocumentFreshnessObservation[] = [];
  for (const entry of manifest.documents) {
    const document = await collectGitPathEvidence(root, entry.documentRef);
    const impacts = [];
    for (const ref of entry.impactRefs) {
      const impact = await collectGitPathEvidence(root, ref);
      impacts.push({
        ref,
        available: impact.available,
        revision: impact.revision,
        relationToDocument: await relationToDocument(root, document, impact),
      });
    }
    observations.push({
      documentId: entry.documentId,
      documentRef: entry.documentRef,
      documentAvailable: document.available,
      documentRevision: document.revision,
      impactRefs: impacts,
    });
  }

  return {
    manifestStatus: "valid",
    manifestPath,
    manifest,
    observations,
    evaluation: evaluateDocumentFreshness({ manifest, observations }),
    error: null,
  };
}
