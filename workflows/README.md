# workflows/

Workflows de n8n del proyecto, exportados en JSON **sin credenciales**. Dueño: subagente `workflows-n8n`. Cómo importarlos y probarlos: `IMPORTAR.md`.

Regla central: aquí no se escribe lógica de decisión. Las reglas viven en `js/` y los prompts en `prompts/` y `contrato/`; esta carpeta solo los conecta.

## Estructura

| Ruta | Qué es |
|---|---|
| `00_simulador.json` … `99_errores.json` | Workflows generados, listos para importar (con marcadores). **No se editan a mano.** |
| `herramientas/construir_plantillas.mjs` | Fuente de la forma de cada workflow: nodos, tipos, reintentos, credenciales y conexiones. Escribe `plantillas/` y `pruebas/`. |
| `plantillas/*.json` | Workflows con los nodos Code vacíos, solo con marcadores `// FUENTE: js/<archivo>.js` (una o varias, en orden) y `// PEGAMENTO: pegamento/<archivo>.js`. Los Set de prompts llevan en `notes` líneas `RELLENO <campo> <- prompts/... o contrato/...`. |
| `pegamento/*.js` | Las pocas líneas que conectan n8n con las funciones de `js/` (leer `$json` o `$('Nodo')`, llamar la función, devolver el ítem). Máximo 15 líneas efectivas y sin decisiones. |
| `herramientas/ensamblar.mjs` | Arma `workflows/<nombre>.json` desde plantilla + `js/` + pegamento + prompts. `--verificar` compara sin escribir; `--local` escribe copias importables con tus valores en `_local/`. |
| `herramientas/valores.ejemplo.json` | Plantilla de `_local/valores.json` (solo marcadores). |
| `herramientas/encabezados.mjs` | Imprime la fila 1 de cada hoja, leída de `contrato/sheets.md`. |
| `pruebas/` | `mock_api.json` (imita la API Responses: 503 y luego 200) y payloads de prueba derivados de `contrato/ejemplos/payload_ejemplo.json`. |
| `tests/` | Pruebas, descritas abajo. `tests/fixtures/` tiene una plantilla de prueba. |
| `_local/` | Copias con valores reales. En `.gitignore`: nunca se sube. |
| `INVENTARIO_NODOS.md` | Nodos y `typeVersion` confirmados en tu n8n 2.32.6. |

Pruebas de `tests/`:
- `sincronia.test.js`: los nodos son copia exacta del repo.
- `secretos.test.js`: sin claves ni IDs reales.
- `estructura.test.js`: tipos y versiones del inventario, nombres, error workflow, Sheets, HTTP y Telegram.
- `simulacion.test.js`: ejecuta los nodos Code generados con un `$` simulado (`ejecutor_n8n.js`).

## Flujo de trabajo

```bash
node workflows/herramientas/construir_plantillas.mjs   # plantillas/ y pruebas/
node workflows/herramientas/ensamblar.mjs              # workflows/<nombre>.json
node --test js/tests/*.test.js workflows/tests/*.test.js
node workflows/herramientas/construir_plantillas.mjs --verificar
node workflows/herramientas/ensamblar.mjs --verificar
node workflows/herramientas/ensamblar.mjs --local      # copias importables en workflows/_local/
```

Si editas un nodo Code o Set en la UI de n8n, la prueba de sincronía falla e indica el nodo y el archivo. El cambio se hace en `js/` o `prompts/` (por su subagente dueño) y se reensambla.

## Cómo queda un nodo Code generado
1. Encabezado `// GENERADO, no editar en n8n; fuente: ...` y los marcadores. Sirven para recalcular el nodo desde un JSON exportado.
2. Cada archivo de `js/` completo y literal, envuelto en `((module) => { ... return module.exports; })({ exports: {} })`. El envoltorio deja que dos archivos convivan en un nodo sin chocar (todos declaran `const exportados`) y no cambia el código.
3. `const { funcionA, ... } = ...` con lo que exporta cada archivo:
   - Si dos FUENTE exportan el mismo nombre con el mismo código (por ejemplo `marcaTiempoSistema`, copiada a propósito en varios archivos), se usa la primera.
   - Si el código difiere, el ensamblado se detiene.
4. El pegamento.

## Diseño común de los workflows

- **Decisiones:** cada IF o Switch lee un campo que calculó `js/`: `valido`, `accion`, `decision.accion`, `clasificacion_http.accion`, `evaluar`, `sin_mensajes_agente`. Las únicas comprobaciones propias son de presencia de datos: `envios.length > 0` y `!!conversation_id`.
- **Sheets:**
  - Las lecturas de referencia corren una vez (`executeOnce`). Las que pueden venir vacías llevan `alwaysOutputData`.
  - Las escrituras usan mapeo automático y `cellFormat = RAW`. El ítem que llega a cada escritura trae **solo columnas del contrato** de su hoja: en n8n 2.32.6 `handlingExtraData = ignoreIt` no evitó que se creara la columna `aux_error`, así que se deja el parámetro pero no se depende de él. Los datos auxiliares se leen con `$('Nodo').item`. `simulacion.test.js` lo comprueba para cada escritura.
  - En `update` solo se escriben las claves presentes (las ausentes no se tocan) y nunca una celda vacía.
  - Las actualizaciones buscan la fila por `llave_dedup`.
