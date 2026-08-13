import { SKILL_PHASES, SKILL_SIGNALS, SKILL_STAGES, mssrTraceWorkingMemorySchema } from "@mauroprime/mssr";
import { z } from "zod";
import {
  MSSR_CHECKPOINT_TYPES,
  MSSR_CONTEXT_SOURCES,
  MSSR_OUTCOME_DIMENSION_STATUSES,
  MSSR_OUTCOME_EVIDENCE_KINDS,
  getMssrTraceEvidence,
  purgeMssrTraceWorkingMemory,
  queryMssrObservatory,
  readPersistedMssrTraceState,
  recordMssrCheckpoint,
  updateMssrTraceWorkingMemory,
} from "../mssr-observatory.js";
import type { BridgeToolModule } from "./types.js";
import { startMssrObservabilityEpoch } from "../mssr-observability-epoch.js";

const observatoryKinds = ["status", "summary", "benchmark", "recent", "trace"] as const;
const checkpointStatuses = ["success", "partial", "failed", "skipped"] as const;
const observatoryScopes = ["active", "all"] as const;
const reasoningEfforts = ["low", "medium", "high", "xhigh", "max", "ultra", "unknown"] as const;

export const mssrObservatoryToolModule: BridgeToolModule = {
  name: "mssr-observatory",
  tools: [
    {
      name: "mssr_observatory_query",
      description: "Inspect privacy-preserving MSSR activation telemetry for the active trace-contract epoch or preserved all-history scope. Benchmark route plans, correlated skill loads, replans, verification, persistence, outcomes, context sources, continuity, and required-load compliance. Raw prompts and transcripts are not stored.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: observatoryKinds, default: "summary" },
          scope: { type: "string", enum: observatoryScopes, default: "active", description: "active starts at the current trace-contract epoch; all includes preserved legacy telemetry." },
          traceId: { type: "string", description: "Required only for kind=trace." },
          days: { type: "number", minimum: 1, maximum: 365, default: 30 },
          limit: { type: "number", minimum: 1, maximum: 200, default: 50 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "mssr_trace_evidence",
      description: "Reconstruct one privacy-safe evidence bundle for an MSSR trace by correlating route/load/checkpoint events with Bridge tool calls, workflow/task/session identifiers, runtime boot generations, verification, persistence, outcome and explicitly recorded evidence refs. This is read-only and does not infer a ChatGPT conversation id or final UI rendering.",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string", pattern: "^[A-Za-z0-9._:-]{6,128}$" },
          limit: { type: "number", minimum: 1, maximum: 500, default: 100 },
        },
        required: ["traceId"],
        additionalProperties: false,
      },
    },
    {
      name: "mssr_trace_working_update",
      description: "Store bounded ephemeral working metadata for one open MSSR trace. This RAM-only state may summarize hypotheses, decisions, evidence and the next gate for continuation, and is purged on outcome or Bridge restart. Never store raw prompts, transcripts, secrets, or private chain-of-thought.",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string", pattern: "^[A-Za-z0-9._:-]{6,128}$" },
          workingMemory: {
            type: "object",
            properties: {
              retention: { type: "string", enum: ["until-outcome"], default: "until-outcome" },
              workingSummary: { type: "string", minLength: 1, maxLength: 1200 },
              hypotheses: {
                type: "array", maxItems: 8, items: {
                  type: "object",
                  properties: {
                    summary: { type: "string", minLength: 1, maxLength: 300 },
                    status: { type: "string", enum: ["active", "supported", "rejected"] },
                    evidenceRef: { type: "string", minLength: 1, maxLength: 240 },
                  },
                  required: ["summary", "status"], additionalProperties: false,
                },
              },
              decisions: {
                type: "array", maxItems: 16, items: {
                  type: "object",
                  properties: {
                    subject: { type: "string", minLength: 1, maxLength: 120 },
                    decision: { type: "string", minLength: 1, maxLength: 240 },
                    reason: { type: "string", minLength: 1, maxLength: 300 },
                  },
                  required: ["subject", "decision"], additionalProperties: false,
                },
              },
              nextGate: { type: "string", minLength: 1, maxLength: 300 },
            },
            additionalProperties: false,
          },
        },
        required: ["traceId", "workingMemory"],
        additionalProperties: false,
      },
    },
    {
      name: "mssr_trace_record",
      description: "Record one bounded MSSR trace checkpoint after a phase, progress heartbeat, verification, persistence, outcome, friction, context retrieval, or replan. A progress checkpoint renews Web trace liveness without completing a phase. Outcome dimensions may describe mixed subsystem results while one primary skill and overall status remain authoritative. Bridge injects the active trace from the current session or a unique compatible process-shared lease; provide traceId explicitly after restart, for cross-process resume, or when multiple candidates exist. Store only structured metadata and short redacted evidence, never a raw prompt or transcript.",
      inputSchema: {
        type: "object",
        properties: {
          traceId: { type: "string" },
          eventType: { type: "string", enum: MSSR_CHECKPOINT_TYPES },
          caller: { type: "string", enum: ["codex-local", "opencode-local", "chatgpt-web", "other"] },
          model: { type: "string", maxLength: 80, description: "Observable host-reported model identifier. Use unknown when unavailable." },
          reasoningEffort: { type: "string", enum: reasoningEfforts, default: "unknown", description: "Observable host-reported reasoning effort; never inferred from behavior." },
          stage: { type: "string", enum: SKILL_STAGES },
          skillName: { type: "string" },
          primarySkill: { type: "string", description: "Single skill primarily accountable for this task outcome." },
          supportingSkills: { type: "array", items: { type: "string" }, maxItems: 24 },
          metricName: { type: "string", maxLength: 120 },
          score: { type: "number", minimum: 0, maximum: 1 },
          accepted: { type: "boolean" },
          evidenceKind: { type: "string", enum: MSSR_OUTCOME_EVIDENCE_KINDS },
          evidenceRef: { type: "string", maxLength: 300 },
          leaseMs: { type: "number", minimum: 30000, maximum: 900000, description: "Only for eventType=progress. Renews Web trace liveness without completing a phase." },
          dimensions: {
            type: "array",
            maxItems: 12,
            description: "Bounded outcome dimensions. They explain mixed results without replacing the single overall status or primary skill.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 1, maxLength: 80 },
                status: { type: "string", enum: MSSR_OUTCOME_DIMENSION_STATUSES },
                summary: { type: "string", maxLength: 200 },
                evidenceRef: { type: "string", maxLength: 200 },
              },
              required: ["name", "status"],
              additionalProperties: false,
            },
          },
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
    {
      name: "mssr_observatory_epoch_start",
      description: "Start a shared active observability baseline for MSSR and general Bridge tool calls without deleting prior telemetry. Active dashboard queries reset to the new epoch while scope=all preserves historical evidence. Use for a deliberate benchmark boundary, never to hide poor results.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: { type: "string", enum: ["start-new-active-epoch"], description: "Explicit confirmation for the recoverable active-baseline change." },
          reason: { type: "string", minLength: 3, maxLength: 160, description: "Short observable reason for starting the new comparison epoch." },
        },
        required: ["confirm", "reason"],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    mssr_observatory_query: (args) => {
      const parsed = z.object({
        kind: z.enum(observatoryKinds).default("summary"),
        scope: z.enum(observatoryScopes).default("active"),
        traceId: z.string().optional(),
        days: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(200).default(50),
      }).parse(args);
      return queryMssrObservatory(parsed);
    },
    mssr_trace_evidence: (args) => {
      const parsed = z.object({
        traceId: z.string().regex(/^[A-Za-z0-9._:-]{6,128}$/),
        limit: z.number().int().min(1).max(500).default(100),
      }).parse(args);
      return getMssrTraceEvidence(parsed.traceId, parsed.limit);
    },
    mssr_trace_working_update: (args) => {
      const parsed = z.object({
        traceId: z.string().regex(/^[A-Za-z0-9._:-]{6,128}$/),
        workingMemory: mssrTraceWorkingMemorySchema,
      }).parse(args);
      const state = readPersistedMssrTraceState(parsed.traceId);
      if (!state) throw new Error(`MSSR trace not found: ${parsed.traceId}`);
      if (state.closed) throw new Error(`MSSR trace is already closed: ${parsed.traceId}`);
      const workingMemory = updateMssrTraceWorkingMemory(parsed.traceId, parsed.workingMemory);
      return {
        updated: true,
        traceId: parsed.traceId,
        retention: workingMemory.retention,
        workingMemory,
        durableTelemetryWritten: false,
        privacy: "RAM-only until outcome or Bridge restart; no raw prompt, transcript, secret, or private chain-of-thought.",
      };
    },
    mssr_trace_record: (args) => {
      const parsed = z.object({
        traceId: z.string().regex(/^[A-Za-z0-9._:-]{6,128}$/),
        eventType: z.enum(MSSR_CHECKPOINT_TYPES),
        caller: z.enum(["codex-local", "opencode-local", "chatgpt-web", "other"]).optional(),
        model: z.string().trim().min(1).max(80).optional(),
        reasoningEffort: z.enum(reasoningEfforts).default("unknown"),
        stage: z.enum(SKILL_STAGES).optional(),
        skillName: z.string().max(160).optional(),
        primarySkill: z.string().max(160).optional(),
        supportingSkills: z.array(z.string().max(160)).max(24).optional(),
        metricName: z.string().max(120).optional(),
        score: z.number().min(0).max(1).optional(),
        accepted: z.boolean().optional(),
        evidenceKind: z.enum(MSSR_OUTCOME_EVIDENCE_KINDS).optional(),
        evidenceRef: z.string().max(300).optional(),
        leaseMs: z.number().int().min(30_000).max(900_000).optional(),
        dimensions: z.array(z.object({
          name: z.string().trim().min(1).max(80),
          status: z.enum(MSSR_OUTCOME_DIMENSION_STATUSES),
          summary: z.string().max(200).optional(),
          evidenceRef: z.string().max(200).optional(),
        }).strict()).max(12).optional(),
        status: z.enum(checkpointStatuses).optional(),
        completedPhases: z.array(z.enum(SKILL_PHASES)).max(6).optional(),
        contextSources: z.array(z.enum(MSSR_CONTEXT_SOURCES)).max(8).optional(),
        userCorrections: z.number().int().min(0).max(100).default(0),
        verificationPassed: z.boolean().optional(),
        persisted: z.boolean().optional(),
        signals: z.array(z.enum(SKILL_SIGNALS)).max(20).optional(),
        summary: z.string().max(300).optional(),
      }).parse(args);
      if (parsed.eventType === "outcome" && !(parsed.primarySkill || parsed.skillName)) {
        throw new Error("Outcome checkpoints require primarySkill so metrics have one accountable owner.");
      }
      if (parsed.eventType === "outcome" && !parsed.status) {
        throw new Error("Outcome checkpoints require status.");
      }
      if (parsed.dimensions && parsed.eventType !== "outcome") {
        throw new Error("Outcome dimensions are allowed only for eventType=outcome.");
      }
      if (parsed.leaseMs && parsed.eventType !== "progress") {
        throw new Error("leaseMs is allowed only for eventType=progress.");
      }
      const event = recordMssrCheckpoint(parsed);
      if (parsed.eventType === "outcome") purgeMssrTraceWorkingMemory(parsed.traceId);
      return {
        recorded: true,
        traceId: event.traceId,
        eventId: event.id,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        privacy: "No raw prompt or transcript stored.",
      };
    },
    mssr_observatory_epoch_start: (args) => {
      const parsed = z.object({
        confirm: z.literal("start-new-active-epoch"),
        reason: z.string().min(3).max(160),
      }).parse(args);
      const epoch = startMssrObservabilityEpoch();
      return {
        started: true,
        reason: parsed.reason,
        historyDeleted: false,
        previous: epoch.previous,
        current: epoch.current,
        activeScope: "Only MSSR events and Bridge tool calls recorded with the new shared epoch are included.",
        allScope: "Prior MSSR and Bridge telemetry remains queryable with scope=all.",
      };
    },
  },
};
