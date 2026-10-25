// =============================================================================
// simulacion.test.js — recorre los caminos principales de W1, W2 y W0 ejecutando los nodos
// Code GENERADOS (los mismos que se importan en n8n) con datos de datos/ y contrato/ejemplos/.
// -----------------------------------------------------------------------------
// Qué demuestra: que cada pegamento lee los nodos y campos que de verdad existen, que las
// funciones de js/ reciben lo que esperan y que las salidas tienen las columnas del contrato.
// Las lecturas de Sheets, el HTTP y los Set se simulan con `fijar`. No llama a ninguna API.
// =============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { crearEjecutor } = require('./ejecutor_n8n');
const { DATOS, leerCSV } = require('../../js/tests/ayudas');
const { filaConversaciones } = require('../../js/ingesta');
const { cargarConfig } = require('../../js/normalizacion');
const { COLUMNAS_ESCENARIOS, COLUMNAS_REVISION_HUMANA } = require('../../js/simulador');
const { COLUMNAS_LOG_ERRORES } = require('../../js/registro_errores');
const { COLUMNAS_ALERTAS } = require('../../js/alertas');

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (rel) => JSON.parse(fs.readFileSync(path.join(RAIZ, ...rel.split('/')), 'utf8'));
const BASE = leerCSV(fs.readFileSync(path.join(RAIZ, 'datos', 'base_conocimiento.csv'), 'utf8'));
const PAYLOAD = leer('contrato/ejemplos/payload_ejemplo.json');
const CONFIG_CE = cargarConfig(DATOS.config, 'ce');
const columnas = (obj) => Object.keys(obj);

function respuesta200DelMock() {
  const mock = leer('workflows/pruebas/mock_api.json');
  return JSON.parse(mock.nodes.find((n) => n.name === 'Responder 200').parameters.responseBody);
}

function fijarReferencia(e, nombres) {
  const tablas = { config: DATOS.config, listas: DATOS.listas, catalogo_temas: DATOS.catalogo, cuentas: DATOS.cuentas, base_conocimiento: BASE };
  for (const [nodo, hoja] of nombres) e.fijar(nodo, tablas[hoja]);
}

test('W2: camino completo con la respuesta del mock (continuar -> evaluada)', async () => {
  const e = crearEjecutor(leer('workflows/02_evaluacion.json'));
  const fila = filaConversaciones(PAYLOAD, 'demo', { version_reglas: CONFIG_CE.version_reglas, version_prompt: CONFIG_CE.version_prompt }, CONFIG_CE, new Date());
  e.fijar('Leer conversación', [fila]);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja listas', 'listas'], ['Leer hoja catalogo_temas', 'catalogo_temas'], ['Leer hoja base_conocimiento', 'base_conocimiento'], ['Leer hoja cuentas', 'cuentas']]);
  e.fijar('Plantilla evaluador', [e.valorSet('Plantilla evaluador')]);
  e.fijar('Esquema LLM', [e.valorSet('Esquema LLM')]);

  const [js1] = await e.correr('JS-1 Normalización', [{}]);
  assert.equal(js1.llave_dedup, fila.llave_dedup);
  const [entrada] = await e.correr('Entrada a evaluación', [{}]);
  assert.deepEqual(columnas(entrada).sort(), ['actualizado_en', 'estado', 'intentos', 'llave_dedup']);
  assert.equal(entrada.estado, 'en_evaluacion');
  assert.equal(entrada.intentos, 1);
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
  const [alr] = await e.correr('Preparar alertas de la evaluación', [evd]);
  assert.ok(Array.isArray(alr.envios) && Array.isArray(alr.acumular));
  for (const envio of alr.envios) {
    e.fijar('Separar alertas', [envio]);
    const [fa] = await e.correr('Fila alertas (evaluación)', [{ ok: true, result: {} }]);
    assert.deepEqual(columnas(fa), COLUMNAS_ALERTAS);
    assert.equal(fa.estado_envio, 'enviada');
  }
});

