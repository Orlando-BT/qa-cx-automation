# Prompt del generador del simulador CE — `generador_ce_v1`

| Campo | Valor |
|---|---|
| Versión | `generador_ce_v1` (valor de `config.version_prompt_generador` para `tipo_interaccion = ce`; se guarda en `escenarios.version_prompt_generador`) |
| Uso | Workflow 0 (Simulador), paso 3: generar UNA conversación por llamada |
| Modelo previsto | Anthropic por verificar al inicio de la Fase 2 (candidato: `claude-haiku-5-5`, SUPUESTO; en la hoja `config`, clave `modelo_generador` = `por_verificar`) |
| API | Messages API con salida estructurada: `output_config.format` de tipo `json_schema` con `prompts/generador_payload_salida.schema.json` |
| Muestreo | **No se envía `temperature`** (la API la rechaza desde 2026-10-21). La variedad sale de los parámetros del escenario. |
| Costo estimado por conversación | No disponible: precios del generador sin verificar; estimación de costo no disponible hasta verificarlos |
| Autor | subagente `evaluador-llm`, Fase 1 |
| Revisión | 23-oct-2026: ajuste al contrato del commit ba53913 (identidad con `identidad_min_datos_correctos`, datos alternativos y declinación; número de caso fuera de la validación; RFC genéricos; plazos sin minutos y con cifras; `max_tokens_generador`). Sin cambio de nombre de versión: el simulador todavía no ha generado conversaciones. `generador_ce_v1` se congela al cerrar la Fase 1. |

## Costo estimado (SUPUESTO, no medición)

Modelo generador por verificar al inicio de la Fase 2 (candidato: `claude-haiku-5-5`, SUPUESTO). Precios del generador sin verificar; estimación de costo no disponible hasta verificarlos (en `config` siguen en `por_verificar`). Abajo solo se estima el tamaño en tokens.

| Parte | Tokens aproximados (SUPUESTO) |
|---|---|
| Instrucciones de este archivo | 4,500 |
| Base de conocimiento completa + catálogo con tipificaciones y campos | 4,500 |
| Frases de referencia de `listas` y parámetros de `config` | 1,500 |
| Esquema de salida | 800 |
| **Entrada total** | **≈ 11,300** |
| Salida: conversación de 12 a 24 mensajes en JSON | 2,000 a 4,000 |

Costo en USD: precios del generador sin verificar; estimación de costo no disponible hasta verificarlos. Con el reintento de `config.reintentos_generacion` (1), el peor caso son dos intentos de este tamaño. Lo real se registra en `escenarios.tokens_entrada`, `tokens_salida` y `costo_generacion_usd`.

## Cómo se usa este archivo

Mismo formato que el prompt del evaluador: solo se envía lo que está entre los delimitadores.

1. **Instrucciones** (entre `INICIO_INSTRUCCIONES` y `FIN_INSTRUCCIONES`): campo `system` de la Messages API.
2. **Plantilla de entrada** (entre `INICIO_ENTRADA` y `FIN_ENTRADA`): único mensaje `user`. El nodo Code de W0 reemplaza los marcadores `<<...>>`. Se puede reutilizar `extraerBloque()` y `llenarPlantillaEntrada()` de `js/construccion_prompt.js` (detienen el flujo si falta un delimitador o queda un marcador sin llenar).

Cuerpo de la petición (forma; los nombres de parámetros de Anthropic los confirma `workflows-n8n` contra la documentación vigente):

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

`max_tokens` es obligatorio en la Messages API; su valor sale de `config.max_tokens_generador` (8000, SUPUESTO).

### Marcadores que llena W0 (paso 2, "completar el escenario")

