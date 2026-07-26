# preserve-render-contract

## Goal

Demostrar que DOM, CSS y aspecto siguen equivalentes.

## Instructions

Congelar también el contrato de carga: `file://` frente a HTTP, scripts clásicos frente a módulos, orden de ejecución, globals compartidos y necesidad real de bundler. No migrar a ESM, imports dinámicos o framework si el entrypoint directo no los soporta sin servidor.

Comparar HTML/DOM relevante, conteos, atributos, clases, rutas y capturas de las mismas páginas, tamaños, datos y estados. No aceptar sólo que compile. Cualquier diferencia visual debe ser explicada o revertida.
