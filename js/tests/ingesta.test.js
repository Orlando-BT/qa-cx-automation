const test = require('node:test');
const assert = require('node:assert/strict');

const I = require('../ingesta');
const { cargarConfig } = require('../normalizacion');
const { configCE, filasConfigCon, leerJSON } = require('./ayudas');
const { columnasDeHoja } = require('./columnas_contrato');

const config = configCE();
const configSales = cargarConfig(filasConfigCon(), 'sales');
const payload = leerJSON('contrato/ejemplos/payload_ejemplo.json'); // CONV-0001, tipo ce
const AHORA = new Date('2026-10-24T18:00:00Z'); // 12:00:00 en America/Mexico_City (-06:00)
const MARCA = '2026-10-24T12:00:00-06:00';
const LLAVE = 'CONV-0001|reglas_ce_v1|evaluador_ce_v1';

/** Fila existente de conversaciones con el estado pedido (valores como texto, como los entrega Sheets). */
function filaExistente(estado, cambios = {}) {
  const f = I.decidirIngesta({ payload, lote: 'demo', config, ahora: AHORA }).fila;
  return Object.fromEntries(Object.entries({ ...f, estado, ...cambios }).map(([k, v]) => [k, String(v)]));
}

test('las columnas de conversaciones coinciden con sheets.md (21)', () => {
  assert.deepEqual(I.COLUMNAS_CONVERSACIONES, columnasDeHoja('conversaciones'));
  assert.equal(I.COLUMNAS_CONVERSACIONES.length, 21);
  // Las columnas 2 a 14 son las que copia el disparador manual.
  assert.equal(I.COLUMNAS_DATOS_CONVERSACION[0], 'conversation_id');
  assert.equal(I.COLUMNAS_DATOS_CONVERSACION.at(-1), 'total_mensajes');
  assert.equal(I.COLUMNAS_DATOS_CONVERSACION.length, 13);
});

test('llaveDedup: conversation_id|version_reglas|version_prompt', () => {
  assert.equal(I.llaveDedup('CONV-0001', 'reglas_ce_v1', 'evaluador_ce_v1'), LLAVE);
});

// --- Evaluar al ingerir -----------------------------------------------------

test('demo siempre se evalúa; calibracion según evaluar_al_ingerir_calibracion', () => {
  assert.equal(I.debeEvaluarAlIngerir('demo', config), true);
  assert.equal(I.debeEvaluarAlIngerir('demo', { ...config, evaluar_al_ingerir_calibracion: true }), true);
  assert.equal(config.evaluar_al_ingerir_calibracion, false, 'valor por defecto del contrato: no');
  assert.equal(I.debeEvaluarAlIngerir('calibracion_v1', config), false);
  assert.equal(I.debeEvaluarAlIngerir('calibracion_v2', { ...config, evaluar_al_ingerir_calibracion: true }), true);
  assert.throws(() => I.debeEvaluarAlIngerir('otro', config), /lote inválido/);
});

// --- Insertar ---------------------------------------------------------------

test('insertar: fila de 21 columnas exactas, pendiente, intentos 0 y fechas del sistema', () => {
  const r = I.decidirIngesta({ payload, lote: 'demo', config, filasExistentes: [], ahora: AHORA });
  assert.equal(r.accion, 'insertar');
  assert.equal(r.evaluar, true);
  assert.equal(r.llave_dedup, LLAVE);
  const f = r.fila;
  assert.deepEqual(Object.keys(f), columnasDeHoja('conversaciones'));
  assert.equal(f.llave_dedup, LLAVE);
  assert.equal(f.lote, 'demo');
  assert.equal(f.estado, 'pendiente');
  assert.equal(f.intentos, 0);
  assert.equal(f.escalado, 'no');
  assert.equal(f.numero_caso, 'CASO-58213');
  assert.equal(f.total_mensajes, payload.mensajes.length);
  assert.deepEqual(JSON.parse(f.mensajes_json), payload.mensajes);
  assert.deepEqual(JSON.parse(f.campos_capturados_json), payload.metadatos_caso.campos_capturados);
  assert.equal(f.recibido_en, MARCA);
  assert.equal(f.actualizado_en, MARCA);
  assert.equal(f.id_evaluacion, '');
  assert.equal(f.version_reglas, 'reglas_ce_v1');
  assert.equal(f.version_prompt, 'evaluador_ce_v1');
});

