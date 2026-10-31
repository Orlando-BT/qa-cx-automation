# Configuración (contrato)

Claves de la hoja `config` de Google Sheets. El código lee estos valores en tiempo de ejecución; ninguna regla, umbral, tiempo o precio se escribe fijo en el código. Estado: Fase 0 aprobada; cambios de Fase 1 aprobados por el dueño el 23-oct-2026; cambios de Fase 2 aprobados el 24-oct-2026.

Convenciones:
- `tipo` usa la enumeración `tipo_dato_config` del glosario: `entero`, `decimal`, `texto`, `booleano` (`si`/`no`), `lista` (valores separados por `|`).
- **Supuesto** = `si` cuando el valor no viene de `CLAUDE.md` ni de una decisión del dueño. Es editable y debe revisarse.
- **Ámbito** = valor de la columna `tipo_interaccion` de la fila en la hoja (`todos`, `ce`, `sales`). Se indica por sección.
- Marcadores especiales (ver glosario, sección 1):
  - `por_verificar`: el valor real se consulta en la documentación oficial del proveedor antes de ejecutar. No se inventa. Si un precio del evaluador está en `por_verificar`, JS-8 calcula tokens pero deja `costo_usd = null`, y no se puede evaluar la alerta de costo.
  - `pendiente_fase_1`: el valor se fija después de estimar costos en Fase 1. **Solo desactiva la alerta que depende de esa clave.** `costo_usd` se calcula normalmente si los precios están verificados.
  - `sin_rubrica`: el `tipo_interaccion` no tiene rúbrica activa.
- Formato en la hoja: una fila por combinación (`clave`, `tipo_interaccion`) (ver `sheets.md`, hoja `config`).

## 0. Rúbrica por tipo de interacción

Cómo se elige la rúbrica:
1. El payload trae `tipo_interaccion`.
2. Ingesta y Evaluación leen las filas de `config` con ese `tipo_interaccion`, más las filas con `todos`. Si una clave existe en ambas, gana la del tipo concreto. En `listas`, `catalogo_temas` y `base_conocimiento`, en cambio, se cargan las filas del tipo **unidas** a las de `todos`.
3. `version_reglas` identifica la rúbrica (`reglas_ce_v1` = rúbrica CE v1, `rubrica.md`). `version_prompt` identifica el prompt del evaluador de ese tipo.
4. Si `version_reglas` del tipo es `sin_rubrica`, la conversación no se evalúa (ver `sheets.md`, hoja `conversaciones`).

| Clave | Ámbito | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|---|
| `version_reglas` | `ce` | `reglas_ce_v1` | texto | Rúbrica CE y versión de reglas JS, configuración y listas de ámbito `ce`. Cambiar cualquier regla o umbral de evaluación implica subir la versión. | no |
| `version_prompt` | `ce` | `evaluador_ce_v1` | texto | Versión del prompt del evaluador CE. | no |
| `version_prompt_generador` | `ce` | `generador_ce_v3` | texto | v3 agrega el artículo del tema (ARTICULO_DEL_TEMA) y la guía filtrada de cómo fallar cada criterio pedido (GUIA_FALLAS); v1 y v2 quedan intactos. | no (decisión del dueño) |
| `esfuerzo_generador` | `ce` | `medium` | texto | Esfuerzo de razonamiento del generador (`output_config.effort`); `medium` es el valor por defecto de `claude-haiku-5-5`. El razonamiento se cobra como salida y cuenta dentro de `max_tokens_generador`; bajar a `low` si las respuestas se cortan por `max_tokens`. Valores permitidos: `low\|medium\|high\|xhigh\|max`. | si (valor por defecto del proveedor, a medir con el lote demo) |
| `generador_fallas_regular` | `ce` | `2` | entero | Cuántos subelementos complementarios, de secciones distintas, sortea JS (W0) para calidad `regular` cuando el formulario no los trae. Se descartan las combinaciones incompatibles (`rubrica.md` sección 8). | si |
| `generador_fallas_mala` | `ce` | `2` | entero | Cuántos subelementos clave sortea JS (W0) para calidad `mala`, además del crítico si hay. Se descartan las combinaciones incompatibles (`rubrica.md` sección 8). | si |
| `horario_atencion_chat` | `ce` | `lun-vie 08:00-20:00\|sab 09:00-14:00` | lista | Horario del chat, igual al de KB-08 (`datos/base_conocimiento.md`). JS sortea `FECHA_HORA_INICIO` del simulador dentro de él, en `zona_horaria`. Formato de cada elemento (separados por `\|`): `<dias> HH:MM-HH:MM`, donde `<dias>` es un día o un rango con guion, con días abreviados `lun`, `mar`, `mie`, `jue`, `vie`, `sab`, `dom` (ejemplos: `sab`, `lun-vie`), y las horas van en 24 h, inicio y fin con guion. Un día que no aparece está cerrado. | no (sale de KB-08) |
| `simulador_dias_atras` | `ce` | `30` | entero | La fecha sorteada del simulador cae entre hoy menos N días y ahora, nunca en el futuro. | si |
| `version_reglas` | `sales` | `sin_rubrica` | texto | La rúbrica de Sales llega en Fase 5b. | no (decisión del dueño) |
| `version_prompt` | `sales` | `sin_rubrica` | texto | Sin prompt de evaluador de Sales. | no (decisión del dueño) |
| `version_prompt_generador` | `sales` | `sin_rubrica` | texto | Sin prompt de generador de Sales. | no (decisión del dueño) |
| `tipos_interaccion_aceptados` | `todos` | `ce\|sales` | lista | Valores de `tipo_interaccion` que Ingesta acepta como válidos (el esquema ya los restringe). | no |

