# Registro técnico

Este documento es el detalle técnico del proyecto, fase por fase. Para cada fase registra qué se construyó, qué decisiones técnicas se tomaron y por qué, qué alternativas se descartaron, cómo fue la revisión y qué queda pendiente.

- Lo mantiene el subagente `documentacion`. Las decisiones del dueño del proyecto viven en `docs/decisiones.md`, que escribe él; aquí solo se citan por su clave (D1 a D6).
- Los nombres de campos, hojas y valores son los de `contrato/` (fuente de verdad).
- No se reportan resultados ni métricas que no existan. No hay métricas de confiabilidad: no existe calificación humana. En la Fase 1 hubo pruebas de Node y dos corridas pequeñas del evaluador, de las que solo se publican costos y conteos agregados.
- Los valores que el dueño no decidió se marcan **SUPUESTO** en el contrato y aquí.

## Fase 0: Contrato (22-oct-2026)

### 1. Qué se construyó

Archivos de `contrato/`:

| Archivo | Propósito |
|---|---|
| `contrato/glosario.md` | Convenciones de nombres, enumeraciones, formatos de IDs, marcadores especiales (`por_verificar`, `pendiente_fase_1`, `sin_rubrica`, `no_medido`), listas (`clave_lista`), enmascaramiento y términos de scoring. |
| `contrato/rubrica.md` | Rúbrica CE (`reglas_ce_v1`): secciones y pesos, subelementos con etiqueta [JS], [LLM] o [HÍBRIDO], ID estable, clasificación, reglas de agregación, validación de identidad, errores críticos y qué recibe y devuelve el LLM. |
| `contrato/config.md` | Claves de la hoja `config` con valor por defecto, tipo, ámbito (`todos`, `ce`, `sales`) y si son supuesto. |
| `contrato/sheets.md` | Las 13 hojas del libro de Google Sheets, con columnas exactas, tipo de dato y quién escribe cada una. |
| `contrato/payload.schema.json` | Esquema JSON del payload del webhook de Ingesta. |
| `contrato/llm_output.schema.json` | Esquema JSON de la respuesta del evaluador (solo elementos semánticos), compatible con salida estructurada estricta de OpenAI. |
| `contrato/evaluacion.schema.json` | Esquema JSON del resultado final por conversación y por criterio; genérico para que sirva a Sales. |

Carpeta `contrato/ejemplos/`: contiene `payload_ejemplo.json`, `llm_output_ejemplo.json`, `evaluacion_ejemplo.json` y `evaluacion_sin_agente_ejemplo.json`. Son ficticios e ilustrativos y cumplen sus esquemas.

Conteos del contrato (verificados por el `revisor`):

- Subelementos de sección: 54 (34 JS, 15 LLM, 5 HÍBRIDO).
- Por clasificación: 19 clave (9 JS, 7 LLM, 3 HÍBRIDO), 34 complementarios y 1 informativo (`diagnostico.numero_preguntas`).
- Validación de identidad: 3 subelementos.
- Errores críticos: 12.
- Criterios por evaluación: 69 (54 + 3 + 12).
- Filas de `detalle_criterios` por evaluación: 77 (69 criterios + 8 secciones).
- Hojas: 13.
- `revision_humana`: 52 columnas, 42 de ellas de calificación humana.
- `evaluaciones`: 29 columnas.

### 2. Decisiones técnicas

Cada decisión indica el porqué. Las claves D1 a D6 corresponden a las decisiones del dueño.

**D1. Agregación de subelementos a sección.**
Cada subelemento es `clave` o `complementario`.
- Si falla un `clave`, la sección queda `no_cumple`.
- Si solo fallan `complementarios`, la sección queda `parcial`.
- Desempate: si más de 50% de los complementarios aplicables falla, la sección queda `no_cumple`. El umbral es configurable (`umbral_desempate_complementarios`, 0.5).
- La clase `informativo` queda fuera de la agregación; se calcula y se guarda como evidencia.
- Un subelemento `no_aplica` sale del cálculo.
- Por qué: refleja cómo se califica una cédula de monitoreo. Hay elementos que por sí solos hunden la sección y otros que solo la degradan. El umbral configurable permite ajustarlo sin tocar código.

**D2. `nota_base` y `nota_final`.**
- `nota_base`: nota con las secciones aplicables, sin considerar errores críticos.
- `nota_final`: la oficial; vale 0 si hay al menos un error crítico detectado.
- Por qué: guardar ambas permite calibrar por separado la nota (diferencia promedio contra la calificación humana) y los críticos (precisión y recall). Con solo la nota 0 no se podría saber cuánto se equivocó la parte de scoring.

**D3. Base de conocimiento completa en una llamada (v1).**
El evaluador recibe toda la base de conocimiento en una sola llamada. Separar clasificación y evaluación queda como hipótesis de v2, que se decidirá con el acuerdo de `recapitulacion.tipificacion` y el costo por evaluación de v1. Por qué: es lo más simple y permite medir una línea base antes de complicar el flujo.

**D4. Alertas.**
- Costo relativo: alerta si `costo_usd` supera 2× el costo estimado por evaluación (`multiplicador_alerta_costo`, `costo_estimado_por_evaluacion_usd`).
- Tope por lote: `tope_costo_lote_usd` está en `pendiente_fase_1`; se fija tras estimar costos reales.
- Calibración: alerta si el acuerdo global es menor que 80% (`umbral_acuerdo_global`, 0.80) o si la diferencia promedio de nota supera 5 puntos (`umbral_diferencia_nota`).
- Kappa de Cohen: solo informativo (`kappa_solo_informativo`).
- Por qué: un umbral relativo no requiere conocer el precio exacto de antemano, y el absoluto necesita datos reales de costo.

**D5. Renormalización cuando una sección completa es `no_aplica`.**
La nota se calcula sobre el peso de las secciones aplicables y se reescala a 100. Ejemplo de `rubrica.md`: 60.5 / 95 × 100 = 63.68. Por qué: evita penalizar al agente por una sección que no podía ejecutarse (por ejemplo, ayuda adicional cuando el cliente deja de responder).

**D6. Calificación humana.**
El dueño califica por secciones, por errores críticos, por subelementos clave y por los 3 de identidad. Las métricas de acuerdo JS vs LLM se calculan sobre los subelementos clave. Por qué: calificar los 54 subelementos por conversación sería inviable; los clave son los que determinan el resultado de la sección y los que se pueden comparar de forma directa. Eso explica las 42 columnas de calificación humana.

**Esquema de salida del LLM compatible con salida estructurada estricta de OpenAI.**
`llm_output.schema.json` sigue las restricciones documentadas en developers.openai.com/api/docs/guides/structured-outputs: raíz objeto, `additionalProperties: false`, todos los campos en `required`, opcionales como unión con `null`, sin `allOf`/`if`/`then`/`else` y profundidad máxima 10. Por qué: así el formato lo garantiza la API y JS-5 solo revisa coherencia semántica.

**Enmascaramiento antes del LLM.**
JS-2 enmascara correo, RFC, teléfono y nombre del titular (incluido el nombre de pila solo) con marcadores `[EMAIL_n]`, `[RFC_n]`, `[TELEFONO_n]` y `[NOMBRE_n]`.
- Los canales oficiales de Contamix (`canales_oficiales_correos`, `canales_oficiales_telefonos`) no se enmascaran ni activan `critico.confidencialidad`.
- Tras una validación de identidad exitosa, el agente solo puede mencionar los datos registrados enmascarados parcialmente (por ejemplo `j***@abarrotesluna.example`).
- Limitación documentada: solo se detecta el nombre del titular; otros nombres llegan sin enmascarar. El nombre de pila común puede enmascararse de más.

