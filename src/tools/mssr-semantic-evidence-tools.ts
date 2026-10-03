import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { TypeSafeClient, choice, noul, type Questions } from "@typesafe-ai/sdk";
import {
  MSSR_PROJECT_CONTROL_FILES,
  MSSR_PROJECT_HOME_DIR,
  MSSR_LIBRARIAN_JEV_SELECTION_LIMITS,
  MSSR_LIBRARIAN_RETRIEVAL_LIMITS,
  PROJECT_CONTEXT_LIBRARIAN_LIMITS,
  buildMssrSemanticSynthesisProposal,
  fetchMssrLibrarianEvidence,
  mssrEvidenceAtomSchema,
  mssrJevDecisionRequestSchema,
  mssrLibrarianEvidenceHandleSchema,
  mssrLibrarianRetrievalQuerySchema,
  mssrSemanticEvidenceRelationReviewInputSchema,
  mssrSemanticSynthesisSourceEvidenceSchema,
  projectContextManifestSchema,
  projectMssrProjectContextLibrarianMetadata,
  reviewMssrSemanticEvidenceRelations,
  searchMssrLibrarianEvidence,
  selectMssrLibrarianEvidenceWithJev,
  validateMssrJevDecisionResponse,
  type MssrJevDecisionProvider,
  type MssrJevDecisionRequest,
  type MssrJevDecisionResponse,
  type ProjectContextManifest,
} from "@mauroprime/mssr";
import { z } from "zod";
import {
  bindProjectContextMetadataToLibrarianDocuments,
  MSSR_PROJECT_CONTEXT_LIBRARIAN_METADATA_MODE,
  type ProjectContextMetadataIndex,
} from "../mssr-project-context-librarian-metadata.js";
import { resolveToolPath } from "./shared/process.js";
import type { BridgeToolModule } from "./types.js";

const MAX_MARKDOWN_FILE_BYTES = 2_000_000;
const MAX_TOTAL_MARKDOWN_BYTES = 4_000_000;
const MAX_SOURCE_FILES = 32;
const MAX_PROJECT_CONTEXT_MANIFEST_BYTES = 1_000_000;
const MAX_PROJECT_CONTEXT_AUXILIARY_MANIFEST_BYTES = 1_000_000;
const MAX_CREDENTIAL_OUTPUT_BYTES = 16_384;
const MAX_CREDENTIAL_READ_MS = 10_000;
const DEFAULT_CREDENTIAL_TARGET = "TypeSafe:MSSR:JevLab";
const DEFAULT_JEV_MODEL = "jev-latest";
const TYPESAFE_API_BASE_URL = "https://api.typesafe.ai";
const credentialReaderPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/read-windows-credential.ps1");
const deniedSourceSegments = new Set([
  ".git", ".bridge", "data", "logs", "node_modules", "runtime", "sessions", "archived_sessions",
  ".ssh", ".aws", ".azure", ".kube", ".docker", "credentials", "secrets",
]);
const deniedSensitiveBasename = /^(?:secret|secrets|credential|credentials|token|tokens|private|password)(?:[-_.].*)?$/i;

