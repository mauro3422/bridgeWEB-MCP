# inspect-evidence

## Goal

Relacionar lenguaje, silencios y estados visuales antes de inferir una tarea.

## Instructions

Revisar segmentos con `frameIndices`, `visualKeyframeIndices`, `visualEventIndices` y ventanas de movimiento ya correlacionadas por la tool. Adjuntar sólo vistas representativas y usar el `transcriptExcerpt`/metadata de cada frame antes de volver a reconstruir la relación manualmente. Distinguir texto reconocido, inferencia visual, movimiento aparente y observación del usuario. Los visual keyframes son evidencia de revisión seleccionada por eventos, no keyframes del codec; los paneos/cambios de viewport pueden producir muchos frames distintos pero deben resumirse como ventanas temporales con inicio, pico y fin.
