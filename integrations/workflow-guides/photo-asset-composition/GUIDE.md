# Fotocomposición por assets con escala y escena fija

## Purpose

Workflow reusable para fotos reales de productos: escena/cámara inmutable, medidas físicas, extracción de assets, edición localizada, composición por capas, QA visual y handoff MSSR; previene drift por regeneración completa.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **detect** — Identificar intención de editar foto existente, escena aprobada y problemas de drift.
2. **measure** — Registrar tamaño, forma, color, material, cantidades y perspectiva.
3. **extract** — Extraer background, máscara y assets individuales con procedencia.
4. **repair** — Corregir solo pieza o material solicitado.
5. **compose** — Montar assets en escena fijada sin drift.
6. **verify** — Controlar fidelidad física y estética.
7. **persist** — Conservar manifest, QA, decisiones y handoff.

## Tool policy

Recommended tools:

- `project_context_load`
- `skill_route_plan`
- `skill_bootstrap`
- `workflow_guide_load`
- `image_asset_import_files`
- `bridge_tool_action` (authorized `files` top-level passthrough)
- `read_text_file`
- `write_text_file`
- `binary_file_info`
- `mssr_trace_record`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
