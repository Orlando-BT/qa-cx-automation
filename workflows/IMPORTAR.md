# Importar y probar los workflows en tu n8n local

Guía para el dueño. Instancia: n8n 2.32.6 en Docker (contenedor `n8n`, puerto 5678). Los nodos y versiones que usan los workflows están verificados en `workflows/INVENTARIO_NODOS.md`, y la prueba `workflows/tests/estructura.test.js` impide usar uno que no esté ahí.

Pasos que solo haces tú (ningún agente los sustituye): crear cuentas y claves, cargar credenciales en n8n, crear y llenar el libro de Google Sheets, importar, activar y ejecutar los workflows.

| Archivo | Workflow en n8n | Disparador |
|---|---|---|
| `00_simulador.json` | 00 Simulador | Formulario `http://localhost:5678/form/qa-simulador` |
| `01_ingesta.json` | 01 Ingesta | Webhook `POST http://localhost:5678/webhook/qa-ingesta?lote=...` y disparador manual de calibración |
| `02_evaluacion.json` | 02 Evaluación | Lo llaman 01 y 04 (Execute Workflow), una conversación por ejecución |
| `03_metricas.json` | 03 Métricas | Manual. **Esqueleto hasta la Fase 4**: lee las hojas, pero no calcula ni escribe métricas ("Escribir metricas" no tiene conexión de entrada). |
| `04_reproceso.json` | 04 Reproceso | Programado cada 30 min y manual |
| `99_errores.json` | 99 Errores | Error Trigger (error workflow de los demás) |
| `pruebas/mock_api.json` | PRUEBA mock API | Webhook `POST http://localhost:5678/webhook/qa-mock-openai` (solo para la prueba 8) |

---

## 0. Antes de importar: pruebas sin conexión

Desde la raíz del repositorio:

```bash
node --test js/tests/*.test.js workflows/tests/*.test.js
node workflows/herramientas/construir_plantillas.mjs --verificar
node workflows/herramientas/ensamblar.mjs --verificar
```

Las tres deben terminar sin fallas:
- La primera incluye `workflows/tests/simulacion.test.js`, que ejecuta los nodos Code generados de W0, W1, W2, W4 y 99 con datos de `datos/` (sin n8n ni API).
- Las otras dos confirman que las plantillas y los JSON están al día con `js/`, `workflows/pegamento/`, `prompts/` y `contrato/`.

**Estimación de costo de toda la sesión de pruebas** (sección 5), antes de cargar saldo. SUPUESTO: estimado, no medido.
- Unas 5 evaluaciones con `gpt-6-luna` a ≈ 0.005 USD = ≈ 0.025 USD.
- Unas 3 a 6 generaciones con `claude-haiku-5-5` a 0.005-0.010 USD = ≈ 0.015 a 0.06 USD.
- Total ≈ **0.05 USD**, tope **0.10 USD**. La prueba 8 (mock) no llama a OpenAI y cuesta 0.

## 1. Orden de importación y error workflow

### 1.1 Copias importables con tus valores
Los JSON de `workflows/` llevan marcadores (`<ASIGNAR_EN_N8N>`, `<ID_LIBRO_SHEETS>`, `<URL_WEBHOOK_INGESTA>`, `<ID_WORKFLOW_EVALUACION>`, `<ID_WORKFLOW_ERRORES>`). Para no reemplazarlos a mano:

1. Copia `workflows/herramientas/valores.ejemplo.json` a `workflows/_local/valores.json` (la carpeta `_local/` está en `.gitignore`).
2. Llena lo que ya sepas:
   - `<ID_LIBRO_SHEETS>`: la parte de la URL de tu libro entre `/d/` y `/edit`.
   - `<URL_WEBHOOK_INGESTA>`: `http://localhost:5678/webhook/qa-ingesta` (sin `?lote=`; lo agrega el simulador).
   - En `credenciales`: el ID de cada credencial de n8n, que se ve en la URL al abrirla. Es opcional; también se puede elegir en cada nodo.
3. Corre `node workflows/herramientas/ensamblar.mjs --local`. Escribe copias en `workflows/_local/` y lista los marcadores que siguen sin valor. Nunca escribe valores reales fuera de `_local/`.

### 1.2 Orden de importación y publicación
En tu n8n 2.32.6 (lo observaste al importar):
- "01 Ingesta" y "04 Reproceso" **no se pueden publicar** mientras su sub-workflow, "02 Evaluación", no esté publicado.
- "99 Errores" **no aparece** en **Settings > Error Workflow** de los demás mientras no esté publicado.

Por eso "99 Errores" y "02 Evaluación" van primero y se publican antes de seguir. Importa con **Workflows > Create Workflow > ... > Import from File** (usa las copias de `_local/`), en este orden:

