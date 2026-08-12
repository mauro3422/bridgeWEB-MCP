import fs from "node:fs/promises";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { DEFAULT_EDIT_FILE_MAX_BYTES, readTextSnapshot, sha256Text, writeTextAndVerify, type TextFileSnapshot } from "./shared/text-files.js";
import { applyLineEdit } from "./shared/line-edits.js";

type NearbyLine = { line: number; text: string };

type EditFailureDiagnostic = {
  path: string;
  currentSha256: string;
  currentBytes: number;
  currentLineCount: number;
  validLineRange: { start: number; end: number };
  requestedRange?: { start: number; end: number };
  nearbyContext: NearbyLine[];
  candidateHints: Array<{ line: number; context: NearbyLine[] }>;
  recommendedNextAction: string;
  fuzzyMutationApplied: false;
};

function lineContext(lines: string[], center: number, radius = 2): NearbyLine[] {
  if (lines.length === 0) return [];
  const clamped = Math.min(Math.max(center, 1), lines.length);
  const start = Math.max(1, clamped - radius);
  const end = Math.min(lines.length, clamped + radius);
  return lines.slice(start - 1, end).map((text, index) => ({ line: start + index, text: text.slice(0, 500) }));
}

function buildDiagnostic(snapshot: TextFileSnapshot, options: {
  requestedStart?: number;
  requestedEnd?: number;
  oldText?: string;
} = {}): EditFailureDiagnostic {
  const lines = snapshot.text.split(/\r?\n/);
  const lineCount = snapshot.totalLines;
  const requestedStart = options.requestedStart;
  const requestedEnd = options.requestedEnd ?? requestedStart;
  const center = requestedStart ?? 1;
  const needle = options.oldText
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4)
    ?.slice(0, 160);
  const candidates = needle
    ? lines.flatMap((line, index) => line.includes(needle) ? [index + 1] : []).slice(0, 5)
    : [];
  return {
    path: snapshot.path,
    currentSha256: snapshot.sha256,
    currentBytes: snapshot.bytes,
    currentLineCount: lineCount,
    validLineRange: { start: 1, end: Math.max(1, lineCount) },
    ...(requestedStart !== undefined ? { requestedRange: { start: requestedStart, end: requestedEnd ?? requestedStart } } : {}),
    nearbyContext: lineContext(lines, center),
    candidateHints: candidates.map((line) => ({ line, context: lineContext(lines, line) })),
    recommendedNextAction: candidates.length > 0
      ? "Read the reported candidate range and retry with exact current text or exact current line numbers."
      : "Read the current file or the reported nearby range, then rebuild the patch from current content.",
    fuzzyMutationApplied: false,
  };
}

function diagnosticError(category: "patch-conflict" | "stale-file-state", message: string, diagnostic: EditFailureDiagnostic): Error {
  return new Error(`[${category}] ${message} Diagnostic: ${JSON.stringify(diagnostic)}`);
}

async function exactStringPatch(filePath: string, oldText: string, newText: string, expectedReplacements: number) {
  if (!oldText) throw new Error("oldText must not be empty.");
  const before = await readTextSnapshot(filePath, DEFAULT_EDIT_FILE_MAX_BYTES);
  const count = before.text.split(oldText).length - 1;
  if (count !== expectedReplacements) {
    throw diagnosticError(
      "patch-conflict",
      `Expected ${expectedReplacements} replacement(s), found ${count}.`,
      buildDiagnostic(before, { oldText }),
    );
  }
  const updated = before.text.split(oldText).join(newText);
  await fs.writeFile(before.path, updated, "utf8");
  const after = await readTextSnapshot(before.path, DEFAULT_EDIT_FILE_MAX_BYTES);
  const remainingOldTextCount = after.text.split(oldText).length - 1;
  return {
    path: before.path,
    replacements: count,
    before: { bytes: before.bytes, sha256: before.sha256, totalLines: before.totalLines, lineEnding: before.lineEnding },
    after: { bytes: after.bytes, sha256: after.sha256, totalLines: after.totalLines, lineEnding: after.lineEnding },
    changed: before.sha256 !== after.sha256,
    postflight: {
      remainingOldTextCount,
      expectedNewSha256: sha256Text(updated),
      verified: after.sha256 === sha256Text(updated),
    },
  };
}

