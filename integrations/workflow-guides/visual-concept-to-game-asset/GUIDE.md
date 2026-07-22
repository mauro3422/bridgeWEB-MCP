# Visual Concept to Game Asset

## Purpose

Generate divergent visual concepts, preserve them, extract a measurable geometric recipe, choose a Roblox-direct or Blender production path, build a game-ready prototype, compare deterministic renders against the concept with overlays, and iterate by the largest visual error.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **define-visual-contract** — Definir función jugable, escala, restricciones técnicas, nivel de detalle, vistas necesarias y criterios visuales de aceptación.
2. **generate-divergent-concepts** — Generar familias visuales realmente distintas antes de iterar detalles.
3. **normalize-reference-set** — Convertir la dirección elegida en referencias útiles para modelado.
4. **extract-geometry-recipe** — Traducir las referencias a una especificación geométrica paramétrica y medible.
5. **choose-production-path** — Elegir Roblox directo, Blender o un flujo híbrido según la geometría requerida.
6. **build-parametric-prototype** — Construir una fuente canónica reproducible desde la receta, no un montaje manual irrepetible.
7. **align-and-compare** — Comparar renders deterministas con la referencia usando escala y cámaras equivalentes.
8. **iterate-largest-error** — Corregir una causa visual dominante por iteración y explorar otra familia cuando la base sea incorrecta.
9. **publish-provenance-dashboard** — Persistir referencias, prompts, receta, fuente, renders, overlays, críticas y decisiones en un historial navegable.
10. **maintain-pipeline** — Convertir fallos repetidos de generación, alineación o construcción en mejoras transversales.

## Tool policy

Recommended tools:

- `image_gen`
- `project_context_load`
- `workflow_guide_load`
- `skill_recommend`
- `skill_load`
- `blender_store_reference_image`
- `blender_batch_script`
- `blender_open`
- `roblox_mcp_status`
- `roblox_mcp_tool_list`
- `roblox_mcp_query`
- `roblox_mcp_action`
- `run_command`
- `write_text_file`
- `binary_file_info`
- `workspace_snapshot`
- `roblox_place_save`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
