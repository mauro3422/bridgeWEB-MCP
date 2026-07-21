# Roadmap de MSSR

## Estado actual

- Catálogo vivo de Codex y Roblox.
- Precedencia y deduplicación por fuente.
- Intención estructurada con fallback léxico marcado.
- Contexto breve para continuaciones conversacionales.
- Fases, dependencias, exclusiones y workflows.
- Auditoría de drift y salud de skills.
- Fixtures positivos, negativos y de continuación.
- Configuración y pruebas versionadas en Git.
- Dashboard generado y skill mantenedora.

## Próximo nivel útil

### Observabilidad de decisiones

Registrar sin contenido sensible:

- nombre del fixture o hash de intención;
- skills activas/diferidas;
- warnings y metadata inferida;
- duración y resultado de la fase;
- correcciones manuales realizadas después.

Esto permitiría descubrir falsos positivos frecuentes sin almacenar mensajes completos.

### Evaluación basada en historial

Convertir errores reales confirmados en fixtures de regresión. No aprender automáticamente de una única ejecución ni reescribir el contrato por frecuencia.

### Herramienta de edición asistida

Crear una operación que proponga un patch de metadata para una skill nueva usando la salida de `skill_route_audit`, pero requiera confirmación, snapshot y pruebas antes de escribir.

### Checkpoints de workflows largos

Añadir estado durable cuando un workflow necesite sobrevivir reinicios, pausas, aprobaciones humanas o varios días. El estado mínimo sería:

- intención resuelta;
- fase actual;
- fases completadas;
- artefactos producidos;
- verificaciones pendientes;
- referencias a snapshots o commits.

## LangGraph

No se añade como dependencia en esta etapa. MSSR hoy resuelve routing, no ejecuta un grafo autónomo de larga duración. El Bridge ya dispone de snapshots, sesiones de terminal, métricas y replanificación por fases.

Reevaluar LangGraph cuando aparezcan simultáneamente varios de estos requisitos:

- reanudación automática tras caída;
- human-in-the-loop entre nodos;
- ramas y reintentos complejos;
- subagentes con memoria por hilo;
- time travel o replay de estados;
- muchas ejecuciones concurrentes que necesiten un store compartido.

En ese momento MSSR puede convertirse en el nodo de routing inicial de un grafo, sin reemplazar el contrato ni los fixtures actuales.

## No objetivos

- No autoeditar skills silenciosamente en background.
- No guardar cadena de pensamiento.
- No cargar todas las skills en cada turno.
- No transformar métricas de frecuencia en reglas sin casos reproducibles.
- No hacer que el Bridge adivine una conversación que el caller no le envió.
