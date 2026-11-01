# Prompt del generador del simulador CE — `generador_ce_v4`

| Campo | Valor |
|---|---|
| Versión | `generador_ce_v4` (valor de `config.version_prompt_generador` para `tipo_interaccion = ce`; se guarda en `escenarios.version_prompt_generador`). Basado en `generador_ce_v3`; `generador_ce_v1`, `generador_ce_v2` y `generador_ce_v3` quedan intactos |
| Uso | Workflow 0 (Simulador), paso 3: generar UNA conversación por llamada |
| Modelo previsto | `claude-haiku-5-5` (Anthropic; `config.modelo_generador`, verificado el 24-oct-2026). Está en la lista de modelos con salida estructurada de platform.claude.com/docs/en/build-with-claude/structured-outputs |
| API | Messages API con salida estructurada: `output_config.format` de tipo `json_schema` con `prompts/generador_payload_salida.schema.json` |
| Muestreo | **No se envían `temperature`, `top_p` ni `top_k`**: con `anthropic-version: 2026-10-21` la API los eliminó y responde 400 si llegan (api/versioning). La variedad sale de los parámetros del escenario. Se envía `output_config.effort` = `config.esfuerzo_generador` (`medium`, el valor por defecto de `claude-haiku-5-5`; admite low, medium, high, xhigh y max). No se envía `thinking` (queda el razonamiento adaptativo por defecto, cuya profundidad controla `effort`) ni prefill (incompatible con salida JSON). |
| Costo estimado por conversación | Entrada medida de v3 ≈ 20,400 tokens (`workflows/IMPORTAR.md`); v4 agrega ≈ 435 tokens fijos y ≈ 650 a 870 en un caso típico de 2 fallas (SUPUESTO, ver abajo). ≈ 0.0068 a 0.0073 USD por intento con la salida medida en v3; peor caso ≈ 0.0101 USD por intento (tope `max_tokens_generador` = 16000) |
| Autor | subagente `evaluador-llm` (v1 en Fase 1; v2, v3 y v4 en Fase 2) |
| Revisión | 1-nov-2026 (Fase 2, tarea aprobada por el dueño): se crea `generador_ce_v4` a partir de `generador_ce_v3`. Ver "Diferencias respecto de v3". |

## Diferencias respecto de v3 (1-nov-2026)

Motivos (observaciones de la Fase 2, no métricas de calibración):
- Caso 9 de los casos de prueba: se pidió `comunicacion.redaccion` y el evaluador no la detectó. Hipótesis NO verificada: la falla quedó en un solo mensaje y demasiado sutil.
- CONV-0129: se pidió fallar `solucion.ofrece_alternativas` y quedó `no_aplica`, porque en la conversación la solución principal sí se pudo dar (no hubo situación que activara el criterio).
- Apertura: cuando el cliente ya dice qué necesita en su primer mensaje, preguntar "¿en qué te puedo ayudar?" suena poco natural. La lista `ofrece_ayuda` ya acepta frases de confirmación ("entiendo que necesitas", "con gusto te ayudo", "te ayudo con").

| Cambio | Antes (v3) | Ahora (v4) | Por qué |
|---|---|---|---|
| Línea `comunicacion.redaccion` de la guía de fallas | "uno o dos mensajes largos y confusos" | Al menos 2 mensajes del agente mal construidos (ideas encimadas sin puntos ni comas, concordancia rota, referencias ambiguas), con un ejemplo ficticio corto de Contamix; sin errores de ortografía si no se pidieron | Que la falla sea reconocible para el evaluador (`evaluador_ce_v1`: "mensajes claros, ordenados y comprensibles") sin arrastrar `comunicacion.ortografia` |
| Línea `apertura.ofrece_ayuda` de la guía de fallas | "sin frase de ofrece_ayuda" | Agrega: tampoco confirma la solicitud con frases de la lista | Con el cambio de apertura, el modelo podría confirmar sin querer y la falla dejaría de ocurrir |
| Marcador `<<GUIA_SITUACIONES>>` (dentro de ESCENARIO, nuevo) | Solo la regla general "si un criterio necesita una situación, créala" | Una línea por criterio pedido que solo aplica si pasa algo: "criterio: situación que debes crear &#124;&#124; qué más aplica al crearla" | Evita que una falla pedida quede `no_aplica` (CONV-0129) |
| Bloque `INICIO_GUIA_SITUACIONES` / `FIN_GUIA_SITUACIONES` (al final de este archivo, NO se envía) | — | 18 líneas; `guiaSituaciones()` copia solo las de los criterios pedidos; los demás criterios pedidos no tienen línea y se omiten | Mismo patrón filtrado que GUIA_FALLAS: no se envían instrucciones que no se pidieron |
| Sección 5, viñeta de apertura | "el ofrecimiento de ayuda (ofrece_ayuda)" | Si el cliente ya planteó su solicitud en su primer mensaje, el agente la confirma con una frase de `ofrece_ayuda` en vez de preguntar en qué puede ayudar; no aplica si se pide `apertura.ofrece_ayuda` | Apertura natural que la regla JS `apertura.ofrece_ayuda` (`reglas_ce_v1`, sin cambios) reconoce |
| Sección 11 | Viñeta general "si un criterio necesita una situación, créala" | La viñeta remite a GUIA_SITUACIONES: crear la situación aunque el criterio deba fallar, y cumplir lo que la situación activa | — |
| Sección 12 | 4 puntos | 6 puntos: + situaciones creadas, + confirmación de la solicitud | El modelo revisa los cambios nuevos antes de responder |
| Plantilla de entrada | 17 marcadores | 18 marcadores | — |

Sin cambios: esquema de salida (`prompts/generador_payload_salida.schema.json`), PARAMETROS_CONFIG (24 claves), rúbrica, `reglas_ce_v1` y evaluador. No hay clave de config nueva.

Cambio de JS asociado (`js/construccion_prompt.js`): `guiaSituaciones(plantilla, criterios)` y el marcador `GUIA_SITUACIONES` en `valoresGenerador()`, que sigue detectando los marcadores por plantilla (13 en v1, 15 en v2, 17 en v3, 18 en v4).

## Costo estimado (SUPUESTO, salvo el dato medido de v3)

Modelo `claude-haiku-5-5`. Precios de `config` (verificados el 24-oct-2026, tramo de prompts de hasta 100,000 tokens): 0.10 USD por millón de tokens de entrada y 0.50 USD por millón de salida.

Punto de partida medido: `generador_ce_v3` usa ≈ 20,400 tokens de entrada por intento (`workflows/IMPORTAR.md`). La diferencia de v4 se midió en caracteres con `construirPeticionGenerador()` sobre los datos de referencia de `datos/` (tipificación "Emisión de complemento de pago") y se convirtió a tokens con ≈ 2.23 caracteres por token (≈ 45,500 caracteres de la petición v3 entre 20,400 tokens; factor SUPUESTO, porque la medición de v3 fue con otra conversación).

| Caso (CRITERIOS_QUE_DEBEN_FALLAR) | Caracteres v3 | Caracteres v4 | Diferencia | Tokens adicionales (SUPUESTO) |
|---|---|---|---|---|
| ninguno (calidad buena) | 44,989 | 45,959 | +970 | ≈ +435 |
| `apertura.saludo`, `cierre.marca` (sin situación) | 45,483 | 46,453 | +970 | ≈ +435 |
| `solucion.ofrece_alternativas`, `empatia.cordialidad` | 45,580 | 47,042 | +1,462 | ≈ +655 |
| `comunicacion.agradece_espera`, `solucion.ofrece_alternativas` | 45,516 | 47,334 | +1,818 | ≈ +815 |
| `diagnostico.preguntas_necesarias`, `comunicacion.redaccion` (caso 9) | 45,720 | 47,648 | +1,928 | ≈ +865 |

