import { SKILL_PHASES, SKILL_SIGNALS, SKILL_STAGES } from "@mauroprime/mssr";
import { z } from "zod";
import {
  MSSR_CHECKPOINT_TYPES,
  MSSR_CONTEXT_SOURCES,
  queryMssrObservatory,
  recordMssrCheckpoint,
} from "../mssr-observatory.js";
import type { BridgeToolModule } from "./types.js";

const observatoryKinds = ["status", "summary", "benchmark", "recent", "trace"] as const;
const checkpointStatuses = ["success", "partial", "failed", "skipped"] as const;

export const mssrObservatoryToolModule: BridgeToolModule = {
  name: "mssr-observatory",
  tools: [
    {
      name: "mssr_observatory_query",
      description: "Inspect privacy-preserving MSSR activation telemetry and benchmark route plans, skill loads, replans, verification, persistence, outcomes, context sources, and required-load compliance. Raw prompts and transcripts are not stored.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: observatoryKinds, default: "summary" },
          traceId: { type: "string", description: "Required only for kind=trace." },
          days: { type: "number", minimum: 1, maximum: 365, default: 30 },
          limit: { type: "number", minimum: 1, maximum: 200, default: 50 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "mssr_trace_record",
      description: "Record one bounded MSSR trace checkpoint after a phase, verification, persistence, outcome, friction, context retrieval, or replan. Store only structured metadata and a short redacted summary, never a raw prompt or transcript.",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string" },
          eventType: { type: "string", enum: MSSR_CHECKPOINT_TYPES },
          caller: { type: "string", enum: ["codex-local", "chatgpt-web", "other"] },
          stage: { type: "string", enum: SKILL_STAGES },
          skillName: { type: "string" },
          status: { type: "string", enum: checkpointStatuses },
          completedPhases: { type: "array", items: { type: "string", enum: SKILL_PHASES }, maxItems: 6 },
          contextSources: { type: "array", items: { type: "string", enum: MSSR_CONTEXT_SOURCES }, maxItems: 8 },
          userCorrections: { type: "number", minimum: 0, maximum: 100, default: 0 },
          verificationPassed: { type: "boolean" },
          persisted: { type: "boolean" },
          signals: { type: "array", items: { type: "string", enum: SKILL_SIGNALS }, maxItems: 20 },
          summary: { type: "string", maxLength: 300 },
        },
        required: ["traceId", "eventType"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    mssr_observatory_query: (args) => {
      const parsed = z.object({
        kind: z.enum(observatoryKinds).default("summary"),
        traceId: z.string().optional(),
        days: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(200).default(50),
      }).parse(args);
      return queryMssrObservatory(parsed);
    },
    mssr_trace_record: (args) => {
      const parsed = z.object({
        traceId: z.string().regex(/^[A-Za-z0-9._:-]{6,128}$/),
        eventType: z.enum(MSSR_CHECKPOINT_TYPES),
        caller: z.enum(["codex-local", "chatgpt-web", "other"]).optional(),
        stage: z.enum(SKILL_STAGES).optional(),
        skillName: z.string().max(160).optional(),
        status: z.enum(checkpointStatuses).optional(),
        completedPhases: z.array(z.enum(SKILL_PHASES)).max(6).optional(),
        contextSources: z.array(z.enum(MSSR_CONTEXT_SOURCES)).max(8).optional(),
        userCorrections: z.number().int().min(0).max(100).default(0),
        verificationPassed: z.boolean().optional(),
        persisted: z.boolean().optional(),
        signals: z.array(z.enum(SKILL_SIGNALS)).max(20).optional(),
        summary: z.string().max(300).optional(),
      }).parse(args);
      const event = recordMssrCheckpoint(parsed);
      return {
        recorded: true,
        traceId: event.traceId,
        eventId: event.id,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        privacy: "No raw prompt or transcript stored.",
      };
    },
  },
};