- **OpenAI y Claude:**
  - HTTP Request con respuesta completa y "nunca fallar", sin reintento nativo.
  - Las dos salidas (normal y de error) van a `clasificacion_http.js`: 2xx sigue; 429/5xx o red pasa por un Wait de `espera_ms` y vuelve, hasta `reintentos_conexion_api`; otro 4xx o agotado es `falla_api`.
- **Reintento nativo** (3 intentos, 3 s): solo en Sheets y Telegram, como red de seguridad de conexión.
- **Errores:** una cadena común en W0, W1, W2, W4 y 99:
  - Recorre: "Fila log_errores" (fija id_error, hora y consecutivo; no escribe) > "¿Enviar alerta operativa?".
    - Sí: "Armar alerta operativa" > "Telegram: alerta operativa" (sus dos salidas) > "Fila alertas (operativa)" > "Escribir alertas (operativa)" > "Fila log_errores (tras el envío)" > "Escribir log_errores".
    - No: "Fila log_errores (sin alerta)" > "Escribir log_errores".
  - `log_errores` se escribe al final, con `alerta_enviada` real: `si` solo si Telegram salió por la salida normal (`estado_envio = enviada`). El `id_error` de la fila es el que cita la alerta.
  - Entra un ítem `{ registrar_error, enviar_alerta, config }`. `enviar_alerta` sale de `debeAlertar` (js/registro_errores.js), o de la función de js/ que tomó la decisión (`decidirIngesta`, `decidirReproceso`).
  - El rechazo del formulario (W0) va a un registro aparte, sin Telegram, y su motivo se muestra en pantalla con un nodo n8n Form (Form Ending).
  - Telegram manda sus dos salidas al registro, así una falla de envío queda como `estado_envio = fallida`.
- **Telegram:** todos los nodos envían `texto_html` con `parse_mode = HTML`. Sin ese parámetro el nodo 1.2 usa Markdown y los guiones bajos de los IDs se pierden. En `alertas.texto_enviado` se guarda el texto plano.
- **Code por ítem:** ningún nodo en modo "Run Once for Each Item" contiene `$input.first/last/all/itemMatching`, ni en comentarios: n8n lo rechaza con "Can't use .all() here". El ejecutor de pruebas aplica la misma regla.
- **Escritura idempotente (W2):** antes de escribir se leen las filas de esa `llave_dedup` en `evaluaciones` y de ese `id_evaluacion` en `detalle_criterios`, y `planificarEscrituraResultados` devuelve solo las que faltan.
- **Atascadas (W4):** "Leer conversaciones por recuperar" trae las filas en `reproceso`, `en_evaluacion` y `pendiente`. `decidirReproceso` marca como atascadas las `en_evaluacion` y las `pendiente` de más de `evaluacion_tiempo_maximo_min` minutos (las `pendiente` solo de lotes que se evalúan al ingerir, nunca `calibracion_v1`) y las reenvía.
- **No reenvío de alertas de calidad (W2):** "Leer alertas de la conversación" trae las filas de `alertas` de esa conversación y `alertasDeEvaluacion` omite los críticos ya `enviada` (las `fallida` se reintentan). Si la lectura falla, sigue sin filtro (continueRegularOutput): es preferible repetir una alerta a perder la de un crítico.
- **Alertas de calidad:**
  - Lote `demo`: inmediatas desde W2.
  - Otros lotes: W2 devuelve `acumular` y `costo_usd` en "Resultado de la evaluación", y W1 (disparador manual) llama a `cierreDeLote` y W4 a `cierrePorLotes` al final: resumen agrupado y costo por lote.

## Campos intermedios del flujo
No son columnas ni campos del contrato:
- Del evaluador: `peticion_openai`, `intentos_llm`, `intentos_incompleta`, `uso_llm`, `anomalias_llm`, `intento_conexion`, `respuesta_http`, `clasificacion_http`, `accion`, `detalle_log`, `respuesta_llm`, `texto_respuesta_llm`, `mensaje_reintento`.
- De las alertas y la cadena de errores: `envios`, `acumular`, `registrar_error`, `enviar_alerta`, `actualizacion`, `ahora`, `consecutivo` (más `id_error` y `tipo_error` ya calculados por `filaLogErrores`, solo en el ítem intermedio de "Fila log_errores").
- Del simulador: `peticion_claude`, `valores_generador`, `intento_generacion`, `lectura_generador`, `verificacion`, `decision`.