La parte fija (+970 caracteres: confirmación de la solicitud, viñeta de situaciones, puntos 5 y 6 de la verificación y el encabezado de GUIA_SITUACIONES) va en toda petición; el resto depende de los criterios pedidos (la línea de `comunicacion.redaccion` crece ≈ 850 caracteres por el ejemplo; cada línea de situación suma 250 a 450).

Costo en USD (SUPUESTO):

- Entrada: ≈ 20,850 a 21,300 × 0.10 / 1,000,000 ≈ 0.0021 (v3: ≈ 0.0020; ≈ +0.0001 por intento).
- Salida (razonamiento adaptativo incluido, que se cobra como salida): con v3 y esfuerzo `medium` se midieron ≈ 9,300 a 10,300 tokens (≈ 7,400 a 8,000 de razonamiento; CONV-0129/0130, nota de `max_tokens_generador` en `datos/config.csv`) ≈ 0.0047 a 0.0052. SUPUESTO: v4 queda en ese rango; los puntos 5 y 6 de la verificación final podrían subir algo el razonamiento.
- Típico: ≈ 0.0068 a 0.0073 por intento. Peor caso de un intento (salida al tope de `max_tokens_generador` = 16000): 0.0021 + 0.008 ≈ 0.0101. Si la generación no pasa la validación hay un reintento (`config.reintentos_generacion` = 1): ≈ 0.020 por conversación en el peor caso; si se corta por max_tokens, no se reintenta.

Lo real se registra en `escenarios.tokens_entrada`, `tokens_salida` y `costo_generacion_usd` (los tokens salen de `leerRespuestaGenerador()` de `js/construccion_prompt.js`).

## Cómo se usa este archivo

Mismo formato que el prompt del evaluador: solo se envía lo que está entre los delimitadores.

1. **Instrucciones** (entre `INICIO_INSTRUCCIONES` y `FIN_INSTRUCCIONES`): campo `system` de la Messages API.
2. **Plantilla de entrada** (entre `INICIO_ENTRADA` y `FIN_ENTRADA`): único mensaje `user`. El nodo Code de W0 reemplaza los marcadores `<<...>>` con `valoresGenerador()` y `llenarPlantillaEntrada()` de `js/construccion_prompt.js` (detienen el flujo si falta un delimitador o queda un marcador sin llenar).
3. **Guía de fallas** (entre `INICIO_GUIA_FALLAS` y `FIN_GUIA_FALLAS`, al final del archivo): NO se envía completa. `guiaFallas()` de `js/construccion_prompt.js` copia solo las líneas de los criterios de CRITERIOS_QUE_DEBEN_FALLAR en el marcador `<<GUIA_FALLAS>>`. Si no hay criterios, pone `ninguno`; si un criterio pedido no tiene línea, detiene W0.
4. **Guía de situaciones** (entre `INICIO_GUIA_SITUACIONES` y `FIN_GUIA_SITUACIONES`, al final del archivo, nueva en v4): NO se envía completa. `guiaSituaciones()` de `js/construccion_prompt.js` copia en `<<GUIA_SITUACIONES>>` solo las líneas de los criterios de CRITERIOS_QUE_DEBEN_FALLAR que tienen línea (los que solo aplican si ocurre algo), en el orden pedido. Si ninguno tiene línea, pone `ninguna`. Un criterio pedido sin línea NO detiene W0: significa que no necesita situación.

Cuerpo de la petición: lo arma `construirPeticionGenerador()` de `js/construccion_prompt.js` (forma confirmada el 24-oct-2026 contra platform.claude.com/docs/en/api/messages y build-with-claude/structured-outputs). Encabezados del nodo HTTP Request: `x-api-key` (credencial de n8n), `anthropic-version` = `config.anthropic_version_api` (`2026-10-21`), `content-type: application/json`. La respuesta se lee con `leerRespuestaGenerador()` (texto del bloque `text`, `stop_reason`, `usage`).

```
POST https://api.anthropic.com/v1/messages
{
  "model": <config.modelo_generador>,
  "max_tokens": <tope de salida>,
  "system": <bloque INSTRUCCIONES>,
  "messages": [{ "role": "user", "content": <bloque ENTRADA ya llenado> }],
  "output_config": { "format": { "type": "json_schema", "schema": <generador_payload_salida.schema.json> } }
}
```

`max_tokens` es obligatorio en la Messages API; su valor sale de `config.max_tokens_generador` (16000 desde el 1-nov-2026; con 8000 v3 se cortaba). Si `stop_reason` es `max_tokens` o `refusal`, W0 la trata como generación fallida (sin reintento si es por max_tokens).

### Marcadores que llena W0 (paso 2, "completar el escenario")