| # | Archivo | Después de importar |
|---|---|---|
| 1 | `99_errores.json` | Asigna credenciales (sección 2) y **publícalo**. Anota su ID (final de la URL del workflow) como `<ID_WORKFLOW_ERRORES>`. |
| 2 | `02_evaluacion.json` | Asigna credenciales y **publícalo**. Anota su ID como `<ID_WORKFLOW_EVALUACION>`. |
| 3 | Regenera las copias | Pon los dos IDs en `_local/valores.json` y corre `node workflows/herramientas/ensamblar.mjs --local`, para que los siguientes ya los lleven. |
| 4 | `01_ingesta.json` | Credenciales y publicar. |
| 5 | `04_reproceso.json` | Credenciales y publicar. |
| 6 | `00_simulador.json` | Credenciales y publicar. |
| 7 | `03_metricas.json` | Credenciales. No hace falta publicarlo (solo tiene disparador manual). |
| 8 | `pruebas/mock_api.json` | Solo para la prueba 8; no lleva credenciales. Publícalo solo durante esa prueba. |

Si no regeneras en el paso 3: en "01 Ingesta" (nodos "Evaluar conversación" y "Evaluar pendientes") y en "04 Reproceso" ("Evaluar conversación"), elige "02 Evaluación" en la lista desplegable del campo Workflow.

### 1.3 Error workflow
Cada workflow (menos "99 Errores" y el mock) trae `settings.errorWorkflow`. Confírmalo en **... > Settings > Error Workflow = 99 Errores**; si dice otra cosa, elígelo ahí. "99 Errores" **debe estar publicado** para aparecer en esa lista (sección 1.2) y debe seguir publicado. SUPUESTO: no verifiqué qué hace n8n si se despublica después de asignarlo; no lo dejes despublicado.

### 1.4 Actualizar un workflow ya importado (sin perder los IDs)
Úsalo cada vez que cambien `js/`, `workflows/pegamento/`, `prompts/` o las plantillas. Reimporta **sobre el workflow existente**: crear uno nuevo daría otro ID y rompería `<ID_WORKFLOW_ERRORES>`, `<ID_WORKFLOW_EVALUACION>` y el error workflow de los demás.

1. Desde la raíz del repo, en este orden:
   ```bash
   node workflows/herramientas/construir_plantillas.mjs
   node workflows/herramientas/ensamblar.mjs
   node workflows/herramientas/ensamblar.mjs --local
   ```
   El último reescribe `workflows/_local/` con tus valores; revisa que no liste marcadores "sin valor".
2. Reimporta en el orden de la sección 1.2: **99 Errores y 02 Evaluación primero**; después 01, 04, 00 y 03. Para cada uno:
   1. Abre el workflow **existente** en n8n (no crees uno nuevo).
   2. Usa **... > Import from File** y elige su copia de `_local/`. Reemplaza el lienzo dentro del mismo workflow.
   3. Revisa las credenciales de los nodos de OpenAI, Claude, Google Sheets y Telegram (sección 2). Si algún nodo quedó sin credencial, elígela.
   4. **Vuelve a publicarlo.** En n8n 2.x los cambios importados quedan como borrador hasta publicar: sin publicar, los webhooks, el formulario, el programado y las llamadas desde 01 y 04 siguen usando la versión anterior.
3. Comprueba al final:
   - En 00, 01, 02, 03 y 04: **... > Settings > Error Workflow** sigue en "99 Errores".
   - Los IDs al final de la URL de cada workflow no cambiaron; los de "99 Errores" y "02 Evaluación" son los de `_local/valores.json`. SUPUESTO: Import from File sobre un workflow abierto conserva su ID. Si alguno cambiara, actualiza `valores.json`, repite el paso 1 y reimporta 00, 01, 03 y 04.
   - En "01 Ingesta" y "04 Reproceso", el campo Workflow de los nodos "Evaluar ..." apunta a "02 Evaluación".

**No edites nodos Code ni Set de prompts en la UI**: la prueba de sincronía lo detecta. El cambio se pide al subagente dueño del archivo.

### 1.5 Limpieza del libro tras la versión anterior
La versión anterior mandaba campos auxiliares a dos escrituras, y n8n 2.32.6 los agregó como columnas nuevas aunque el nodo decía "ignorar extras":
- `log_errores`: borra la columna **`aux_error`** (la 12) completa.
- `conversaciones`: si después de `id_evaluacion` (la columna 21) aparecen `registrar_error`, `enviar_alerta` o `config` (salen del caso 7a o de cualquier error de W2), bórralas completas.

Las demás hojas no recibían claves auxiliares. Ahora cada nodo de escritura recibe solo columnas del contrato (lo comprueba `workflows/tests/simulacion.test.js`).

## 2. Credenciales que debes crear

En n8n: **Credentials > Add credential**. Usa exactamente estos nombres: así `--local` las asigna por nombre.

