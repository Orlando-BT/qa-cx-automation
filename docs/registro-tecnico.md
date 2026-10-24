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

### 5. Pruebas

`node --test js/tests/*.test.js` : 241 tests, 241 pasan, 0 fallan. Verificado por el orquestador el 23-oct-2026; yo no lo volví a ejecutar.

### 6. Pendiente de la Fase 1

- Revisión del `revisor` y commit al cierre.
- Todas las métricas de confiabilidad siguen pendientes: no hay calificación humana.