const projectRootSchema = z.string().trim().min(1).max(4_096);
const sourceRefSchema = z.string().trim().min(1).max(1_000);

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalOwner(root: string): string {
  const normalized = root.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeProjectSourceRef(value: string): string {
  if (value !== value.trim() || value.includes("\\") || value.includes(":") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error("Librarian sourceRef must be a clean project-relative Markdown path using '/'.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Librarian sourceRef cannot contain empty, '.' or '..' path segments.");
  }
  if (path.posix.normalize(value) !== value || !/\.md$/i.test(value)) {
    throw new Error("Librarian accepts only normalized project-relative .md sources.");
  }
  const lowered = segments.map((segment) => segment.toLowerCase());
  if (lowered.some((segment) => deniedSourceSegments.has(segment))) {
    throw new Error("Librarian sourceRef is outside the approved project-document scope.");
  }
  if (segments.some((segment) => deniedSensitiveBasename.test(segment.replace(/\.md$/i, "")))) {
    throw new Error("Librarian sourceRef contains a sensitive-looking path segment.");
  }
  if (lowered[0] === ".mssr" && lowered[1] === "runtime") {
    throw new Error("Librarian cannot read ephemeral .mssr/runtime state.");
  }
  return value;
}

type ResolvedProject = {
  root: string;
  owner: string;
  projectContextManifest: ProjectContextManifest;
  projectContextManifestRevision: string;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadCanonicalProjectContextManifest(projectRoot: string): Promise<{ manifest: ProjectContextManifest; revision: string }> {
  const expectedPath = path.join(projectRoot, MSSR_PROJECT_HOME_DIR, MSSR_PROJECT_CONTROL_FILES.projectContextManifest);
  const realPath = await fs.realpath(expectedPath).catch(() => null);
  if (!realPath || !isWithin(projectRoot, realPath)) {
    throw new Error("Librarian requires the canonical .mssr/project-context.json inside the selected project root.");
  }
  const before = await fs.stat(realPath).catch(() => null);
  if (!before?.isFile()) throw new Error("Canonical .mssr/project-context.json must be a regular file.");
  if (before.size > MAX_PROJECT_CONTEXT_MANIFEST_BYTES) throw new Error(`Canonical .mssr/project-context.json exceeds ${MAX_PROJECT_CONTEXT_MANIFEST_BYTES} bytes.`);
  const bytes = await fs.readFile(realPath);
  const after = await fs.stat(realPath);
  if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error("Canonical .mssr/project-context.json changed while it was being read; retry against a stable revision.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Canonical .mssr/project-context.json is invalid JSON."); }
  let manifest: ProjectContextManifest;
  try { manifest = projectContextManifestSchema.parse(parsed); }
  catch { throw new Error("Canonical .mssr/project-context.json does not satisfy the supported MSSR project-context schema."); }
  return { manifest, revision: sha256(bytes) };
}

async function resolveManagedProject(projectRootInput: string): Promise<ResolvedProject> {
  const requestedRoot = resolveToolPath(projectRootSchema.parse(projectRootInput), { access: "read" });
  const root = await fs.realpath(requestedRoot);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error("Librarian projectRoot must resolve to a directory.");

  const gitMetadataPath = path.join(root, ".git");
  const gitMetadata = await fs.stat(gitMetadataPath).catch(() => null);
  if (!gitMetadata) throw new Error("Librarian requires a Git project initialized with canonical .mssr/project-context.json.");
  const context = await loadCanonicalProjectContextManifest(root);
  return {
    root,
    owner: canonicalOwner(root),
    projectContextManifest: context.manifest,
    projectContextManifestRevision: context.revision,
  };
}

async function projectContextManifestStillMatches(project: ResolvedProject): Promise<boolean> {
  try {
    const current = await loadCanonicalProjectContextManifest(project.root);
    return current.revision === project.projectContextManifestRevision;
  } catch {
    return false;
  }
}

async function readProjectMarkdown(project: ResolvedProject, sourceRefInput: string): Promise<{ sourceRef: string; markdown: string; bytes: number }> {
  const sourceRef = normalizeProjectSourceRef(sourceRefSchema.parse(sourceRefInput));
  const sourcePath = resolveToolPath(path.resolve(project.root, ...sourceRef.split("/")), { access: "read" });
  const realPath = await fs.realpath(sourcePath);
  if (!isWithin(project.root, realPath)) throw new Error("Librarian source resolves outside the selected project root.");
  const canonicalSourceRef = path.relative(project.root, realPath).split(path.sep).join("/");
  try { normalizeProjectSourceRef(canonicalSourceRef); }
  catch { throw new Error("Librarian source resolves outside the approved project-document scope."); }
  const before = await fs.stat(realPath);
  if (!before.isFile()) throw new Error("Librarian sourceRef must resolve to a regular Markdown file.");
  if (before.size > MAX_MARKDOWN_FILE_BYTES) throw new Error(`Librarian Markdown source exceeds ${MAX_MARKDOWN_FILE_BYTES} bytes.`);
  const bytes = await fs.readFile(realPath);
  const after = await fs.stat(realPath);
  if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    bytes.fill(0);
    throw new Error("Librarian source changed while it was being read; retry against a stable revision.");
  }
  let markdown: string;
  try { markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { bytes.fill(0); throw new Error("Librarian source is not valid UTF-8 Markdown."); }
  bytes.fill(0);
  return { sourceRef, markdown, bytes: before.size };
}

async function readProjectMarkdownBatch(project: ResolvedProject, sourceRefs: readonly string[]) {
  if (sourceRefs.length < 1 || sourceRefs.length > MAX_SOURCE_FILES) {
    throw new Error(`Librarian operations require between 1 and ${MAX_SOURCE_FILES} explicit sourceRefs.`);
  }
  const normalized = sourceRefs.map(normalizeProjectSourceRef);
  if (new Set(normalized).size !== normalized.length) throw new Error("Librarian sourceRefs must be unique.");
  const documents: Array<{ owner: string; sourceRef: string; markdown: string; privacyClass: "project-metadata" }> = [];
  const markdownByRef = new Map<string, string>();
  let totalBytes = 0;
  for (const sourceRef of normalized) {
    const read = await readProjectMarkdown(project, sourceRef);
    totalBytes += read.bytes;
    if (totalBytes > MAX_TOTAL_MARKDOWN_BYTES) throw new Error(`Librarian source batch exceeds ${MAX_TOTAL_MARKDOWN_BYTES} bytes.`);
    markdownByRef.set(read.sourceRef, read.markdown);
    documents.push({ owner: project.owner, sourceRef: read.sourceRef, markdown: read.markdown, privacyClass: "project-metadata" });
  }
  return { documents, markdownByRef, observedAt: new Date().toISOString() };
}

type ProjectContextMetadataStatus = "applied" | "no-exact-section-bindings" | "manifest-changed" | "limits-exceeded";

function emptyProjectContextMetadataIndex(project: ResolvedProject, status: ProjectContextMetadataStatus): ProjectContextMetadataIndex & { status: ProjectContextMetadataStatus } {
  return {
    mode: MSSR_PROJECT_CONTEXT_LIBRARIAN_METADATA_MODE,
    status,
    manifestRevision: project.projectContextManifestRevision,
    sourceCount: 0,
    moduleCount: 0,
    rangeCount: 0,
    atomCount: 0,
    skipped: {
      unselectedSource: 0,
      nonSingleSection: 0,
      unsupportedKind: 0,
      noSearchSelectors: 0,
      ambiguousOrMissingSection: 0,
      unbindableRange: 0,
    },
    advisoryOnly: true,
    truthAuthority: false,
    canonicalRewriteAllowed: false,
  };
}

async function documentsWithProjectContextMetadata(project: ResolvedProject, sourceRefs: readonly string[]) {
  const batch = await readProjectMarkdownBatch(project, sourceRefs);
  if (!(await projectContextManifestStillMatches(project))) {
    return {
      documents: batch.documents,
      bindingsByAtomId: new Map(),
      metadataIndex: emptyProjectContextMetadataIndex(project, "manifest-changed"),
    };
  }
  const bound = bindProjectContextMetadataToLibrarianDocuments({
    documents: batch.documents,
    manifest: project.projectContextManifest,
    manifestRevision: project.projectContextManifestRevision,
    observedAt: batch.observedAt,
  });
  const status: ProjectContextMetadataStatus = bound.limitExceeded
    ? "limits-exceeded"
    : bound.index.atomCount > 0 ? "applied" : "no-exact-section-bindings";
  return { documents: bound.documents, bindingsByAtomId: bound.bindingsByAtomId, metadataIndex: { ...bound.index, status } };
}

type ProjectContextLibrarianSidecarStatus = "applied" | "sidecar-missing" | "no-projectable-declarations" | "manifest-changed" | "limits-exceeded";
type CanonicalJsonSnapshot = { found: true; value: unknown; revision: string; canonicalPath: string; canonicalHomePath: string } | { found: false; value: null; revision: null; canonicalPath: string; canonicalHomePath: string };

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

async function readCanonicalProjectJson(project: ResolvedProject, fileName: string, maxBytes: number, optional: boolean): Promise<CanonicalJsonSnapshot> {
  const homeInput = path.join(project.root, MSSR_PROJECT_HOME_DIR);
  const home = await fs.realpath(homeInput).catch((error: unknown) => {
    if (optional && errorCode(error) === "ENOENT") return null;
    throw new Error(`Canonical .mssr/${fileName} home is unavailable.`);
  });
  if (!home) return { found: false, value: null, revision: null, canonicalPath: path.join(homeInput, fileName), canonicalHomePath: homeInput };
  if (!isWithin(project.root, home)) throw new Error(`Canonical .mssr/${fileName} home resolves outside the selected project root.`);

  const expectedPath = path.join(homeInput, fileName);
  const canonicalExpectedPath = path.join(home, fileName);
  const canonicalPath = await fs.realpath(expectedPath).catch((error: unknown) => {
    if (optional && errorCode(error) === "ENOENT") return null;
    if (errorCode(error) === "ENOENT") throw new Error(`Required canonical .mssr/${fileName} is missing.`);
    throw new Error(`Canonical .mssr/${fileName} could not be resolved safely.`);
  });
  if (!canonicalPath) return { found: false, value: null, revision: null, canonicalPath: canonicalExpectedPath, canonicalHomePath: home };
  if (!isWithin(home, canonicalPath) || !isWithin(project.root, canonicalPath)) {
    throw new Error(`Canonical .mssr/${fileName} resolves outside the project-control directory.`);
  }

  const before = await fs.stat(canonicalPath).catch(() => null);
  if (!before?.isFile()) throw new Error(`Canonical .mssr/${fileName} must be a regular file.`);
  if (before.size > maxBytes) throw new Error(`Canonical .mssr/${fileName} exceeds ${maxBytes} bytes.`);
  const bytes = await fs.readFile(canonicalPath);
  try {
    const after = await fs.stat(canonicalPath);
    if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`Canonical .mssr/${fileName} changed while it was being read; retry against a stable revision.`);
    }
    const revision = sha256(bytes);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error(`Canonical .mssr/${fileName} is not valid UTF-8 JSON.`); }
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new Error(`Canonical .mssr/${fileName} is invalid JSON.`); }
    return { found: true, value, revision, canonicalPath, canonicalHomePath: home };
  } finally {
    bytes.fill(0);
  }
}

