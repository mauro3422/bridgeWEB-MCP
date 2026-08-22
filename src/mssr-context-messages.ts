import { z } from "zod";
import {
  MSSR_CONTEXT_ADVISORY_ACTIONS,
  MSSR_CONTEXT_EVIDENCE_KINDS,
  MSSR_CONTEXT_FRESHNESS,
  MSSR_CONTEXT_MESSAGE_KINDS,
  MSSR_CONTEXT_MESSAGE_SEVERITIES,
  MSSR_CONTEXT_PERSISTENCE_TARGETS,
  MSSR_CONTEXT_PROVENANCE,
  SKILL_ACTIONS,
  SKILL_ARTIFACTS,
  SKILL_DOMAINS,
  SKILL_NEEDS,
  SKILL_PHASES,
  SKILL_SIGNALS,
  SKILL_STAGES,
  mssrContextMessageBatchSchema,
  selectMssrContextMessages,
  type MssrContextMessage,
  type MssrContextMessageSelection,
  type SkillStage,
  type StructuredSkillIntent,
} from "@mauroprime/mssr";
import type { BridgeNoticeInput } from "./notices.js";

const evidenceInputSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...MSSR_CONTEXT_EVIDENCE_KINDS] },
    ref: { type: "string", minLength: 1, maxLength: 240 },
    summary: { type: "string", minLength: 1, maxLength: 300 },
    canonicalOwner: { type: "string", minLength: 1, maxLength: 120 },
    provenance: { type: "string", enum: [...MSSR_CONTEXT_PROVENANCE] },
    freshness: { type: "string", enum: [...MSSR_CONTEXT_FRESHNESS] },
    observedAt: { type: "string", format: "date-time" },
    revision: { type: "string", minLength: 1, maxLength: 160 },
  },
  required: ["kind", "ref", "summary", "canonicalOwner", "provenance", "freshness"],
  additionalProperties: false,
} as const;

export const MSSR_CONTEXT_MESSAGE_INPUT_SCHEMA = {
  type: "array",
  maxItems: 32,
  description: "Bounded provider/host-supplied MSSR Context Messages v1. They are advisory evidence, never mutation authority.",
  items: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{1,119}$" },
      kind: { type: "string", enum: [...MSSR_CONTEXT_MESSAGE_KINDS] },
      severity: { type: "string", enum: [...MSSR_CONTEXT_MESSAGE_SEVERITIES], default: "info" },
      title: { type: "string", minLength: 1, maxLength: 120 },
      summary: { type: "string", minLength: 1, maxLength: 500 },
      evidence: { type: "array", maxItems: 8, items: evidenceInputSchema },
      advisoryActions: { type: "array", maxItems: 4, items: { type: "string", enum: [...MSSR_CONTEXT_ADVISORY_ACTIONS] } },
      continuation: {
        type: "object",
        properties: {
          traceId: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{1,119}$" },
          projectRevision: { type: "string", minLength: 1, maxLength: 160 },
          freshness: { type: "string", enum: [...MSSR_CONTEXT_FRESHNESS], default: "unknown" },
          unresolvedRefs: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 240 } },
          sourceReceipts: { type: "array", maxItems: 8, items: evidenceInputSchema },
          currentStage: { type: "string", enum: [...SKILL_STAGES] },
          completedPhases: { type: "array", maxItems: 6, items: { type: "string", enum: [...SKILL_PHASES] } },
          nextGate: { type: "string", minLength: 1, maxLength: 240 },
          summary: { type: "string", minLength: 1, maxLength: 400 },
        },
        required: ["currentStage", "nextGate", "summary"],
        additionalProperties: false,
      },
      persistenceProposal: {
        type: "object",
        properties: {
          target: { type: "string", enum: [...MSSR_CONTEXT_PERSISTENCE_TARGETS] },
          summary: { type: "string", minLength: 1, maxLength: 400 },
          evidence: { type: "array", minItems: 1, maxItems: 8, items: evidenceInputSchema },
          reviewRequired: { type: "boolean", const: true },
        },
        required: ["target", "summary", "evidence", "reviewRequired"],
        additionalProperties: false,
      },
      stages: { type: "array", maxItems: 6, items: { type: "string", enum: [...SKILL_STAGES] } },
      domains: { type: "array", maxItems: 8, items: { type: "string", enum: [...SKILL_DOMAINS] } },
      actions: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_ACTIONS] } },
      artifacts: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_ARTIFACTS] } },
      needs: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_NEEDS] } },
      signals: { type: "array", maxItems: 12, items: { type: "string", enum: [...SKILL_SIGNALS] } },
      required: { type: "boolean", default: false },
      priority: { type: "number", minimum: -100, maximum: 100, default: 0 },
      dedupeKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{1,119}$" },
      estimatedChars: { type: "number", minimum: 40, maximum: 2000, default: 320 },
    },
    required: ["id", "kind", "title", "summary"],
    additionalProperties: false,
  },
} as const;

