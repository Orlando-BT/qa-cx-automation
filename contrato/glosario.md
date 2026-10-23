# Glosario del contrato

Fuente de verdad de nombres de campos, columnas y valores permitidos. Ningún archivo del proyecto (código JS, prompts, workflows, métricas) puede usar un nombre o un valor que no esté aquí o en los demás archivos de `contrato/`. Si falta algo, se reporta al orquestador; el contrato solo cambia con aprobación del dueño.

Estado: borrador de Fase 0.

La carpeta `contrato/ejemplos/` contiene ejemplos que cumplen los esquemas: payload, salida del LLM, evaluación y evaluación sin mensajes del agente. Son **ilustrativos y ficticios**: no son datos del lote de calibración ni deben usarse como tales.

## 1. Convenciones

- Nombres de campos, claves de configuración y columnas: `snake_case` en español, sin acentos ni ñ. Ejemplo: `tipificacion_agente`, `numero_caso`, `agente`, `tamano`. Nunca nombres en inglés como `agent_name`.
- **Excepciones explícitas a la convención en español:**
  - `conversation_id` se conserva en inglés porque así viene en el payload original definido en `CLAUDE.md`. Se usa con ese nombre exacto en payload, hojas y esquemas.
  - Los valores de `tipo_interaccion` son `ce` (Customer Experience) y `sales` (Sales). Se dejan así **a propósito**, con la terminología de la vacante. El nombre del campo `tipo_interaccion` sí sigue la convención.
- Valores mostrados a humanos (temas, tipificaciones, títulos de artículos, frases) pueden llevar acentos y mayúsculas. Ejemplo: `Cancelación de CFDI`.
- Valores de enumeraciones (estados, resultados, orígenes): minúsculas `snake_case` sin acentos, salvo `origen`, que va en mayúsculas (`JS`, `LLM`, `HIBRIDO`). En los documentos la etiqueta se escribe [HÍBRIDO], pero el valor en datos es `HIBRIDO`, sin acento.
- Valores booleanos:
  - En JSON (payload, salida del LLM, evaluación): `true` / `false`.
  - En Google Sheets: `si` / `no`, porque las hojas se leen y editan a mano.
- Listas dentro de una celda de Sheets: valores separados por `|` sin espacios. Ejemplo: `uuid_factura|motivo_cancelacion`.
- Números de mensaje dentro de una celda: separados por `|`. Ejemplo: `3|5|7`.
- Celda vacía = sin valor (`null`).
- Marcadores de valor especial (texto literal; solo válidos donde se indica):

| Marcador | Significado | Dónde es válido |
|---|---|---|
| `por_verificar` | Precio o modelo por confirmar en la documentación oficial. | `config`: `modelo_evaluador`, `modelo_generador` y precios. |
| `pendiente_fase_1` | Valor que se fija tras estimar costos en Fase 1. Solo desactiva la alerta que depende de él. | `config`: `costo_estimado_por_evaluacion_usd`, `tope_costo_lote_usd`. |
| `sin_rubrica` | El `tipo_interaccion` no tiene rúbrica activa. | `config`: `version_reglas` y `version_prompt` de un tipo sin rúbrica. |
| `no_medido` | Dato que no se midió porque la conversación no salió del simulador. | `escenarios.tokens_entrada`, `escenarios.tokens_salida`, `escenarios.costo_generacion_usd`, solo en lotes escritos por `contrato-datos` (`calibracion_v1`). |
| `no_aplica` (como marcador) | No existe el concepto para esa fila. | `escenarios.version_prompt_generador` en lotes escritos por `contrato-datos` (`calibracion_v1`). En el resto de columnas, `no_aplica` es un valor de resultado. |

Costo desconocido por precios `por_verificar`: se deja la celda **vacía** (`evaluaciones.costo_usd`, `escenarios.costo_generacion_usd` de W0), nunca `no_medido`. Excepción: una evaluación sin llamada al LLM (`sin_mensajes_agente = si`) lleva costo `0` y tokens `0`.

## 2. Identificadores y formatos