test('numero_caso null queda vacío y escalado true queda "si"', () => {
  const p = JSON.parse(JSON.stringify(payload));
  p.metadatos_caso.numero_caso = null;
  p.metadatos_caso.estado_caso = 'sin_caso';
  p.metadatos_caso.escalado = true;
  const f = I.decidirIngesta({ payload: p, lote: 'demo', config, ahora: AHORA }).fila;
  assert.equal(f.numero_caso, '');
  assert.equal(f.escalado, 'si');
});

test('lote vacío usa config.lote_por_defecto; lote inválido lanza error', () => {
  assert.equal(I.decidirIngesta({ payload, lote: '', config, ahora: AHORA }).lote, 'demo');
  assert.throws(() => I.decidirIngesta({ payload, lote: 'xyz', config, ahora: AHORA }), /lote inválido/);
});

test('lote calibracion con evaluar_al_ingerir_calibracion = no: se inserta pero no se evalúa', () => {
  const r = I.decidirIngesta({ payload, lote: 'calibracion_v1', config, ahora: AHORA });
  assert.equal(r.accion, 'insertar');
  assert.equal(r.evaluar, false);
  const r2 = I.decidirIngesta({ payload, lote: 'calibracion_v1', config: { ...config, evaluar_al_ingerir_calibracion: true }, ahora: AHORA });
  assert.equal(r2.evaluar, true);
});

// --- Duplicado y reutilizar -------------------------------------------------

test('duplicado: cualquier estado distinto de error, incluido reproceso', () => {
  for (const estado of ['pendiente', 'en_evaluacion', 'evaluada', 'reproceso']) {
    const r = I.decidirIngesta({ payload, lote: 'demo', config, filasExistentes: [filaExistente(estado)], ahora: AHORA });
    assert.equal(r.accion, 'duplicado', estado);
    assert.equal(r.evaluar, false, estado);
    assert.equal(r.estado_existente, estado);
  }
});

test('misma conversación con otra versión de prompt NO es duplicado', () => {
  const otra = filaExistente('evaluada', { llave_dedup: 'CONV-0001|reglas_ce_v1|evaluador_ce_v0' });
  const r = I.decidirIngesta({ payload, lote: 'demo', config, filasExistentes: [otra], ahora: AHORA });
  assert.equal(r.accion, 'insertar');
});

test('reutilizar: estado error vuelve a pendiente, suma un intento y se evalúa', () => {
  const r = I.decidirIngesta({ payload, lote: 'demo', config, filasExistentes: [filaExistente('error', { intentos: 2 })], ahora: AHORA });
  assert.equal(r.accion, 'reutilizar');
  assert.equal(r.evaluar, true);
  assert.deepEqual(r.actualizacion, { llave_dedup: LLAVE, estado: 'pendiente', intentos: 3, actualizado_en: MARCA });
});

test('reutilizar en lote calibracion con config = no: vuelve a pendiente sin evaluar', () => {
  const r = I.decidirIngesta({ payload, lote: 'calibracion_v1', config, filasExistentes: [filaExistente('error', { intentos: 1 })], ahora: AHORA });
  assert.equal(r.accion, 'reutilizar');
  assert.equal(r.evaluar, false);
});

// --- Tipo sin rúbrica -------------------------------------------------------

test('sales sin rúbrica: no inserta, registra tipo_interaccion_sin_rubrica y no alerta por defecto', () => {
  const p = { ...payload, tipo_interaccion: 'sales' };
  const r = I.decidirIngesta({ payload: p, lote: 'demo', config: configSales, ahora: AHORA });
  assert.equal(r.accion, 'sin_rubrica');
  assert.equal(r.evaluar, false);
  assert.equal(r.llave_dedup, null);
  assert.equal('fila' in r, false);
  assert.equal(r.enviar_alerta, false, 'alerta_tipo_interaccion_sin_rubrica = no por defecto');
  assert.equal(r.registrar_error.tipo_error, 'tipo_interaccion_sin_rubrica');
  assert.equal(r.registrar_error.workflow, 'ingesta');
  assert.equal(r.registrar_error.conversation_id, 'CONV-0001');
  assert.equal(r.registrar_error.tipo_interaccion, 'sales');
});

