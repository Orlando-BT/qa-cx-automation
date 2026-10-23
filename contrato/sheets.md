# Libro de Google Sheets (contrato)

Cada hoja con sus columnas exactas **en orden**, tipo de dato, descripción y quién la escribe. La fila 1 de cada hoja contiene exactamente los nombres de columna aquí listados. Estado: borrador de Fase 0.

## Convenciones

- **Tipos:**
  - `texto`, `entero`, `decimal`.
  - `booleano`: se escribe `si`/`no`.
  - `fecha_hora`: marca de tiempo del sistema, ISO 8601 con desfase. Ejemplo: `2026-10-21T10:05:00-06:00`.
  - `lista`: valores separados por `|`.
  - `json`: JSON serializado en una celda.
  - `enum(x)`: enumeración `x` de `glosario.md`.
  - Marcadores especiales (`no_medido`, `no_aplica` como marcador, `por_verificar`, `pendiente_fase_1`, `sin_rubrica`): solo donde el tipo de la columna los menciona (ver glosario, sección 1).
- **Escritores:**
  - `W0 Simulador`, `W1 Ingesta` (webhook o disparador manual), `W2 Evaluación`, `W3 Métricas`, `WE Errores`: workflows de n8n.
  - `manual: dueño`: lo escribe solo el dueño.
  - `carga inicial`: se importa desde `datos/` (CSV preparado por `contrato-datos`).
- Una celda vacía significa "sin valor" (equivale a `null`).
- Ningún workflow escribe en una hoja que no tenga asignada aquí.
- **Rúbricas por `tipo_interaccion`:**
  - Las hojas de referencia (`config`, `listas`, `catalogo_temas`, `base_conocimiento`) tienen una columna `tipo_interaccion` con enum(ambito_tipo_interaccion).
  - Las hojas de resultados son genéricas: no tienen columnas por sección.
  - La hoja de calificación humana es por rúbrica: `revision_humana` corresponde a la rúbrica `ce`. Una rúbrica futura (Sales, Fase 5b) tendrá su hoja `revision_humana_sales`, con las mismas columnas de datos y columnas `h_*` derivadas de su rúbrica con la misma regla del glosario.

## Resumen

| Hoja | Una fila por | Escribe | Lee |
|---|---|---|---|
| `config` | (clave, tipo_interaccion) | carga inicial; manual: dueño | todos los workflows |
| `listas` | frase o término | carga inicial; manual: dueño | W2 |
| `catalogo_temas` | tipificación válida | carga inicial; manual: dueño | W2, W0 |
| `base_conocimiento` | artículo | carga inicial; manual: dueño | W2, W0 |
| `cuentas` | cuenta | carga inicial; manual: dueño | W0, W1, W2 |
| `conversaciones` | conversación por versión (llave_dedup) | W1 (webhook y disparador manual), W2 | W1, W2 |
| `escenarios` | conversación generada | W0; carga inicial (`calibracion_v1`) | W3 |
| `revision_humana` | conversación generada (rúbrica `ce`) | W0; carga inicial (`calibracion_v1`); manual: dueño (calificación) | W3 |
| `evaluaciones` | evaluación | W2 | W3 |
| `detalle_criterios` | sección o criterio de una evaluación | W2 | W3 |
| `log_errores` | error | W0, W1, W2, W3, WE | dueño |
| `alertas` | alerta enviada | W0, W1, W2, W3, WE | dueño |
| `metricas` | valor de métrica | W3 | dueño, tablero |

---

## `config`

Ver claves y valores en `config.md`. La llave de la hoja es (`clave`, `tipo_interaccion`). Al cargar, se leen las filas `todos` y las del tipo de la conversación; si una clave existe en ambas, gana la del tipo.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `clave` | texto | Nombre de la clave. | carga inicial |
| 2 | `tipo_interaccion` | enum(ambito_tipo_interaccion) | `todos`, `ce` o `sales`. | carga inicial |
| 3 | `valor` | texto | Valor; se interpreta según `tipo`. Puede ser `por_verificar`, `pendiente_fase_1` o `sin_rubrica` donde `config.md` lo indica. | carga inicial; manual: dueño |
| 4 | `tipo` | enum(tipo_dato_config) | Tipo del valor. | carga inicial |
| 5 | `descripcion` | texto | Para qué sirve. | carga inicial |
| 6 | `es_supuesto` | booleano | `si` si el valor es un supuesto por revisar. | carga inicial; manual: dueño |

