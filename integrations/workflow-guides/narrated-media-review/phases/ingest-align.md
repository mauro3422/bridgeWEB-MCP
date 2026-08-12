# ingest-align

## Goal

Construir una timeline multimodal con límites de precisión explícitos.

## Instructions

Usar speech-aware por defecto y tomar audio como reloj maestro cuando exista. Conservar ventanas acústicas crudas de sonido/quietud y ventanas estabilizadas de voz/silencio. Cuando `transcribe=true`, ejecutar en paralelo una pasada ASR sobre el audio completo para obtener el transcript canónico de mayor contexto y grupos speech-aware acotados para conservar anclas temporales; alinear el transcript canónico sobre esos segmentos, preservar el reconocimiento crudo de cada segmento por separado y usar el texto alineado en `transcript.srt`, timeline, frames y eventos. Si la pasada global falla, degradar de forma observable al transcript segmentado sin perder el review. Para video, usar análisis visual adaptativo a resolución reducida: medir cambio de contenido y traslación aparente, formar eventos `view-motion`/`content-change`/`scene-change`, y materializar sólo JPEGs representativos más una cobertura periódica escasa. No guardar un JPEG por cada frame analizado. `inverseViewDirectionHint` es sólo una pista 2D inversa al movimiento aparente de la imagen, nunca una reconstrucción de cámara 3D. Tanto la pasada global como los grupos segmentados se envían a Google cuando `transcribe=true`; usar `transcribe=false` para análisis totalmente local. No afirmar timestamps por palabra cuando `wordTimestampsAvailable=false`.
