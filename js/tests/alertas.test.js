const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const A = require('../alertas');
const R = require('../registro_errores');
const S = require('../simulador');
const I = require('../ingesta');
const { marcaTiempoSistema, evaluarAlertaCostoEvaluacion, evaluarAlertaCostoLote } = require('../costo');
const { configCE, leerJSON } = require('./ayudas');
const { columnasDeHoja } = require('./columnas_contrato');

const config = configCE();
const AHORA = new Date('2026-10-21T16:02:11Z'); // 10:02:11 local (-06:00)
// El ejemplo del contrato trae un crítico detectado; aquí se parte de una copia SIN críticos detectados.
const evaluacionEjemplo = leerJSON('contrato/ejemplos/evaluacion_ejemplo.json');
for (const c of evaluacionEjemplo.criterios) {
  if (c.tipo_criterio === 'critico') {
    c.resultado = 'no_detectado';
    c.evidencia = { mensajes: [], dato: 'sin evidencia' };
  }
}

/** Copia del ejemplo con errores críticos detectados (evidencia con datos sin enmascarar a propósito). */
function evaluacionConCriticos(lote = 'demo', criticos = [['critico.abandono', [5, 7], 'El cliente escribió en el mensaje 5 y no hubo respuesta']]) {
  const e = JSON.parse(JSON.stringify(evaluacionEjemplo));
  e.lote = lote;
  e.agente = 'Laura Méndez';
  for (const [id, mensajes, dato] of criticos) {
    const c = e.criterios.find((x) => x.id_criterio === id);
    c.resultado = 'detectado';
    c.evidencia = { mensajes, dato };
  }
  return e;
}