## `listas`

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `clave_lista` | texto (ver `clave_lista` en el glosario; se cargan las filas del tipo ∪ `todos`) | Grupo al que pertenece la frase. | carga inicial; manual: dueño |
| 2 | `tipo_lista` | enum(tipo_lista) | Categoría. | carga inicial; manual: dueño |
| 3 | `tipo_interaccion` | enum(ambito_tipo_interaccion) | Rúbrica a la que aplica la fila. | carga inicial; manual: dueño |
| 4 | `valor` | texto | Frase, término o expresión regular. Se compara sin acentos y sin distinguir mayúsculas. | carga inicial; manual: dueño |
| 5 | `es_regex` | booleano | `si` si `valor` es expresión regular de JavaScript (sin delimitadores `/`). | carga inicial; manual: dueño |
| 6 | `activo` | booleano | Solo se usan filas con `si`. | carga inicial; manual: dueño |
| 7 | `notas` | texto | Comentario opcional. Única excepción a que `notas` sea solo comentario: en `clave_lista = numero_en_palabras` es un dato que lee `reglas-js` (el número en cifra). Al cargar esa lista JS valida que `notas` sea un entero no vacío y que no haya palabras ni cifras duplicadas; si falla, error explícito (ver glosario, convención de `numero_en_palabras`). | carga inicial; manual: dueño |

## `catalogo_temas`

Una fila por tipificación válida. Un tema puede tener varias filas (varias tipificaciones válidas). Al cargar se usan las filas del tipo de la conversación **unidas** a las de `todos`. `tipificacion_valida` es única dentro de ese conjunto (tipo ∪ `todos`), para que JS encuentre los campos obligatorios a partir de `tipificacion_agente` sin ambigüedad.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `tema` | texto | Tema del catálogo cerrado (valor que devuelve el LLM en `tema.valor`). | carga inicial; manual: dueño |
| 2 | `tipificacion_valida` | texto | Tipificación correcta para el tema. Ejemplo: `Cancelación de CFDI`. | carga inicial; manual: dueño |
| 3 | `tipo_interaccion` | enum(ambito_tipo_interaccion) | Rúbrica a la que pertenece el tema (`ce` en esta versión). | carga inicial; manual: dueño |
| 4 | `requiere_escalamiento` | enum(requiere_escalamiento) | `si`, `no` o `segun_caso` (decide el insumo del LLM). | carga inicial; manual: dueño |
| 5 | `campos_obligatorios` | lista | Nombres de campos (snake_case) que deben estar `presente` en `campos_capturados`. Ejemplo: `uuid_factura\|motivo_cancelacion`. Puede estar vacío. | carga inicial; manual: dueño |
| 6 | `id_articulo` | texto | Artículo principal de la base para el tema (`KB-nn`). | carga inicial; manual: dueño |
| 7 | `activo` | booleano | Solo se usan filas con `si`. | carga inicial; manual: dueño |

## `base_conocimiento`

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `id_articulo` | texto | `KB-nn`, único. | carga inicial; manual: dueño |
| 2 | `titulo` | texto | Título del artículo. | carga inicial; manual: dueño |
| 3 | `tema` | texto | Tema del catálogo al que pertenece. | carga inicial; manual: dueño |
| 4 | `tipo_interaccion` | enum(ambito_tipo_interaccion) | Rúbrica que usa el artículo (`ce` en esta versión; `todos` si es compartido). Se cargan las filas del tipo ∪ `todos`. | carga inicial; manual: dueño |
| 5 | `contenido` | texto | Proceso y políticas. | carga inicial; manual: dueño |
| 6 | `plazos` | texto | Plazos aplicables (vacío si no hay). | carga inicial; manual: dueño |
| 7 | `casos_escalamiento` | texto | Situaciones que se escalan (vacío si no hay). | carga inicial; manual: dueño |
| 8 | `promociones_autorizadas` | texto | Promociones vigentes autorizadas (vacío si no hay). | carga inicial; manual: dueño |
| 9 | `actualizado_en` | fecha_hora | Última actualización. | carga inicial; manual: dueño |

