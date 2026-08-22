export function jsonCharacterLength(value: unknown): number {
  // Bridge emits tool payloads with two-space JSON indentation. Measure the
  // actual text envelope seen by MCP callers, not a smaller compact surrogate.
  return JSON.stringify(value, null, 2).length;
}

/** Add an exact serialized character count, including the responseChars field itself. */
export function withResponseChars<T extends Record<string, unknown>>(value: T): T & { responseChars: number } {
  let responseChars = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = jsonCharacterLength({ ...value, responseChars });
    if (next === responseChars) break;
    responseChars = next;
  }
  return { ...value, responseChars };
}

export function skillContextNextAction(traceId: string, cursor: string): Record<string, unknown> {
  return {
    label: "Cargar la siguiente página de contexto requerida",
    toolName: "skill_context_next",
    arguments: { traceId, cursor },
    instruction: "Continúa inmediatamente con este cursor hasta status=complete antes de ejecutar una fase que dependa del contexto pendiente.",
  };
}

/**
 * Host-visible lifecycle gate returned only when the selected context chain is
 * complete. It makes the next checkpoint/close obligation explicit without
 * claiming that delivered context was used or that the task succeeded.
 */
export function skillContextCompletionGate(
  traceId: string,
  stage: string,
  postContextAction?: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> {
  const hasPostContextAction = Boolean(postContextAction);
  return {
    contextChain: "complete",
    traceId,
    stage,
    automaticCheckpoint: false,
    automaticOutcome: false,
    nextRequiredAction: hasPostContextAction
      ? "execute-post-context-action-before-active-phase"
      : stage === "close"
        ? "finish-close-gates-then-record-one-truthful-outcome"
        : "execute-active-phase-then-record-phase-and-replan",
    ...(postContextAction ? { postContextAction } : {}),
    phaseCheckpointTemplate: {
      toolName: "mssr_trace_record",
      arguments: { traceId, eventType: "phase_completed", stage, status: "success" },
      instruction: "Use this template only after the active phase actually completes; add completedPhases and evidence fields supported by observable results.",
    },
    closureInstruction: hasPostContextAction
      ? "Execute postContextAction before dependent phase work. Then replan the same trace at verify/persist/close as applicable and record exactly one truthful outcome; context delivery alone is never success evidence."
      : "Before ending the task, replan the same trace at verify/persist/close as applicable and record exactly one truthful outcome. Context delivery alone is never success evidence.",
  };
}
