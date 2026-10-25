# Inventario de nodos de la instancia local de n8n

Verificado el 24-oct-2026 con comandos de **solo lectura** sobre el contenedor Docker `n8n` (imagen `docker.n8n.io/n8nio/n8n`, `n8n --version` = **2.32.6**). No hay MCP de n8n configurado; esto sustituye esa validación. La prueba definitiva sigue siendo importar los workflows.

Qué se hizo (y qué no):
- Se listaron directorios y se leyeron archivos de código del paquete `n8n-nodes-base` y de `n8n-workflow` / `n8n-core` dentro del contenedor (`ls`, `grep`, y `node -e` leyendo `dist/types/nodes.json`, que es la descripción estática de los nodos).
- **No** se leyeron credenciales, ni la base de datos de n8n, ni variables de entorno; no se usó la API de n8n; no se importó ni activó nada.

Rutas base dentro del contenedor:
- `B` = `/usr/local/lib/node_modules/n8n/node_modules/n8n-nodes-base/dist/nodes`
- `n8n-workflow` = `/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-workflow@.../node_modules/n8n-workflow/dist/cjs/interfaces.d.ts`
- `n8n-core` = `/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-core@.../node_modules/n8n-core/dist/execution-engine/workflow-execute.js`

## 1. Nodos y `typeVersion`

La columna 3 es la versión máxima disponible. La versión que usa cada workflow está en la sección 4: se eligió la que tiene los parámetros que necesitamos, todas confirmadas en el contenedor y comprobadas por `workflows/tests/estructura.test.js`.

| Nodo (UI) | `type` en el JSON | `typeVersion` máxima | Versiones disponibles | Archivo fuente (bajo `B`) |
|---|---|---|---|---|
| Webhook | `n8n-nodes-base.webhook` | 2.1 | 1, 1.1, 2, 2.1 | `Webhook/Webhook.node.js` (parámetros en `Webhook/description.js`) |
| Respond to Webhook | `n8n-nodes-base.respondToWebhook` | 1.5 | 1, 1.1, 1.2, 1.3, 1.4, 1.5 | `RespondToWebhook/RespondToWebhook.node.js` |
| Form Trigger (n8n Form Trigger) | `n8n-nodes-base.formTrigger` | 2.6 | 1; 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | `Form/FormTrigger.node.js` (v2 en `Form/v2/FormTriggerV2.node.js`) |
| Code | `n8n-nodes-base.code` | 2 | 1, 2 | `Code/Code.node.js` |
| IF | `n8n-nodes-base.if` | 2.3 | 1; 2, 2.1, 2.2, 2.3 | `If/If.node.js` (v2 en `If/V2/IfV2.node.js`) |
| Switch | `n8n-nodes-base.switch` | 3.4 | 1; 2; 3, 3.1, 3.2, 3.3, 3.4 | `Switch/Switch.node.js` (v3 en `Switch/V3/SwitchV3.node.js`) |
| Wait | `n8n-nodes-base.wait` | 1.1 | 1, 1.1 | `Wait/Wait.node.js` |
| HTTP Request | `n8n-nodes-base.httpRequest` | 4.4 | 1; 2; 3, 4, 4.1, 4.2, 4.3, 4.4 | `HttpRequest/HttpRequest.node.js` (v3+ en `HttpRequest/V3/HttpRequestV3.node.js`, parámetros en `HttpRequest/V3/Description.js`) |
| Google Sheets | `n8n-nodes-base.googleSheets` | 4.7 | 1, 2; 3, 4, 4.1 … 4.7 | `Google/Sheet/GoogleSheets.node.js` (v2 en `Google/Sheet/v2/actions/versionDescription.js`) |
| Telegram | `n8n-nodes-base.telegram` | 1.2 | 1, 1.1, 1.2 | `Telegram/Telegram.node.js` |
| Execute Workflow (Execute Sub-workflow) | `n8n-nodes-base.executeWorkflow` | 1.3 | 1, 1.1, 1.2, 1.3 | `ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.js` |
| Execute Workflow Trigger (When Executed by Another Workflow) | `n8n-nodes-base.executeWorkflowTrigger` | 1.2 | 1, 1.1, 1.2 | `ExecuteWorkflow/ExecuteWorkflowTrigger/ExecuteWorkflowTrigger.node.js` |
| Schedule Trigger | `n8n-nodes-base.scheduleTrigger` | 1.3 | 1, 1.1, 1.2, 1.3 | `Schedule/ScheduleTrigger.node.js` |
| Manual Trigger | `n8n-nodes-base.manualTrigger` | 1 | 1 | `ManualTrigger/ManualTrigger.node.js` |
| Error Trigger | `n8n-nodes-base.errorTrigger` | 1 | 1 | `ErrorTrigger/ErrorTrigger.node.js` |
| Set (Edit Fields) | `n8n-nodes-base.set` | 3.5 | 1, 2; 3, 3.1 … 3.5 | `Set/Set.node.js` (v3 en `Set/v2/SetV2.node.js`) |
| Merge | `n8n-nodes-base.merge` | 3.2 | 1; 2, 2.1; 3, 3.1, 3.2 | `Merge/Merge.node.js` (v3 en `Merge/v3/actions/versionDescription.js`) |
| Loop Over Items (Split In Batches) | `n8n-nodes-base.splitInBatches` | 3 | 1, 2, 3 | `SplitInBatches/SplitInBatches.node.js` (v3 en `SplitInBatches/v3/SplitInBatchesV3.node.js`) |

