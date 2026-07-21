# Pruebas de MSSR

## Qué se prueba realmente

Las pruebas no envían un mensaje a un modelo y esperan una respuesta impredecible. Invocan directamente el registry compilado con el mismo objeto que enviaría el agente:

```json
{
  "task": "Dale",
  "context": "La propuesta aceptada fue implementar una red de micelio, con edición segura, playtest y guardado...",
  "intent": {
    "domains": ["roblox"],
    "actions": ["create", "edit"],
    "artifacts": ["network-system"],
    "needs": ["safe-editing", "playtest"],
    "risk": "write",
    "ambiguity": "medium"
  }
}
```

Luego se inspeccionan `loadOrder`, `deferredLoadOrder`, fases, warnings y cobertura.

## Capas

### 1. Fixtures versionados

`config/skill-routing/skill-routing-fixtures.json` contiene frases reales, continuaciones ambiguas y casos negativos. Un caso puede declarar `taskVariants` para comprobar que distintas formas de aceptación o continuación mantienen el mismo routing sin duplicar todo el fixture.

Cada caso puede exigir:

- skills que deben estar activas;
- skills que no deben estar activas;
- skills que deben quedar diferidas;
- modo estructurado o fallback;
- uso del contexto previo;
- fases requeridas que deben quedar sin cobertura, normalmente ninguna mediante `missingRequiredPhases`.

### 2. Auditoría estructural

`skill_route_audit` comprueba:

- skills propias sin metadata explícita;
- configuración obsoleta;
- dependencias y workflows rotos;
- ciclos;
- duplicados;
- archivos ilegibles;
- descripciones faltantes;
- skills que ameritan revisar su tamaño.

### 3. Regresión aislada

`scripts/test-v060-tools.mjs` crea un `CODEX_HOME` temporal con skills controladas. Verifica que el router no dependa del catálogo real del usuario y prueba estructura, fases, contexto y auditoría.

### 4. Suite integral

`scripts/verify-all.ps1` ejecuta compilación, HTTP smoke, regresiones, routing fixtures, documentación, watchdog, métricas y catálogo de tools.

## Comandos

```powershell
npm run test:skill-routing
npm run test:regressions
npm run verify:all
```

## Añadir un caso

Para cada activación importante agregar:

1. un caso positivo;
2. un caso negativo semánticamente cercano;
3. un caso con `context` cuando el usuario pueda aprobar una propuesta con una frase breve;
4. fases posteriores cuando existan verificación o persistencia.

Los fixtures deben describir comportamiento observable, no detalles internos del algoritmo de puntaje.

Para un falso positivo o falso negativo confirmado, conserva primero la salida que falla, añade el incidente a `INCIDENTS.md` y crea un fixture que exija tanto la selección correcta como la exclusión explícita de las ramas incorrectas. Después de modificar código o contrato, lee de vuelta los archivos: un exit code exitoso de un script no demuestra por sí solo que la configuración cambió.