## `cuentas`

Datos 100% ficticios. Nunca datos reales.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `cuenta_id` | texto | `CTA-nnn`, único. | carga inicial; manual: dueño |
| 2 | `titular` | texto | Nombre de la persona titular o contacto autorizado. Se enmascara como `[NOMBRE_n]` (completo o nombre de pila). | carga inicial; manual: dueño |
| 3 | `razon_social` | texto | Razón social de la empresa cliente. | carga inicial; manual: dueño |
| 4 | `rfc` | texto | RFC con formato válido (12 o 13 caracteres). | carga inicial; manual: dueño |
| 5 | `correo` | texto | Correo de contacto (dominio ficticio). | carga inicial; manual: dueño |
| 6 | `telefono` | texto | 10 dígitos. Se guarda como texto para conservar ceros. | carga inicial; manual: dueño |
| 7 | `giro` | enum(giro) | Giro del negocio. | carga inicial; manual: dueño |
| 8 | `tamano` | enum(tamano) | `micro`, `pequena` o `mediana`. | carga inicial; manual: dueño |

## `conversaciones`

Una fila por `llave_dedup`. Quién escribe:
- **W1 por webhook:**
  1. Valida el payload.
  2. Si el `tipo_interaccion` no tiene rúbrica (`version_reglas = sin_rubrica`), no inserta: solo escribe `log_errores` con `tipo_interaccion_sin_rubrica` (SUPUESTO). Limitación: esas conversaciones no quedan guardadas y deben reenviarse cuando exista la rúbrica (Fase 5b).
  3. Si ya existe la `llave_dedup` con `estado` distinto de `error`, no inserta y responde como duplicado. Si existe con `estado = error`, la reutiliza: la pone en `pendiente` e incrementa `intentos` (SUPUESTO).
  4. Inserta como `pendiente`.
  5. Llama a Evaluación, salvo que `lote` sea `calibracion_*` y `config.evaluar_al_ingerir_calibracion = no`.
- **W1 por disparador manual** (parámetros: `lote`, `version_reglas`, `version_prompt`):
  - Por cada `conversation_id` del lote sin fila con la nueva `llave_dedup`, crea una fila `pendiente` copiando los datos de la conversación (columnas 2 a 14) de una fila existente.
  - Luego pasa a W2, una por una, las filas `pendiente` del lote con esa versión.
- **W2:** cambia `estado`, `intentos`, `actualizado_en` e `id_evaluacion`.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `llave_dedup` | texto | `conversation_id\|version_reglas\|version_prompt` (versiones de `config` del `tipo_interaccion`, o las del disparador manual). | W1 |
| 2 | `conversation_id` | texto | Del payload. | W1 |
| 3 | `lote` | enum(lote) | Del parámetro de consulta `?lote=`; si falta, `config.lote_por_defecto`. | W1 |
| 4 | `canal` | enum(canal) | Del payload. | W1 |
| 5 | `tipo_interaccion` | enum(tipo_interaccion) | Del payload. | W1 |
| 6 | `agente` | texto | Del payload. | W1 |
| 7 | `cuenta_id` | texto | Del payload. | W1 |
| 8 | `tipificacion_agente` | texto | De `metadatos_caso`. | W1 |
| 9 | `numero_caso` | texto | De `metadatos_caso`; vacío si `null`. | W1 |
| 10 | `estado_caso` | enum(estado_caso) | De `metadatos_caso`. | W1 |
| 11 | `escalado` | booleano | De `metadatos_caso`. | W1 |
| 12 | `campos_capturados_json` | json | `metadatos_caso.campos_capturados`. | W1 |
| 13 | `mensajes_json` | json | Arreglo `mensajes` completo, sin enmascarar. | W1 |
| 14 | `total_mensajes` | entero | Número de mensajes. | W1 |
| 15 | `version_reglas` | texto | Versión de reglas (rúbrica) con la que se evaluará. | W1 |
| 16 | `version_prompt` | texto | Versión de prompt con la que se evaluará. | W1 |
| 17 | `estado` | enum(estado_conversacion) | `pendiente` al insertar; W2 cambia a `en_evaluacion`, `evaluada` o `error`. | W1, W2 |
| 18 | `intentos` | entero | Número de veces que entró a evaluación. | W1, W2 |
| 19 | `recibido_en` | fecha_hora | Recepción en el webhook (en filas creadas por el disparador manual, copia de la fila origen). | W1 |
| 20 | `actualizado_en` | fecha_hora | Último cambio de `estado`. | W1, W2 |
| 21 | `id_evaluacion` | texto | Vacío hasta que W2 termina. | W2 |