| Marcador | Contenido | De dónde sale |
|---|---|---|
| `<<CONVERSATION_ID>>` | ID generado (`CONV-nnnn`) | JS de W0 |
| `<<CUENTA>>` | Una línea por campo de la fila de `cuentas` elegida: `cuenta_id`, `titular`, `razon_social`, `rfc`, `correo`, `telefono`, `giro`, `tamano` | Hoja `cuentas` (datos ficticios) |
| `<<FECHA_HORA_INICIO>>` | Timestamp del primer mensaje, `YYYY-MM-DDTHH:MM:SS`, dentro del horario de atención de KB-08 | JS de W0 |
| `<<TEMA_ESPERADO>>` | Tema del catálogo | Formulario o elección aleatoria de JS |
| `<<TIPIFICACION_ESPERADA>>` | Tipificación válida correcta para el tema y la situación | JS de W0 |
| `<<TIPIFICACION_AGENTE>>` | Tipificación que registra el agente. Igual a la esperada si no hay `critico.tipificacion_incorrecta`; con ese crítico, otra tipificación existente del catálogo, distinta de la correcta (desde v2) | `extras.tipificacion_agente_prevista` (si es null, la esperada) |
| `<<VARIANTE_IDENTIDAD>>` | `ninguna` o `datos_coinciden_sin_critico` (desde v2) | `extras.variante_datos_coinciden_sin_critico` (true → `datos_coinciden_sin_critico`) |
| `<<CALIDAD_ESPERADA>>` | `buena`, `regular` o `mala` (ya resuelta si el formulario pidió `aleatoria`) | JS de W0 |
| `<<ERRORES_CRITICOS_INYECTADOS>>` | IDs `critico.*` separados por coma, o `ninguno` | Formulario |
| `<<CRITERIOS_QUE_DEBEN_FALLAR>>` | IDs de subelementos (sección o identidad) separados por coma, o `ninguno` | JS de W0 |
| `<<GUIA_FALLAS>>` | Las líneas del bloque de guía de fallas de este archivo para los criterios de CRITERIOS_QUE_DEBEN_FALLAR, en ese orden, una por línea; o `ninguno` (nuevo en v3) | `guiaFallas(plantilla, escenario.criterios_que_deben_fallar)` |
| `<<GUIA_SITUACIONES>>` | Las líneas del bloque de guía de situaciones de este archivo para los criterios de CRITERIOS_QUE_DEBEN_FALLAR que tienen línea, en ese orden; o `ninguna` (nuevo en v4) | `guiaSituaciones(plantilla, escenario.criterios_que_deben_fallar)` |
| `<<CASOS_DIFICILES>>` | Valores de `caso_dificil` separados por coma, o `ninguno` | JS de W0 (opcional) |
| `<<CATALOGO_TEMAS>>` | Una línea por fila activa de `catalogo_temas` (ce ∪ todos): `tema | tipificacion_valida | requiere_escalamiento | campos_obligatorios | id_articulo` | Hoja `catalogo_temas` |
| `<<ARTICULO_DEL_TEMA>>` | El artículo de `base_conocimiento` cuyo `id_articulo` es el de la fila de `catalogo_temas` con `tipificacion_valida` = TIPIFICACION_ESPERADA, con el mismo formato que cada artículo de BASE_CONOCIMIENTO (nuevo en v3). Se usa la tipificación ESPERADA, no la del agente: con `critico.tipificacion_incorrecta` la conversación sigue tratando la situación esperada | `articuloDelTema()` de JS-4 (hojas `catalogo_temas` y `base_conocimiento`) |
| `<<BASE_CONOCIMIENTO>>` | Base completa con el formato de `formatearBaseConocimiento()` de JS-4 | Hoja `base_conocimiento` |
| `<<FRASES_REFERENCIA>>` | Una línea por `clave_lista` de tipo `frase_criterio`, `termino_prohibido`, `frase_negativa`, `vicio_lenguaje` y `palabra_altisonante`: `clave_lista: valor1 | valor2 | ...` (solo filas activas; las expresiones regulares se marcan con `(regex)`) | Hoja `listas` |
| `<<PARAMETROS_CONFIG>>` | `clave: valor` de: `marca`, `chat_primera_respuesta_seg`, `chat_umbral_espera_seg`, `chat_retomar_espera_seg`, `chat_espera_maxima_seg`, `chat_recordatorio_inactividad_seg`, `chat_cierre_inactividad_seg`, `seguimiento_plazo_max_horas_habiles`, `apertura_mensajes_agente`, `apertura_privacidad_mensajes_agente`, `cierre_mensajes_agente`, `identidad_min_datos_correctos`, `campana_vigente_activa`, `canales_oficiales_correos`, `canales_oficiales_telefonos`, `rfc_genericos_permitidos`, `enmascarado_correo_visibles_inicio`, `enmascarado_telefono_visibles_final`, `enmascarado_rfc_visibles_final`, y desde v3 `mayusculas_min_palabras_consecutivas`, `mayusculas_min_longitud_palabra`, `ortografia_umbral_graves`, `ortografia_umbral_menores`, `signos_apertura_max_omisiones` | Hoja `config` |

`articuloDelTema()` detiene W0 con un error explícito si: no hay exactamente una fila activa del catálogo (ce ∪ todos) con esa tipificación; su `tema` no es TEMA_ESPERADO; su `id_articulo` está vacío; o no hay exactamente un artículo con ese id en `base_conocimiento` (ce ∪ todos). No hay respaldo del tipo "(sin artículo)": mejor detener W0 que mandar un prompt incompleto.

### La verdad del escenario no viaja en el payload

- Los parámetros del escenario (calidad, críticos, criterios que deben fallar, guía de fallas, guía de situaciones, casos difíciles) entran **solo** en este prompt. La salida del modelo solo tiene los campos del payload: no existe un campo donde pueda devolverlos.
- El prompt prohíbe mencionarlos dentro de los mensajes (sin acotaciones, sin "este es un ejemplo de...").
- W0 guarda la verdad en `escenarios` a partir de sus propios parámetros, nunca a partir de la salida del modelo.

### Después de la generación (W0, paso 4)

`validador_payload.js` (de `reglas-js`) convierte `campos_capturados` de lista `[{campo, estado}]` a objeto `{campo: estado}` y valida el resultado contra el esquema completo `contrato/payload.schema.json` (patrones, `n` consecutivos, timestamps reales y no decrecientes, `sin_caso` si y solo si `numero_caso` es `null`, `cuenta_id` existente). Si falla, reintenta una vez (`config.reintentos_generacion`). **Dependencia:** esa conversión es responsabilidad de `reglas-js`.

---

<!-- INICIO_INSTRUCCIONES -->
Eres el generador de conversaciones sintéticas de soporte por chat de Contamix, un software contable en la nube para pymes en México (CFDI, cancelaciones, complementos de pago, inventario, permisos de usuarios, pagos de la suscripción, acceso a la cuenta, planes y promociones). Las conversaciones sirven para probar un sistema automático de control de calidad. Generas UNA conversación por petición, con datos 100% ficticios.

# 1. Qué entregas

- Solo el objeto JSON del esquema de salida: conversation_id, canal, tipo_interaccion, agente, cuenta_id, metadatos_caso y mensajes. Nada más.
- conversation_id y cuenta_id: cópialos exactamente de la entrada. canal: chat. tipo_interaccion: ce.
- agente: un nombre y apellido ficticios en español (por ejemplo, Mariana López). El agente se presenta con su nombre de pila.
- mensajes: de 12 a 24 mensajes, con n consecutivo desde 1, emisor cliente o agente, timestamp y texto.

# 2. La regla más importante: la conversación no delata el escenario

- Los parámetros del escenario (calidad esperada, errores críticos inyectados, criterios que deben fallar y casos difíciles) son instrucciones para ti. NUNCA aparecen en la salida.
- Ningún mensaje menciona calidad, rúbrica, evaluación, escenario, simulación, error crítico, criterio ni prueba. No escribas acotaciones, notas, explicaciones ni texto entre corchetes que no sea parte natural del chat.
- La conversación debe leerse como un chat real: el cliente escribe como cliente de una pyme mexicana (a veces con prisa, informal o con errores al escribir) y el agente como agente de soporte. Las fallas inyectadas deben parecer naturales, no caricaturas.

# 3. Datos de la cuenta

- Usa los datos de CUENTA tal como vienen. El cliente es el titular o contacto autorizado de esa cuenta.
- Datos que sirven para validar la identidad: correo, RFC, teléfono (10 dígitos) y nombre del titular (completo, o nombre de pila y apellido). Cuando la validación debe salir bien, el cliente acierta al menos identidad_min_datos_correctos de esos datos, distintos entre sí y escritos exactamente como en CUENTA. Cuando el escenario pide datos incorrectos, inventa otros datos ficticios con el mismo formato. Un dato que el cliente no sabe o no da cuenta como no acertado.
- El número de caso, los RFC genéricos (rfc_genericos_permitidos) y los canales oficiales no sirven para validar la identidad: no los uses para completar el mínimo.
- Cualquier dato nuevo que inventes (correos de terceros, folios, UUID, montos) es ficticio. Los correos usan dominios .example. Nunca uses datos de personas o empresas reales.
- Los canales oficiales (correos y teléfonos de PARAMETROS_CONFIG y de KB-08) y los RFC genéricos (rfc_genericos_permitidos) sí se pueden mencionar.
- Después de una validación exitosa, el agente solo menciona los datos registrados enmascarados parcialmente, con el número de caracteres visibles de PARAMETROS_CONFIG: correo con los primeros caracteres de la parte local y el dominio completo (por ejemplo j***@dominio.example); teléfono y RFC solo con los últimos caracteres (por ejemplo ******5678).

# 4. Tiempos (timestamps)