Nodos auxiliares que también existen (por si la parte 2 los necesita): No Operation (`noOp`, 1), Stop and Error (`stopAndError`, 1), Filter (`filter`, 2.3), Aggregate (`aggregate`, 1), Split Out (`splitOut`, 1), Limit (`limit`, 1), Remove Duplicates (`removeDuplicates`, 2).

## 2. Tipos de credencial disponibles

Confirmados en `n8n-nodes-base/dist/types/credentials.json` (solo la definición del tipo, no credenciales guardadas):

| Uso en el proyecto | Tipo de credencial (clave en `credentials` del nodo) | Nombre en la UI |
|---|---|---|
| OpenAI (HTTP Request, encabezado `Authorization: Bearer ...`) | `httpHeaderAuth` | Header Auth |
| Anthropic (HTTP Request, encabezado `x-api-key`) | `httpHeaderAuth` | Header Auth |
| Google Sheets | `googleSheetsOAuth2Api` | Google Sheets OAuth2 API |
| Telegram | `telegramApi` | Telegram API |

Existen además `openAiApi` (en `n8n-nodes-base`) y `anthropicApi` (en `@n8n/n8n-nodes-langchain`), pero el plan usa HTTP Request con Header Auth para controlar el cuerpo exacto de la petición y la respuesta completa.

## 3. Cómo se declaran las opciones en el JSON exportado

### Credenciales (en el nodo, fuera de `parameters`)
```json
"credentials": {
  "httpHeaderAuth": { "id": "<ASIGNAR_EN_N8N>", "name": "OpenAI (Authorization Bearer)" }
}
```
En el HTTP Request además: `"authentication": "genericCredentialType"` y `"genericAuthType": "httpHeaderAuth"` dentro de `parameters`. En Google Sheets: `"authentication": "oAuth2"` (valores posibles `serviceAccount` y `oAuth2`, en `Google/Sheet/v2/actions/versionDescription.js`). Fuente de la forma `{ id, name }`: interfaz `INodeCredentials` de `n8n-workflow`.

### HTTP Request: respuesta completa y "nunca fallar"
Opción `Response` (colección fija) dentro de `parameters.options` (`HttpRequest/V3/Description.js`, líneas ~867-900):
```json
"options": {
  "response": { "response": { "fullResponse": true, "neverError": true, "responseFormat": "json" } }
}
```
- `fullResponse` = "Include Response Headers and Status": la salida es `{ statusCode, headers, body }`.
- `neverError` = "Never Error": un código distinto de 2xx no detiene el nodo. Un error de red o timeout sí lo detiene (por eso el nodo también lleva reintentos y salida de error).
- `responseFormat`: `autodetect`, `file`, `json` o `text`.

