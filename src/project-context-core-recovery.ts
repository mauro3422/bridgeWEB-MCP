import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadProjectContextModuleManifest,
  extractProjectContextSections,
  preflightMssrProjectContextWrite,
  upsertMarkdownSection,
} from "@mauroprime/mssr";
import { assertPathAllowed } from "./tools/shared/path.js";

const SHA256 = /^[0-9a-f]{64}$/i;
const ALLOWED_AUTHORITIES = new Set([
  ".mssr/PROJECT_CONTEXT.md",
  ".mssr/PROJECT_MEMORY.md",
  ".mssr/PROJECT_STATE.md",
]);
const sha256 = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Narrow last-resort recovery for an *already over-budget* indexed MSSR core.
 * Deliberately does not require route context (which may be impossible to load).
 * Host callers must enforce normal filesystem authorization independently.
 */
export async function recoverOversizedProjectContextCore(input: {
  projectRoot: string;
  heading: string;
  content: string;
  expectedSha256: string;
}): Promise<Record<string, unknown>> {
  const projectRoot = path.resolve(input.projectRoot);
  assertPathAllowed(projectRoot, "write");
  if (!SHA256.test(input.expectedSha256)) throw new Error("Expected 64-character SHA-256 is mandatory.");
  if (!/^#{1,6}\s+\S/.test(input.heading) || input.heading.length > 160) throw new Error("Invalid core heading.");
  if (input.content.length > 20_000) throw new Error("Repair content is too large.");

  const found = await loadProjectContextModuleManifest(projectRoot);
  if (!found.found) throw new Error("A valid canonical MSSR manifest is required for core recovery.");
  const candidates = found.manifest.core.filter((entry) => {
    const source = entry.source.path.replace(/\\/g, "/");
    return ALLOWED_AUTHORITIES.has(source)
      && entry.source.sections?.length === 1
      && entry.source.sections[0] === input.heading;
  });
  if (candidates.length !== 1) throw new Error("Repair must target one exact indexed core section.");
  const core = candidates[0]!;
  if (typeof core.maxChars !== "number") throw new Error("Emergency recovery requires an explicit indexed core byte budget.");
  const budget = core.maxChars;
  const rel = core.source.path.replace(/\\/g, "/");
  const target = path.resolve(projectRoot, ...rel.split("/"));
  if (!ALLOWED_AUTHORITIES.has(rel) || !target.startsWith(projectRoot + path.sep)) {
    throw new Error("Unsafe core source path.");
  }
  assertPathAllowed(target, "write");
  const existing = await fs.readFile(target, "utf8");
  const beforeHash = sha256(existing);
  if (beforeHash !== input.expectedSha256.toLowerCase()) throw new Error("Concurrent core change: expectedSha256 does not match.");

  const beforeSelected = extractProjectContextSections(existing, [input.heading]);
  const beforeBytes = Buffer.byteLength(beforeSelected, "utf8");
  if (beforeBytes <= budget) throw new Error("Recovery is permitted only when the selected core already exceeds its indexed budget.");

  const proposed = upsertMarkdownSection(existing, input.heading, input.content);
  if (proposed.created) throw new Error("Core section must already exist; recovery cannot create authorities.");
  const forecast = await preflightMssrProjectContextWrite({ projectRoot, targetPath: target, nextText: proposed.text });
  const nextEntry = forecast.affectedEntries.find((entry) => entry.entryId === core.id);
  if (!forecast.contractValid || !nextEntry || nextEntry.selectedBytes >= beforeBytes || nextEntry.selectedBytes > budget) {
    throw new Error("Recovery must shrink the selected core below its declared budget without regressing any other entry.");
  }

  // Resolve the exact core source again immediately before replacement.
  if (sha256(await fs.readFile(target, "utf8")) !== beforeHash) throw new Error("Concurrent core edit detected before write.");
  const afterHash = sha256(proposed.text);
  const tempPath = target + ".recovery-" + crypto.randomBytes(8).toString("hex") + ".tmp";
  try {
    await fs.writeFile(tempPath, proposed.text, { encoding: "utf8", flag: "wx" });
    if (sha256(await fs.readFile(target, "utf8")) !== beforeHash) throw new Error("Concurrent core edit detected at commit.");
    await fs.rename(tempPath, target);
    const readback = await fs.readFile(target, "utf8");
    if (sha256(readback) !== afterHash) throw new Error("Core recovery write verification failed.");
    const afterBytes = Buffer.byteLength(extractProjectContextSections(readback, [input.heading]), "utf8");
    if (afterBytes > budget) throw new Error("Core remains over budget after write.");
    return {
      recovered: true,
      projectRoot,
      sourcePath: rel,
      entryId: core.id,
      heading: input.heading,
      beforeBytes,
      afterBytes,
      budgetBytes: budget,
      beforeSha256: beforeHash,
      afterSha256: afterHash,
      scope: "single-existing-overbudget-core-section",
      manifestUnchanged: true,
      lifecycle: "recovery-only-no-normal-route-bypass",
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
