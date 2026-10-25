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

Nota: las entradas de la Fase 2 no son reconstrucciones; se escriben al cerrar cada bloque de trabajo. Todas las del checkpoint comparten un solo commit, porque el trabajo de la fase se guardó junto.

### Plan aprobado y decisiones de arranque
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n" (24-oct-2026 18:35, hora de México, -0600; consultado en `.git/logs/HEAD`, convertido desde la marca de tiempo).
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

### Pendiente heredado: incoherencia entre críticos y solución
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagente: ninguno; es un pendiente registrado.
- Qué cambió: nada en el código. La incoherencia entre `critico.informacion_incorrecta` y `solucion.informacion_correcta` queda para v2, con métrica en la Fase 4.
- Decisión relacionada: backlog de v2 y de la Fase 4.

### Cambios de contrato de la Fase 2
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagente: `contrato-datos` (contrato), con aprobación del dueño de cada cambio.
- Qué cambió:
  - `contrato/config.md`: claves nuevas de generador, simulador, reintentos, reproceso y tiempos (lista completa en `docs/registro-tecnico.md`, Fase 2); precios del generador `claude-haiku-5-5` (0.10/0.50 USD por millón de tokens, verificados el 24-oct-2026); `zona_horaria`.
  - `contrato/evaluacion.schema.json`: `consumo.anomalias_llm` (`incompleta`, `refusal`, `commentary`).
  - `contrato/sheets.md`: columna `evaluaciones.anomalias_llm` (columna 30, al final) y `escenarios.semilla_sorteo` (columna 20).
  - `contrato/rubrica.md`: sección 8, solo para el sorteo de fallas del simulador (W0).
  - Estado `reproceso` y manejo de respuestas del evaluador (ver entrada de decisiones del dueño).
- Decisión relacionada: cambios de contrato aprobados por el dueño el 24-oct-2026. `reglas_ce_v1` y `evaluador_ce_v1` no cambian de versión.

### Código JS nuevo de la Fase 2
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagentes: `reglas-js` (`js/` y `js/tests/`), `evaluador-llm` (`js/validador_llm.js`, `js/construccion_prompt.js`).
- Qué cambió: según `git show --stat` del checkpoint, archivos nuevos en `js/`: `alertas.js`, `clasificacion_http.js`, `ingesta.js`, `registro_errores.js` y `simulador.js`; archivos modificados: `construccion_prompt.js`, `costo.js`, `normalizacion.js`, `scoring.js` y `validador_llm.js` (no se describe el contenido de cada cambio). Las pruebas de `js/tests/` y `workflows/tests/` suman 492 en el checkpoint.
- Decisión relacionada: fuente única del código en `js/` (decisión de arranque); el pegamento de los workflows no toma decisiones.

### generador_ce_v2
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagente: `evaluador-llm`.
- Qué cambió: nuevo `generador_ce_v2` con los marcadores `TIPIFICACION_AGENTE` y `VARIANTE_IDENTIDAD`. `generador_ce_v1` queda intacto y el evaluador sigue en `evaluador_ce_v1`. Cada escenario guarda la versión del generador; `verificarEscenarioGenerado` valida el resultado con 1 reintento.
- Decisión relacionada: versión del generador por escenario (decisión del dueño, 24-oct-2026).

### Workflows y herramientas
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagente: `workflows-n8n`.
- Qué cambió: `workflows/00_simulador.json`, `01_ingesta.json`, `02_evaluacion.json`, `03_metricas.json`, `04_reproceso.json` (nuevo) y `99_errores.json`; `herramientas/` (`construir_plantillas.mjs`, `ensamblar.mjs`, `encabezados.mjs`, `valores.ejemplo.json`); `plantillas/`, `pegamento/`, `pruebas/`, `tests/` (sincronía, secretos, estructura y simulación), `IMPORTAR.md`, `INVENTARIO_NODOS.md` y `README.md`. `workflows/_local/` queda en `.gitignore`. Incluye, aprobadas por el dueño aunque no las pidió, la pantalla "Simulación en curso" en W0 y la prueba de fórmulas en `workflows/tests/estructura.test.js`.
- Decisión relacionada: plan de la Fase 2; los workflows solo conectan `js/`, `prompts/` y `contrato/`.

