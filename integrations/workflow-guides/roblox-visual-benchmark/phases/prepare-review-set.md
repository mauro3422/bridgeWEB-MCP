# prepare-review-set

## Goal

Construir contextos de revisión aislado e integrado, regenerables y temporales.

## Instructions

Preparar el set mediante un script determinista, no con colocación manual. El set debe generarse desde una carga fresca de la fuente canónica para evitar caches. Incluir una galería aislada y, cuando corresponda, escena integrada a distancia jugable. Registrar el script de preparación y un cleanup idempotente. Ejecutar cleanup también si exportación o captura fallan.