| Credencial | Tipo en n8n | Nombre | Nodos que la usan |
|---|---|---|---|
| OpenAI | Header Auth | `OpenAI (Authorization Bearer)` | 02: "OpenAI: evaluar conversación" |
| Anthropic | Header Auth | `Anthropic (x-api-key)` | 00: "Claude: generar conversación" |
| Google Sheets | Google Sheets OAuth2 API | `Google Sheets QA` (o el nombre que ya tiene la tuya; elígela en cada nodo) | Todos los nodos cuyo nombre empieza con "Leer", "Escribir", "Insertar", "Actualizar", "Reactivar", "Crear filas" o "Pasar" (por ejemplo "Pasar conversación a error", "Pasar atascada a reproceso", "Pasar conversación a reproceso"). Total por workflow (Sheets): 13 en 00, 11 en 01, 16 en 02, 4 en 03, 7 en 04 y 4 en 99 |
| Telegram | Telegram API | `Telegram bot QA` | Todos los nodos "Telegram: ...". Total por workflow (Telegram): 1 en 00, 2 en 01, 2 en 02, 0 en 03, 2 en 04 y 1 en 99 |

Los totales de esta tabla los comprueba `workflows/tests/estructura.test.js` contra los JSON.

### 2.1 OpenAI (Header Auth)
- Name: `Authorization`
- Value: `Bearer ` seguido de tu clave de API de OpenAI (la misma cuenta de las pruebas A y B).

### 2.2 Anthropic (Header Auth)
1. Entra a la **Consola de Anthropic** (platform.claude.com; la dirección anterior console.anthropic.com redirige ahí). Es una **cuenta de API aparte de tu suscripción de Claude**: la suscripción no da créditos de API.
2. La API se **paga por uso** y necesita **saldo cargado** (Billing). Sin saldo la API responde con error y el simulador registra `fallo_api`.
3. Crea la clave en **API Keys > Create Key**. Cópiala una sola vez y no la guardes en el repositorio.
4. En n8n, credencial Header Auth:
   - Name: `x-api-key`
   - Value: la clave.
   - El encabezado `anthropic-version` no es secreto: lo pone el nodo desde `config.anthropic_version_api`.

**Costo esperado de las pruebas de esta fase (SUPUESTO: estimado, no medido)**, antes de cargar saldo:
- Generador `claude-haiku-5-5`: 0.10 USD por millón de tokens de entrada y 0.50 por millón de salida (tramo de prompts de hasta 100K tokens; precios en `contrato/config.md`). Peor caso ≈ 0.005 a 0.010 USD por conversación generada.
- Evaluador `gpt-6-luna`: ≈ 0.005 USD por evaluación (`costo_estimado_por_evaluacion_usd`).
- Sesión completa de pruebas: ≈ **0.05 USD**, con **tope de 0.10 USD**.
- El saldo mínimo que permita la consola basta para esta fase.

### 2.3 Telegram
1. En Telegram, habla con **@BotFather**, envía `/newbot` y sigue los pasos. Te da el token del bot.
2. En n8n, credencial **Telegram API**: Access Token = ese token. El token vive solo en la credencial.
3. Envía cualquier mensaje a tu bot. Para saber tu chat ID, abre en el navegador `https://api.telegram.org/bot<TOKEN>/getUpdates` (con tu token en lugar de `<TOKEN>`) y busca `chat` > `id`.
4. Pon ese número **solo en tu hoja `config`**, clave `telegram_destinatario` (hoy tiene el marcador `<TELEGRAM_CHAT_ID>`). Nunca en el repositorio.

### 2.4 Google Sheets OAuth2: ya existe, solo verifícala
No hay que crearla. Verifica tres cosas:
1. **Que está en esta instancia de Docker:** abre http://localhost:5678 > **Credentials** y búscala por nombre (tipo "Google Sheets OAuth2 API"). Si tienes otra instalación de n8n (por ejemplo, la de tu proyecto anterior), la credencial puede estar allá y no aquí.
2. **Que la conexión funciona:** abre la credencial. Si dice que la cuenta está conectada, bien; si pide reconectar, usa **Sign in with Google**.
3. **Que tiene permiso de escritura** (alcance `spreadsheets`):
   1. Crea en tu libro una hoja temporal `prueba_escritura`.
   2. En un workflow nuevo y vacío arma: Manual Trigger > Google Sheets "Append Row" (escribe `ok` en `prueba_escritura`) > Google Sheets "Clear" (borra esa hoja).
   3. Ejecuta. Si los dos pasan, hay escritura.
   4. Borra el workflow y la hoja temporal.

Los workflows **no crean el libro** (lo creas tú, sección 3), así que no se requiere alcance de Google Drive.

## 3. Carga inicial del libro