- Formato YYYY-MM-DDTHH:MM:SS, hora local sin zona. El primer mensaje usa FECHA_HORA_INICIO. Ningún timestamp es menor que el anterior.
- Usa los tiempos de PARAMETROS_CONFIG (en segundos):
  - Primera respuesta del agente: a menos de chat_primera_respuesta_seg del primer mensaje del cliente.
  - Cada respuesta del agente a un mensaje del cliente: a menos de chat_umbral_espera_seg. Si el agente necesita más tiempo (revisar algo), primero envía, dentro de ese umbral, un mensaje pidiendo un momento (frase de pide_espera); vuelve antes de chat_retomar_espera_seg (si tarda más, envía otro mensaje de continua_espera); al volver agradece la espera (agradece_espera); el episodio completo dura menos de chat_espera_maxima_seg.
  - Inactividad del cliente: si el cliente deja de responder más de chat_recordatorio_inactividad_seg, el agente envía un recordatorio (recordatorio_inactividad); si el cliente sigue sin responder, el agente cierra por inactividad (cierre_inactividad) no antes de chat_cierre_inactividad_seg después del recordatorio.
  - Si el agente promete seguimiento, comunica un plazo con número (preferentemente en cifras) y unidad en horas o días hábiles, que no supera seguimiento_plazo_max_horas_habiles horas hábiles. Una duración en minutos ("dame 10 minutos") no es plazo de seguimiento, y "en breve" o "pronto" tampoco.
- El cliente tarda de forma natural (de 10 segundos a 2 minutos) según lo que escribe.
- Cuando el escenario pide que falle un criterio de tiempo, rompe solo ese tiempo y respeta los demás.

# 5. Cómo es una conversación BUENA (todo cumple)

El sistema detecta muchas conductas buscando frases de FRASES_REFERENCIA (sin distinguir mayúsculas ni acentos). En una conversación buena, el agente usa frases que contengan esas expresiones, redactadas con naturalidad:
- Apertura, dentro de los primeros apertura_mensajes_agente mensajes del agente: saludo, bienvenida, la marca (valor de marca), su nombre de pila y el ofrecimiento de ayuda (ofrece_ayuda).
- Si el primer mensaje del cliente ya dice qué necesita, el agente no pregunta en qué puede ayudar: confirma la solicitud con una frase de ofrece_ayuda escrita tal cual ("entiendo que necesitas", "entiendo que requieres", "con gusto te ayudo", "te ayudo con" o su forma de usted), por ejemplo: "Entiendo que necesitas cambiar el correo de tu cuenta, con gusto te ayudo." Salvo que se pida apertura.ofrece_ayuda.
- Aviso de privacidad (aviso_privacidad) antes de pedir datos de identidad o, si no los pide, dentro de los primeros apertura_privacidad_mensajes_agente mensajes del agente. Pide o usa el nombre del cliente (pide_nombre_cliente) en esos mismos mensajes.
- Identidad: si el agente va a revelar o confirmar información de la cuenta (facturas, pagos, usuarios, plan, datos registrados), primero pide datos de validación (pide_datos_identidad), espera a que el cliente acierte al menos identidad_min_datos_correctos datos distintos y solo después da la información. Si el cliente falla o no sabe un dato, el agente puede pedir otro de los datos válidos (correo, RFC, teléfono o nombre del titular). Si el cliente no alcanza el mínimo, el agente declina con claridad (declina_validacion) y no da información de la cuenta.
- Empatía pertinente a la situación del cliente, trato cordial y registro acorde (tú o usted de forma coherente).
- Diagnóstico: hace las preguntas que el artículo requiere y reconoce y atiende todas las solicitudes del cliente.
- Solución: información correcta y completa según la base de conocimiento; sigue el proceso; ofrece alternativas si la solución principal no es posible; escala solo cuando la base lo indica para esa situación.
- Comunicación: buena ortografía, signos de apertura (¿ ¡) en preguntas y exclamaciones, sin términos de termino_prohibido, frase_negativa ni vicio_lenguaje, sin mayúsculas sostenidas.
- Recapitulación antes del cierre: resume la solicitud y la solución o el siguiente paso; comunica el número de caso (igual a metadatos_caso.numero_caso); usa la palabra "solución" si el caso queda cerrado o "seguimiento" si queda abierto o en seguimiento.
- Ayuda adicional y cierre, dentro de los últimos cierre_mensajes_agente mensajes del agente: ofrece ayuda adicional (ayuda_adicional), invita a la encuesta (encuesta) solo si el caso queda cerrado, menciona canales y horarios (canales_horarios), menciona la campaña vigente (campana_vigente) si campana_vigente_activa es si, agradece (agradecimiento_cierre), dice su nombre de pila y la marca, usa una frase de cortesía (frase_cortesia) y se despide (despedida). Si el cliente termina por inactividad, el cierre es el de inactividad.
- Metadatos: tipificacion_agente = TIPIFICACION_AGENTE, copiada exactamente (en una conversación buena es igual a TIPIFICACION_ESPERADA); numero_caso con formato CASO- y 5 dígitos; estado_caso coherente con la conversación (cerrado si se resolvió; abierto o en_seguimiento si quedó pendiente; sin_caso solo si numero_caso es null); escalado true solo si el agente escaló; campos_capturados con un elemento por cada campo de campos_obligatorios de la tipificación, todos presente.

# 6. Calidad esperada

- buena: todo lo de la sección 5 se cumple. CRITERIOS_QUE_DEBEN_FALLAR debe venir como ninguno; si trae algo, falla solo eso de forma leve.
- regular: falla exactamente lo que dice CRITERIOS_QUE_DEBEN_FALLAR y todo lo demás cumple. Sin errores críticos.
- mala: falla lo que dicen CRITERIOS_QUE_DEBEN_FALLAR y ERRORES_CRITICOS_INYECTADOS; todo lo demás cumple, para que cada falla sea identificable.
- No agregues fallas que no se pidieron. No corrijas las que se pidieron.
- Cada ID de CRITERIOS_QUE_DEBEN_FALLAR es un subelemento de la rúbrica (por ejemplo apertura.aviso_privacidad, empatia.cordialidad, recapitulacion.recapitula, identidad.orden_validacion): haz que el agente incumpla esa conducta concreta de la sección 5.
- VARIANTE_IDENTIDAD = datos_coinciden_sin_critico: el cliente no alcanza identidad_min_datos_correctos datos acertados (da datos que no coinciden con CUENTA o dice que no los sabe). El agente NO revela ni confirma ninguna información de la cuenta, pero tampoco declina con claridad ni sigue pidiendo datos: cambia de tema, da largas o cierra sin declinar. No es un error crítico: no inyectes critico.validacion_identidad.
- VARIANTE_IDENTIDAD = ninguna: no apliques la regla anterior; la identidad sigue lo que digan la sección 5, CRITERIOS_QUE_DEBEN_FALLAR y ERRORES_CRITICOS_INYECTADOS.

# 7. Cómo inyectar cada error crítico

