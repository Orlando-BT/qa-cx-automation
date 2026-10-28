// =============================================================================
// simulacion.test.js — recorre los caminos principales de W0, W1, W2, W4 y 99 ejecutando los
// nodos Code GENERADOS (los mismos que se importan en n8n) con datos de datos/ y contrato/ejemplos/.
// -----------------------------------------------------------------------------
// Qué demuestra:
//  - que cada pegamento lee los nodos y campos que de verdad existen y que las funciones de js/
//    reciben lo que esperan;
//  - que ningún nodo por ítem usa $input.first/last/all/itemMatching (el ejecutor aplica la misma
//    regla que n8n 2.32.6);
//  - que lo que llega a CADA nodo Sheets de escritura (append y update) solo trae columnas del
//    contrato de su hoja (contrato/sheets.md), y que las actualizaciones no escriben celdas vacías;
//  - que log_errores se escribe después del intento de Telegram, con alerta_enviada real, y que el
//    id_error que cita la alerta es el de la fila.
// Las lecturas de Sheets, el HTTP y el Telegram se simulan con `fijar`. No llama a ninguna API.
// =============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { crearEjecutor, validarMetodosPorItem } = require('./ejecutor_n8n');
const { DATOS, leerCSV } = require('../../js/tests/ayudas');
const { filaConversaciones } = require('../../js/ingesta');
const { cargarConfig } = require('../../js/normalizacion');
const { COLUMNAS_ESCENARIOS, COLUMNAS_REVISION_HUMANA } = require('../../js/simulador');
const { COLUMNAS_LOG_ERRORES } = require('../../js/registro_errores');
const { COLUMNAS_ALERTAS, armarAlertaCosto } = require('../../js/alertas');

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (rel) => JSON.parse(fs.readFileSync(path.join(RAIZ, ...rel.split('/')), 'utf8'));
const BASE = leerCSV(fs.readFileSync(path.join(RAIZ, 'datos', 'base_conocimiento.csv'), 'utf8'));
const PAYLOAD = leer('contrato/ejemplos/payload_ejemplo.json');
const CONFIG_CE = cargarConfig(DATOS.config, 'ce');
const columnas = (obj) => Object.keys(obj);
const RESPUESTA_TELEGRAM_OK = { ok: true, result: { message_id: 1 } };
const RESPUESTA_TELEGRAM_ERROR = { error: 'Bad Request: chat not found' };

const ARCHIVOS = ['00_simulador.json', '01_ingesta.json', '02_evaluacion.json', '04_reproceso.json', '99_errores.json'];

// --- columnas del contrato y cobertura de escrituras -----------------------------------

let encabezados;
async function columnasDeHoja(hoja) {
  if (!encabezados) {
    const { leerEncabezados } = await import(pathToFileURL(path.join(RAIZ, 'workflows', 'herramientas', 'encabezados.mjs')).href);
    encabezados = leerEncabezados(fs.readFileSync(path.join(RAIZ, 'contrato', 'sheets.md'), 'utf8'));
  }
  assert.ok(encabezados.has(hoja), `hoja ${hoja} no está en contrato/sheets.md`);
  return encabezados.get(hoja);
}

const cubiertas = new Map(); // nombre del workflow -> Set de nodos de escritura verificados

/**
 * Verifica lo que entra a un nodo Sheets de escritura: `origen` está conectado a `escritura` y cada
 * ítem solo trae columnas del contrato de su hoja. En update además: trae la llave y ninguna celda
 * vacía (no borra valores que ya estaban).
 */
async function verEscritura(e, wf, escritura, origen, items) {
  const n = wf.nodes.find((x) => x.name === escritura);
  assert.ok(n && n.type === 'n8n-nodes-base.googleSheets', `${escritura} no es un nodo Sheets`);
  const op = n.parameters.operation;
  assert.ok(op === 'append' || op === 'update', `${escritura} no escribe`);
  assert.ok(e.origenes(escritura).some((o) => o.de === origen), `${origen} no está conectado a ${escritura}`);
  const hoja = n.parameters.sheetName.value;
  const permitidas = await columnasDeHoja(hoja);
  assert.ok(items.length > 0, `${escritura}: sin ítems`);
  for (const item of items) {
    const extra = columnas(item).filter((c) => !permitidas.includes(c));
    assert.deepEqual(extra, [], `${wf.name} "${escritura}" recibe claves que no son columnas de ${hoja}`);
    if (op === 'update') {
      assert.ok(item.llave_dedup, `${escritura}: falta llave_dedup`);
      const vacias = columnas(item).filter((c) => item[c] === '' || item[c] === null || item[c] === undefined);
      assert.deepEqual(vacias, [], `${escritura}: una actualización no debe escribir celdas vacías`);
    }
  }
  if (!cubiertas.has(wf.name)) cubiertas.set(wf.name, new Set());
  cubiertas.get(wf.name).add(escritura);
}

/**
 * Cadena común de errores: "Fila log_errores" -> (alerta: Armar -> Telegram -> Fila alertas ->
 * Escribir alertas -> Fila log_errores (tras el envío)) o (sin alerta: Fila log_errores (sin alerta))
 * -> Escribir log_errores. `respuesta` = lo que sale del Telegram (salida normal u error).
 */
