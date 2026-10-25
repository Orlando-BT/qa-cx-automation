# Verificación técnica de OpenAI (Fase 1)

Script: `prompts/verificacion/verificar_openai.mjs` (Node 24, sin dependencias).

## Qué verifica

Resuelve los pendientes 1 y 3 de `docs/registro-tecnico.md` (sección 5) y las verificaciones de `contrato/config.md` (sección 13):

1. Si la API Responses de OpenAI acepta `contrato/llm_output.schema.json` **tal cual** en salida estructurada estricta (`strict: true`). Interesan cuatro claves:
   - `$schema` y `title` en la raíz;
   - `minimum` dentro de un tipo `["integer", "null"]` (`primer_mensaje_info_cuenta.mensaje_n`);
   - `minItems` (`solicitudes_cliente`).
2. Si el modelo evaluador (`gpt-6-luna` por defecto) acepta `temperature: 0`. Si no la acepta, prueba qué valor de `reasoning.effort` funciona.

### Prueba A

Usa una conversación ficticia de 4 mensajes, ya enmascarada y escrita dentro del script, con un catálogo y un artículo de prueba. No usa los datos reales del proyecto.

| Paso | Qué envía | Cuándo |
|---|---|---|
| A1 | Esquema tal cual + `temperature: 0` | Siempre |
| A2 | Quita `$schema` y `title`; si sigue fallando, también `minimum` de `mensaje_n`; como extensión, después `minItems` | Si el error apunta al esquema |
| A3 | Sin `temperature`, con `reasoning: {effort: "none"}`; si no se acepta, `"low"` | Si el error apunta a `temperature` o a `reasoning` |

Los pasos se combinan. Si fallan el esquema y la temperatura, se corrigen uno por uno. Hay un tope de 10 intentos. Si el error no se puede clasificar, el script se detiene y muestra el mensaje literal; no intenta adivinar la causa.

En cada intento registra:
- los parámetros enviados (sin la clave);
- el código HTTP;
- el mensaje de error literal de la API, con las claves candidatas que menciona;
- si el intento funcionó: `usage` completo (entrada, salida y `reasoning_tokens`), `status` y si la salida parsea como JSON con las claves requeridas.

### Prueba B (una evaluación real con el prompt v1)

`--prueba-b` mide el costo y la validez de **una** evaluación con el flujo real del Workflow 2:

1. Lee `contrato/ejemplos/payload_ejemplo.json` (nunca `datos/lotes/`) y la cuenta `CTA-104` de `datos/cuentas.csv`.
2. JS-1 (`js/normalizacion.js`) con la configuración leída de las tablas de `contrato/config.md`, `datos/listas.csv` y `datos/catalogo_temas.csv`.
3. JS-2 (`js/enmascaramiento.js`) enmascara los mensajes. Si falta algún archivo de `reglas-js`, la prueba se detiene: nunca envía texto sin enmascarar.
4. JS-4 (`js/construccion_prompt.js`) arma la petición con `prompts/evaluador_ce_v1.md` y la base completa (`datos/base_conocimiento.md`).
5. Llama a OpenAI y pasa la salida por JS-5 (`js/validador_llm.js`). Si es inválida, reintenta con los errores, como el Workflow 2 (hasta `reintentos_validacion_llm` = 2 reenvíos).
6. Guarda un archivo nuevo por corrida, `prompts/verificacion/resultados_prueba_b_AAAAMMDD-HHMMSS.json` (fecha y hora local de la corrida; nunca sobrescribe), solo con tokens, costo, validez y errores de cada intento. No guarda la respuesta del modelo ni el prompt.

Parámetros (en este orden de prioridad):
- `--esfuerzo none|low|ninguno` y `--quitar-claves '$schema,title,minimum@primer_mensaje_info_cuenta.mensaje_n'`;
- si no se dan, los que aceptó la prueba A (`resultados_prueba_a.json`);
- si no hay prueba A, `temperature` 0 y el esquema sin cambios.

`--sin-llamada` arma la petición y muestra sus tamaños en caracteres sin llamar a la API (no necesita clave ni escribe archivos).

Limitación: el payload de ejemplo tiene textos de relleno ("..."), así que la conversación es mínima y el costo medido subestima una conversación real en unos 800 a 1,500 tokens de entrada (SUPUESTO).

Costo medido (prueba B, 23-oct-2026): unos 14,000 tokens de entrada por evaluación; unos USD 0.002 por evaluación sin bloque commentary y unos USD 0.005 con commentary. Con reintentos (hasta 3 intentos) el peor caso sería unas tres veces eso (estimación).

### Prueba B en modo lote (varias conversaciones, solo agregados)

`--prueba-b --lote <lote>` evalúa varias conversaciones de `datos/lotes/<lote>/` con el flujo real del Workflow 2 y compara el resultado contra lo que declara el escenario (`_escenarios.json`), igual que `js/tests/lote_calibracion_v1.test.js` pero con el LLM real en lugar del simulado.

Comando exacto para el dueño (desde la raíz del repositorio):

