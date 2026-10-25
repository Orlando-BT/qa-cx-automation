# Bitácora

Bitácora cronológica de commits y decisiones del proyecto. Cada entrada indica fecha, etiqueta o título del commit, subagente(s) involucrados, qué cambió y la decisión relacionada.

- El detalle técnico de cada fase está en `docs/registro-tecnico.md`. Las decisiones del dueño (D1 a D6) están descritas ahí y sus razones en `docs/decisiones.md`, que escribe el dueño.
- Los documentos citan etiquetas de Git (`fase-0-cierre`, `fase-1-cierre`) en vez de hashes. Para commits sin etiqueta se usa el título del commit.
- No se reportan métricas ni resultados por conversación. Del lote solo se citan totales. No hay métricas de confiabilidad: la calificación humana no existe todavía.

## Nota sobre las entradas reconstruidas

Las entradas de las Fases 0 y 1 **se reconstruyeron después**, a partir del historial de Git (`git log --reverse`) y de `docs/registro-tecnico.md`, `docs/prompts-arranque.md` y `CLAUDE.md`. Los commits de entonces **no traían la línea `Subagente:`**, así que los subagentes de cada entrada se infieren de la propiedad de archivos de `CLAUDE.md` y del registro técnico, no de los mensajes de commit. Cada entrada reconstruida lleva la marca "(reconstruido desde Git)". Las fechas y horas de los commits son las de Git (hora de México, -0600). Los subagentes marcados "Inferido" no se pudieron confirmar.

## Fase 0: Contrato (22-oct-2026)

### Fase 0: contrato del proyecto de QA automático (reconstruido desde Git)
- Fecha: 22-oct-2026 20:57 (hora de México, -0600).
- Commit: "Fase 0: contrato del proyecto de QA automático".
- Subagentes: `contrato-datos` (redactó el contrato), `revisor` (tres rondas de revisión, solo lectura), `documentacion` (registro técnico). Inferido.
- Qué cambió: se creó `contrato/` (glosario, rúbrica CE `reglas_ce_v1`, config, 13 hojas en `sheets.md`, tres esquemas JSON y ejemplos). Conteos verificados por `revisor`: 54 subelementos de sección, 3 de identidad, 12 errores críticos, 69 criterios por evaluación. `CLAUDE.md` se aligeró con referencias a `contrato/`.
- Decisión relacionada: el contrato como fuente de verdad; se agregó `tipo_interaccion` (`ce` | `sales`) para poder sumar Sales sin cambiar el motor.

### Fase 0: mis decisiones y explicación (etiqueta `fase-0-cierre`) (reconstruido desde Git)
- Fecha: 22-oct-2026 21:04 (hora de México, -0600).
- Etiqueta: `fase-0-cierre`.
- Subagentes: ninguno confirmado; el contenido es del dueño y del registro técnico.
- Qué cambió: se agregaron las decisiones y la explicación del dueño (`docs/decisiones.md`) y el registro técnico de la Fase 0.
- Decisión relacionada: D1 (agregación de subelementos a sección), D2 (`nota_base` y `nota_final`), D3 (base de conocimiento completa en una llamada en v1), D4 (alertas de costo y calibración), D5 (renormalización cuando una sección completa es `no_aplica`), D6 (calificación humana sobre subelementos clave, secciones, críticos e identidad).

### Normaliza saltos de línea (.gitattributes) (reconstruido desde Git)
- Fecha: 22-oct-2026 21:46 (hora de México, -0600).
- Commit: "Normaliza saltos de línea (.gitattributes)".
- Subagentes: ninguno confirmado; cambio de configuración del repositorio.
- Qué cambió: se agregó `.gitattributes` para normalizar saltos de línea (el proyecto se trabaja en Windows).
- Decisión relacionada: ninguna de D1 a D6; ajuste de mantenimiento.

## Fase 1: Construcción en paralelo (23-oct-2026)