**`lote` como parámetro de consulta del webhook.**
`POST <url_webhook_ingesta>?lote=calibracion_v1`; el lote no va en el payload. Los lotes de calibración se guardan `pendiente` sin evaluar (`evaluar_al_ingerir_calibracion = no`) y el disparador manual de W1 crea las filas de cada nueva versión, copiando los mensajes de una fila existente. Por qué: permite reevaluar el mismo lote congelado con un prompt nuevo sin regenerar ni reenviar conversaciones, y mantiene el payload idéntico al de producción.

**`tipo_interaccion` y hojas genéricas.**
Se agregó `tipo_interaccion` (`ce` | `sales`; excepción a la convención en español, con la terminología de la vacante). Las hojas de resultados y el esquema de evaluación son genéricos. Así se agrega Sales sin cambiar el motor ni los esquemas. Versiones: `reglas_ce_v1`, `evaluador_ce_v1`. Para `sales`, `version_reglas` y `version_prompt` valen `sin_rubrica`.

**Conversación sin mensajes del agente.**
Se evalúa solo con JS, sin llamar al LLM: se activan `critico.no_toma_a_tiempo` y `critico.abandono`, `nota_final` es 0, tokens e `intentos_llm` en 0, `costo_usd` 0, y se marca `sin_mensajes_agente`. Cuenta en las métricas. Por qué: es un caso real de fallo del agente y gastar una llamada al LLM no aporta nada.

**Inactividad del cliente vs abandono del agente.**
- Inactividad del cliente: sin error; `recapitulacion.recapitula`, `recapitulacion.uso_solucion_seguimiento` y toda la sección `ayuda_adicional` pasan a `no_aplica` (los impone JS mediante `termina_por_inactividad`).
- Abandono del agente: error crítico `critico.abandono`.
- Excepción: si el agente ya se despidió o cerró por inactividad antes del último mensaje del cliente, no hay abandono.

**Datos ficticios.**
Marca ficticia Contamix; dominios `.example` (RFC 2606); teléfonos ficticios. Los valores no decididos por el dueño llevan la marca SUPUESTO. Precios y modelos están en `por_verificar`; no se inventan.

### 3. Alternativas descartadas

- **Agregación por proporción pura o por conteo de fallas:** no distingue entre un elemento esencial y uno accesorio; una sola omisión grave podría quedar diluida.
- **Nota 0 por error crítico sin guardar `nota_base`:** impide calibrar la nota separada de los críticos.
- **Filtrar la base de conocimiento por la tipificación del agente:** la tipificación es justo lo que se evalúa (`recapitulacion.tipificacion`); filtrarla por lo que eligió el agente contaminaría el juicio.
- **Dos llamadas al LLM en v1 (clasificar y luego evaluar):** más costo y complejidad sin una línea base. Queda como hipótesis de v2.
- **Kappa como alerta:** es inestable con 24 conversaciones; se reporta solo como información.
- **Dejar al LLM condiciones calculables** (inactividad, `no_aplica` de recapitulación): contradice el principio del proyecto; lo verificable con timestamps y reglas se calcula en JS.
- **Excluir de las métricas la conversación sin agente:** ocultaría un caso que el sistema sí debe detectar.
- **Columnas por sección en `evaluaciones`:** ligaban la hoja a la rúbrica CE; el detalle por sección vive en `detalle_criterios`.

### 4. Proceso y rondas del revisor

El subagente `revisor` verificó el contrato contra `CLAUDE.md` en tres rondas.

**Ronda 1.** Sin críticos; 7 importantes y 12 menores.
- Importantes: definición de buena, regular y mala; silencio del cliente ambiguo; identidad (nombre del titular y `datos_coinciden` sin decidir); `no_aplica` de recapitulación en manos del LLM; contradicciones de costo y `no_medido`; falta de un mecanismo para ingresar y reevaluar lotes de calibración; un dato que pedía al LLM algo inexistente en `numero_preguntas`.
- Se corrigieron todos los hallazgos salvo M6 y M11, que pasaron a verificación de Fase 1.
- En la misma ronda el dueño agregó `tipo_interaccion` y la asociación de rúbricas por tipo.

**Ronda 2.** Sin críticos; 3 importantes y 6 menores.
- Importantes: columna `calidad` ausente del esquema de evaluación; la regla de silencio contradecía la tabla de casos de inactividad; detección incompleta del enmascarado parcial.
- Menores: carga por tipo unida a `todos`, esquema de evaluación genérico para Sales, limitación de `sales` antes de la Fase 5b, datos de identidad dados antes de la solicitud, nombres de archivos de prompts con versión por tipo, y mensajes a citar en un `no_cumple` por omisión.
- Todos se corrigieron; el último (N9) pasó a Fase 1.
- El dueño cambió la conversación sin agente para evaluarla solo con JS.

**Ronda 3.** Aprobado, sin críticos ni importantes. Tres menores corregidos: respuesta tardía tras recordatorio, `nota_base` no interpretable sin agente, referencias cruzadas a la sección 3.12 de `rubrica.md`.

**Antes del commit.** `CLAUDE.md` se aligeró con referencias a `contrato/`; el payload de ejemplo se movió a `contrato/ejemplos/`; los subagentes `documentacion`, `revisor` y `metricas-bi` usan `model: sonnet`.

### 5. Estado actual y pendientes para la Fase 1

Estado: contrato aprobado por el dueño y revisado por `revisor` (ronda 3). No hay código, datos de referencia, lote ni métricas todavía. Todas las métricas están pendientes.

Pendientes (documentados también en `contrato/config.md`, sección 13):

1. Verificar con una llamada real que OpenAI acepte `minimum` en campos que pueden ser `null` (`primer_mensaje_info_cuenta.mensaje_n`); si no, quitarlo del esquema y validarlo en JS-5.
2. Verificar precios y modelos (hoy `por_verificar`) y estimar el costo por evaluación y el tope por lote (hoy `pendiente_fase_1`). No se ejecuta un lote `calibracion_vN` mientras los precios del evaluador sigan en `por_verificar`.
3. M6: verificar que OpenAI acepte `$schema`, `title` y `minItems` en el esquema enviado, o que JS-4 los quite.
4. M11: `payload.schema.json` usa `propertyNames` e if/then/else (válidos en draft 2020-12) y no sirve tal cual para salida estructurada del generador; se necesita un esquema simplificado o validar después con JS.
5. N9: el prompt del evaluador debe indicar qué mensajes citar en un `no_cumple` por omisión, para cumplir la regla 9 de JS-5 (`rubrica.md` 6.1).
6. Mover la carpeta del proyecto fuera de OneDrive: la sincronización puede bloquear o duplicar archivos durante el trabajo con Node y git.

### 6. Cómo arrancar la Fase 1 en una sesión nueva

1. Abrir Claude Code en la carpeta del proyecto (ya fuera de OneDrive).
2. Pedir al orquestador que lea `CLAUDE.md`, `contrato/` y esta entrada del registro técnico.
3. Pedirle que presente en modo plan la Fase 1, con `contrato-datos`, `reglas-js`, `evaluador-llm` y `documentacion` en paralelo, e incluyendo los pendientes de la sección 5.
4. Recordar que el contrato solo cambia con aprobación del dueño.

## Fase 1: Construcción en paralelo (23-oct-2026, en curso; la prueba B y los costos provisionales son del 23-oct hora local de México, 24-oct en UTC)

Estado: el código JS, los prompts y las pruebas existen; los workflows (Fase 2) y la calificación humana (Fase 3) no. Este apartado solo registra hechos. Lo que no se pudo confirmar se marca como **SUPUESTO** o "pendiente".