## `escenarios`

**Verdad oculta del escenario.** Nunca se une al payload, nunca se envía al evaluador y no se muestra en `revision_humana`. Solo la lee W3, para medir la calidad del generador, y el dueño después de terminar su calificación.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `conversation_id` | texto | ID de la conversación generada. | W0; carga inicial |
| 2 | `lote` | enum(lote) | Lote destino. | W0; carga inicial |
| 3 | `tipo_interaccion` | enum(tipo_interaccion) | Tipo de interacción generado. | W0; carga inicial |
| 4 | `generado_por` | enum(generado_por) | `simulador` o `contrato-datos`. | W0; carga inicial |
| 5 | `calidad_solicitada` | enum(calidad_solicitada) | Lo pedido en el formulario (incluye `aleatoria`). | W0; carga inicial |
| 6 | `calidad_esperada` | enum(calidad_esperada) | Calidad resuelta del escenario, según las bandas de `rubrica.md` 2.4. | W0; carga inicial |
| 7 | `tema_esperado` | texto | Tema del catálogo. | W0; carga inicial |
| 8 | `tipificacion_esperada` | texto | Tipificación correcta para el tema. | W0; carga inicial |
| 9 | `errores_criticos_inyectados` | lista | IDs `critico.*` inyectados; vacío si ninguno. | W0; carga inicial |
| 10 | `criterios_que_deben_fallar` | lista | IDs de subelementos (sección o identidad) que el escenario hace fallar. | W0; carga inicial |
| 11 | `casos_dificiles` | lista | Valores de enum(caso_dificil); vacío si ninguno. | W0; carga inicial |
| 12 | `descripcion_escenario` | texto | Descripción breve de lo que debe ocurrir. | W0; carga inicial |
| 13 | `cuenta_id` | texto | Cuenta elegida. | W0; carga inicial |
| 14 | `modelo_generador` | texto | Modelo que generó la conversación (`config.modelo_generador`). En lotes escritos por `contrato-datos`: `contrato-datos / <modelo>`; en `calibracion_v1`, `contrato-datos / claude-opus-5-5`. | W0; carga inicial |
| 15 | `version_prompt_generador` | texto o `no_aplica` | `generador_<tipo>_vN`; `no_aplica` en `calibracion_v1`. | W0; carga inicial |
| 16 | `tokens_entrada` | entero o `no_medido` | Tokens de entrada de la generación; `no_medido` en `calibracion_v1`. | W0; carga inicial |
| 17 | `tokens_salida` | entero o `no_medido` | Tokens de salida; `no_medido` en `calibracion_v1`. | W0; carga inicial |
| 18 | `costo_generacion_usd` | decimal o `no_medido` | Costo de generación. `no_medido` en `calibracion_v1`; vacío si W0 generó con precios del generador en `por_verificar`. | W0; carga inicial |
| 19 | `generado_en` | fecha_hora | Momento de generación. | W0; carga inicial |

## `revision_humana`

Hoja de calificación **a ciegas** del dueño para la rúbrica `ce`. Reglas:
- No contiene resultados del sistema ni la verdad del escenario.
- Las columnas `h_*` las llena **solo el dueño**. Ningún agente ni workflow genera, sugiere ni completa estos valores.
- Nombres de columna derivados del ID con la regla del glosario: sección → `h_seccion__<id>`; otros → `h_` + ID con `.` → `__`.