```
node --env-file=.env prompts/verificacion/verificar_openai.mjs --prueba-b --lote calibracion_v1 --n 2 --tope-usd 0.05
```

Opciones:
- `--n N`: cuántas conversaciones; toma las primeras N por `conversation_id` (por defecto 2). Mínimo 2: con una sola, el agregado revelaría su resultado individual.
- `--ids CONV-0105,CONV-0110`: en lugar de las primeras N, evalúa esa lista (mínimo 2).
- `--tope-usd X`: **tope duro de costo** (por defecto 0.05). Antes de cada llamada, si el costo acumulado ya llegó al tope, se detiene y lo reporta (`detenido_por_tope`). Una sola llamada puede rebasarlo como máximo por su propio costo (peor caso unos USD 0.005 con `max_output_tokens` = 8000).
- `--mostrar-concordancia`: **uso de la Fase 4, después de la calificación a ciegas.** Por defecto la consola muestra solo `ejecucion` y `consumo`; con esta opción (texto exacto, sin variantes) también imprime `concordancia_con_escenario`, es decir, la comparación contra la verdad del escenario. **Advertencia: no la uses antes de cerrar la Fase 3**, porque deja ver información del lote que vas a calificar a ciegas. La opción no cambia el archivo de `_privado/`: se escribe igual con o sin ella.
- `--sin-llamada`: no llama a la API. Usa la salida simulada de `js/tests/lote_simulacion.js` (no es una predicción del LLM), con 0 tokens, y no escribe archivos. Sirve para revisar la forma de la salida. Limitación: en algunas conversaciones la salida simulada no pasa JS-5 (regla 7) y aparece como inválida; es un límite de la simulación, no del validador.

Qué hace con cada conversación:
1. JS-1 a JS-3 con `datos/config.csv`, `datos/listas.csv`, `datos/catalogo_temas.csv` y `datos/cuentas.csv` (helpers de `js/tests/ayudas.js`).
2. JS-4 con los parámetros de `config`: `modelo_evaluador` (`gpt-6-luna`), `llm_esfuerzo_razonamiento` (`none`, sin `temperature`) y `claves_esquema_excluidas_evaluador`. En este modo no se usan `--esfuerzo`, `--quitar-claves` ni la prueba A.
3. OpenAI y JS-5. Si la respuesta es inválida, reintenta con los errores hasta `reintentos_validacion_llm` reenvíos.
4. JS-6 a JS-8 (`reglas_hibridas.js`, `scoring.js`, `costo.js`) tal como estén en `js/`.
5. Compara contra el escenario.

**Salida solo agregada.** Es una regla del dueño, porque la calificación humana es a ciegas. La consola muestra solo `ejecucion` y `consumo` (y `concordancia_con_escenario` únicamente con `--mostrar-concordancia`, ver arriba). Ni la consola ni los archivos `prompts/verificacion/_privado/resultados_prueba_b_lote_AAAAMMDD-HHMMSS.json` (uno nuevo por corrida, con fecha y hora local en el nombre; nunca se sobrescriben; el script crea `_privado/` si no existe) muestran resultados por conversación: ni IDs con su nota, ni criterios, ni justificaciones, ni la respuesta del LLM. Los errores de JS-5 se agrupan por tipo (regla y campo raíz), sin el texto del error, porque ese texto puede citar la conversación. Única excepción: `diagnostico_raiz` (ver abajo). El archivo contiene:
- `ejecucion`: conversaciones solicitadas y evaluadas, respuestas válidas al final, inválidas tras los reintentos, fallas de API o del pipeline, intentos totales, errores de JS-5 (total y por tipo), y si se detuvo por tope o por error de la API (400, 401, 403 o 404 detienen la corrida).
  - `diagnostico_raiz`: solo para rechazos de regla 1 en la raíz (respuesta que no parsea o no es objeto). Guarda el texto del error de JS-5 únicamente si `mensajeRaizSinContenido` de `js/validador_llm.js` lo reconoce como mensaje fijo (causa, posiciones y longitudes; nunca texto de la respuesta ni de la conversación), la forma de la salida de la API (`status`, `incomplete_details.reason`, items por tipo, número de mensajes y de partes `output_text`, `phase`) y los tokens de salida de esos intentos, ordenados y sin ID. En modo `payload_ejemplo` (sin `--lote`) cada intento guarda además `estructura_salida`.
  - `anomalias_salida`: en TODOS los intentos (también los válidos), cuántos tuvieron anomalías de forma de la salida de la API, el conteo por etiqueta fija de `extraerTextoSalida` (`fase_commentary_ignorada`, `mensaje_sin_fase_ignorado`, `varios_final_answer`, `sin_final_answer`, `varios_mensajes_sin_fase`, `varias_partes_output_text`) y, ordenados y sin ID, los caracteres ignorados y los tokens de salida de esos intentos. Sin texto.
  - Elección por tipo: JS-5 toma solo el mensaje con `phase = final_answer` (o el único mensaje si la API no manda `phase`). Si la salida es ambigua (`falla_estructura`), el intento cuenta en `fallidas_api` y en `errores_api_por_tipo` como `estructura_salida: <causa>`, y NO se gasta un reintento de JS-5.