## 1. General y marca (ámbito `todos`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `marca` | `Contamix` | texto | Marca ficticia del software contable. Se busca en `apertura.marca`, `cierre.marca` y `critico.comentarios_negativos_marca`. | no (decisión del dueño) |
| `zona_horaria` | `America/Mexico_City` | texto | Zona de los timestamps locales de los mensajes y de las marcas de tiempo del sistema. También la usa el sorteo de fecha y hora del simulador. | no (decisión del dueño, 24-oct-2026) |
| `canales_habilitados` | `chat` | lista | Canales aceptados por Ingesta. | no |
| `lote_por_defecto` | `demo` | texto | Lote asignado si el webhook no recibe `?lote=`. | no (decisión del dueño) |
| `evaluar_al_ingerir_calibracion` | `no` | booleano | Si Ingesta llama a Evaluación al recibir una conversación con `?lote=calibracion_*`. Con `no`, la guarda como `pendiente` y se evalúa después con el disparador manual de W1 (ver sección 13). Las de `demo` siempre se evalúan al ingerir. Sustituye a la clave del borrador anterior que controlaba el envío del simulador: ahora el simulador siempre envía a Ingesta y esta clave decide si se evalúa. | no (decisión del dueño) |
| `simulador_max_conversaciones` | `5` | entero | Máximo de conversaciones por ejecución del simulador (ámbito `todos`). W0 rechaza cantidades mayores antes de llamar a la API. | si |

## 2. Scoring (ámbito `ce`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `meta_calidad` | `80` | decimal | Meta de calidad. | no |
| `meta_comparacion_inclusiva` | `si` | booleano | `si`: `cumple_meta` con nota igual a la meta (≥). `no`: se exige mayor (>). | si |
| `decimales_nota` | `2` | entero | Decimales al redondear `nota_base` y `nota_final` (mitad hacia arriba). | si |
| `umbral_desempate_complementarios` | `0.5` | decimal | Si la proporción de complementarios fallidos es mayor que este valor, la sección queda `no_cumple` (D1). | no (decisión D1) |
| `peso_apertura` | `5` | decimal | Peso de la sección. | no |
| `peso_empatia` | `10` | decimal | Peso de la sección. | no |
| `peso_diagnostico` | `15` | decimal | Peso de la sección. | no |
| `peso_solucion` | `35` | decimal | Peso de la sección. | no |
| `peso_comunicacion` | `13` | decimal | Peso de la sección. | no |
| `peso_recapitulacion` | `12` | decimal | Peso de la sección. | no |
| `peso_ayuda_adicional` | `5` | decimal | Peso de la sección. | no |
| `peso_cierre` | `5` | decimal | Peso de la sección. La suma de los 8 pesos debe ser 100; JS valida la suma al cargar config. | no |
| `factor_parcial` | `0.5` | decimal | Factor de una sección `parcial` (Parcial 50%). | no |
| `calidad_buena_nota_min` | `80` | decimal | `buena` si `nota_final` ≥ este valor y sin críticos (`rubrica.md` 2.4). | si (el dueño fijó la regla; el valor es editable) |
| `calidad_regular_nota_min` | `60` | decimal | `regular` si `nota_final` ≥ este valor, < `calidad_buena_nota_min` y sin críticos; debajo, o con un crítico, `mala`. | si (el dueño fijó la regla; el valor es editable) |