test('W2: falla de la API -> reproceso y cadena de errores con alerta', async () => {
  const e = crearEjecutor(leer('workflows/02_evaluacion.json'));
  const fila = filaConversaciones(PAYLOAD, 'demo', { version_reglas: CONFIG_CE.version_reglas, version_prompt: CONFIG_CE.version_prompt }, CONFIG_CE, new Date());
  e.fijar('Leer conversación', [fila]);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja listas', 'listas'], ['Leer hoja catalogo_temas', 'catalogo_temas'], ['Leer hoja base_conocimiento', 'base_conocimiento'], ['Leer hoja cuentas', 'cuentas']]);
  e.fijar('Plantilla evaluador', [e.valorSet('Plantilla evaluador')]);
  e.fijar('Esquema LLM', [e.valorSet('Esquema LLM')]);
  await e.correr('JS-1 Normalización', [{}]);
  const [js2] = await e.correr('JS-2 Extracción y enmascaramiento', [{}]);
  const [js3] = await e.correr('JS-3 Reglas deterministas', [js2]);
  const [js4] = await e.correr('JS-4 Construcción del prompt', [js3]);
  e.fijar('Preparar llamada OpenAI', [js4]);
  // 404 (por ejemplo, modelo inexistente): no se reintenta.
  const [c] = await e.correr('Clasificar respuesta OpenAI', [{ statusCode: 404, headers: {}, body: {} }]);
  assert.equal(c.clasificacion_http.accion, 'falla_api');
  const [err] = await e.correr('Error HTTP del evaluador: a reproceso', [c]);
  assert.equal(err.estado, 'reproceso');
  assert.equal(err.llave_dedup, fila.llave_dedup);
  const [log] = await e.correr('Fila log_errores', [err]);
  const { aux_error, ...filaLog } = log;
  assert.deepEqual(columnas(filaLog), COLUMNAS_LOG_ERRORES);
  assert.equal(filaLog.tipo_error, 'fallo_api');
  assert.equal(filaLog.alerta_enviada, 'si');
  assert.ok(aux_error.registrar_error);
  const [alerta] = await e.correr('Armar alerta operativa', [log]);
  assert.match(alerta.texto, /ALERTA OPERATIVA/);
  const [fa] = await e.correr('Fila alertas (operativa)', [{ error: 'telegram caído' }]);
  assert.deepEqual(columnas(fa), COLUMNAS_ALERTAS);
  assert.equal(fa.estado_envio, 'fallida');
});

test('W1: payload de ejemplo -> insertar con evaluación inmediata (lote demo)', async () => {
  const e = crearEjecutor(leer('workflows/01_ingesta.json'));
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
  // Reenvío del mismo payload con la fila ya guardada: duplicado.
  e.fijar('Leer conversaciones existentes', [d.fila]);
  const [d2] = await e.correr('Decidir ingesta', [{}]);
  assert.equal(d2.accion, 'duplicado');
});

test('W1: payload inválido y tipo sin rúbrica (archivos de workflows/pruebas/)', async () => {
  const e = crearEjecutor(leer('workflows/01_ingesta.json'));
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja cuentas', 'cuentas']]);
  e.fijar('Webhook de ingesta', [{ body: leer('workflows/pruebas/payload_invalido.json'), query: { lote: 'demo' } }]);
  await e.correr('Config cargada', [{}]);
  const [v] = await e.correr('Validar payload', [{}]);
  assert.equal(v.valido, false);
  e.fijar('Webhook de ingesta', [{ body: leer('workflows/pruebas/payload_sales.json'), query: { lote: 'demo' } }]);
  await e.correr('Config cargada', [{}]);
  const [vs] = await e.correr('Validar payload', [{}]);
  assert.equal(vs.valido, true, JSON.stringify(vs.errores));
  e.fijar('Leer conversaciones existentes', [{}]);
  const [ds] = await e.correr('Decidir ingesta', [{}]);
  assert.equal(ds.accion, 'sin_rubrica');
  assert.equal(ds.enviar_alerta, false);
  e.fijar('Webhook de ingesta', [{ body: leer('workflows/pruebas/payload_sin_agente.json'), query: { lote: 'demo' } }]);
  await e.correr('Config cargada', [{}]);
  const [va] = await e.correr('Validar payload', [{}]);
  assert.equal(va.valido, true, JSON.stringify(va.errores));
});

test('W0: formulario -> escenario -> petición a Claude -> filas y POST sin la verdad del escenario', async () => {
  const e = crearEjecutor(leer('workflows/00_simulador.json'));
  e.fijar('Formulario del simulador', [{ calidad_solicitada: 'buena', cantidad: 1, lote: 'demo', tipo_interaccion: 'ce', semilla_sorteo: 12345, tema: '', error_critico: '', criterios_que_deben_fallar: '', casos_dificiles: '' }]);
  e.fijar('URL de Ingesta', [{ url_webhook_ingesta: 'http://localhost:5678/webhook/qa-ingesta' }]);
  fijarReferencia(e, [['Leer hoja config', 'config'], ['Leer hoja catalogo_temas', 'catalogo_temas'], ['Leer hoja cuentas', 'cuentas'], ['Leer hoja base_conocimiento', 'base_conocimiento'], ['Leer hoja listas', 'listas']]);
  for (const n of ['Leer hoja escenarios', 'Leer hoja conversaciones', 'Leer hoja revision_humana']) e.fijar(n, [{}]);
  e.fijar('Plantilla generador', [e.valorSet('Plantilla generador')]);
  e.fijar('Esquema generador', [e.valorSet('Esquema generador')]);
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
  const [fr] = await e.correr('Fila de revisión humana', [fe]);
  assert.deepEqual(columnas(fr), COLUMNAS_REVISION_HUMANA);
  assert.ok(columnas(fr).filter((c) => c.startsWith('h_')).every((c) => fr[c] === ''), 'las columnas h_* van vacías');
  const [post] = await e.correr('Envío a Ingesta', [fr]);
  assert.equal(post.url, 'http://localhost:5678/webhook/qa-ingesta?lote=demo');
  assert.deepEqual(Object.keys(post.body).sort(), ['agente', 'canal', 'conversation_id', 'cuenta_id', 'mensajes', 'metadatos_caso', 'tipo_interaccion']);
  const texto = JSON.stringify(post.body);
  for (const prohibido of ['calidad_esperada', 'errores_criticos_inyectados', 'criterios_que_deben_fallar', 'casos_dificiles', 'semilla_sorteo']) {
    assert.ok(!texto.includes(prohibido), `la verdad del escenario no viaja a Ingesta (${prohibido})`);
  }
});