test('sales sin rúbrica con alerta_tipo_interaccion_sin_rubrica = si: pide alerta operativa', () => {
  const p = { ...payload, tipo_interaccion: 'sales' };
  const cfg = { ...configSales, alerta_tipo_interaccion_sin_rubrica: true };
  assert.equal(I.decidirIngesta({ payload: p, lote: 'demo', config: cfg, ahora: AHORA }).enviar_alerta, true);
});

test('el error de sin_rubrica no incluye contenido de la conversación', () => {
  const p = { ...payload, tipo_interaccion: 'sales' };
  const r = I.decidirIngesta({ payload: p, lote: 'demo', config: configSales, ahora: AHORA });
  const texto = JSON.stringify(r.registrar_error);
  for (const m of payload.mensajes) assert.equal(texto.includes(m.texto), false);
});

// --- Disparador manual de calibración ---------------------------------------

/** Tres conversaciones del lote calibracion_v9 con la versión evaluador_ce_v1 (fixtures propios). */
function lote3() {
  return ['CONV-0301', 'CONV-0302', 'CONV-0303'].map((id, i) => {
    const p = JSON.parse(JSON.stringify(payload));
    p.conversation_id = id;
    const f = I.decidirIngesta({ payload: p, lote: 'calibracion_v9', config, ahora: new Date(AHORA.getTime() + i * 1000) }).fila;
    return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)]));
  });
}