| Nombre | Formato (expresión regular) | Ejemplo | Notas |
|---|---|---|---|
| `conversation_id` | `^CONV-[0-9]{4,}$` | `CONV-0001` | Excepción de nombre en inglés (ver 1). |
| `cuenta_id` | `^CTA-[0-9]{3,}$` | `CTA-104` | Llave de la hoja `cuentas`. |
| `numero_caso` | `^CASO-[0-9]{5}$` o `null` | `CASO-58213` | `null` significa que el agente no generó caso. |
| `id_articulo` | `^KB-[0-9]{2}$` | `KB-03` | Artículo de la base de conocimiento. |
| `version_reglas` | `^reglas_(ce\|sales)_v[0-9]+$` | `reglas_ce_v1` | Identifica la **rúbrica** y su versión: tipo de interacción + versión de reglas JS, configuración y listas. `reglas_ce_v1` = rúbrica CE v1 (`rubrica.md`). |
| `version_prompt` | `^evaluador_(ce\|sales)_v[0-9]+$` | `evaluador_ce_v1` | Versión del prompt del evaluador (OpenAI) para ese tipo de interacción. |
| `version_prompt_generador` | `^generador_(ce\|sales)_v[0-9]+$` | `generador_ce_v1` | Versión del prompt del generador (Claude). |
| `modelo_generador` (hoja `escenarios`) | ID del modelo, o `contrato-datos / <modelo>` cuando la conversación la escribió el subagente | `contrato-datos / claude-opus-5-5` | El segundo formato solo aplica a lotes escritos por `contrato-datos` (`calibracion_v1`). |
| `lote` | `^(demo\|calibracion_v[0-9]+)$` | `calibracion_v1` | Llega como parámetro `?lote=` (ver sección 3). |
| `id_evaluacion` | `^EVAL-CONV-[0-9]{4,}-reglas_(ce\|sales)_v[0-9]+-evaluador_(ce\|sales)_v[0-9]+$` | `EVAL-CONV-0001-reglas_ce_v1-evaluador_ce_v1` | Derivado de la llave de deduplicación. |
| `llave_dedup` | `conversation_id\|version_reglas\|version_prompt` | `CONV-0001\|reglas_ce_v1\|evaluador_ce_v1` | Llave de deduplicación de la ingesta. |
| `id_error` | `^ERR-[0-9]{8}-[0-9]{6}-[0-9]{3}$` | `ERR-20261021-100211-001` | Fecha, hora y consecutivo. |
| `id_alerta` | `^ALR-[0-9]{8}-[0-9]{6}-[0-9]{3}$` | `ALR-20261021-100211-001` | Fecha, hora y consecutivo. |
| `id_ejecucion_metricas` | `^MET-[0-9]{8}-[0-9]{6}$` | `MET-20261101-120000` | Una ejecución del Workflow 3. |
| `timestamp` (mensaje) | `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$` | `2026-10-21T10:02:11` | Hora local sin zona. La zona está en `config.zona_horaria`. |
| marca de tiempo del sistema | ISO 8601 con desfase: `YYYY-MM-DDTHH:MM:SS±HH:MM` | `2026-10-21T10:05:00-06:00` | Para `recibido_en`, `evaluado_en`, etc. |
| `rfc` | `^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$` | `GOMA850101AB3` | 12 caracteres (persona moral) o 13 (persona física). Datos siempre ficticios. |
| `telefono` | `^[0-9]{10}$` | `5512345678` | 10 dígitos, sin espacios ni lada internacional. |
| `correo` | correo electrónico estándar | `contacto@abarrotesluna.example` | Dominios ficticios (se recomienda `.example`). |

### Regla de IDs de criterios

- Sección: identificador simple. En la rúbrica CE: `apertura`, `empatia`, `diagnostico`, `solucion`, `comunicacion`, `recapitulacion`, `ayuda_adicional`, `cierre`.
- Subelemento: `<seccion>.<subelemento>`. Ejemplo: `apertura.saludo`.
- Validación de identidad: `identidad.<subelemento>`. Ejemplo: `identidad.pide_datos`. `identidad` no es una sección ponderada.
- Error crítico: `critico.<nombre>`. Ejemplo: `critico.no_genera_caso`.
- La lista completa de IDs de cada rúbrica está en su documento (`rubrica.md` para CE). Los IDs son estables: no se renombran entre versiones; si un criterio se elimina, su ID no se reutiliza.
- Los IDs son únicos **dentro de una rúbrica**. Una rúbrica de otro `tipo_interaccion` puede repetir un ID (por ejemplo `apertura.saludo`). Por eso, en hojas y métricas un criterio se identifica siempre con `version_reglas` + `id_criterio`.

### Regla de nombres de columnas de calificación humana (`revision_humana`)