## 3. Tiempos por canal: chat (ámbito `ce`)

Todos en segundos, salvo que el nombre diga otra unidad. Los timestamps de los mensajes no tienen zona y se interpretan en `zona_horaria`.

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `chat_primera_respuesta_seg` | `60` | entero | Máximo entre el primer mensaje del cliente y el primer mensaje del agente (`apertura.toma_a_tiempo`, `critico.no_toma_a_tiempo`). | si |
| `chat_umbral_espera_seg` | `60` | entero | Retraso de respuesta: si el agente tarda más que esto en responder a un mensaje del cliente (sin contar la primera respuesta) sin anunciar la espera, falla `comunicacion.pide_espera`. | si |
| `chat_retomar_espera_seg` | `120` | entero | Máximo entre mensajes consecutivos del agente dentro de un episodio de espera (`comunicacion.retoma_a_tiempo`). | si |
| `chat_espera_maxima_seg` | `300` | entero | Duración máxima de un episodio de espera (`comunicacion.no_excede_espera`). | si |
| `chat_recordatorio_inactividad_seg` | `120` | entero | Silencio del cliente (fuera de episodios de espera) a partir del cual se debe enviar recordatorio (`recapitulacion.recordatorio_inactividad`). | si |
| `chat_cierre_inactividad_seg` | `120` | entero | Tiempo mínimo desde el recordatorio sin respuesta antes de cerrar por inactividad (`recapitulacion.cierre_inactividad`). | si |
| `seguimiento_plazo_max_horas_habiles` | `48` | entero | Plazo máximo que el agente puede comunicar cuando el caso no se cierra (`solucion.seguimiento_en_plazo`). La regla está aprobada; el valor 48 es supuesto. | si (solo el valor) |
| `horas_habiles_por_dia` | `9` | entero | Conversión de días a horas hábiles (ver `rubrica.md` 3.11). | si |

## 4. Ventanas de mensajes para reglas JS (ámbito `ce`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `apertura_mensajes_agente` | `2` | entero | Primeros N mensajes del agente donde se buscan saludo, bienvenida, marca, nombre y ofrecimiento de ayuda. | si |
| `apertura_privacidad_mensajes_agente` | `3` | entero | Primeros N mensajes del agente donde se busca el aviso de privacidad y el nombre del cliente si el agente no pide datos de identidad. | si |
| `cierre_mensajes_agente` | `3` | entero | Últimos N mensajes del agente donde se evalúan las secciones de ayuda adicional y cierre. | si |

## 5. Comunicación escrita (ámbito `ce`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `ortografia_umbral_graves` | `1` | entero | `comunicacion.ortografia` falla desde este número de errores graves. | no |
| `ortografia_umbral_menores` | `3` | entero | `comunicacion.ortografia` falla desde este número de errores menores. | no |
| `signos_apertura_max_omisiones` | `0` | entero | Omisiones de `¿`/`¡` toleradas; falla si se supera. | si |
| `mayusculas_min_palabras_consecutivas` | `3` | entero | Palabras seguidas en mayúsculas que cuentan como mayúsculas sostenidas. | si |
| `mayusculas_min_longitud_palabra` | `4` | entero | Longitud mínima de cada palabra para contar (evita siglas cortas). | si |

## 6. Validación de identidad (ámbito `ce`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `identidad_datos_comparables` | `correo\|rfc\|telefono\|titular` | lista | Datos que JS-2 extrae y compara contra la hoja `cuentas`. `titular` solo cuenta cuando coincide y nunca cuenta como incorrecto (`rubrica.md` sección 4). | si |
| `identidad_min_datos_correctos` | `2` | entero | Datos comparables distintos que el cliente debe acertar (coincidir con la hoja `cuentas`) para que la validación sea exitosa. Un dato que el cliente no sabe o no proporciona cuenta como no acertado. Los datos alternativos que el agente pida después de un dato fallido o desconocido cuentan para el mínimo. Si no se alcanza, el agente debe declinar y no dar información de la cuenta (`rubrica.md` sección 4). | no (decisión del dueño) |

Cambio de Fase 1 (decisión del dueño): `identidad_min_datos_correctos` sustituye a `identidad_min_datos_solicitados` y a `identidad_umbral_datos_incorrectos`, que se quitaron.
- `identidad_min_datos_solicitados` contaba datos **proporcionados**, correctos o no; con la regla nueva solo cuentan los acertados, así que quedaba redundante.
- `identidad_umbral_datos_incorrectos` hacía fallar la validación con 2 datos incorrectos aunque el cliente acertara 2 alternativos; eso contradice la regla nueva, en la que los datos alternativos cuentan para el mínimo. Los datos incorrectos ya no cambian el resultado; se registran solo como evidencia.

