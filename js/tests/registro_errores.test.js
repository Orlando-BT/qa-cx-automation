const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../registro_errores');
const { configCE } = require('./ayudas');
const { columnasDeHoja } = require('./columnas_contrato');

const config = configCE();
// 2026-10-21 10:02:11 en America/Mexico_City (-06:00) = 16:02:11 UTC.
const AHORA = new Date('2026-10-21T16:02:11Z');

/** Valores de una enumeración del glosario: fila `| `nombre` | `a`, `b` | ... |` de la sección 4. */
function enumDelGlosario(nombre) {
  const texto = fs.readFileSync(path.join(__dirname, '..', '..', 'contrato', 'glosario.md'), 'utf8');
  const linea = texto.split('\n').find((l) => l.startsWith(`| \`${nombre}\` |`));
  assert.ok(linea, `enumeración no encontrada: ${nombre}`);
  return [...linea.split('|')[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
}

test('columnas de log_errores y enumeraciones coinciden con el contrato', () => {
  assert.deepEqual(R.COLUMNAS_LOG_ERRORES, columnasDeHoja('log_errores'));
  assert.equal(R.COLUMNAS_LOG_ERRORES.length, 11);
  assert.deepEqual(R.TIPOS_ERROR, enumDelGlosario('tipo_error'));
  assert.deepEqual(R.WORKFLOWS, enumDelGlosario('workflow'));
});

test('id_error: formato ERR-AAAAMMDD-HHMMSS-nnn en la hora local (ejemplo del glosario)', () => {
  assert.equal(R.generarIdError(AHORA, config.zona_horaria, 1), 'ERR-20261021-100211-001');
  assert.equal(R.generarIdError(AHORA, config.zona_horaria, 42), 'ERR-20261021-100211-042');
  assert.match(R.generarIdError(AHORA, config.zona_horaria), /^ERR-[0-9]{8}-[0-9]{6}-[0-9]{3}$/);
});

test('el consecutivo debe ir de 1 a 999', () => {
  assert.throws(() => R.generarIdError(AHORA, config.zona_horaria, 0), /consecutivo/);
  assert.throws(() => R.generarIdError(AHORA, config.zona_horaria, 1000), /consecutivo/);
  assert.throws(() => R.generarIdError(AHORA, config.zona_horaria, 1.5), /consecutivo/);
  assert.equal(R.generarIdError(AHORA, config.zona_horaria, 999).endsWith('-999'), true);
});

test('limpiarTexto quita correos, RFC y teléfonos', () => {
  const t = R.limpiarTexto('Falló con julieta.gomez@abarrotesluna.example y RFC GOAJ850314K21, tel 55 1234 5501 o (55) 1234-5501 o 5551234501');
  assert.equal(t.includes('@'), false);
  assert.equal(t.includes('GOAJ'), false);
  assert.equal(/[0-9]{4}/.test(t), false, t);
  assert.match(t, /\[EMAIL\]/);
  assert.match(t, /\[RFC\]/);
  assert.match(t, /\[TELEFONO\]/);
});

test('limpiarTexto quita credenciales (todas son falsas, armadas para la prueba)', () => {
  const casos = [
    'bot 123456789:AAFakeTokenFakeTokenFakeTokenFake12 falló',
    'llave sk-FAKEFAKEFAKEFAKEFAKE1234 inválida',
    'cabecera Bearer abcDEF123456 rechazada',
    'api_key=FAKEVALOR123 en la petición',
    'x-api-key: FAKEVALOR123',
    '{"password":"secreto1"}',
    'cadena AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA larga',
  ];
  for (const c of casos) {
    const t = R.limpiarTexto(c);
    assert.match(t, /REDACTADO/, c);
    assert.equal(/AAFakeToken|FAKEFAKE|abcDEF|FAKEVALOR|secreto1|AAAAAAAAAAAAAAAA/.test(t), false, t);
  }
});

test('limpiarTexto: una sola línea, longitud máxima y valores vacíos', () => {
  assert.equal(R.limpiarTexto('a\n\n  b\tc'), 'a b c');
  const largo = R.limpiarTexto('x '.repeat(1000), 50);
  assert.equal(largo.length, 50);
  assert.equal(largo.endsWith('…'), true);
  assert.equal(R.limpiarTexto(null), '');
  assert.equal(R.limpiarTexto(undefined), '');
});

test('limpiarDetalle redacta credenciales, omite contenido de la conversación y limpia textos', () => {
  const d = R.limpiarDetalle({
    ruta: '$.mensajes[0]',
    mensaje: 'falta el campo para ana@x.example',
    api_key: 'FAKEVALOR123',
    Authorization: 'Bearer abc',
    mensajes: [{ texto: 'hola' }],
    payload: { x: 1 },
    anidado: { token_bot: 'zzz', numero: 5, lista: ['a@b.example'] },
  });
  assert.equal(d.api_key, '[REDACTADO]');
  assert.equal(d.Authorization, '[REDACTADO]');
  assert.equal(d.mensajes, '[OMITIDO]');
  assert.equal(d.payload, '[OMITIDO]');
  assert.equal(d.anidado.token_bot, '[REDACTADO]');
  assert.equal(d.anidado.numero, 5);
  assert.deepEqual(d.anidado.lista, ['[EMAIL]']);
  assert.equal(d.mensaje.includes('@'), false);
});

test('detalleComoJson: vacío si no hay detalle y aviso si es demasiado largo', () => {
  assert.equal(R.detalleComoJson(undefined), '');
  assert.equal(R.detalleComoJson(null), '');
  assert.deepEqual(JSON.parse(R.detalleComoJson({ a: 1 })), { a: 1 });
  const enorme = {};
  for (let i = 0; i < 49; i++) enorme[`k${i}`] = 'palabra '.repeat(70);
  const j = JSON.parse(R.detalleComoJson(enorme));
  assert.equal(j.truncado, true);
});

test('filaLogErrores: 11 columnas exactas, alerta_enviada en si/no y mensaje limpio', () => {
  const fila = R.filaLogErrores(
    {
      workflow: 'ingesta',
      nodo: 'Validar payload',
      tipo_error: 'payload_invalido',
      mensaje_error: 'Payload inválido para julieta.gomez@abarrotesluna.example',
      conversation_id: 'CONV-0001',
      lote: 'demo',
      tipo_interaccion: 'ce',
      detalle: { errores: [{ ruta: '$.agente', mensaje: 'requerido' }] },
      alerta_enviada: true,
    },
    config,
    AHORA
  );
  assert.deepEqual(Object.keys(fila), columnasDeHoja('log_errores'));
  assert.equal(fila.id_error, 'ERR-20261021-100211-001');
  assert.equal(fila.ocurrido_en, '2026-10-21T10:02:11-06:00');
  assert.equal(fila.alerta_enviada, 'si');
  assert.equal(fila.mensaje_error.includes('@'), false);
  assert.deepEqual(JSON.parse(fila.detalle_json).errores[0].ruta, '$.agente');
  const sin = R.filaLogErrores({ workflow: 'errores', nodo: 'n', tipo_error: 'fallo_nodo', mensaje_error: 'm' }, config, AHORA);
  assert.equal(sin.alerta_enviada, 'no');
  assert.equal(sin.conversation_id, '');
  assert.equal(sin.lote, '');
  assert.equal(sin.tipo_interaccion, '');
  assert.equal(sin.detalle_json, '');
});

test('filaLogErrores: tipo_error desconocido cae en fallo_nodo; workflow inválido lanza error', () => {
  const fila = R.filaLogErrores({ workflow: 'simulador', nodo: 'n', tipo_error: 'inventado', mensaje_error: 'm' }, config, AHORA);
  assert.equal(fila.tipo_error, 'fallo_nodo');
  assert.equal(JSON.parse(fila.detalle_json).tipo_error_original, 'inventado');
  assert.throws(() => R.filaLogErrores({ workflow: 'otro', nodo: 'n', tipo_error: 'fallo_nodo', mensaje_error: 'm' }, config, AHORA), /workflow inválido/);
});

test('filaLogErrores: campos opcionales con formato inválido quedan vacíos', () => {
  const fila = R.filaLogErrores({ workflow: 'ingesta', nodo: 'n', tipo_error: 'fallo_nodo', mensaje_error: 'm', conversation_id: 'x', lote: 'prueba', tipo_interaccion: 'otro' }, config, AHORA);
  assert.equal(fila.conversation_id, '');
  assert.equal(fila.lote, '');
  assert.equal(fila.tipo_interaccion, '');
});

test('workflowDesdeNombre y tipoErrorDesdeNodo', () => {
  assert.equal(R.workflowDesdeNombre('W1 Ingesta'), 'ingesta');
  assert.equal(R.workflowDesdeNombre('W2 Evaluación'), 'evaluacion');
  assert.equal(R.workflowDesdeNombre('W3 Métricas de calibración'), 'metricas');
  assert.equal(R.workflowDesdeNombre('W4 Reproceso'), 'reproceso');
  assert.equal(R.workflowDesdeNombre('Workflow de errores'), 'errores');
  assert.equal(R.workflowDesdeNombre('Algo distinto'), 'errores');
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.googleSheets', 'Guardar'), 'fallo_sheets');
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.telegram', 'Avisar'), 'fallo_telegram');
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.httpRequest', 'Llamar a OpenAI'), 'fallo_api');
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.code', 'JS-3'), 'fallo_nodo');
});

test('analizarErrorTrigger: forma estándar de n8n a campos de log_errores', () => {
  const d = R.analizarErrorTrigger({
    execution: { id: '77', error: { message: 'La hoja no responde (CONV-0007)', node: { name: 'Guardar evaluación', type: 'n8n-nodes-base.googleSheets' } }, lastNodeExecuted: 'Guardar evaluación' },
    workflow: { id: '5', name: 'W2 Evaluación' },
  });
  assert.equal(d.workflow, 'evaluacion');
  assert.equal(d.nodo, 'Guardar evaluación');
  assert.equal(d.tipo_error, 'fallo_sheets');
  assert.equal(d.conversation_id, 'CONV-0007');
  assert.equal(d.detalle.id_ejecucion, '77');
  const fila = R.filaLogErrores({ ...d, alerta_enviada: true }, config, AHORA);
  assert.equal(fila.workflow, 'evaluacion');
  assert.equal(R.analizarErrorTrigger({}, 'CONV-0009').conversation_id, 'CONV-0009');
  assert.equal(R.analizarErrorTrigger({}).mensaje_error, 'Error sin mensaje');
});

test('nombres definitivos de los workflows se mapean al enum', () => {
  const casos = { '00 Simulador': 'simulador', '01 Ingesta': 'ingesta', '02 Evaluación': 'evaluacion', '03 Métricas': 'metricas', '04 Reproceso': 'reproceso', '99 Errores': 'errores' };
  for (const [nombre, esperado] of Object.entries(casos)) assert.equal(R.workflowDesdeNombre(nombre), esperado, nombre);
});

// --- Errores de WE: reproceso, alertas, tipo marcado ---------------------------

const I = require('../ingesta');
const A = require('../alertas');
const LLAVE_PRUEBA = 'CONV-0007|reglas_ce_v1|evaluador_ce_v1';

const errorW2 = (mensaje, nodo = { name: 'JS-7 Scoring', type: 'n8n-nodes-base.code' }) => ({
  execution: { id: '9', error: { message: mensaje, node: nodo } },
  workflow: { name: '02 Evaluación' },
});

test('analizarErrorTrigger: falla de W2 con llave conocida trae la actualización a reproceso (forma de ingesta.js)', () => {
  const d = R.analizarErrorTrigger(errorW2('La hoja no responde'), '', { llave_dedup: LLAVE_PRUEBA, config, ahora: AHORA });
  assert.deepEqual(d.actualizacion_conversacion, I.actualizacionEstadoEvaluacion(LLAVE_PRUEBA, 'reproceso', config, AHORA));
  assert.deepEqual(d.actualizacion_conversacion, { llave_dedup: LLAVE_PRUEBA, estado: 'reproceso', actualizado_en: '2026-10-21T10:02:11-06:00' });
  assert.equal(d.conversation_id, 'CONV-0007');
  // La llave también se reconoce dentro del mensaje.
  const d2 = R.analizarErrorTrigger(errorW2(`Falló ${LLAVE_PRUEBA} en Sheets`), '', { config, ahora: AHORA });
  assert.equal(d2.actualizacion_conversacion.llave_dedup, LLAVE_PRUEBA);
});

test('analizarErrorTrigger: sin llave, sin config o fuera de W2 la actualización es null', () => {
  assert.equal(R.analizarErrorTrigger(errorW2('x'), 'CONV-0007', { config, ahora: AHORA }).actualizacion_conversacion, null);
  assert.equal(R.analizarErrorTrigger(errorW2('x'), '', { llave_dedup: LLAVE_PRUEBA }).actualizacion_conversacion, null);
  const ingesta = { ...errorW2('x'), workflow: { name: '01 Ingesta' } };
  assert.equal(R.analizarErrorTrigger(ingesta, '', { llave_dedup: LLAVE_PRUEBA, config, ahora: AHORA }).actualizacion_conversacion, null);
  assert.equal(R.analizarErrorTrigger({}).actualizacion_conversacion, null);
});

test('debeAlertar: formulario_invalido no alerta; sin_rubrica según config; el resto sí (registro y alertas dan lo mismo)', () => {
  for (const modulo of [R, A]) {
    assert.equal(modulo.debeAlertar('formulario_invalido', config), false);
    assert.equal(modulo.debeAlertar('tipo_interaccion_sin_rubrica', config), false, 'alerta_tipo_interaccion_sin_rubrica = no por defecto');
    assert.equal(modulo.debeAlertar('tipo_interaccion_sin_rubrica', { ...config, alerta_tipo_interaccion_sin_rubrica: true }), true);
    for (const tipo of R.TIPOS_ERROR.filter((t) => !['formulario_invalido', 'tipo_interaccion_sin_rubrica'].includes(t))) assert.equal(modulo.debeAlertar(tipo, config), true, tipo);
  }
});

test('filaLogErrores: formulario_invalido se registra con alerta_enviada = no aunque se pida si', () => {
  const fila = R.filaLogErrores({ workflow: 'simulador', nodo: 'Validar formulario', tipo_error: 'formulario_invalido', mensaje_error: 'El lote calibracion_v1 está congelado', lote: 'calibracion_v1', alerta_enviada: true }, config, AHORA);
  assert.equal(fila.tipo_error, 'formulario_invalido');
  assert.equal(fila.alerta_enviada, 'no');
  const normal = R.filaLogErrores({ workflow: 'ingesta', nodo: 'n', tipo_error: 'payload_invalido', mensaje_error: 'm', alerta_enviada: true }, config, AHORA);
  assert.equal(normal.alerta_enviada, 'si');
});

test('tipo marcado al inicio del mensaje: se extrae; sin marca, fallo_nodo', () => {
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.code', 'JS-7', '[evaluacion_sin_secciones_aplicables] todas las secciones quedaron no_aplica'), 'evaluacion_sin_secciones_aplicables');
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.code', 'JS-7', 'JS-7: falta el criterio apertura.saludo'), 'fallo_nodo');
  // Una marca que no es del glosario se ignora.
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.code', 'JS-7', '[inventado] algo'), 'fallo_nodo');
  // La marca gana al tipo de nodo.
  assert.equal(R.tipoErrorDesdeNodo('n8n-nodes-base.googleSheets', 'Guardar', '[respuesta_llm_invalida] x'), 'respuesta_llm_invalida');
  const d = R.analizarErrorTrigger(errorW2('[evaluacion_sin_secciones_aplicables] todas las secciones quedaron no_aplica'));
  assert.equal(d.tipo_error, 'evaluacion_sin_secciones_aplicables');
});