const parametros = { lote: 'calibracion_v9', version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v2' };

test('manual: crea filas nuevas copiando columnas 2 a 14 y devuelve las llaves pendientes', () => {
  const filas = lote3();
  const r = I.planificarCalibracionManual({ ...parametros, filasConversaciones: filas, config, ahora: AHORA });
  assert.equal(r.valido, true, r.errores.join('; '));
  assert.equal(r.filas_nuevas.length, 3);
  assert.deepEqual(r.llaves_pendientes, ['CONV-0301|reglas_ce_v1|evaluador_ce_v2', 'CONV-0302|reglas_ce_v1|evaluador_ce_v2', 'CONV-0303|reglas_ce_v1|evaluador_ce_v2']);
  const nueva = r.filas_nuevas[0];
  assert.deepEqual(Object.keys(nueva), columnasDeHoja('conversaciones'));
  for (const col of I.COLUMNAS_DATOS_CONVERSACION) assert.equal(nueva[col], filas[0][col], col);
  assert.equal(nueva.version_prompt, 'evaluador_ce_v2');
  assert.equal(nueva.estado, 'pendiente');
  assert.equal(nueva.intentos, 0);
  assert.equal(nueva.recibido_en, filas[0].recibido_en, 'copia de la fila origen');
  assert.equal(nueva.actualizado_en, MARCA);
  assert.equal(nueva.id_evaluacion, '');
});

test('manual: no recrea llaves que ya existen y lista como pendientes solo las pendientes', () => {
  const filas = lote3();
  const ya = (id, estado) => ({ ...filas[0], conversation_id: id, llave_dedup: `${id}|reglas_ce_v1|evaluador_ce_v2`, version_prompt: 'evaluador_ce_v2', estado });
  filas.push(ya('CONV-0301', 'pendiente'), ya('CONV-0302', 'evaluada'));
  const r = I.planificarCalibracionManual({ ...parametros, filasConversaciones: filas, config, ahora: AHORA });
  assert.deepEqual(
    r.filas_nuevas.map((f) => f.conversation_id),
    ['CONV-0303']
  );
  // CONV-0301 ya estaba pendiente, CONV-0302 ya se evaluó (no se reevalúa), CONV-0303 es nueva.
  assert.deepEqual(r.llaves_pendientes, ['CONV-0301|reglas_ce_v1|evaluador_ce_v2', 'CONV-0303|reglas_ce_v1|evaluador_ce_v2']);
});

test('manual: se copia de la fila más antigua y se ignoran otros lotes', () => {
  const filas = lote3();
  const masAntigua = { ...filas[0], llave_dedup: 'CONV-0301|reglas_ce_v1|evaluador_ce_v0', version_prompt: 'evaluador_ce_v0', recibido_en: '2026-10-01T09:00:00-06:00', agente: 'Agente Original' };
  const otroLote = { ...filas[0], conversation_id: 'CONV-0999', lote: 'calibracion_v8', llave_dedup: 'CONV-0999|reglas_ce_v1|evaluador_ce_v1' };
  const r = I.planificarCalibracionManual({ ...parametros, filasConversaciones: [...filas, masAntigua, otroLote], config, ahora: AHORA });
  const nueva = r.filas_nuevas.find((f) => f.conversation_id === 'CONV-0301');
  assert.equal(nueva.agente, 'Agente Original');
  assert.equal(nueva.recibido_en, '2026-10-01T09:00:00-06:00');
  assert.equal(r.filas_nuevas.some((f) => f.conversation_id === 'CONV-0999'), false);
});

test('manual: parámetros inválidos o lote sin filas devuelven errores y no crean nada', () => {
  const filas = lote3();
  const mal = I.planificarCalibracionManual({ lote: 'x', version_reglas: 'sin_rubrica', version_prompt: 'v2', filasConversaciones: filas, config, ahora: AHORA });
  assert.equal(mal.valido, false);
  assert.equal(mal.errores.length, 3);
  assert.deepEqual(mal.filas_nuevas, []);
  const vacio = I.planificarCalibracionManual({ ...parametros, lote: 'calibracion_v7', filasConversaciones: filas, config, ahora: AHORA });
  assert.equal(vacio.valido, false);
  assert.match(vacio.errores[0], /calibracion_v7/);
});

test('manual: una conversación de otro tipo que la rúbrica pedida se omite con advertencia', () => {
  const filas = lote3();
  filas[1].tipo_interaccion = 'sales';
  const r = I.planificarCalibracionManual({ ...parametros, filasConversaciones: filas, config, ahora: AHORA });
  assert.equal(r.filas_nuevas.length, 2);
  assert.equal(r.advertencias.length, 1);
  assert.match(r.advertencias[0], /CONV-0302/);
});

// --- W4 Reproceso -----------------------------------------------------------

test('reproceso: reenvía mientras intentos <= reproceso_max_intentos (límite exacto)', () => {
  assert.equal(config.reproceso_max_intentos, 3);
  for (const intentos of ['1', '2', '3']) {
    const r = I.decidirReproceso(filaExistente('reproceso', { intentos }), config, AHORA);
    assert.equal(r.accion, 'reenviar', `intentos ${intentos}`);
    assert.equal(r.llave_dedup, LLAVE);
  }
});

test('reproceso: con intentos = max + 1 pasa a error, con log y alerta operativa', () => {
  const r = I.decidirReproceso(filaExistente('reproceso', { intentos: '4', lote: 'calibracion_v1' }), config, AHORA);
  assert.equal(r.accion, 'pasar_a_error');
  assert.deepEqual(r.actualizacion, { llave_dedup: LLAVE, estado: 'error', actualizado_en: MARCA });
  assert.equal(r.enviar_alerta, true);
  assert.equal(r.registrar_error.workflow, 'reproceso');
  assert.equal(r.registrar_error.tipo_error, 'fallo_api');
  assert.equal(r.registrar_error.conversation_id, 'CONV-0001');
  assert.equal(r.registrar_error.lote, 'calibracion_v1');
  // W4 solo escribe estado y actualizado_en: no toca intentos.
  assert.equal('intentos' in r.actualizacion, false);
});

test('reproceso: el límite sale de config (cambiarlo cambia la decisión)', () => {
  const fila = filaExistente('reproceso', { intentos: '2' });
  assert.equal(I.decidirReproceso(fila, { ...config, reproceso_max_intentos: 1 }, AHORA).accion, 'pasar_a_error');
  assert.equal(I.decidirReproceso(fila, { ...config, reproceso_max_intentos: 2 }, AHORA).accion, 'reenviar');
});

test('reproceso: filas que no están en reproceso se ignoran', () => {
  for (const estado of ['pendiente', 'en_evaluacion', 'evaluada', 'error']) {
    assert.equal(I.decidirReproceso(filaExistente(estado), config, AHORA).accion, 'ignorar', estado);
  }
});

test('reproceso: tipo_error alterno solo desde opciones', () => {
  const r = I.decidirReproceso(filaExistente('reproceso', { intentos: '9' }), config, AHORA, { tipo_error: 'respuesta_llm_invalida' });
  assert.equal(r.registrar_error.tipo_error, 'respuesta_llm_invalida');
});

// --- payloadDesdeFilaConversaciones (normalizacion.js) ----------------------

test('ida y vuelta: payload -> filaConversaciones -> payloadDesdeFilaConversaciones', () => {
  const { payloadDesdeFilaConversaciones } = require('../normalizacion');
  const fila = I.decidirIngesta({ payload, lote: 'demo', config, ahora: AHORA }).fila;
  const comoSheets = Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, String(v)]));
  assert.deepEqual(payloadDesdeFilaConversaciones(comoSheets), payload);
  // Sin caso: numero_caso vacío vuelve a null y escalado si -> true.
  const p = JSON.parse(JSON.stringify(payload));
  p.metadatos_caso.numero_caso = null;
  p.metadatos_caso.estado_caso = 'sin_caso';
  p.metadatos_caso.escalado = true;
  const f2 = I.decidirIngesta({ payload: p, lote: 'demo', config, ahora: AHORA }).fila;
  assert.deepEqual(payloadDesdeFilaConversaciones(Object.fromEntries(Object.entries(f2).map(([k, v]) => [k, String(v)]))), p);
});