async function editLines(filePath: string, startLine: number, endLine: number | undefined, newContent: string | undefined, mode: "replace" | "insert_before" | "insert_after" | "delete" | undefined, previewContext: number) {
  const before = await readTextSnapshot(filePath, DEFAULT_EDIT_FILE_MAX_BYTES);
  let edit: ReturnType<typeof applyLineEdit>;
  try {
    edit = applyLineEdit({ snapshot: before, startLine, endLine, newContent, mode, previewContext });
  } catch (error) {
    throw diagnosticError(
      "stale-file-state",
      error instanceof Error ? error.message : String(error),
      buildDiagnostic(before, { requestedStart: startLine, requestedEnd: endLine }),
    );
  }
  await fs.writeFile(before.path, edit.updatedText, "utf8");
  const after = await readTextSnapshot(before.path, DEFAULT_EDIT_FILE_MAX_BYTES);
  const expectedSha256 = sha256Text(edit.updatedText);
  return {
    path: before.path,
    before: { bytes: before.bytes, sha256: before.sha256, totalLines: before.totalLines, lineEnding: before.lineEnding },
    after: { bytes: after.bytes, sha256: after.sha256, totalLines: after.totalLines, lineEnding: after.lineEnding },
    changed: before.sha256 !== after.sha256,
    edit: edit.summary,
    postflight: { expectedSha256, verified: after.sha256 === expectedSha256 },
  };
}

export const fileWritingToolModule: BridgeToolModule = {
  name: "file-writing",
  tools: [
    {
      name: "write_text_file",
      description: "Write or append a UTF-8 text file, creating parent directories and verifying the final bytes/hash.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" }, append: { type: "boolean", default: false } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_patch",
      description: "Exact string replacement patch for one text file with replacement count and postflight hash verification. A conflict returns the current hash, line count, bounded candidate context and a safe reread/retry action; it never applies a fuzzy replacement.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          expectedReplacements: { type: "number", default: 1 },
        },
        required: ["path", "oldText", "newText"],
        additionalProperties: false,
      },
    },
    {
      name: "edit_lines",
      description: "Surgically edit a text file by logical line numbers. Supports replace, insert_before, insert_after, and delete with context and postflight verification. Preserves the existing line-ending style and final-newline state; a terminal newline is not exposed as a phantom blank line. A stale range returns the current valid range, hash and nearby lines without guessing a mutation.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "number", minimum: 1 },
          endLine: { type: "number", minimum: 1 },
          newContent: { type: "string" },
          mode: { type: "string", enum: ["replace", "insert_before", "insert_after", "delete"] },
          previewContext: { type: "number", default: 2, minimum: 0, maximum: 10 },
        },
        required: ["path", "startLine"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    write_text_file: async (args) => {
      const parsed = z.object({ path: z.string(), content: z.string(), append: z.boolean().default(false) }).parse(args);
      return await writeTextAndVerify(parsed.path, parsed.content, parsed.append);
    },
    apply_patch: async (args) => {
      const parsed = z.object({
        path: z.string(), oldText: z.string(), newText: z.string(), expectedReplacements: z.number().int().positive().default(1),
      }).parse(args);
      return await exactStringPatch(parsed.path, parsed.oldText, parsed.newText, parsed.expectedReplacements);
    },
    edit_lines: async (args) => {
      const parsed = z.object({
        path: z.string(),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1).optional(),
        newContent: z.string().optional(),
        mode: z.enum(["replace", "insert_before", "insert_after", "delete"]).optional(),
        previewContext: z.number().int().min(0).max(10).default(2),
      }).parse(args);
      return await editLines(parsed.path, parsed.startLine, parsed.endLine, parsed.newContent, parsed.mode, parsed.previewContext);
    },
  },
};