### 3.1 Crear el libro y las hojas
1. Crea un libro nuevo en Google Sheets con estas 13 hojas, con estos nombres exactos: `config`, `listas`, `catalogo_temas`, `base_conocimiento`, `cuentas`, `conversaciones`, `escenarios`, `revision_humana`, `evaluaciones`, `detalle_criterios`, `log_errores`, `alertas`, `metricas`.
2. La fila 1 de cada hoja lleva los nombres de columna exactos de `contrato/sheets.md`. Para no teclearlos:
   1. Corre `node workflows/herramientas/encabezados.mjs`. Imprime cada hoja con sus columnas separadas por comas (por ejemplo, `escenarios` con 20 y `evaluaciones` con 30).
   2. Pega la línea de cada hoja en su celda A1.
   3. Usa **Datos > Dividir texto en columnas**.

Los workflows escriben por nombre de columna (mapeo automático): si falta una columna o tiene otro nombre, ese dato no se guarda.

### 3.2 Datos de referencia (desde `datos/`)
Para cada archivo:
1. Abre la hoja.
2. Ve a **Archivo > Importar > Subir**, elige el CSV y marca **Reemplazar hoja actual**.
3. **Desmarca "Convertir texto en números, fechas y fórmulas"**. Si no, Sheets cambia `0.10` por número, quita ceros y reformatea fechas y teléfonos.

| Hoja | Archivo |
|---|---|
| `config` | `datos/config.csv` |
| `listas` | `datos/listas.csv` |
| `catalogo_temas` | `datos/catalogo_temas.csv` |
| `base_conocimiento` | `datos/base_conocimiento.csv` |
| `cuentas` | `datos/cuentas.csv` |

Después, en `config`, reemplaza `<TELEGRAM_CHAT_ID>` por tu chat ID (sección 2.3).

Las hojas `conversaciones`, `escenarios`, `evaluaciones`, `detalle_criterios`, `log_errores`, `alertas` y `metricas` quedan solo con la fila de encabezados: las llenan los workflows.

### 3.3 Escenarios y revisión humana

**Regla del dueño: `datos/lotes/calibracion_v1/_escenarios.json` NO se carga en Google Sheets hasta terminar la Fase 3. En la hoja `escenarios` solo entran filas `demo` escritas por W0 (el simulador).**

- `revision_humana`: importa `datos/lotes/calibracion_v1/revision_humana.csv` (las 24 de `calibracion_v1`, en `pendiente`), igual que en 3.2. Las filas `demo` que escribe el simulador se distinguen por la columna `lote`.
- Para calificar sin mezclar lotes, crea una **vista filtrada** (Datos > Crear vista de filtro) con `lote = calibracion_v1`.
- W0 nunca escribe filas `calibracion_v1`: el lote está congelado y el formulario lo rechaza.

## 4. Activar los workflows

Cada Webhook o Formulario tiene dos URL:
- **Prueba** (`/webhook-test/...` o `/form-test/...`): solo mientras das "Execute workflow" en el editor.
- **Producción** (`/webhook/...` o `/form/...`): solo con el workflow activo o publicado.

Publica en el orden de la sección 1.2 (99 y 02 primero).

| Workflow | ¿Publicar? | Para qué |
|---|---|---|
| 99 Errores | Sí, primero | Sin publicar no aparece en Settings > Error Workflow de los demás. Se ejecuta solo ante errores. |
| 02 Evaluación | Sí, segundo | Sin publicar, 01 y 04 no se pueden publicar. Lo llaman 01 y 04. |
| 01 Ingesta | Sí | Webhook `http://localhost:5678/webhook/qa-ingesta`. Responde de inmediato ("Workflow was started") y sigue trabajando después. |
| 04 Reproceso | Sí | Corre cada 30 minutos. También puedes correrlo a mano. |
| 00 Simulador | Sí | Formulario `http://localhost:5678/form/qa-simulador`. Si el formulario es válido, la pantalla dice "Simulación en curso" y la generación sigue en segundo plano (resultado en las hojas y en Executions); si no, muestra "Formulario rechazado" con los motivos. |
| 03 Métricas | No | Solo disparador manual. |
| PRUEBA mock API | Solo en la prueba 8 | Despublícalo al terminar. |

Después de cada reimportación, vuelve a publicar (sección 1.4).

Limitación del programado: el intervalo de "04 Reproceso" está fijo en 30 minutos en el nodo, porque un Schedule Trigger no puede leer la hoja. Si cambias `reproceso_intervalo_min` en `config`, cambia también el nodo "Programado (reproceso_intervalo_min)".

## 5. Guion de pruebas

Todo con lote `demo` (las métricas solo usan lotes de calibración). **Reporta solo totales** (cuántas filas nuevas por hoja, cuántas alertas por tipo, costo total), nunca resultados por conversación.

Envío de un payload al webhook desde Git Bash, en la raíz del repo:
```bash
curl -X POST "http://localhost:5678/webhook/qa-ingesta?lote=demo" -H "Content-Type: application/json" --data @contrato/ejemplos/payload_ejemplo.json
```