| Marcador | Contenido | De dónde sale |
|---|---|---|
| `<<CONVERSATION_ID>>` | ID generado (`CONV-nnnn`) | JS de W0 |
| `<<CUENTA>>` | Una línea por campo de la fila de `cuentas` elegida: `cuenta_id`, `titular`, `razon_social`, `rfc`, `correo`, `telefono`, `giro`, `tamano` | Hoja `cuentas` (datos ficticios) |
| `<<FECHA_HORA_INICIO>>` | Timestamp del primer mensaje, `YYYY-MM-DDTHH:MM:SS`, dentro del horario de atención de KB-08 | JS de W0 |
| `<<TEMA_ESPERADO>>` | Tema del catálogo | Formulario o elección aleatoria de JS |
| `<<TIPIFICACION_ESPERADA>>` | Tipificación válida correcta para el tema y la situación | JS de W0 |
| `<<CALIDAD_ESPERADA>>` | `buena`, `regular` o `mala` (ya resuelta si el formulario pidió `aleatoria`) | JS de W0 |
| `<<ERRORES_CRITICOS_INYECTADOS>>` | IDs `critico.*` separados por coma, o `ninguno` | Formulario |
| `<<CRITERIOS_QUE_DEBEN_FALLAR>>` | IDs de subelementos (sección o identidad) separados por coma, o `ninguno` | JS de W0 |
| `<<CASOS_DIFICILES>>` | Valores de `caso_dificil` separados por coma, o `ninguno` | JS de W0 (opcional) |
| `<<CATALOGO_TEMAS>>` | Una línea por fila activa de `catalogo_temas` (ce ∪ todos): `tema | tipificacion_valida | requiere_escalamiento | campos_obligatorios | id_articulo` | Hoja `catalogo_temas` |
| `<<BASE_CONOCIMIENTO>>` | Base completa con el formato de `formatearBaseConocimiento()` de JS-4 | Hoja `base_conocimiento` |
| `<<FRASES_REFERENCIA>>` | Una línea por `clave_lista` de tipo `frase_criterio`, `termino_prohibido`, `frase_negativa`, `vicio_lenguaje` y `palabra_altisonante`: `clave_lista: valor1 | valor2 | ...` (solo filas activas; las expresiones regulares se marcan con `(regex)`) | Hoja `listas` |
| `<<PARAMETROS_CONFIG>>` | `clave: valor` de: `marca`, `chat_primera_respuesta_seg`, `chat_umbral_espera_seg`, `chat_retomar_espera_seg`, `chat_espera_maxima_seg`, `chat_recordatorio_inactividad_seg`, `chat_cierre_inactividad_seg`, `seguimiento_plazo_max_horas_habiles`, `apertura_mensajes_agente`, `apertura_privacidad_mensajes_agente`, `cierre_mensajes_agente`, `identidad_min_datos_correctos`, `campana_vigente_activa`, `canales_oficiales_correos`, `canales_oficiales_telefonos`, `rfc_genericos_permitidos`, `enmascarado_correo_visibles_inicio`, `enmascarado_telefono_visibles_final`, `enmascarado_rfc_visibles_final` | Hoja `config` |

### La verdad del escenario no viaja en el payload

- Los parámetros del escenario (calidad, críticos, criterios que deben fallar, casos difíciles) entran **solo** en este prompt. La salida del modelo solo tiene los campos del payload: no existe un campo donde pueda devolverlos.
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
- Aviso de privacidad (aviso_privacidad) antes de pedir datos de identidad o, si no los pide, dentro de los primeros apertura_privacidad_mensajes_agente mensajes del agente. Pide o usa el nombre del cliente (pide_nombre_cliente) en esos mismos mensajes.
- Identidad: si el agente va a revelar o confirmar información de la cuenta (facturas, pagos, usuarios, plan, datos registrados), primero pide datos de validación (pide_datos_identidad), espera a que el cliente acierte al menos identidad_min_datos_correctos datos distintos y solo después da la información. Si el cliente falla o no sabe un dato, el agente puede pedir otro de los datos válidos (correo, RFC, teléfono o nombre del titular). Si el cliente no alcanza el mínimo, el agente declina con claridad (declina_validacion) y no da información de la cuenta.
- Empatía pertinente a la situación del cliente, trato cordial y registro acorde (tú o usted de forma coherente).
- Diagnóstico: hace las preguntas que el artículo requiere y reconoce y atiende todas las solicitudes del cliente.
- Solución: información correcta y completa según la base de conocimiento; sigue el proceso; ofrece alternativas si la solución principal no es posible; escala solo cuando la base lo indica para esa situación.
- Comunicación: buena ortografía, signos de apertura (¿ ¡) en preguntas y exclamaciones, sin términos de termino_prohibido, frase_negativa ni vicio_lenguaje, sin mayúsculas sostenidas.
- Recapitulación antes del cierre: resume la solicitud y la solución o el siguiente paso; comunica el número de caso (igual a metadatos_caso.numero_caso); usa la palabra "solución" si el caso queda cerrado o "seguimiento" si queda abierto o en seguimiento.
- Ayuda adicional y cierre, dentro de los últimos cierre_mensajes_agente mensajes del agente: ofrece ayuda adicional (ayuda_adicional), invita a la encuesta (encuesta) solo si el caso queda cerrado, menciona canales y horarios (canales_horarios), menciona la campaña vigente (campana_vigente) si campana_vigente_activa es si, agradece (agradecimiento_cierre), dice su nombre de pila y la marca, usa una frase de cortesía (frase_cortesia) y se despide (despedida). Si el cliente termina por inactividad, el cierre es el de inactividad.
- Metadatos: tipificacion_agente = TIPIFICACION_ESPERADA; numero_caso con formato CASO- y 5 dígitos; estado_caso coherente con la conversación (cerrado si se resolvió; abierto o en_seguimiento si quedó pendiente; sin_caso solo si numero_caso es null); escalado true solo si el agente escaló; campos_capturados con un elemento por cada campo de campos_obligatorios de la tipificación, todos presente.

# 6. Calidad esperada