Valores permitidos:
- `h_seccion__*`: `cumple`, `parcial`, `no_cumple`, `no_aplica`.
- `h_<seccion>__*` (subelementos clave) y `h_identidad__*`: `cumple`, `no_cumple`, `no_aplica` (sin `parcial`).
- `h_critico__*`: `si`, `no`.

Orden de las columnas `h_*`: secciones en el orden de pesos; luego subelementos clave, identidad y críticos en el orden en que aparecen en `rubrica.md`.

Las métricas de acuerdo por origen usan los subelementos clave e identidad, con su origen tomado de `rubrica.md`. La nota humana para comparar con `nota_final` la calcula W3 a partir de las columnas `h_seccion__*` y `h_critico__*`, con las mismas reglas D2 y D5. La calidad humana se obtiene con las bandas de `rubrica.md` 2.4.

| # | Columna | Tipo / valores | Origen del criterio | Escribe |
|---|---|---|---|---|
| 1 | `conversation_id` | texto | — | W0; carga inicial |
| 2 | `lote` | enum(lote) | — | W0; carga inicial |
| 3 | `tipo_interaccion` | enum(tipo_interaccion) | — | W0; carga inicial |
| 4 | `agente` | texto | — | W0; carga inicial |
| 5 | `cuenta_id` | texto | — | W0; carga inicial |
| 6 | `metadatos_caso_legible` | texto | — | W0; carga inicial |
| 7 | `texto_legible` | texto | — | W0; carga inicial |
| 8 | `estado_revision` | enum(estado_revision) | — | W0 y carga inicial (`pendiente`); manual: dueño (`calificada`) |
| 9 | `h_seccion__apertura` | resultado_seccion | sección | manual: dueño |
| 10 | `h_seccion__empatia` | resultado_seccion | sección | manual: dueño |
| 11 | `h_seccion__diagnostico` | resultado_seccion | sección | manual: dueño |
| 12 | `h_seccion__solucion` | resultado_seccion | sección | manual: dueño |
| 13 | `h_seccion__comunicacion` | resultado_seccion | sección | manual: dueño |
| 14 | `h_seccion__recapitulacion` | resultado_seccion | sección | manual: dueño |
| 15 | `h_seccion__ayuda_adicional` | resultado_seccion | sección | manual: dueño |
| 16 | `h_seccion__cierre` | resultado_seccion | sección | manual: dueño |
| 17 | `h_apertura__aviso_privacidad` | resultado_subelemento | JS | manual: dueño |
| 18 | `h_apertura__toma_a_tiempo` | resultado_subelemento | JS | manual: dueño |
| 19 | `h_empatia__muestra_empatia` | resultado_subelemento | LLM | manual: dueño |
| 20 | `h_empatia__cordialidad` | resultado_subelemento | LLM | manual: dueño |
| 21 | `h_diagnostico__solicitudes_detectadas` | resultado_subelemento | LLM | manual: dueño |
| 22 | `h_diagnostico__solicitudes_atendidas` | resultado_subelemento | LLM | manual: dueño |
| 23 | `h_solucion__informacion_correcta` | resultado_subelemento | LLM | manual: dueño |
| 24 | `h_solucion__apego_proceso` | resultado_subelemento | LLM | manual: dueño |
| 25 | `h_solucion__escala_cuando_requiere` | resultado_subelemento | HIBRIDO | manual: dueño |
| 26 | `h_comunicacion__ortografia` | resultado_subelemento | HIBRIDO | manual: dueño |
| 27 | `h_comunicacion__no_excede_espera` | resultado_subelemento | JS | manual: dueño |
| 28 | `h_recapitulacion__recapitula` | resultado_subelemento | LLM | manual: dueño |
| 29 | `h_recapitulacion__informa_numero_caso` | resultado_subelemento | JS | manual: dueño |
| 30 | `h_recapitulacion__numero_caso_coincide` | resultado_subelemento | JS | manual: dueño |
| 31 | `h_recapitulacion__tipificacion` | resultado_subelemento | HIBRIDO | manual: dueño |
| 32 | `h_ayuda_adicional__ofrece_ayuda_adicional` | resultado_subelemento | JS | manual: dueño |
| 33 | `h_ayuda_adicional__encuesta` | resultado_subelemento | JS | manual: dueño |
| 34 | `h_cierre__agradece` | resultado_subelemento | JS | manual: dueño |
| 35 | `h_cierre__despedida` | resultado_subelemento | JS | manual: dueño |
| 36 | `h_identidad__pide_datos` | resultado_subelemento | JS | manual: dueño |
| 37 | `h_identidad__datos_coinciden` | resultado_subelemento | JS | manual: dueño |
| 38 | `h_identidad__orden_validacion` | resultado_subelemento | HIBRIDO | manual: dueño |
| 39 | `h_critico__no_toma_a_tiempo` | valor_humano_critico | JS | manual: dueño |
| 40 | `h_critico__no_genera_caso` | valor_humano_critico | JS | manual: dueño |
| 41 | `h_critico__abandono` | valor_humano_critico | JS | manual: dueño |
| 42 | `h_critico__palabras_altisonantes` | valor_humano_critico | JS | manual: dueño |
| 43 | `h_critico__validacion_identidad` | valor_humano_critico | HIBRIDO | manual: dueño |
| 44 | `h_critico__confidencialidad` | valor_humano_critico | HIBRIDO | manual: dueño |
| 45 | `h_critico__tipificacion_incorrecta` | valor_humano_critico | HIBRIDO | manual: dueño |
| 46 | `h_critico__informacion_incorrecta` | valor_humano_critico | LLM | manual: dueño |
| 47 | `h_critico__promesa_no_autorizada` | valor_humano_critico | LLM | manual: dueño |
| 48 | `h_critico__negacion_servicio` | valor_humano_critico | LLM | manual: dueño |
| 49 | `h_critico__mala_actitud` | valor_humano_critico | LLM | manual: dueño |
| 50 | `h_critico__comentarios_negativos_marca` | valor_humano_critico | LLM | manual: dueño |
| 51 | `comentarios_humano` | texto | — | manual: dueño |
| 52 | `calificado_en` | fecha_hora | — | manual: dueño |

