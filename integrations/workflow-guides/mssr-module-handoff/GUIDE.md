# MSSR Module & Agent Handoff Protocol

## Purpose

Cross-project protocol: when the user asks for a new MSSR module, reusable pattern/skill, handoff or follow-up for another agent, resolve canonical ownership, create a bounded durable handoff, register only appropriate MSSR context/skill metadata, and verify routing and persistence without equating documentation to activation.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **detect** — Detectar petición persistente y necesidad real
2. **own** — Resolver dueño canónico y límites
3. **handoff** — Crear entrega durable para siguiente agente
4. **integrate** — Registrar integración MSSR sin fingir activación
5. **verify** — Verificar artefactos, routing y ejecución alcanzable
6. **close** — Informar estado, traza y prompt de continuación

## Tool policy

Recommended tools:

- `project_context_load`
- `skill_route_plan`
- `skill_bootstrap`
- `workflow_guide_recommend`
- `workflow_guide_load`
- `project_context_update`
- `project_context_health`
- `git_status`
- `read_text_file`
- `write_text_file`
- `mssr_trace_record`
- `bambu_mcp_tool_list`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
