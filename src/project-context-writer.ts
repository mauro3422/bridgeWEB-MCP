import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MSSR_PROJECT_AUTHORITY_FILES,
  MSSR_PROJECT_CONTROL_FILES,
  mssrProjectRelativePath,
  planMssrProjectKnowledgeCapture,
  projectContextManifestSchema,
  projectContextModuleSchema,
  resolveMssrProjectFile,
  resolveMssrProjectWritePath,
  upsertMarkdownSection,
  upsertProjectContextManifestModule,
  type MssrProjectKnowledgeCaptureInput,
  type ProjectContextTopic,
  type ProjectKnowledgeKind,
} from "@mauroprime/mssr";
import { assertPathAllowed } from "./tools/shared/path.js";

const KIND_FILE: Record<ProjectKnowledgeKind, string> = {
  context: MSSR_PROJECT_AUTHORITY_FILES.context,
  memory: MSSR_PROJECT_AUTHORITY_FILES.memory,
  state: MSSR_PROJECT_AUTHORITY_FILES.state,
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

async function requireInitializedManifest(projectRoot: string): Promise<{ path: string; text: string; parsed: ReturnType<typeof projectContextManifestSchema.parse> }> {
  const resolution = await resolveMssrProjectFile(projectRoot, MSSR_PROJECT_CONTROL_FILES.projectContextManifest);
  if (resolution.source !== "canonical") {
    throw new Error("MSSR project context is not initialized. Run project_context_initialize before writing durable project knowledge; Bridge will not create an ad-hoc contract or read .bridge fallback state.");
  }
  const text = await fs.readFile(resolution.absolutePath, "utf8");
  try {
    return { path: resolution.absolutePath, text, parsed: projectContextManifestSchema.parse(JSON.parse(text)) };
  } catch (error) {
    throw new Error(`MSSR project-context manifest is invalid. Repair/re-initialize it before writing project knowledge: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type ProjectContextModuleRegistration = {
  id: string;
  kind: "context" | "memory" | "state" | "directive";
  topic?: ProjectContextTopic;
  area?: string;
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
  const initialized = await requireInitializedManifest(projectRoot);
  const targetPath = resolveMssrProjectWritePath(projectRoot, KIND_FILE[args.kind]);
  const manifestPath = initialized.path;
  assertPathAllowed(targetPath, "write");
  assertPathAllowed(manifestPath, "write");

  const targetExisted = await pathExists(targetPath);
  const beforeText = targetExisted ? await fs.readFile(targetPath, "utf8") : "";
  const beforeSha256 = sha256(beforeText);
  if (args.expectedSha256 && args.expectedSha256.toLowerCase() !== beforeSha256) {
    throw new Error(`Project ${args.kind} changed concurrently: expected sha256 ${args.expectedSha256.toLowerCase()}, current ${beforeSha256}. Reload project context and retry.`);
  }

  const sectionUpdate = upsertMarkdownSection(beforeText, args.heading, args.content);
  const afterText = sectionUpdate.text;
  const afterSha256 = sha256(afterText);

  let afterManifestText: string | null = null;
  let manifestUpdate: { created: boolean; replaced: boolean } | null = null;
  let registeredModule: unknown = null;
  if (args.module) {
    const sourcePath = mssrProjectRelativePath(KIND_FILE[args.kind]);
    const module = projectContextModuleSchema.parse({
      ...args.module,
      source: { path: sourcePath, sections: [args.heading.trim()] },
    });
    const updated = upsertProjectContextManifestModule({ manifest: initialized.parsed, module });
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
      if (targetExisted) await atomicWrite(targetPath, beforeText).catch(() => undefined);
      else await fs.rm(targetPath, { force: true }).catch(() => undefined);
    }
    if (afterManifestText !== null) await atomicWrite(manifestPath, initialized.text).catch(() => undefined);
    throw error;
  }

  const verifiedText = await fs.readFile(targetPath, "utf8");
  if (sha256(verifiedText) !== afterSha256) throw new Error(`Project ${args.kind} postflight hash mismatch after write: ${targetPath}`);
  let manifestSha256: string | null = null;
  if (afterManifestText !== null) {
    const verifiedManifestText = await fs.readFile(manifestPath, "utf8");
    projectContextManifestSchema.parse(JSON.parse(verifiedManifestText));
    manifestSha256 = sha256(verifiedManifestText);
    if (manifestSha256 !== sha256(afterManifestText)) throw new Error(`Project context manifest postflight hash mismatch after write: ${manifestPath}`);
  }

  return {
    updated: true,
    projectRoot,
    projectHome: ".mssr",
    initializedContractRequired: true,
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
      : "The section is persisted in an initialized authority but is not automatically indexed as a modular project-context entry.",
  };
}

export async function captureProjectKnowledge(args: {
  projectRoot: string;
  capture: MssrProjectKnowledgeCaptureInput;
  expectedTargetSha256?: string;
  expectedManifestSha256?: string;
}): Promise<Record<string, unknown>> {
  const projectRoot = path.resolve(args.projectRoot);
  assertPathAllowed(projectRoot, "write");
  const initialized = await requireInitializedManifest(projectRoot);
  const beforeManifestSha = sha256(initialized.text);
  if (args.expectedManifestSha256 && args.expectedManifestSha256.toLowerCase() !== beforeManifestSha) {
    throw new Error(`Project context manifest changed concurrently: expected ${args.expectedManifestSha256.toLowerCase()}, current ${beforeManifestSha}. Reload project context and retry.`);
  }

  const plan = planMssrProjectKnowledgeCapture(args.capture);
  const targetPath = path.resolve(projectRoot, plan.relativePath);
  assertPathAllowed(targetPath, "write");
  const targetRelative = path.relative(projectRoot, targetPath).replace(/\\/g, "/");
  if (!targetRelative.startsWith(".mssr/knowledge/")) throw new Error(`Refusing project knowledge capture outside .mssr/knowledge/: ${targetRelative}`);

  const targetExisted = await pathExists(targetPath);
  const beforeTargetText = targetExisted ? await fs.readFile(targetPath, "utf8") : null;
  const beforeTargetSha = beforeTargetText === null ? null : sha256(beforeTargetText);
  if (targetExisted && !args.expectedTargetSha256) {
    throw new Error(`Knowledge target already exists: ${targetRelative}. Read it first and pass expectedTargetSha256 for an explicit reviewed update.`);
  }
  if (args.expectedTargetSha256 && args.expectedTargetSha256.toLowerCase() !== (beforeTargetSha ?? sha256(""))) {
    throw new Error(`Project knowledge target changed concurrently: expected ${args.expectedTargetSha256.toLowerCase()}, current ${beforeTargetSha ?? "missing"}.`);
  }

  const existingModule = initialized.parsed.modules.find((entry) => entry.id === plan.module.id);
  if (existingModule && existingModule.source.path.replace(/\\/g, "/") !== plan.relativePath) {
    throw new Error(`Project knowledge module id '${plan.module.id}' already points to ${existingModule.source.path}; refusing to retarget it silently.`);
  }
  const updatedManifest = upsertProjectContextManifestModule({ manifest: initialized.parsed, module: plan.module });
  const afterManifestText = `${JSON.stringify(projectContextManifestSchema.parse(updatedManifest.manifest), null, 2)}\n`;
  const afterTargetSha = sha256(plan.markdown);
  const afterManifestSha = sha256(afterManifestText);

  let targetWritten = false;
  try {
    await atomicWrite(targetPath, plan.markdown);
    targetWritten = true;
    await atomicWrite(initialized.path, afterManifestText);
  } catch (error) {
    if (targetWritten) {
      if (beforeTargetText !== null) await atomicWrite(targetPath, beforeTargetText).catch(() => undefined);
      else await fs.rm(targetPath, { force: true }).catch(() => undefined);
    }
    await atomicWrite(initialized.path, initialized.text).catch(() => undefined);
    throw error;
  }

  const verifiedTarget = await fs.readFile(targetPath, "utf8");
  const verifiedManifest = await fs.readFile(initialized.path, "utf8");
  projectContextManifestSchema.parse(JSON.parse(verifiedManifest));
  if (sha256(verifiedTarget) !== afterTargetSha) throw new Error(`Project knowledge capture hash mismatch: ${targetPath}`);
  if (sha256(verifiedManifest) !== afterManifestSha) throw new Error(`Project knowledge manifest hash mismatch after capture: ${initialized.path}`);

  return {
    captured: true,
    projectRoot,
    relativePath: plan.relativePath,
    targetPath,
    target: {
      created: !targetExisted,
      replaced: targetExisted,
      beforeSha256: beforeTargetSha,
      afterSha256: afterTargetSha,
    },
    manifest: {
      path: initialized.path,
      created: updatedManifest.created,
      replaced: updatedManifest.replaced,
      beforeSha256: beforeManifestSha,
      afterSha256: afterManifestSha,
      module: plan.module,
    },
    policy: plan.policy,
    activation: "Captured knowledge is durable but selected only when its registered selectors match. The capture action does not make it a global instruction or a new skill.",
  };
}
