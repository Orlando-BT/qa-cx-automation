// =============================================================================
// construir_plantillas.mjs — fuente de las plantillas de los workflows.
// -----------------------------------------------------------------------------
// Dueño: subagente workflows-n8n. Node 20+ sin dependencias.
//
// Por qué existe: escribir a mano el JSON de n8n (IDs, posiciones, conexiones) es frágil.
// Aquí cada workflow se describe con pocas líneas (nodo, tipo, parámetros, conexiones) y el
// script escribe workflows/plantillas/<nombre>.json. Después, ensamblar.mjs rellena los nodos
// Code y Set marcados con js/, workflows/pegamento/, prompts/ y contrato/.
//
// Este archivo NO contiene lógica de evaluación: solo la forma de los workflows (qué nodo va
// después de cuál, con qué credencial y qué reintentos). Las decisiones están en js/.
//
// Uso:
//   node workflows/herramientas/construir_plantillas.mjs              escribe plantillas y pruebas/
//   node workflows/herramientas/construir_plantillas.mjs --verificar  compara sin escribir
// =============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');

const CRED = '<ASIGNAR_EN_N8N>';
const LIBRO = '<ID_LIBRO_SHEETS>';
const ID_W2 = '<ID_WORKFLOW_EVALUACION>';
const ID_WE = '<ID_WORKFLOW_ERRORES>';
const URL_INGESTA = '<URL_WEBHOOK_INGESTA>';

const CREDENCIALES = {
  openai: { httpHeaderAuth: { id: CRED, name: 'OpenAI (Authorization Bearer)' } },
  anthropic: { httpHeaderAuth: { id: CRED, name: 'Anthropic (x-api-key)' } },
  sheets: { googleSheetsOAuth2Api: { id: CRED, name: 'Google Sheets QA' } },
  telegram: { telegramApi: { id: CRED, name: 'Telegram bot QA' } },
};

// Reintento nativo de n8n: red de seguridad de conexión para Sheets y Telegram (el motor lo
// limita a 2..5 intentos y a 5000 ms de espera). OpenAI y Claude usan clasificacion_http.js.
const REINTENTO_NATIVO = { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 };

/** UUID estable a partir de un texto (para que el JSON no cambie entre corridas). */
function uuid(texto) {
  const h = createHash('sha1').update(texto).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// -----------------------------------------------------------------------------
// Constructor de un workflow
// -----------------------------------------------------------------------------

function nuevoWorkflow(nombre, { conErrorWorkflow = true, callerPolicy } = {}) {
  const wf = { name: nombre, nodes: [], connections: {}, settings: { executionOrder: 'v1' } };
  if (conErrorWorkflow) wf.settings.errorWorkflow = ID_WE;
  if (callerPolicy) wf.settings.callerPolicy = callerPolicy;
  const api = {
    wf,
    /** Agrega un nodo. pos = [columna, fila] en una cuadrícula. */
    nodo(nombreNodo, type, typeVersion, parameters, pos, extra = {}) {
      if (wf.nodes.some((n) => n.name === nombreNodo)) throw new Error(`nodo repetido en ${nombre}: ${nombreNodo}`);
      const n = { parameters, id: uuid(`${nombre}/${nombreNodo}`), name: nombreNodo, type, typeVersion, position: [pos[0] * 240, pos[1] * 180], ...extra };
      wf.nodes.push(n);
      return nombreNodo;
    },
    /** Conecta la salida `salida` de `de` con la entrada 0 de `a`. */
    une(de, a, salida = 0) {
      for (const x of [de, a]) if (!wf.nodes.some((n) => n.name === x)) throw new Error(`conexión con nodo inexistente en ${nombre}: ${x}`);
      const c = (wf.connections[de] = wf.connections[de] || { main: [] });
      while (c.main.length <= salida) c.main.push([]);
      c.main[salida].push({ node: a, type: 'main', index: 0 });
    },
    /** Encadena nodos por la salida 0. */
    cadena(...nombres) {
      for (let i = 0; i < nombres.length - 1; i++) api.une(nombres[i], nombres[i + 1]);
    },
  };
  return api;
}

// -----------------------------------------------------------------------------
// Fábricas de nodos (solo forma; nada de lógica)
// -----------------------------------------------------------------------------

const rl = (value, mode) => ({ __rl: true, value, mode });

function code(w, nombre, fuentes, pegamento, pos, { modo = 'each', ...extra } = {}) {
  const lineas = [...fuentes.map((f) => `// FUENTE: js/${f}.js`), `// PEGAMENTO: pegamento/${pegamento}.js`];
  const parameters = { jsCode: lineas.join('\n') + '\n' };
  if (modo === 'each') parameters.mode = 'runOnceForEachItem';
  return w.nodo(nombre, 'n8n-nodes-base.code', 2, parameters, pos, extra);
}

function hojaLeer(w, nombre, hoja, pos, { filtros = [], combinar = 'AND', unaVez = true, siempreSalida = false } = {}) {
  const parameters = {
    authentication: 'oAuth2',
    documentId: rl(LIBRO, 'id'),
    sheetName: rl(hoja, 'name'),
    options: {},
  };
  if (filtros.length) {
    parameters.filtersUI = { values: filtros.map(([lookupColumn, lookupValue]) => ({ lookupColumn, lookupValue })) };
    parameters.combineFilters = combinar;
    // En la versión 4.7 un filtro devuelve todas las filas que coinciden (returnFirstMatch = false).
  }
  const extra = { ...REINTENTO_NATIVO, credentials: CREDENCIALES.sheets };
  if (unaVez) extra.executeOnce = true;
  if (siempreSalida) extra.alwaysOutputData = true;
  return w.nodo(nombre, 'n8n-nodes-base.googleSheets', 4.7, parameters, pos, extra);
}

function hojaEscribir(w, nombre, hoja, pos, { operacion = 'append', coincidir = [], alFallar } = {}) {
  const parameters = {
    authentication: 'oAuth2',
    operation: operacion,
    documentId: rl(LIBRO, 'id'),
    sheetName: rl(hoja, 'name'),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: coincidir, schema: [], attemptToConvertTypes: false, convertFieldsToString: false },
    // RAW: se guarda el texto tal cual (sin que Sheets convierta fechas, teléfonos o listas).
    // ignoreIt: los campos auxiliares del ítem que no son columnas no se escriben.
    options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
  };
  const extra = { ...REINTENTO_NATIVO, credentials: CREDENCIALES.sheets };
  if (alFallar) extra.onError = alFallar;
  return w.nodo(nombre, 'n8n-nodes-base.googleSheets', 4.7, parameters, pos, extra);
}

function setRelleno(w, nombre, campo, ruta, tipo, pos) {
  return w.nodo(
    nombre,
    'n8n-nodes-base.set',
    3.4,
    { assignments: { assignments: [{ id: uuid(`${nombre}/${campo}`), name: campo, value: '', type: tipo }] }, options: {} },
    pos,
    { executeOnce: true, notes: `RELLENO ${campo} <- ${ruta}` }
  );
}