function enumDelGlosario(nombre) {
  const texto = fs.readFileSync(path.join(__dirname, '..', '..', 'contrato', 'glosario.md'), 'utf8');
  const linea = texto.split('\n').find((l) => l.startsWith(`| \`${nombre}\` |`));
  return [...linea.split('|')[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
}

// --- Contrato y copias duplicadas ------------------------------------------------

test('columnas de alertas y enumeraciones coinciden con el contrato', () => {
  assert.deepEqual(A.COLUMNAS_ALERTAS, columnasDeHoja('alertas'));
  assert.equal(A.COLUMNAS_ALERTAS.length, 17);
  assert.deepEqual(A.TIPOS_ALERTA, enumDelGlosario('tipo_alerta'));
  assert.deepEqual(A.MODOS_ENVIO, enumDelGlosario('modo_envio'));
});

test('marcaTiempoSistema duplicada es igual a la de costo.js (varias fechas y zonas)', () => {
  const fechas = ['2026-01-15T05:59:59Z', '2026-10-21T16:02:11Z', '2026-10-25T08:30:00Z', '2026-04-05T12:00:00.789Z', '2026-12-31T23:59:59Z', '2027-03-01T00:00:00Z'];
  const zonas = ['America/Mexico_City', 'UTC', 'America/Bogota', 'Asia/Kolkata'];
  const copias = [R.marcaTiempoSistema, A.marcaTiempoSistema, S.marcaTiempoSistema, I.marcaTiempoSistema];
  for (const f of fechas) {
    for (const z of zonas) {
      const esperado = marcaTiempoSistema(new Date(f), z);
      for (const copia of copias) assert.equal(copia(new Date(f), z), esperado, `${f} ${z}`);
    }
  }
});

test('limpiarTexto duplicada en alertas.js se comporta igual que la de registro_errores.js', () => {
  const entradas = [
    'correo ana@x.example rfc GOAJ850314K21 tel 5551234501',
    'bot 123456789:AAFakeTokenFakeTokenFakeTokenFake12',
    'Bearer abc123 api_key=ZZZ',
    'a\n\nb   c',
    '',
    null,
    'x '.repeat(400),
  ];
  for (const e of entradas) {
    assert.equal(A.limpiarTexto(e), R.limpiarTexto(e));
    assert.equal(A.limpiarTexto(e, 40), R.limpiarTexto(e, 40));
  }
});

test('id_alerta: formato ALR-AAAAMMDD-HHMMSS-nnn (ejemplo del glosario)', () => {
  assert.equal(A.generarIdAlerta(AHORA, config.zona_horaria, 1), 'ALR-20261021-100211-001');
  assert.throws(() => A.generarIdAlerta(AHORA, config.zona_horaria, 0), /consecutivo/);
});

// --- Modo ------------------------------------------------------------------

test('modo de calidad: demo inmediato; cualquier otro lote, resumen_lote (desde config)', () => {
  assert.equal(A.modoAlertaCalidad('demo', config), 'inmediato');
  assert.equal(A.modoAlertaCalidad('calibracion_v1', config), 'resumen_lote');
  assert.equal(A.modoAlertaCalidad('calibracion_v7', config), 'resumen_lote');
  // Cambiar config cambia el comportamiento: nada fijo en el código.
  assert.equal(A.modoAlertaCalidad('demo', { ...config, alerta_calidad_modo_lote_demo: 'resumen_lote' }), 'resumen_lote');
  assert.throws(() => A.modoAlertaCalidad('demo', { ...config, alerta_calidad_modo_lote_demo: 'cada_hora' }), /modo de alerta/);
});

// --- Textos ----------------------------------------------------------------

test('texto operativo: workflow, nodo, tipo de error, conversación y detalle limpio', () => {
  const t = A.textoAlertaOperativa({
    workflow: 'ingesta',
    nodo: 'Validar payload',
    tipo_error: 'payload_invalido',
    mensaje_error: 'Falta agente para ana@x.example',
    conversation_id: 'CONV-0001',
    lote: 'demo',
    id_error: 'ERR-20261021-100211-001',
  });
  for (const parte of ['ALERTA OPERATIVA', 'Workflow: ingesta', 'Nodo: Validar payload', 'Tipo de error: payload_invalido', 'CONV-0001', 'lote demo', 'ERR-20261021-100211-001']) {
    assert.ok(t.includes(parte), parte);
  }
  assert.equal(t.includes('@'), false);
});

test('texto operativo sin conversación omite la línea', () => {
  const t = A.textoAlertaOperativa({ workflow: 'errores', tipo_error: 'fallo_nodo', mensaje_error: 'x' });
  assert.equal(t.includes('Conversación'), false);
  assert.equal(t.includes('Nodo'), false);
});

test('texto de calidad: ID, agente, tipo de error, números de mensaje y evidencia enmascarada', () => {
  const t = A.textoAlertaCalidad({
    conversation_id: 'CONV-0001',
    lote: 'demo',
    agente: 'Laura Méndez',
    id_criterio: 'critico.confidencialidad',
    mensajes: [4, 6],
    evidencia: 'El agente dijo [EMAIL_1] y también julieta@abarrotesluna.example',
  });
  for (const parte of ['CONV-0001', 'Agente: Laura Méndez', 'Error: critico.confidencialidad', 'Mensaje(s): 4, 6', '[EMAIL_1]']) assert.ok(t.includes(parte), parte);
  assert.equal(t.includes('julieta@'), false, 'la evidencia se vuelve a limpiar');
});

test('texto de costo por evaluación y por lote', () => {
  const ev = A.textoAlertaCosto({ ambito: 'evaluacion', conversation_id: 'CONV-0001', lote: 'demo', valor_observado: 0.012, umbral: 0.01 });
  assert.ok(ev.includes('evaluación') && ev.includes('CONV-0001') && ev.includes('0.012') && ev.includes('0.01'));
  const lote = A.textoAlertaCosto({ ambito: 'lote', lote: 'calibracion_v1', valor_observado: 0.3, umbral: 0.25 });
  assert.ok(lote.includes('lote') && lote.includes('Lote: calibracion_v1') && lote.includes('0.3') && lote.includes('0.25'));
  assert.equal(lote.includes('Conversación'), false);
});

test('texto de calibración: estructura y métrica del glosario', () => {
  const t = A.textoAlertaCalibracion({ nombre_metrica: 'acuerdo', valor_observado: 0.72, umbral: 0.8, lote: 'calibracion_v1', version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v1' });
  for (const parte of ['ALERTA DE CALIBRACIÓN', 'Lote: calibracion_v1', 'reglas_ce_v1', 'evaluador_ce_v1', 'Métrica: acuerdo', '0.72', '0.8']) assert.ok(t.includes(parte), parte);
  assert.throws(() => A.textoAlertaCalibracion({ nombre_metrica: 'inventada', valor_observado: 1, umbral: 1 }), /glosario/);
});

// --- Calidad ---------------------------------------------------------------

test('erroresCriticosDeEvaluacion toma solo los críticos detectados', () => {
  assert.deepEqual(A.erroresCriticosDeEvaluacion(evaluacionEjemplo), [], 'sin críticos detectados');
  const e = evaluacionConCriticos('demo', [
    ['critico.abandono', [5, 7], 'sin respuesta al mensaje 5'],
    ['critico.mala_actitud', [9], 'tono despectivo'],
  ]);
  const errores = A.erroresCriticosDeEvaluacion(e);
  assert.equal(errores.length, 2);
  assert.deepEqual(errores[0], { conversation_id: e.conversation_id, lote: 'demo', agente: 'Laura Méndez', id_criterio: 'critico.abandono', mensajes: [5, 7], evidencia: 'sin respuesta al mensaje 5' });
});

test('lote demo: una alerta inmediata por error crítico, nada que acumular', () => {
  const e = evaluacionConCriticos('demo', [
    ['critico.abandono', [5], 'sin respuesta'],
    ['critico.mala_actitud', [9], 'tono despectivo'],
  ]);
  const r = A.prepararAlertasCalidad(e, config);
  assert.equal(r.modo_envio, 'inmediato');
  assert.equal(r.envios.length, 2);
  assert.deepEqual(r.acumular, []);
  assert.equal(r.envios[0].tipo_alerta, 'calidad');
  assert.equal(r.envios[0].id_criterio, 'critico.abandono');
  assert.ok(r.envios[0].texto.includes(e.conversation_id));
});

test('lote de calibración: nada se envía de inmediato, todo se acumula para el resumen', () => {
  const e = evaluacionConCriticos('calibracion_v1', [['critico.abandono', [5], 'sin respuesta']]);
  const r = A.prepararAlertasCalidad(e, config);
  assert.equal(r.modo_envio, 'resumen_lote');
  assert.deepEqual(r.envios, []);
  assert.equal(r.acumular.length, 1);
});

test('sin críticos no hay alertas en ningún modo', () => {
  assert.deepEqual(A.prepararAlertasCalidad({ ...evaluacionEjemplo, lote: 'demo' }, config).envios, []);
  assert.deepEqual(A.prepararAlertasCalidad({ ...evaluacionEjemplo, lote: 'calibracion_v1' }, config).acumular, []);
});

test('resumen del lote: agrupa errores, cuenta conversaciones y respeta el límite de Telegram', () => {
  const errores = [
    { conversation_id: 'CONV-0101', lote: 'calibracion_v1', agente: 'Ana', id_criterio: 'critico.abandono', mensajes: [5], evidencia: 'sin respuesta' },
    { conversation_id: 'CONV-0101', lote: 'calibracion_v1', agente: 'Ana', id_criterio: 'critico.mala_actitud', mensajes: [9, 10], evidencia: 'tono despectivo' },
    { conversation_id: 'CONV-0102', lote: 'calibracion_v1', agente: 'Beto', id_criterio: 'critico.no_genera_caso', mensajes: [], evidencia: 'sin número de caso' },
  ];
  const r = A.armarResumenCalidadLote(errores, 'calibracion_v1');
  assert.equal(r.enviar, true);
  assert.equal(r.total_errores, 3);
  assert.equal(r.total_conversaciones, 2);
  for (const parte of ['RESUMEN DE CALIDAD DEL LOTE calibracion_v1', '3 en 2 conversación', 'CONV-0101 | Ana | critico.abandono', 'mensaje(s) 9, 10', 'CONV-0102 | Beto | critico.no_genera_caso | mensaje(s) n/a']) {
    assert.ok(r.texto.includes(parte), parte);
  }
  const muchos = Array.from({ length: 200 }, (_, i) => ({ ...errores[0], conversation_id: `CONV-${String(1000 + i)}`, evidencia: 'x'.repeat(200) }));
  const largo = A.armarResumenCalidadLote(muchos, 'calibracion_v2');
  assert.ok(largo.texto.length <= A.LIMITE_TELEGRAM);
  assert.match(largo.texto, /\.\.\. y [0-9]+ más/);
  assert.equal(largo.total_errores, 200);
});

test('resumen sin errores: no se envía nada', () => {
  assert.equal(A.armarResumenCalidadLote([], 'calibracion_v1').enviar, false);
});

// --- Costo y calibración ---------------------------------------------------

test('alerta de costo por evaluación usa el resultado de evaluarAlertaCostoEvaluacion', () => {
  const dispara = evaluarAlertaCostoEvaluacion(0.05, config); // umbral = 2 x 0.005 = 0.01
  const a = A.armarAlertaCosto(dispara, { ambito: 'evaluacion', conversation_id: 'CONV-0001', lote: 'demo' });
  assert.equal(a.tipo_alerta, 'costo');
  assert.equal(a.valor_observado, 0.05);
  assert.equal(a.umbral, 0.01);
  assert.equal(a.conversation_id, 'CONV-0001');
  assert.ok(a.texto.includes('0.05'));
  assert.equal(A.armarAlertaCosto(evaluarAlertaCostoEvaluacion(0.01, config), { ambito: 'evaluacion' }), null, 'en el límite exacto no dispara');
  assert.equal(A.armarAlertaCosto(evaluarAlertaCostoEvaluacion(null, config), { ambito: 'evaluacion' }), null, 'no evaluable');
});

test('alerta de costo por lote usa evaluarAlertaCostoLote y no lleva conversación', () => {
  const r = evaluarAlertaCostoLote([0.1, 0.1, 0.1], config); // 0.30 > 0.25
  const a = A.armarAlertaCosto(r, { ambito: 'lote', conversation_id: 'CONV-0001', lote: 'calibracion_v1' });
  assert.equal(a.conversation_id, '');
  assert.equal(a.valor_observado, 0.3);
  assert.equal(a.umbral, 0.25);
  assert.equal(A.armarAlertaCosto(evaluarAlertaCostoLote([0.1, null], config), { ambito: 'lote' }), null);
  assert.equal(A.armarAlertaCosto(evaluarAlertaCostoLote([0.1], config), { ambito: 'lote' }), null);
});

// --- Fila de alertas -------------------------------------------------------

test('estadoEnvio: ok de Telegram -> enviada; cualquier otra cosa -> fallida', () => {
  assert.equal(A.estadoEnvio({ ok: true, result: {} }), 'enviada');
  assert.equal(A.estadoEnvio({ ok: false }), 'fallida');
  assert.equal(A.estadoEnvio({ error: { message: 'x' } }), 'fallida');
  assert.equal(A.estadoEnvio(undefined), 'fallida');
  assert.equal(A.estadoEnvio(null), 'fallida');
});

test('fila de alerta de calidad: 17 columnas, mensajes con | y estado según el envío', () => {
  const e = evaluacionConCriticos('demo', [['critico.abandono', [5, 7], 'sin respuesta']]);
  const alerta = A.prepararAlertasCalidad(e, config).envios[0];
  const fila = A.filaAlertas(alerta, { ok: true }, config, AHORA, 2);
  assert.deepEqual(Object.keys(fila), columnasDeHoja('alertas'));
  assert.equal(fila.id_alerta, 'ALR-20261021-100211-002');
  assert.equal(fila.enviada_en, '2026-10-21T10:02:11-06:00');
  assert.equal(fila.tipo_alerta, 'calidad');
  assert.equal(fila.modo_envio, 'inmediato');
  assert.equal(fila.workflow, 'evaluacion');
  assert.equal(fila.conversation_id, e.conversation_id);
  assert.equal(fila.agente, 'Laura Méndez');
  assert.equal(fila.id_criterio, 'critico.abandono');
  assert.equal(fila.mensajes, '5|7');
  assert.equal(fila.nombre_metrica, '');
  assert.equal(fila.valor_observado, '');
  assert.equal(fila.destinatario, config.telegram_destinatario);
  assert.equal(fila.estado_envio, 'enviada');
  assert.equal(A.filaAlertas(alerta, { error: 'x' }, config, AHORA).estado_envio, 'fallida');
});

test('fila del resumen de lote: modo resumen_lote y conversation_id vacío', () => {
  const r = A.armarResumenCalidadLote([{ conversation_id: 'CONV-0101', agente: 'Ana', id_criterio: 'critico.abandono', mensajes: [5], evidencia: 'x' }], 'calibracion_v1');
  const fila = A.filaAlertas({ tipo_alerta: 'calidad', modo_envio: 'resumen_lote', workflow: 'evaluacion', lote: 'calibracion_v1', texto: r.texto }, { ok: true }, config, AHORA);
  assert.equal(fila.modo_envio, 'resumen_lote');
  assert.equal(fila.conversation_id, '');
  assert.equal(fila.lote, 'calibracion_v1');
  assert.equal(fila.texto_enviado, r.texto);
});

test('filas de costo, operativa y calibración: columnas propias de cada tipo', () => {
  const costo = A.armarAlertaCosto(evaluarAlertaCostoEvaluacion(0.05, config), { ambito: 'evaluacion', conversation_id: 'CONV-0001', lote: 'demo' });
  const fCosto = A.filaAlertas(costo, { ok: true }, config, AHORA);
  assert.equal(fCosto.valor_observado, 0.05);
  assert.equal(fCosto.umbral, 0.01);
  assert.equal(fCosto.agente, '');
  assert.equal(fCosto.id_criterio, '');

  const op = A.armarAlertaOperativa({ workflow: 'ingesta', nodo: 'n', tipo_error: 'payload_invalido', mensaje_error: 'm', conversation_id: 'CONV-0001', lote: 'demo' });
  const fOp = A.filaAlertas(op, { ok: false }, config, AHORA);
  assert.equal(fOp.tipo_alerta, 'operativa');
  assert.equal(fOp.modo_envio, 'inmediato');
  assert.equal(fOp.estado_envio, 'fallida');
  assert.equal(fOp.valor_observado, '');

  const cal = A.armarAlertaCalibracion({ nombre_metrica: 'diferencia_promedio_nota', valor_observado: 7.5, umbral: 5, lote: 'calibracion_v1', version_reglas: 'reglas_ce_v1', version_prompt: 'evaluador_ce_v1' });
  const fCal = A.filaAlertas(cal, { ok: true }, config, AHORA);
  assert.equal(fCal.nombre_metrica, 'diferencia_promedio_nota');
  assert.equal(fCal.conversation_id, '');
  assert.equal(fCal.workflow, 'metricas');
  assert.equal(fCal.valor_observado, 7.5);
});

test('filaAlertas rechaza valores fuera del glosario', () => {
  const base = { tipo_alerta: 'operativa', modo_envio: 'inmediato', workflow: 'ingesta', texto: 't' };
  assert.throws(() => A.filaAlertas({ ...base, tipo_alerta: 'otra' }, { ok: true }, config, AHORA), /tipo_alerta/);
  assert.throws(() => A.filaAlertas({ ...base, modo_envio: 'diario' }, { ok: true }, config, AHORA), /modo_envio/);
  assert.throws(() => A.filaAlertas({ ...base, workflow: 'x' }, { ok: true }, config, AHORA), /workflow/);
  assert.throws(() => A.filaAlertas({ ...base, tipo_alerta: 'calibracion', nombre_metrica: 'x' }, { ok: true }, config, AHORA), /nombre_metrica/);
});

// --- No reenviar alertas de calidad ya enviadas --------------------------------

const fila = (cambios) => ({ tipo_alerta: 'calidad', conversation_id: 'CONV-9005', id_criterio: 'critico.abandono', estado_envio: 'enviada', ...cambios });
const envioCalidad = (conv = 'CONV-9005', crit = 'critico.abandono') => ({ tipo_alerta: 'calidad', conversation_id: conv, id_criterio: crit, texto: 'x' });
const envioCosto = { tipo_alerta: 'costo', conversation_id: 'CONV-9005', texto: 'c' };

test('filtrarAlertasCalidadYaEnviadas: sin filas previas deja todo igual', () => {
  const envios = [envioCalidad(), envioCosto];
  for (const filas of [[], undefined, null]) {
    const r = A.filtrarAlertasCalidadYaEnviadas(envios, filas);
    assert.deepEqual(r.envios, envios);
    assert.equal(r.omitidas_ya_enviadas, 0);
  }
});

test('filtrarAlertasCalidadYaEnviadas: omite solo la pareja conversación + crítico ya enviada', () => {
  const r = A.filtrarAlertasCalidadYaEnviadas([envioCalidad()], [fila()]);
  assert.deepEqual(r, { envios: [], omitidas_ya_enviadas: 1 });
  // otro crítico, otra conversación y fila fallida: se envía
  assert.equal(A.filtrarAlertasCalidadYaEnviadas([envioCalidad()], [fila({ id_criterio: 'critico.otro' })]).envios.length, 1);
  assert.equal(A.filtrarAlertasCalidadYaEnviadas([envioCalidad()], [fila({ conversation_id: 'CONV-1' })]).envios.length, 1);
  const fallida = A.filtrarAlertasCalidadYaEnviadas([envioCalidad()], [fila({ estado_envio: 'fallida' })]);
  assert.equal(fallida.envios.length, 1);
  assert.equal(fallida.omitidas_ya_enviadas, 0);
  // una fila de costo con la misma conversación no cuenta
  assert.equal(A.filtrarAlertasCalidadYaEnviadas([envioCalidad()], [fila({ tipo_alerta: 'costo' })]).envios.length, 1);
});

test('filtrarAlertasCalidadYaEnviadas: la alerta de costo nunca se filtra', () => {
  const r = A.filtrarAlertasCalidadYaEnviadas([envioCalidad(), envioCosto], [fila(), fila({ tipo_alerta: 'costo', id_criterio: '' })]);
  assert.deepEqual(r.envios, [envioCosto]);
  assert.equal(r.omitidas_ya_enviadas, 1);
});

test('filtrarAlertasCalidadYaEnviadas: espacios y valores vacíos no truenan', () => {
  const sucias = [null, undefined, {}, fila({ conversation_id: '', id_criterio: '' }), fila({ conversation_id: ' CONV-9005 ', id_criterio: ' critico.abandono ', estado_envio: ' enviada ' })];
  const r = A.filtrarAlertasCalidadYaEnviadas([envioCalidad(), envioCalidad('CONV-9005 ', ' critico.abandono')], sucias);
  assert.equal(r.envios.length, 0);
  assert.equal(r.omitidas_ya_enviadas, 2);
  assert.deepEqual(A.filtrarAlertasCalidadYaEnviadas(undefined, undefined), { envios: [], omitidas_ya_enviadas: 0 });
});

test('alertasDeEvaluacion con filas previas: omite la calidad repetida y conserva el costo', () => {
  const e = evaluacionConCriticos('demo', [['critico.abandono', [5], 'sin respuesta']]);
  const filas = [fila({ conversation_id: e.conversation_id })];
  const r = A.alertasDeEvaluacion(e, evaluarAlertaCostoEvaluacion(0.05, config), config, filas);
  assert.deepEqual(r.envios.map((x) => x.tipo_alerta), ['costo']);
  assert.equal(r.omitidas_ya_enviadas, 1);
  // en modo resumen_lote no se toca `acumular`
  const l = evaluacionConCriticos('calibracion_v1', [['critico.abandono', [5], 'sin respuesta']]);
  const rl = A.alertasDeEvaluacion(l, evaluarAlertaCostoEvaluacion(0.001, config), config, [fila({ conversation_id: l.conversation_id })]);
  assert.equal(rl.acumular.length, 1);
});

// --- alertasDeEvaluacion y cierreDeLote --------------------------------------

test('alertasDeEvaluacion: calidad inmediata (demo) y costo si dispara', () => {
  const e = evaluacionConCriticos('demo', [['critico.abandono', [5], 'sin respuesta']]);
  const dispara = evaluarAlertaCostoEvaluacion(0.05, config);
  const r = A.alertasDeEvaluacion(e, dispara, config);
  assert.deepEqual(r.envios.map((x) => x.tipo_alerta), ['calidad', 'costo']);
  assert.equal(r.envios[1].conversation_id, e.conversation_id);
  assert.equal(r.envios[1].lote, 'demo');
  assert.deepEqual(r.acumular, []);
  const sinCosto = A.alertasDeEvaluacion(e, evaluarAlertaCostoEvaluacion(0.001, config), config);
  assert.deepEqual(sinCosto.envios.map((x) => x.tipo_alerta), ['calidad']);
});

test('alertasDeEvaluacion: en lote de calibración acumula la calidad y solo envía el costo', () => {
  const e = evaluacionConCriticos('calibracion_v1', [['critico.abandono', [5], 'sin respuesta']]);
  const r = A.alertasDeEvaluacion(e, evaluarAlertaCostoEvaluacion(0.05, config), config);
  assert.deepEqual(r.envios.map((x) => x.tipo_alerta), ['costo']);
  assert.equal(r.acumular.length, 1);
  assert.deepEqual(A.alertasDeEvaluacion({ ...evaluacionEjemplo, lote: 'demo' }, evaluarAlertaCostoEvaluacion(0.001, config), config), { envios: [], acumular: [], omitidas_ya_enviadas: 0 });
});

test('la copia de evaluarAlertaCostoLote en alertas.js da lo mismo que la de costo.js', () => {
  const casos = [[], [0.1, 0.1], [0.1, 0.1, 0.1], [0.25], [0.2500001], [0.1, null], [0.1, 'x']];
  for (const costos of casos) assert.deepEqual(A.alertaCostoLoteCopia(costos, config), evaluarAlertaCostoLote(costos, config), JSON.stringify(costos));
  const sinTope = { ...config, tope_costo_lote_usd: 'pendiente_fase_1' };
  assert.deepEqual(A.alertaCostoLoteCopia([0.1], sinTope), evaluarAlertaCostoLote([0.1], sinTope));
});

test('cierreDeLote: resumen de calidad y alerta de costo del lote, con la forma que espera filaAlertas', () => {
  const err = (id, c) => ({ conversation_id: id, lote: 'calibracion_v1', agente: 'Ana', id_criterio: c, mensajes: [5], evidencia: 'x' });
  const resultados = [
    { acumular: [err('CONV-0101', 'critico.abandono')], costo_usd: 0.1 },
    { acumular: [], costo_usd: 0.1 },
    { acumular: [err('CONV-0103', 'critico.mala_actitud')], costo_usd: 0.1 },
    {}, // terminó en error: sin campos
    { acumular: [], costo_usd: null }, // precios por_verificar: se ignora
  ];
  const r = A.cierreDeLote(resultados, 'calibracion_v1', config);
  assert.deepEqual(r.envios.map((x) => x.tipo_alerta), ['calidad', 'costo']);
  const [resumen, costo] = r.envios;
  assert.equal(resumen.modo_envio, 'resumen_lote');
  assert.equal(resumen.workflow, 'evaluacion');
  assert.equal(resumen.lote, 'calibracion_v1');
  assert.match(resumen.texto, /2 en 2 conversación/);
  assert.equal(costo.valor_observado, 0.3);
  assert.equal(costo.umbral, 0.25);
  assert.equal(costo.conversation_id, '');
  // El resumen sirve tal cual a filaAlertas.
  const fila = A.filaAlertas(resumen, { ok: true }, config, AHORA);
  assert.equal(fila.modo_envio, 'resumen_lote');
  assert.equal(fila.conversation_id, '');
  assert.equal(fila.lote, 'calibracion_v1');
  assert.equal(A.filaAlertas(costo, { ok: true }, config, AHORA).tipo_alerta, 'costo');
});

test('cierreDeLote: sin errores ni costo excedido no envía nada; entradas vacías no fallan', () => {
  assert.deepEqual(A.cierreDeLote([{ acumular: [], costo_usd: 0.01 }, {}], 'calibracion_v1', config), { envios: [] });
  assert.deepEqual(A.cierreDeLote([], 'calibracion_v1', config), { envios: [] });
  assert.deepEqual(A.cierreDeLote(undefined, 'calibracion_v1', config), { envios: [] });
  const soloCosto = A.cierreDeLote([{ acumular: [], costo_usd: 0.3 }], 'calibracion_v1', config);
  assert.deepEqual(soloCosto.envios.map((x) => x.tipo_alerta), ['costo']);
});

test('cierrePorLotes: agrupa por lote y aplica cierreDeLote por grupo (W4 mezcla lotes)', () => {
  const err = (id, lote, c) => ({ conversation_id: id, lote, agente: 'Ana', id_criterio: c, mensajes: [5], evidencia: 'x' });
  const resultados = [
    { lote: 'calibracion_v1', acumular: [err('CONV-0101', 'calibracion_v1', 'critico.abandono')], costo_usd: 0.1 },
    { lote: 'calibracion_v2', acumular: [], costo_usd: 0.01 },
    { lote: 'calibracion_v1', acumular: [], costo_usd: 0.1 },
    { lote: 'calibracion_v1', acumular: [], costo_usd: 0.1 },
    { lote: 'calibracion_v2', acumular: [err('CONV-0201', 'calibracion_v2', 'critico.mala_actitud')], costo_usd: 0.01 },
    { acumular: [err('CONV-0999', 'x', 'critico.abandono')], costo_usd: 9 }, // sin lote: se omite
  ];
  const r = A.cierrePorLotes(resultados, config);
  assert.deepEqual(r.envios.map((e) => `${e.tipo_alerta}:${e.lote}`), ['calidad:calibracion_v1', 'costo:calibracion_v1', 'calidad:calibracion_v2']);
  assert.match(r.envios[0].texto, /CONV-0101/);
  assert.equal(r.envios[0].texto.includes('CONV-0201'), false, 'cada resumen solo trae su lote');
  assert.equal(r.envios[1].valor_observado, 0.3);
  assert.match(r.envios[2].texto, /CONV-0201/);
  // Igual que llamar a cierreDeLote por lote.
  const solo = A.cierreDeLote(resultados.filter((x) => x.lote === 'calibracion_v2'), 'calibracion_v2', config);
  assert.deepEqual(r.envios.filter((e) => e.lote === 'calibracion_v2'), solo.envios);
  assert.deepEqual(A.cierrePorLotes([], config), { envios: [] });
  assert.deepEqual(A.cierrePorLotes(undefined, config), { envios: [] });
});