test('payloadDesdeFilaConversaciones: JSON inválido da error sin copiar el contenido', () => {
  const { payloadDesdeFilaConversaciones } = require('../normalizacion');
  const fila = { ...filaExistente('pendiente'), mensajes_json: '{secreto@x.example' };
  assert.throws(() => payloadDesdeFilaConversaciones(fila), (e) => /mensajes_json/.test(e.message) && !e.message.includes('secreto'));
});

// --- W2: cambios de estado ----------------------------------------------------

test('actualizacionEntradaEvaluacion: en_evaluacion, intentos + 1 (texto de Sheets) y hora del sistema', () => {
  assert.deepEqual(I.actualizacionEntradaEvaluacion(filaExistente('pendiente', { intentos: '0' }), config, AHORA), { llave_dedup: LLAVE, estado: 'en_evaluacion', intentos: 1, actualizado_en: MARCA });
  assert.equal(I.actualizacionEntradaEvaluacion(filaExistente('reproceso', { intentos: '3' }), config, AHORA).intentos, 4);
  assert.equal(I.actualizacionEntradaEvaluacion(filaExistente('pendiente', { intentos: '' }), config, AHORA).intentos, 1);
});

test('actualizacionEstadoEvaluacion: evaluada con id, reproceso y error sin id', () => {
  const id = 'EVAL-CONV-0001-reglas_ce_v1-evaluador_ce_v1';
  assert.deepEqual(I.actualizacionEstadoEvaluacion(LLAVE, 'evaluada', config, AHORA, id), { llave_dedup: LLAVE, estado: 'evaluada', actualizado_en: MARCA, id_evaluacion: id });
  assert.deepEqual(I.actualizacionEstadoEvaluacion(LLAVE, 'reproceso', config, AHORA), { llave_dedup: LLAVE, estado: 'reproceso', actualizado_en: MARCA });
  assert.deepEqual(I.actualizacionEstadoEvaluacion(LLAVE, 'error', config, AHORA), { llave_dedup: LLAVE, estado: 'error', actualizado_en: MARCA });
});