async function cadenaErrores(e, wf, entrada, respuesta = RESPUESTA_TELEGRAM_OK) {
  const [prep] = await e.correr('Fila log_errores', [entrada]);
  assert.ok(/^ERR-/.test(prep.id_error));
  if (!prep.enviar_alerta) {
    assert.deepEqual(e.origenes('Fila log_errores (sin alerta)'), [{ de: '¿Enviar alerta operativa?', salida: 1 }]);
    const [fila] = await e.correr('Fila log_errores (sin alerta)', [prep]);
    await verEscritura(e, wf, 'Escribir log_errores', 'Fila log_errores (sin alerta)', [fila]);
    assert.equal(fila.id_error, prep.id_error);
    return { prep, fila, alerta: null, filaAlerta: null };
  }
  const [alerta] = await e.correr('Armar alerta operativa', [prep]);
  assert.equal(typeof alerta.texto_html, 'string', 'Telegram envía texto_html');
  assert.ok(alerta.texto.includes(prep.id_error), 'la alerta cita el id_error');
  e.fijar('Telegram: alerta operativa', [respuesta]);
  const [filaAlerta] = await e.correr('Fila alertas (operativa)', [respuesta]);
  await verEscritura(e, wf, 'Escribir alertas (operativa)', 'Fila alertas (operativa)', [filaAlerta]);
  e.fijar('Escribir alertas (operativa)', [filaAlerta]);
  const [fila] = await e.correr('Fila log_errores (tras el envío)', [filaAlerta]);
  await verEscritura(e, wf, 'Escribir log_errores', 'Fila log_errores (tras el envío)', [fila]);
  assert.equal(fila.id_error, prep.id_error, 'el id_error de la fila es el que citó la alerta');
  return { prep, fila, alerta, filaAlerta };
}

function respuesta200DelMock() {
  const mock = leer('workflows/pruebas/mock_api.json');
  return JSON.parse(mock.nodes.find((n) => n.name === 'Responder 200').parameters.responseBody);
}

function fijarReferencia(e, nombres) {
  const tablas = { config: DATOS.config, listas: DATOS.listas, catalogo_temas: DATOS.catalogo, cuentas: DATOS.cuentas, base_conocimiento: BASE };
  for (const [nodo, hoja] of nombres) e.fijar(nodo, tablas[hoja]);
}

function prepararW2(e, fila) {
  e.fijar('Leer conversación', [fila]);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja listas', 'listas'], ['Leer hoja catalogo_temas', 'catalogo_temas'], ['Leer hoja base_conocimiento', 'base_conocimiento'], ['Leer hoja cuentas', 'cuentas']]);
  e.fijar('Plantilla evaluador', [e.valorSet('Plantilla evaluador')]);
  e.fijar('Esquema LLM', [e.valorSet('Esquema LLM')]);
}

// --- la regla de n8n sobre $input en modo por ítem --------------------------------------