### 1. Cambios dentro de v1 (antes de congelar)

`reglas_ce_v1`, `evaluador_ce_v1` y `generador_ce_v1` no subieron de versión porque todavía no se había guardado ninguna evaluación. Por requisito del dueño, las tres versiones se congelan al cerrar la Fase 1. A partir de ahí, cualquier cambio de reglas o de prompt sube la versión.

**Validación de identidad**
- Se unificó el umbral en `identidad_min_datos_correctos = 2`. Se eliminaron `identidad_min_datos_solicitados` e `identidad_umbral_datos_incorrectos`.
- `datos_coinciden` pasa a `no_cumple` si el agente no declina cuando los datos no coinciden. No se activa crítico si no reveló información de la cuenta.
- La tabla de la sección 4 de `contrato/rubrica.md` suma 4 casos nuevos.
- `pide_datos_identidad` excluye los datos de terceros.

**"Sigue pidiendo datos"**
- La solicitud del agente debe ser posterior al último mensaje del cliente que aporta datos de identidad.
- Si el cliente abandona, se marca `cumple` (no es falla del agente).
- Si el agente cierra sin declinar, es `no_cumple` sin crítico.

**Definición de "mensaje del cliente que aporta datos"**
- Cuenta un correo, RFC, teléfono o nombre del titular, correcto o incorrecto.
- No cuentan: RFC genéricos, RFC del receptor o de terceros, canales oficiales ni un nombre de pila solo.

**Listas nuevas en `datos/listas.csv`**
- `pide_numero_caso`: exige verbo de solicitud. Acepta formas elípticas ("numero de caso, por favor", "¿numero de caso?"). "Folio" solo cuenta junto a caso, ticket o reporte; "folio fiscal" y "folio de la factura" no cuentan. Pedir número de caso cuenta como "sigue pidiendo", pero no como `pide_datos` ni para el mínimo.
- `dato_de_tercero`: solo afecta la identidad, no la confidencialidad. Nunca aplica a un dato que coincide con la cuenta. "Emito/expido" solo cuenta cuando el dato es de un destinatario.
- Además: `rfc_genericos_permitidos`; los minutos no cuentan como plazo; `numero_en_palabras` se lee de listas y se valida al cargar.

**Información de la cuenta**
- El número de caso de la conversación actual no es información de la cuenta. El contenido de casos anteriores sí lo es.
- Se aplicó en `rubrica.md` y `glosario.md`. En `llm_output.schema.json` el cambio es solo en `description`, sin cambiar la estructura.

**Configuración del evaluador tras la prueba A**
- Modelo `gpt-6-luna`, sin `temperature`, `llm_esfuerzo_razonamiento = none`, `claves_esquema_excluidas_evaluador` vacía.
- Precios 0.10 y 0.50 USD por millón de tokens (entrada y salida). `max_tokens_generador = 8000`.
- `costo_estimado_por_evaluacion_usd = 0.005` y `tope_costo_lote_usd = 0.25`. Ambos son **PROVISIONALES** y se recalcularán en la Fase 4 con las 24 conversaciones.
- Verificado: `config.md` y `datos/config.csv` coinciden (`costo_estimado_por_evaluacion_usd` = 0.005, `tope_costo_lote_usd` = 0.25, PROVISIONALES).

**Prompts**
- Evaluador: sección 11 (número de caso y casos anteriores) y sección 13 (RFC genéricos).
- Generador: regla de identidad nueva, plazos y `max_tokens` leído de config.

**JS-4 y JS-5**
- JS-4 lee `llm_esfuerzo_razonamiento` y `claves_esquema_excluidas_evaluador` de config.
- JS-5, `extraerTextoSalida`, elige el bloque por tipo (`phase = final_answer`) y no por posición.
- Un bloque `commentary` se ignora como anomalía, sin reintento.
- Una salida ambigua (varios `final_answer`, ninguno, varios bloques sin fase o varias partes) se trata como falla de API (`tipo_error = fallo_api`), sin reintento y sin pasar por JS-5.
- El diagnóstico de la causa raíz se hizo sin guardar el contenido de las respuestas.

**Silencio final: alcance del SUPUESTO (aclaración de redacción, posterior al commit "Fase 1: construcción en paralelo (código JS, prompts v1, prueba B)")**
- En `contrato/rubrica.md` sección 3.10, la marca SUPUESTO del párrafo del silencio final cubre solo la viñeta de `recapitulacion.cierre_inactividad`; el texto queda "(SUPUESTO: solo esta viñeta)".
- `cierre.despedida` = `no_cumple` no es supuesto: sale directo de su propia regla ("`no_aplica` cuando: Nunca").
- El dueño confirmó la lectura actual: recordatorio sin cierre = `no_cumple`.
- Cambio solo de redacción, autorizado por el dueño dentro de v1: no cambia código, pruebas ni notas.

**Metadatos: hashes tras reescribir el historial (cambio de metadatos dentro de v1)**
- El historial se reescribió antes del primer push para usar el correo noreply de GitHub como autor; el contenido de los archivos no cambió, pero sí los hashes.
- Se actualizaron las referencias: este registro (cierre de Fase 1: etiqueta `fase-1-cierre`) y la fila "Revisión" del encabezado de `prompts/evaluador_ce_v1.md` y `prompts/generador_ce_v1.md` (checkpoint: commit "Fase 1 (checkpoint): contrato y datos actualizados").
- El encabezado de los prompts no se envía al modelo: JS-4 solo envía lo que está entre los marcadores `INICIO_`/`FIN_` y de la primera línea solo lee el nombre de la versión. Por eso no cambia la versión ni el comportamiento.
- Etiquetas de cierre: `fase-0-cierre` y `fase-1-cierre`. Desde ahora, los documentos citan etiquetas en vez de hashes.

Por qué: se prefirió corregir ahora, con v1 sin resultados guardados, a subir versión sin motivo. Alternativa descartada: crear `_v2` de reglas o prompt antes de tener métricas, lo que habría mezclado cambios de diseño con cambios motivados por fallas medidas.

### 2. Prueba B (solo agregados)

Se corrió el evaluador con salida estructurada `json_schema` estricta. Por regla del dueño no se reportan resultados por conversación ni cifras de concordancia con el lote mientras él no termine la calificación a ciegas.

| Corrida | Resultado |
|---|---|
| 1. Lote, 2 conversaciones | 2/2 válidas, 4 intentos, 2 rechazos de JS-5 en la raíz. 60,634 tokens de entrada y 8,118 de salida. 0.010122 USD. Reportado por el orquestador; sin archivo de respaldo en el repositorio (los resultados se sobrescribían). |
| Diagnóstico con `payload_ejemplo` | La API devolvió 2 mensajes (`phase = commentary` y `final_answer`) y el código los concatenaba. 2 intentos, 35,089 tokens de entrada y 8,802 de salida. 0.00791 USD. |
| 2. Tras el arreglo, lote, 2 conversaciones | 2/2 válidas, 2 intentos, 0 rechazos, 0 anomalías. 27,731 tokens de entrada y 2,679 de salida. 0.004113 USD en total, 0.002056 por evaluación. |

- Causa de los rechazos de la corrida 1: el código concatenaba el bloque `commentary` con el `final_answer`, y el texto resultante no era un JSON válido. El arreglo es el descrito en `extraerTextoSalida`.
- Concordancia: el orquestador la revisó y no encontró una falla grave. Reportado por el orquestador; sin archivo de respaldo en el repositorio (los resultados se sobrescribían). Las cifras no se publican hasta que el dueño termine su calificación.
- Respaldo: la corrida 1 y la revisión de concordancia no tienen archivo. Las otras dos corridas están en `prompts/verificacion/resultados_prueba_b.json` y `prompts/verificacion/resultados_prueba_b_lote.json`.
- Limitación: son 2 conversaciones, por lo que el costo por evaluación es una observación puntual y no un promedio.