function emptyProjectContextLibrarianSidecarIndex(project: ResolvedProject, status: ProjectContextLibrarianSidecarStatus, revisions: {
  librarianManifestRevision: string | null;
  segmentsManifestRevision: string | null;
  referencesManifestRevision: string | null;
}) {
  return {
    mode: "project-context-librarian-sidecar" as const,
    status,
    projectContextManifestRevision: project.projectContextManifestRevision,
    ...revisions,
    declared: 0,
    projected: 0,
    omitted: 0,
    items: [] as Array<unknown>,
    selectorsAreProjectDeclared: true as const,
    sourceOwnerIsCallerAsserted: true as const,
    advisoryOnly: true as const,
    truthAuthority: false as const,
    canonicalRewriteAllowed: false as const,
  };
}

async function sidecarSnapshotsStillMatch(project: ResolvedProject, initial: {
  librarian: CanonicalJsonSnapshot;
  segments: CanonicalJsonSnapshot;
  references: CanonicalJsonSnapshot;
}): Promise<boolean> {
  if (!(await projectContextManifestStillMatches(project))) return false;
  try {
    const [librarian, segments, references] = await Promise.all([
      readCanonicalProjectJson(project, MSSR_PROJECT_CONTROL_FILES.projectContextLibrarianManifest, PROJECT_CONTEXT_LIBRARIAN_LIMITS.sidecarBytes, true),
      readCanonicalProjectJson(project, MSSR_PROJECT_CONTROL_FILES.projectContextSegmentsManifest, MAX_PROJECT_CONTEXT_AUXILIARY_MANIFEST_BYTES, true),
      readCanonicalProjectJson(project, MSSR_PROJECT_CONTROL_FILES.projectContextReferencesManifest, MAX_PROJECT_CONTEXT_AUXILIARY_MANIFEST_BYTES, true),
    ]);
    return [librarian, segments, references].every((current, index) => {
      const before = [initial.librarian, initial.segments, initial.references][index];
      return current.found === before.found
        && current.revision === before.revision
        && current.canonicalPath === before.canonicalPath
        && current.canonicalHomePath === before.canonicalHomePath;
    });
  } catch {
    return false;
  }
}

