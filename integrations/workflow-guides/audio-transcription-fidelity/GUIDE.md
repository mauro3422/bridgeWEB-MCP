# Transcripción fiel de audio (Whisper + Google Speech)

## Purpose

Activar el flujo MSSR audio-transcription-fidelity para transcribir notas de voz WhatsApp, audio OGG, mensajes de voz, entrevistas y grabaciones, seleccionando Whisper local o Google Speech y corrigiendo errores contextuales sin inventar.

## Activation

Use this guide only when its activation phrases or keywords clearly match the user's task. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

## Workflow

1. **source** — Identificar y validar origen
2. **provider** — Elegir ruta privada local o externa autorizada
3. **recognize** — Conservar reconocimiento bruto y segmentos
4. **review** — Corregir escuchando y contrastando
5. **verify** — Verificar outputs y persistencia

## Tool policy

Recommended tools:

- `project_context_load`
- `skill_bootstrap`
- `skill_catalog`
- `skill_load`
- `media_review_ingest`
- `run_command`
- `binary_file_info`
- `mssr_trace_record`

## Verification

- Record the last completed phase.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