### 3. Requisitos para la Fase 2 (aprobados por el dueño)

- Las conversaciones con `fallo_api` van a una cola de reproceso, para que ninguna se pierda.
- Los errores HTTP transitorios (429 y 5xx) sí se reintentan, con espera.
- En W2, un IF sobre falla de API va antes del IF de validez.
- El diseño concreto de la cola queda **pendiente de la Fase 2**. Si requiere cambiar el contrato, se pedirá aprobación al dueño.

### 4. Backlog para v2 (no implementado)

- Línea de prompt contra el `commentary` (primer candidato).
- Probar `text.verbosity = low` con una prueba tipo A.
- Probar `phase` en el reintento.
- Que el LLM juzgue de quién es un RFC, con evidencia.
- Medir los "críticos solo-LLM", sobre todo `critico.confidencialidad`.
- D3: separar la clasificación de tema de la evaluación.
- Indulgencia del evaluador en `diagnostico.preguntas_necesarias` (hallazgo del dueño, 31-oct-2026, conversación demo CONV-0129, tipificación "Cambio de correo del titular", artículo KB-07). El agente nunca pidió el correo nuevo, que KB-07 exige para registrar la solicitud y escalarla al área de Cuentas (en el catálogo, `campos_obligatorios` = `correo_nuevo`; por eso JS marcó `solucion.campos_obligatorios` = `no_cumple` con `correo_nuevo` ausente). Además, en el mensaje 2 el agente preguntó qué necesitaba el cliente, que ya lo había dicho en el mensaje 1. Aun así el evaluador marcó `preguntas_necesarias` = `cumple`, mirando solo los datos de identidad. Para v2: el prompt debe exigir que `preguntas_necesarias` revise los datos que el artículo necesita para resolver (no solo la validación de identidad), y que una pregunta por algo que el cliente ya dijo no cuente como pregunta necesaria. Medir en la Fase 4 contra la calificación humana.
- **Backlog de reglas (`reglas_ce_v2`, Fase 4), distinto del backlog del evaluador de arriba.** Revisé esta sección y la 9: no había otra entrada de backlog de reglas o rúbrica v2 (solo la incoherencia entre `critico.informacion_incorrecta` y `solucion.informacion_correcta`, en el apartado 9 de la Fase 2). Esta es la primera. Decisión del dueño, 1-nov-2026; `reglas_ce_v1` está congelado, por eso no se aplica ahora.
  - `apertura.ofrece_ayuda`: si el cliente ya planteó su solicitud (en su primer mensaje), el criterio se cumple CONFIRMÁNDOLA. Volver a preguntar "¿en qué te puedo ayudar?" no debe premiarse (`no_cumple`).
  - Propuesta técnica: el criterio pasa a HÍBRIDO, usando la identificación de solicitudes del LLM (`solicitudes_cliente[].mensaje_n`) y una lista `confirma_solicitud` separada de `ofrece_ayuda`.
  - Decisión: la pregunta repetida cuenta SOLO en `apertura.ofrece_ayuda` (sin doble castigo). `diagnostico.preguntas_necesarias` se limita a las preguntas que exige el artículo de la base de conocimiento (por ejemplo, KB-07 exige capturar el correo nuevo). Esto es el lado de reglas de la indulgencia descrita en la entrada anterior: allí se pedía que "una pregunta por algo ya dicho no cuente como necesaria"; con esta decisión esa pregunta se penaliza en `apertura.ofrece_ayuda` y no en `preguntas_necesarias`.
  - Origen: CONV-0129 (caso 9), el agente preguntó qué necesitaba el cliente cuando ya lo había dicho en el mensaje [1].

- **Entradas derivadas de la prueba de cierre (1-nov-2026; ver Fase 2, apartado 14).**
  1. Evaluador v2, PATRÓN (agrupa aquí la entrada de indulgencia en `preguntas_necesarias` de CONV-0129): el evaluador marca `no_aplica` o `cumple` cuando la consulta del cliente se respondió, aunque falte una acción esperada por el artículo. Casos: CONV-0129 `preguntas_necesarias` (cumple), CONV-0131 `ofrece_alternativas` (no_aplica), CONV-0132 `informacion_completa` (cumple, sin el plazo de KB-03), CONV-0133 `preguntas_necesarias` (no_aplica). Medirlo en la Fase 4 contra la calificación humana.
  2. Doble penalización: en CONV-0131 un solo error (webinar) bajó `solucion.informacion_correcta` y `comunicacion.congruencia`; congruencia costó 6.5 puntos (52.5 vs 59; aun sin ella la nota seguía en mala porque `informacion_correcta` es clave en Solución, peso 35). Relacionar con la entrada de `reglas_ce_v2` sobre doble castigo (`ofrece_ayuda` / `preguntas_necesarias`): definir en la rúbrica v2 qué criterio se lleva cada tipo de error.
  3. Base de conocimiento: KB-08 es ambigua sobre si el webinar aplica con pago mensual. Aclararla en una versión nueva de la base (cuidado: `calibracion_v1` está congelado y se evalúa con la base vigente; decisión del dueño).
  4. Simulador: mejorar la fidelidad de extremo a extremo antes de usarlo para `calibracion_v2` (meta y método a definir en la Fase 4; incluir la verificación contra la nota esperada).
  5. `reglas_ce_v2`: la evidencia de las reglas de lista prohibida reporta solo el primer término por mensaje (CONV-0132: "Okey" no aparece en la evidencia); reportar todos.
  6. 99 Errores sin camino de alerta cuando Google no responde: ya anotado en el apartado 13.5 de la Fase 2; no se duplica.

### 4b. Backlog para la Fase 4 (métricas)

- Medir cuántas conversaciones fallan a la vez `cierre.despedida` y `recapitulacion.cierre_inactividad` por la misma omisión (recordatorio sin cierre al final) y comparar con la calificación humana del dueño, para decidir si esa doble penalización se mantiene.

### 5. Pruebas

`node --test js/tests/*.test.js` : 241 tests, 241 pasan, 0 fallan. Verificado por el orquestador el 23-oct-2026; yo no lo volví a ejecutar.

### 6. Pendiente de la Fase 1

- Revisión del `revisor` y commit al cierre.
- Todas las métricas de confiabilidad siguen pendientes: no hay calificación humana.

## Fase 2: Workflows de n8n (24-oct-2026, en curso)

Commit de referencia: "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n" (24-oct-2026). Verificaciones reportadas por el orquestador en ese checkpoint: 492 de 492 pruebas pasan, sincronía sin diferencias y secretos "no encontrado". Yo no las volví a ejecutar. Del lote `calibracion_v1` solo se citan totales; no hay métricas de confiabilidad (no existe calificación humana).

### 1. Arquitectura

- Workflows (en `workflows/`):
  - W0 `00_simulador`: formulario, sorteo de escenario en JS, generación con Claude, verificación, escritura en `escenarios` y `revision_humana`, envío a Ingesta.
  - W1 `01_ingesta`: webhook, validación, deduplicación, guardado como pendiente y llamada a W2 (con el disparador manual de lotes de calibración).
  - W2 `02_evaluacion`: normalización, enmascaramiento, reglas, OpenAI, validación, scoring, costo, escritura y alertas.
  - W3 `03_metricas`: métricas de calibración.
  - W4 `04_reproceso` (nuevo): reenvía a W2 las conversaciones en `reproceso` y las atascadas en `en_evaluacion`.
  - 99 Errores: Error Trigger que registra en `log_errores` y alerta.
