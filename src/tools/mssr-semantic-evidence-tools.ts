import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { TypeSafeClient, choice, noul, type Questions } from "@typesafe-ai/sdk";
import {
  buildMssrSemanticSynthesisProposal,
  fetchMssrLibrarianEvidence,
  mssrEvidenceAtomSchema,
  mssrJevDecisionRequestSchema,
  mssrLibrarianEvidenceHandleSchema,
  mssrLibrarianRetrievalQuerySchema,
  mssrSemanticEvidenceRelationReviewInputSchema,
  mssrSemanticSynthesisSourceEvidenceSchema,
  reviewMssrSemanticEvidenceRelations,
  searchMssrLibrarianEvidence,
  validateMssrJevDecisionResponse,
  type MssrJevDecisionProvider,
  type MssrJevDecisionRequest,
  type MssrJevDecisionResponse,
} from "@mauroprime/mssr";
import { z } from "zod";
import { resolveToolPath } from "./shared/process.js";
import type { BridgeToolModule } from "./types.js";

const MAX_MARKDOWN_FILE_BYTES = 2_000_000;
const MAX_TOTAL_MARKDOWN_BYTES = 4_000_000;
const MAX_SOURCE_FILES = 32;
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

type ResolvedProject = { root: string; owner: string };

async function resolveManagedProject(projectRootInput: string): Promise<ResolvedProject> {
  const requestedRoot = resolveToolPath(projectRootSchema.parse(projectRootInput), { access: "read" });
  const root = await fs.realpath(requestedRoot);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error("Librarian projectRoot must resolve to a directory.");

  const gitMetadataPath = path.join(root, ".git");
  const manifestPath = path.join(root, ".mssr", "project-context.json");
  const [gitMetadata, manifestBytes] = await Promise.all([
    fs.stat(gitMetadataPath).catch(() => null),
    fs.readFile(manifestPath).catch(() => null),
  ]);
  if (!gitMetadata || !manifestBytes) throw new Error("Librarian requires a Git project initialized with canonical .mssr/project-context.json.");
  let manifest: unknown;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new Error("Canonical .mssr/project-context.json is invalid JSON."); }
  if (!manifest || typeof manifest !== "object" || (manifest as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error("Canonical .mssr/project-context.json has an unsupported schema.");
  }
  return { root, owner: canonicalOwner(root) };
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
  return { documents, markdownByRef };
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
}).strict();

const searchInputSchema = z.object({
  projectRoot: projectRootSchema,
  sourceRefs: z.array(sourceRefSchema).min(1).max(MAX_SOURCE_FILES),
  query: querySchema,
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
        description: "Search explicitly selected UTF-8 Markdown files in a Git project with canonical .mssr/project-context.json. Bridge reads only those paths; data/, logs/, .mssr/runtime/, .git and non-Markdown files are excluded. Returns advisory revision-bound candidate handles.",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string", minLength: 1, maxLength: 4096 },
            sourceRefs: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: MAX_SOURCE_FILES, description: "Explicit project-relative .md paths. This tool does not crawl directories." },
            query: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 500 }, maxResults: { type: "integer", minimum: 1, maximum: 100, default: 20 }, maxSnippetChars: { type: "integer", minimum: 40, maximum: 240, default: 160 } }, required: ["query"], additionalProperties: false },
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
        const { documents } = await readProjectMarkdownBatch(project, args.sourceRefs);
        const query = mssrLibrarianRetrievalQuerySchema.parse(args.query);
        const result = searchMssrLibrarianEvidence({ documents, query });
        return { projectOwner: project.owner, sourceCount: documents.length, ...result };
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