/** Set con campos (manual). campos: [nombre, tipo, valor]. */
function setCampos(w, nombre, campos, pos, { incluirOtros = false, excluir, ...extra } = {}) {
  const parameters = {
    assignments: { assignments: campos.map(([name, type, value]) => ({ id: uuid(`${w.wf.name}/${nombre}/${name}`), name, value, type })) },
    options: {},
  };
  if (incluirOtros) {
    parameters.includeOtherFields = true;
    if (excluir) {
      parameters.include = 'except';
      parameters.excludeFields = excluir.join(',');
    }
  }
  return w.nodo(nombre, 'n8n-nodes-base.set', 3.4, parameters, pos, extra);
}

/** Set en modo JSON: el ítem de salida es exactamente el objeto de la expresión. */
function setJson(w, nombre, expresion, pos, extra = {}) {
  return w.nodo(nombre, 'n8n-nodes-base.set', 3.4, { mode: 'raw', jsonOutput: `={{ ${expresion} }}`, options: {} }, pos, extra);
}

function si(w, nombre, expresionBooleana, pos) {
  return w.nodo(
    nombre,
    'n8n-nodes-base.if',
    2.2,
    {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: uuid(`${w.wf.name}/${nombre}/c`), leftValue: `={{ ${expresionBooleana} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    pos
  );
}

/** Switch por el valor de un campo de texto. Cada valor es una salida, en orden. */
function segun(w, nombre, expresion, valores, pos) {
  return w.nodo(
    nombre,
    'n8n-nodes-base.switch',
    3.2,
    {
      rules: {
        values: valores.map((v) => ({
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: uuid(`${w.wf.name}/${nombre}/${v}`), leftValue: `={{ ${expresion} }}`, rightValue: v, operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: v,
        })),
      },
      options: {},
    },
    pos
  );
}

function telegram(w, nombre, expresionChat, pos) {
  return w.nodo(
    nombre,
    'n8n-nodes-base.telegram',
    1.2,
    // parse_mode HTML: sin él, el nodo Telegram 1.2 usa Markdown por defecto (GenericFunctions.js de
    // n8n 2.32.6) y los guiones bajos de 'critico.promesa_no_autorizada' se vuelven cursiva o rompen
    // el envío. texto_html es el texto de js/alertas.js con &, < y > escapados; en `alertas`
    // (texto_enviado) se guarda el texto plano.
    { chatId: `={{ ${expresionChat} }}`, text: '={{ $json.texto_html }}', additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
    pos,
    // La salida de error también va al nodo que arma la fila de `alertas` (estado_envio = fallida).
    { ...REINTENTO_NATIVO, onError: 'continueErrorOutput', credentials: CREDENCIALES.telegram }
  );
}

function llamadaApi(w, nombre, url, campoCuerpo, credentials, pos, encabezados = []) {
  const parameters = {
    method: 'POST',
    url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: encabezados.length > 0,
    headerParameters: { parameters: encabezados.map(([name, value]) => ({ name, value })) },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify($json.${campoCuerpo}) }}`,
    options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: '={{ $json.config.tiempo_maximo_peticion_llm_ms }}' },
  };
  if (!encabezados.length) delete parameters.headerParameters;
  // Sin reintento nativo: 429/5xx y fallas de red las decide clasificacion_http.js. La salida de
  // error (red o timeout) va al mismo nodo clasificador.
  return w.nodo(nombre, 'n8n-nodes-base.httpRequest', 4.4, parameters, pos, { onError: 'continueErrorOutput', credentials });
}

function esperar(w, nombre, pos) {
  return w.nodo(nombre, 'n8n-nodes-base.wait', 1.1, { resume: 'timeInterval', amount: '={{ $json.clasificacion_http.espera_ms / 1000 }}', unit: 'seconds' }, pos, { webhookId: uuid(`${w.wf.name}/${nombre}/webhook`) });
}

/** Pantalla final del formulario (n8n Form, operación completion). */
function finFormulario(w, nombre, titulo, expresionMensaje, pos) {
  return w.nodo(nombre, 'n8n-nodes-base.form', 1, { operation: 'completion', respondWith: 'text', completionTitle: titulo, completionMessage: `={{ ${expresionMensaje} }}` }, pos);
}

function noOp(w, nombre, pos, extra = {}) {
  return w.nodo(nombre, 'n8n-nodes-base.noOp', 1, {}, pos, extra);
}

function detener(w, nombre, pos) {
  return w.nodo(nombre, 'n8n-nodes-base.stopAndError', 1, { errorMessage: "={{ $json.errores.join(' | ') }}" }, pos);
}

function separar(w, nombre, campo, pos, destino) {
  const parameters = { fieldToSplitOut: campo, include: 'noOtherFields', options: {} };
  if (destino) parameters.options.destinationFieldName = destino;
  return w.nodo(nombre, 'n8n-nodes-base.splitOut', 1, parameters, pos);
}

function llamarEvaluacion(w, nombre, pos) {
  return w.nodo(
    nombre,
    'n8n-nodes-base.executeWorkflow',
    1.2,
    {
      source: 'database',
      workflowId: rl(ID_W2, 'id'),
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      mode: 'each',
      options: { waitForSubWorkflow: true },
    },
    pos,
    // Una conversación que falla no detiene el lote: W2 tiene su propio error workflow.
    { onError: 'continueRegularOutput' }
  );
}

// -----------------------------------------------------------------------------
// Cadena común: alerta operativa + hoja alertas + log_errores
// -----------------------------------------------------------------------------
// Entrada: ítems { registrar_error, enviar_alerta, config, ... } (registrar_error con la forma de
// filaLogErrores). Las decisiones (qué error, si se alerta) ya vienen de js/.
// Orden: "Fila log_errores" fija id_error, hora y consecutivo (la alerta cita ese id_error); después
// se intenta el Telegram y se registra en `alertas`; al final se escribe log_errores con
// alerta_enviada = resultado real del envío (false si no se debía alertar o si el envío falló).
// Ningún ítem que llega a un nodo de escritura trae claves que no sean columnas de su hoja.
function cadenaErrores(w, entradas, col, fila, siguiente) {
  const f = code(w, 'Fila log_errores', ['registro_errores'], 'cadena_fila_log_errores', [col, fila]);
  for (const [nodo, salida] of entradas) w.une(nodo, f, salida);
  const decide = si(w, '¿Enviar alerta operativa?', '$json.enviar_alerta', [col + 1, fila]);
  const armar = code(w, 'Armar alerta operativa', ['alertas'], 'cadena_armar_alerta_operativa', [col + 2, fila - 1]);
  const tg = telegram(w, 'Telegram: alerta operativa', '$json.config.telegram_destinatario', [col + 3, fila - 1]);
  const filaAl = code(w, 'Fila alertas (operativa)', ['alertas'], 'cadena_fila_alertas_operativa', [col + 4, fila - 1]);
  const escAl = hojaEscribir(w, 'Escribir alertas (operativa)', 'alertas', [col + 5, fila - 1], { alFallar: 'continueRegularOutput' });
  const tras = code(w, 'Fila log_errores (tras el envío)', ['registro_errores'], 'cadena_log_errores_tras_envio', [col + 6, fila - 1]);
  const sin = code(w, 'Fila log_errores (sin alerta)', ['registro_errores'], 'cadena_log_errores_sin_alerta', [col + 6, fila + 1]);
  const esc = hojaEscribir(w, 'Escribir log_errores', 'log_errores', [col + 7, fila], { alFallar: 'continueRegularOutput' });
  w.cadena(f, decide, armar, tg, filaAl, escAl, tras, esc);
  w.une(tg, filaAl, 1);
  w.une(decide, sin, 1);
  w.une(sin, esc);
  if (siguiente) w.une(esc, siguiente);
  return f;
}