Formatos de las columnas legibles:
- **`metadatos_caso_legible`:** `tipificacion_agente: <valor> \| numero_caso: <valor o sin caso> \| estado_caso: <valor> \| escalado: si/no \| campos_capturados: <campo>=<presente/ausente>, ...`. Son datos observables del payload, no resultados ni verdad del escenario.
- **`texto_legible`:** una línea por mensaje con el formato `[n] HH:MM:SS emisor: texto`, en orden. No se enmascara: es una hoja privada del dueño y los datos son ficticios.

## `evaluaciones`

Una fila por evaluación completa (ver `evaluacion.schema.json`). Genérica: el resultado por sección está en `detalle_criterios` (filas con `tipo_criterio = seccion`).

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `id_evaluacion` | texto | `EVAL-<conversation_id>-<version_reglas>-<version_prompt>`. | W2 |
| 2 | `llave_dedup` | texto | Igual a `conversaciones.llave_dedup`. | W2 |
| 3 | `conversation_id` | texto | | W2 |
| 4 | `lote` | enum(lote) | | W2 |
| 5 | `canal` | enum(canal) | | W2 |
| 6 | `tipo_interaccion` | enum(tipo_interaccion) | | W2 |
| 7 | `agente` | texto | | W2 |
| 8 | `cuenta_id` | texto | | W2 |
| 9 | `version_reglas` | texto | Rúbrica y versión aplicadas. | W2 |
| 10 | `version_prompt` | texto | | W2 |
| 11 | `modelo_evaluador` | texto | Vacío si `sin_mensajes_agente = si`. | W2 |
| 12 | `tema_detectado` | texto | Tema del LLM validado contra el catálogo (tipo ∪ `todos`). Vacío si `sin_mensajes_agente = si`. | W2 |
| 13 | `emocion_cliente` | enum(emocion) | Vacío si `sin_mensajes_agente = si`. | W2 |
| 14 | `nota_base` | decimal | 0 a 100, sin errores críticos. | W2 |
| 15 | `nota_final` | decimal | Nota oficial. | W2 |
| 16 | `meta_calidad` | decimal | Copia de config. | W2 |
| 17 | `cumple_meta` | booleano | | W2 |
| 18 | `calidad` | enum(calidad_esperada) | Banda de `rubrica.md` 2.4 aplicada a `nota_final` y críticos. | W2 |
| 19 | `tiene_error_critico` | booleano | | W2 |
| 20 | `sin_mensajes_agente` | booleano | `si` si se evaluó solo con JS por no haber mensajes del agente (`rubrica.md` 3.12). Identifica el caso; no lo excluye de métricas. | W2 |
| 21 | `errores_criticos` | lista | IDs `critico.*` detectados; vacío si ninguno. | W2 |
| 22 | `tokens_entrada` | entero | `0` si `sin_mensajes_agente = si`. | W2 |
| 23 | `tokens_salida` | entero | `0` si `sin_mensajes_agente = si`. | W2 |
| 24 | `intentos_llm` | entero | 1 + reenvíos por respuesta inválida; `0` si `sin_mensajes_agente = si`. | W2 |
| 25 | `costo_usd` | decimal | `0` si `sin_mensajes_agente = si`. Vacío solo si se llamó al LLM con precios del evaluador en `por_verificar`. | W2 |
| 26 | `recibido_en` | fecha_hora | | W2 |
| 27 | `iniciado_en` | fecha_hora | | W2 |
| 28 | `evaluado_en` | fecha_hora | | W2 |
| 29 | `evaluacion_json` | json | Objeto completo según `evaluacion.schema.json`. | W2 |