Derivación determinista a partir del ID:
- Sección `<id_seccion>` → `h_seccion__<id_seccion>`. Ejemplo: `empatia` → `h_seccion__empatia`.
- Subelemento, identidad o crítico `<prefijo>.<nombre>` → `h_<prefijo>__<nombre>`, reemplazando el punto por doble guion bajo. Ejemplos: `apertura.toma_a_tiempo` → `h_apertura__toma_a_tiempo`; `critico.mala_actitud` → `h_critico__mala_actitud`; `identidad.pide_datos` → `h_identidad__pide_datos`.
- Inversa: quitar `h_` y reemplazar `__` por `.`. En las secciones, quitar `h_seccion__`.
- La regla es la misma para cualquier rúbrica. Cada `tipo_interaccion` con rúbrica activa tiene su hoja de revisión (ver `sheets.md`).

## 3. Campos del payload (Webhook de Ingesta)

| Campo | Tipo | Descripción |
|---|---|---|
| `conversation_id` | texto | Identificador único de la conversación. |
| `canal` | texto (enum `canal`) | Canal de atención. |
| `tipo_interaccion` | texto (enum `tipo_interaccion`) | Tipo de interacción. Determina qué rúbrica se aplica. En esta versión solo `ce` tiene rúbrica. |
| `agente` | texto | Nombre del agente tal como se presenta (por ejemplo `Mariana López`). |
| `cuenta_id` | texto | Cuenta del cliente en la hoja `cuentas`. |
| `metadatos_caso` | objeto | Datos que el agente registró en el sistema de casos. |
| `metadatos_caso.tipificacion_agente` | texto | Tipificación que eligió el agente. Debe compararse contra `catalogo_temas.tipificacion_valida`. |
| `metadatos_caso.numero_caso` | texto o `null` | Número de caso generado; `null` si no se generó. |
| `metadatos_caso.estado_caso` | texto (enum `estado_caso`) | Estado del caso al terminar la conversación. |
| `metadatos_caso.escalado` | booleano | Si el agente escaló el caso. |
| `metadatos_caso.campos_capturados` | objeto | Llave = nombre del campo del catálogo; valor = `presente` o `ausente`. |
| `mensajes` | arreglo | Mensajes de la conversación. |
| `mensajes[].n` | entero ≥ 1 | Número de mensaje, consecutivo desde 1. |
| `mensajes[].emisor` | texto (enum `emisor`) | Quién envía el mensaje. |
| `mensajes[].timestamp` | texto | Hora local sin zona. |
| `mensajes[].texto` | texto | Contenido del mensaje, sin enmascarar. |

**Lote:** no forma parte del payload. Llega como parámetro de consulta del webhook: `POST <url_webhook_ingesta>?lote=calibracion_v1`. Si no se envía, se usa `config.lote_por_defecto` (`demo`). Ingesta valida `lote` con el patrón de la sección 2 y lo guarda en `conversaciones.lote`.

**Rúbrica según `tipo_interaccion`:** Ingesta y Evaluación leen `version_reglas` y `version_prompt` de la fila de `config` con el `tipo_interaccion` de la conversación (ver `config.md`, sección 0). Si el valor es `sin_rubrica` (hoy, `sales`), el payload es válido pero no se evalúa (ver `sheets.md`, hoja `conversaciones`).

**Carga de hojas de referencia por tipo:**
- En `config`, se leen las filas del tipo concreto y las de `todos`. Si una clave existe en ambas, gana la del tipo concreto.
- En `listas`, `catalogo_temas` y `base_conocimiento` se cargan las filas del tipo concreto **unidas** a las de `todos`. No hay precedencia: se usan todas.

**Limitaciones (SUPUESTO):**
- Las conversaciones `sales` recibidas antes de la Fase 5b no se guardan en `conversaciones`; solo quedan en `log_errores`. Para evaluarlas después, hay que reenviarlas al webhook.
- El formulario del simulador (W0) deberá incluir el campo `tipo_interaccion` (Fase 2).

## 4. Enumeraciones (valores permitidos)