// =============================================================================
// 02 Evaluación (W2)
// =============================================================================
function w2() {
  const w = nuevoWorkflow('02 Evaluación', { callerPolicy: 'workflowsFromSameOwner' });
  const t = w.nodo('Recibir conversación', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, { inputSource: 'passthrough' }, [0, 0]);
  const conv = hojaLeer(w, 'Leer conversación', 'conversaciones', [1, 0], { filtros: [['llave_dedup', '={{ $json.llave_dedup }}']], unaVez: false });
  const cfg = hojaLeer(w, 'Leer hoja config', 'config', [2, 0]);
  const lis = hojaLeer(w, 'Leer hoja listas', 'listas', [3, 0]);
  const cat = hojaLeer(w, 'Leer hoja catalogo_temas', 'catalogo_temas', [4, 0]);
  const kb = hojaLeer(w, 'Leer hoja base_conocimiento', 'base_conocimiento', [5, 0]);
  const cue = hojaLeer(w, 'Leer hoja cuentas', 'cuentas', [6, 0]);
  const pl = setRelleno(w, 'Plantilla evaluador', 'plantilla_evaluador', 'prompts/evaluador_ce_v1.md', 'string', [7, 0]);
  const es = setRelleno(w, 'Esquema LLM', 'esquema_llm', 'contrato/llm_output.schema.json', 'object', [8, 0]);
  const js1 = code(w, 'JS-1 Normalización', ['normalizacion', 'costo'], 'js1_normalizacion', [9, 0], { modo: 'all' });
  const ent = code(w, 'Entrada a evaluación', ['ingesta'], 'entrada_evaluacion', [10, 0], { modo: 'all' });
  const upEnt = hojaEscribir(w, 'Actualizar conversación: en evaluación', 'conversaciones', [11, 0], { operacion: 'update', coincidir: ['llave_dedup'] });
  const js2 = code(w, 'JS-2 Extracción y enmascaramiento', ['enmascaramiento'], 'js2_extraccion_enmascaramiento', [12, 0], { modo: 'all' });
  const js3 = code(w, 'JS-3 Reglas deterministas', ['reglas'], 'js3_reglas_deterministas', [13, 0]);
  w.cadena(t, conv, cfg, lis, cat, kb, cue, pl, es, js1, ent, upEnt, js2, js3);

  const sinAg = si(w, '¿Sin mensajes del agente?', '$json.resultados_js.variables.sin_mensajes_agente', [14, 0]);
  w.une(js3, sinAg);
  const js4 = code(w, 'JS-4 Construcción del prompt', ['construccion_prompt'], 'js4_construccion_prompt', [15, 2]);
  w.une(sinAg, js4, 1);
  const prep = noOp(w, 'Preparar llamada OpenAI', [16, 2]);
  const api = llamadaApi(w, 'OpenAI: evaluar conversación', 'https://api.openai.com/v1/responses', 'peticion_openai', CREDENCIALES.openai, [17, 2]);
  const cls = code(w, 'Clasificar respuesta OpenAI', ['clasificacion_http'], 'clasificar_respuesta_openai', [18, 2]);
  w.cadena(js4, prep, api, cls);
  w.une(api, cls, 1);
  const swHttp = segun(w, 'Según respuesta HTTP', '$json.clasificacion_http.accion', ['continuar', 'reintentar', 'falla_api'], [19, 2]);
  w.une(cls, swHttp);
  const wait = esperar(w, 'Esperar antes de reintentar', [19, 4]);
  const inc = setCampos(w, 'Contar reintento de conexión', [['intento_conexion', 'number', '={{ $json.clasificacion_http.siguiente_intento }}']], [18, 4], { incluirOtros: true });
  w.une(swHttp, wait, 1);
  w.cadena(wait, inc, prep);

  const js5 = code(w, 'JS-5 Validación de la respuesta', ['validador_llm', 'costo'], 'js5_validacion_respuesta', [20, 2]);
  w.une(swHttp, js5, 0);
  const sw5 = segun(w, 'Según validación', '$json.accion', ['falla_api', 'rechazo_llm', 'reintentar_incompleta', 'respuesta_llm_invalida', 'reintentar_validacion', 'continuar'], [21, 2]);
  w.une(js5, sw5);
  const reInc = code(w, 'Reintento por respuesta incompleta', ['construccion_prompt'], 'reintento_incompleta', [21, 5]);
  const reVal = code(w, 'Preparar reintento OpenAI', ['construccion_prompt'], 'reintento_validacion', [20, 5]);
  w.une(sw5, reInc, 2);
  w.une(sw5, reVal, 4);
  w.une(reInc, prep);
  w.une(reVal, prep);

  const js6 = code(w, 'JS-6 Reglas híbridas', ['reglas_hibridas'], 'js6_reglas_hibridas', [22, 0]);
  w.une(sinAg, js6, 0);
  w.une(sw5, js6, 5);
  const js7 = code(w, 'JS-7 Scoring', ['scoring'], 'js7_scoring', [23, 0], { onError: 'continueErrorOutput' });
  const js8 = code(w, 'JS-8 Costo', ['costo'], 'js8_costo', [24, 0]);
  // Escritura idempotente: se lee lo que ya existe de esta llave y solo se escribe lo que falta.
  const leeEv = hojaLeer(w, 'Leer evaluaciones de la llave', 'evaluaciones', [25, 0], {
    filtros: [['llave_dedup', "={{ $('JS-8 Costo').first().json.evaluacion.llave_dedup }}"]],
    siempreSalida: true,
  });
  const leeDet = hojaLeer(w, 'Leer detalle de la evaluación', 'detalle_criterios', [26, 0], {
    filtros: [['id_evaluacion', "={{ $('JS-8 Costo').first().json.evaluacion.id_evaluacion }}"]],
    siempreSalida: true,
  });
  const plan = code(w, 'Planificar escritura', ['costo'], 'planificar_escritura', [27, 0], { modo: 'all' });
  const hayEv = si(w, '¿Falta la fila de evaluaciones?', '$json.filas_evaluacion.length > 0', [28, 0]);
  const sepEv = separar(w, 'Fila evaluaciones', 'filas_evaluacion', [29, -1]);
  const escEv = hojaEscribir(w, 'Escribir evaluaciones', 'evaluaciones', [30, -1], { alFallar: 'continueErrorOutput' });
  const det = setJson(w, 'Filas de detalle por escribir', "{ filas_detalle: $('Planificar escritura').first().json.filas_detalle }", [31, 0], { executeOnce: true });
  const hayDet = si(w, '¿Faltan filas de detalle?', '$json.filas_detalle.length > 0', [32, 0]);
  const sepDet = separar(w, 'Separar filas de detalle', 'filas_detalle', [33, -1]);
  const escDet = hojaEscribir(w, 'Escribir detalle_criterios', 'detalle_criterios', [34, -1], { alFallar: 'continueErrorOutput' });
  const evd = code(w, 'Conversación evaluada', ['ingesta'], 'conversacion_evaluada', [35, 0], { modo: 'all' });
  const upEv = hojaEscribir(w, 'Actualizar conversación: evaluada', 'conversaciones', [36, 0], { operacion: 'update', coincidir: ['llave_dedup'], alFallar: 'continueErrorOutput' });
  const alr = code(w, 'Preparar alertas de la evaluación', ['alertas'], 'alertas_evaluacion', [37, 0], { modo: 'all' });
  w.cadena(js6, js7, js8, leeEv, leeDet, plan, hayEv, sepEv, escEv, det, hayDet, sepDet, escDet, evd, upEv, alr);
  w.une(hayEv, det, 1);
  w.une(hayDet, evd, 1);
  const hay = si(w, '¿Hay alertas para enviar?', '$json.envios.length > 0', [38, 0]);
  const sepAl = separar(w, 'Separar alertas', 'envios', [39, -1]);
  const tg = telegram(w, 'Telegram: alerta de la evaluación', "$('Preparar alertas de la evaluación').first().json.config.telegram_destinatario", [40, -1]);
  const filaAl = code(w, 'Fila alertas (evaluación)', ['alertas'], 'fila_alertas_evaluacion', [41, -1]);
  const escAl = hojaEscribir(w, 'Escribir alertas (evaluación)', 'alertas', [42, -1], { alFallar: 'continueRegularOutput' });
  // Salida del sub-workflow: la leen W1 (disparador manual) y W4 para el cierre del lote.
  const res = setJson(
    w,
    'Resultado de la evaluación',
    "{ llave_dedup: $('JS-8 Costo').first().json.evaluacion.llave_dedup, conversation_id: $('JS-8 Costo').first().json.evaluacion.conversation_id, lote: $('JS-8 Costo').first().json.evaluacion.lote, estado: 'evaluada', costo_usd: $('JS-8 Costo').first().json.evaluacion.consumo.costo_usd, acumular: $('Preparar alertas de la evaluación').first().json.acumular }",
    [43, 0],
    { executeOnce: true }
  );
  w.cadena(alr, hay, sepAl, tg, filaAl, escAl, res);
  w.une(tg, filaAl, 1);
  w.une(hay, res, 1);

  // Errores: cada fuente arma { actualización de estado, registrar_error, enviar_alerta, config }.
  const eHttp = code(w, 'Error HTTP del evaluador: a reproceso', ['ingesta', 'registro_errores'], 'error_http_evaluador_reproceso', [20, 7]);
  w.une(swHttp, eHttp, 2);
  const eRep = code(w, 'Error del evaluador: a reproceso', ['ingesta', 'registro_errores'], 'error_evaluador_reproceso', [21, 7]);
  w.une(sw5, eRep, 0);
  const eErr = code(w, 'Error del evaluador: a error', ['ingesta', 'registro_errores'], 'error_evaluador_error', [22, 7]);
  w.une(sw5, eErr, 1);
  w.une(sw5, eErr, 3);
  const eSco = code(w, 'Error de scoring: a error', ['ingesta', 'registro_errores'], 'error_scoring_error', [23, 7]);
  w.une(js7, eSco, 1);
  const eGua = code(w, 'Error al guardar resultados: a reproceso', ['ingesta', 'registro_errores'], 'error_guardado_reproceso', [24, 7], { modo: 'all' });
  w.une(escEv, eGua, 1);
  w.une(escDet, eGua, 1);
  w.une(upEv, eGua, 1);
  // A la hoja solo llega la actualización (llave_dedup, estado, actualizado_en): sin registrar_error ni config.
  const actErr = setJson(w, 'Actualización de estado de error', '$json.actualizacion', [25, 5]);
  const upErr = hojaEscribir(w, 'Actualizar conversación: estado de error', 'conversaciones', [26, 5], { operacion: 'update', coincidir: ['llave_dedup'], alFallar: 'continueRegularOutput' });
  for (const n of [eHttp, eRep, eErr, eSco, eGua]) w.une(n, actErr);
  w.une(actErr, upErr);
  cadenaErrores(w, [eHttp, eRep, eErr, eSco, eGua].map((n) => [n, 0]), 26, 8);
  return w.wf;
}