## 6b. Confidencialidad: canales oficiales y enmascarado parcial (ámbito `ce`)

Los contactos oficiales de la marca y los RFC genéricos (`rfc_genericos_permitidos`) pueden mencionarse sin activar `critico.confidencialidad`, y JS-2 no los enmascara. Son valores **ficticios**: el dominio usa el TLD reservado `.example` (RFC 2606) para garantizar que no es un dominio real. No se deben reemplazar por dominios o teléfonos reales en el repositorio.

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `canales_oficiales_correos` | `soporte@contamix.example\|facturacion@contamix.example\|pagos@contamix.example` | lista | Correos oficiales permitidos. Se comparan sin distinguir mayúsculas. | si |
| `canales_oficiales_telefonos` | `5550001000\|5550002000` | lista | Teléfonos oficiales permitidos (10 dígitos, ficticios, prefijo 555 de uso ilustrativo). Se comparan solo dígitos. | si |
| `rfc_genericos_permitidos` | `XAXX010101000\|XEXX010101000` | lista | RFC genéricos del SAT (público en general y extranjeros). Igual que los canales oficiales: JS-2 no los enmascara y no activan `critico.confidencialidad`. Se comparan en mayúsculas. | no (decisión del dueño) |
| `enmascarado_caracter` | `*` | texto | Carácter que el agente usa para ocultar parte de un dato de la cuenta. | si |
| `enmascarado_correo_visibles_inicio` | `1` | entero | Caracteres visibles al inicio de la parte local del correo; dominio completo visible. Ejemplo: `j***@abarrotesluna.example`. | si |
| `enmascarado_telefono_visibles_final` | `4` | entero | Dígitos visibles al final del teléfono. Ejemplo: `******5678`. | si |
| `enmascarado_rfc_visibles_final` | `3` | entero | Caracteres visibles al final del RFC. Ejemplo: `**********AB3`. | si |

Regla (`rubrica.md`, `critico.confidencialidad`): tras una validación exitosa, el agente solo puede mencionar el correo, el teléfono o el RFC registrados con este enmascarado parcial. El dato completo, o un dato con más caracteres visibles, activa el crítico. Las conversaciones `buenas` del lote de calibración deben respetarlo.

## 7. Ayuda adicional (ámbito `ce`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `campana_vigente_activa` | `si` | booleano | Si hay campaña vigente que el agente debe mencionar (`ayuda_adicional.campana_vigente`). La campaña y sus condiciones se describen en la base de conocimiento (promociones autorizadas) y sus frases en `listas` con `clave_lista = campana_vigente`. | si |

## 8. Modelos (ámbito `todos`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `modelo_evaluador` | `gpt-6-luna` | texto | Modelo económico de OpenAI con salida estructurada estricta. Verificado con la prueba A del 23-oct-2026 (aceptó `llm_output.schema.json` en modo estricto). | no |
| `modelo_generador` | `claude-haiku-5-5` | texto | Modelo económico de Anthropic para el simulador. Verificado el 24-oct-2026 en platform.claude.com/docs/en/about-claude/models/overview; proveedor (Anthropic) distinto al evaluador (OpenAI). | no (decisión del dueño) |
| `llm_temperatura` | `0` | decimal | Temperatura del evaluador. No aplica a `gpt-6-luna`: no se envía (la prueba A del 23-oct-2026 mostró que ese modelo rechaza `temperature`). La fila se conserva para modelos que sí la acepten. | no |
| `llm_esfuerzo_razonamiento` | `none` | texto | Esfuerzo de razonamiento que se envía al evaluador (`reasoning.effort`). Fijado con la prueba A del 23-oct-2026: `gpt-6-luna` rechaza `temperature`, así que se usa el esfuerzo mínimo aceptado (`none`) y no se envía `llm_temperatura`. | no |
| `claves_esquema_excluidas_evaluador` |  | lista | Claves del esquema de salida (`llm_output.schema.json`) que JS-4 quita antes de enviarlo a OpenAI. Vacía por defecto (celda vacía). Solo se llena con lo que demuestre una prueba real; la prueba A del 23-oct-2026 aceptó el esquema tal cual, así que queda vacía. | no |
| `max_tokens_generador` | `8000` | entero | Máximo de tokens de salida por llamada al generador del simulador (Claude). | si |
| `max_tokens_evaluador` | `8000` | entero | Tope de tokens de salida por llamada al evaluador (`max_output_tokens`). Valor igual al usado en la prueba B; se mantiene hasta resolver el bloque commentary en v2. No cambia `reglas_ce_v1` ni `evaluador_ce_v1`. | no (decisión del dueño) |
| `anthropic_version_api` | `2026-10-21` | texto | Valor del encabezado `anthropic-version` en las llamadas del simulador a la Messages API; versión vigente en platform.claude.com/docs/en/api/versioning (consultada 24-oct-2026). Con esta versión la API rechaza `temperature`, `top_p` y `top_k`. | no (decisión del dueño) |