### Decisiones del dueño en la Fase 2
- Fecha: 24-oct-2026.
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagente: orquestador y `documentacion` (registro); las decisiones son del dueño y sus razones van en `docs/decisiones.md`.
- Qué cambió:
  - Respuesta incompleta del evaluador: 1 reintento inmediato (`reintentos_respuesta_incompleta = 1`); si se repite, `respuesta_llm_invalida` con alerta, sin reproceso. Refusal: estado `error` con alerta, sin reproceso. Ambos se cuentan como anomalías. En la Fase 1 esos casos caían en `falla_api`.
  - Reintentos de conexión solo ante HTTP 429, 5xx y fallas de red, con espera y tope de `Retry-After`.
  - `evaluacion_tiempo_maximo_min = 90` (la regla es del dueño; el valor es supuesto).
  - `formulario_invalido` sin alerta operativa.
  - Rúbrica sección 8 solo para el sorteo de W0.
  - `claude-haiku-5-5` como generador y versión de generador por escenario.
- Decisión relacionada: las del registro técnico (Fase 2).

### Checkpoint de la Fase 2
- Fecha: 24-oct-2026 18:35 (hora de México, -0600; Git).
- Commit: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- Subagentes: `reglas-js`, `evaluador-llm`, `workflows-n8n`, `contrato-datos`, `documentacion`.
- Qué cambió: se guardó el trabajo de la Fase 2. Verificaciones reportadas por el orquestador para este checkpoint: 492 de 492 pruebas pasan, la verificación de sincronía no encontró diferencias y la búsqueda de secretos dio "no encontrado". Yo no volví a ejecutarlas.
- Estado: el checkpoint no cierra la fase. Falta la revisión del `revisor`, la importación y el guion de pruebas del dueño en su n8n, el cierre y la etiqueta `fase-2-cierre`.
- Decisión relacionada: criterio de terminado de la Fase 2 (lote `demo` más casos de prueba; `calibracion_v1` solo se ingesta como pendiente).

### Correcciones de la revisión de la Fase 2 (pendiente de commit)
- Fecha: 24-oct-2026.
- Commit: pendiente de commit.
- Subagentes: `workflows-n8n`, `contrato-datos`, `evaluador-llm`, `reglas-js`, `documentacion`, orquestador (`.gitignore`).
- Qué cambió: el `revisor` aprobó con condiciones y 0 críticos. Se corrigieron el disparador manual de calibración (M1), los conteos de `IMPORTAR.md` (m1) y la base de costo (m2); `resultados_prueba_b_lote.json` se movió a `prompts/verificacion/_privado/` (ignorada por Git; sigue en el historial anterior); los hashes de `docs/` pasaron a títulos o etiquetas; el estado de fases del README se actualizó. W3 sigue como esqueleto (M2). El mensaje de lote congelado sugiere `demo` o `calibracion_v2`. Detalle en `docs/registro-tecnico.md`, Fase 2, apartado 10.
- Decisión relacionada: backlog de la Fase 4 sobre no escribir la verdad de `calibracion_v2` en el `escenarios` visible durante la calificación a ciegas.

## Cómo se mantiene

- Desde la Fase 2, cada commit lleva en el mensaje la línea `Subagente: <nombre>` y la decisión relacionada.
- `documentacion` agrega la entrada a esta bitácora al cerrar cada bloque de trabajo, con el título del commit o la etiqueta (no el hash), la fecha, los subagentes, qué cambió y la decisión relacionada.
- Mientras un commit no exista, la entrada se marca "pendiente de commit" y se completa después. Las entradas de la Fase 2 ya apuntan al checkpoint; lo que se haga después (revisión, cierre) entra como entradas nuevas.
- Las entradas reconstruidas de las Fases 0 y 1 no se reescriben; si se confirma una fecha aproximada, se corrige y se anota.
