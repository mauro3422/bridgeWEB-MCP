import type {
  SkillContextMode,
  SkillReferenceMode,
  StructuredSkillIntent,
} from "@mauroprime/mssr";

const CONTINUATION_TTL_MS = 30 * 60 * 1000;
const MAX_CONTINUATIONS = 64;

export type BridgeSkillContextContinuationEntry = Readonly<{
  name: string;
  source: string;
  obligation: "required" | "accepted";
  routeIndex: number;
  routeScore: number;
}>;

export type BridgeSkillContextContinuationState = Readonly<{
  traceId: string;
  caller: string;
  stage: string;
  intent: StructuredSkillIntent;
  mode: SkillContextMode;
  references: SkillReferenceMode;
  requestedContextChars: number;
  maxContextChars: number;
  maxEnvelopeChars: number;
  cursorFingerprint: string;
  entries: readonly BridgeSkillContextContinuationEntry[];
  createdAt: number;
  updatedAt: number;
}>;

const continuations = new Map<string, BridgeSkillContextContinuationState>();

function prune(now = Date.now()): void {
  for (const [traceId, state] of continuations) {
    if (now - state.updatedAt > CONTINUATION_TTL_MS) continuations.delete(traceId);
  }
  while (continuations.size > MAX_CONTINUATIONS) {
    const oldest = continuations.keys().next().value;
    if (typeof oldest !== "string") break;
    continuations.delete(oldest);
  }
}

export function rememberSkillContextContinuation(
  input: Omit<BridgeSkillContextContinuationState, "createdAt" | "updatedAt">,
): BridgeSkillContextContinuationState {
  const now = Date.now();
  prune(now);
  const previous = continuations.get(input.traceId);
  const state: BridgeSkillContextContinuationState = {
    ...input,
    entries: input.entries.map((entry) => ({ ...entry })),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  continuations.delete(input.traceId);
  continuations.set(input.traceId, state);
  prune(now);
  return state;
}

export function readSkillContextContinuation(traceId: string): BridgeSkillContextContinuationState | null {
  const now = Date.now();
  prune(now);
  return continuations.get(traceId) ?? null;
}

export function clearSkillContextContinuation(traceId: string): boolean {
  return continuations.delete(traceId);
}

export function skillContextContinuationStateCount(): number {
  prune();
  return continuations.size;
}