## 9. Reintentos (ámbito `todos`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `reintentos_validacion_llm` | `2` | entero | Reenvíos a OpenAI con el error explicado cuando la respuesta no pasa JS-5. | no |
| `reintentos_respuesta_incompleta` | `1` | entero | Reintentos inmediatos (misma petición, sin mensaje de error) cuando la respuesta del evaluador llega incompleta (p. ej. cortada por `max_output_tokens`). Contador propio: no consume `reintentos_validacion_llm`. Si se vuelve a cortar, `respuesta_llm_invalida` con alerta, sin reproceso. | no (decisión del dueño) |
| `reintentos_conexion_api` | `3` | entero | Reintentos automáticos del nodo ante fallas de conexión (OpenAI, Claude). | si |
| `espera_entre_reintentos_ms` | `5000` | entero | Espera entre reintentos de conexión. | si |
| `reintentos_generacion` | `1` | entero | Reintentos del simulador si la conversación generada no pasa la validación de estructura. | no |
| `reproceso_max_intentos` | `3` | entero | Reenvíos máximos del workflow de reproceso a Evaluación por conversación en estado `reproceso`. W4 reenvía si `intentos` ≤ este valor (1 evaluación original + hasta este número de reenvíos); si no, pasa a `error` con alerta operativa. Nunca se borra. | si (solo el valor; el mecanismo es decisión del dueño) |
| `reproceso_intervalo_min` | `30` | entero | Minutos entre corridas programadas del workflow de reproceso. | si (solo el valor; el mecanismo es decisión del dueño) |
| `espera_maxima_reintento_ms` | `60000` | entero | Tope de la espera antes de un reintento por HTTP 429/5xx. Si `Retry-After` pide más, no se espera: la conversación va a la cola de reproceso como `fallo_api`. | si (solo el valor; el mecanismo es decisión del dueño) |
| `tiempo_maximo_peticion_llm_ms` | `180000` | entero | Tiempo máximo de cada petición HTTP a OpenAI o Claude antes de tratarla como timeout, que `clasificacion_http` reintenta como falla de red. Igual al usado en la prueba B (`TIEMPO_MAXIMO_MS` de `prompts/verificacion/verificar_openai.mjs`). | si |
| `evaluacion_tiempo_maximo_min` | `90` | entero | Una conversación en `en_evaluacion` con `actualizado_en` más viejo que esto se considera atascada y W4 la pasa a `reproceso`. Regla del dueño: debe ser mayor que el peor caso de duración de W2 más margen. Peor caso con los valores actuales: llamadas LLM = 1 + `reintentos_respuesta_incompleta` + `reintentos_validacion_llm` = 4; cada llamada ≤ (`reintentos_conexion_api` + 1) × `tiempo_maximo_peticion_llm_ms` + `reintentos_conexion_api` × `espera_maxima_reintento_ms` = 4 × 180 s + 3 × 60 s = 900 s; total 3600 s = 60 min. 90 min deja 50 % de margen. Una prueba de `reglas-js` lo comprueba con los valores de config. | si (el valor; la regla es del dueño) |

Nota (decisión del dueño, 24-oct-2026): los reintentos de conexión (`reintentos_conexion_api`, `espera_entre_reintentos_ms`) aplican solo a HTTP 429 y 5xx (y fallas de red o timeout), con espera, respetando `Retry-After` si llega. Cualquier otro 4xx no se reintenta y la conversación va a la cola de reproceso como `fallo_api`.

## 10. Costos (ámbito `todos`)

