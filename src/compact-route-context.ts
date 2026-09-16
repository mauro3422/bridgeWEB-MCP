/** Compact diagnostics only; selected evidence and its provenance remain intact. */
export function compactRouteContextPlane(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const plane = value as Record<string, any>;
  const project = plane.projectContext;
  const repository = plane.repository;
  const { decisions, ...projectEvidence } = project ?? {};
  return {
    ...plane,
    projectContext: project ? { ...projectEvidence, decisionCount: Array.isArray(decisions) ? decisions.length : 0 } : project,
    // The merged selected messages are delivered once at response.contextMessages.
    contextMessages: { selectionRef: 'contextMessages' },
    repository: repository ? {
      observationCount: Array.isArray(repository.observations) ? repository.observations.length : 0,
      messageCount: Array.isArray(repository.messages) ? repository.messages.length : 0,
      diagnostics: repository.diagnostics,
      overflow: repository.overflow,
      detailMode: 'debug',
    } : repository,
  };
}