async function documentsWithProjectContextLibrarianSidecar(project: ResolvedProject, sourceRefs: readonly string[]) {
  const batch = await readProjectMarkdownBatch(project, sourceRefs);
  const [librarian, segments, references] = await Promise.all([
    readCanonicalProjectJson(project, MSSR_PROJECT_CONTROL_FILES.projectContextLibrarianManifest, PROJECT_CONTEXT_LIBRARIAN_LIMITS.sidecarBytes, true),
    readCanonicalProjectJson(project, MSSR_PROJECT_CONTROL_FILES.projectContextSegmentsManifest, MAX_PROJECT_CONTEXT_AUXILIARY_MANIFEST_BYTES, true),
    readCanonicalProjectJson(project, MSSR_PROJECT_CONTROL_FILES.projectContextReferencesManifest, MAX_PROJECT_CONTEXT_AUXILIARY_MANIFEST_BYTES, true),
  ]);
  const revisions = {
    librarianManifestRevision: librarian.revision,
    segmentsManifestRevision: segments.revision,
    referencesManifestRevision: references.revision,
  };
  if (!librarian.found) {
    const stable = await sidecarSnapshotsStillMatch(project, { librarian, segments, references });
    return {
      documents: batch.documents,
      bindingsByAtomId: new Map<string, { entryId: string; sourceRef: string; headingPath: string[]; rangeId: string }>(),
      metadataIndex: emptyProjectContextLibrarianSidecarIndex(project, stable ? "sidecar-missing" : "manifest-changed", revisions),
    };
  }

  const projection = projectMssrProjectContextLibrarianMetadata({
    projectContextManifest: project.projectContextManifest,
    librarianManifest: librarian.value,
    segmentsManifest: segments.found ? segments.value : null,
    referencesManifest: references.found ? references.value : null,
    sourceFiles: batch.documents.map((document) => ({ path: document.sourceRef, markdown: document.markdown })),
    owner: project.owner,
  });
  const recordsPerSource = new Map<string, number>();
  for (const record of projection.records) recordsPerSource.set(record.sourceRef, (recordsPerSource.get(record.sourceRef) ?? 0) + 1);
  const atomsPerSource = new Map<string, number>();
  for (const atom of projection.evidenceAtoms) atomsPerSource.set(atom.source.ref, (atomsPerSource.get(atom.source.ref) ?? 0) + 1);
  const overLimit = projection.records.length > MSSR_LIBRARIAN_RETRIEVAL_LIMITS.maxTotalRecords
    || projection.evidenceAtoms.length > MSSR_LIBRARIAN_RETRIEVAL_LIMITS.maxTotalEvidenceAtoms
    || [...recordsPerSource.values()].some((count) => count > MSSR_LIBRARIAN_RETRIEVAL_LIMITS.maxRecordsPerDocument)
    || [...atomsPerSource.values()].some((count) => count > MSSR_LIBRARIAN_RETRIEVAL_LIMITS.maxEvidenceAtomsPerDocument);
  const stable = await sidecarSnapshotsStillMatch(project, { librarian, segments, references });
  const emptyBindings = new Map<string, { entryId: string; sourceRef: string; headingPath: string[]; rangeId: string }>();
  if (!stable) {
    return {
      documents: batch.documents,
      bindingsByAtomId: emptyBindings,
      metadataIndex: { ...emptyProjectContextLibrarianSidecarIndex(project, "manifest-changed", revisions), declared: projection.declared, omitted: projection.declared },
    };
  }
  if (overLimit) {
    return {
      documents: batch.documents,
      bindingsByAtomId: emptyBindings,
      metadataIndex: { ...emptyProjectContextLibrarianSidecarIndex(project, "limits-exceeded", revisions), declared: projection.declared, omitted: projection.declared },
    };
  }

  const documents = batch.documents.map((document) => ({ ...document, records: [] as typeof projection.records, evidenceAtoms: [] as typeof projection.evidenceAtoms }));
  const outputByRef = new Map(documents.map((document, index) => [document.sourceRef, index] as const));
  for (const record of projection.records) {
    const index = outputByRef.get(record.sourceRef);
    if (index !== undefined) documents[index].records.push(record);
  }
  for (const atom of projection.evidenceAtoms) {
    const index = outputByRef.get(atom.source.ref);
    if (index !== undefined) documents[index].evidenceAtoms.push(atom);
  }
  const bindingsByAtomId = new Map<string, { entryId: string; sourceRef: string; headingPath: string[]; rangeId: string }>();
  for (const item of projection.items) {
    if (item.status !== "projected" || !item.evidenceAtomId || !item.sourceRef || !item.rangeId) continue;
    bindingsByAtomId.set(item.evidenceAtomId, { entryId: item.entryId, sourceRef: item.sourceRef, headingPath: item.headingPath, rangeId: item.rangeId });
  }
  const status: ProjectContextLibrarianSidecarStatus = projection.projected > 0 ? "applied" : "no-projectable-declarations";
  return {
    documents,
    bindingsByAtomId,
    metadataIndex: {
      mode: "project-context-librarian-sidecar" as const,
      status,
      projectContextManifestRevision: project.projectContextManifestRevision,
      ...revisions,
      declared: projection.declared,
      projected: projection.projected,
      omitted: projection.omitted,
      items: projection.items,
      selectorsAreProjectDeclared: projection.selectorsAreProjectDeclared,
      sourceOwnerIsCallerAsserted: projection.sourceOwnerIsCallerAsserted,
      advisoryOnly: projection.advisoryOnly,
      truthAuthority: projection.truthAuthority,
      canonicalRewriteAllowed: projection.canonicalRewriteAllowed,
    },
  };
}

