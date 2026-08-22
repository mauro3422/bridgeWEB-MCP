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