Los precios se expresan en USD por millón de tokens.

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `precio_entrada_usd_millon_evaluador` | `0.10` | decimal | Precio de tokens de entrada de `gpt-6-luna`. Verificado el 22-oct-2026 en developers.openai.com/api/docs/pricing. | no |
| `precio_salida_usd_millon_evaluador` | `0.50` | decimal | Precio de tokens de salida de `gpt-6-luna`. Verificado el 22-oct-2026 en developers.openai.com/api/docs/pricing. | no |
| `precio_entrada_usd_millon_generador` | `0.10` | decimal | Precio de tokens de entrada de `claude-haiku-5-5`. Verificado el 24-oct-2026 en platform.claude.com/docs/en/about-claude/pricing, tramo de prompts de hasta 100,000 tokens (por encima: 0.50); el generador no llega a ese tamaño. | no |
| `precio_salida_usd_millon_generador` | `0.50` | decimal | Precio de tokens de salida de `claude-haiku-5-5`. Verificado el 24-oct-2026 en platform.claude.com/docs/en/about-claude/pricing, tramo de prompts de hasta 100,000 tokens (por encima: 2.50); el generador no llega a ese tamaño. | no |
| `costo_estimado_por_evaluacion_usd` | `0.005` | decimal | PROVISIONAL (23-oct-2026), a recalcular con las 24 conversaciones de `calibracion_v1` en la Fase 4. Costo esperado de una evaluación; base de la alerta de costo relativo. Base de cálculo: prueba B real (gpt-6-luna, 0.10/0.50 USD por millón, 3 evaluaciones en 2 corridas): ~0.002 sin bloque commentary, ~0.005 con commentary. | no (decisión D4) |
| `multiplicador_alerta_costo` | `2` | decimal | Alerta de costo si `costo_usd > multiplicador × costo_estimado_por_evaluacion_usd`. | no (decisión D4) |
| `tope_costo_lote_usd` | `0.25` | decimal | PROVISIONAL (23-oct-2026), a recalcular con las 24 conversaciones de `calibracion_v1` en la Fase 4. Alerta de costo si el costo acumulado de un lote supera este tope. Base de cálculo: 24 × 0.005 = 0.12, con margen 2× para reintentos. | no (decisión D4) |

## 11. Calibración y métricas (ámbito `todos`)

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `umbral_acuerdo_global` | `0.80` | decimal | Alerta de calibración si el acuerdo global es menor. | no (decisión D4) |
| `umbral_diferencia_nota` | `5` | decimal | Alerta de calibración si la diferencia promedio absoluta de nota sistema-humano es mayor. | no (decisión D4) |
| `precision_criticos_referencia` | `0.95` | decimal | Meta de referencia de precisión de errores críticos. Solo se reporta; no dispara alerta. | no |
| `kappa_solo_informativo` | `si` | booleano | El kappa de Cohen se reporta sin alerta. | no (decisión D4) |

## 12. Alertas (ámbito `todos`)

Modo de las alertas de calidad: **se decide por el lote de la conversación**.
- `lote = demo` → modo simulador: envío inmediato.
- Cualquier otro lote (`calibracion_vN`) → modo lote: resumen al final de la ejecución.

En el envío inmediato, W2 no reenvía una alerta de calidad si la hoja `alertas` ya tiene una `enviada` para la misma conversación y el mismo crítico (regla en `sheets.md`, hoja `alertas`). Solo una alerta con `estado_envio = enviada` bloquea el reenvío; una `fallida` se reintenta. En modo `resumen_lote` no cambia nada. Si falla la lectura de la hoja `alertas`, W2 envía la alerta sin filtro, porque se prefiere una alerta repetida a una alerta de crítico perdida; esa falla queda en Executions de n8n, no en `log_errores`. Las tres son decisiones del dueño.

| Clave | Valor por defecto | Tipo | Descripción | Supuesto |
|---|---|---|---|---|
| `telegram_destinatario` | `<TELEGRAM_CHAT_ID>` | texto | Marcador. El dueño lo reemplaza en su hoja; nunca se sube un ID real al repositorio. El token del bot vive solo en las credenciales de n8n. | no |
| `alerta_calidad_modo_lote_demo` | `inmediato` | texto | Modo de envío de alertas de calidad cuando `lote = demo`. | no |
| `alerta_calidad_modo_otros_lotes` | `resumen_lote` | texto | Modo de envío de alertas de calidad para cualquier lote distinto de `demo`. | no |
| `alerta_tipo_interaccion_sin_rubrica` | `no` | booleano | Si se envía alerta operativa cuando llega una conversación de un tipo sin rúbrica (hoy `sales`). Con `no`, solo se registra en `log_errores`. | si |

## 13. Notas de diseño