function noticeSeverity(message: MssrContextMessage): BridgeNoticeInput["severity"] {
  return message.severity === "warning" ? "warning" : "info";
}

export function mssrContextMessageToBridgeNotice(message: MssrContextMessage): BridgeNoticeInput {
  const compactEvidence = (message.evidence ?? []).slice(0, 8).map((item) => ({
    kind: item.kind,
    ref: item.ref,
    canonicalOwner: item.canonicalOwner,
    provenance: item.provenance,
    freshness: item.freshness,
    ...(item.revision ? { revision: item.revision } : {}),
  }));
  return {
    severity: noticeSeverity(message),
    code: `mssr-context-${message.kind}`,
    source: "mssr-context-message-v1",
    message: `${message.title}: ${message.summary}`,
    dedupeKey: `mssr-context:${message.dedupeKey ?? message.id}`,
    details: {
      contextMessageId: message.id,
      kind: message.kind,
      portableSeverity: message.severity,
      evidence: compactEvidence,
      evidenceCount: message.evidence.length,
      advisoryActions: message.advisoryActions,
      ...(message.continuation ? { continuation: {
        traceId: message.continuation.traceId,
        freshness: message.continuation.freshness,
        currentStage: message.continuation.currentStage,
        completedPhases: message.continuation.completedPhases,
        nextGate: message.continuation.nextGate,
        unresolvedRefs: message.continuation.unresolvedRefs.slice(0, 8),
        sourceReceiptCount: message.continuation.sourceReceipts.length,
      } } : {}),
      ...(message.persistenceProposal ? { persistenceProposal: {
        target: message.persistenceProposal.target,
        reviewRequired: true,
        evidenceRefs: message.persistenceProposal.evidence.slice(0, 8).map((item) => item.ref),
      } } : {}),
      advisoryOnly: true,
      policy: "Review evidence at its canonical owner; no advisory action or proposal is executed automatically.",
    },
  };
}

export function selectBridgeMssrContextMessages(args: {
  messages: unknown;
  intent: StructuredSkillIntent;
  stage: SkillStage;
  maxMessages?: unknown;
  maxChars?: unknown;
}): { selection: MssrContextMessageSelection; notices: BridgeNoticeInput[] } | null {
  if (args.messages === undefined) return null;
  const messages = mssrContextMessageBatchSchema.parse(args.messages);
  const maxMessages = z.number().int().min(0).max(32).catch(12).parse(args.maxMessages ?? 12);
  const maxChars = z.number().int().min(0).max(20_000).catch(6_000).parse(args.maxChars ?? 6_000);
  const selection = selectMssrContextMessages({ messages, intent: args.intent, stage: args.stage, maxMessages, maxChars });
  return { selection, notices: selection.selected.map(mssrContextMessageToBridgeNotice) };
}