// =============================================================================
// 01 Ingesta (W1)
// =============================================================================
function w1() {
  const w = nuevoWorkflow('01 Ingesta');
  // Guarda los datos de las ejecuciones fallidas (ya es el valor por defecto de n8n 2.32.6) para
  // poder recuperar el payload desde Executions si falla una escritura en Sheets.
  w.wf.settings.saveDataErrorExecution = 'all';
  // Acuse inmediato: el webhook responde al recibir y el resto corre después.
  const wh = w.nodo('Webhook de ingesta', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'qa-ingesta', responseMode: 'onReceived', options: {} }, [0, 0], { webhookId: uuid('01/webhook') });
  const cfg = hojaLeer(w, 'Leer hoja config', 'config', [1, 0]);
  const cue = hojaLeer(w, 'Leer hoja cuentas', 'cuentas', [2, 0]);
  const cc = code(w, 'Config cargada', ['normalizacion'], 'config_cargada_ingesta', [3, 0], { modo: 'all' });
  const vp = code(w, 'Validar payload', ['validador_payload'], 'validar_payload', [4, 0], { modo: 'all' });
  w.cadena(wh, cfg, cue, cc, vp);
  const ok = si(w, '¿Payload válido?', '$json.valido', [5, 0]);
  w.une(vp, ok);
  const ex = hojaLeer(w, 'Leer conversaciones existentes', 'conversaciones', [6, 0], {
    filtros: [['conversation_id', "={{ $('Validar payload').first().json.payload.conversation_id }}"]],
    siempreSalida: true,
  });
  const di = code(w, 'Decidir ingesta', ['ingesta'], 'decidir_ingesta', [7, 0], { modo: 'all' });
  w.une(ok, ex, 0);
  w.une(ex, di);
  const sw = segun(w, 'Según decisión de ingesta', '$json.accion', ['insertar', 'reutilizar', 'sin_rubrica', 'duplicado'], [8, 0]);
  w.une(di, sw);
  const fn = setJson(w, 'Fila nueva de conversaciones', '$json.fila', [9, -1]);
  const ins = hojaEscribir(w, 'Insertar conversación', 'conversaciones', [10, -1]);
  const act = setJson(w, 'Actualización de conversaciones', '$json.actualizacion', [9, 0]);
  const reac = hojaEscribir(w, 'Reactivar conversación', 'conversaciones', [10, 0], { operacion: 'update', coincidir: ['llave_dedup'] });
  const evAhora = si(w, '¿Evaluar ahora?', "$('Decidir ingesta').first().json.evaluar", [11, 0]);
  const dat = setJson(w, 'Datos para evaluación', "{ llave_dedup: $('Decidir ingesta').first().json.llave_dedup }", [12, 0]);
  const ev = llamarEvaluacion(w, 'Evaluar conversación', [13, 0]);
  w.une(sw, fn, 0);
  w.cadena(fn, ins, evAhora);
  w.une(sw, act, 1);
  w.cadena(act, reac, evAhora);
  w.cadena(evAhora, dat, ev);
  const dup = noOp(w, 'Duplicado: sin cambios', [9, 2]);
  w.une(sw, dup, 3);
  const sr = setCampos(w, 'Error sin rúbrica', [['config', 'object', "={{ $('Config cargada').first().json }}"]], [9, 1], { incluirOtros: true });
  w.une(sw, sr, 2);
  const pi = code(w, 'Error de payload inválido', ['registro_errores'], 'error_payload_invalido', [6, 3]);
  w.une(ok, pi, 1);
  cadenaErrores(w, [[sr, 0], [pi, 0]], 7, 4);

  // Disparador manual de calibración: crea las filas de la versión pedida y evalúa una por una.
  // Desactivado hasta la Fase 4 (decisión del dueño): evita evaluar calibracion_v1 antes de la
  // calificación a ciegas. El lote va vacío: el dueño lo escribe al activarlo.
  const man = w.nodo('Disparador manual de calibración', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 7], { disabled: true });
  const par = setCampos(
    w,
    'Parámetros de calibración',
    [
      ['lote', 'string', ''],
      ['version_reglas', 'string', 'reglas_ce_v1'],
      ['version_prompt', 'string', 'evaluador_ce_v1'],
    ],
    [1, 7]
  );
  const cfgC = hojaLeer(w, 'Leer config (calibración)', 'config', [2, 7]);
  const ccC = code(w, 'Config de calibración', ['normalizacion'], 'config_calibracion', [3, 7], { modo: 'all' });
  const lote = hojaLeer(w, 'Leer conversaciones del lote', 'conversaciones', [4, 7], {
    filtros: [['lote', "={{ $('Parámetros de calibración').first().json.lote }}"]],
    siempreSalida: true,
  });
  const plan = code(w, 'Planificar calibración', ['ingesta'], 'planificar_calibracion', [5, 7], { modo: 'all' });
  const okP = si(w, '¿Plan válido?', '$json.valido', [6, 7]);
  w.cadena(man, par, cfgC, ccC, lote, plan, okP);
  const det = detener(w, 'Detener: plan inválido', [7, 9]);
  w.une(okP, det, 1);
  const sepN = separar(w, 'Filas nuevas', 'filas_nuevas', [7, 6]);
  const crea = hojaEscribir(w, 'Crear filas de la versión', 'conversaciones', [8, 6]);
  w.une(okP, sepN, 0);
  w.une(sepN, crea);
  const sepL = separar(w, 'Llaves pendientes', 'llaves_pendientes', [7, 8], 'llave_dedup');
  const evP = llamarEvaluacion(w, 'Evaluar pendientes', [8, 8]);
  w.une(okP, sepL, 0);
  w.une(sepL, evP);
  const cie = code(w, 'Cierre del lote', ['alertas'], 'cierre_lote_calibracion', [9, 8], { modo: 'all' });
  const tg = telegram(w, 'Telegram: cierre del lote', '$json.config.telegram_destinatario', [10, 8]);
  const fa = code(w, 'Fila alertas (cierre del lote)', ['alertas'], 'fila_alertas_cierre_lote', [11, 8]);
  const ea = hojaEscribir(w, 'Escribir alertas (cierre del lote)', 'alertas', [12, 8], { alFallar: 'continueRegularOutput' });
  w.cadena(evP, cie, tg, fa, ea);
  w.une(tg, fa, 1);
  return w.wf;
}

