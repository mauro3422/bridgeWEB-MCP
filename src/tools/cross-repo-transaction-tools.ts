import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  evaluateMssrCrossRepoAssetOwnership,
  mssrCrossRepoAssetOwnershipInputSchema,
  validateMssrCrossRepoOwnershipTransition,
  type MssrCrossRepoOwnershipDecision,
} from "@mauroprime/mssr";
import type { BridgeToolModule } from "./types.js";
import { resolveToolPath } from "./shared/path.js";

const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
const MAX_POINTER_BYTES = 256 * 1024;
const transactionIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("stage"),
    ownership: z.unknown(),
    sourceRoot: z.string().min(1).max(2048),
    targetRoot: z.string().min(1).max(2048),
    pointerRef: z.string().min(1).max(2048),
    confirmTransactionId: transactionIdSchema,
  }).strict(),
  z.object({
    action: z.literal("commit"),
    transactionId: transactionIdSchema,
    pointerRef: z.string().min(1).max(2048),
    confirmTransactionId: transactionIdSchema,
  }).strict(),
  z.object({
    action: z.literal("recover"),
    transactionId: transactionIdSchema,
    confirmTransactionId: transactionIdSchema,
    disposition: z.enum(["resume", "rollback"]),
  }).strict(),
  z.object({
    action: z.literal("rollback"),
    transactionId: transactionIdSchema,
    confirmTransactionId: transactionIdSchema,
  }).strict(),
]);

const journalSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: transactionIdSchema,
  state: z.enum(["discovered", "owner-resolved", "proposed", "staged", "copied", "verified", "pointer-updated", "committed", "closed", "blocked", "aborted", "rollback-needed"]),
  ownership: z.record(z.unknown()),
  sourceRoot: z.string().min(1),
  targetRoot: z.string().min(1),
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  stagePath: z.string().min(1),
  pointerPath: z.string().min(1),
  sourceHash: hashSchema,
  stagedHash: hashSchema.optional(),
  destinationReadbackHash: hashSchema.optional(),
  pointerBaselineHash: hashSchema.nullable(),
  pointerReadbackHash: hashSchema.optional(),
  pointerUpdateReceipt: z.string().optional(),
  createdDestination: z.boolean(),
  createdDirectories: z.array(z.string()),
  decision: z.record(z.unknown()),
  receiptId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  integritySha256: hashSchema,
}).strict();

type TransactionJournal = z.infer<typeof journalSchema>;
export type BridgeCrossRepoTransactionJournal = TransactionJournal;
type StageAction = z.infer<typeof actionSchema> & { action: "stage" };
const inFlight = new Set<string>();

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRef(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Cross-repository refs must be non-empty normalized relative paths without traversal.");
  }
  return normalized;
}

function transactionJournalPath(transactionId: string): string {
  const dataRoot = path.resolve(process.env.BRIDGE_MCP_METRICS_DIR || path.join(process.cwd(), "data"));
  return path.join(dataRoot, "cross-repo-transactions", `${sha256(transactionId).slice(0, 40)}.json`);
}

function withoutIntegrity(journal: Omit<TransactionJournal, "integritySha256"> | TransactionJournal) {
  const { integritySha256: _integritySha256, ...body } = journal as TransactionJournal;
  return body;
}

function sealJournal(journal: Omit<TransactionJournal, "integritySha256"> | TransactionJournal): TransactionJournal {
  const body = withoutIntegrity(journal);
  return { ...body, integritySha256: sha256(JSON.stringify(body)) } as TransactionJournal;
}

