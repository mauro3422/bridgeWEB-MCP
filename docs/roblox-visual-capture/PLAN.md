# Roblox Visual Capture Reliability Plan

**Estado:** implementación activa  
**Fecha:** 2026-07-23  
**Ámbitos:** `C:\Dev\bridge-mcp`, `D:\Dev\MyceliumFront`, skill `roblox-photo-rig-capture`

## 1. Objetivo

Dejar un loop visual de una sola llamada lógica que pueda montar cualquier sujeto, encuadrarlo en una cabina adaptable, obtener un lote de PNG internos de Roblox de forma secuencial, reintentar sólo las tomas fallidas, registrar anomalías y entregar evidencia lista para inspección y dashboard sin robar el foco del usuario.

```text
objeto canónico
→ clon aislado en VisualPhotoRig
→ cámaras por ocho esquinas + viewport real
→ job secuencial CaptureService
→ reintento individual
→ PNG estable + hash + dimensiones
→ manifest parcial/completo
→ image_file_attach
→ crítica visual
→ dashboard verificado
```

La captura física de la ventana de Studio queda como fallback diagnóstico explícito, nunca como backend principal ni como master limpio.

## 2. Diagnóstico confirmado

El loop anterior se demoró principalmente por pérdida de observabilidad visual, no por generación geométrica:

- `screen_capture` de StudioMCP podía quedar bloqueado y serializar toda la conexión;
- el timeout de 60 segundos del SDK MCP cerraba prematuramente llamadas largas;
- Play/Edit, debugger pausado e instancia activa podían quedar en estados inconsistentes;
- un fallo de una vista abortaba todo el lote;
- no había historial de intentos por toma ni estado `partial` útil;
- la captura de ventana robaba foco y sufría DPI, multimonitor y overlays;
- el agente podía confundir un fallo de transporte con un defecto visual;
- el dashboard no debía ingerir probes temporales, pero no existía una frontera automática suficientemente fuerte.

La ruta `CaptureService → tmp-capture-storage → PNG estable` ya demostró producir siete vistas nativas distintas en unos diez segundos. El trabajo actual robustece esa ruta existente.

## 3. Decisiones de arquitectura

### 3.1 Una llamada lógica, ejecución secuencial

`roblox_photo_capture_job` representa un solo job para el agente. Internamente las vistas se procesan secuencialmente porque `CurrentCamera`, la escena y `CaptureService` son estado compartido. Sólo hashing, limpieza y validadores independientes pueden paralelizarse.

### 3.2 Autoridad del archivo

La respuesta de `execute_luau` es una señal de lanzamiento. La autoridad fotográfica es un PNG nuevo que:

- aparece dentro de la ventana temporal de la toma;
- estabiliza su tamaño en al menos dos observaciones;
- tiene firma PNG y dimensiones positivas;
- se copia atómicamente al run;
- recibe SHA-256 y metadata.

Un timeout de transporte y un PNG válido pueden coexistir: se registran por separado.

### 3.3 Reintentos por toma

Cada shot tiene hasta `1 + retriesPerShot` intentos. En cada reintento:

1. se confirma que el Client sigue disponible;
2. se vuelve a activar la misma cámara semántica;
3. se toma un snapshot nuevo del directorio temporal;
4. se espera exclusivamente un PNG posterior al inicio del intento;
5. se conserva el historial completo.

Una toma fallida no elimina ni repite las ya aceptadas.

### 3.4 Estados del job

- `complete`: todas las tomas requeridas tienen master válido;
- `partial`: al menos una toma válida y al menos una fallida/degradada;
- `failed`: no se obtuvo ninguna toma válida o el preflight no pudo establecer un cliente limpio;
- `cancelled`: cancelación explícita, preservando evidencia ya escrita.

La calidad artística `accepted/degraded/rejected` permanece separada del estado técnico.

## 4. Notificaciones efímeras del Bridge

El Bridge mantiene una cola acotada de anomalías. Cada llamada de herramienta:

1. recibe anomalías emitidas por watchdogs o herramientas;
2. agrega automáticamente fallos, lentitud anormal y payloads excesivos;
3. entrega las pendientes dentro de `bridgeNotices` en la siguiente respuesta;
4. las elimina de la cola al entregarlas;
5. conserva sólo un audit trail técnico, no una notificación pendiente.

Ejemplo:

```json
{
  "bridgeNotices": {
    "delivery": "automatic-drain",
    "count": 1,
    "items": [
      {
        "severity": "warning",
        "code": "photo-rig-shot-retry",
        "source": "roblox_photo_capture_job",
        "message": "hero-top requirió un segundo intento"
      }
    ]
  }
}
```

