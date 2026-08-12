# ingest-align

## Goal

Construir una timeline multimodal con límites de precisión explícitos.

## Instructions

Usar speech-aware por defecto. Tomar audio como reloj maestro cuando exista. Conservar ventanas acústicas crudas de voz/quietud, ventanas estabilizadas para contexto, frames periódicos y keyframes por cambio visual. Si transcribe=true, recordar que segmentos de audio se envían a Google. No afirmar timestamps por palabra cuando wordTimestampsAvailable=false.