| Enumeración | Valores | Dónde se usa |
|---|---|---|
| `canal` | `chat` | payload, `conversaciones`, claves de tiempos en `config`. Otros canales se agregarán con su propio bloque de tiempos. |
| `tipo_interaccion` | `ce`, `sales` | payload, `conversaciones`, `escenarios`, `revision_humana`, `evaluaciones`, `metricas`. Valores en inglés a propósito (ver 1). |
| `ambito_tipo_interaccion` | `todos`, `ce`, `sales` | columna `tipo_interaccion` de `config`, `listas`, `catalogo_temas`, `base_conocimiento`. `todos` = la fila aplica a cualquier tipo. |
| `emisor` | `cliente`, `agente` | payload |
| `estado_caso` | `abierto`, `en_seguimiento`, `cerrado`, `sin_caso` | payload. `sin_caso` si y solo si `numero_caso` es `null` (SUPUESTO). |
| `campo_capturado` | `presente`, `ausente` | `metadatos_caso.campos_capturados` |
| `lote` | `demo`, `calibracion_v1`, `calibracion_v2`, ... | parámetro `?lote=`, hojas |
| `estado_conversacion` | `pendiente`, `en_evaluacion`, `evaluada`, `error` | `conversaciones.estado` |
| `estado_revision` | `pendiente`, `calificada` | `revision_humana.estado_revision` |
| `resultado_subelemento` | `cumple`, `no_cumple`, `no_aplica` | subelementos de sección y de identidad (sistema y humano) |
| `resultado_seccion` | `cumple`, `parcial`, `no_cumple`, `no_aplica` | secciones (sistema y humano) |
| `resultado_critico` | `detectado`, `no_detectado` | errores críticos en `detalle_criterios` y en la evaluación |
| `valor_humano_critico` | `si`, `no` | columnas `h_critico__*` de `revision_humana` |
| `origen` | `JS`, `LLM`, `HIBRIDO` | rúbrica, `detalle_criterios`, métricas |
| `clasificacion` | `clave`, `complementario`, `informativo` | subelementos de sección (ver `rubrica.md`) |
| `tipo_criterio` | `seccion`, `subelemento`, `identidad`, `critico` | `detalle_criterios`, evaluación (`seccion` solo en `detalle_criterios`) |
| `calidad_esperada` | `buena`, `regular`, `mala` | `escenarios`; también la calidad derivada de la nota humana en métricas. Definición en `rubrica.md`, sección 2.4. |
| `calidad_solicitada` | `buena`, `regular`, `mala`, `aleatoria` | formulario del simulador (antes de resolver `aleatoria`) |
| `caso_dificil` | `amable_no_resuelve`, `resuelve_tono_seco`, `critico_escondido`, `tipificacion_incorrecta`, `validacion_fuera_de_orden` | `escenarios` |
| `emocion` | `neutral`, `confusion`, `preocupacion`, `frustracion`, `enojo`, `satisfaccion` | Rúbrica `ce`: salida del LLM y `evaluaciones` (la valida JS-5; `evaluacion.schema.json` no la fija). Vacía si `sin_mensajes_agente`. |
| `gravedad_ortografia` | `grave`, `menor` | salida del LLM (definición en `rubrica.md` 3.5) |
| `requiere_escalamiento` | `si`, `no`, `segun_caso` | `catalogo_temas` |
| `tipo_alerta` | `operativa`, `calidad`, `costo`, `calibracion` | `alertas` |
| `modo_envio` | `inmediato`, `resumen_lote` | `alertas` |
| `estado_envio` | `enviada`, `fallida` | `alertas` |
| `tipo_error` | `payload_invalido`, `tipo_interaccion_sin_rubrica`, `evaluacion_sin_secciones_aplicables`, `respuesta_llm_invalida`, `fallo_nodo`, `fallo_api`, `fallo_sheets`, `fallo_telegram`, `generacion_invalida` | `log_errores` |
| `workflow` | `simulador`, `ingesta`, `evaluacion`, `errores`, `metricas` | `log_errores`, `alertas` |
| `generado_por` | `simulador`, `contrato-datos` | `escenarios` |
| `tipo_dato_config` | `entero`, `decimal`, `texto`, `booleano`, `lista` | `config.tipo` |
| `tipo_lista` | `frase_criterio`, `termino_prohibido`, `frase_negativa`, `vicio_lenguaje`, `palabra_altisonante`, `sigla_permitida` | `listas.tipo_lista` |
| `giro` | `comercializadora`, `servicios_profesionales`, `restaurante`, `manufactura`, `construccion`, `transporte_logistica`, `salud` | `cuentas.giro`. Los cuatro últimos son SUPUESTO. |
| `tamano` | `micro`, `pequena`, `mediana` | `cuentas.tamano` |
| `ambito_metrica` | `global`, `origen`, `seccion`, `subelemento`, `critico`, `operacion`, `generador` | `metricas.ambito` |
| `nombre_metrica` | `acuerdo`, `kappa_cohen`, `falsos_positivos`, `falsos_negativos`, `diferencia_promedio_nota`, `precision_criticos`, `recall_criticos`, `costo_promedio_evaluacion`, `tasa_fallos`, `acuerdo_generador_humano` | `metricas.nombre_metrica`, `alertas.nombre_metrica` |