### Fase 1 (checkpoint): contrato y datos actualizados (reconstruido desde Git)
- Fecha: 23-oct-2026 12:24 (hora de México, -0600).
- Commit: "Fase 1 (checkpoint): contrato y datos actualizados".
- Subagentes: `contrato-datos`. Inferido.
- Qué cambió: 41 archivos (confirmado con `git show --stat`): `contrato/`, datos de referencia en `datos/` y `datos/lotes/calibracion_v1/` (24 conversaciones, `_escenarios.json` y `revision_humana.csv`).
- Decisión relacionada: pendientes de la Fase 0 resueltos o encaminados (sección 5 del registro técnico). Este commit es el que citan los encabezados de los prompts como "checkpoint".

### Fase 1: construcción en paralelo (código JS, prompts v1, prueba B) (reconstruido desde Git)
- Fecha: 23-oct-2026 20:58 (hora de México, -0600). La prueba B y los costos provisionales son del 23-oct hora local de México, 24-oct en UTC.
- Commit: "Fase 1: construcción en paralelo (código JS, prompts v1, prueba B)".
- Subagentes: `reglas-js` (código determinista y pruebas), `evaluador-llm` (prompt v1 del evaluador, validador, construcción del prompt, prompt del generador), `contrato-datos` (ajustes a contrato y datos), `documentacion` (esqueleto del README y registro técnico), `revisor`. Inferido.
- Qué cambió: código en `js/` con pruebas en `js/tests/` (241 tests, 241 pasan, verificado por el orquestador el 23-oct-2026); prompts `evaluador_ce_v1` y `generador_ce_v1`; ajustes de identidad, "sigue pidiendo datos", listas nuevas, información de la cuenta, y configuración del evaluador tras la prueba A (modelo `gpt-6-luna`, sin `temperature`); arreglo de `extraerTextoSalida` (elige el bloque `final_answer` y no concatena `commentary`). Prueba B con costos agregados (ver registro técnico, sección 2 de la Fase 1). `costo_estimado_por_evaluacion_usd` = 0.005 y `tope_costo_lote_usd` = 0.25 quedaron como PROVISIONALES.
- Decisión relacionada: cambios dentro de v1 antes de congelar (`reglas_ce_v1`, `evaluador_ce_v1`, `generador_ce_v1` no subieron de versión porque no había evaluaciones guardadas); D3 (una sola llamada) sigue vigente.

### Rúbrica v1: alcance del SUPUESTO del silencio final y backlog Fase 4 (etiqueta `fase-1-cierre`) (reconstruido desde Git)
- Fecha: 23-oct-2026 22:14 (hora de México, -0600).
- Etiqueta: `fase-1-cierre`.
- Subagentes: `documentacion`, con cambio de redacción en `contrato/rubrica.md` autorizado por el dueño. Inferido.
- Qué cambió: en `contrato/rubrica.md` sección 3.10 la marca SUPUESTO cubre solo la viñeta de `recapitulacion.cierre_inactividad`; `cierre.despedida` = `no_cumple` no es supuesto. Se agregó al backlog de la Fase 4 medir la doble penalización por recordatorio sin cierre. Cambio solo de redacción: no cambia código, pruebas ni notas.
- Decisión relacionada: el dueño confirmó que recordatorio sin cierre = `no_cumple`. Con este cierre las versiones v1 quedan congeladas.

### Docs: prompts de arranque de Fases 0, 1 y 2 (reconstruido desde Git)
- Fecha: 23-oct-2026 22:46 (hora de México, -0600). Un solo archivo: `docs/prompts-arranque.md`. Nota: no hay un prompt separado de Fase 1 en ese archivo.
- Commit: "Docs: prompts de arranque de Fases 0, 1 y 2".
- Subagentes: ninguno confirmado; documento del dueño en `docs/prompts-arranque.md`.
- Qué cambió: se guardaron los prompts con los que se inician las fases, incluido el de la Fase 2 con las decisiones del dueño y las preguntas que el plan debe responder.
- Decisión relacionada: reglas de trabajo de la Fase 2 (commits con `Subagente:`, bitácora mantenida por `documentacion`).