## `detalle_criterios`

Una fila por sección (`tipo_criterio = seccion`) y una por cada elemento de `criterios` de la evaluación. Con `reglas_ce_v1` son 77 filas por evaluación: 8 secciones, 54 subelementos, 3 de identidad y 12 críticos. Un criterio se identifica con `version_reglas` + `id_criterio`.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `id_evaluacion` | texto | | W2 |
| 2 | `conversation_id` | texto | | W2 |
| 3 | `lote` | enum(lote) | | W2 |
| 4 | `tipo_interaccion` | enum(tipo_interaccion) | | W2 |
| 5 | `version_reglas` | texto | | W2 |
| 6 | `version_prompt` | texto | | W2 |
| 7 | `id_criterio` | texto | ID de la rúbrica; en filas de sección, el ID de la sección (por ejemplo `solucion`). | W2 |
| 8 | `tipo_criterio` | enum(tipo_criterio) | | W2 |
| 9 | `seccion` | texto | ID de sección, `identidad` o `critico`. | W2 |
| 10 | `origen` | enum(origen) | Vacío en filas de sección. | W2 |
| 11 | `clasificacion` | enum(clasificacion) | Solo en subelementos; vacío en sección, identidad y críticos. | W2 |
| 12 | `peso` | decimal | Solo en filas de sección; vacío en el resto. | W2 |
| 13 | `resultado` | texto | Sección: enum(resultado_seccion). Subelemento e identidad: enum(resultado_subelemento). Crítico: enum(resultado_critico). | W2 |
| 14 | `mensajes` | lista | Números de mensaje de evidencia; vacío en filas de sección. | W2 |
| 15 | `evidencia_dato` | texto | Dato concreto (enmascarado). En secciones: subelementos clave fallidos y complementarios fallidos/aplicables. | W2 |
| 16 | `justificacion` | texto | | W2 |
| 17 | `evaluado_en` | fecha_hora | | W2 |

## `log_errores`

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `id_error` | texto | `ERR-AAAAMMDD-HHMMSS-nnn`. | W0, W1, W2, W3, WE |
| 2 | `ocurrido_en` | fecha_hora | | W0, W1, W2, W3, WE |
| 3 | `workflow` | enum(workflow) | | W0, W1, W2, W3, WE |
| 4 | `nodo` | texto | Nombre del nodo de n8n. | W0, W1, W2, W3, WE |
| 5 | `tipo_error` | enum(tipo_error) | | W0, W1, W2, W3, WE |
| 6 | `mensaje_error` | texto | Mensaje legible, sin datos personales ni credenciales. | W0, W1, W2, W3, WE |
| 7 | `conversation_id` | texto | Vacío si no aplica. | W0, W1, W2, W3, WE |
| 8 | `lote` | enum(lote) | Vacío si no aplica. | W0, W1, W2, W3, WE |
| 9 | `tipo_interaccion` | enum(tipo_interaccion) | Vacío si no aplica. | W0, W1, W2, W3, WE |
| 10 | `detalle_json` | json | Detalle técnico (por ejemplo, errores de validación). Sin datos personales sin enmascarar ni credenciales. | W0, W1, W2, W3, WE |
| 11 | `alerta_enviada` | booleano | Si se envió alerta operativa. | W0, W1, W2, W3, WE |