- **D3, base de conocimiento:** en v1 el evaluador recibe toda la base de conocimiento en una sola llamada. Separar la clasificación del tema y la evaluación en dos llamadas queda como **hipótesis para v2**. Se decidirá con las métricas de acuerdo de `recapitulacion.tipificacion` y el costo por evaluación de v1.
- **Backlog / hipótesis v2: datos de terceros y críticos solo-LLM (decisión del dueño, 23-oct-2026):**
  - (a) Evaluar que el LLM juzgue de quién es un RFC (cuenta, receptor u otro tercero), con evidencia (número de mensaje y justificación), en lugar de la lista `dato_de_tercero` de v1. En v1 la regla del dueño sigue vigente: un dato que coincide con la cuenta nunca es de tercero.
  - (b) Medir los "críticos solo-LLM" (sobre todo la parte LLM de `critico.confidencialidad`) en la prueba B y en la calibración, como insumo para v2.
- **D4, alertas de costo:**
  - Costo relativo: se alerta por evaluación cuando el costo supera `multiplicador_alerta_costo` veces el costo estimado.
  - Costo absoluto: el tope por lote es PROVISIONAL (0.25 USD, fijado 23-oct-2026 con la prueba B) y se recalcula con las 24 conversaciones de `calibracion_v1` en la Fase 4.
- **Precios y costo (sin contradicciones con `evaluacion.schema.json`, `sheets.md` y `glosario.md`):**
  - Precios del evaluador en `por_verificar` → `costo_usd = null` (celda vacía en `evaluaciones.costo_usd`) y sin alertas de costo.
  - Evaluación sin llamada al LLM (conversación sin mensajes del agente, `rubrica.md` 3.12) → tokens `0`, `intentos_llm = 0`, `costo_usd = 0` y `modelo_evaluador` vacío.
  - Precios del generador en `por_verificar` → `escenarios.costo_generacion_usd` vacío.
  - `pendiente_fase_1` → solo se desactiva la alerta correspondiente; el costo se calcula.
  - `no_medido` → solo en `escenarios` (tokens y costo) de lotes escritos por `contrato-datos`.
  - Regla operativa: no se ejecuta un lote `calibracion_vN` mientras los precios del evaluador estén en `por_verificar`. CLAUDE.md exige estimar el costo antes de ejecutar. En `demo` sí se permite, con `costo_usd = null`.
- **Entrada de lotes de calibración (decisión del dueño):**
  1. Ingesta recibe `?lote=calibracion_*`. Valida, deduplica y guarda en `conversaciones` como `pendiente`. Si `evaluar_al_ingerir_calibracion = no`, no llama a Evaluación.
  2. `calibracion_v1` entra enviando cada JSON de `datos/lotes/calibracion_v1/` al webhook de Ingesta con `?lote=calibracion_v1`. Lotes posteriores entran desde el simulador.
  3. El disparador manual de W1 recibe `lote`, `version_reglas` y `version_prompt` (por defecto, los de `config` del `tipo_interaccion`).
     - Para cada `conversation_id` del lote sin fila con la nueva `llave_dedup`, crea esa fila en `conversaciones` como `pendiente`, copiando `mensajes_json` y metadatos de una fila existente de la misma conversación.
     - Luego evalúa una por una las filas `pendiente` del lote con esa versión.
     - Así se puede reevaluar el mismo lote con `evaluador_ce_v2` sin regenerar ni reenviar conversaciones.
- **Tipo de interacción sin rúbrica (SUPUESTO):** si llega `tipo_interaccion = sales` mientras `version_reglas` de `sales` es `sin_rubrica`:
  - el payload es válido y el webhook responde con acuse;
  - se registra en `log_errores` con `tipo_error = tipo_interaccion_sin_rubrica`;
  - no se guarda en `conversaciones` (no hay versión para formar la `llave_dedup`) y no se evalúa;
  - solo se envía alerta operativa si `alerta_tipo_interaccion_sin_rubrica = si`;
  - **limitación:** las conversaciones `sales` recibidas antes de la Fase 5b no quedan guardadas y deben reenviarse al webhook cuando exista la rúbrica;
  - el formulario del simulador (W0) deberá incluir el campo `tipo_interaccion` (Fase 2).