- Fuente única en `js/`: los nodos Code son copia literal de archivos de `js/`. `workflows/herramientas/ensamblar.mjs` arma cada workflow desde `plantillas/` (nodos con marcadores `// FUENTE: js/<archivo>.js`), los archivos de `js/`, el pegamento (`workflows/pegamento/`, máximo 15 líneas efectivas y sin decisiones) y los prompts. Las decisiones de los IF y Switch leen campos que calculó `js/`.
- Pruebas de `workflows/tests/`: sincronía (cada nodo es copia exacta del repo), secretos (sin claves ni IDs reales), estructura (tipos y versiones del inventario de n8n 2.32.6) y simulación (ejecuta los nodos Code con un `$` simulado).
- Marcadores de credenciales: los JSON de `workflows/` llevan marcadores (`<ASIGNAR_EN_N8N>`, `<ID_LIBRO_SHEETS>`, `<URL_WEBHOOK_INGESTA>`, `<ID_WORKFLOW_EVALUACION>`, `<ID_WORKFLOW_ERRORES>`). `ensamblar.mjs --local` escribe copias con los valores del dueño en `workflows/_local/`, que está en `.gitignore`. Alternativa descartada: reemplazar los marcadores a mano, por el riesgo de subir valores reales o de olvidar uno.

### 2. Cambio de JS-5 respecto de la Fase 1 (decisión del dueño)

- Respuesta incompleta del evaluador (por ejemplo, cortada por `max_output_tokens`): 1 reintento inmediato con la misma petición (`reintentos_respuesta_incompleta = 1`, contador propio que no consume `reintentos_validacion_llm`). Si se repite: `tipo_error = respuesta_llm_invalida` con alerta operativa, sin reproceso.
- Refusal del modelo: estado `error` con alerta operativa para revisión manual, sin reproceso (`respuesta_llm_invalida`, causa `refusal`).
- Ambos casos se cuentan como anomalías.
- Antes (Fase 1): esos casos caían en `falla_api`. Ahora `falla_api` y la cola de reproceso quedan para salida ambigua, cuerpo inválido y fallas HTTP.
- Razones del dueño:
  - Respuesta incompleta: un solo reintento inmediato "porque el commentary es intermitente (en la Fase 1 el segundo intento salió sin él)".
  - Refusal: error con alerta para revisión manual, sin cola de reproceso, "porque reenviar la misma entrada probablemente da la misma negativa".
  - Ambos casos se cuentan en totales como anomalías para la métrica de v2.

### 3. Cambios de esquema de la Fase 2

- `evaluacion.schema.json`: `consumo.anomalias_llm`, con valores `incompleta`, `refusal` y `commentary`.
- `sheets.md`: `evaluaciones.anomalias_llm` (columna 30, al final), derivada de ese campo; una prueba comprueba que coinciden. `escenarios.semilla_sorteo` (columna 20).
- Una sola fuente por dato: la columna se deriva del campo del esquema y no se calcula por separado.

### 4. generador_ce_v2

- Agrega los marcadores `TIPIFICACION_AGENTE` (tipificación errónea sorteada) y `VARIANTE_IDENTIDAD` (variante sin crítico de `identidad.datos_coinciden`).
- `generador_ce_v1` queda intacto. El evaluador sigue en `evaluador_ce_v1`.
- Cada escenario guarda la versión del generador (`escenarios.version_prompt_generador`); `calibracion_v1` no salió del simulador (`no_aplica`).
- `verificarEscenarioGenerado` comprueba la conversación generada contra el escenario, con 1 reintento (`reintentos_generacion`).
- Alternativa descartada: editar v1. Rompería la trazabilidad de qué prompt produjo cada escenario.

### 5. Modelo generador, precios y claves nuevas de config

- Modelo generador: `claude-haiku-5-5`; precios 0.10 (entrada) y 0.50 (salida) USD por millón de tokens, verificados el 24-oct-2026 en la documentación oficial de Anthropic (models overview y pricing), tramo de prompts de hasta 100,000 tokens. Proveedor distinto al del evaluador.
- Claves nuevas o cambiadas en `contrato/config.md` y su valor por defecto:
  - Generador y simulador: `version_prompt_generador` = `generador_ce_v2`; `esfuerzo_generador` = `medium` (supuesto); `generador_fallas_regular` = 2 y `generador_fallas_mala` = 2 (supuestos); `max_tokens_generador` = 8000; `anthropic_version_api` = `2026-10-21`; `horario_atencion_chat` (igual a KB-08); `simulador_dias_atras` = 30; `simulador_max_conversaciones` = 5; `zona_horaria` = `America/Mexico_City`.
  - Modelos y precios: `modelo_generador`, `precio_entrada_usd_millon_generador` = 0.10, `precio_salida_usd_millon_generador` = 0.50; `max_tokens_evaluador` = 8000.
  - Reintentos y tiempos: `reintentos_respuesta_incompleta` = 1; `reproceso_max_intentos` = 3; `reproceso_intervalo_min` = 30; `espera_maxima_reintento_ms` = 60000; `tiempo_maximo_peticion_llm_ms` = 180000; `evaluacion_tiempo_maximo_min` = 90.
  - Alertas: `alerta_tipo_interaccion_sin_rubrica` = `no`.
- Los valores marcados supuesto en `config.md` son editables y deben revisarse con el lote `demo`.

### 6. Reproceso, atascadas y reintentos

- Reproceso (W4): programado cada 30 minutos y manual. Reenvía a W2 hasta `reproceso_max_intentos`; después pasa a `error` con alerta operativa. Nunca borra filas. W2 revisa `falla_api` antes que `valido`.
- Atascadas: una conversación en `en_evaluacion` con `actualizado_en` más viejo que `evaluacion_tiempo_maximo_min` (90) se pasa a `reproceso`. Cálculo del peor caso de W2: 4 llamadas LLM (1 + 1 incompleta + 2 validación) x (4 x 180 s + 3 x 60 s = 900 s) = 3600 s = 60 min; 90 min deja 50 % de margen. Una prueba de `reglas-js` lo comprueba con los valores de `config`.
- Escritura idempotente (W2): antes de escribir se leen las filas existentes de esa `llave_dedup` en `evaluaciones` y de ese `id_evaluacion` en `detalle_criterios`, y `planificarEscrituraResultados` devuelve solo las que faltan. Así un reenvío no duplica filas.
- 429 y 5xx: se reintentan con un Wait (`espera_entre_reintentos_ms`), respetando `Retry-After` con tope `espera_maxima_reintento_ms`. Si pide más, no se espera y la conversación va a reproceso como `fallo_api`. Otro 4xx no se reintenta. Los nodos de OpenAI y Claude no usan el reintento nativo: lo decide `clasificacion_http.js`.
- `formulario_invalido` (W0): no envía alerta operativa y el mensaje en pantalla dice qué corregir. Una captura incorrecta del dueño no es una falla del sistema.
- Rúbrica sección 8 (`contrato/rubrica.md`): solo la usa el sorteo de W0 para decidir qué fallas pedir al generador. No la leen JS-6 ni JS-7, por lo que no cambia la evaluación. Excepción: `identidad.datos_coinciden` en conversaciones regulares, tratado con la variante `VARIANTE_IDENTIDAD`.

### 7. Aprobados por el dueño aunque no los pidió

- Pantalla "Simulación en curso" en W0 (el formulario no queda en blanco mientras se genera).
- Prueba de fórmulas en `workflows/tests/estructura.test.js`.