Los archivos de `workflows/pruebas/` salen de `contrato/ejemplos/payload_ejemplo.json`, con `conversation_id` de la serie `CONV-90xx`:
- `payload_invalido.json`: sin `canal`.
- `payload_sales.json`: `tipo_interaccion = sales`.
- `payload_sin_agente.json`: solo mensajes del cliente, `sin_caso`.
- `payload_fallo_api.json` y `payload_mock_api.json`: copias válidas.
- `payload_repetir_caso2.json`: copia válida con `CONV-9007`, para repetir el caso 2 cuando `CONV-0001` ya está evaluada.

Todo el rango `CONV-9000` a `CONV-9999` está reservado para pruebas: hoy `CONV-9001` a `CONV-9007` los usan estos archivos y el caso 7c, y el resto queda libre para copias manuales. El simulador nunca genera IDs en ese rango (sección 6).

Antes de empezar, anota cuántas filas tiene cada hoja: los resultados esperados son filas **nuevas**.

### Casos

**1. Pruebas sin conexión**
- Cómo: sección 0.
- Esperado: todo en verde; los dos `--verificar`, sin diferencias.

**2. Conversación de ejemplo**
- Cómo: POST de `contrato/ejemplos/payload_ejemplo.json` con `?lote=demo`. Si `CONV-0001` ya quedó evaluada, repetirla sería un duplicado (caso 4); usa `workflows/pruebas/payload_repetir_caso2.json` (`CONV-9007`, mismo contenido):
  ```bash
  curl -X POST "http://localhost:5678/webhook/qa-ingesta?lote=demo" -H "Content-Type: application/json" --data @workflows/pruebas/payload_repetir_caso2.json
  ```
- Esperado en las hojas:
  - `conversaciones`: +1 fila con `estado = evaluada`, `intentos = 1` e `id_evaluacion` lleno. Ninguna columna nueva.
  - `evaluaciones`: +1.
  - `detalle_criterios`: +77.
  - `log_errores`: +0.
- Esperado en Telegram y `alertas`:
  - Una alerta de calidad inmediata por cada error crítico detectado. El ID del crítico se ve completo, con guiones bajos y sin cursivas (por ejemplo `critico.promesa_no_autorizada`).
  - Una alerta de costo solo si la evaluación pasa de 0.01 USD (2 × `costo_estimado_por_evaluacion_usd`).
  - `alertas`: +1 fila por cada alerta intentada, **también si Telegram falló**: `estado_envio = enviada` si llegó y `fallida` si no. `texto_enviado` guarda el texto plano.

**3. Payload inválido**
- Cómo: POST de `workflows/pruebas/payload_invalido.json`. Se puede repetir con el mismo archivo: un payload inválido sale por la rama "no" de "¿Payload válido?" directo a la cadena de errores, sin pasar por la deduplicación ni escribir en `conversaciones`.
- Esperado:
  - Telegram: +1 alerta operativa, con "Tipo de error: payload_invalido" completo y una línea "Registro: ERR-...".
  - `alertas`: +1 `operativa` con `estado_envio = enviada`.
  - `log_errores`: +1 con `payload_invalido`, escrita **después** del intento de envío:
    - `alerta_enviada = si` si Telegram la entregó (lo esperado);
    - `alerta_enviada = no` si el envío falló; en ese caso `alertas` también tiene su fila, con `estado_envio = fallida`.
  - El `id_error` de la fila de `log_errores` es el mismo que cita la alerta ("Registro: ERR-...").
  - El `detalle_json` solo tiene rutas y reglas, sin texto de mensajes. `log_errores` sigue con 11 columnas (sin `aux_error`).
  - `conversaciones`: +0.

**4. Duplicado**
- Cómo: repetir el caso 2 igual.
- Esperado:
  - `conversaciones`: +0, y la fila del caso 2 no cambia.
  - `evaluaciones`: +0. Sin costo ni alertas.
  - En Executions, "01 Ingesta" termina en "Duplicado: sin cambios". El webhook responde el acuse igual, porque responde antes de deduplicar.

**5. Tipo sin rúbrica**
- Cómo: POST de `workflows/pruebas/payload_sales.json`.
- Esperado:
  - `log_errores`: +1 con `tipo_interaccion_sin_rubrica` y `alerta_enviada = no`.
  - Telegram: 0 alertas (porque `alerta_tipo_interaccion_sin_rubrica = no`).
  - `conversaciones`: +0.

**6. Sin mensajes del agente**
- Cómo: POST de `workflows/pruebas/payload_sin_agente.json`.
- Esperado:
  - `evaluaciones`: +1 con `sin_mensajes_agente = si`, `tokens_entrada = 0`, `tokens_salida = 0`, `intentos_llm = 0`, `costo_usd = 0` y `modelo_evaluador` vacío.
  - En Executions de "02 Evaluación", el nodo "OpenAI: evaluar conversación" no se ejecuta.

**7a. `fallo_api` forzado**
- Cómo:
  1. En la hoja `config`, cambia `modelo_evaluador` por `modelo-inexistente`.
  2. POST de `workflows/pruebas/payload_fallo_api.json`.