La cola deduplica eventos equivalentes, acumula `occurrences`, expira eventos viejos y trunca contenido sensible o excesivo. `bridge_notice_status` permite inspección sin consumo y `bridge_notice_drain` fuerza la entrega manual.

## 5. Watchdog del job

### Preflight

- conexión persistente y catálogo StudioMCP saludables;
- exactamente el Studio esperado;
- modo Edit inicial;
- Photo Rig, sujeto y marcadores presentes;
- directorios escribibles;
- plan con ids únicos;
- ninguna toma requerida apunta fuera del run.

### Durante el job

- Client disponible antes de cada intento;
- latido por shot e intento;
- timeout separado para llamada MCP y aparición del PNG;
- detección de hash repetido entre cámaras semánticamente distintas;
- registro de recuperación de estado;
- stop inmediato del shot cuando el archivo ya es estable.

### Postflight

- detener Play aunque el lote sea parcial;
- retirar módulo temporal;
- confirmar retorno a Edit;
- validar manifiesto, archivos y hashes;
- emitir aviso si se utilizó fallback de ventana;
- no actualizar dashboard desde `.bridge` ni desde capturas fallidas.

## 6. Photo booth adaptable

`Workspace.VisualPhotoRig` es una cabina regenerable con:

- un solo `RuntimeSubject`;
- piso y fondo neutros;
- iluminación versionada;
- bounds exclusivos del sujeto;
- cámara calculada con las ocho esquinas, FOV, aspect ratio real y margen;
- refinamiento posterior por ocupación visible cuando corresponda;
- perfiles para objetos anchos, altos, largos, planos, transparentes y VFX.

La cabina debe escalar su piso, paredes y distancia de fondo según los bounds y la distancia máxima de cámara; no debe depender de coordenadas por asset.

## 7. Objeto de prueba N

`VisualCaptureTestObject_N` será un fixture determinista con:

- silueta asimétrica reconocible;
- volumen central, brazo largo, pieza alta y pieza pequeña separada;
- detalles finos para probar resolución;
- colores/materiales contrastantes;
- atributos de orientación y revisión.

Matriz mínima:

- hero front;
- hero three-quarter;
- side;
- top;
- detail;
- retry simulado en una vista;
- hash distinto por vista;
- limpieza y retorno a Edit.

El fixture valida el sistema; no se publica como asset del juego.

## 8. Backend hierarchy

1. **Principal:** Play Client + `CaptureService` + watcher local estable.
2. **Secundario futuro:** `StudioCaptureService` desde un plugin controlado, previa disponibilidad y permiso.
3. **Diagnóstico:** StudioMCP `screen_capture`, sólo si responde rápido y entrega imagen actual verificable.
4. **Último recurso:** captura scoped de la ventana exacta de Studio, con aviso `focus-stealing-fallback` y sin promoverla a master limpio.

`ViewportFrame` puede generar previews aislados, pero no sustituye masters porque no reproduce completamente sombras, postprocesado y ciertos materiales.

## 9. Contrato del manifest

`capture-results.json` registra:

- `jobId`, backend y versiones;
- estado técnico global;
- Studio y estado inicial/final;
- política de reintentos;
- evento/latido del job;
- por toma: intentos, errores, timestamps, archivo, dimensiones, bytes, hash, viewport, bounds proyectados y calidad;
- hashes repetidos inesperados;
- limpieza y fallback utilizados.

El dashboard sólo puede marcar `complete` si las vistas requeridas existen, sus hashes coinciden y hay crítica visual cuando el contrato la exige.

## 10. Criterios de aceptación

- una sola invocación ejecuta un lote completo;
- las cámaras se capturan secuencialmente;
- una falla se reintenta sin repetir las tomas sanas;
- un job parcial produce manifest utilizable;
- el backend principal no cambia el foco de Windows;
- las anomalías aparecen automáticamente en una respuesta y se limpian al entregarse;
- Play se detiene y Studio vuelve a Edit aun ante excepción;
- el objeto N produce vistas distintas y bien encuadradas;
- el dashboard se reconstruye sólo con evidencia canónica y pasa verificación estática/runtime.

## 11. Fuera de alcance inmediato

- múltiples clientes Roblox paralelos;
- captura de video;
- aprobación artística automática sin inspección visual;
- reemplazar `CaptureService` por `ViewportFrame`;
- publicar/commitear sin revisión explícita del usuario.