### `clave_lista` (hoja `listas`)

Agrupa frases o términos que usa una regla JS. Cada fila de `listas` tiene una `clave_lista`. Las de esta tabla pertenecen a la rúbrica CE.

| `clave_lista` | `tipo_lista` | Regla que la usa |
|---|---|---|
| `saludo` | `frase_criterio` | `apertura.saludo` |
| `bienvenida` | `frase_criterio` | `apertura.bienvenida` |
| `ofrece_ayuda` | `frase_criterio` | `apertura.ofrece_ayuda` |
| `aviso_privacidad` | `frase_criterio` | `apertura.aviso_privacidad` |
| `pide_nombre_cliente` | `frase_criterio` | `apertura.nombre_cliente` |
| `pide_espera` | `frase_criterio` | `comunicacion.pide_espera` y detección de episodios de espera |
| `agradece_espera` | `frase_criterio` | `comunicacion.agradece_espera` |
| `continua_espera` | `frase_criterio` | `comunicacion.retoma_a_tiempo`, `comunicacion.no_excede_espera` |
| `palabra_solucion` | `frase_criterio` | `recapitulacion.uso_solucion_seguimiento` |
| `palabra_seguimiento` | `frase_criterio` | `recapitulacion.uso_solucion_seguimiento` |
| `recordatorio_inactividad` | `frase_criterio` | `recapitulacion.recordatorio_inactividad` |
| `cierre_inactividad` | `frase_criterio` | `recapitulacion.cierre_inactividad`, `critico.abandono` |
| `ayuda_adicional` | `frase_criterio` | `ayuda_adicional.ofrece_ayuda_adicional` |
| `encuesta` | `frase_criterio` | `ayuda_adicional.encuesta`, `ayuda_adicional.encuesta_caso_cerrado` |
| `canales_horarios` | `frase_criterio` | `ayuda_adicional.canales_horarios` |
| `campana_vigente` | `frase_criterio` | `ayuda_adicional.campana_vigente` |
| `agradecimiento_cierre` | `frase_criterio` | `cierre.agradece` |
| `frase_cortesia` | `frase_criterio` | `cierre.frase_cortesia` |
| `despedida` | `frase_criterio` | `cierre.despedida`, `critico.abandono` |
| `pide_datos_identidad` | `frase_criterio` | `identidad.pide_datos` |
| `declina_validacion` | `frase_criterio` | `identidad.datos_coinciden` |
| `plazo_seguimiento` | `frase_criterio` | `solucion.seguimiento_en_plazo` (expresión regular que captura el número, el rango y la unidad) |
| `termino_prohibido` | `termino_prohibido` | `comunicacion.tecnicismos` (tecnicismos y nombres de sistemas internos) |
| `frase_negativa` | `frase_negativa` | `comunicacion.frases_negativas` |
| `vicio_lenguaje` | `vicio_lenguaje` | `comunicacion.vicios_lenguaje` |
| `palabra_altisonante` | `palabra_altisonante` | `critico.palabras_altisonantes` |
| `sigla_permitida` | `sigla_permitida` | `empatia.mayusculas_sostenidas` (siglas que no cuentan como mayúsculas sostenidas: RFC, CFDI, SAT, UUID...) |

La marca (`apertura.marca`, `cierre.marca`) no usa lista: se toma de `config.marca`. El nombre del agente se toma de `agente` del payload.

## 5. Clasificación de subelementos

- `clave`: si falla, la sección completa queda `no_cumple`.
- `complementario`: si falla, la sección baja a `parcial` (o a `no_cumple` por desempate; ver `rubrica.md`).
- `informativo`: se calcula y se guarda como evidencia, pero **no entra en la agregación** de la sección. Su resultado se registra con normalidad (`cumple`, `no_cumple`, `no_aplica`) y se ignora al agregar. Hoy solo `diagnostico.numero_preguntas` es informativo.

## 6. Enmascaramiento de datos personales

Antes de enviar la conversación al LLM, JS-2 reemplaza datos personales por marcadores. El mismo valor recibe siempre el mismo marcador dentro de una conversación; valores distintos reciben números distintos en orden de aparición.