### 8. Limitaciones y riesgos (de `workflows/IMPORTAR.md`, sección 6)

- 99 Errores casi nunca identifica la conversación: el Error Trigger de n8n 2.32.6 no trae datos de ejecución (solo ids, error, último nodo y modo). Solo pasa la conversación a `reproceso` si la `llave_dedup` aparece en el mensaje de error. La red de seguridad es W4 con las atascadas.
- Schedule de W4 fijo en 30 minutos: un Schedule Trigger no puede leer la hoja; si cambia `reproceso_intervalo_min`, hay que cambiar también el nodo.
- Cuota de Google Sheets: cada evaluación lee 8 hojas o filtros y escribe de 4 a 6 veces. En `demo` no es problema; en un lote de 24 podría acercarse al límite por minuto (SUPUESTO, aún no medido). Mitigación posible en la Fase 4.
- El mock del evaluador exige cambiar a mano la URL del nodo de OpenAI en W2 (pruebas 8, 12 y 13) y restaurarla; ese cambio no se exporta.
- Plantilla del evaluador fija en v1: para evaluar con v2 hay que cambiar la ruta en `construir_plantillas.mjs`, reensamblar y reimportar, además de `config.version_prompt`.
- Costo de generación solo del último intento: el intento descartado no se suma.
- Reproducir un escenario exige el mismo "ahora": `semilla_sorteo` repite calidad, tema, cuenta y fallas, pero la fecha depende de la hora de envío.
- Supuestos de nombres en el Form Trigger y en Set: se confirman al importar.
- W4 reenvía dos grupos por separado (reproceso y atascadas); el cierre del lote puede salir en dos mensajes.
- Los datos son sintéticos.

### 9. Pendientes

- Heredado: la incoherencia entre `critico.informacion_incorrecta` y `solucion.informacion_correcta` queda para v2, con métrica en la Fase 4.
- Backlog de la Fase 4 (decisión del dueño): si W0 genera `calibracion_v2`, su verdad de escenario no debe escribirse en la hoja `escenarios` visible mientras el dueño la califica a ciegas. Hoy W0 escribe `escenarios` para cualquier lote aceptado.
- Mensaje de lote congelado (resuelto): se queda sugiriendo `demo` o `calibracion_v2`. W0 solo rechaza `calibracion_v1`, y una prueba comprueba que el lote sugerido se acepta.

### 10. Hallazgos del revisor y su resolución

Veredicto: aprobado con condiciones, 0 críticos.
- M1: el disparador manual de calibración estaba desactivado y con lote vacío. Corregido.
- M2: W3 es un esqueleto y no escribe en `metricas`. Queda así; las métricas son de la Fase 4.
- m1: conteos en `IMPORTAR.md`. Corregidos.
- m2: la base de costo se corrigió a "3 evaluaciones en 2 corridas".
- m4: `prompts/verificacion/resultados_prueba_b_lote.json` se movió a `prompts/verificacion/_privado/` (ignorada por Git, sin borrarlo) porque contiene la comparación de 2 conversaciones de `calibracion_v1` contra la verdad del escenario. Se restaura al repositorio al cerrar la Fase 3. Sigue en el historial de Git de commits anteriores: no se reescribió el historial.
- m5: hashes reemplazados por títulos de commit o etiquetas.
- m6: documentado como riesgo, con recuperación desde el historial de ejecuciones de n8n.

### 11. Estado de la Fase 2 (actualizado el 1-nov-2026)

Commits de la fase, por título (los de la Fase 2 en orden):
- "Fase 2 (checkpoint): contrato, código JS, prompts y workflows de n8n".
- "Fase 2: correcciones de la revisión del revisor" (resuelve los hallazgos del apartado 10).
- "Fase 2: verificación sin concordancia en consola por defecto".
- "Fase 2: correcciones tras la importación en n8n 2.32.6".
- "Fase 2: correcciones de los casos de prueba 6 a 13".
- "Fase 2: generador_ce_v3, sorteo con criterios aplicables y W4 recoge pendientes".
- "Fase 2: rubrica §8 formaliza los pares que se anulan y la aplicabilidad".
- "Fase 2: el generador no reintenta si se corta por max_tokens" (apartado 12.5).
- "Fase 2: nota esperada en el sorteo, generador_ce_v4 y max_tokens 16000" (apartado 13).

Qué cubren los cuatro últimos commits (según sus títulos y los apartados 12 y 13; no pude leer `git log --stat` ni los cuerpos de los mensajes porque no tengo acceso a una terminal, así que no listo archivos por commit):
- Casos de prueba 6 a 13: correcciones surgidas de las pruebas del dueño en su n8n.
- `generador_ce_v3`, sorteo con criterios aplicables y W4 que recoge pendientes (W4 ya reenvía también las conversaciones pendientes, no solo `reproceso` y atascadas).
- Rúbrica sección 8: formaliza los pares de criterios que se anulan entre sí y la aplicabilidad (insumo del apartado 13).
- Generador sin reintento ante `max_tokens`: apartado 12.5.

Hecho el 1-nov-2026: prueba de cierre (apartado 14). Criterio del dueño (3 regulares, al menos 2): resultado 0 de 3. El dueño decidió cerrar la fase porque los casos de `IMPORTAR.md` pasaron y registrar la fidelidad del simulador como limitación.

Falta para cerrar la fase:
- Revisión final del `revisor`.
- Resumen para el dueño y su explicación de la fase.
- Etiqueta `fase-2-cierre` y push.

### 12. Generador v3, primera prueba (caso 9) y cambio del reintento (30 y 31-oct-2026)

Esta sección sigue abierta: la medición de la opción A (apartado 12.4) está pendiente. Los datos de consumo salen de las ejecuciones de n8n del dueño (solo campos de consumo); yo no las volví a consultar. Los cambios de este apartado quedaron guardados en los commits "Fase 2: generador_ce_v3, sorteo con criterios aplicables y W4 recoge pendientes" y "Fase 2: el generador no reintenta si se corta por max_tokens". La medición de la opción A se resolvió después: ver el apartado 13.4.

#### 12.1 Qué pasó con `generador_ce_v3` (caso 9, 30-oct-2026)

- Tres envíos con `generador_ce_v3` terminaron en `generacion_invalida` con el mensaje "lectura incompleta (max_tokens)" en los dos intentos de cada envío.
- Datos medidos en los 6 intentos:
  - `stop_reason` = `max_tokens` y `output_tokens` = 8000 en todos.
  - Tokens de razonamiento: 7200, 8000, 6006, 8000, 8000 y 8000.
  - Entrada: aproximadamente 20,400 tokens.
  - Velocidad: aproximadamente 220 tokens por segundo, es decir, unos 35 s por intento de 8000 tokens. Está lejos del límite de 180 s (`tiempo_maximo_peticion_llm_ms`), así que el corte no fue por tiempo.
- Referencia con `generador_ce_v2` en corridas que sí terminaron: razonamiento de 2,700 a 4,300 tokens y salida total de 4,100 a 6,400.
- Causa: con `esfuerzo_generador` = `medium`, el razonamiento se cobra como salida y cuenta dentro del tope `max_tokens_generador` = 8000. v3 agrega una verificación final y una guía de fallas, y eso hace pensar casi el doble que v2. El razonamiento consumió el presupuesto antes de que el modelo terminara de escribir la conversación.

#### 12.2 Error de estimación del orquestador