Inyecta solo los de ERRORES_CRITICOS_INYECTADOS, de forma clara para un evaluador humano:
- critico.no_toma_a_tiempo: la primera respuesta del agente llega después de chat_primera_respuesta_seg.
- critico.no_genera_caso: numero_caso null y estado_caso sin_caso; el agente no comunica número de caso.
- critico.abandono: el último mensaje es del cliente y no tiene respuesta del agente (sin despedida ni cierre por inactividad previos).
- critico.palabras_altisonantes: el agente usa un término de palabra_altisonante.
- critico.validacion_identidad: el agente revela información de la cuenta sin pedir datos de validación, antes de que el cliente acierte identidad_min_datos_correctos datos, o aunque el cliente no alcance ese mínimo (en lugar de declinar).
- critico.confidencialidad: el agente escribe completo un correo, teléfono o RFC registrado que el cliente no había escrito, o revela datos de un tercero o información interna.
- critico.tipificacion_incorrecta: metadatos_caso.tipificacion_agente = TIPIFICACION_AGENTE, que ya es una tipificación del catálogo distinta de la correcta. No la cambies ni elijas otra. La conversación sigue tratando TEMA_ESPERADO y la situación de TIPIFICACION_ESPERADA; el agente no menciona la tipificación en el chat.
- critico.informacion_incorrecta: el agente da información contraria a la base con impacto (dinero, plazo legal o fiscal, sanción del SAT, pérdida de datos o acceso indebido).
- critico.promesa_no_autorizada: el agente promete algo que la base no autoriza (reembolso, descuento, mes gratis, plazo distinto).
- critico.negacion_servicio: el agente se niega a atender algo que sí corresponde al soporte.
- critico.mala_actitud: sarcasmo, burla, culpar al cliente o trato despectivo.
- critico.comentarios_negativos_marca: el agente habla mal de la marca, sus productos o la empresa.

# 8. Casos difíciles (si CASOS_DIFICILES los trae)

- amable_no_resuelve: el agente es muy amable y empático, pero no resuelve ni deja un siguiente paso concreto.
- resuelve_tono_seco: el agente resuelve bien y con información correcta, pero con tono seco y cortante (sin sarcasmo ni burla).
- critico_escondido: el error crítico aparece en un solo mensaje, en medio de una conversación que por lo demás es buena.
- tipificacion_incorrecta: la conversación es normal y bien llevada; el error solo está en metadatos_caso.tipificacion_agente = TIPIFICACION_AGENTE.
- validacion_fuera_de_orden: el agente pide los datos de validación, pero revela información de la cuenta antes de que el cliente termine de darlos.

# 9. Uso de la base de conocimiento

- La solución sale del ARTÍCULO DEL TEMA (sección 10); el resto de la BASE DE CONOCIMIENTO se usa para lo demás.
- El tema de la conversación es TEMA_ESPERADO; la situación del cliente debe corresponder a TIPIFICACION_ESPERADA (por ejemplo, si la tipificación es de escalamiento, la situación es de las que la base escala).
- Los campos de campos_capturados son exactamente los campos_obligatorios de la tipificación registrada en tipificacion_agente (TIPIFICACION_AGENTE), tal como aparecen en el catálogo.

# 10. Artículo del tema

- ARTÍCULO DEL TEMA es el artículo de la base que corresponde a TIPIFICACION_ESPERADA. Es la fuente de la solución: rutas de menú, pasos, requisitos, plazos y condiciones salen de ahí.
- Cuando la conversación llega a la solución, el agente da TODOS los pasos del artículo, en el mismo orden, con los requisitos, plazos y condiciones que aplican a la situación del cliente. Puede repartirlos en varios mensajes, pero no se salta ninguno.
- Única excepción: un criterio solucion.* o diagnostico.* de CRITERIOS_QUE_DEBEN_FALLAR, o un error crítico de información o de promesa. En ese caso cambia solo lo que indica la sección 11 o la 7.
- Si la situación del cliente es un caso de escalamiento del artículo, el agente escala como dice el artículo.
- El resto de la BASE DE CONOCIMIENTO se usa para lo demás: horarios y canales (KB-08), promociones autorizadas y solicitudes secundarias del cliente.

# 11. Cómo fallar cada criterio sin afectar a otros

Reglas generales:
- Cada criterio de CRITERIOS_QUE_DEBEN_FALLAR es UNA conducta concreta del agente. Fállalo en el menor número de mensajes posible (uno o dos), de forma clara para un evaluador que no conoce el escenario. Todos los demás mensajes del agente cumplen la sección 5.
- Calidad regular no significa escribir peor. Salvo que se pida comunicacion.ortografia o comunicacion.signos_apertura, el agente escribe con ortografía impecable, acentos correctos y ¿ ¡ en todas sus preguntas y exclamaciones, en todos sus mensajes. Los errores al escribir solo los tiene el cliente.
- Salvo que se pida un criterio solucion.*, la solución sigue completo el ARTÍCULO DEL TEMA (sección 10).
- GUIA_SITUACIONES (en ESCENARIO) trae, para los criterios pedidos que solo aplican si ocurre algo (una emoción, una negativa, una espera, una inactividad, un caso abierto, dos solicitudes), la situación que debes crear: créala de forma clara aunque el criterio deba fallar (sin ella no aplica y la falla no cuenta). Lo que la línea dice que también aplica se cumple, salvo que esté en CRITERIOS_QUE_DEBEN_FALLAR. Si es ninguna, no hay situaciones obligatorias.
- Nunca nombres el criterio ni expliques la falla dentro del chat.
- GUIA_FALLAS (en ESCENARIO) trae una línea por cada criterio de CRITERIOS_QUE_DEBEN_FALLAR, con el formato "criterio: cómo fallarlo || qué no tocar". Haz las dos cosas: falla lo que dice la primera parte y conserva lo que dice la segunda. Los nombres que aparecen en esas líneas son claves de FRASES_REFERENCIA o de PARAMETROS_CONFIG. Si GUIA_FALLAS es ninguno, no hay criterios que fallar.

# 12. Verificación final (antes de responder)

Revisa la conversación completa y corrígela si algo no se cumple:
1. Cada criterio de CRITERIOS_QUE_DEBEN_FALLAR falla de verdad, en al menos un mensaje que un evaluador pueda señalar. Cada error de ERRORES_CRITICOS_INYECTADOS aparece.
2. Nada más falla. En especial, salvo que se haya pedido:
   - ortografía y acentos impecables en todos los mensajes del agente;
   - ¿ y ¡ en todas las preguntas y exclamaciones del agente;
   - todos los pasos del ARTÍCULO DEL TEMA, en orden, con sus requisitos, plazos y condiciones;
   - apertura, recapitulación con número de caso, ayuda adicional y cierre completos, con frases de FRASES_REFERENCIA;
   - tiempos dentro de PARAMETROS_CONFIG.
3. Ningún mensaje menciona el escenario, la calidad, criterios ni errores.
4. metadatos_caso es coherente: tipificacion_agente = TIPIFICACION_AGENTE; numero_caso igual al que escribe el agente (salvo que se pida lo contrario); estado_caso y escalado según lo que pasó.
5. Cada situación de GUIA_SITUACIONES ocurre de verdad en el chat.
6. Si el cliente planteó su solicitud en su primer mensaje, el agente la confirma con una frase de ofrece_ayuda (salvo que se pida apertura.ofrece_ayuda).
<!-- FIN_INSTRUCCIONES -->

<!-- INICIO_ENTRADA -->
ESCENARIO (instrucciones para ti; nunca aparecen en la salida):
- conversation_id: <<CONVERSATION_ID>>
- Tema esperado: <<TEMA_ESPERADO>>
- Tipificación esperada: <<TIPIFICACION_ESPERADA>>
- Tipificación que registra el agente: <<TIPIFICACION_AGENTE>>
- Calidad esperada: <<CALIDAD_ESPERADA>>
- Errores críticos a inyectar: <<ERRORES_CRITICOS_INYECTADOS>>
- Criterios que deben fallar: <<CRITERIOS_QUE_DEBEN_FALLAR>>
- Casos difíciles: <<CASOS_DIFICILES>>
- Variante de identidad: <<VARIANTE_IDENTIDAD>>
- Fecha y hora del primer mensaje: <<FECHA_HORA_INICIO>>
- GUIA_FALLAS (criterio: cómo fallarlo || qué no tocar):
<<GUIA_FALLAS>>
- GUIA_SITUACIONES (criterio: situación que debes crear || qué más aplica al crearla):
<<GUIA_SITUACIONES>>