- Esperado:
  - La API responde 4xx y no se reintenta.
  - `conversaciones`: +1 fila con `estado = reproceso` e `intentos = 1`.
  - `log_errores`: +1 `fallo_api`.
  - Telegram: +1 operativa.
  - `alertas`: +1.
  - `evaluaciones`: +0.

**7b. Reproceso**
- Cómo:
  1. Restaura `modelo_evaluador = gpt-6-luna`.
  2. En "04 Reproceso", ejecuta "Ejecutar reproceso a mano".
- Esperado:
  - La fila de 7a pasa a `evaluada` con `intentos = 2`.
  - `evaluaciones`: +1.
  - Solo hay alerta de cierre del lote si hubo críticos o se superó el tope del lote.

**7c. Reproceso agotado (opcional, sin costo)**
- Cómo:
  1. Deja `modelo_evaluador = modelo-inexistente`.
  2. Envía otro payload nuevo: una copia de `payload_fallo_api.json` con otro `conversation_id`, por ejemplo `CONV-9006`.
  3. Corre "04 Reproceso" a mano 4 veces.
  4. Restaura el modelo al final.
- Esperado:
  - Corridas 1 a 3: la fila vuelve a `reproceso`, con `intentos` de 2 a 4, y en cada una `log_errores` +1 `fallo_api` y +1 alerta.
  - Corrida 4 (`intentos` = 4 > `reproceso_max_intentos` = 3): la fila pasa a `error`, con +1 en `log_errores` (workflow `reproceso`) y +1 alerta operativa.
  - Ninguna fila se borra.

**8. 429/5xx con el mock**
- Cómo:
  1. Activa "PRUEBA mock API".
  2. En "02 Evaluación", cambia temporalmente la URL del nodo "OpenAI: evaluar conversación" a `http://localhost:5678/webhook/qa-mock-openai`. No exportes ese cambio al repo.
  3. POST de `workflows/pruebas/payload_mock_api.json`.
- Esperado:
  - En Executions de "02 Evaluación": la primera llamada recibe 503, "Esperar antes de reintentar" corre una vez (5 s, `espera_entre_reintentos_ms`) y la segunda recibe 200.
  - `conversaciones`: +1 `evaluada`.
  - `evaluaciones`: +1 con tokens 0 y costo 0. La respuesta del mock es `contrato/ejemplos/llm_output_ejemplo.json`: el resultado es ilustrativo y no mide nada.
  - Sin alertas operativas.
  - Al terminar: restaura la URL a `https://api.openai.com/v1/responses` (o reimporta "02 Evaluación") y desactiva el mock.
  - Nota: el mock alterna 503 y 200 en cada llamada. Si la primera recibió 200, repite con otro `conversation_id`.

**9. Simulador**
- Cómo: tres envíos del formulario, cada uno con `cantidad = 1` y `lote = demo`:
  1. `calidad_solicitada = buena`.
  2. `calidad_solicitada = regular`.
  3. `calidad_solicitada = mala` con `error_critico = critico.no_genera_caso`.
- Esperado por envío:
  - `escenarios`: +1 `demo` con modelo, `version_prompt_generador = generador_ce_v2`, tokens, costo y `semilla_sorteo`.
  - `revision_humana`: +1 `lote = demo` en `pendiente`, con las columnas `h_*` vacías y sin verdad del escenario.
  - `conversaciones`: +1 `evaluada`.
  - `evaluaciones`: +1.
- En el 3: al menos 1 alerta de calidad en Telegram, si el sistema detecta el crítico.
- Si una generación no pasa la validación: un reintento; si vuelve a fallar, `log_errores` +1 `generacion_invalida` con alerta, y esa conversación no se guarda.
- Costo total de las tres dentro del tope de 0.10 USD.

**10. Formulario inválido: lote congelado y cantidad máxima**
- Cómo: formulario con `lote = calibracion_v1`. Después, otro con `cantidad = 6`.
- Esperado por envío:
  - La pantalla muestra **"Formulario rechazado"** con los motivos que devuelve `validarFormulario` (qué corregir), antes de llamar a la API.
  - `log_errores`: +1 con `tipo_error = formulario_invalido` (workflow `simulador`) y `alerta_enviada = no`.
  - Telegram: 0 alertas, porque `debeAlertar` no alerta este tipo.
  - Las hojas `escenarios`, `revision_humana` y `conversaciones` quedan en +0.

**11. Calibración solo se guarda**
- Cómo: POST de una conversación del lote:
  ```bash
  curl -X POST "http://localhost:5678/webhook/qa-ingesta?lote=calibracion_v1" -H "Content-Type: application/json" --data @datos/lotes/calibracion_v1/CONV-0101.json
  ```
- Esperado:
  - `conversaciones`: +1 `pendiente`, **sin evaluar** (`evaluar_al_ingerir_calibracion = no`).
  - `evaluaciones`: +0. Costo 0.