test('ejecutor: reproduce la regla de n8n para $input.* en modo "Run Once for Each Item"', () => {
  // Comentario con $input.all() + una línea de código que contiene "all" (en "fallo"): n8n lo rechaza.
  assert.throws(() => validarMetodosPorItem("// antes usaba $input.all()\nconst tipo = 'fallo_api';\nreturn { json: { tipo } };"), /Can't use \.all\(\) here/);
  // Solo $('X').all(): n8n lo permite.
  assert.doesNotThrow(() => validarMetodosPorItem("const filas = $('Leer hoja config').all();\nreturn { json: { n: filas.length } };"));
  // $input.item sí está permitido.
  assert.doesNotThrow(() => validarMetodosPorItem('const x = $input.item.json;\nreturn { json: x };'));
  // La regex coincide, pero ninguna línea de código contiene "first": n8n no lo rechaza (b).
  assert.doesNotThrow(() => validarMetodosPorItem('// no usar $input.first()\nreturn { json: {} };'));
});

test('ejecutor: un nodo por ítem con $input.all() en un comentario falla como en n8n', async () => {
  const wf = {
    name: 'prueba',
    connections: {},
    nodes: [{ name: 'Por ítem', type: 'n8n-nodes-base.code', parameters: { mode: 'runOnceForEachItem', jsCode: "// $input.all() no va aquí\nconst estado = 'fallo';\nreturn { json: { estado } };" } }],
  };
  await assert.rejects(() => crearEjecutor(wf).correr('Por ítem', [{}]), /Can't use \.all\(\) here/);
});

// --- W2 ------------------------------------------------------------------------------

test('W2: camino completo con la respuesta del mock (continuar -> evaluada) y escrituras con columnas del contrato', async () => {
  const wf = leer('workflows/02_evaluacion.json');
  const e = crearEjecutor(wf);
  const fila = filaConversaciones(PAYLOAD, 'demo', { version_reglas: CONFIG_CE.version_reglas, version_prompt: CONFIG_CE.version_prompt }, CONFIG_CE, new Date());
  prepararW2(e, fila);

  const [js1] = await e.correr('JS-1 Normalización', [{}]);
  assert.equal(js1.llave_dedup, fila.llave_dedup);
  const [entrada] = await e.correr('Entrada a evaluación', [{}]);
  assert.deepEqual(columnas(entrada).sort(), ['actualizado_en', 'estado', 'intentos', 'llave_dedup']);
  assert.equal(entrada.estado, 'en_evaluacion');
  assert.equal(entrada.intentos, 1);
  await verEscritura(e, wf, 'Actualizar conversación: en evaluación', 'Entrada a evaluación', [entrada]);
  const [js2] = await e.correr('JS-2 Extracción y enmascaramiento', [entrada]);
  const [js3] = await e.correr('JS-3 Reglas deterministas', [js2]);
  assert.equal(js3.resultados_js.variables.sin_mensajes_agente, false);
  const [js4] = await e.correr('JS-4 Construcción del prompt', [js3]);
  assert.equal(js4.peticion_openai.max_output_tokens, CONFIG_CE.max_tokens_evaluador);
  e.fijar('Preparar llamada OpenAI', [js4]);

  // 503: el clasificador pide esperar y reintentar; 200: continuar.
  const [c503] = await e.correr('Clasificar respuesta OpenAI', [{ statusCode: 503, headers: {}, body: {} }]);
  assert.equal(c503.clasificacion_http.accion, 'reintentar');
  assert.equal(c503.clasificacion_http.siguiente_intento, 1);
  const [c200] = await e.correr('Clasificar respuesta OpenAI', [{ statusCode: 200, headers: {}, body: respuesta200DelMock() }]);
  assert.equal(c200.clasificacion_http.accion, 'continuar');

  const [js5] = await e.correr('JS-5 Validación de la respuesta', [c200]);
  assert.equal(js5.accion, 'continuar', JSON.stringify(js5.errores_validacion));
  const [js6] = await e.correr('JS-6 Reglas híbridas', [js5]);
  const [js7] = await e.correr('JS-7 Scoring', [js6]);
  const [js8] = await e.correr('JS-8 Costo', [js7]);
  const llave = js8.evaluacion.llave_dedup;
  assert.equal(llave, fila.llave_dedup);

  // Primera escritura: no hay nada en Sheets -> 1 fila de evaluaciones y 77 de detalle.
  e.fijar('Leer evaluaciones de la llave', [{}]);
  e.fijar('Leer detalle de la evaluación', [{}]);
  const [plan] = await e.correr('Planificar escritura', [{}]);
  assert.equal(plan.filas_evaluacion.length, 1);
  assert.equal(columnas(plan.filas_evaluacion[0]).length, 30);
  assert.equal(plan.filas_detalle.length, 77);
  const filasEv = e.separar('Fila evaluaciones', [plan]);
  await verEscritura(e, wf, 'Escribir evaluaciones', 'Fila evaluaciones', filasEv);
  const [det] = e.correrSetJson('Filas de detalle por escribir', [filasEv[0]]);
  const filasDet = e.separar('Separar filas de detalle', [det]);
  assert.equal(filasDet.length, 77);
  await verEscritura(e, wf, 'Escribir detalle_criterios', 'Separar filas de detalle', filasDet);
  // Doble ejecución: con las filas ya escritas no hay nada que escribir (idempotente).
  e.fijar('Leer evaluaciones de la llave', plan.filas_evaluacion);
  e.fijar('Leer detalle de la evaluación', plan.filas_detalle);
  const [plan2] = await e.correr('Planificar escritura', [{}]);
  assert.equal(plan2.filas_evaluacion.length, 0);
  assert.equal(plan2.filas_detalle.length, 0);
  // Escritura parcial previa: solo faltan las filas de detalle que no estaban.
  e.fijar('Leer detalle de la evaluación', plan.filas_detalle.slice(0, 40));
  const [plan3] = await e.correr('Planificar escritura', [{}]);
  assert.equal(plan3.filas_evaluacion.length, 0);
  assert.equal(plan3.filas_detalle.length, 37);

  const [evd] = await e.correr('Conversación evaluada', [{}]);
  assert.equal(evd.estado, 'evaluada');
  assert.equal(evd.id_evaluacion, plan.filas_evaluacion[0].id_evaluacion);
  await verEscritura(e, wf, 'Actualizar conversación: evaluada', 'Conversación evaluada', [evd]);
  const [alr] = await e.correr('Preparar alertas de la evaluación', [evd]);
  assert.ok(Array.isArray(alr.envios) && Array.isArray(alr.acumular));

  // Se agrega una alerta de costo para recorrer siempre el registro, haya o no críticos en el mock.
  const costo = armarAlertaCosto({ evaluable: true, disparar: true, valor_observado: 0.02, umbral: 0.01 }, { ambito: 'evaluacion', conversation_id: 'CONV-0001', lote: 'demo' });
  const envios = e.separar('Separar alertas', [{ ...alr, envios: [...alr.envios, costo] }]);
  // Un ítem por envío, en el mismo orden (lo que sale del Telegram: salida normal o de error).
  const respuestas = envios.map((_, i) => (i % 2 === 0 ? RESPUESTA_TELEGRAM_OK : RESPUESTA_TELEGRAM_ERROR));
  const filasAlertas = await e.correr('Fila alertas (evaluación)', respuestas);
  for (const [i, envio] of envios.entries()) {
    assert.equal(typeof envio.texto_html, 'string', 'cada envío trae texto_html para Telegram');
    const fa = filasAlertas[i];
    assert.deepEqual(columnas(fa), COLUMNAS_ALERTAS);
    assert.equal(fa.estado_envio, i % 2 === 0 ? 'enviada' : 'fallida');
    assert.equal(fa.texto_enviado, envio.texto, 'en la hoja se guarda el texto plano');
  }
  await verEscritura(e, wf, 'Escribir alertas (evaluación)', 'Fila alertas (evaluación)', filasAlertas);
});

test('W2: falla de la API -> reproceso; solo la actualización llega a conversaciones; alerta enviada', async () => {
  const wf = leer('workflows/02_evaluacion.json');
  const e = crearEjecutor(wf);
  const fila = filaConversaciones(PAYLOAD, 'demo', { version_reglas: CONFIG_CE.version_reglas, version_prompt: CONFIG_CE.version_prompt }, CONFIG_CE, new Date());
  prepararW2(e, fila);
  await e.correr('JS-1 Normalización', [{}]);
  const [js2] = await e.correr('JS-2 Extracción y enmascaramiento', [{}]);
  const [js3] = await e.correr('JS-3 Reglas deterministas', [js2]);
  const [js4] = await e.correr('JS-4 Construcción del prompt', [js3]);
  e.fijar('Preparar llamada OpenAI', [js4]);
  // 404 (por ejemplo, modelo inexistente): no se reintenta.
  const [c] = await e.correr('Clasificar respuesta OpenAI', [{ statusCode: 404, headers: {}, body: {} }]);
  assert.equal(c.clasificacion_http.accion, 'falla_api');
  const [err] = await e.correr('Error HTTP del evaluador: a reproceso', [c]);
  assert.equal(err.actualizacion.estado, 'reproceso');
  assert.equal(err.actualizacion.llave_dedup, fila.llave_dedup);
  const [act] = e.correrSetJson('Actualización de estado de error', [err]);
  await verEscritura(e, wf, 'Actualizar conversación: estado de error', 'Actualización de estado de error', [act]);

  const { fila: log, filaAlerta } = await cadenaErrores(e, wf, err, RESPUESTA_TELEGRAM_OK);
  assert.deepEqual(columnas(log), COLUMNAS_LOG_ERRORES);
  assert.equal(log.tipo_error, 'fallo_api');
  assert.equal(log.alerta_enviada, 'si');
  assert.equal(filaAlerta.estado_envio, 'enviada');
});

test('Cadena de errores: las 3 ramas (no alertar, envío ok, envío fallido) con alerta_enviada real', async () => {
  const wf = leer('workflows/02_evaluacion.json');
  const e = crearEjecutor(wf);
  const registrar_error = { workflow: 'evaluacion', nodo: 'OpenAI: evaluar conversación', tipo_error: 'fallo_api', mensaje_error: 'HTTP 404', conversation_id: 'CONV-0001', lote: 'demo', tipo_interaccion: 'ce', detalle: { codigo_http: 404 } };

  // 1. No se debía alertar: sin Telegram, alerta_enviada = no y ninguna fila de alertas.
  const sinAlerta = await cadenaErrores(e, wf, { registrar_error: { ...registrar_error, tipo_error: 'tipo_interaccion_sin_rubrica' }, enviar_alerta: false, config: CONFIG_CE });
  assert.equal(sinAlerta.fila.alerta_enviada, 'no');
  assert.equal(sinAlerta.filaAlerta, null);

  // 2. Envío correcto (salida normal del Telegram): alerta_enviada = si y estado_envio = enviada.
  const ok = await cadenaErrores(e, wf, { registrar_error, enviar_alerta: true, config: CONFIG_CE }, RESPUESTA_TELEGRAM_OK);
  assert.equal(ok.fila.alerta_enviada, 'si');
  assert.equal(ok.filaAlerta.estado_envio, 'enviada');
  assert.equal(ok.filaAlerta.tipo_alerta, 'operativa');

  // 3. Envío fallido (salida de error del Telegram): alerta_enviada = no, pero la fila de alertas
  //    se registra igual con estado_envio = fallida.
  const falla = await cadenaErrores(e, wf, { registrar_error, enviar_alerta: true, config: CONFIG_CE }, RESPUESTA_TELEGRAM_ERROR);
  assert.equal(falla.fila.alerta_enviada, 'no');
  assert.equal(falla.filaAlerta.estado_envio, 'fallida');
  for (const r of [sinAlerta, ok, falla]) assert.deepEqual(columnas(r.fila), COLUMNAS_LOG_ERRORES);
});

test('W2: las otras fuentes de error mandan a conversaciones solo la actualización', async () => {
  const wf = leer('workflows/02_evaluacion.json');
  const e = crearEjecutor(wf);
  const fila = filaConversaciones(PAYLOAD, 'demo', { version_reglas: CONFIG_CE.version_reglas, version_prompt: CONFIG_CE.version_prompt }, CONFIG_CE, new Date());
  prepararW2(e, fila);
  const [js1] = await e.correr('JS-1 Normalización', [{}]);
  const item = { ...js1, detalle_log: { tipo_error: 'respuesta_llm_invalida', causa: 'prueba' } };
  for (const nodo of ['Error del evaluador: a reproceso', 'Error del evaluador: a error']) {
    const [err] = await e.correr(nodo, [item]);
    const [act] = e.correrSetJson('Actualización de estado de error', [err]);
    assert.deepEqual(columnas(act).sort(), ['actualizado_en', 'estado', 'llave_dedup']);
    await verEscritura(e, wf, 'Actualizar conversación: estado de error', 'Actualización de estado de error', [act]);
    assert.ok(e.origenes('Actualización de estado de error').some((o) => o.de === nodo));
  }
});

// --- W1 ------------------------------------------------------------------------------

test('W1: payload de ejemplo -> insertar con evaluación inmediata (lote demo); duplicado; reactivar', async () => {
  const wf = leer('workflows/01_ingesta.json');
  const e = crearEjecutor(wf);
  e.fijar('Webhook de ingesta', [{ body: PAYLOAD, query: { lote: 'demo' }, headers: {} }]);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja cuentas', 'cuentas']]);
  await e.correr('Config cargada', [{}]);
  const [v] = await e.correr('Validar payload', [{}]);
  assert.equal(v.valido, true, JSON.stringify(v.errores));
  e.fijar('Leer conversaciones existentes', [{}]); // hoja vacía con "Always Output Data"
  const [d] = await e.correr('Decidir ingesta', [{}]);
  assert.equal(d.accion, 'insertar');
  assert.equal(d.evaluar, true);
  assert.equal(columnas(d.fila).length, 21);
  const filaNueva = e.correrSetJson('Fila nueva de conversaciones', [d]);
  await verEscritura(e, wf, 'Insertar conversación', 'Fila nueva de conversaciones', filaNueva);
  // Reenvío del mismo payload con la fila ya guardada: duplicado.
  e.fijar('Leer conversaciones existentes', [d.fila]);
  const [d2] = await e.correr('Decidir ingesta', [{}]);
  assert.equal(d2.accion, 'duplicado');
  // Fila existente en error: se reutiliza y se reactiva.
  e.fijar('Leer conversaciones existentes', [{ ...d.fila, estado: 'error', intentos: '4' }]);
  const [d3] = await e.correr('Decidir ingesta', [{}]);
  assert.equal(d3.accion, 'reutilizar');
  const act = e.correrSetJson('Actualización de conversaciones', [d3]);
  await verEscritura(e, wf, 'Reactivar conversación', 'Actualización de conversaciones', act);
});

test('W1: payload inválido de punta a punta: log_errores y alertas sin texto, correo, RFC ni payload', async () => {
  const wf = leer('workflows/01_ingesta.json');
  const e = crearEjecutor(wf);
  const TEXTO = 'TEXTO-DISTINTIVO-FICTICIO-7731';
  const CORREO = 'persona.ficticia.7731@ejemplo.test';
  const RFC = 'XAXX010101ZZ9';
  const payload = leer('workflows/pruebas/payload_invalido.json');
  payload.mensajes[0].texto = `${TEXTO} escríbeme a ${CORREO}, mi RFC es ${RFC}`;
  payload.mensajes[1].emisor = `${TEXTO} ${CORREO}`; // valor inválido dentro de un mensaje
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja cuentas', 'cuentas']]);
  e.fijar('Webhook de ingesta', [{ body: payload, query: { lote: 'demo' }, headers: {} }]);
  await e.correr('Config cargada', [{}]);
  const [v] = await e.correr('Validar payload', [{}]);
  assert.equal(v.valido, false);
  assert.deepEqual(e.origenes('Error de payload inválido'), [{ de: '¿Payload válido?', salida: 1 }]);
  const [err] = await e.correr('Error de payload inválido', [v]);
  assert.equal(err.enviar_alerta, true);

  for (const respuesta of [RESPUESTA_TELEGRAM_OK, RESPUESTA_TELEGRAM_ERROR]) {
    const { fila, filaAlerta, alerta } = await cadenaErrores(e, wf, err, respuesta);
    assert.equal(fila.tipo_error, 'payload_invalido');
    assert.equal(fila.alerta_enviada, respuesta.ok ? 'si' : 'no');
    for (const [nombre, x] of [['log_errores', fila], ['alertas', filaAlerta], ['Telegram', alerta.texto_html]]) {
      const texto = JSON.stringify(x);
      for (const prohibido of [TEXTO, CORREO, RFC, JSON.stringify(payload), JSON.stringify(payload.mensajes)]) {
        assert.ok(!texto.includes(prohibido), `${nombre} contiene ${prohibido.slice(0, 40)}`);
      }
    }
  }
});

test('W1: tipo sin rúbrica y sin agente (archivos de workflows/pruebas/)', async () => {
  const wf = leer('workflows/01_ingesta.json');
  const e = crearEjecutor(wf);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja cuentas', 'cuentas']]);
  e.fijar('Webhook de ingesta', [{ body: leer('workflows/pruebas/payload_sales.json'), query: { lote: 'demo' } }]);
  const [cfg] = await e.correr('Config cargada', [{}]);
  const [vs] = await e.correr('Validar payload', [{}]);
  assert.equal(vs.valido, true, JSON.stringify(vs.errores));
  e.fijar('Leer conversaciones existentes', [{}]);
  const [ds] = await e.correr('Decidir ingesta', [{}]);
  assert.equal(ds.accion, 'sin_rubrica');
  assert.equal(ds.enviar_alerta, false);
  // "Error sin rúbrica" (Set manual) agrega config al ítem de la decisión.
  const { fila } = await cadenaErrores(e, wf, { ...ds, config: cfg });
  assert.equal(fila.tipo_error, 'tipo_interaccion_sin_rubrica');
  assert.equal(fila.alerta_enviada, 'no');
  e.fijar('Webhook de ingesta', [{ body: leer('workflows/pruebas/payload_sin_agente.json'), query: { lote: 'demo' } }]);
  await e.correr('Config cargada', [{}]);
  const [va] = await e.correr('Validar payload', [{}]);
  assert.equal(va.valido, true, JSON.stringify(va.errores));
});

test('W1: disparador de calibración: filas nuevas y cierre del lote con columnas del contrato', async () => {
  const wf = leer('workflows/01_ingesta.json');
  const e = crearEjecutor(wf);
  e.fijar('Parámetros de calibración', [{ lote: 'calibracion_v1', version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v2' }]);
  e.fijar('Leer config (calibración)', DATOS.config);
  await e.correr('Config de calibración', [{}]);
  const origen = filaConversaciones({ ...PAYLOAD, conversation_id: 'CONV-0101' }, 'calibracion_v1', { version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v1' }, CONFIG_CE, new Date());
  e.fijar('Leer conversaciones del lote', [origen]);
  const [plan] = await e.correr('Planificar calibración', [{}]);
  assert.equal(plan.valido, true, JSON.stringify(plan.errores));
  const nuevas = e.separar('Filas nuevas', [plan]);
  assert.equal(nuevas.length, 1);
  await verEscritura(e, wf, 'Crear filas de la versión', 'Filas nuevas', nuevas);

  const critico = { conversation_id: 'CONV-0101', lote: 'calibracion_v1', agente: 'Agente de prueba', id_criterio: 'critico.promesa_no_autorizada', mensajes: [4], evidencia: 'evidencia <ficticia> & enmascarada' };
  const envios = await e.correr('Cierre del lote', [{ lote: 'calibracion_v1', acumular: [critico], costo_usd: 0.004 }]);
  assert.ok(envios.length >= 1);
  for (const envio of envios) {
    assert.ok(envio.texto_html.includes('critico.promesa_no_autorizada'), 'los guiones bajos se conservan');
    assert.ok(envio.texto_html.includes('&lt;ficticia&gt; &amp;'), 'texto_html escapa &, < y >');
  }
  e.fijar('Telegram: cierre del lote', [RESPUESTA_TELEGRAM_OK]);
  const [fa] = await e.correr('Fila alertas (cierre del lote)', [RESPUESTA_TELEGRAM_OK]);
  assert.equal(fa.modo_envio, 'resumen_lote');
  await verEscritura(e, wf, 'Escribir alertas (cierre del lote)', 'Fila alertas (cierre del lote)', [fa]);
});

// --- W0 ------------------------------------------------------------------------------

function prepararW0(e, formulario) {
  e.fijar('Formulario del simulador', [formulario]);
  e.fijar('URL de Ingesta', [{ url_webhook_ingesta: 'http://localhost:5678/webhook/qa-ingesta' }]);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja catalogo_temas', 'catalogo_temas'], ['Leer hoja cuentas', 'cuentas'], ['Leer hoja base_conocimiento', 'base_conocimiento'], ['Leer hoja listas', 'listas']]);
  for (const n of ['Leer hoja escenarios', 'Leer hoja conversaciones', 'Leer hoja revision_humana']) e.fijar(n, [{}]);
  e.fijar('Plantilla generador', [e.valorSet('Plantilla generador')]);
  e.fijar('Esquema generador', [e.valorSet('Esquema generador')]);
}

test('W0: formulario -> escenario -> petición a Claude -> filas y POST sin la verdad del escenario', async () => {
  const wf = leer('workflows/00_simulador.json');
  const e = crearEjecutor(wf);
  prepararW0(e, { calidad_solicitada: 'buena', cantidad: 1, lote: 'demo', tipo_interaccion: 'ce', semilla_sorteo: 12345, tema: '', error_critico: '', criterios_que_deben_fallar: '', casos_dificiles: '' });
  await e.correr('Config general', [{}]);
  const [vf] = await e.correr('Validar formulario', [{}]);
  assert.equal(vf.valido, true, JSON.stringify(vf.errores));
  await e.correr('Config cargada', [{}]);
  const [plan] = await e.correr('Completar escenario', [{}]);
  assert.equal(plan.valido, true, JSON.stringify(plan.errores));
  const [vg] = await e.correr('Valores del generador', plan.escenarios);
  assert.equal(Object.keys(vg.valores_generador).length, 15);
  const [cp] = await e.correr('Construir petición generador', [vg]);
  assert.equal(cp.peticion_claude.model, CONFIG_CE.modelo_generador);
  e.fijar('Preparar llamada Claude', [cp]);

  // Respuesta simulada de Claude: el payload de ejemplo en la forma del esquema del generador.
  const salida = JSON.parse(JSON.stringify(PAYLOAD));
  salida.metadatos_caso.campos_capturados = Object.entries(PAYLOAD.metadatos_caso.campos_capturados).map(([campo, estado]) => ({ campo, estado }));
  salida.metadatos_caso.tipificacion_agente = vg.escenario.tipificacion_esperada;
  const cuerpo = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(salida) }], usage: { input_tokens: 1000, output_tokens: 2000 } };
  const [cls] = await e.correr('Clasificar respuesta Claude', [{ statusCode: 200, headers: {}, body: cuerpo }]);
  const [lr] = await e.correr('Leer respuesta generador', [cls]);
  assert.equal(lr.lectura_generador.completa, true);
  const [vgen] = await e.correr('Validar generación', [lr]);
  assert.equal(vgen.valido, true, JSON.stringify(vgen.errores));
  assert.equal(vgen.payload.conversation_id, vg.escenario.conversation_id);
  const [v1] = await e.correr('Verificación: JS-1 Normalización', [vgen]);
  const [v2] = await e.correr('Verificación: JS-2 Extracción y enmascaramiento', [v1]);
  const [v3] = await e.correr('Verificación: JS-3 Reglas deterministas', [v2]);
  const [ve] = await e.correr('Verificar escenario generado', [v3]);
  assert.equal(ve.contexto_verificacion, undefined, 'el contexto con datos sin enmascarar no sigue en el ítem');
  const [dg] = await e.correr('Decidir intento de generación', [ve]);
  assert.equal(dg.decision.accion, 'continuar', JSON.stringify(dg.decision));

  const [fe] = await e.correr('Fila de escenarios', [dg]);
  assert.deepEqual(columnas(fe), COLUMNAS_ESCENARIOS);
  assert.equal(fe.lote, 'demo');
  assert.equal(fe.semilla_sorteo, 12345);
  await verEscritura(e, wf, 'Escribir escenarios', 'Fila de escenarios', [fe]);
  const [fr] = await e.correr('Fila de revisión humana', [fe]);
  assert.deepEqual(columnas(fr), COLUMNAS_REVISION_HUMANA);
  assert.ok(columnas(fr).filter((c) => c.startsWith('h_')).every((c) => fr[c] === ''), 'las columnas h_* van vacías');
  await verEscritura(e, wf, 'Escribir revision_humana', 'Fila de revisión humana', [fr]);
  const [post] = await e.correr('Envío a Ingesta', [fr]);
  assert.equal(post.url, 'http://localhost:5678/webhook/qa-ingesta?lote=demo');
  assert.deepEqual(Object.keys(post.body).sort(), ['agente', 'canal', 'conversation_id', 'cuenta_id', 'mensajes', 'metadatos_caso', 'tipo_interaccion']);
  const texto = JSON.stringify(post.body);
  for (const prohibido of ['calidad_esperada', 'errores_criticos_inyectados', 'criterios_que_deben_fallar', 'casos_dificiles', 'semilla_sorteo']) {
    assert.ok(!texto.includes(prohibido), `la verdad del escenario no viaja a Ingesta (${prohibido})`);
  }

  // Falla del POST: cadena de errores con alerta; el registro vuelve al bucle.
  const [errPost] = await e.correr('Error al enviar a Ingesta', [{ error: 'ECONNREFUSED' }]);
  const { fila } = await cadenaErrores(e, wf, errPost, RESPUESTA_TELEGRAM_ERROR);
  assert.equal(fila.alerta_enviada, 'no');
  assert.ok(wf.connections['Escribir log_errores'].main[0].some((d) => d.node === 'Una conversación a la vez'), 'tras registrar sigue el bucle');
});

test('W0: cantidad 0 (el vacío del campo número de n8n) genera 1 conversación', async () => {
  const e = crearEjecutor(leer('workflows/00_simulador.json'));
  for (const cantidad of [0, '0', '', null]) {
    prepararW0(e, { calidad_solicitada: 'buena', cantidad, lote: 'demo', tipo_interaccion: 'ce', semilla_sorteo: 777, tema: '', error_critico: '', criterios_que_deben_fallar: '', casos_dificiles: '' });
    await e.correr('Config general', [{}]);
    const [vf] = await e.correr('Validar formulario', [{}]);
    assert.equal(vf.valido, true, `${JSON.stringify(cantidad)}: ${JSON.stringify(vf.errores)}`);
    await e.correr('Config cargada', [{}]);
    const [plan] = await e.correr('Completar escenario', [{}]);
    assert.equal(plan.valido, true, JSON.stringify(plan.errores));
    assert.equal(plan.escenarios.length, 1, `cantidad ${JSON.stringify(cantidad)} -> 1 conversación`);
  }
});

test('W0: lote congelado y cantidad mayor al máximo se rechazan antes de llamar a la API', async () => {
  const wf = leer('workflows/00_simulador.json');
  const e = crearEjecutor(wf);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja catalogo_temas', 'catalogo_temas']]);
  for (const caso of [{ lote: 'calibracion_v1' }, { lote: 'demo', cantidad: 99 }]) {
    e.fijar('Formulario del simulador', [{ tipo_interaccion: 'ce', ...caso }]);
    await e.correr('Config general', [{}]);
    const [vf] = await e.correr('Validar formulario', [{}]);
    assert.equal(vf.valido, false, JSON.stringify(caso));
    assert.ok(vf.errores.length > 0);
    const [err] = await e.correr('Error de formulario', [vf]);
    assert.equal(err.enviar_alerta, false, 'formulario_invalido no manda Telegram');
    const [log] = await e.correr('Fila log_errores (formulario)', [err]);
    assert.deepEqual(columnas(log), COLUMNAS_LOG_ERRORES);
    assert.equal(log.tipo_error, 'formulario_invalido');
    assert.equal(log.alerta_enviada, 'no');
    await verEscritura(e, wf, 'Escribir log_errores (formulario)', 'Fila log_errores (formulario)', [log]);
  }
});

// --- W4 y 99 -------------------------------------------------------------------------

test('W4: decisiones, actualizaciones y registro', async () => {
  const wf = leer('workflows/04_reproceso.json');
  const w4 = crearEjecutor(wf);
  w4.fijar('Leer hoja config', DATOS.config);
  const [cfg] = await w4.correr('Config cargada', [{}]);
  const fila = { ...filaConversaciones(PAYLOAD, 'demo', { version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v1' }, CONFIG_CE, new Date()), estado: 'reproceso' };
  const [reenviar] = await w4.correr('Decidir reproceso', [{ ...fila, intentos: 1 }]);
  assert.equal(reenviar.accion, 'reenviar');
  const [agotada] = await w4.correr('Decidir reproceso', [{ ...fila, intentos: cfg.reproceso_max_intentos + 1 }]);
  assert.equal(agotada.accion, 'pasar_a_error');
  const actE = w4.correrSetJson('Actualización a error', [agotada]);
  await verEscritura(w4, wf, 'Pasar conversación a error', 'Actualización a error', actE);
  const { fila: log } = await cadenaErrores(w4, wf, agotada, RESPUESTA_TELEGRAM_OK);
  assert.equal(log.workflow, 'reproceso');
  assert.equal(log.alerta_enviada, 'si');
  // Atascada: en_evaluacion con actualizado_en más viejo que evaluacion_tiempo_maximo_min.
  const vieja = new Date(Date.now() - (cfg.evaluacion_tiempo_maximo_min + 5) * 60000).toISOString();
  const [atascada] = await w4.correr('Decidir reproceso', [{ ...fila, estado: 'en_evaluacion', intentos: 1, actualizado_en: vieja }]);
  assert.equal(atascada.accion, 'marcar_atascada');
  assert.equal(atascada.actualizacion.estado, 'reproceso');
  const actA = w4.correrSetJson('Actualización a reproceso (atascada)', [atascada]);
  await verEscritura(w4, wf, 'Pasar atascada a reproceso', 'Actualización a reproceso (atascada)', actA);
  const { fila: logA } = await cadenaErrores(w4, wf, atascada);
  assert.equal(logA.tipo_error, 'fallo_nodo');
  assert.equal(logA.alerta_enviada, 'no');
  const [reciente] = await w4.correr('Decidir reproceso', [{ ...fila, estado: 'en_evaluacion', intentos: 1, actualizado_en: new Date().toISOString() }]);
  assert.equal(reciente.accion, 'ignorar');
  // Cierre por lotes: los resultados de W2 traen `lote`.
  w4.fijar('Evaluar conversación', [{ lote: 'demo', acumular: [], costo_usd: 0.004 }, { error: 'falló' }]);
  const envios = await w4.correr('Cierre del lote', w4.salida('Evaluar conversación'));
  assert.ok(Array.isArray(envios));
  const conCosto = await w4.correr('Cierre del lote', [{ lote: 'demo', acumular: [], costo_usd: 999 }]);
  assert.ok(conCosto.length >= 1, 'el tope del lote dispara la alerta de costo');
  const [fa] = await w4.correr('Fila alertas (cierre del lote)', [RESPUESTA_TELEGRAM_ERROR]);
  assert.equal(fa.estado_envio, 'fallida');
  await verEscritura(w4, wf, 'Escribir alertas (cierre del lote)', 'Fila alertas (cierre del lote)', [fa]);
});

test('99 Errores: registro, alerta y paso a reproceso', async () => {
  const wf = leer('workflows/99_errores.json');
  const we = crearEjecutor(wf);
  we.fijar('Disparador de errores', [{ execution: { id: '1', error: { message: 'falló Sheets', node: { name: 'Leer hoja config', type: 'n8n-nodes-base.googleSheets' } } }, workflow: { id: 'x', name: '02 Evaluación' } }]);
  we.fijar('Leer hoja config', DATOS.config);
  await we.correr('Config cargada', [{}]);
  const [datos] = await we.correr('Datos del error', [{}]);
  assert.equal(datos.actualizacion_conversacion, null, 'sin llave en el mensaje no se identifica la conversación');
  const { fila: filaLog } = await cadenaErrores(we, wf, datos, RESPUESTA_TELEGRAM_OK);
  assert.equal(filaLog.workflow, 'evaluacion');
  assert.equal(filaLog.tipo_error, 'fallo_sheets');
  assert.equal(filaLog.alerta_enviada, 'si');
  // Con la llave_dedup en el mensaje, la conversación pasa a reproceso.
  we.fijar('Disparador de errores', [{ execution: { id: '2', error: { message: 'falla en CONV-0001|reglas_ce_v1|evaluador_ce_v1', node: { name: 'JS-3 Reglas deterministas', type: 'n8n-nodes-base.code' } } }, workflow: { id: 'x', name: '02 Evaluación' } }]);
  const [datos2] = await we.correr('Datos del error', [{}]);
  assert.equal(datos2.actualizacion_conversacion.estado, 'reproceso');
  assert.equal(datos2.actualizacion_conversacion.llave_dedup, 'CONV-0001|reglas_ce_v1|evaluador_ce_v1');
  const act = we.correrSetJson('Actualización a reproceso', [datos2]);
  await verEscritura(we, wf, 'Pasar conversación a reproceso', 'Actualización a reproceso', act);
});

// --- cobertura: todas las escrituras quedaron verificadas -------------------------------

test('cobertura: cada nodo Sheets de escritura (append y update) se verificó en esta simulación', () => {
  const faltan = [];
  for (const archivo of ARCHIVOS) {
    const wf = leer(`workflows/${archivo}`);
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.googleSheets' || !['append', 'update'].includes(n.parameters.operation)) continue;
      if (!(cubiertas.get(wf.name) || new Set()).has(n.name)) faltan.push(`${wf.name}: ${n.name}`);
    }
  }
  assert.deepEqual(faltan, []);
});