// =============================================================================
// 04 Reproceso (W4)
// =============================================================================
function w4() {
  const w = nuevoWorkflow('04 Reproceso');
  // SUPUESTO/limitación: el intervalo del Schedule no puede leer la hoja config; debe coincidir con
  // config.reproceso_intervalo_min (30). Si cambias la clave, cambia también este disparador.
  const prog = w.nodo('Programado (reproceso_intervalo_min)', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } }, [0, 0]);
  const man = w.nodo('Ejecutar reproceso a mano', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 1]);
  const cfg = hojaLeer(w, 'Leer hoja config', 'config', [1, 0]);
  w.une(prog, cfg);
  w.une(man, cfg);
  const cc = code(w, 'Config cargada', ['normalizacion'], 'config_todos', [2, 0], { modo: 'all' });
  const rep = hojaLeer(w, 'Leer conversaciones en reproceso o en evaluación', 'conversaciones', [3, 0], {
    filtros: [
      ['estado', 'reproceso'],
      ['estado', 'en_evaluacion'],
    ],
    combinar: 'OR',
  });
  const dec = code(w, 'Decidir reproceso', ['ingesta'], 'decidir_reproceso', [4, 0]);
  const sw = segun(w, 'Según decisión de reproceso', '$json.accion', ['reenviar', 'marcar_atascada', 'pasar_a_error', 'ignorar'], [5, 0]);
  w.cadena(cfg, cc, rep, dec, sw);
  const dat = setJson(w, 'Datos para evaluación', '{ llave_dedup: $json.llave_dedup }', [6, -1]);
  const ev = llamarEvaluacion(w, 'Evaluar conversación', [7, -1]);
  const cie = code(w, 'Cierre del lote', ['alertas'], 'cierre_lote_reproceso', [8, -1], { modo: 'all' });
  const tg = telegram(w, 'Telegram: cierre del lote', '$json.config.telegram_destinatario', [9, -1]);
  const fa = code(w, 'Fila alertas (cierre del lote)', ['alertas'], 'fila_alertas_cierre_lote', [10, -1]);
  const ea = hojaEscribir(w, 'Escribir alertas (cierre del lote)', 'alertas', [11, -1], { alFallar: 'continueRegularOutput' });
  w.une(sw, dat, 0);
  w.cadena(dat, ev, cie, tg, fa, ea);
  w.une(tg, fa, 1);
  // marcar_atascada: la fila vuelve a reproceso, se registra (sin alerta) y se reenvía enseguida.
  const actA = setJson(w, 'Actualización a reproceso (atascada)', '$json.actualizacion', [6, 1]);
  const upA = hojaEscribir(w, 'Pasar atascada a reproceso', 'conversaciones', [7, 1], { operacion: 'update', coincidir: ['llave_dedup'] });
  w.une(sw, actA, 1);
  w.une(actA, upA);
  w.une(upA, dat);
  const act = setJson(w, 'Actualización a error', '$json.actualizacion', [6, 3]);
  const up = hojaEscribir(w, 'Pasar conversación a error', 'conversaciones', [7, 3], { operacion: 'update', coincidir: ['llave_dedup'] });
  w.une(sw, act, 2);
  w.une(act, up);
  const ign = noOp(w, 'Sin cambios', [6, 5]);
  w.une(sw, ign, 3);
  cadenaErrores(w, [[sw, 1], [sw, 2]], 6, 7);
  return w.wf;
}