- El "Disparador manual de calibración" de "01 Ingesta" viene **desactivado** y con el `lote` vacío en "Parámetros de calibración". Así no se puede evaluar `calibracion_v1` por accidente antes de tu calificación a ciegas.
- En la Fase 4, después de calificar:
  1. Actívalo (clic derecho > Activate).
  2. Escribe el `lote` y las versiones en "Parámetros de calibración".
  3. Ejecútalo.
- Con el `lote` vacío, "Planificar calibración" lo rechaza y la ejecución se detiene en "Detener: plan inválido".
- Puedes ingerir las 24 del mismo modo: no cuesta nada y quedan pendientes.

**12. Doble ejecución sin filas duplicadas (sin costo, con el mock)**
- Requisito: la prueba 8 terminada, con el mock activo y la URL temporal todavía en "02 Evaluación".
- Cómo:
  1. En `conversaciones`, cambia a mano el `estado` de la fila de `CONV-9005` a `reproceso`.
  2. Ejecuta "04 Reproceso" a mano. Si el mock responde 503 primero, W2 espera y reintenta solo.
- Esperado:
  - La fila vuelve a `evaluada` con `intentos` + 1.
  - `evaluaciones`: +0 (sigue habiendo 1 fila por `llave_dedup`).
  - `detalle_criterios`: +0 (sigue 1 fila por `id_evaluacion` + `id_criterio`). `planificarEscrituraResultados` solo escribe lo que falta.

**13. Conversación atascada (sin costo, con el mock)**
- Requisito: el mismo de la prueba 12.
- Cómo:
  1. En la fila de `CONV-9005`, pon `estado = en_evaluacion` y un `actualizado_en` de hace más de 90 minutos (`evaluacion_tiempo_maximo_min`), con el formato de la hoja, por ejemplo `2026-10-24T08:00:00-06:00`.
  2. Ejecuta "04 Reproceso" a mano.
- Esperado:
  - `log_errores`: +1 `fallo_nodo` (workflow `reproceso`, mensaje "más de 90 minutos en en_evaluacion") con `alerta_enviada = no`.
  - La fila pasa a `reproceso` y se reenvía en la misma corrida: termina en `evaluada`.
  - `evaluaciones`: +0. `detalle_criterios`: +0.
- Después: restaura la URL de OpenAI en "02 Evaluación" y desactiva el mock.

**Prueba de punta a punta:**
- El caso 2 recorre Ingesta > Evaluación > hojas y Telegram.
- El caso 9 recorre Simulador > Ingesta > Evaluación.
- Los casos 7a, 7b, 12 y 13 recorren la cola de reproceso.
- El caso 11 confirma que una conversación del lote de calibración entra y queda en espera, sin gastar en evaluación antes de tu calificación.

### Qué reportar (solo totales)
- Filas nuevas por hoja.
- Alertas por `tipo_alerta`.
- Filas de `log_errores` por `tipo_error`.
- Costo total (suma de `evaluaciones.costo_usd` y `escenarios.costo_generacion_usd`).
- Qué casos no dieron lo esperado.

## 6. Riesgos y limitaciones conocidas (SUPUESTO donde se indica)

- **Schedule de W4 fijo en 30 minutos:** un Schedule Trigger no puede leer la hoja. Si cambias `reproceso_intervalo_min`, cambia también el nodo "Programado (reproceso_intervalo_min)".
- **Cuota de Google Sheets:**
  - Cada evaluación lee 8 hojas o filtros y escribe de 4 a 6 veces.
  - En `demo` no es problema. En un lote completo (24 seguidas) podría acercarse al límite de lecturas por minuto de la API de Google.
  - Los nodos de Sheets reintentan 3 veces con 3 s de espera.
  - Si en la Fase 4 aparece un error de cuota, la mitigación es pasar los datos de referencia desde el workflow que llama.
- **El mock requiere cambiar la URL en W2:** las pruebas 8, 12 y 13 exigen cambiar a mano la URL del nodo "OpenAI: evaluar conversación" y restaurarla después. No exportes ese cambio.
- **Plantilla del evaluador fija en v1:** el nodo "Plantilla evaluador" lleva `prompts/evaluador_ce_v1.md`. Para evaluar con v2 en la Fase 4 hay que cambiar esa ruta en `construir_plantillas.mjs`, reensamblar y reimportar, además de cambiar `config.version_prompt`. Si no coinciden, `leerPlantilla` detiene el nodo.
- **Costo de generación solo del último intento:** si una generación se reintentó, `escenarios` guarda los tokens y el costo del intento que se quedó. El descartado no se suma. Sin tokens o con precios `por_verificar`, la celda queda vacía (`calcularCostoGeneracion` devuelve null).
- **Reproducir un escenario exige el mismo "ahora":** la misma `semilla_sorteo` repite calidad, tema, cuenta y fallas, pero la fecha de inicio se sortea relativa a la hora del envío (`simulador_dias_atras`). Para reproducir todo hay que usar la misma hora de referencia.
- **Supuestos de nombres en el Form Trigger y en Set:**
  - El formulario usa la versión 2.2: las claves del JSON son las etiquetas de los campos, que se llaman igual que los campos del contrato (`calidad_solicitada`, etc.).
  - Los esquemas en nodos Set de tipo `object` deben llegar como objeto al nodo Code.
  - Las dos cosas se confirman al importar; si no, se ajusta la plantilla.