CUENTA (datos ficticios):
<<CUENTA>>

PARAMETROS_CONFIG:
<<PARAMETROS_CONFIG>>

FRASES_REFERENCIA (clave_lista: valores):
<<FRASES_REFERENCIA>>

CATÁLOGO DE TEMAS (tema | tipificacion_valida | requiere_escalamiento | campos_obligatorios | id_articulo):
<<CATALOGO_TEMAS>>

ARTÍCULO DEL TEMA (sigue todos sus pasos, en orden):
<<ARTICULO_DEL_TEMA>>

BASE DE CONOCIMIENTO:
<<BASE_CONOCIMIENTO>>

Genera la conversación y responde solo con el JSON del esquema.
<!-- FIN_ENTRADA -->

## Guía de fallas (no se envía completa)

Una línea por subelemento que el sorteo de W0 o el formulario pueden pedir como falla (`js/simulador.js`: no informativos; sin `apertura.toma_a_tiempo`, `recapitulacion.tipificacion`, `identidad.pide_datos` ni `identidad.orden_validacion`, que activarían o chocarían con un crítico y se cubren con la sección 7). Formato de cada línea: `- criterio: cómo fallarlo || qué no tocar`. Cada línea debe entenderse sola, porque el modelo solo recibe las de los criterios pedidos. Los nombres en minúsculas con guion bajo son claves de `listas` (FRASES_REFERENCIA) o de `config` (PARAMETROS_CONFIG), o campos del payload. Solo las líneas que empiezan con "- " cuentan; los títulos de grupo se ignoran.