### Reintentos y salida de error (en el nodo, fuera de `parameters`)
Interfaz `INode` de `n8n-workflow` (`interfaces.d.ts`, líneas 1003-1030):
```json
"retryOnFail": true,
"maxTries": 3,
"waitBetweenTries": 5000,
"onError": "continueErrorOutput"
```
- `onError` admite `continueErrorOutput`, `continueRegularOutput` y `stopWorkflow` (tipo `OnError`, línea 1002). Con `continueErrorOutput` el nodo tiene una segunda salida ("error") que se conecta en `connections` como la salida de índice 1.
- **Límites que aplica el motor** (`n8n-core`, `workflow-execute.js`, líneas ~941-950): `maxTries` se recorta a **2..5** (por defecto 3) y `waitBetweenTries` a **0..5000 ms** (por defecto 1000). Por eso los reintentos por 429/5xx con espera configurable (`espera_entre_reintentos_ms`, `Retry-After` de hasta `espera_maxima_reintento_ms` = 60000) se hacen con `js/clasificacion_http.js` + un nodo Wait, no con los reintentos nativos del nodo.
- Los reintentos nativos solo actúan cuando el nodo **falla**. Con `neverError: true`, un 429 o 5xx no es una falla del nodo: lo decide `clasificacion_http.js`. Los nativos quedan para errores de red y timeout.

### Error workflow (en `settings` del workflow)
Interfaz `IWorkflowSettings` (`interfaces.d.ts`, líneas 2789-2805):
```json
"settings": { "executionOrder": "v1", "errorWorkflow": "<ID_WORKFLOW_ERRORES>" }
```
`errorWorkflow` es el **ID** del workflow de errores en tu instancia (cambia al importar), por eso va con marcador. También existen `callerPolicy` (`any`, `none`, `workflowsFromAList`, `workflowsFromSameOwner`), útil para que W2 solo lo llamen W1 y W4.

### Nodo Code
`parameters`: `jsCode` (texto), `mode` (`runOnceForAllItems` por defecto, o `runOnceForEachItem`) y `language` (`javaScript` por defecto). El código corre dentro de una función asíncrona: admite `return` y `await` en el nivel superior.

### Nodo Set (v3.3+) con valor fijo
```json
"assignments": { "assignments": [ { "id": "<uuid>", "name": "plantilla_evaluador", "value": "<texto>", "type": "string" } ] }
```
Un valor es **expresión** solo si empieza con `=`; sin `=` es texto fijo. Para `type: "object"` el texto se convierte a objeto con `tryToParseObject` (`n8n-workflow`, `type-validation.js`). SUPUESTO por verificar al importar: que el esquema JSON pegado como texto en un campo `object` llegue como objeto al nodo Code; si no, se cambia el tipo a `string` y el pegamento hace `JSON.parse`.

### Otros parámetros confirmados
- Webhook `responseMode`: `onReceived`, `lastNode`, `responseNode`, `streaming` (`Webhook/description.js`).
- Google Sheets, operaciones de la hoja: `append`, `appendOrUpdate`, `clear`, `delete`, `read`, `update` (`Google/Sheet/v2/actions/sheet/Sheet.resource.js`).
- Telegram `sendMessage`: `chatId`, `text` y `additionalFields.parse_mode`; existe la opción `appendAttribution` (texto "This message was sent automatically with n8n"), que conviene apagar.
- Execute Workflow v1.1+: `workflowId` es un selector de workflow (`workflowSelector`), `mode` = `once` o `each`, opción `waitForSubWorkflow`. Execute Workflow Trigger v1.1+: modo de entrada `passthrough` o campos definidos.

## 4. Versiones que usan los workflows (parte 2)

