import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_MEMORY_REF = ".mssr/PROJECT_MEMORY.md";
const MANIFEST_REF = ".mssr/project-context.json";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeRef(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function headingLevel(line) {
  const match = /^(#{1,6})\s+\S/.exec(line.trim());
  return match ? match[1].length : null;
}

function exactSectionRange(markdown, heading) {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const matches = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((item) => item.line === heading.trim());
  if (matches.length !== 1) throw new Error(`Expected exactly one heading '${heading}', found ${matches.length}.`);
  const start = matches[0].index;
  const level = headingLevel(lines[start]);
  if (!level) throw new Error(`Not a Markdown heading: ${heading}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextLevel = headingLevel(lines[index]);
    if (nextLevel !== null && nextLevel <= level) {
      end = index;
      break;
    }
  }
  return { start, end, lines, newline };
}

function removeExactSections(markdown, headings) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const ranges = headings.map((heading) => {
    const { start, end } = exactSectionRange(normalized, heading);
    return { heading, start, end };
  }).sort((a, b) => b.start - a.start);
  const lines = normalized.split("\n");
  for (const range of ranges) lines.splice(range.start, range.end - range.start);
  return lines.join(newline);
}

async function writeAtomic(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, filePath);
  const readback = await fs.readFile(filePath, "utf8");
  if (readback !== content) throw new Error(`Atomic write readback mismatch: ${filePath}`);
}

function withoutSource(module) {
  const { source: _source, ...rest } = module;
  return rest;
}

function safeCandidates(plan, manifest) {
  const modules = new Map(manifest.modules.map((module) => [module.id, module]));
  const seenPaths = new Set();
  const out = [];
  for (const candidate of plan.candidates ?? []) {
    if (candidate.core) continue;
    if (candidate.preserveKind !== "memory" || candidate.preserveModuleId !== true) continue;
    if (normalizeRef(candidate.sourcePath).toLowerCase() !== ROOT_MEMORY_REF.toLowerCase()) continue;
    const module = modules.get(candidate.entryId);
    if (!module || module.kind !== "memory") throw new Error(`Candidate ${candidate.entryId} no longer maps to one memory module.`);
    const sourcePath = normalizeRef(module.source?.path);
    const sections = module.source?.sections ?? [];
    if (sourcePath.toLowerCase() !== ROOT_MEMORY_REF.toLowerCase()) continue;
    if (sections.length !== 1 || sections[0] !== candidate.heading) {
      throw new Error(`Candidate ${candidate.entryId} is not an exact single-section memory anymore.`);
    }
    if (candidate.suggestedModuleId !== candidate.entryId || candidate.requiresCoreDecision) {
      throw new Error(`Candidate ${candidate.entryId} is not safe for automatic ID-preserving migration.`);
    }
    const target = normalizeRef(candidate.suggestedPath);
    if (!target.startsWith(".mssr/knowledge/") || !target.endsWith(".md")) {
      throw new Error(`Unsafe suggested target for ${candidate.entryId}: ${target}`);
    }
    const targetKey = target.toLowerCase();
    if (seenPaths.has(targetKey)) throw new Error(`Duplicate migration target: ${target}`);
    seenPaths.add(targetKey);
    out.push({ candidate, module, target });
  }
  return out;
}

export async function migrateProjectMemoryRefs({
  projectRoot: projectRootInput,
  mssr,
  apply = false,
  expectedIds = null,
} = {}) {
  if (!mssr?.planMssrProjectContextModularization || !mssr?.extractProjectContextSections || !mssr?.auditMssrProjectContextHealth) {
    throw new Error("MSSR module must expose planMssrProjectContextModularization, extractProjectContextSections, and auditMssrProjectContextHealth.");
  }
  const projectRoot = path.resolve(projectRootInput ?? process.cwd());
  if (apply && expectedIds === null) {
    throw new Error("Apply requires an explicit expectedIds set. Run check first, then pass --expect with the reviewed candidate ids.");
  }
  const manifestPath = path.join(projectRoot, ...MANIFEST_REF.split("/"));
  const memoryPath = path.join(projectRoot, ...ROOT_MEMORY_REF.split("/"));
  const [manifestBeforeText, memoryBefore] = await Promise.all([
    fs.readFile(manifestPath, "utf8"),
    fs.readFile(memoryPath, "utf8"),
  ]);
  const manifestBeforeSha = sha256(manifestBeforeText);
  const memoryBeforeSha = sha256(memoryBefore);
  const manifest = JSON.parse(manifestBeforeText);
  if (!Array.isArray(manifest.modules)) throw new Error("Invalid project-context manifest: modules is not an array.");

  const plan = await mssr.planMssrProjectContextModularization(projectRoot);
  const candidates = safeCandidates(plan, manifest);
  const ids = candidates.map((item) => item.candidate.entryId).sort();
  if (expectedIds) {
    const expected = [...expectedIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error(`Safe candidate set changed. Expected ${expected.join(", ")}; got ${ids.join(", ")}.`);
    }
  }

  const [manifestStableText, memoryStable] = await Promise.all([
    fs.readFile(manifestPath, "utf8"),
    fs.readFile(memoryPath, "utf8"),
  ]);
  if (sha256(manifestStableText) !== manifestBeforeSha || sha256(memoryStable) !== memoryBeforeSha) {
    throw new Error("Project memory or manifest changed while planning; aborting before mutation.");
  }

  const beforePayload = new Map();
  const nextManifest = structuredClone(manifest);
  const nextById = new Map(nextManifest.modules.map((module) => [module.id, module]));
  for (const { candidate, module, target } of candidates) {
    const selected = mssr.extractProjectContextSections(memoryBefore, [candidate.heading]);
    const selectedSha = sha256(selected);
    if (selectedSha !== candidate.sha256) {
      throw new Error(`Planner payload hash changed for ${candidate.entryId}: expected ${candidate.sha256}, got ${selectedSha}.`);
    }
    beforePayload.set(candidate.entryId, { content: selected, sha256: selectedSha, bytes: Buffer.byteLength(selected, "utf8") });
    const targetPath = path.resolve(projectRoot, target);
    const rel = path.relative(projectRoot, targetPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Migration target escapes project root: ${target}`);
    try {
      const existing = await fs.readFile(targetPath, "utf8");
      if (sha256(existing.trim()) !== selectedSha) throw new Error(`Existing target differs from source payload: ${target}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const next = nextById.get(candidate.entryId);
    if (!next) throw new Error(`Missing manifest module during plan: ${candidate.entryId}`);
    if (JSON.stringify(withoutSource(next)) !== JSON.stringify(withoutSource(module))) {
      throw new Error(`Selectors/metadata changed before migration for ${candidate.entryId}.`);
    }
    next.source = { path: target };
  }

  const nextMemory = removeExactSections(memoryBefore, candidates.map((item) => item.candidate.heading));
  const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  const report = {
    projectRoot,
    mode: apply ? "apply" : "check",
    safeCandidateCount: candidates.length,
    ids,
    before: {
      memoryBytes: Buffer.byteLength(memoryBefore, "utf8"),
      memorySha256: memoryBeforeSha,
      manifestSha256: manifestBeforeSha,
      healthLevel: plan.health?.level ?? null,
      findingCodes: (plan.health?.findings ?? []).map((item) => item.code),
    },
    projected: {
      memoryBytes: Buffer.byteLength(nextMemory, "utf8"),
      removedBytes: Buffer.byteLength(memoryBefore, "utf8") - Buffer.byteLength(nextMemory, "utf8"),
      targets: candidates.map(({ candidate, target }) => ({ id: candidate.entryId, heading: candidate.heading, path: target, bytes: candidate.chars, sha256: candidate.sha256 })),
    },
    applied: false,
    postflight: null,
  };

  if (!apply || candidates.length === 0) return report;

  // Safe partial-failure order: refs first, manifest second, root cleanup last. A crash can
  // temporarily leave duplicate content, but never a manifest pointing at missing content.
  for (const { candidate, target } of candidates) {
    const payload = beforePayload.get(candidate.entryId);
    await writeAtomic(path.resolve(projectRoot, target), `${payload.content}\n`);
  }
  await writeAtomic(manifestPath, nextManifestText);
  await writeAtomic(memoryPath, nextMemory);

  const [manifestAfterText, memoryAfter] = await Promise.all([
    fs.readFile(manifestPath, "utf8"),
    fs.readFile(memoryPath, "utf8"),
  ]);
  const manifestAfter = JSON.parse(manifestAfterText);
  const afterById = new Map(manifestAfter.modules.map((module) => [module.id, module]));
  for (const { candidate, module, target } of candidates) {
    const after = afterById.get(candidate.entryId);
    if (!after) throw new Error(`Postflight missing module ${candidate.entryId}.`);
    if (normalizeRef(after.source?.path) !== target || after.source?.sections !== undefined) {
      throw new Error(`Postflight source mismatch for ${candidate.entryId}.`);
    }
    if (JSON.stringify(withoutSource(after)) !== JSON.stringify(withoutSource(module))) {
      throw new Error(`Postflight selector/metadata drift for ${candidate.entryId}.`);
    }
    const targetText = await fs.readFile(path.resolve(projectRoot, target), "utf8");
    if (sha256(targetText.trim()) !== beforePayload.get(candidate.entryId).sha256) {
      throw new Error(`Postflight payload mismatch for ${candidate.entryId}.`);
    }
    if (memoryAfter.includes(candidate.heading)) throw new Error(`Postflight root still contains migrated heading ${candidate.heading}.`);
  }
  const healthAfter = await mssr.auditMssrProjectContextHealth(projectRoot);
  const fanoutRemaining = (healthAfter.findings ?? []).some((item) => item.code === "root-backed-memory-fanout");
  if (fanoutRemaining) throw new Error("Postflight health still reports root-backed-memory-fanout.");

  report.applied = true;
  report.postflight = {
    memoryBytes: Buffer.byteLength(memoryAfter, "utf8"),
    memorySha256: sha256(memoryAfter),
    manifestSha256: sha256(manifestAfterText),
    healthLevel: healthAfter.level,
    findingCodes: (healthAfter.findings ?? []).map((item) => item.code),
    rootBackedMemoryFanout: false,
    payloadParity: true,
    selectorMetadataParity: true,
  };
  return report;
}

async function importMssr(entry) {
  if (entry) return await import(pathToFileURL(path.resolve(entry)).href);
  return await import("@mauroprime/mssr");
}

function parseArgs(argv) {
  const result = { projectRoot: process.cwd(), apply: false, mssrEntry: null, expectedIds: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") result.apply = true;
    else if (arg === "--check") result.apply = false;
    else if (arg === "--project-root") result.projectRoot = argv[++index];
    else if (arg === "--mssr-entry") result.mssrEntry = argv[++index];
    else if (arg === "--expect") result.expectedIds = String(argv[++index] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function isDirectRun() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const mssr = await importMssr(args.mssrEntry);
    const report = await migrateProjectMemoryRefs({ ...args, mssr });
    process.stdout.write(`${JSON.stringify({ ok: true, ...report }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`project-memory-ref migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