test('W0: lote congelado y cantidad mayor al máximo se rechazan antes de llamar a la API', async () => {
  const e = crearEjecutor(leer('workflows/00_simulador.json'));
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
    assert.equal(log.tipo_error, 'formulario_invalido');
    assert.equal(log.alerta_enviada, 'no');
  }
});

test('W4 y 99 Errores: decisiones y registro', async () => {
  const w4 = crearEjecutor(leer('workflows/04_reproceso.json'));
  w4.fijar('Leer hoja config', DATOS.config);
  const [cfg] = await w4.correr('Config cargada', [{}]);
  const fila = { ...filaConversaciones(PAYLOAD, 'demo', { version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v1' }, CONFIG_CE, new Date()), estado: 'reproceso' };
  const [reenviar] = await w4.correr('Decidir reproceso', [{ ...fila, intentos: 1 }]);
  assert.equal(reenviar.accion, 'reenviar');
  const [agotada] = await w4.correr('Decidir reproceso', [{ ...fila, intentos: cfg.reproceso_max_intentos + 1 }]);
  assert.equal(agotada.accion, 'pasar_a_error');
  const [log] = await w4.correr('Fila log_errores', [agotada]);
  assert.equal(log.workflow, 'reproceso');
  // Atascada: en_evaluacion con actualizado_en más viejo que evaluacion_tiempo_maximo_min.
  const vieja = new Date(Date.now() - (cfg.evaluacion_tiempo_maximo_min + 5) * 60000).toISOString();
  const [atascada] = await w4.correr('Decidir reproceso', [{ ...fila, estado: 'en_evaluacion', intentos: 1, actualizado_en: vieja }]);
  assert.equal(atascada.accion, 'marcar_atascada');
  assert.equal(atascada.actualizacion.estado, 'reproceso');
  const [logA] = await w4.correr('Fila log_errores', [atascada]);
  assert.equal(logA.tipo_error, 'fallo_nodo');
  assert.equal(logA.alerta_enviada, 'no');
  const [reciente] = await w4.correr('Decidir reproceso', [{ ...fila, estado: 'en_evaluacion', intentos: 1, actualizado_en: new Date().toISOString() }]);
  assert.equal(reciente.accion, 'ignorar');
  // Cierre por lotes: los resultados de W2 traen `lote`.
  w4.fijar('Evaluar conversación', [{ lote: 'demo', acumular: [], costo_usd: 0.004 }, { error: 'falló' }]);
  const envios = await w4.correr('Cierre del lote', w4.salida('Evaluar conversación'));
  assert.ok(Array.isArray(envios));

  const we = crearEjecutor(leer('workflows/99_errores.json'));
  we.fijar('Disparador de errores', [{ execution: { id: '1', error: { message: 'falló Sheets', node: { name: 'Leer hoja config', type: 'n8n-nodes-base.googleSheets' } } }, workflow: { id: 'x', name: '02 Evaluación' } }]);
  we.fijar('Leer hoja config', DATOS.config);
  await we.correr('Config cargada', [{}]);
  const [datos] = await we.correr('Datos del error', [{}]);
  assert.equal(datos.actualizacion_conversacion, null, 'sin llave en el mensaje no se identifica la conversación');
  const [filaLog] = await we.correr('Fila log_errores', [datos]);
  assert.equal(filaLog.workflow, 'evaluacion');
  assert.equal(filaLog.tipo_error, 'fallo_sheets');
  // Con la llave_dedup en el mensaje, la conversación pasa a reproceso.
  we.fijar('Disparador de errores', [{ execution: { id: '2', error: { message: 'falla en CONV-0001|reglas_ce_v1|evaluador_ce_v1', node: { name: 'JS-3 Reglas deterministas', type: 'n8n-nodes-base.code' } } }, workflow: { id: 'x', name: '02 Evaluación' } }]);
  const [datos2] = await we.correr('Datos del error', [{}]);
  assert.equal(datos2.actualizacion_conversacion.estado, 'reproceso');
  assert.equal(datos2.actualizacion_conversacion.llave_dedup, 'CONV-0001|reglas_ce_v1|evaluador_ce_v1');
});