test('actualizacionEstadoEvaluacion: rechaza estados fuera de evaluada|reproceso|error e id con otro estado', () => {
  for (const estado of ['pendiente', 'en_evaluacion', 'otro', undefined]) assert.throws(() => I.actualizacionEstadoEvaluacion(LLAVE, estado, config, AHORA), /estado inválido/);
  assert.throws(() => I.actualizacionEstadoEvaluacion(LLAVE, 'error', config, AHORA, 'EVAL-X'), /solo se escribe con el estado evaluada/);
  assert.throws(() => I.actualizacionEstadoEvaluacion(LLAVE, 'reproceso', config, AHORA, 'EVAL-X'), /solo se escribe/);
});

// --- Peor caso de W2 y filas atascadas ----------------------------------------

test('evaluacion_tiempo_maximo_min x 60 es mayor que el peor caso de duración de W2 (datos/config.csv)', () => {
  assert.equal(I.peorCasoDuracionEvaluacionSeg(config), 3600);
  assert.equal(config.evaluacion_tiempo_maximo_min * 60, 5400);
  assert.ok(config.evaluacion_tiempo_maximo_min * 60 > I.peorCasoDuracionEvaluacionSeg(config));
  // La fórmula sigue a la config.
  const mas = { ...config, reintentos_validacion_llm: 3 };
  assert.equal(I.peorCasoDuracionEvaluacionSeg(mas), 5 * 900);
  assert.ok(!(config.evaluacion_tiempo_maximo_min * 60 > I.peorCasoDuracionEvaluacionSeg({ ...mas, reintentos_conexion_api: 6 })), 'la prueba detecta una config inconsistente');
});

/** Fila en_evaluacion cuyo actualizado_en fue hace `minutos` minutos respecto de AHORA. */
function filaAtascada(minutos, cambios = {}) {
  const antes = new Date(AHORA.getTime() - minutos * 60000);
  return filaExistente('en_evaluacion', { actualizado_en: antes.toISOString(), intentos: '1', ...cambios });
}

test('en_evaluacion atascada (más del límite): marcar_atascada a reproceso, fallo_nodo, sin sumar intentos', () => {
  assert.equal(config.evaluacion_tiempo_maximo_min, 90);
  const r = I.decidirReproceso(filaAtascada(91), config, AHORA);
  assert.equal(r.accion, 'marcar_atascada');
  assert.equal(r.reenviar, true);
  assert.equal(r.enviar_alerta, false);
  assert.deepEqual(r.actualizacion, { llave_dedup: LLAVE, estado: 'reproceso', actualizado_en: MARCA });
  assert.equal('intentos' in r.actualizacion, false);
  assert.equal(r.registrar_error.tipo_error, 'fallo_nodo');
  assert.equal(r.registrar_error.workflow, 'reproceso');
  assert.equal(r.registrar_error.conversation_id, 'CONV-0001');
});

test('en_evaluacion: en el límite exacto o por debajo no está atascada (ignorar)', () => {
  assert.equal(I.decidirReproceso(filaAtascada(90), config, AHORA).accion, 'ignorar');
  assert.equal(I.decidirReproceso(filaAtascada(5), config, AHORA).accion, 'ignorar');
  // El límite sale de config.
  assert.equal(I.decidirReproceso(filaAtascada(40), { ...config, evaluacion_tiempo_maximo_min: 30 }, AHORA).accion, 'marcar_atascada');
  assert.equal(I.decidirReproceso(filaAtascada(40, { actualizado_en: 'no es fecha' }), config, AHORA).accion, 'ignorar');
});

test('en_evaluacion atascada con el límite de reproceso superado: pasar_a_error (con atascada = true)', () => {
  const justo = I.decidirReproceso(filaAtascada(120, { intentos: '3' }), config, AHORA);
  assert.equal(justo.accion, 'marcar_atascada', 'intentos = max todavía reenvía');
  const r = I.decidirReproceso(filaAtascada(120, { intentos: '4' }), config, AHORA);
  assert.equal(r.accion, 'pasar_a_error');
  assert.equal(r.atascada, true);
  assert.equal(r.enviar_alerta, true);
  assert.deepEqual(r.actualizacion, { llave_dedup: LLAVE, estado: 'error', actualizado_en: MARCA });
  assert.equal(r.registrar_error.tipo_error, 'fallo_nodo');
  assert.match(r.registrar_error.mensaje_error, /atascada/);
});

