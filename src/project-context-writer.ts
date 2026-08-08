import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  projectContextManifestSchema,
  projectContextModuleSchema,
  upsertMarkdownSection,
  upsertProjectContextManifestModule,
  type ProjectKnowledgeKind,
} from "@mauroprime/mssr";
import { assertPathAllowed } from "./tools/shared/path.js";

const KIND_FILE: Record<ProjectKnowledgeKind, string> = {
  context: "PROJECT_CONTEXT.md",
  memory: "PROJECT_MEMORY.md",
  state: "PROJECT_STATE.md",
};

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(5).toString("hex")}`;
  await fs.writeFile(temp, text, "utf8");
  try {
    await fs.rename(temp, filePath);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export type ProjectContextModuleRegistration = {
  id: string;
  kind: "context" | "memory" | "state" | "directive";
  description: string;
  stages?: string[];
  domains?: string[];
  actions?: string[];
  artifacts?: string[];
  needs?: string[];
  signals?: string[];
  required?: boolean;
  priority?: number;
  maxChars?: number;
  exclusiveGroup?: string;
};

export async function updateProjectContextSection(args: {
  projectRoot: string;
  kind: ProjectKnowledgeKind;
  heading: string;
  content: string;
  expectedSha256?: string;
  module?: ProjectContextModuleRegistration;
}): Promise<Record<string, unknown>> {
  const projectRoot = path.resolve(args.projectRoot);
  assertPathAllowed(projectRoot, "write");
  const bridgeDir = path.join(projectRoot, ".bridge");
  const targetPath = path.join(bridgeDir, KIND_FILE[args.kind]);
  const manifestPath = path.join(bridgeDir, "project-context.json");
  assertPathAllowed(targetPath, "write");
  assertPathAllowed(manifestPath, "write");

  const beforeText = await pathExists(targetPath) ? await fs.readFile(targetPath, "utf8") : "";
  const beforeSha256 = sha256(beforeText);
  if (args.expectedSha256 && args.expectedSha256.toLowerCase() !== beforeSha256) {
    throw new Error(`Project ${args.kind} changed concurrently: expected sha256 ${args.expectedSha256.toLowerCase()}, current ${beforeSha256}. Reload project context and retry.`);
  }

  const sectionUpdate = upsertMarkdownSection(beforeText, args.heading, args.content);
  const afterText = sectionUpdate.text;
  const afterSha256 = sha256(afterText);

  let beforeManifestText: string | null = null;
  let afterManifestText: string | null = null;
  let manifestUpdate: { created: boolean; replaced: boolean } | null = null;
  let registeredModule: unknown = null;

  if (args.module) {
    beforeManifestText = await pathExists(manifestPath) ? await fs.readFile(manifestPath, "utf8") : null;
    const rawManifest = beforeManifestText ? JSON.parse(beforeManifestText) : undefined;
    const sourcePath = `.bridge/${KIND_FILE[args.kind]}`;
    const module = projectContextModuleSchema.parse({
      ...args.module,
      source: { path: sourcePath, sections: [args.heading.trim()] },
    });
    const updated = upsertProjectContextManifestModule({ manifest: rawManifest, module });
    registeredModule = module;
    manifestUpdate = { created: updated.created, replaced: updated.replaced };
    afterManifestText = `${JSON.stringify(projectContextManifestSchema.parse(updated.manifest), null, 2)}\n`;
  }

  let sectionWritten = false;
  try {
    await atomicWrite(targetPath, afterText);
    sectionWritten = true;
    if (afterManifestText !== null) await atomicWrite(manifestPath, afterManifestText);
  } catch (error) {
    if (sectionWritten) {
      if (beforeText) await atomicWrite(targetPath, beforeText).catch(() => undefined);
      else await fs.rm(targetPath, { force: true }).catch(() => undefined);
    }
    if (afterManifestText !== null) {
      if (beforeManifestText !== null) await atomicWrite(manifestPath, beforeManifestText).catch(() => undefined);
      else await fs.rm(manifestPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }

  const verifiedText = await fs.readFile(targetPath, "utf8");
  if (sha256(verifiedText) !== afterSha256) {
    throw new Error(`Project ${args.kind} postflight hash mismatch after write: ${targetPath}`);
  }
  let manifestSha256: string | null = null;
  if (afterManifestText !== null) {
    const verifiedManifestText = await fs.readFile(manifestPath, "utf8");
    projectContextManifestSchema.parse(JSON.parse(verifiedManifestText));
    manifestSha256 = sha256(verifiedManifestText);
    if (manifestSha256 !== sha256(afterManifestText)) {
      throw new Error(`Project context manifest postflight hash mismatch after write: ${manifestPath}`);
    }
  }

  return {
    updated: true,
    projectRoot,
    kind: args.kind,
    targetPath,
    heading: args.heading.trim(),
    section: {
      created: sectionUpdate.created,
      replaced: sectionUpdate.replaced,
      beforeSha256,
      afterSha256,
      chars: verifiedText.length,
    },
    manifest: afterManifestText === null ? null : {
      path: manifestPath,
      ...manifestUpdate,
      sha256: manifestSha256,
      module: registeredModule,
    },
    activation: args.module
      ? "The section is persisted and indexed. It becomes active only when project_context_load/skill_bootstrap selects the registered module for a matching stage and structured intent."
      : "The section is persisted but is not automatically indexed as a modular project-context entry.",
  };
}
