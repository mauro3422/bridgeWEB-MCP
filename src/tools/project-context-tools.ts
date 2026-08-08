import { z } from "zod";
import {
  PROJECT_KNOWLEDGE_KINDS,
  PROJECT_CONTEXT_KINDS,
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_SIGNALS,
  SKILL_STAGES,
} from "@mauroprime/mssr";
import { updateProjectContextSection } from "../project-context-writer.js";
import type { BridgeToolModule } from "./types.js";

const moduleRegistrationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/),
  kind: z.enum(PROJECT_CONTEXT_KINDS),
  description: z.string().min(1).max(300),
  stages: z.array(z.enum(SKILL_STAGES)).max(6).default([]),
  domains: z.array(z.enum(SKILL_DOMAINS)).max(8).default([]),
  actions: z.array(z.enum(SKILL_ACTIONS)).max(12).default([]),
  artifacts: z.array(z.enum(SKILL_ARTIFACTS)).max(12).default([]),
  needs: z.array(z.enum(SKILL_NEEDS)).max(12).default([]),
  signals: z.array(z.enum(SKILL_SIGNALS)).max(12).default([]),
  required: z.boolean().default(false),
  priority: z.number().int().min(-100).max(100).default(0),
  maxChars: z.number().int().min(200).max(80_000).optional(),
  exclusiveGroup: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/).optional(),
}).strict().refine((value) => !(value.required && value.exclusiveGroup), {
  message: "Required project-context modules cannot belong to an exclusive group.",
});

export const projectContextToolModule: BridgeToolModule = {
  name: "project-context",
  tools: [
    {
      name: "project_context_update",
      description: "Safely upsert one stable Markdown section in .bridge/PROJECT_CONTEXT.md, PROJECT_MEMORY.md, or PROJECT_STATE.md. Supports optimistic concurrency with expectedSha256 and can atomically create/update the corresponding .bridge/project-context.json module metadata so a context, memory, state, or scoped directive becomes selectable by MSSR. Use for deliberate durable project-memory maintenance, not raw transcripts, logs, secrets, or broad repository rules that belong in AGENTS.md.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Repository root containing or receiving the .bridge project knowledge files." },
          kind: { type: "string", enum: [...PROJECT_KNOWLEDGE_KINDS], description: "Physical durable knowledge file to update: context=facts, memory=decisions/lessons, state=mutable current status." },
          heading: { type: "string", pattern: "^#{1,6}\\s+\\S(?:.*\\S)?$", maxLength: 160, description: "Exact stable Markdown heading used as the section identity, for example '## Broad refactor safety'." },
          content: { type: "string", maxLength: 80000, description: "Replacement body for the section. Upsert is idempotent by exact heading; duplicate headings fail closed." },
          expectedSha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$", description: "Optional optimistic concurrency hash of the current target Markdown file. A mismatch aborts without writing." },
          module: {
            type: "object",
            description: "Optional MSSR module registration. Source path/section are derived from kind+heading and cannot be overridden. Use kind=directive only for narrow project-specific conditional instructions; broad permanent rules belong in AGENTS.md.",
            properties: {
              id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
              kind: { type: "string", enum: [...PROJECT_CONTEXT_KINDS] },
              description: { type: "string", minLength: 1, maxLength: 300 },
              stages: { type: "array", items: { type: "string", enum: [...SKILL_STAGES] }, maxItems: 6, default: [] },
              domains: { type: "array", items: { type: "string", enum: [...SKILL_DOMAINS] }, maxItems: 8, default: [] },
              actions: { type: "array", items: { type: "string", enum: [...SKILL_ACTIONS] }, maxItems: 12, default: [] },
              artifacts: { type: "array", items: { type: "string", enum: [...SKILL_ARTIFACTS] }, maxItems: 12, default: [] },
              needs: { type: "array", items: { type: "string", enum: [...SKILL_NEEDS] }, maxItems: 12, default: [] },
              signals: { type: "array", items: { type: "string", enum: [...SKILL_SIGNALS] }, maxItems: 12, default: [] },
              required: { type: "boolean", default: false },
              priority: { type: "number", minimum: -100, maximum: 100, default: 0 },
              maxChars: { type: "number", minimum: 200, maximum: 80000 },
              exclusiveGroup: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,79}$" },
            },
            required: ["id", "kind", "description"],
            additionalProperties: false,
          },
        },
        required: ["projectRoot", "kind", "heading", "content"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    project_context_update: async (raw) => {
      const parsed = z.object({
        projectRoot: z.string().min(1),
        kind: z.enum(PROJECT_KNOWLEDGE_KINDS),
        heading: z.string().regex(/^#{1,6}\s+\S(?:.*\S)?$/).max(160),
        content: z.string().max(80_000),
        expectedSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        module: moduleRegistrationSchema.optional(),
      }).strict().parse(raw);
      return await updateProjectContextSection(parsed);
    },
  },
};