| Marcador | Dato | Cómo se detecta |
|---|---|---|
| `[EMAIL_n]` | correo electrónico completo | expresión regular de correo |
| `[RFC_n]` | RFC completo | patrón de RFC de la sección 2 (sin distinguir mayúsculas) |
| `[TELEFONO_n]` | teléfono completo | 10 dígitos, admitiendo espacios, guiones o paréntesis |
| `[NOMBRE_n]` | nombre del titular de la cuenta | coincidencia (sin acentos ni mayúsculas) con `cuentas.titular` completo, con nombre de pila + apellido, o con el **nombre de pila solo** |

Reglas adicionales:
- **Canales oficiales:** los correos y teléfonos de `config.canales_oficiales_correos` y `config.canales_oficiales_telefonos` no son datos personales. No se enmascaran y no activan `critico.confidencialidad`.
- **Datos ya enmascarados parcialmente por el agente** (por ejemplo `j***@abarrotesluna.example`, `******5678`): no coinciden con los patrones de dato completo, así que no se reemplazan. Ver la regla de confidencialidad en `rubrica.md`.
- **Nombre de pila solo:** se enmascara como el mismo `[NOMBRE_n]` del titular. No se enmascara cuando coincide con el nombre de pila del agente dentro de un mensaje del agente, para no ocultar su presentación.

**Limitaciones documentadas:**
- Solo se detecta el nombre del titular de la cuenta. Otros nombres de personas (terceros, nombres mal escritos, apodos) no se detectan y llegan sin enmascarar al LLM.
- **Riesgo residual del nombre de pila solo:** un nombre de pila común (por ejemplo "Juan") puede coincidir con otra persona o con una palabra del texto, y se enmascara de más. También puede coincidir con el nombre del agente; en ese caso, los mensajes del cliente que lo mencionan quedan enmascarados y el LLM pierde ese contexto.
- El nombre del agente no se enmascara. Los números de caso se extraen pero no se enmascaran (no son dato personal).

## 7. Términos de scoring

| Término | Definición |
|---|---|
| `peso` | Ponderación de la sección (suma 100). |
| `factor` | Valor del resultado de sección: `cumple` = 1, `parcial` = `config.factor_parcial` (0.5), `no_cumple` = 0; `no_aplica` se excluye. |
| `nota_base` | Nota de 0 a 100 calculada con las secciones aplicables, renormalizada, **sin** considerar errores críticos. |
| `nota_final` | Nota oficial: 0 si hay al menos un error crítico detectado; si no, igual a `nota_base`. |
| `meta_calidad` | Meta de calidad (80). |
| `cumple_meta` | Compara `nota_final` con `meta_calidad` según `config.meta_comparacion_inclusiva` (por defecto ≥). |
| `calidad` (buena, regular, mala) | Banda derivada de `nota_final` y críticos (ver `rubrica.md` 2.4). |
| `primer_mensaje_info_cuenta` | Número del primer mensaje del agente que revela información de la cuenta del cliente (lo identifica el LLM). |
| `termina_por_inactividad` | `true` si hay un recordatorio de inactividad del agente, seguido de un cierre por inactividad del agente, sin mensajes del cliente entre ambos. Con `true`, JS impone `no_aplica` en `recapitulacion.recapitula`, `recapitulacion.uso_solucion_seguimiento` y toda la sección `ayuda_adicional` (ver `rubrica.md` 3.10). |
| abandono del agente | Mensaje del cliente sin respuesta posterior del agente, salvo que el agente ya se hubiera despedido o cerrado por inactividad antes de ese mensaje (`critico.abandono`). |
| `requiere` (escalamiento) | Si la conversación requiere escalamiento. Lo calcula JS con `catalogo_temas.requiere_escalamiento` y, cuando el catálogo dice `segun_caso`, con el insumo del LLM (ver `rubrica.md` 3.4). |
| episodio de espera | Bloque que inicia con un mensaje del agente que coincide con `pide_espera` y termina en el primer mensaje posterior del agente que no coincide con `continua_espera` ni con `pide_espera`. Si no hay tal mensaje, el episodio queda **abierto** y termina en el último mensaje de la conversación (ver `rubrica.md` 3.11). |
| retraso de respuesta | Intervalo mayor que `config.chat_umbral_espera_seg` entre un mensaje del cliente y el siguiente mensaje del agente, sin contar la primera respuesta. |
| silencio del cliente | Intervalo entre un mensaje del agente y el siguiente mensaje (de cualquiera) sin mensaje del cliente en medio, fuera de episodios de espera (ver `rubrica.md`, `recapitulacion.recordatorio_inactividad`). |