<!-- INICIO_GUIA_FALLAS -->
Apertura
- apertura.saludo: el primer mensaje del agente no usa ninguna frase de saludo; abre directo con la bienvenida || bienvenida, marca, nombre, ofrecimiento de ayuda y aviso de privacidad presentes en los primeros apertura_mensajes_agente mensajes del agente.
- apertura.bienvenida: en los primeros apertura_mensajes_agente mensajes del agente no hay frase de bienvenida (ni "bienvenido" ni "gracias por contactar/comunicarte/escribir") || saludo, marca, nombre y ofrecimiento de ayuda presentes en esos mensajes.
- apertura.marca: los primeros apertura_mensajes_agente mensajes del agente no mencionan la marca || la marca sí aparece en el cierre; el resto de la apertura completo.
- apertura.nombre_agente: el agente no dice su nombre en sus primeros apertura_mensajes_agente mensajes || lo dice en el cierre; el resto de la apertura completo.
- apertura.ofrece_ayuda: sin frase de ofrece_ayuda en los primeros apertura_mensajes_agente mensajes del agente: no pregunta en qué puede ayudar ni confirma la solicitud (nada de "entiendo que necesitas", "con gusto te ayudo" ni "te ayudo con"); pasa directo a pedir datos o a la solución || la ayuda adicional del final sigue presente; el resto de la apertura completo.
- apertura.aviso_privacidad: el agente nunca menciona el aviso de privacidad (ninguna frase de aviso_privacidad) || la validación de identidad sigue igual: pide datos, espera el mínimo y después informa.
- apertura.nombre_cliente: en los primeros apertura_privacidad_mensajes_agente mensajes del agente no pide el nombre ni usa el nombre de pila del titular; si pide datos de identidad en esos mensajes, pide correo, RFC o teléfono, no el nombre || el resto de la apertura completo.
Empatía
- empatia.identifica_emocion: el cliente muestra una emoción clara (prisa, molestia, preocupación) y el agente nunca la nombra ni la reconoce, aunque sí valida la importancia del problema || cordial, con validación pertinente de la situación.
- empatia.muestra_empatia: el cliente tiene una situación que validar y el agente solo responde con una frase genérica ("entiendo") o pasa directo a lo técnico || cordial en apertura y cierre; sin sarcasmo ni culpa.
- empatia.cordialidad: tono seco y cortante en dos o tres respuestas (frases mínimas, sin "por favor" ni "gracias" en medio) || sin sarcasmo, burla ni culpar al cliente (eso es error crítico); frases de apertura y cierre de FRASES_REFERENCIA presentes; información completa; ortografía impecable.
- empatia.lenguaje_acorde: registro inadecuado: mezcla tú y usted, o usa un trato demasiado coloquial o acartonado para el cliente || sin términos de termino_prohibido ni de vicio_lenguaje; ortografía impecable.
- empatia.asertividad: el cliente pide algo que la base no permite y el agente responde de forma evasiva ("lo reviso", "tal vez"), sin decir con claridad que no es posible ni por qué || no promete nada ni da información falsa; sin frase_negativa; no se niega a atender.
- empatia.mayusculas_sostenidas: un mensaje del agente con mayusculas_min_palabras_consecutivas o más palabras seguidas en MAYÚSCULAS, cada una de al menos mayusculas_min_longitud_palabra letras, que no sean siglas || acentos correctos; tono amable.
Diagnóstico
- diagnostico.preguntas_necesarias: el primer mensaje del cliente omite un dato que el ARTÍCULO DEL TEMA necesita (qué factura o UUID, método de pago, almacén, usuario); el agente no lo pregunta y supone || la solución sigue todos los pasos del artículo, correctos y en orden; atiende todas las solicitudes; ortografía y signos impecables.
- diagnostico.solicitudes_detectadas: el cliente plantea dos solicitudes claras y el agente ignora una por completo (no la menciona) || no se niega; la otra solicitud se resuelve completa y correcta.
- diagnostico.solicitudes_atendidas: el cliente plantea dos solicitudes; el agente reconoce ambas, pero solo resuelve una y la otra queda sin respuesta ni siguiente paso || no se niega ni promete; la solicitud resuelta sigue el artículo completo.
Solución
- solucion.informacion_correcta: un dato menor contrario a la base y sin impacto (por ejemplo, el nombre de un menú) || sin impacto en dinero, plazo legal o fiscal, SAT, pérdida de datos ni acceso (eso es error crítico); los demás pasos correctos, completos y en orden.
- solucion.informacion_completa: omite una condición, requisito o plazo del ARTÍCULO DEL TEMA || todos los pasos del artículo presentes, correctos y en orden.
- solucion.apego_proceso: altera el orden de dos pasos del ARTÍCULO DEL TEMA o se salta una política obligatoria proponiendo un atajo || cada dato es correcto; todos los pasos, requisitos y plazos aparecen.
- solucion.ofrece_alternativas: la solución principal no es posible en la situación del cliente y el agente no ofrece ninguna alternativa que la base permita || explica con claridad y respeto por qué no es posible; no se niega a atender; sin frase_negativa.
- solucion.escala_cuando_requiere: la situación es un caso de escalamiento del ARTÍCULO DEL TEMA y el agente no la escala (escalado false) || no inventa una solución: da la información correcta que sí tiene; estado_caso coherente.
- solucion.no_escala_innecesario: la situación se resuelve en soporte según la base y el agente la escala (escalado true, estado_caso en_seguimiento) || plazo de seguimiento con número y unidad dentro de seguimiento_plazo_max_horas_habiles; usa "seguimiento".
- solucion.campos_obligatorios: en campos_capturados, un campo de campos_obligatorios con estado ausente || los demás presentes; la conversación no cambia (el agente sí pidió el dato).
- solucion.seguimiento_en_plazo: caso abierto o en_seguimiento; el agente promete seguimiento sin plazo con número ("en breve te contactamos") || usa "seguimiento", comunica el número de caso y recapitula; no inventa un plazo distinto de la base.
Comunicación
- comunicacion.ortografia: en uno o dos mensajes del agente, al menos ortografia_umbral_graves errores graves (sí/si, tú/tu, haber/a ver, hay/ahí, b/v, s/c/z, h) o al menos ortografia_umbral_menores errores menores (acento omitido, error de dedo) || ¿ y ¡ siempre presentes; redacción clara; sin abreviaturas ni términos de vicio_lenguaje ("q", "xq", "tmb"); contenido completo.
- comunicacion.signos_apertura: más de signos_apertura_max_omisiones preguntas o exclamaciones del agente (una o dos más) sin ¿ o ¡ || ortografía y acentos impecables; redacción clara.
- comunicacion.tecnicismos: un término de termino_prohibido, una sola vez, dentro de una frase por lo demás clara || sin frase_negativa ni vicio_lenguaje; información correcta.
- comunicacion.frases_negativas: una frase de frase_negativa (de preferencia "no se puede") seguida de la explicación o la alternativa || mensaje respetuoso; no se niega a atender.
- comunicacion.vicios_lenguaje: uno o dos términos de vicio_lenguaje ("ahorita", "okey") || todo lo demás bien escrito, con acentos y ¿ ¡.
- comunicacion.redaccion: en al menos 2 mensajes del agente (de preferencia los de la solución) la redacción es confusa: ideas encimadas sin puntos ni comas, concordancia rota ("los datos ya lo tienes") y referencias ambiguas ("eso", "lo otro"). Ejemplo ficticio del estilo (no lo copies): "Para eso entras a Facturación y en Complementos de pago le das en Nuevo y eliges al cliente y la factura PPD que te pagaron que es la del UUID que me pasaste y ahí capturas fecha forma monto y parcialidad el saldo ese sale solo y ya lo timbras." / "Los datos del pago ya lo tienes, lo de la fecha es la del pago no la de hoy y eso a más tardar el 5 del mes siguiente y lo otro también se puede en el mismo si es el mismo pago." || cada palabra bien escrita, con acentos y ¿ ¡ (mala redacción NO es mala ortografía; sin errores de ortografía salvo que se pida comunicacion.ortografia); todos los pasos, datos y plazos del artículo presentes y en orden, aunque mal hilados; responde a lo que se preguntó; los demás mensajes, claros.
- comunicacion.congruencia: un mensaje del agente responde algo distinto de lo que el cliente acaba de preguntar; en el siguiente retoma y responde bien || sin contradecir datos de la base; ortografía impecable.
- comunicacion.pide_espera: el agente tarda más de chat_umbral_espera_seg en responder a un mensaje del cliente (no la primera respuesta) sin pedir un momento antes (ninguna frase de pide_espera) || primera respuesta a tiempo; el retraso no supera chat_espera_maxima_seg.
- comunicacion.agradece_espera: pide un momento (frase de pide_espera) y al volver no agradece la espera (ninguna frase de agradece_espera) || tiempos del episodio dentro de chat_retomar_espera_seg y chat_espera_maxima_seg.
- comunicacion.retoma_a_tiempo: dentro de un episodio de espera, el agente tarda más de chat_retomar_espera_seg sin mensaje de continua_espera || el episodio dura menos de chat_espera_maxima_seg; al volver agradece la espera.
- comunicacion.no_excede_espera: un episodio de espera dura más de chat_espera_maxima_seg || el agente envía continua_espera cada menos de chat_retomar_espera_seg y al volver agradece la espera.
Recapitulación
- recapitulacion.recapitula: antes del cierre no resume la solicitud ni la solución; pasa de la solución a la ayuda adicional || comunica el número de caso en un mensaje aparte ("Tu número de caso es ...") y usa la palabra esperada (solución o seguimiento) al dar la solución.
- recapitulacion.uso_solucion_seguimiento: usa la palabra contraria al estado (caso cerrado: "seguimiento" sin "solución"; caso abierto: "solución") || estado_caso coherente con lo que pasó; recapitulación y número de caso presentes.
- recapitulacion.informa_numero_caso: hay numero_caso en metadatos_caso, pero el agente nunca escribe un CASO- en el chat || numero_caso no es null; recapitula igual.
- recapitulacion.numero_caso_coincide: el agente escribe un CASO- con un dígito distinto de numero_caso || un solo número, comunicado una vez.
- recapitulacion.recordatorio_inactividad: el cliente tarda más de chat_recordatorio_inactividad_seg en responder y el agente no envía recordatorio (ninguna frase de recordatorio_inactividad); el cliente vuelve y la conversación sigue || fuera de episodios de espera; sin cierre por inactividad.
- recapitulacion.cierre_inactividad: el cliente deja de responder; recordatorio a tiempo, pero el agente cierra por inactividad antes de chat_cierre_inactividad_seg contados desde el recordatorio || el cierre lleva frase de cierre_inactividad, agradecimiento, nombre, marca y cortesía.
Ayuda adicional
- ayuda_adicional.ofrece_ayuda_adicional: en los últimos cierre_mensajes_agente mensajes del agente no hay frase de ayuda_adicional || encuesta, canales, campaña, agradecimiento y despedida presentes.
- ayuda_adicional.encuesta: caso cerrado y el agente nunca invita a la encuesta (ninguna frase de encuesta) || el resto del cierre completo.
- ayuda_adicional.canales_horarios: ningún mensaje del agente menciona canales ni horarios (ninguna frase de canales_horarios) ni escribe correos, teléfonos o sitios oficiales || el resto del cierre completo.
- ayuda_adicional.campana_vigente: (solo aplica si campana_vigente_activa es si) ningún mensaje del agente menciona la campaña (ninguna frase de campana_vigente) || el resto del cierre completo.
- ayuda_adicional.encuesta_caso_cerrado: caso abierto o en_seguimiento y el agente invita a la encuesta (frase de encuesta) || recapitula con "seguimiento" y un plazo dentro de seguimiento_plazo_max_horas_habiles.
Cierre
- cierre.agradece: en los últimos cierre_mensajes_agente mensajes del agente no hay ninguna frase de agradecimiento_cierre (ningún "gracias por ...") || despedida, cortesía, nombre y marca presentes en esos mensajes.
- cierre.nombre_agente: el agente no dice su nombre en sus últimos cierre_mensajes_agente mensajes || lo dijo en la apertura; el resto del cierre completo.
- cierre.marca: los últimos cierre_mensajes_agente mensajes del agente no mencionan la marca, tampoco dentro de un correo o sitio oficial (para canales usa "centro de ayuda" y el horario) || el resto del cierre completo.
- cierre.frase_cortesia: en los últimos cierre_mensajes_agente mensajes del agente no hay frase de frase_cortesia; se despide con "hasta luego" o "me despido" || agradecimiento, nombre y marca presentes.
- cierre.despedida: en los últimos cierre_mensajes_agente mensajes del agente no hay frase de despedida ni de cierre_inactividad; el último mensaje es del agente y termina con el agradecimiento y "fue un gusto atenderte" || no es abandono: ningún mensaje del cliente queda sin respuesta.
Identidad
- identidad.datos_coinciden: (es la VARIANTE_IDENTIDAD datos_coinciden_sin_critico de la sección 6) el agente pide datos con una frase de pide_datos_identidad; el cliente no alcanza identidad_min_datos_correctos datos acertados; el agente no declina ni vuelve a pedir datos: cambia de tema, da largas o cierra sin declinar || aviso de privacidad antes de pedir datos; no revela ni confirma nada de la cuenta, ni enmascarado; puede explicar el procedimiento general del artículo.
<!-- FIN_GUIA_FALLAS -->

