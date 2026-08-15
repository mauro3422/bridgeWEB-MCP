# Narrated Media Review

## Purpose

Convierte videos, audios o grabaciones narradas de trabajo en evidencia temporal multimodal: detecta voz/silencio y cambios visuales, alinea transcripción con frames/keyframes, correlaciona observaciones con el proyecto propietario, ejecuta cambios bajo sus reglas y repite el loop con verificación.

## Activation

Use this guide when the user asks to listen to, transcribe, inspect, or understand an audio/video attachment, or when its other activation phrases/keywords clearly match. A request that looks simple, such as "transcribime este audio", still belongs here because `media_review_ingest` is the canonical first transcription/review path. If the match is uncertain, explain the possible match instead of silently forcing the workflow.

When `media_review_ingest` is available and healthy, use it as the canonical ASR/media entrypoint. Do **not** fall back to Whisper, a local transcription package, or another generic ASR path while that capability is healthy. Use another ASR only after the canonical capability has observably failed or is unavailable, and make that degradation explicit before replanning.

## Workflow

1. **acquire-source** — Resolver una única fuente reproducible sin transportar binarios innecesariamente.
2. **ingest-align** — Construir una timeline multimodal con límites de precisión explícitos.
3. **inspect-evidence** — Relacionar lenguaje, silencios y estados visuales antes de inferir una tarea.
4. **resolve-owner** — Determinar qué proyecto, aplicación o skill es autoridad para la observación detectada.
5. **execute-review** — Convertir observaciones sincronizadas en cambios concretos bajo el workflow del owner.
6. **iterate** — Cerrar el feedback loop con una nueva pasada comparable.

### Fast paths

- **Solo escuchar/transcribir audio:** `acquire-source → ingest-align → inspect-evidence → responder`. No exigir proyecto propietario ni fases visuales si no agregan valor.
- **Meme o clip audiovisual:** `acquire-source → ingest-align → inspect-evidence`; inspect both the canonical transcript/audio evidence and at least one representative visual frame before explaining the meaning/joke.
- **Video narrado que pide cambios sobre un proyecto:** usar el workflow completo y resolver el owner antes de mutar.

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
- Do not claim that media was transcribed, listened to, or visually inspected unless the corresponding tool evidence exists.
- Verify every persisted file or external side effect through a tool result.
- On failure, report the exact resumable state and the next action.
- Do not end a multi-step workflow with an empty response.

## Maintenance

Update `guide.json` when activation patterns, phases, or recommended tools change.
