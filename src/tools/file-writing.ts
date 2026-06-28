import fs from "node:fs/promises";
import { z } from "zod";
import type { BridgeToolModule } from "./types.js";
import { DEFAULT_EDIT_FILE_MAX_BYTES, readTextSnapshot, sha256Text, writeTextAndVerify } from "./shared/text-files.js";
import { applyLineEdit } from "./shared/line-edits.js";

async function exactStringPatch(filePath: string, oldText: string, newText: string, expectedReplacements: number) {
  if (!oldText) throw new Error("oldText must not be empty.");
  const before = await readTextSnapshot(filePath, DEFAULT_EDIT_FILE_MAX_BYTES);
  const count = before.text.split(oldText).length - 1;
  if (count !== expectedReplacements) {
    throw new Error(`Expected ${expectedReplacements} replacement(s), found ${count}.`);
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
  const edit = applyLineEdit({ snapshot: before, startLine, endLine, newContent, mode, previewContext });
  await fs.writeFile(before.path, edit.updatedText, "utf8");
  const after = await readTextSnapshot(before.path, DEFAULT_EDIT_FILE_MAX_BYTES);
  const expectedSha256 = sha256Text(edit.updatedText);
  return {
    path: before.path,
    before: { bytes: before.bytes, sha256: before.sha256, totalLines: before.totalLines, lineEnding: before.lineEnding },
    after: { bytes: after.bytes, sha256: after.sha256, totalLines: after.totalLines, lineEnding: after.lineEnding },
    changed: before.sha256 !== after.sha256,
    edit: edit.summary,
    postflight: {
      expectedSha256,
      verified: after.sha256 === expectedSha256,
    },
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
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          append: { type: "boolean", default: false },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_patch",
      description: "Exact string replacement patch for one text file with replacement count and postflight hash verification.",
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
      description: "Surgically edit a text file by line numbers. Supports replace, insert_before, insert_after, and delete with context and postflight verification.",
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
        path: z.string(),
        oldText: z.string(),
        newText: z.string(),
        expectedReplacements: z.number().int().positive().default(1),
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