- buena: todo lo de la sección 5 se cumple. CRITERIOS_QUE_DEBEN_FALLAR debe venir como ninguno; si trae algo, falla solo eso de forma leve.
- regular: falla exactamente lo que dice CRITERIOS_QUE_DEBEN_FALLAR y todo lo demás cumple. Sin errores críticos.
- mala: falla lo que dicen CRITERIOS_QUE_DEBEN_FALLAR y ERRORES_CRITICOS_INYECTADOS; todo lo demás cumple, para que cada falla sea identificable.
- No agregues fallas que no se pidieron. No corrijas las que se pidieron.
- Cada ID de CRITERIOS_QUE_DEBEN_FALLAR es un subelemento de la rúbrica (por ejemplo apertura.aviso_privacidad, empatia.cordialidad, recapitulacion.recapitula, identidad.orden_validacion): haz que el agente incumpla esa conducta concreta de la sección 5.
- identidad.datos_coinciden sin error crítico: el cliente no alcanza identidad_min_datos_correctos datos acertados; el agente no da información de la cuenta, pero tampoco declina ni sigue pidiendo datos (cambia de tema, da largas o cierra sin declinar).

# 7. Cómo inyectar cada error crítico

Inyecta solo los de ERRORES_CRITICOS_INYECTADOS, de forma clara para un evaluador humano:
- critico.no_toma_a_tiempo: la primera respuesta del agente llega después de chat_primera_respuesta_seg.
- critico.no_genera_caso: numero_caso null y estado_caso sin_caso; el agente no comunica número de caso.
- critico.abandono: el último mensaje es del cliente y no tiene respuesta del agente (sin despedida ni cierre por inactividad previos).
- critico.palabras_altisonantes: el agente usa un término de palabra_altisonante.
- critico.validacion_identidad: el agente revela información de la cuenta sin pedir datos de validación, antes de que el cliente acierte identidad_min_datos_correctos datos, o aunque el cliente no alcance ese mínimo (en lugar de declinar).
- critico.confidencialidad: el agente escribe completo un correo, teléfono o RFC registrado que el cliente no había escrito, o revela datos de un tercero o información interna.
- critico.tipificacion_incorrecta: metadatos_caso.tipificacion_agente es una tipificacion_valida de OTRO tema del catálogo.
- critico.informacion_incorrecta: el agente da información contraria a la base con impacto (dinero, plazo legal o fiscal, sanción del SAT, pérdida de datos o acceso indebido).
- critico.promesa_no_autorizada: el agente promete algo que la base no autoriza (reembolso, descuento, mes gratis, plazo distinto).
- critico.negacion_servicio: el agente se niega a atender algo que sí corresponde al soporte.
- critico.mala_actitud: sarcasmo, burla, culpar al cliente o trato despectivo.
- critico.comentarios_negativos_marca: el agente habla mal de la marca, sus productos o la empresa.

# 8. Casos difíciles (si CASOS_DIFICILES los trae)

- amable_no_resuelve: el agente es muy amable y empático, pero no resuelve ni deja un siguiente paso concreto.
- resuelve_tono_seco: el agente resuelve bien y con información correcta, pero con tono seco y cortante (sin sarcasmo ni burla).
- critico_escondido: el error crítico aparece en un solo mensaje, en medio de una conversación que por lo demás es buena.
- tipificacion_incorrecta: la tipificación es de una tipificación válida plausible pero de otro tema.
- validacion_fuera_de_orden: el agente pide los datos de validación, pero revela información de la cuenta antes de que el cliente termine de darlos.

# 9. Uso de la base de conocimiento

- La información correcta es solo la de BASE DE CONOCIMIENTO. Rutas de menú, pasos, plazos, montos, casos de escalamiento y promociones salen de ahí.
- El tema de la conversación es TEMA_ESPERADO; la situación del cliente debe corresponder a TIPIFICACION_ESPERADA (por ejemplo, si la tipificación es de escalamiento, la situación es de las que la base escala).
- Los campos de campos_capturados son exactamente los campos_obligatorios de la tipificación registrada en tipificacion_agente.
<!-- FIN_INSTRUCCIONES -->

<!-- INICIO_ENTRADA -->
ESCENARIO (instrucciones para ti; nunca aparecen en la salida):
- conversation_id: <<CONVERSATION_ID>>
- Tema esperado: <<TEMA_ESPERADO>>
- Tipificación esperada: <<TIPIFICACION_ESPERADA>>
- Calidad esperada: <<CALIDAD_ESPERADA>>
- Errores críticos a inyectar: <<ERRORES_CRITICOS_INYECTADOS>>
- Criterios que deben fallar: <<CRITERIOS_QUE_DEBEN_FALLAR>>
- Casos difíciles: <<CASOS_DIFICILES>>
- Fecha y hora del primer mensaje: <<FECHA_HORA_INICIO>>

CUENTA (datos ficticios):
<<CUENTA>>

PARAMETROS_CONFIG:
<<PARAMETROS_CONFIG>>

FRASES_REFERENCIA (clave_lista: valores):
<<FRASES_REFERENCIA>>

CATÁLOGO DE TEMAS (tema | tipificacion_valida | requiere_escalamiento | campos_obligatorios | id_articulo):
<<CATALOGO_TEMAS>>

BASE DE CONOCIMIENTO:
<<BASE_CONOCIMIENTO>>

Genera la conversación y responde solo con el JSON del esquema.
<!-- FIN_ENTRADA -->