// --- W4 recoge conversaciones `pendiente` antiguas ---------------------------

/** Fila pendiente cuyo actualizado_en fue hace `minutos` minutos respecto de AHORA. */
function filaPendiente(minutos, cambios = {}) {
  const antes = new Date(AHORA.getTime() - minutos * 60000);
  return filaExistente('pendiente', { actualizado_en: antes.toISOString(), intentos: '0', ...cambios });
}
const conCalibracion = (valor) => ({ ...config, evaluar_al_ingerir_calibracion: valor });

test('pendiente vieja de demo: marcar_atascada con el mismo trato que en_evaluacion y mensaje que dice pendiente', () => {
  const r = I.decidirReproceso(filaPendiente(91), config, AHORA);
  assert.equal(r.accion, 'marcar_atascada');
  assert.equal(r.reenviar, true);
  assert.equal(r.enviar_alerta, false);
  assert.deepEqual(r.actualizacion, { llave_dedup: LLAVE, estado: 'reproceso', actualizado_en: MARCA });
  assert.equal(r.registrar_error.tipo_error, 'fallo_nodo');
  assert.match(r.registrar_error.mensaje_error, /en pendiente/);
  assert.doesNotMatch(r.registrar_error.mensaje_error, /en en_evaluacion/);
  assert.equal(r.registrar_error.detalle.estado_origen, 'pendiente');
  // La atascada en en_evaluacion conserva su mensaje.
  assert.match(I.decidirReproceso(filaAtascada(91), config, AHORA).registrar_error.mensaje_error, /en en_evaluacion/);
});

test('pendiente reciente o justo en el límite: ignorar; el límite sale de config', () => {
  assert.equal(I.decidirReproceso(filaPendiente(5), config, AHORA).accion, 'ignorar');
  assert.equal(I.decidirReproceso(filaPendiente(90), config, AHORA).accion, 'ignorar');
  assert.equal(I.decidirReproceso(filaPendiente(40), { ...config, evaluacion_tiempo_maximo_min: 30 }, AHORA).accion, 'marcar_atascada');
});

test('pendiente vieja de calibracion_v2: ignorar con evaluar_al_ingerir_calibracion = no, marcar_atascada con = si', () => {
  assert.equal(I.decidirReproceso(filaPendiente(500, { lote: 'calibracion_v2' }), conCalibracion(false), AHORA).accion, 'ignorar');
  assert.equal(I.decidirReproceso(filaPendiente(500, { lote: 'calibracion_v2' }), conCalibracion(true), AHORA).accion, 'marcar_atascada');
});

test('pendiente vieja de calibracion_v1: ignorar siempre, incluso con evaluar_al_ingerir_calibracion = si', () => {
  for (const valor of [false, true]) {
    assert.equal(I.decidirReproceso(filaPendiente(5000, { lote: 'calibracion_v1' }), conCalibracion(valor), AHORA).accion, 'ignorar', String(valor));
  }
});

test('pendiente con actualizado_en ilegible o lote desconocido: ignorar', () => {
  assert.equal(I.decidirReproceso(filaPendiente(500, { actualizado_en: 'no es fecha' }), config, AHORA).accion, 'ignorar');
  assert.equal(I.decidirReproceso(filaPendiente(500, { lote: 'otro' }), config, AHORA).accion, 'ignorar');
});

test('pendiente vieja que superó reproceso_max_intentos: pasar_a_error como la atascada', () => {
  assert.equal(I.decidirReproceso(filaPendiente(120, { intentos: '3' }), config, AHORA).accion, 'marcar_atascada');
  const r = I.decidirReproceso(filaPendiente(120, { intentos: '4' }), config, AHORA);
  assert.equal(r.accion, 'pasar_a_error');
  assert.equal(r.atascada, true);
  assert.equal(r.enviar_alerta, true);
  assert.deepEqual(r.actualizacion, { llave_dedup: LLAVE, estado: 'error', actualizado_en: MARCA });
  assert.equal(r.registrar_error.tipo_error, 'fallo_nodo');
  assert.match(r.registrar_error.mensaje_error, /atascada en pendiente/);
});