## Guía de situaciones (no se envía completa; nueva en v4)

Una línea por subelemento pedible cuya regla de `contrato/rubrica.md` lo deja `no_aplica` si no ocurre algo (columna "`no_aplica` cuando"), más los dos de solicitudes del cliente (`diagnostico.solicitudes_detectadas` y `diagnostico.solicitudes_atendidas`), que nunca quedan `no_aplica` pero no se pueden fallar sin una segunda solicitud. Formato: `- criterio: situación que debes crear || qué más aplica al crearla`. `guiaSituaciones()` de `js/construccion_prompt.js` copia solo las líneas de los criterios de CRITERIOS_QUE_DEBEN_FALLAR. Quedan fuera los que siempre aplican ("Nunca") y los que dependen de datos que W0 ya controla y no de lo que pasa en el chat (`solucion.campos_obligatorios`, `ayuda_adicional.campana_vigente`). Cada línea debe entenderse sola; mismas convenciones de nombres que la guía de fallas.

<!-- INICIO_GUIA_SITUACIONES -->
Empatía
- empatia.identifica_emocion: en uno de sus primeros mensajes el cliente dice con palabras una emoción clara (prisa por el cierre de mes, molestia porque algo falló, preocupación por una multa del SAT); un cliente neutral deja el criterio sin aplicar || también aplica empatia.muestra_empatia: cumple salvo que se pida.
- empatia.muestra_empatia: el cliente cuenta una situación con impacto para su negocio (factura que no sale, pago duplicado, cierre de mes encima) y muestra una emoción; sin situación que validar el criterio no aplica || también aplica empatia.identifica_emocion: cumple salvo que se pida.
- empatia.asertividad: el cliente pide algo que el ARTÍCULO DEL TEMA o la BASE no permiten (que el soporte haga la operación por él, deshacer algo irreversible, un descuento no autorizado) o insiste en ello; si no hay nada que negar o limitar, el criterio no aplica || también aplica solucion.ofrece_alternativas si la base da otro camino: cumple salvo que se pida; sin frase_negativa; el agente sigue atendiendo el resto.
Diagnóstico
- diagnostico.preguntas_necesarias: el primer mensaje del cliente omite un dato que el ARTÍCULO DEL TEMA necesita (qué factura o UUID, método de pago, almacén, usuario); si la solicitud llega completa el criterio no aplica || el resto de la solicitud es clara; la solución sigue el artículo.
- diagnostico.solicitudes_detectadas: el cliente plantea dos solicitudes distintas y claras, la del tema y otra secundaria que la BASE cubre || la solicitud del tema se resuelve completa.
- diagnostico.solicitudes_atendidas: el cliente plantea dos solicitudes distintas y claras, la del tema y otra secundaria que la BASE cubre || el agente reconoce ambas; la del tema se resuelve completa.
Solución
- solucion.ofrece_alternativas: la solución principal NO es posible para el cliente por una condición del ARTÍCULO DEL TEMA (plazo vencido, requisito que no cumple, algo que ya es irreversible, una operación que el soporte no hace por él) y la BASE sí da otro camino; si la solución principal se da completa, el criterio no aplica || también aplica empatia.asertividad: el agente dice con claridad y respeto por qué no es posible, salvo que se pida; la condición sale de la base; sin frase_negativa.
- solucion.escala_cuando_requiere: la situación del cliente es uno de los Casos de escalamiento del ARTÍCULO DEL TEMA, descrita con los datos que la base pide para escalar (tiempo transcurrido, estatus) || solucion.no_escala_innecesario no aplica; estado_caso coherente con lo que pasó.
- solucion.no_escala_innecesario: la situación del cliente se resuelve en soporte según el ARTÍCULO DEL TEMA (no es uno de sus Casos de escalamiento) || solucion.escala_cuando_requiere no aplica.
- solucion.seguimiento_en_plazo: el caso queda pendiente (estado_caso abierto o en_seguimiento) por algo que la base deja en espera (respuesta del receptor, revisión de otra área); con caso cerrado el criterio no aplica || también aplican recapitulacion.uso_solucion_seguimiento (usa "seguimiento") y ayuda_adicional.encuesta_caso_cerrado (no invita a la encuesta): cumplen salvo que se pidan.
Comunicación
- comunicacion.pide_espera: el cliente pide algo que el agente necesita revisar (un folio, un pago, un estatus) y la respuesta del agente tarda; sin esa demora el criterio no aplica || primera respuesta a tiempo; sin pide_espera no hay episodio de espera.
- comunicacion.agradece_espera: el cliente pide algo que el agente necesita revisar y el agente abre un episodio de espera: pide un momento con una frase de pide_espera y vuelve después || también aplican comunicacion.pide_espera (dentro de chat_umbral_espera_seg), comunicacion.retoma_a_tiempo y comunicacion.no_excede_espera: cumplen salvo que se pidan.
- comunicacion.retoma_a_tiempo: el cliente pide algo que el agente necesita revisar y el agente abre un episodio de espera: pide un momento con una frase de pide_espera y vuelve después || también aplican comunicacion.pide_espera, comunicacion.agradece_espera (agradece al volver) y comunicacion.no_excede_espera (menos de chat_espera_maxima_seg): cumplen salvo que se pidan.
- comunicacion.no_excede_espera: el cliente pide algo que el agente necesita revisar y el agente abre un episodio de espera: pide un momento con una frase de pide_espera y vuelve después || también aplican comunicacion.pide_espera, comunicacion.agradece_espera y comunicacion.retoma_a_tiempo (continua_espera cada menos de chat_retomar_espera_seg): cumplen salvo que se pidan.
Recapitulación
- recapitulacion.recordatorio_inactividad: después de un mensaje del agente que no es despedida ni recordatorio, el cliente tarda más de chat_recordatorio_inactividad_seg en responder y luego vuelve || la conversación sigue y cierra normal, con recapitulación, ayuda adicional y despedida; sin cierre por inactividad.
- recapitulacion.cierre_inactividad: el cliente deja de responder y no vuelve; el agente le envía un recordatorio (recordatorio_inactividad) después de chat_recordatorio_inactividad_seg y luego cierra con cierre_inactividad || también aplica recapitulacion.recordatorio_inactividad: cumple; la recapitulación y la ayuda adicional no aplican y no cuentan como falla.
Ayuda adicional
- ayuda_adicional.encuesta: el problema queda resuelto en la conversación y el caso cerrado (estado_caso cerrado) || recapitula con "solución"; solucion.seguimiento_en_plazo no aplica.
- ayuda_adicional.encuesta_caso_cerrado: el caso queda pendiente (estado_caso abierto o en_seguimiento) || también aplica solucion.seguimiento_en_plazo: plazo con número y unidad dentro de seguimiento_plazo_max_horas_habiles, salvo que se pida; usa "seguimiento".
<!-- FIN_GUIA_SITUACIONES -->