## `alertas`

Toda alerta enviada (o intentada) se registra aquí. El modo de las alertas de calidad se decide por lote (`config.md` sección 12): `demo` → `inmediato`; otro lote → `resumen_lote`.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `id_alerta` | texto | `ALR-AAAAMMDD-HHMMSS-nnn`. | W0, W1, W2, W3, WE |
| 2 | `enviada_en` | fecha_hora | | W0, W1, W2, W3, WE |
| 3 | `tipo_alerta` | enum(tipo_alerta) | | W0, W1, W2, W3, WE |
| 4 | `modo_envio` | enum(modo_envio) | | W0, W1, W2, W3, WE |
| 5 | `workflow` | enum(workflow) | | W0, W1, W2, W3, WE |
| 6 | `conversation_id` | texto | Vacío en alertas de lote o de calibración. | W0, W1, W2, W3, WE |
| 7 | `lote` | enum(lote) | Vacío si no aplica. | W0, W1, W2, W3, WE |
| 8 | `agente` | texto | En alertas de calidad. | W2 |
| 9 | `id_criterio` | texto | Error crítico (`critico.*`) en alertas de calidad; vacío en las demás. | W2 |
| 10 | `nombre_metrica` | enum(nombre_metrica) | Métrica en alertas de calibración; vacío en las demás. | W3 |
| 11 | `mensajes` | lista | Números de mensaje de la evidencia. | W2 |
| 12 | `evidencia` | texto | Evidencia enmascarada. | W2 |
| 13 | `valor_observado` | decimal | Costo o métrica observada (alertas de costo y calibración). | W2, W3 |
| 14 | `umbral` | decimal | Umbral de config que se superó. | W2, W3 |
| 15 | `texto_enviado` | texto | Texto enviado por Telegram. | W0, W1, W2, W3, WE |
| 16 | `destinatario` | texto | Valor de `config.telegram_destinatario`. | W0, W1, W2, W3, WE |
| 17 | `estado_envio` | enum(estado_envio) | | W0, W1, W2, W3, WE |

## `metricas`

Formato largo: una fila por métrica calculada. Solo usa conversaciones con `revision_humana.estado_revision = calificada` y siempre se reporta por lote.

| # | Columna | Tipo | Descripción | Escribe |
|---|---|---|---|---|
| 1 | `id_ejecucion_metricas` | texto | `MET-AAAAMMDD-HHMMSS`. | W3 |
| 2 | `calculado_en` | fecha_hora | | W3 |
| 3 | `lote` | enum(lote) | | W3 |
| 4 | `tipo_interaccion` | enum(tipo_interaccion) | | W3 |
| 5 | `version_reglas` | texto | Versión evaluada. | W3 |
| 6 | `version_prompt` | texto | Versión evaluada. | W3 |
| 7 | `modelo_evaluador` | texto | | W3 |
| 8 | `ambito` | enum(ambito_metrica) | | W3 |
| 9 | `nombre_metrica` | enum(nombre_metrica) | | W3 |
| 10 | `id_criterio` | texto | ID de sección, subelemento, identidad o crítico; vacío si el ámbito es global. | W3 |
| 11 | `origen` | enum(origen) | Vacío si no aplica. | W3 |
| 12 | `valor` | decimal | | W3 |
| 13 | `numerador` | entero | Vacío si no aplica. | W3 |
| 14 | `denominador` | entero | Vacío si no aplica. | W3 |
| 15 | `n_conversaciones` | entero | Conversaciones calificadas usadas. | W3 |
| 16 | `umbral` | decimal | Umbral de config asociado; vacío si no hay. | W3 |
| 17 | `alerta_disparada` | booleano | | W3 |
| 18 | `notas` | texto | | W3 |
