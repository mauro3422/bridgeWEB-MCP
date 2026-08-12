# Narrated Media Review

## Purpose

Convierte videos, audios o grabaciones narradas de trabajo en evidencia temporal multimodal: detecta voz/silencio y cambios visuales, alinea transcripción con frames/keyframes, correlaciona observaciones con el proyecto propietario, ejecuta cambios bajo sus reglas y repite el loop con verificación.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **acquire-source** — Resolver una única fuente reproducible sin transportar binarios innecesariamente.
2. **ingest-align** — Construir una timeline multimodal con límites de precisión explícitos.
3. **inspect-evidence** — Relacionar lenguaje, silencios y estados visuales antes de inferir una tarea.
4. **resolve-owner** — Determinar qué proyecto, aplicación o skill es autoridad para la observación detectada.
5. **execute-review** — Convertir observaciones sincronizadas en cambios concretos bajo el workflow del owner.
6. **iterate** — Cerrar el feedback loop con una nueva pasada comparable.

## Tool policy

Recommended tools:

- `project_context_load`
- `skill_bootstrap`
- `media_review_ingest`
- `image_file_attach`
- `workflow_guide_load`
- `bridge_connector_catalog_compare`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