- **Verificaciones técnicas de Fase 1 (`evaluador-llm`):**
  - **Resuelto (prueba A, 23-oct-2026):** `llm_output.schema.json` usa `minimum` en un campo de tipo `["integer", "null"]` (`primer_mensaje_info_cuenta.mensaje_n`). `gpt-6-luna` aceptó el esquema tal cual en modo estricto. "Aceptado" significa que la API no rechazó el esquema; no garantiza que el modelo respete `minimum`, así que JS-5 sigue validando `mensaje_n ≥ 1` por su cuenta.
  - **Resuelto (M6, prueba A, 23-oct-2026):** OpenAI aceptó `$schema`, `title`, `minItems`, `pattern` y `minimum` en el esquema de salida estructurada. No hubo que quitar ninguna clave: `claves_esquema_excluidas_evaluador` queda vacía. Si un modelo futuro rechaza alguna clave, se agrega a esa lista (solo con lo que demuestre una prueba real) y JS-4 la quita antes de enviar.
  - **Resuelto (prueba A, 23-oct-2026):** `gpt-6-luna` rechaza `temperature` (HTTP 400, "Unsupported parameter: 'temperature' is not supported with this model.") y acepta `reasoning.effort = none` sin `temperature`. Por eso `llm_esfuerzo_razonamiento = none` y `llm_temperatura` no se envía con este modelo (la fila se conserva para modelos que la acepten).
  - `payload.schema.json` usa `propertyNames` e `if/then/else`. Son válidos en JSON Schema draft 2020-12, pero **no** son aptos para la salida estructurada del generador. El prompt del generador necesitará un esquema simplificado o validar después con JS (W0, paso 4).
  - El prompt del evaluador debe indicar qué mensajes citar en un `no_cumple` por omisión (cuando lo que falta es una acción del agente; por ejemplo, citar los mensajes del cierre o del tramo donde debía ocurrir). Así se cumple la regla 9 de JS-5 (`rubrica.md` 6.1), que exige `mensajes` no vacío.
- **Backlog Fase 5: número de caso como dato alternativo de identidad (requiere casos previos por cuenta, p. ej. desde HubSpot).** Hoy está RESERVADO e inactivo: no está en `identidad_datos_comparables`, no hay columnas ni hojas nuevas, y no cuenta para `identidad_min_datos_correctos` (`rubrica.md` sección 4). Activarlo exige un cambio de contrato aprobado por el dueño: casos previos por cuenta, una clave de lista y la regla de comparación.
- **Versión del generador (decisión del dueño, 24-oct-2026):** cada escenario guarda la versión del generador que lo produjo (`escenarios.version_prompt_generador`). `calibracion_v1` no salió del simulador (`no_aplica`) y no se afecta. El evaluador sigue en `evaluador_ce_v1`.
- **Cola de reproceso (decisión del dueño, 24-oct-2026):** W2 revisa `falla_api` antes que `valido`. Con `falla_api` registra `log_errores` (`tipo_error = fallo_api`), deja la conversación en `reproceso` y envía alerta operativa. El workflow de reproceso (W4; programado cada `reproceso_intervalo_min` y manual) la reenvía a W2, hasta `reproceso_max_intentos`. Ninguna conversación se pierde.
- **Manejo de respuestas del evaluador (decisión del dueño, 24-oct-2026; cambia respecto de Fase 1):**
  - Respuesta incompleta: 1 reintento inmediato (`reintentos_respuesta_incompleta`); si se vuelve a cortar, `tipo_error = respuesta_llm_invalida` con alerta operativa, sin reproceso.
  - Refusal del modelo: la conversación pasa a `error` con alerta operativa para revisión manual, sin cola de reproceso; `tipo_error = respuesta_llm_invalida` con causa `refusal`.
  - Ambos casos se cuentan como anomalías para la métrica de v2.
  - `fallo_api` (cola de reproceso) queda para salida ambigua, cuerpo inválido y fallas HTTP.
  - En Fase 1, ambos casos consumían reintentos de validación de JS-5.
- **Cambios y versiones:** cambiar una clave de ámbito `ce` (secciones 2 a 7) cambia el comportamiento de las reglas. Por eso se sube `version_reglas` de `ce`, y las métricas siempre se comparan dentro de la misma versión y del mismo lote.
- **Cambios de Fase 1 antes de la primera evaluación; `reglas_ce_v1` se congela al cerrar la Fase 1.** Como todavía no se ha evaluado ninguna conversación, los cambios aprobados el 23-oct-2026 (validación de identidad con `identidad_min_datos_correctos`, minutos fuera de los plazos de seguimiento, `numero_en_palabras`, RFC genéricos y exclusión de datos de terceros en `pide_datos_identidad`) se incorporan a `reglas_ce_v1` sin subir la versión. Cualquier cambio posterior al cierre de la Fase 1 sube la versión.