// =============================================================================
// 00 Simulador (W0)
// =============================================================================
function w0() {
  const w = nuevoWorkflow('00 Simulador');
  const campos = [
    ['tema', 'text', 'Tema del catálogo (vacío = al azar)'],
    ['calidad_solicitada', 'dropdown', null, ['aleatoria', 'buena', 'regular', 'mala']],
    ['error_critico', 'text', 'IDs critico.* separados por | (vacío = ninguno)'],
    ['criterios_que_deben_fallar', 'text', 'IDs de subelementos separados por | (vacío = los sortea JS)'],
    ['casos_dificiles', 'text', 'Valores de caso_dificil separados por |'],
    ['cantidad', 'number', 'Máximo: simulador_max_conversaciones'],
    ['lote', 'text', 'demo (calibracion_v1 está congelado)'],
    ['tipo_interaccion', 'dropdown', null, ['ce', 'sales']],
    ['semilla_sorteo', 'number', 'Vacío = semilla nueva'],
  ];
  const formFields = {
    values: campos.map(([etiqueta, tipo, ayuda, opciones]) => {
      const f = { fieldLabel: etiqueta, fieldName: etiqueta, fieldType: tipo, requiredField: false };
      if (ayuda) f.placeholder = ayuda;
      if (opciones) f.fieldOptions = { values: opciones.map((option) => ({ option })) };
      return f;
    }),
  };
  const form = w.nodo(
    'Formulario del simulador',
    'n8n-nodes-base.formTrigger',
    2.2,
    { formTitle: 'Simulador de conversaciones (QA CX)', formDescription: 'Todos los campos son opcionales. La verdad del escenario se guarda en la hoja escenarios y nunca viaja a Ingesta.', formFields, responseMode: 'onReceived', options: { path: 'qa-simulador' } },
    [0, 0],
    { webhookId: uuid('00/form') }
  );
  const url = setCampos(w, 'URL de Ingesta', [['url_webhook_ingesta', 'string', URL_INGESTA]], [1, 0], { executeOnce: true });
  const lecturas = [
    ['Leer hoja config', 'config', false],
    ['Leer hoja catalogo_temas', 'catalogo_temas', false],
    ['Leer hoja cuentas', 'cuentas', false],
    ['Leer hoja base_conocimiento', 'base_conocimiento', false],
    ['Leer hoja listas', 'listas', false],
    ['Leer hoja escenarios', 'escenarios', true],
    ['Leer hoja conversaciones', 'conversaciones', true],
    ['Leer hoja revision_humana', 'revision_humana', true],
  ].map(([n, h, s], i) => hojaLeer(w, n, h, [2 + i, 0], { siempreSalida: s }));
  const pl = setRelleno(w, 'Plantilla generador', 'plantilla_generador', 'prompts/generador_ce_v2.md', 'string', [10, 0]);
  const es = setRelleno(w, 'Esquema generador', 'esquema_generador', 'prompts/generador_payload_salida.schema.json', 'object', [11, 0]);
  const cg = code(w, 'Config general', ['normalizacion'], 'config_general_simulador', [12, 0], { modo: 'all' });
  const vf = code(w, 'Validar formulario', ['simulador'], 'validar_formulario', [13, 0], { modo: 'all' });
  w.cadena(form, url, ...lecturas, pl, es, cg, vf);
  const okF = si(w, '¿Formulario válido?', '$json.valido', [14, 0]);
  w.une(vf, okF);
  const cc = code(w, 'Config cargada', ['normalizacion'], 'config_cargada_simulador', [15, 0], { modo: 'all' });
  const ce = code(w, 'Completar escenario', ['simulador'], 'completar_escenario', [16, 0], { modo: 'all' });
  const okE = si(w, '¿Escenarios válidos?', '$json.valido', [17, 0]);
  w.une(okF, cc, 0);
  w.cadena(cc, ce, okE);
  // Rechazo del formulario: el motivo (textos de js/simulador.js) se muestra en pantalla y se
  // registra en log_errores como formulario_invalido, sin Telegram (debeAlertar = false).
  const finMal = finFormulario(w, 'Formulario rechazado', 'Formulario rechazado', "$json.errores.join(' | ')", [15, 2]);
  const errF = code(w, 'Error de formulario', ['registro_errores'], 'error_formulario', [15, 3]);
  const filaF = code(w, 'Fila log_errores (formulario)', ['registro_errores'], 'fila_log_errores_formulario', [16, 3]);
  const escF = hojaEscribir(w, 'Escribir log_errores (formulario)', 'log_errores', [17, 3], { alFallar: 'continueRegularOutput' });
  for (const n of [okF, okE]) {
    w.une(n, finMal, 1);
    w.une(n, errF, 1);
  }
  w.cadena(errF, filaF, escF);
  const finOk = finFormulario(
    w,
    'Simulación en curso',
    'Simulación en curso',
    "'Se generarán ' + $json.escenarios.length + ' conversación(es). El resultado queda en las hojas escenarios, revision_humana y conversaciones.'",
    [18, -2]
  );
  w.une(okE, finOk, 0);
  const sep = separar(w, 'Separar escenarios', 'escenarios', [18, 0]);
  const bucle = w.nodo('Una conversación a la vez', 'n8n-nodes-base.splitInBatches', 3, { batchSize: 1, options: {} }, [19, 0]);
  w.une(okE, sep, 0);
  w.une(sep, bucle);
  w.une(bucle, noOp(w, 'Fin del simulador', [20, -2]), 0);

  const vg = code(w, 'Valores del generador', ['construccion_prompt'], 'valores_generador', [20, 0]);
  const cp = code(w, 'Construir petición generador', ['construccion_prompt'], 'construir_peticion_generador', [21, 0]);
  const prep = noOp(w, 'Preparar llamada Claude', [22, 0]);
  const api = llamadaApi(w, 'Claude: generar conversación', 'https://api.anthropic.com/v1/messages', 'peticion_claude', CREDENCIALES.anthropic, [23, 0], [['anthropic-version', '={{ $json.config.anthropic_version_api }}']]);
  const cls = code(w, 'Clasificar respuesta Claude', ['clasificacion_http'], 'clasificar_respuesta_claude', [24, 0]);
  w.une(bucle, vg, 1);
  w.cadena(vg, cp, prep, api, cls);
  w.une(api, cls, 1);
  const swH = segun(w, 'Según respuesta HTTP', '$json.clasificacion_http.accion', ['continuar', 'reintentar', 'falla_api'], [25, 0]);
  w.une(cls, swH);
  const wait = esperar(w, 'Esperar antes de reintentar', [25, 2]);
  const inc = setCampos(w, 'Contar reintento de conexión', [['intento_conexion', 'number', '={{ $json.clasificacion_http.siguiente_intento }}']], [24, 2], { incluirOtros: true });
  w.une(swH, wait, 1);
  w.cadena(wait, inc, prep);
  const errApi = code(w, 'Error de API del generador', ['registro_errores'], 'error_api_generador', [26, 4]);
  w.une(swH, errApi, 2);

  const lr = code(w, 'Leer respuesta generador', ['construccion_prompt'], 'leer_respuesta_generador', [26, 0]);
  const vgen = code(w, 'Validar generación', ['validador_payload'], 'validar_generacion', [27, 0]);
  const okG = si(w, '¿Payload generado válido?', '$json.valido', [28, 0]);
  w.une(swH, lr, 0);
  w.cadena(lr, vgen, okG);
  // Verificación determinista de lo pedido por el escenario: necesita JS-1 a JS-3 sobre el payload.
  const v1 = code(w, 'Verificación: JS-1 Normalización', ['normalizacion'], 'verificacion_js1', [29, -1]);
  const v2 = code(w, 'Verificación: JS-2 Extracción y enmascaramiento', ['enmascaramiento'], 'verificacion_js2', [30, -1]);
  const v3 = code(w, 'Verificación: JS-3 Reglas deterministas', ['reglas'], 'verificacion_js3', [31, -1]);
  const ve = code(w, 'Verificar escenario generado', ['simulador', 'reglas_hibridas'], 'verificar_escenario', [32, -1]);
  w.une(okG, v1, 0);
  w.cadena(v1, v2, v3, ve);
  const dg = code(w, 'Decidir intento de generación', ['simulador'], 'decidir_intento_generacion', [33, 0]);
  w.une(ve, dg);
  w.une(okG, dg, 1);
  const swG = segun(w, 'Según intento de generación', '$json.decision.accion', ['continuar', 'reintentar', 'generacion_invalida'], [34, 0]);
  w.une(dg, swG);
  const reG = setCampos(
    w,
    'Contar reintento de generación',
    [
      ['intento_generacion', 'number', '={{ $json.decision.siguiente_intento }}'],
      ['intento_conexion', 'number', 0],
    ],
    [34, 2],
    { incluirOtros: true, excluir: ['decision', 'verificacion', 'lectura_generador', 'payload', 'valido', 'errores', 'respuesta_http', 'clasificacion_http', 'texto_generado', 'salida_generador'] }
  );
  w.une(swG, reG, 1);
  w.une(reG, prep);
  const errGen = code(w, 'Error de generación', ['registro_errores'], 'error_generacion', [35, 4]);
  w.une(swG, errGen, 2);

  const fe = code(w, 'Fila de escenarios', ['simulador', 'costo'], 'fila_escenarios', [35, 0]);
  const ee = hojaEscribir(w, 'Escribir escenarios', 'escenarios', [36, 0], { alFallar: 'continueErrorOutput' });
  const fr = code(w, 'Fila de revisión humana', ['simulador', 'texto_legible'], 'fila_revision_humana', [37, 0]);
  const er = hojaEscribir(w, 'Escribir revision_humana', 'revision_humana', [38, 0], { alFallar: 'continueErrorOutput' });
  const env = code(w, 'Envío a Ingesta', ['simulador'], 'envio_ingesta', [39, 0]);
  const post = w.nodo(
    'POST a Ingesta',
    'n8n-nodes-base.httpRequest',
    4.4,
    { method: 'POST', url: '={{ $json.url }}', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 30000 } },
    [40, 0],
    { onError: 'continueErrorOutput' }
  );
  w.une(swG, fe, 0);
  w.cadena(fe, ee, fr, er, env, post, bucle);
  const errSh = code(w, 'Error de Sheets del simulador', ['registro_errores'], 'error_sheets_simulador', [37, 4]);
  w.une(ee, errSh, 1);
  w.une(er, errSh, 1);
  const errPost = code(w, 'Error al enviar a Ingesta', ['registro_errores'], 'error_post_ingesta', [40, 4]);
  w.une(post, errPost, 1);
  // Al terminar el registro del error, el bucle sigue con la siguiente conversación.
  cadenaErrores(w, [[errApi, 0], [errGen, 0], [errSh, 0], [errPost, 0]], 27, 6, bucle);
  return w.wf;
}