async function revalidateHandle(project: ResolvedProject, handleInput: unknown) {
  const handle = mssrLibrarianEvidenceHandleSchema.parse(handleInput);
  if (handle.owner !== project.owner) throw new Error("Evidence handle belongs to a different canonical project root.");
  if (handle.privacyClass !== "project-metadata") throw new Error("Bridge Librarian currently accepts only project-metadata sources.");
  const source = await readProjectMarkdown(project, handle.sourceRef);
  return fetchMssrLibrarianEvidence({
    handle,
    owner: project.owner,
    sourceRef: source.sourceRef,
    markdown: source.markdown,
    privacyClass: "project-metadata",
  });
}

async function revalidateEvidenceBatch(project: ResolvedProject, entries: readonly { atomId: string; handle: unknown; text: string }[]) {
  const sourceRefs = [...new Set(entries.map((entry) => mssrLibrarianEvidenceHandleSchema.parse(entry.handle).sourceRef))];
  const { markdownByRef } = await readProjectMarkdownBatch(project, sourceRefs);
  return entries.map((entry) => {
    const handle = mssrLibrarianEvidenceHandleSchema.parse(entry.handle);
    if (handle.owner !== project.owner) throw new Error("Evidence handle belongs to a different canonical project root.");
    if (handle.privacyClass !== "project-metadata") throw new Error("Bridge Librarian currently accepts only project-metadata sources.");
    const markdown = markdownByRef.get(handle.sourceRef);
    if (markdown === undefined) throw new Error("Librarian source was not included in the bounded read set.");
    const fetched = fetchMssrLibrarianEvidence({ handle, owner: project.owner, sourceRef: handle.sourceRef, markdown, privacyClass: "project-metadata" });
    return { atomId: entry.atomId, handle, text: fetched.text };
  });
}

type TypeSafeSystemOne = (apiKey: string, request: MssrJevDecisionRequest) => Promise<MssrJevDecisionResponse>;
export type MssrJevBridgeProviderOptions = {
  /** Test seam for a host-owned Windows Credential Manager reader. */
  readCredentialBytes?: () => Promise<Buffer | null>;
  /** Test seam for the bounded host transport. Production uses TypeSafeClient with logging disabled. */
  executeSystemOne?: TypeSafeSystemOne;
  model?: string;
};

export const MSSR_PROJECT_CONTEXT_LIBRARIAN_SIDECAR_METADATA_MODE = "project-context-librarian-sidecar" as const;

function safeJevError(error: unknown): Error {
  const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    return new Error(`Jev provider request failed (HTTP ${status}); response content was suppressed.`);
  }
  return new Error("Jev provider request failed; check provider availability and Windows Credential Manager configuration.");
}

async function readWindowsCredentialBytes(): Promise<Buffer | null> {
  if (process.platform !== "win32") return null;
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const target = process.env.BRIDGE_MSSR_JEV_CREDENTIAL_TARGET ?? DEFAULT_CREDENTIAL_TARGET;
  if (!/^[A-Za-z0-9:._-]{1,256}$/.test(target)) return null;

  return await new Promise<Buffer | null>((resolve) => {
    let child;
    try {
      child = spawn(powershell, [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", credentialReaderPath, "-CredentialTarget", target,
      ], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, shell: false });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    const timer = setTimeout(() => { rejected = true; try { child.kill(); } catch { /* best effort */ } }, MAX_CREDENTIAL_READ_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_CREDENTIAL_OUTPUT_BYTES) {
        rejected = true;
        try { child.kill(); } catch { /* best effort */ }
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", () => {
      clearTimeout(timer);
      for (const chunk of chunks) chunk.fill(0);
      resolve(null);
    });
    child.once("close", (code: number | null) => {
      clearTimeout(timer);
      const encoded = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      if (code !== 0 || rejected || encoded.length === 0 || encoded.length > MAX_CREDENTIAL_OUTPUT_BYTES) {
        encoded.fill(0);
        resolve(null);
        return;
      }
      const encodedText = encoded.toString("ascii");
      encoded.fill(0);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedText) || encodedText.length % 4 !== 0) {
        resolve(null);
        return;
      }
      const secretBytes = Buffer.from(encodedText, "base64");
      if (secretBytes.length < 2 || secretBytes.length % 2 !== 0) {
        secretBytes.fill(0);
        resolve(null);
        return;
      }
      resolve(secretBytes);
    });
  });
}

async function executeWithTypeSafeClient(apiKey: string, request: MssrJevDecisionRequest, defaultModel: string): Promise<MssrJevDecisionResponse> {
  const client = new TypeSafeClient({ apiKey, baseURL: TYPESAFE_API_BASE_URL, defaultModel, timeout: 30_000, retry: { maxRetries: 1 }, logLevel: "off" });
  const questions: Questions = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => [
    key,
    question.kind === "choice" ? choice(question.prompt, question.options) : noul(question.prompt),
  ]));
  const response = await client.systemOne({ state: request.state as Parameters<TypeSafeClient["systemOne"]>[0]["state"], questions, model: request.model ?? defaultModel });
  const answers = Object.fromEntries(Object.entries(response.answers).map(([key, answer]) => {
    const value = answer as { type?: string; choice?: string; confidence?: number; noul?: number };
    if (value.type === "choice") return [key, { type: "choice", choice: value.choice, confidence: value.confidence }];
    if (value.type === "noul") return [key, { type: "noul", noul: value.noul }];
    throw new Error("TypeSafe Jev returned an unsupported answer type.");
  }));
  return { provider: "typesafe-jev", model: response.model, answers, usage: response.usage };
}