| Nodo | `typeVersion` usada | Por qué esa |
|---|---|---|
| Webhook | 2 | `responseMode: onReceived` (acuse inmediato) y `responseNode` (mock). |
| Respond to Webhook | 1.1 | Solo en el mock: `respondWith: json` y `options.responseCode`. |
| Form Trigger | 2.2 | `formFields` con `fieldLabel` = nombre del campo (así el JSON de salida usa `calidad_solicitada`, etc.) y `options.path = qa-simulador`. Desde 2.4 existe `fieldName`; se deja también por si la UI lo usa. |
| Code | 2 | `jsCode` y `mode` (`runOnceForEachItem` o por defecto todos los ítems). |
| IF | 2.2 | Condición booleana estricta sobre un campo calculado por `js/`. |
| Switch | 3.2 | Reglas por valor de `accion`, una salida con nombre por valor. |
| Wait | 1.1 | `resume: timeInterval`, `amount` en segundos desde `espera_ms`. |
| HTTP Request | 4.4 | `fullResponse` + `neverError`, cuerpo JSON por expresión, Header Auth. |
| Google Sheets | 4.7 | `read` con `filtersUI` (en 4.7 devuelve **todas** las coincidencias; `returnFirstMatch` es falso por defecto), `append` y `update` con `columns.mappingMode = autoMapInputData`, `options.cellFormat = RAW` y `options.handlingExtraData = ignoreIt` (`Google/Sheet/v2/actions/sheet/*.operation.js`, `helpers/GoogleSheets.utils.js`). La lectura corre una vez por ítem de entrada, por eso las de referencia llevan `executeOnce`. |
| Telegram | 1.2 | `sendMessage` devuelve `{ ok, result }` (`Telegram.node.js`, línea ~2344); `estadoEnvio` de `js/alertas.js` lee `ok`. Con `continueErrorOutput` la falla sale como `{ error }`. |
| Execute Workflow | 1.2 | `workflowId` como resource locator (modo `id`), `mode: each` (una ejecución por ítem, en orden) y `waitForSubWorkflow`. |
| Execute Workflow Trigger | 1.1 | `inputSource: passthrough` (constante `PASSTHROUGH` en `utils/workflowInputsResourceMapping/constants.js`). |
| Schedule Trigger | 1.2 | `rule.interval[0] = { field: minutes, minutesInterval: 30 }`. |
| Manual Trigger, Error Trigger | 1 | Únicas versiones. |
| Set | 3.4 | Modo `manual` (`assignments`, `includeOtherFields`, `include: except`) y modo `raw` (`jsonOutput` con una expresión que devuelve un objeto; `parseJsonParameter` acepta objetos). |
| Loop Over Items | 3 | `batchSize: 1`; salida 0 = terminado, salida 1 = siguiente ítem. |
| Split Out | 1 | `fieldToSplitOut` + `include: noOtherFields`. Con elementos objeto los copia al nivel superior; con elementos texto usa `options.destinationFieldName`. |
| n8n Form (Form Ending) | 1 | `operation: completion`, `respondWith: text`, `completionTitle` y `completionMessage` (expresión). Si un nodo Form está conectado, el Form Trigger responde con ese nodo (`responseMode = responseNode` forzado en `Form/utils/utils.js`, ~línea 714). Versiones disponibles: 1, 2.3, 2.4, 2.5. |
| No Operation, Stop and Error | 1 | Puntos de paso y rechazo explícito (el Stop and Error dispara el error workflow). |

## 5. Qué entrega el Error Trigger (para identificar la conversación)

Código: `/usr/local/lib/node_modules/n8n/dist/execution-lifecycle/execute-error-workflow.js`, líneas 18-47. El ítem que recibe "99 Errores" es:
`{ execution: { id, url, error, lastNodeExecuted, mode, retryOf, executionContext }, workflow: { id, name } }`.
No incluye los datos de los ítems de la ejecución fallida. Por eso la `llave_dedup` solo se obtiene si aparece en el texto del error, y no hay forma fiable de obtenerla sin la API de n8n (que no se usa). La red de seguridad es W4: recoge las conversaciones atascadas en `en_evaluacion` (`evaluacion_tiempo_maximo_min`).
El error workflow se ejecuta para toda ejecución que no sea manual (`execution-lifecycle-hooks.js`, líneas ~423 y ~451), incluidas las de sub-workflow.