async function writeJournal(journal: Omit<TransactionJournal, "integritySha256"> | TransactionJournal): Promise<TransactionJournal> {
  const sealed = sealJournal({ ...journal, updatedAt: new Date().toISOString() } as TransactionJournal);
  const target = transactionJournalPath(sealed.transactionId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Transaction journal path is not a regular file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(sealed, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporary, target);
    const readback = await readJournal(sealed.transactionId);
    if (!readback || readback.integritySha256 !== sealed.integritySha256) throw new Error("Transaction journal readback integrity check failed.");
    return readback;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readCrossRepoTransactionJournal(transactionId: string): Promise<TransactionJournal | null> {
  const parsedId = transactionIdSchema.safeParse(transactionId);
  if (!parsedId.success) return null;
  return readJournal(parsedId.data);
}

async function readJournal(transactionId: string): Promise<TransactionJournal | null> {
  const journalPath = transactionJournalPath(transactionId);
  let text: string;
  try {
    const stat = await fs.lstat(journalPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 128 * 1024) throw new Error("Transaction journal is not a bounded regular file.");
    text = await fs.readFile(journalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Transaction journal identity or integrity check failed.");
  const rawRecord = raw as Record<string, unknown>;
  const { integritySha256: rawIntegrity, ...rawBody } = rawRecord;
  if (typeof rawIntegrity !== "string" || sha256(JSON.stringify(rawBody)) !== rawIntegrity) throw new Error("Transaction journal identity or integrity check failed.");
  const parsed = journalSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Transaction journal schema is invalid.");
  if (parsed.data.transactionId !== transactionId || rawIntegrity !== parsed.data.integritySha256) {
    throw new Error("Transaction journal identity or integrity check failed.");
  }
  const ownership = mssrCrossRepoAssetOwnershipInputSchema.safeParse(parsed.data.ownership);
  if (!ownership.success || ownership.data.sourceRefs.length !== 1 || ownership.data.targetRefs.length !== 1) throw new Error("Transaction journal ownership refs are invalid.");
  const source = await resolveProjectFile(parsed.data.sourceRoot, ownership.data.sourceRefs[0], "read");
  const target = await resolveProjectFile(parsed.data.targetRoot, ownership.data.targetRefs[0], "write");
  const pointerRef = path.relative(parsed.data.targetRoot, parsed.data.pointerPath).replace(/\\/g, "/");
  const pointer = await resolveProjectFile(parsed.data.targetRoot, pointerRef, "write");
  if (!samePath(source.filePath, parsed.data.sourcePath)
    || !samePath(target.filePath, parsed.data.targetPath)
    || !samePath(pointer.filePath, parsed.data.pointerPath)) throw new Error("Transaction journal paths no longer match the reviewed project refs.");
  return parsed.data;
}

function updateState(
  journal: TransactionJournal,
  to: TransactionJournal["state"],
  evidence: { stagedHash?: string; destinationReadbackHash?: string; pointerUpdateReceipt?: string; pointerUpdated?: boolean } = {},
): Omit<TransactionJournal, "integritySha256"> {
  const transition = validateMssrCrossRepoOwnershipTransition({
    from: journal.state,
    to,
    sourceHash: journal.sourceHash,
    stagedHash: evidence.stagedHash ?? journal.stagedHash,
    destinationReadbackHash: evidence.destinationReadbackHash ?? journal.destinationReadbackHash,
    pointerUpdated: evidence.pointerUpdated,
    pointerUpdateReceipt: evidence.pointerUpdateReceipt ?? journal.pointerUpdateReceipt,
  });
  if (!transition.valid) throw new Error(`Invalid cross-repository transaction transition ${journal.state}->${to}: ${transition.reasonCode}`);
  const { integritySha256: _integritySha256, ...body } = journal;
  return {
    ...body,
    state: to,
    ...(evidence.stagedHash ? { stagedHash: evidence.stagedHash } : {}),
    ...(evidence.destinationReadbackHash ? { destinationReadbackHash: evidence.destinationReadbackHash } : {}),
    ...(evidence.pointerUpdateReceipt ? { pointerUpdateReceipt: evidence.pointerUpdateReceipt } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function readRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Cross-repository source must be a regular non-symlink file.");
  if (stat.size > maxBytes) throw new Error(`Cross-repository file exceeds the ${maxBytes}-byte limit.`);
  return fs.readFile(filePath);
}

async function resolveProjectFile(rootInput: string, refInput: string, access: "read" | "write") {
  const root = resolveToolPath(rootInput, { access });
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error("Cross-repository project root must be an existing directory.");
  const rootReal = await fs.realpath(root);
  const ref = normalizeRef(refInput);
  const filePath = path.resolve(root, ...ref.split("/"));
  if (!isWithin(root, filePath) || samePath(root, filePath)) throw new Error("Cross-repository ref escaped its project root.");
  resolveToolPath(filePath, { access });
  let current = root;
  const parts = ref.split("/");
  const missingParents: string[] = [];
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Cross-repository path contains a non-directory or symbolic-link parent.");
      const real = await fs.realpath(current);
      if (!isWithin(rootReal, real)) throw new Error("Cross-repository path parent escaped the project root.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missingParents.push(current);
    }
  }
  return { root, rootReal, ref, filePath, parentPath: path.dirname(filePath), missingParents };
}

async function ensureDirectories(journal: TransactionJournal, candidates: string[]): Promise<string[]> {
  const created: string[] = [];
  for (const dir of candidates) {
    try { await fs.mkdir(dir); created.push(dir); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Cross-repository destination parent changed into an unsafe path.");
    }
  }
  return created;
}

function assertIdentity(journal: TransactionJournal, ownership: z.infer<typeof mssrCrossRepoAssetOwnershipInputSchema>, sourceRoot: string, targetRoot: string, sourcePath: string, targetPath: string, pointerPath: string, sourceHash: string): void {
  if (journal.transactionId !== ownership.transactionId
    || !samePath(journal.sourceRoot, sourceRoot)
    || !samePath(journal.targetRoot, targetRoot)
    || !samePath(journal.sourcePath, sourcePath)
    || !samePath(journal.targetPath, targetPath)
    || !samePath(journal.pointerPath, pointerPath)
    || journal.sourceHash !== sourceHash
    || journal.ownership.currentTraceId !== ownership.currentTraceId
    || journal.ownership.relatedTraceId !== ownership.relatedTraceId
    || journal.ownership.sourceProject !== ownership.sourceProject
    || journal.ownership.targetProject !== ownership.targetProject
    || journal.ownership.expectedOwnerProject !== ownership.expectedOwnerProject) {
    throw new Error("Transaction ID is already bound to different source, target, owner, trace, or bytes.");
  }
}

async function stageCopy(action: StageAction) {
  const ownershipParsed = mssrCrossRepoAssetOwnershipInputSchema.safeParse(action.ownership);
  if (!ownershipParsed.success) throw new Error(`Invalid MSSR ownership transaction: ${ownershipParsed.error.issues.map((issue) => issue.path.join(".") || "transaction").slice(0, 8).join(",")}`);
  const ownership = ownershipParsed.data;
  if (action.confirmTransactionId !== ownership.transactionId) throw new Error("Repeat the exact transactionId in confirmTransactionId to stage the reviewed transfer.");
  if (!ownership.explicitCopyReview || !["copy", "export"].includes(ownership.operation)) throw new Error("Only an explicitly reviewed copy/export may be staged by this host transaction.");
  if (ownership.sourceRefs.length !== 1 || ownership.targetRefs.length !== 1) throw new Error("Bridge transaction v1 is bounded to exactly one sourceRef and one targetRef.");
  if (ownership.sourceProject === ownership.targetProject) throw new Error("Cross-repository transaction requires distinct source and target projects.");
  if (!ownership.ownerClaim || !ownership.expectedOwnerProject || ownership.ownerClaim.ownerProject.toLocaleLowerCase("en-US") !== ownership.expectedOwnerProject.toLocaleLowerCase("en-US")) {
    throw new Error("Expected owner must match an explicit MSSR owner claim.");
  }

  const source = await resolveProjectFile(action.sourceRoot, ownership.sourceRefs[0], "read");
  const target = await resolveProjectFile(action.targetRoot, ownership.targetRefs[0], "write");
  const pointer = await resolveProjectFile(action.targetRoot, action.pointerRef, "write");
  if (samePath(pointer.filePath, target.filePath)) throw new Error("The consumer pointer must be separate from the copied target artifact.");
  const sourceBuffer = await readRegularFile(source.filePath, MAX_TRANSFER_BYTES);
  const sourceHash = sha256(sourceBuffer);
  let pointerBaselineHash: string | null = null;
  try {
    const pointerBuffer = await readRegularFile(pointer.filePath, MAX_POINTER_BYTES);
    pointerBaselineHash = sha256(pointerBuffer);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let destinationHash: string | undefined;
  try {
    const destination = await readRegularFile(target.filePath, MAX_TRANSFER_BYTES);
    destinationHash = sha256(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const targetProject = path.basename(target.root);
  const sourceProject = path.basename(source.root);
  if (targetProject.toLocaleLowerCase("en-US") !== ownership.targetProject.toLocaleLowerCase("en-US")
    || sourceProject.toLocaleLowerCase("en-US") !== ownership.sourceProject.toLocaleLowerCase("en-US")) {
    throw new Error("Observed source/target root names must match the project IDs in the ownership transaction.");
  }
  const targetRelative = path.relative(target.rootReal, target.filePath).replace(/\\/g, "/");
  const sourceRelative = path.relative(source.rootReal, source.filePath).replace(/\\/g, "/");
  if (normalizeRef(targetRelative).toLocaleLowerCase("en-US") !== normalizeRef(ownership.targetRefs[0]).toLocaleLowerCase("en-US")
    || normalizeRef(sourceRelative).toLocaleLowerCase("en-US") !== normalizeRef(ownership.sourceRefs[0]).toLocaleLowerCase("en-US")) {
    throw new Error("Resolved source/target refs do not match the exact reviewed ownership refs.");
  }
  const id = ownership.transactionId;
  if (inFlight.has(id)) throw new Error("A transaction with this ID is already running.");
  inFlight.add(id);
  try {
    const old = await readJournal(id);
    const stagePath = path.join(target.parentPath, `.${path.basename(target.filePath)}.bridge-tx-${sha256(id).slice(0, 16)}.stage`);
    const journalFile = transactionJournalPath(id);
    let journal: TransactionJournal;
    if (old) {
      assertIdentity(old, ownership, source.root, target.root, source.filePath, target.filePath, pointer.filePath, sourceHash);
      if (old.state === "committed") {
        const data = await readRegularFile(old.targetPath, MAX_TRANSFER_BYTES);
        if (sha256(data) !== old.destinationReadbackHash) throw new Error("Committed target no longer matches its transaction receipt.");
        return { executed: false, status: "idempotent-replay", transactionId: id, state: old.state, receipt: old.receiptId, sourceHash, destinationReadbackHash: old.destinationReadbackHash };
      }
      if (["verified", "pointer-updated"].includes(old.state)) {
        const data = await readRegularFile(old.targetPath, MAX_TRANSFER_BYTES);
        if (sha256(data) !== old.destinationReadbackHash) throw new Error("Previously verified target changed; recovery requires review.");
        return { executed: false, status: "idempotent-replay", transactionId: id, state: old.state, receipt: old.receiptId, sourceHash, destinationReadbackHash: old.destinationReadbackHash };
      }
      if (["aborted", "closed", "blocked"].includes(old.state)) throw new Error(`Transaction is ${old.state}; use a new transactionId.`);
      journal = old;
    } else {
      if (destinationHash === sourceHash) {
        const duplicateDecision = evaluateMssrCrossRepoAssetOwnership({ ...ownership, sourceHash, destinationState: "matching-hash", destinationHash }) as MssrCrossRepoOwnershipDecision;
        return { executed: false, status: "duplicate-existing-abstain", transactionId: ownership.transactionId, ownershipDecision: duplicateDecision, sourceHash, destinationHash, receipt: null };
      }
      if (destinationHash !== undefined) {
        const conflictDecision = evaluateMssrCrossRepoAssetOwnership({ ...ownership, sourceHash, destinationState: "conflicting-hash", destinationHash }) as MssrCrossRepoOwnershipDecision;
        return { executed: false, status: "mssr-cross-repo-write-preflight-required", transactionId: ownership.transactionId, ownershipDecision: conflictDecision, blockedReasons: ["destination-content-conflict"], sourceHash, destinationHash };
      }
      const ownershipDecision = evaluateMssrCrossRepoAssetOwnership({ ...ownership, sourceHash, destinationState: "absent" }) as MssrCrossRepoOwnershipDecision;
      if (ownershipDecision.hostWriteGate !== "host-preflight-required") {
        return { executed: false, status: "mssr-cross-repo-write-preflight-required", transactionId: ownership.transactionId, ownershipDecision, blockedReasons: [ownershipDecision.reasonCodes.join(",") || ownershipDecision.hostWriteGate] };
      }
      const createdAt = new Date().toISOString();
      const body = {
        schemaVersion: 1 as const,
        transactionId: id,
        state: "discovered" as const,
        ownership: ownership as unknown as Record<string, unknown>,
        sourceRoot: source.root,
        targetRoot: target.root,
        sourcePath: source.filePath,
        targetPath: target.filePath,
        stagePath,
        pointerPath: pointer.filePath,
        sourceHash,
        pointerBaselineHash,
        createdDestination: false,
        createdDirectories: [],
        decision: ownershipDecision as unknown as Record<string, unknown>,
        receiptId: `bridge-xrepo-${sha256(`${id}:${sourceHash}`).slice(0, 24)}`,
        createdAt,
        updatedAt: createdAt,
      };
      journal = await writeJournal(body as Omit<TransactionJournal, "integritySha256">) as TransactionJournal;
      journal = await writeJournal(updateState(journal, "owner-resolved")) as TransactionJournal;
      journal = await writeJournal(updateState(journal, "proposed")) as TransactionJournal;
    }

    const madeDirectories = await ensureDirectories(journal, target.missingParents);
    if (madeDirectories.length > 0) journal = await writeJournal({ ...journal, createdDirectories: [...new Set([...journal.createdDirectories, ...madeDirectories])] }) as TransactionJournal;
    const currentSource = await readRegularFile(journal.sourcePath, MAX_TRANSFER_BYTES);
    if (sha256(currentSource) !== journal.sourceHash) throw new Error("Source changed after transaction review; use a new transactionId and review the new hash.");
    let stagedHash: string | undefined;
    try {
      const stageBuffer = await readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES);
      stagedHash = sha256(stageBuffer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stagedHash === undefined && journal.state === "proposed") {
      const handle = await fs.open(journal.stagePath, "wx");
      try {
        await handle.writeFile(currentSource);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const staged = await readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES);
      stagedHash = sha256(staged);
    }
    if (stagedHash !== journal.sourceHash) {
      if (journal.state !== "rollback-needed") journal = await writeJournal(updateState(journal, "rollback-needed")) as TransactionJournal;
      return { executed: false, status: "recovery-required", transactionId: id, state: journal.state, blockedReasons: ["staged-hash-mismatch"], receipt: journal.receiptId };
    }
    if (journal.state === "rollback-needed") {
      journal = await writeJournal(updateState(journal, "staged", { stagedHash })) as TransactionJournal;
    } else if (journal.state === "proposed") {
      journal = await writeJournal(updateState(journal, "staged", { stagedHash })) as TransactionJournal;
    }
    if (journal.state === "staged") {
      try {
        await fs.link(journal.stagePath, journal.targetPath);
        journal = await writeJournal({ ...journal, createdDestination: true }) as TransactionJournal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const [destination, staged] = await Promise.all([
          readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES),
          readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES),
        ]);
        const [destinationStat, stagedStat] = await Promise.all([fs.stat(journal.targetPath), fs.stat(journal.stagePath)]);
        if (sha256(destination) !== journal.sourceHash || sha256(staged) !== journal.sourceHash
          || destinationStat.dev !== stagedStat.dev || destinationStat.ino !== stagedStat.ino) {
          journal = await writeJournal(updateState(journal, "rollback-needed", { stagedHash })) as TransactionJournal;
          return { executed: false, status: "recovery-required", transactionId: id, state: journal.state, blockedReasons: ["destination-appeared-without-transaction-link"], receipt: journal.receiptId };
        }
        journal = await writeJournal({ ...journal, createdDestination: true }) as TransactionJournal;
      }
      journal = await writeJournal(updateState(journal, "copied", { stagedHash })) as TransactionJournal;
    }
    if (journal.state === "copied") {
      const destination = await readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES);
      const destinationReadbackHash = sha256(destination);
      if (destinationReadbackHash !== journal.sourceHash) {
        journal = await writeJournal(updateState(journal, "rollback-needed", { stagedHash })) as TransactionJournal;
        return { executed: false, status: "recovery-required", transactionId: id, state: journal.state, blockedReasons: ["destination-readback-hash-mismatch"], receipt: journal.receiptId };
      }
      journal = await writeJournal(updateState(journal, "verified", { stagedHash, destinationReadbackHash })) as TransactionJournal;
    }
    const readback = await readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES);
    if (sha256(readback) !== journal.destinationReadbackHash) throw new Error("Target readback changed before receipt creation.");
    return {
      executed: true,
      status: "staged-and-verified-awaiting-pointer",
      transactionId: id,
      state: journal.state,
      sourceHash: journal.sourceHash,
      stagedHash: journal.stagedHash,
      destinationReadbackHash: journal.destinationReadbackHash,
      pointerRef: path.relative(journal.targetRoot, journal.pointerPath).replace(/\\/g, "/"),
      pointerBaselineHash: journal.pointerBaselineHash,
      receipt: { receiptId: journal.receiptId, state: journal.state, sourceHash: journal.sourceHash, destinationReadbackHash: journal.destinationReadbackHash },
      journalPath: journalFile,
    };
  } finally {
    inFlight.delete(id);
  }
}

async function commitTransfer(transactionId: string, confirmTransactionId: string, pointerRef: string) {
  if (confirmTransactionId !== transactionId) throw new Error("Repeat the exact transactionId in confirmTransactionId to commit the transfer.");
  const journal = await readJournal(transactionId);
  if (!journal) throw new Error("No durable transaction journal exists for this transactionId.");
  const normalizedPointer = normalizeRef(pointerRef);
  if (normalizedPointer.toLocaleLowerCase("en-US") !== path.relative(journal.targetRoot, journal.pointerPath).replace(/\\/g, "/").toLocaleLowerCase("en-US")) throw new Error("Pointer ref differs from the reviewed transaction journal.");
  if (journal.state === "committed") {
    const [targetBuffer, pointerBuffer] = await Promise.all([
      readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES),
      readRegularFile(journal.pointerPath, MAX_POINTER_BYTES),
    ]);
    if (sha256(targetBuffer) !== journal.destinationReadbackHash || sha256(pointerBuffer) !== journal.pointerReadbackHash) throw new Error("Committed transaction readback no longer matches its receipt.");
    return { executed: false, status: "idempotent-replay", transactionId, state: journal.state, receipt: journal.receiptId };
  }
  if (journal.state !== "verified" && journal.state !== "pointer-updated") throw new Error(`Transaction cannot commit from state ${journal.state}.`);
  const [sourceBuffer, destinationBuffer, pointerBuffer] = await Promise.all([
    readRegularFile(journal.sourcePath, MAX_TRANSFER_BYTES),
    readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES),
    readRegularFile(journal.pointerPath, MAX_POINTER_BYTES),
  ]);
  const sourceHash = sha256(sourceBuffer);
  const destinationHash = sha256(destinationBuffer);
  const pointerHash = sha256(pointerBuffer);
  if (sourceHash !== journal.sourceHash || destinationHash !== journal.destinationReadbackHash || destinationHash !== sourceHash) throw new Error("Source or target changed after staging; transaction remains uncommitted.");
  const pointerText = pointerBuffer.toString("utf8");
  const recoveredOwnership = mssrCrossRepoAssetOwnershipInputSchema.parse(journal.ownership);
  const targetRef = normalizeRef(recoveredOwnership.targetRefs[0]);
  if (!pointerText.includes(targetRef) || !pointerText.includes(journal.sourceHash)) throw new Error("Consumer pointer must contain the exact targetRef and verified source SHA-256.");
  if (pointerHash === journal.pointerBaselineHash) throw new Error("Consumer pointer has not changed since staging.");
  if (journal.pointerUpdateReceipt && journal.pointerReadbackHash && journal.state === "pointer-updated") {
    if (pointerHash !== journal.pointerReadbackHash) throw new Error("Consumer pointer changed after its transaction receipt was recorded.");
  }
  const receipt = `sha256:${pointerHash}:${path.relative(journal.targetRoot, journal.pointerPath).replace(/\\/g, "/")}`;
  let current = journal;
  if (current.state === "verified") current = await writeJournal(updateState(current, "pointer-updated", { pointerUpdated: true, pointerUpdateReceipt: receipt })) as TransactionJournal;
  current = await writeJournal({ ...current, pointerReadbackHash: pointerHash, pointerUpdateReceipt: receipt }) as TransactionJournal;
  current = await writeJournal(updateState(current, "committed", { pointerUpdated: true, pointerUpdateReceipt: receipt, stagedHash: current.stagedHash, destinationReadbackHash: current.destinationReadbackHash })) as TransactionJournal;
  await fs.rm(current.stagePath, { force: true });
  return { executed: true, status: "committed", transactionId, state: current.state, receipt: { receiptId: current.receiptId, pointerUpdateReceipt: receipt, sourceHash, destinationReadbackHash: destinationHash, pointerReadbackHash: pointerHash } };
}

async function rollbackTransfer(transactionId: string, confirmTransactionId: string) {
  if (confirmTransactionId !== transactionId) throw new Error("Repeat the exact transactionId in confirmTransactionId to roll back this transfer.");
  let journal = await readJournal(transactionId);
  if (!journal) throw new Error("No durable transaction journal exists for this transactionId.");
  if (["committed", "pointer-updated", "closed"].includes(journal.state)) throw new Error(`Transaction is ${journal.state}; its consumer pointer must be reviewed and reversed separately.`);
  if (journal.state === "aborted") return { executed: false, status: "idempotent-replay", transactionId, state: journal.state, receipt: journal.receiptId };
  if (journal.state !== "rollback-needed") journal = await writeJournal(updateState(journal, "rollback-needed", { stagedHash: journal.stagedHash })) as TransactionJournal;
  try {
    const destination = await readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES);
    if (!journal.createdDestination || sha256(destination) !== journal.sourceHash) throw new Error("Destination is not provably owned by this transaction; it was preserved.");
    await fs.rm(journal.targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const staged = await readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES);
    if (sha256(staged) !== journal.sourceHash) throw new Error("Stage file differs from the transaction hash; it was preserved.");
    await fs.rm(journal.stagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const directory of [...journal.createdDirectories].reverse()) await fs.rmdir(directory).catch(() => {});
  journal = await writeJournal(updateState(journal, "aborted", { stagedHash: journal.stagedHash })) as TransactionJournal;
  return { executed: true, status: "aborted", transactionId, state: journal.state, receipt: journal.receiptId };
}

async function recoverTransfer(transactionId: string, confirmTransactionId: string, disposition: "resume" | "rollback") {
  if (confirmTransactionId !== transactionId) throw new Error("Repeat the exact transactionId in confirmTransactionId to recover this transfer.");
  if (disposition === "rollback") return rollbackTransfer(transactionId, confirmTransactionId);
  let journal = await readJournal(transactionId);
  if (!journal) throw new Error("No durable transaction journal exists for this transactionId.");
  if (journal.state === "committed" || journal.state === "verified" || journal.state === "pointer-updated") {
    const destination = await readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES);
    if (sha256(destination) !== journal.destinationReadbackHash) throw new Error("Recovered destination differs from the durable readback receipt.");
    return { executed: false, status: journal.state === "committed" ? "already-committed" : "recovered-verified", transactionId, state: journal.state, receipt: journal.receiptId, destinationReadbackHash: journal.destinationReadbackHash };
  }
  if (journal.state === "aborted" || journal.state === "closed" || journal.state === "blocked") throw new Error(`Transaction cannot resume from state ${journal.state}; use a new transactionId.`);
  if (journal.state === "rollback-needed") {
    let stagedHash: string | undefined;
    try { stagedHash = sha256(await readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!stagedHash) {
      const destination = await readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES).catch(() => null);
      if (destination && journal.createdDestination && sha256(destination) === journal.sourceHash) stagedHash = journal.sourceHash;
    }
    if (stagedHash !== journal.sourceHash) throw new Error("Recovery lacks matching source/staged bytes; transaction remains rollback-needed.");
    journal = await writeJournal(updateState(journal, "staged", { stagedHash })) as TransactionJournal;
  }
  if (journal.state === "discovered") journal = await writeJournal(updateState(journal, "owner-resolved")) as TransactionJournal;
  if (journal.state === "owner-resolved") journal = await writeJournal(updateState(journal, "proposed")) as TransactionJournal;
  const targetRef = path.relative(journal.targetRoot, journal.targetPath).replace(/\\/g, "/");
  const targetInfo = await resolveProjectFile(journal.targetRoot, targetRef, "write");
  const createdDirectories = await ensureDirectories(journal, targetInfo.missingParents);
  if (createdDirectories.length > 0) journal = await writeJournal({ ...journal, createdDirectories: [...new Set([...journal.createdDirectories, ...createdDirectories])] }) as TransactionJournal;
  const sourceBuffer = await readRegularFile(journal.sourcePath, MAX_TRANSFER_BYTES);
  if (sha256(sourceBuffer) !== journal.sourceHash) throw new Error("Source changed since the transaction was journaled; transaction remains recoverable but cannot resume.");
  const stage = await readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!stage) {
    const handle = await fs.open(journal.stagePath, "wx");
    try { await handle.writeFile(sourceBuffer); await handle.sync(); } finally { await handle.close(); }
  } else if (sha256(stage) !== journal.sourceHash) {
    throw new Error("Stage file hash differs from source; transaction remains rollback-needed.");
  }
  if (journal.state === "proposed") journal = await writeJournal(updateState(journal, "staged", { stagedHash: journal.sourceHash })) as TransactionJournal;
  try {
    await fs.link(journal.stagePath, journal.targetPath);
    journal = await writeJournal({ ...journal, createdDestination: true }) as TransactionJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [destination, staged] = await Promise.all([
      readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES),
      readRegularFile(journal.stagePath, MAX_TRANSFER_BYTES),
    ]);
    const [destinationStat, stagedStat] = await Promise.all([fs.stat(journal.targetPath), fs.stat(journal.stagePath)]);
    if (sha256(destination) !== journal.sourceHash || sha256(staged) !== journal.sourceHash
      || destinationStat.dev !== stagedStat.dev || destinationStat.ino !== stagedStat.ino) {
      throw new Error("Recovery found an unowned destination conflict; preserve both paths and review the transaction.");
    }
    journal = await writeJournal({ ...journal, createdDestination: true }) as TransactionJournal;
  }
  if (journal.state === "staged") journal = await writeJournal(updateState(journal, "copied", { stagedHash: journal.sourceHash })) as TransactionJournal;
  const readbackHash = sha256(await readRegularFile(journal.targetPath, MAX_TRANSFER_BYTES));
  if (readbackHash !== journal.sourceHash) {
    if (journal.state !== "rollback-needed") journal = await writeJournal(updateState(journal, "rollback-needed", { stagedHash: journal.sourceHash })) as TransactionJournal;
    throw new Error("Recovery target readback mismatch; transaction remains rollback-needed.");
  }
  if (journal.state === "copied") journal = await writeJournal(updateState(journal, "verified", { stagedHash: journal.sourceHash, destinationReadbackHash: readbackHash })) as TransactionJournal;
  return { executed: true, status: "recovered-verified-awaiting-pointer", transactionId, state: journal.state, receipt: journal.receiptId, sourceHash: journal.sourceHash, destinationReadbackHash: journal.destinationReadbackHash };
}