export function createMssrJevBridgeDecisionProvider(options: MssrJevBridgeProviderOptions = {}): MssrJevDecisionProvider {
  const readCredentialBytes = options.readCredentialBytes ?? readWindowsCredentialBytes;
  const model = options.model ?? process.env.BRIDGE_MSSR_JEV_MODEL ?? DEFAULT_JEV_MODEL;
  const executeSystemOne = options.executeSystemOne ?? ((apiKey, request) => executeWithTypeSafeClient(apiKey, request, model));
  return {
    async executeSystemOne(requestInput) {
      const request = mssrJevDecisionRequestSchema.parse(requestInput);
      const secretBytes = await readCredentialBytes();
      if (!secretBytes) throw new Error("Jev credential unavailable in Windows Credential Manager; other Bridge tools remain available.");
      let apiKey = "";
      try {
        apiKey = secretBytes.toString("utf16le").replace(/\0+$/, "");
        if (!apiKey || /[\0\r\n]/.test(apiKey)) throw new Error("Jev credential unavailable in Windows Credential Manager; other Bridge tools remain available.");
        const response = await executeSystemOne(apiKey, { ...request, model: request.model ?? model });
        return validateMssrJevDecisionResponse({ ...request, model: request.model ?? model }, response);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Jev credential unavailable")) throw error;
        throw safeJevError(error);
      } finally {
        secretBytes.fill(0);
        apiKey = "";
      }
    },
  };
}

export type MssrSemanticEvidenceToolModuleOptions = {
  decisionProvider?: MssrJevDecisionProvider;
};

const querySchema = z.object({
  query: z.string().trim().min(1).max(500),
  maxResults: z.number().int().min(1).max(100).default(20),
  maxSnippetChars: z.number().int().min(40).max(240).default(160),
  metadata: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/), z.union([z.string().max(240), z.number().finite(), z.boolean()])).optional().superRefine((value, ctx) => {
    if (value && Object.keys(value).length > 64) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Librarian metadata filters are limited to 64 fields." });
  }),
}).strict();

const searchInputSchema = z.object({
  projectRoot: projectRootSchema,
  sourceRefs: z.array(sourceRefSchema).min(1).max(MAX_SOURCE_FILES),
  query: querySchema,
  metadataMode: z.enum(["off", MSSR_PROJECT_CONTEXT_LIBRARIAN_METADATA_MODE, MSSR_PROJECT_CONTEXT_LIBRARIAN_SIDECAR_METADATA_MODE]).default("off"),
}).strict();

const jevSelectionInputSchema = z.object({
  projectRoot: projectRootSchema,
  sourceRefs: z.array(sourceRefSchema).min(1).max(MAX_SOURCE_FILES),
  query: z.string().trim().min(1).max(500),
  candidateHandles: z.array(mssrLibrarianEvidenceHandleSchema).min(1).max(MSSR_LIBRARIAN_JEV_SELECTION_LIMITS.maxCandidateHandles).optional(),
  model: z.string().trim().min(1).max(120).optional(),
}).strict();

const fetchInputSchema = z.object({ projectRoot: projectRootSchema, handle: mssrLibrarianEvidenceHandleSchema }).strict();

const relationInputSchema = z.object({
  projectRoot: projectRootSchema,
  input: mssrSemanticEvidenceRelationReviewInputSchema,
}).strict();

const synthesisInputSchema = z.object({
  projectRoot: projectRootSchema,
  input: z.object({
    judgment: z.unknown(),
    inputAtoms: z.array(mssrEvidenceAtomSchema).min(1).max(64),
    sourceEvidence: z.array(mssrSemanticSynthesisSourceEvidenceSchema).min(1).max(64),
    minimumRawRelationConfidence: z.number().min(0).max(1).optional(),
  }).strict(),
}).strict();

const exactHandleObjectSchema = { type: "object", description: "MSSR Librarian revision-bound handle; all fields are validated by the packaged MSSR schema.", additionalProperties: true } as const;
const evidenceAtomObjectSchema = { type: "object", description: "MSSR EvidenceAtom v2; all fields are validated strictly by the packaged MSSR schema.", additionalProperties: true } as const;
const sourceEvidenceObjectSchema = {
  type: "object",
  properties: {
    atomId: { type: "string", minLength: 1, maxLength: 64 },
    handle: exactHandleObjectSchema,
    text: { type: "string", minLength: 1, maxLength: 20_000, description: "Included for compatibility and ignored; Bridge re-reads the exact source." },
  },
  required: ["atomId", "handle", "text"],
  additionalProperties: false,
} as const;