### Metadatos v1: hashes tras reescribir el historial y etiquetas de cierre (reconstruido desde Git)
- Fecha: 23-oct-2026 23:00 (hora de México, -0600).
- Commit: "Metadatos v1: hashes tras reescribir el historial y etiquetas de cierre".
- Subagentes: ninguno confirmado. Inferido: `documentacion` y `evaluador-llm` por los archivos tocados.
- Qué cambió: el historial se reescribió antes del primer push para usar el correo noreply de GitHub como autor; el contenido no cambió, pero sí los hashes. Se actualizaron las referencias en el registro técnico y en el encabezado de `prompts/evaluador_ce_v1.md` y `prompts/generador_ce_v1.md`. Se crearon las etiquetas `fase-0-cierre` y `fase-1-cierre`.
- Decisión relacionada: desde aquí los documentos citan etiquetas en vez de hashes. El encabezado de los prompts no se envía al modelo, por eso no cambia la versión ni el comportamiento.

## Fase 2 (en curso, iniciada 24-oct-2026)

### Plan aprobado y decisiones de arranque (pendiente de commit)
- Fecha: 24-oct-2026.
- Commit: pendiente de commit.
- Subagente: orquestador (plan); `documentacion` registra la entrada.
- Qué cambió: el dueño aprobó el plan de la Fase 2. Todavía no hay cambios en el repositorio por esta entrada, salvo esta bitácora. Decisiones:
  - Modelo generador: `claude-haiku-5-5`, verificado en la documentación oficial de Anthropic; es de un proveedor distinto al del evaluador.
  - `max_tokens_evaluador = 8000` pasa a ser clave de config, hasta resolver el `commentary` en v2.
  - Cola de reproceso: estado `reproceso` y un workflow nuevo de reproceso, para que ninguna conversación con `fallo_api` se pierda.
  - Los errores HTTP 429 y 5xx se reintentan con espera.
  - W2 revisa `falla_api` antes que `valido`.
  - Criterio de terminado de la Fase 2: lote `demo` más casos de prueba. `calibracion_v1` solo se ingesta como pendiente, sin evaluar, para proteger la calificación a ciegas.
  - La verdad de los escenarios de `calibracion_v1` no se carga en Google Sheets hasta terminar la Fase 3.
  - Las filas demo de `revision_humana` se separan por la columna `lote`.
  - Fuente única del código en `js/`, con un ensamblador que arma el código de los nodos y una prueba de sincronía que confirma que es igual al del repositorio.
- Decisión relacionada: requisitos de la Fase 2 del registro técnico (sección 3 de la Fase 1: cola de reproceso, reintentos 429/5xx, IF de `falla_api` antes del de validez). Los cambios que toquen el contrato (por ejemplo, el estado `reproceso` o las claves nuevas de config) requieren aprobación del dueño.

### Pendiente heredado: incoherencia entre críticos y solución (pendiente de commit)
- Fecha: 24-oct-2026.
- Commit: pendiente de commit.
- Subagente: ninguno; es un pendiente registrado.
- Qué cambió: nada en el código. La incoherencia entre `critico.informacion_incorrecta` y `solucion.informacion_correcta` queda para v2, con métrica en la Fase 4.
- Decisión relacionada: backlog de v2 y de la Fase 4.

## Cómo se mantiene

- Desde la Fase 2, cada commit lleva en el mensaje la línea `Subagente: <nombre>` y la decisión relacionada.
- `documentacion` agrega la entrada a esta bitácora al cerrar cada bloque de trabajo, con el título del commit o la etiqueta (no el hash), la fecha, los subagentes, qué cambió y la decisión relacionada.
- Mientras un commit no exista, la entrada se marca "pendiente de commit" y se completa después.
- Las entradas reconstruidas de las Fases 0 y 1 no se reescriben; si se confirma una fecha aproximada, se corrige y se anota.
