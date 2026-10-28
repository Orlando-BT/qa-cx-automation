/**
 * log_errores: exactamente las 11 columnas del contrato y nunca texto de la conversación,
 * correos ni RFC (sheets.md: mensaje_error y detalle_json sin datos personales).
 * Se sigue el orden de llamadas del pegamento (workflows/pegamento/error_*.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../registro_errores');
const { validarPayload } = require('../validador_payload');
const { configCE, DATOS } = require('./ayudas');
const { columnasDeHoja } = require('./columnas_contrato');
const { payloadBueno } = require('./fixtures');

const config = configCE();
const AHORA = new Date('2026-10-21T16:02:11Z');
const SECRETO = 'TEXTO-SECRETO-ZZZ';
const CORREO = 'persona.ficticia@ejemplo.example';
const RFC = 'XAXX010101000';

function payloadConDatos() {
  const p = payloadBueno();
  p.mensajes = p.mensajes.map((m) => ({ ...m, texto: `${SECRETO} ${CORREO} ${RFC} ${m.texto}` }));
  return p;
}

function verificarFila(fila) {
  assert.deepEqual(Object.keys(fila), columnasDeHoja('log_errores'));
  assert.equal(Object.keys(fila).length, 11);
  for (const [columna, valor] of Object.entries(fila)) {
    const texto = String(valor);
    for (const prohibido of [SECRETO, CORREO, RFC]) assert.ok(!texto.includes(prohibido), `${columna} contiene ${prohibido}`);
  }
}

test('filaLogErrores devuelve exactamente las 11 columnas de sheets.md, sin claves extra', () => {
  const fila = R.filaLogErrores({ workflow: 'ingesta', nodo: 'N', tipo_error: 'fallo_nodo', mensaje_error: 'x', alerta_enviada: true, extra: 1, payload: { a: 1 } }, config, AHORA);
  assert.deepEqual(Object.keys(fila), columnasDeHoja('log_errores'));
  assert.equal(fila.alerta_enviada, 'si');
  const sin = R.filaLogErrores({ workflow: 'ingesta', nodo: 'N', tipo_error: 'fallo_nodo', mensaje_error: 'x', alerta_enviada: false }, config, AHORA);
  assert.equal(sin.alerta_enviada, 'no');
});

test('payload_invalido (sin canal) con texto distintivo: la fila no filtra mensajes, correo ni RFC', () => {
  const p = payloadConDatos();
  delete p.canal;
  const v = validarPayload(p, { cuentas: DATOS.cuentas, config });
  assert.equal(v.valido, false);
  // Mismo armado que workflows/pegamento/error_payload_invalido.js.
  const registrar = {
    workflow: 'ingesta', nodo: 'Validar payload', tipo_error: 'payload_invalido',
    mensaje_error: `Payload inválido: ${v.errores.length} error(es) de validación`,
    conversation_id: p.conversation_id, lote: 'demo', tipo_interaccion: p.tipo_interaccion, detalle: { errores: v.errores },
  };
  const fila = R.filaLogErrores({ ...registrar, alerta_enviada: R.debeAlertar(registrar.tipo_error, config), consecutivo: 1 }, config, AHORA);
  verificarFila(fila);
  assert.ok(fila.detalle_json.includes('canal'));
  // Defensa de último recurso: aunque llegaran el payload o texto suelto en el detalle.
  const sucio = R.filaLogErrores({
    ...registrar,
    mensaje_error: `fallo con ${CORREO} y ${RFC}`,
    detalle: { errores: v.errores, payload: p, mensajes: p.mensajes, texto: SECRETO, nota: `correo ${CORREO} rfc ${RFC}` },
  }, config, AHORA);
  verificarFila(sucio);
});

test('fallo_api y respuesta_llm_invalida: la fila no filtra datos de la conversación', () => {
  const p = payloadConDatos();
  // error_http_evaluador_reproceso.js: solo motivo, código HTTP e intento.
  const api = R.filaLogErrores({
    workflow: 'evaluacion', nodo: 'OpenAI: evaluar conversación', tipo_error: 'fallo_api', mensaje_error: 'La API respondió con código HTTP 500',
    conversation_id: p.conversation_id, lote: 'demo', tipo_interaccion: p.tipo_interaccion, detalle: { codigo_http: 500, intento_conexion: 2 }, alerta_enviada: true,
  }, config, AHORA);
  verificarFila(api);
  // error_evaluador_error.js: detalle_log de validador_llm.js (más claves de contenido a propósito).
  const llm = R.filaLogErrores({
    workflow: 'evaluacion', nodo: 'JS-5 Validación de la respuesta', tipo_error: 'respuesta_llm_invalida',
    mensaje_error: 'Respuesta del evaluador inválida (validacion_agotada); la conversación queda en error para revisión manual',
    conversation_id: p.conversation_id, lote: 'demo', tipo_interaccion: p.tipo_interaccion,
    detalle: { tipo_error: 'respuesta_llm_invalida', causa: 'validacion_agotada', errores: [{ regla: 'tipo', ruta: '$.tema' }], payload: p, mensajes_json: p.mensajes }, alerta_enviada: true,
  }, config, AHORA);
  verificarFila(llm);
});