- Entrada de v3: se estimó en 13,100 a 14,100 tokens (con un factor de 2.47 tokens por palabra) y lo real fue de aproximadamente 20,400. Entrada de v2: se estimó en 11,300 y lo real fue de aproximadamente 17,900. El factor real es cerca de 1.6 veces mayor que el supuesto.
- Consecuencia en costo: el costo por intento estimado (0.0022 a 0.0040 USD) quedó bajo. Un intento cortado costó aproximadamente 0.0060 USD (0.0020 de entrada y 0.0040 de salida). Las 6 llamadas cortadas costaron aproximadamente 0.036 USD.
- Lección: la estimación de tokens por palabras no sirve para este prompt; hay que usar el consumo medido en n8n.

#### 12.3 Gasto acumulado de la sesión de pruebas de la Fase 2 (hasta el 30-oct-2026)

Calculado desde las ejecuciones de n8n del 28 al 30 de octubre:

| Concepto | Llamadas | Costo (USD) |
|---|---|---|
| Generador | 10 (6 cortadas) | 0.0545 |
| Evaluador | 11 evaluaciones | 0.0182 |
| Total | | 0.0727 |

- No incluye los scripts de la Fase 1.
- Las filas de la hoja `escenarios` no suman los intentos fallidos (ya se sabía: el costo de generación guarda solo el último intento, apartado 8), por eso esta cuenta sale de n8n y no de la hoja.
- Decisión del dueño: aceptó superar el tope de 0.10 USD hasta 0.15 USD para terminar el caso 9.

#### 12.4 Decisión del dueño (31-oct-2026): opción A

- Arrancar con la opción A: `max_tokens_generador` = 16000 con `esfuerzo_generador` = `medium`. Se mide con 1 envío regular que pida `diagnostico.preguntas_necesarias` y `comunicacion.redaccion`, antes de los 3 regulares del caso 9.
- Alternativas descartadas por ahora:
  - B: `esfuerzo_generador` = `low` con tope de 8000. Es más barata, pero podría reducir el cumplimiento de la guía de fallas, que es justo lo que v3 busca.
  - A+B: cambia dos variables a la vez y no se sabría cuál arregló o dañó el resultado.
- Criterio de decisión: si el envío termina en `end_turn` con razonamiento por debajo de aproximadamente 12,000 tokens, se deja A; si no, se prueba B.
- El valor por defecto de `contrato/config.md` y `datos/config.csv` sigue en 8000 hasta la medición. El dueño prueba 16000 en su hoja `config`.
- Las estimaciones de salida de A y B son SUPUESTO. Resultado de la medición: pendiente.

#### 12.5 Cambio del reintento del generador (decisión del dueño, 31-oct-2026)

- Regla nueva en W0: si el primer intento del generador termina en `max_tokens`, no se reintenta. Pasa directo a `generacion_invalida` con un mensaje que indica subir `max_tokens_generador` o bajar `esfuerzo_generador`. En el código: `decidirIntentoGeneracion` en `js/simulador.js`, con `detalle.sin_reintento` = `max_tokens`.
- `reintentos_generacion` sigue aplicando a las demás causas: JSON inválido, payload fuera del contrato y verificación (`verificarEscenarioGenerado`).
- El evaluador conserva su regla actual: un reintento ante respuesta incompleta (`reintentos_respuesta_incompleta`, apartado 2).
- Por qué difieren (razón que el dueño pidió dejar escrita):
  - Generador: la causa del corte es determinista, porque depende de la combinación de prompt, esfuerzo y tope. Repetir la misma petición produjo el mismo corte las 6 veces, así que el reintento solo duplica el costo sin posibilidad de éxito. Se corrige cambiando la configuración.
  - Evaluador: la respuesta incompleta fue intermitente en las pruebas de la Fase 1 (por ejemplo, el bloque `commentary` de la API aparecía a veces). Un reintento tiene probabilidad real de éxito, y por eso el evaluador usa una vez la regla.
- Archivos tocados:
  - `js/simulador.js` (`decidirIntentoGeneracion`).
  - `js/tests/simulador_sorteo.test.js` (pruebas del nuevo caso). No ejecuté las pruebas; no reporto cuántas pasan.
  - `contrato/config.md` y `datos/config.csv`: solo las descripciones de `reintentos_generacion` y `max_tokens_generador`, no sus valores.
  - `workflows/00_simulador.json`: reensamblado por `workflows-n8n` con el código nuevo.
- Alternativa descartada: mantener el reintento también en el generador "por simetría". Duplica el costo (aproximadamente 0.006 USD por intento cortado, medido) sin cambiar el resultado.

#### 12.6 Quién hizo qué

- `evaluador-llm`: `generador_ce_v3`.
- `reglas-js`: cambio del reintento y pruebas.
- `contrato-datos`: descripciones de config.
- `workflows-n8n`: reensamblado de W0.
- Orquestador: midió el consumo en las ejecuciones de n8n.

### 13. Nota esperada en el sorteo, generador_ce_v4 y max_tokens definitivo (1-nov-2026)

Estado: cambios pendientes de commit. Las cifras son las que entregó el dueño o el orquestador; yo no ejecuté pruebas ni nuevas mediciones.

#### 13.1 Problema

- En CONV-0130 se pidió calidad regular. El sorteo eligió `comunicacion.frases_negativas` y `cierre.marca`. El evaluador detectó ambas y aun así la nota salió 91 (buena).
- Al recomputar con JS-7 se vio que hay combinaciones de fallas que nunca pueden dar la calidad pedida, por el peso de las secciones.

#### 13.2 Solución (`js/simulador.js`)

- `notaEsperada` arma todos los subelementos:
  - Los pedidos pasan a `no_cumple`.
  - Los `no_aplica` conocidos: por config, por la fila del catálogo y por los pares excluyentes de la rúbrica sección 8.
  - El resto se asume `cumple`.
  - Los críticos inyectados se toman como detectados.
- Usa `obtenerRubrica`, `calcularSecciones` y `calcularResultado` de `js/scoring.js`, inyectados por el pegamento (`contexto.scoring`, el mismo patrón que "Verificar escenario"; los módulos no se hacen `require` entre sí).
- Bandas de config: `calidad_buena_nota_min` = 80 y `calidad_regular_nota_min` = 60.
- Sorteo fuera de banda: re-sorteo, máximo 30 intentos (`MAX_INTENTOS_SORTEO_FALLAS`), reproducible con la semilla.
- Formulario fuera de banda: rechazo con la nota y la calidad esperadas y una sugerencia.
- La nota queda en `escenarios.descripcion_escenario` ("Nota esperada del scoring: X."). Ese campo no viaja al generador ni al payload.
- SUPUESTO: lo que depende del texto generado (esperas, inactividad) se asume `cumple`; la nota real puede diferir.

Notas esperadas (fila del catálogo sin restricciones):

| Fallas pedidas | Solo las fallas pedidas | Más `solucion.campos_obligatorios` |
|---|---|---|
| `comunicacion.frases_negativas` + `cierre.marca` | 91 (buena) | 73.5 (regular) |
| `diagnostico.preguntas_necesarias` + `solucion.ofrece_alternativas` | 67.5 | 67.5 |
| `diagnostico.preguntas_necesarias` + `comunicacion.redaccion` | 78.5 | 61 |
| `comunicacion.redaccion` sola | 93.5 (buena) | 76 (regular) |

La segunda columna corresponde al caso real de CONV-0129, donde además faltó el correo nuevo (`solucion.campos_obligatorios` = `no_cumple`). Con solo las fallas pedidas, `frases_negativas` + `cierre.marca` (91) y `redaccion` sola (93.5) quedan en la banda buena aunque se pidió regular: es el problema del apartado 13.1.