- **99 Errores casi nunca identifica la conversación:** el Error Trigger de n8n 2.32.6 solo entrega `execution { id, url, error, lastNodeExecuted, mode, retryOf, executionContext }` y `workflow { id, name }` (ver `INVENTARIO_NODOS.md`, sección 5), sin los datos de la ejecución.
  - "99 Errores" pasa la conversación a `reproceso` solo si la `llave_dedup` aparece en el mensaje de error.
  - En el resto de los casos la red de seguridad es W4: una conversación que queda en `en_evaluacion` más de `evaluacion_tiempo_maximo_min` (90 min) se pasa a `reproceso` (prueba 13).
- **Escrituras de W1 sin salida de error propia:** "Insertar conversación", "Reactivar conversación" y "Crear filas de la versión" reintentan 3 veces. Si Sheets sigue fallando, la ejecución se detiene y "99 Errores" registra y alerta, pero el webhook ya había dado el acuse: la conversación no quedó guardada. Para recuperarla:
  1. En n8n, abre **Executions** y filtra por "01 Ingesta" con estado **Error**.
  2. Abre la ejecución fallida y haz clic en el nodo **"Webhook de ingesta"**.
  3. En su salida, copia el objeto `body` (vista JSON) y anota el valor de `query.lote`.
  4. Guarda el `body` en un archivo, por ejemplo `reenvio.json`, y reenvíalo con el mismo lote:
     - Git Bash:
       ```bash
       curl -X POST "http://localhost:5678/webhook/qa-ingesta?lote=demo" -H "Content-Type: application/json" --data @reenvio.json
       ```
     - PowerShell:
       ```powershell
       Invoke-RestMethod -Method Post -Uri "http://localhost:5678/webhook/qa-ingesta?lote=demo" -ContentType "application/json" -InFile reenvio.json
       ```
  5. Si la fila sí se había guardado antes de la falla, la deduplicación por `llave_dedup` la trata como duplicado: no se crea una segunda fila.
  - El historial existe porque n8n 2.32.6 guarda por defecto los datos de las ejecuciones fallidas (`saveDataOnError = 'all'` en `@n8n/config`, `executions.config.js`) y los conserva 336 horas (14 días, `pruneDataMaxAge`), salvo que tu Docker cambie `EXECUTIONS_DATA_SAVE_ON_ERROR` o la poda. Además, "01 Ingesta" trae `settings.saveDataErrorExecution = 'all'` (en la UI: **... > Settings > Save failed production executions = Save**), así que lo guarda aunque el valor global cambie. Recupera dentro de ese plazo.
- **Timeout de cada petición a OpenAI y Claude:** sale de `config.tiempo_maximo_peticion_llm_ms` por expresión. Un timeout se trata como falla de red y se reintenta con espera.
- **Cierre del lote en W4:** `cierrePorLotes` agrupa por el `lote` que devuelve W2. Una evaluación que terminó en error no trae `lote` y no entra al resumen (su alerta operativa ya se envió).
- **IDs del simulador y rango reservado para pruebas:** `CONV-9000` a `CONV-9999` está reservado para los archivos de `workflows/pruebas/` y las copias manuales (`RANGO_IDS_PRUEBA` en js/simulador.js). `generarIdsConversacion` toma el mayor ID de `escenarios`, `conversaciones` y `revision_humana`, **ignora los de ese rango** y le suma 1, sin generar nunca un ID dentro de él (de `CONV-8999` salta a `CONV-10000`). Así el simulador no choca con los archivos de prueba y ya no importa si corres primero el simulador o las pruebas. Si haces una copia manual de un payload, usa un ID libre de ese rango.
- **Una alerta enviada puede quedar sin fila en `alertas` si Sheets falla:** "Escribir alertas (...)" reintenta 3 veces y, si sigue fallando, la ejecución continúa sin esa fila. En la cadena de errores, `log_errores` se escribe igual, con el resultado real del envío.
- **W4 reenvía dos grupos por separado** (reproceso y atascadas): el cierre del lote puede salir en dos mensajes en la misma corrida.

## 7. Si algo falla
- Revisa primero `log_errores` (workflow, nodo, tipo de error) y la ejecución en **Executions** de n8n.
- Si cambiaste un nodo Code o Set en la UI, no lo exportes al repo: la prueba de sincronía lo marcará. El cambio se pide al subagente dueño de `js/` o `prompts/` y se reensambla.