function createMssrSemanticEvidenceToolModule(options: MssrSemanticEvidenceToolModuleOptions = {}): BridgeToolModule {
  const decisionProvider = options.decisionProvider ?? createMssrJevBridgeDecisionProvider();
  return {
    name: "mssr-semantic-evidence",
    tools: [
      {
        name: "mssr_librarian_search",
        description: "Search explicitly selected UTF-8 Markdown files in a Git project with canonical .mssr/project-context.json. Bridge reads only those paths; data/, logs/, .mssr/runtime/, .git and non-Markdown files are excluded. Metadata is opt-in: project-context-single-section uses the legacy exact single-heading selectors; project-context-librarian-sidecar uses only owner-declared exact headings from .mssr/project-context-librarian.json, checked against the canonical context, segment and reference manifests and current Markdown fingerprints. The sidecar mode does not crawl, inherit module-wide tags, or infer selectors from prose; absent declarations or stale inputs leave lexical-only results with an explicit status. Returns advisory revision-bound candidate handles.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string", minLength: 1, maxLength: 4096 },
            sourceRefs: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: MAX_SOURCE_FILES, description: "Explicit project-relative .md paths. This tool does not crawl directories." },
            query: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 500 }, maxResults: { type: "integer", minimum: 1, maximum: 100, default: 20 }, maxSnippetChars: { type: "integer", minimum: 40, maximum: 240, default: 160 }, metadata: { type: "object", maxProperties: 64, additionalProperties: { oneOf: [{ type: "string", maxLength: 240 }, { type: "number" }, { type: "boolean" }] }, description: "Optional typed metadata filters; project-context selector filters apply only when metadataMode opts in." } }, required: ["query"], additionalProperties: false },
            metadataMode: { type: "string", enum: ["off", MSSR_PROJECT_CONTEXT_LIBRARIAN_METADATA_MODE, MSSR_PROJECT_CONTEXT_LIBRARIAN_SIDECAR_METADATA_MODE], default: "off", description: "Opt in to project-context metadata. Use project-context-single-section for the legacy selector path or project-context-librarian-sidecar for exact declared librarian headings and fingerprint validation. Default off preserves lexical-only behavior." },
          },
          required: ["projectRoot", "sourceRefs", "query"],
          additionalProperties: false,
        },
      },
      {
        name: "mssr_librarian_fetch",
        description: "Re-read and validate one exact Librarian handle against the current file revision under the selected managed project root. Only project-metadata Markdown is accepted; no caller-provided source text is trusted.",
        inputSchema: { type: "object", properties: { projectRoot: { type: "string", minLength: 1, maxLength: 4096 }, handle: exactHandleObjectSchema }, required: ["projectRoot", "handle"], additionalProperties: false },
      },
      {
        name: "mssr_librarian_jev_select",
        description: `Make one live TypeSafe Jev Choice call over explicitly selected project Markdown files. By default it offers heading sections; callers may instead pass up to ${MSSR_LIBRARIAN_JEV_SELECTION_LIMITS.maxCandidateHandles} exact candidateHandles returned by mssr_librarian_search, so Jev can choose query-matched blocks and deeper evidence. To use declared project-context selectors, first call mssr_librarian_search with metadataMode=project-context-single-section or project-context-librarian-sidecar, then pass the returned exact handles here; metadata retrieval and Jev selection remain separate inspectable steps. Bridge reads only sourceRefs and MSSR revalidates each handle against the current owner, source, revision, range, fingerprint, and privacy class before the provider call. The result is advisory; call mssr_librarian_fetch before using source text. This external request may incur account usage. It does not crawl, establish truth, generate prose, or write files. At most ${MSSR_LIBRARIAN_JEV_SELECTION_LIMITS.maxHeadingCandidates} heading sections or ${MSSR_LIBRARIAN_JEV_SELECTION_LIMITS.maxCandidateHandles} exact handles plus none are offered; oversized sets are rejected without truncation.`,
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string", minLength: 1, maxLength: 4096 },
            sourceRefs: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: MAX_SOURCE_FILES, description: "Explicit project-relative .md paths. This tool does not crawl directories." },
            query: { type: "string", minLength: 1, maxLength: 500 },
            candidateHandles: { type: "array", items: exactHandleObjectSchema, minItems: 1, maxItems: MSSR_LIBRARIAN_JEV_SELECTION_LIMITS.maxCandidateHandles, description: "Optional exact revision-bound handles returned by mssr_librarian_search. Every handle must refer to one of the explicitly supplied sourceRefs and is revalidated before calling Jev." },
            model: { type: "string", minLength: 1, maxLength: 120 },
          },
          required: ["projectRoot", "sourceRefs", "query"],
          additionalProperties: false,
        },
      },
      {
        name: "mssr_semantic_evidence_relation_review",
        description: "Re-read every exact source range under the selected managed project root, then ask Jev for bounded advisory relations. This makes an external TypeSafe/Jev request and may incur account usage. Windows Credential Manager is read on demand; no API key is accepted in tool arguments, environment files or telemetry. Judgments remain unverified and cannot authorize writes.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string", minLength: 1, maxLength: 4096 },
            input: {
              type: "object",
              properties: {
                projectKey: { type: "string", minLength: 1, maxLength: 320 },
                corpusKey: { type: "string", minLength: 1, maxLength: 320 },
                goal: { type: "string", minLength: 1, maxLength: 2000 },
                inputAtoms: { type: "array", items: evidenceAtomObjectSchema, minItems: 2, maxItems: 64 },
                sourceEvidence: { type: "array", items: sourceEvidenceObjectSchema, minItems: 2, maxItems: 64 },
                pairs: { type: "array", items: { type: "object", properties: { id: { type: "string" }, leftAtomId: { type: "string" }, rightAtomId: { type: "string" }, claim: { type: "object", additionalProperties: true }, comparability: { type: "object", additionalProperties: true } }, required: ["id", "leftAtomId", "rightAtomId", "claim", "comparability"], additionalProperties: false }, minItems: 1, maxItems: 128 },
                traceId: { type: "string", minLength: 6, maxLength: 128 },
                model: { type: "string", minLength: 1, maxLength: 120 },
                maxPairsPerRequest: { type: "integer", minimum: 1, maximum: 64, default: 32 },
                maxStateChars: { type: "integer", minimum: 1000, maximum: 262144, default: 24000 },
                concurrency: { type: "integer", minimum: 1, maximum: 16, default: 4 },
              },
              required: ["projectKey", "corpusKey", "goal", "inputAtoms", "sourceEvidence", "pairs", "traceId"],
              additionalProperties: false,
            },
          },
          required: ["projectRoot", "input"],
          additionalProperties: false,
        },
      },
      {
        name: "mssr_semantic_evidence_synthesis_preview",
        description: "Re-read all exact source ranges and build an immutable synthesis preview. It never writes files; conflicts, unverified judgments, unknown comparability or stale sources stay in review.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string", minLength: 1, maxLength: 4096 },
            input: {
              type: "object",
              properties: {
                judgment: { type: "object", description: "Versioned MSSR semantic judgment; validated by MSSR.", additionalProperties: true },
                inputAtoms: { type: "array", items: evidenceAtomObjectSchema, minItems: 1, maxItems: 64 },
                sourceEvidence: { type: "array", items: sourceEvidenceObjectSchema, minItems: 1, maxItems: 64 },
                minimumRawRelationConfidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["judgment", "inputAtoms", "sourceEvidence"],
              additionalProperties: false,
            },
          },
          required: ["projectRoot", "input"],
          additionalProperties: false,
        },
      },
    ],
    handlers: {
      mssr_librarian_search: async (raw) => {
        const args = searchInputSchema.parse(raw);
        const project = await resolveManagedProject(args.projectRoot);
        const prepared = args.metadataMode === "off"
          ? await readProjectMarkdownBatch(project, args.sourceRefs)
          : args.metadataMode === MSSR_PROJECT_CONTEXT_LIBRARIAN_METADATA_MODE
            ? await documentsWithProjectContextMetadata(project, args.sourceRefs)
            : await documentsWithProjectContextLibrarianSidecar(project, args.sourceRefs);
        const documents = prepared.documents;
        const query = mssrLibrarianRetrievalQuerySchema.parse(args.query);
        const result = searchMssrLibrarianEvidence({ documents, query });
        const results = args.metadataMode === MSSR_PROJECT_CONTEXT_LIBRARIAN_METADATA_MODE
          ? result.results.map((item) => {
            const bindings = [...new Map((item.metadataProjectionMatches ?? []).flatMap((match) => {
              const binding = (prepared as Awaited<ReturnType<typeof documentsWithProjectContextMetadata>>).bindingsByAtomId.get(match.atomId);
              return binding ? [[`${binding.moduleId}:${binding.selectorField}:${binding.selectorValue}`, binding] as const] : [];
            })).values()];
            return bindings.length > 0 ? { ...item, projectContextMetadataBindings: bindings } : item;
          })
          : args.metadataMode === MSSR_PROJECT_CONTEXT_LIBRARIAN_SIDECAR_METADATA_MODE
            ? result.results.map((item) => {
              const bindings = [...new Map((item.metadataProjectionMatches ?? []).flatMap((match) => {
                const binding = (prepared as Awaited<ReturnType<typeof documentsWithProjectContextLibrarianSidecar>>).bindingsByAtomId.get(match.atomId);
                return binding ? [[`${binding.entryId}:${binding.sourceRef}:${binding.rangeId}`, binding] as const] : [];
              })).values()];
              return bindings.length > 0 ? { ...item, projectContextLibrarianBindings: bindings } : item;
            })
            : result.results;
        return {
          projectOwner: project.owner,
          sourceCount: args.sourceRefs.length,
          ...( "metadataIndex" in prepared ? { metadataIndex: prepared.metadataIndex } : {}),
          ...result,
          results,
        };
      },
      mssr_librarian_jev_select: async (raw) => {
        const args = jevSelectionInputSchema.parse(raw);
        const project = await resolveManagedProject(args.projectRoot);
        const prepared = await readProjectMarkdownBatch(project, args.sourceRefs);
        const result = await selectMssrLibrarianEvidenceWithJev({
          documents: prepared.documents,
          query: args.query,
          ...(args.candidateHandles ? { candidateHandles: args.candidateHandles } : {}),
          ...(args.model ? { model: args.model } : {}),
        }, decisionProvider);
        return { projectOwner: project.owner, sourceCount: args.sourceRefs.length, ...result };
      },
      mssr_librarian_fetch: async (raw) => {
        const args = fetchInputSchema.parse(raw);
        const project = await resolveManagedProject(args.projectRoot);
        const evidence = await revalidateHandle(project, args.handle);
        return { projectOwner: project.owner, ...evidence };
      },
      mssr_semantic_evidence_relation_review: async (raw) => {
        const args = relationInputSchema.parse(raw);
        const project = await resolveManagedProject(args.projectRoot);
        const sourceEvidence = await revalidateEvidenceBatch(project, args.input.sourceEvidence);
        return await reviewMssrSemanticEvidenceRelations({ input: { ...args.input, sourceEvidence }, provider: decisionProvider });
      },
      mssr_semantic_evidence_synthesis_preview: async (raw) => {
        const args = synthesisInputSchema.parse(raw);
        if (!Object.prototype.hasOwnProperty.call(args.input, "judgment")) throw new Error("Synthesis preview requires a judgment.");
        const project = await resolveManagedProject(args.projectRoot);
        const sourceEvidence = await revalidateEvidenceBatch(project, args.input.sourceEvidence);
        return buildMssrSemanticSynthesisProposal({
          judgment: args.input.judgment as unknown,
          inputAtoms: args.input.inputAtoms,
          sourceEvidence,
          ...(args.input.minimumRawRelationConfidence !== undefined ? { minimumRawRelationConfidence: args.input.minimumRawRelationConfidence } : {}),
        });
      },
    },
  };
}

export const mssrSemanticEvidenceToolModule = createMssrSemanticEvidenceToolModule();
export { createMssrSemanticEvidenceToolModule };