export const crossRepoTransactionToolModule: BridgeToolModule = {
  name: "cross-repo-transactions",
  tools: [{
    name: "bridge_cross_repo_transaction",
    description: "Run a bounded one-file cross-repository copy with host-observed trace/root checks, MSSR ownership preflight, durable journal, staged SHA-256 readback, idempotent replay, pointer receipt, and conservative recovery/rollback. MSSR remains advisory; this host tool owns filesystem I/O.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["stage", "commit", "recover", "rollback"] },
        ownership: { type: "object", description: "MSSR CrossRepoOwnershipTransaction v1 input. For stage, declare exactly one sourceRef and targetRef, current/related owner traces, owner claim, operation=copy or export, explicitCopyReview=true, and expectedOwnerProject." },
        sourceRoot: { type: "string", description: "Must exactly match the project root observed for the source trace." },
        targetRoot: { type: "string", description: "Must exactly match the project root observed for the active target trace." },
        pointerRef: { type: "string", description: "Target project relative consumer pointer file that will be updated after the verified copy." },
        transactionId: { type: "string", maxLength: 160 },
        confirmTransactionId: { type: "string", maxLength: 160, description: "Repeat the exact transactionId to confirm the requested state change." },
        disposition: { type: "string", enum: ["resume", "rollback"] },
      },
      required: ["action", "confirmTransactionId"],
      additionalProperties: false,
    },
  }],
  handlers: {
    bridge_cross_repo_transaction: async (args) => {
      const parsed = actionSchema.parse(args);
      if (parsed.action === "stage") return stageCopy(parsed as StageAction);
      if (parsed.action === "commit") return commitTransfer(parsed.transactionId, parsed.confirmTransactionId, parsed.pointerRef);
      if (parsed.action === "rollback") return rollbackTransfer(parsed.transactionId, parsed.confirmTransactionId);
      return recoverTransfer(parsed.transactionId, parsed.confirmTransactionId, parsed.disposition);
    },
  },
};