- `consumo`: tokens de entrada, de salida y totales, costo total y costo promedio por evaluación.
- `concordancia_con_escenario`: porcentaje de criterios que coinciden (total y por origen JS, LLM e HIBRIDO); críticos esperados contra detectados (coincidencias, falsos positivos y falsos negativos); diferencia promedio absoluta de `nota_final`; y `criticos_solo_llm`.
  - `criticos_solo_llm` cuenta los críticos que dejan de detectarse al volver a correr JS-6 y JS-7 con `criticos_posibles` neutralizados. Incluye los críticos de origen LLM y la parte LLM de `critico.confidencialidad` sin evidencia JS, y dice cuántos coinciden con lo esperado.

Lo esperado viene de la intención del generador, no de la calificación humana, así que esto **no es una métrica de calibración**. Advertencia: aunque la salida sea agregada, deja ver algo del lote (por ejemplo, cuántos críticos hay en las N conversaciones). **Regla para el dueño: no abras ningún `resultados_prueba_b_lote*.json` (ni el antiguo `resultados_prueba_b_lote.json` ni los fechados) hasta terminar tu calificación a ciegas.** Todos viven en `prompts/verificacion/_privado/`, carpeta excluida en `.gitignore`, así que no se suben a GitHub; el del 23-oct-2026 se sacó del repositorio por esta razón y se restaura (vuelve a rastrearse) al cerrar la Fase 3. El orquestador lee el archivo y te reporta solo ejecución, consumo y anomalías, nunca `concordancia_con_escenario`.

Costo con `--n 2`: según lo medido en la prueba B del 23-oct-2026 (unos USD 0.002 por evaluación sin commentary y 0.005 con commentary), entre USD 0.004 y 0.01 si no hay reintentos; con reintentos puede subir hasta unas tres veces (estimación). El script mide el costo real con el `usage` de la API.

## Cómo crear `.env`

En la raíz del repositorio crea un archivo llamado `.env` con una sola línea:

```
OPENAI_API_KEY=tu_clave_aqui
```

`.env` ya está en `.gitignore`, así que no se sube a GitHub. No pegues la clave en ningún otro archivo.

Recomendado: guarda la clave **fuera de la carpeta del repositorio**, por ejemplo en `../secretos/.env`, y ejecuta con `node --env-file=../secretos/.env prompts/verificacion/verificar_openai.mjs ...`. Así no depende de `.gitignore`. Antes de cada commit, revisa con `git status` que ningún `.env` aparezca en la lista.

## Cómo ejecutarlo

Desde la raíz del repositorio:

```
node --env-file=.env prompts/verificacion/verificar_openai.mjs
```

Opciones:
- `--modelo <id>`: prueba otro modelo. Los precios del costo siguen siendo los de `gpt-6-luna`, y el script avisa que el costo no aplica.
- `--prueba-b`: prueba B (ver arriba).

## Salida

- **Consola:** una línea por intento y un resumen al final con la combinación aceptada, las claves que hubo que quitar, los rechazos con su mensaje literal y el costo total.
- **`prompts/verificacion/resultados_prueba_a.json`:** solo lo observado. Este archivo conserva nombre fijo porque la prueba B lo lee para tomar los parámetros aceptados.
- **Prueba B:** cada corrida real escribe un archivo nuevo `resultados_prueba_b_AAAAMMDD-HHMMSS.json` (en `prompts/verificacion/`) o `_privado/resultados_prueba_b_lote_AAAAMMDD-HHMMSS.json` (fuera de Git hasta cerrar la Fase 3). Los archivos sin fecha (`resultados_prueba_b.json` y `_privado/resultados_prueba_b_lote.json`) son de las corridas del 23-oct-2026 y se conservan tal cual. No guarda la clave ni la respuesta completa del modelo, solo la longitud del texto, si parsea y qué claves requeridas faltan.

Con estos resultados se decide:
- si JS-4 debe quitar claves del esquema antes de enviarlo;
- si el `minimum` de `mensaje_n` pasa a JS-5;
- qué valor de `llm_temperatura` o `reasoning.effort` usa el nodo de OpenAI.

Cualquier cambio al contrato requiere la aprobación del dueño.

## Costo

Precios de `gpt-6-luna`: USD 0.10 por millón de tokens de entrada y USD 0.50 por millón de salida. Los verificó el orquestador el 22-oct-2026.

Prueba A (conversación ficticia de 4 mensajes): es más pequeña que una evaluación real; los intentos rechazados con HTTP 400 normalmente no consumen tokens (supuesto).

Evaluación real con el prompt v1 (medido en la prueba B, 23-oct-2026):
- Entrada: unos 14,000 tokens por evaluación.
- Costo: unos USD 0.002 por evaluación sin bloque commentary y unos USD 0.005 con commentary.

El script calcula y muestra el costo real con el `usage` que devuelve la API.