// =============================================================================
// 99 Errores (WE)
// =============================================================================
function we() {
  const w = nuevoWorkflow('99 Errores', { conErrorWorkflow: false });
  const t = w.nodo('Disparador de errores', 'n8n-nodes-base.errorTrigger', 1, {}, [0, 0]);
  const cfg = hojaLeer(w, 'Leer hoja config', 'config', [1, 0]);
  const cc = code(w, 'Config cargada', ['normalizacion'], 'config_todos', [2, 0], { modo: 'all' });
  const de = code(w, 'Datos del error', ['registro_errores'], 'datos_error_trigger', [3, 0], { modo: 'all' });
  w.cadena(t, cfg, cc, de);
  cadenaErrores(w, [[de, 0]], 4, 0);
  // Si el error identifica una conversación de W2 (llave_dedup en el mensaje), pasa a reproceso.
  // Limitación: el Error Trigger no trae los datos de la ejecución; casi siempre W4 (atascadas) es la red.
  const hayConv = si(w, '¿Identifica la conversación?', "!!$('Datos del error').first().json.actualizacion_conversacion", [4, 2]);
  const actC = setJson(w, 'Actualización a reproceso', "$('Datos del error').first().json.actualizacion_conversacion", [5, 2]);
  const upC = hojaEscribir(w, 'Pasar conversación a reproceso', 'conversaciones', [6, 2], { operacion: 'update', coincidir: ['llave_dedup'], alFallar: 'continueRegularOutput' });
  w.une(de, hayConv);
  w.cadena(hayConv, actC, upC);
  return w.wf;
}