Alternativa descartada: subir `generador_fallas_regular` a 3. No garantiza la banda, porque depende de los pesos de sección.

#### 13.3 generador_ce_v4

`generador_ce_v1` a `v3` quedan intactos.
- Ejemplo ficticio de mala redacción en `GUIA_FALLAS`: palabras bien escritas, pasos completos, ideas encimadas y referencias ambiguas, en al menos 2 mensajes.
- Marcador nuevo `GUIA_SITUACIONES` (18 líneas, filtradas por el criterio pedido): crea el disparador de criterios situacionales para que no queden `no_aplica`. En CONV-0129, `solucion.ofrece_alternativas` quedó `no_aplica` por falta de situación.
- El agente confirma la solicitud con frases de la lista `ofrece_ayuda`, tal cual, si el cliente ya la planteó.
- Descartado (decisión del dueño): una señal de "oración larga" en W0.
- Tamaño: +970 caracteres fijos; +1,462 a +1,928 en un caso típico de 2 fallas; aproximadamente +3 a 4 % de tokens. SUPUESTO: se estima con la razón de aproximadamente 2.23 caracteres por token medida en v3.
- Riesgos:
  - El ejemplo sin comas puede hacer que el evaluador marque ortografía.
  - El modelo puede parafrasear la confirmación.
  - Las situaciones de negativa pueden empujar a una promesa no autorizada o a una negación de servicio.

#### 13.4 max_tokens_generador definitivo

`max_tokens_generador` = 16000 con `esfuerzo_generador` = `medium`, definitivo en el contrato. Base: la medición del 30-oct-2026, con razonamiento de 7,383 y 7,949 tokens y salida de 9,278 y 10,343 tokens.

#### 13.5 Incidente del 31-oct-2026, 02:50 y 03:00 (hora local)

- 04 Reproceso (programado) falló en "Leer hoja config" con "The service refused the connection - perhaps it is offline": no había conexión a Google.
- 99 Errores también falló en su propia lectura de config, por eso no hubo mensaje de Telegram ni fila en `log_errores`.
- Ninguna conversación cambió de estado.
- Es la limitación ya documentada: sin Google, 04 y 99 fallan al leer config.
- Backlog: que 99 Errores tenga un camino de alerta que no dependa de Sheets. SUPUESTO de mejora, no decidido.

#### 13.6 Criterio de cierre de la Fase 2

Fijado por el dueño: 3 envíos regulares (uno con `comunicacion.redaccion` en el formulario). Si al menos 2 salen regulares, se cierra la fase. Resultado: 0 de 3; ver el apartado 14.

### 14. Prueba de cierre y fidelidad del simulador (1-nov-2026)

#### 14.1 Resultado del criterio de cierre

- Criterio fijado por el dueño: 3 envíos regulares, con al menos 2 regulares. Resultado: 0 de 3 (CONV-0131 mala 52.5, CONV-0132 buena 93.5, CONV-0133 buena 93.5).
- CONV-0133 cayó primero en reproceso por `sin_final_answer`; W4 la evaluó en el ciclo siguiente.
- Un cuarto envío del formulario fue rechazado sin costo porque los criterios se escribieron en el campo de error crítico (la validación funcionó).
- Decisión del dueño: cerrar la Fase 2 porque los casos de `IMPORTAR.md` pasaron, y registrar la fidelidad como limitación.

#### 14.2 Fallas pedidas contra fallas observadas

Nota esperada = scoring de JS-7 sobre las fallas pedidas. Para CONV-0129 y CONV-0130 se calculó después, porque la nota esperada aún no existía.

| Conversación | Generador | Fallas pedidas | Nota esperada | Pedidas detectadas | Fallas no pedidas | Nota real |
|---|---|---|---|---|---|---|
| CONV-0129 | v3 | diagnostico.preguntas_necesarias, solucion.ofrece_alternativas | 67.5 regular | 0/2 (cumple, no_aplica) | solucion.campos_obligatorios | 82.5 buena |
| CONV-0130 | v3 | comunicacion.frases_negativas, cierre.marca | 91 buena | 2/2 | — | 91 buena |
| CONV-0131 | v4 | solucion.ofrece_alternativas, recapitulacion.recordatorio_inactividad | 76.5 regular | 1/2 (ofrece_alternativas no_aplica) | solucion.informacion_correcta, comunicacion.congruencia (mismo error: webinar) | 52.5 mala |
| CONV-0132 | v4 | comunicacion.vicios_lenguaje, solucion.informacion_completa | 76 regular | 1/2 (informacion_completa cumple) | — | 93.5 buena |
| CONV-0133 | v4 | diagnostico.preguntas_necesarias, comunicacion.redaccion | 78.5 regular | 1/2 (preguntas_necesarias no_aplica) | — | 93.5 buena |

- Fidelidad de extremo a extremo (generador + evaluador): 5 de 10 fallas pedidas detectadas (50 %); con v4: 3 de 6.
- Fallas no pedidas: 3 en 2 conversaciones (2 de ellas son el mismo error en CONV-0131).

#### 14.3 Revisión de las 5 fallas no detectadas

Lectura del dueño y del orquestador. NO es calibración humana (se mide en la Fase 3). Supuesto: muestra de 5 conversaciones y revisión no ciega.

En 4 la falla sí está en el texto y el evaluador no la marcó:
- CONV-0129 `preguntas_necesarias`: no pide el correo nuevo que exige KB-07 y repregunta la solicitud.
- CONV-0131 `ofrece_alternativas`: el descuento no procedía con pago mensual y el agente no sugirió cambiar a pago anual, que KB-08 permite en Configuración > Mi plan.
- CONV-0132 `informacion_completa`: omite el plazo de KB-03 (el complemento se emite a más tardar el día 5 del mes siguiente).
- CONV-0133 `preguntas_necesarias`: el agente supone "supongo que quieres registrar una tarjeta nueva" y no pregunta si el cliente es Administrador, requisito de KB-06.

En 1 la falla no se produjo: CONV-0129 `ofrece_alternativas` (v3; la solicitud sí era tramitable; v4 agrega `GUIA_SITUACIONES` para esto).

#### 14.4 Otros hallazgos

- CONV-0131 `solucion.informacion_correcta`: KB-08 dice "15% de descuento en el pago anual ... más acceso gratuito al webinar ... No aplica a pagos mensuales". La lectura más natural es que la restricción aplica a toda la campaña, incluido el webinar, así que la afirmación del agente es defendible y el `no_cumple` es probablemente un falso positivo del evaluador; el artículo es ambiguo.
- Escenario contrafactual con JS-7 (si el evaluador hubiera marcado lo que la revisión ve): CONV-0131 76.5, CONV-0132 76, CONV-0133 78.5, los 3 regulares. Conclusión: el cuello de botella observado está más en la indulgencia del evaluador que en el generador; la limitación se registra como fidelidad de extremo a extremo, no solo del generador.
- `generador_ce_v4`: `comunicacion.redaccion` se detectó en CONV-0133 (el evaluador citó el mensaje 8, «los datos de la tarjeta los captura ella eso»), lo que v3 no logró en el caso 9. El agente confirmó la solicitud en la apertura en CONV-0131, 0132 y 0133.
- CONV-0132 `vicios_lenguaje`: "Okey" sí está en la lista `vicio_lenguaje` y sí coincide; el mensaje 4 tiene "Ahorita" y "Okey" y la regla (`reglaProhibida` en `js/reglas.js`) reporta solo el primer término de cada mensaje, por eso la evidencia muestra solo "ahorita". El resultado es correcto; la evidencia es incompleta.
- Backlog derivado: ver las entradas nuevas del apartado 4 de esta fase.
