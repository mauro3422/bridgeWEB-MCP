# ingest-align

## Goal

Construir una timeline multimodal con límites de precisión explícitos.

## Instructions

Usar speech-aware por defecto. Tomar audio como reloj maestro cuando exista. Conservar ventanas acústicas crudas de sonido/quietud y ventanas estabilizadas de voz/silencio. Para video, usar análisis visual adaptativo a resolución reducida: medir cambio de contenido y traslación aparente, formar eventos `view-motion`/`content-change`/`scene-change`, y materializar sólo JPEGs representativos más una cobertura periódica escasa. No guardar un JPEG por cada frame analizado. Enriquecer automáticamente frames y eventos con índices de audio, segmentos transcriptos y excerpts; generar `transcript.srt` cuando haya texto reconocido. `inverseViewDirectionHint` es sólo una pista 2D inversa al movimiento aparente de la imagen, nunca una reconstrucción de cámara 3D. Si transcribe=true, recordar que segmentos de audio se envían a Google. No afirmar timestamps por palabra cuando wordTimestampsAvailable=false.