// =============================================================================
// 03 Métricas (W3) — estructura; las fórmulas llegan en la Fase 4 (metricas-bi)
// =============================================================================
function w3() {
  const w = nuevoWorkflow('03 Métricas');
  const man = w.nodo('Calcular métricas a mano', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 0]);
  const par = setCampos(
    w,
    'Parámetros de métricas',
    [
      ['lote', 'string', 'calibracion_v1'],
      ['version_reglas', 'string', 'reglas_ce_v1'],
      ['version_prompt', 'string', 'evaluador_ce_v1'],
    ],
    [1, 0]
  );
  const rh = hojaLeer(w, 'Leer revisión humana calificada', 'revision_humana', [2, 0], {
    filtros: [
      ['lote', "={{ $('Parámetros de métricas').first().json.lote }}"],
      ['estado_revision', 'calificada'],
    ],
    siempreSalida: true,
  });
  const hay = si(w, '¿Hay filas calificadas?', '!!$json.conversation_id', [3, 0]);
  w.cadena(man, par, rh, hay);
  w.une(hay, noOp(w, 'Sin datos calificados (fin sin alerta)', [4, 2]), 1);
  const ev = hojaLeer(w, 'Leer evaluaciones del lote', 'evaluaciones', [4, 0], {
    filtros: [
      ['lote', "={{ $('Parámetros de métricas').first().json.lote }}"],
      ['version_reglas', "={{ $('Parámetros de métricas').first().json.version_reglas }}"],
      ['version_prompt', "={{ $('Parámetros de métricas').first().json.version_prompt }}"],
    ],
    siempreSalida: true,
  });
  const esc = hojaLeer(w, 'Leer escenarios del lote', 'escenarios', [5, 0], { filtros: [['lote', "={{ $('Parámetros de métricas').first().json.lote }}"]], siempreSalida: true });
  const calc = noOp(w, 'Calcular métricas (pendiente Fase 4)', [6, 0], { notes: 'Fase 4 (metricas-bi): aquí va el nodo Code con las fórmulas de metricas/ y la alerta de calibración (armarAlertaCalibracion de js/alertas.js).' });
  const escM = hojaEscribir(w, 'Escribir metricas', 'metricas', [7, 0]);
  w.une(hay, ev, 0);
  // Esqueleto hasta la Fase 4: "Escribir metricas" queda sin conexión de entrada (no recibe nada).
  w.cadena(ev, esc, calc);
  return w.wf;
}

// =============================================================================
// pruebas/mock_api.json — imita la API Responses: 503 en llamadas impares, 200 en pares
// =============================================================================
function mock() {
  const ejemplo = readFileSync(join(RAIZ, 'contrato', 'ejemplos', 'llm_output_ejemplo.json'), 'utf8').replace(/\r\n/g, '\n');
  const cuerpo200 = {
    id: 'resp_mock',
    object: 'response',
    status: 'completed',
    model: 'mock',
    output: [{ type: 'message', id: 'msg_mock', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(JSON.parse(ejemplo)) }] }],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
  const w = nuevoWorkflow('PRUEBA mock API (503 y luego 200)', { conErrorWorkflow: false });
  const wh = w.nodo('Webhook mock', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'qa-mock-openai', responseMode: 'responseNode', options: {} }, [0, 0], { webhookId: uuid('mock/webhook') });
  // Herramienta de prueba (no es lógica del sistema): cuenta llamadas en los datos estáticos
  // del workflow, que solo persisten con el workflow activo.
  const cnt = w.nodo(
    'Contar llamada (mock)',
    'n8n-nodes-base.code',
    2,
    { jsCode: "const estado = $getWorkflowStaticData('global');\nestado.llamadas = (estado.llamadas || 0) + 1;\nreturn [{ json: { llamada: estado.llamadas, responder_503: estado.llamadas % 2 === 1 } }];\n" },
    [1, 0]
  );
  const dec = si(w, '¿Responder 503?', '$json.responder_503', [2, 0]);
  const r503 = w.nodo('Responder 503', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '{ "error": { "message": "mock: servicio no disponible" } }', options: { responseCode: 503 } }, [3, -1]);
  const r200 = w.nodo('Responder 200', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: JSON.stringify(cuerpo200), options: { responseCode: 200 } }, [3, 1]);
  w.cadena(wh, cnt, dec, r503);
  w.une(dec, r200, 1);
  return w.wf;
}

// -----------------------------------------------------------------------------
// Payloads de prueba (derivados de contrato/ejemplos/payload_ejemplo.json)
// -----------------------------------------------------------------------------
function payloadsDePrueba() {
  const base = JSON.parse(readFileSync(join(RAIZ, 'contrato', 'ejemplos', 'payload_ejemplo.json'), 'utf8'));
  const copia = (id) => ({ ...JSON.parse(JSON.stringify(base)), conversation_id: id });
  const invalido = copia('CONV-9001');
  delete invalido.canal;
  const sales = { ...copia('CONV-9002'), tipo_interaccion: 'sales' };
  const sinAgente = copia('CONV-9003');
  sinAgente.mensajes = sinAgente.mensajes.filter((m) => m.emisor === 'cliente').map((m, i) => ({ ...m, n: i + 1 }));
  sinAgente.metadatos_caso = { ...sinAgente.metadatos_caso, numero_caso: null, estado_caso: 'sin_caso' };
  const falloApi = copia('CONV-9004');
  const mockApi = copia('CONV-9005');
  // Repetir el caso 2 cuando CONV-0001 ya quedó evaluada (CONV-9006 la usa el caso 7c).
  const repetirCaso2 = copia('CONV-9007');
  return {
    'payload_invalido.json': invalido,
    'payload_sales.json': sales,
    'payload_sin_agente.json': sinAgente,
    'payload_fallo_api.json': falloApi,
    'payload_mock_api.json': mockApi,
    'payload_repetir_caso2.json': repetirCaso2,
  };
}

// -----------------------------------------------------------------------------

export function construirTodo() {
  const salida = {
    'plantillas/00_simulador.json': w0(),
    'plantillas/01_ingesta.json': w1(),
    'plantillas/02_evaluacion.json': w2(),
    'plantillas/03_metricas.json': w3(),
    'plantillas/04_reproceso.json': w4(),
    'plantillas/99_errores.json': we(),
    'pruebas/mock_api.json': mock(),
  };
  for (const [nombre, p] of Object.entries(payloadsDePrueba())) salida[`pruebas/${nombre}`] = p;
  return salida;
}

export const serializarPlantilla = (x) => JSON.stringify(x, null, 2) + '\n';

function principal(argumentos) {
  const verificar = argumentos.includes('--verificar');
  let fallas = 0;
  for (const [rel, obj] of Object.entries(construirTodo())) {
    const destino = join(RAIZ, 'workflows', ...rel.split('/'));
    const texto = serializarPlantilla(obj);
    if (verificar) {
      const igual = existsSync(destino) && readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') === texto;
      if (!igual) {
        console.error(`workflows/${rel}: difiere de construir_plantillas.mjs`);
        fallas += 1;
      }
    } else {
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, texto);
      console.log(`workflows/${rel} escrito`);
    }
  }
  return fallas ? 1 : 0;
}

const esPrincipal = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (esPrincipal) process.exit(principal(process.argv.slice(2)));
