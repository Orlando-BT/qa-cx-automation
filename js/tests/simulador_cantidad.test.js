// Cantidad del formulario del simulador: n8n manda el campo número vacío como 0.
const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../simulador');
const { configCE, DATOS } = require('./ayudas');

const config = configCE();
const catalogo = DATOS.catalogo;

test('cantidad vacía, 0 o "0" (n8n no los distingue) -> 1 y válido', () => {
  for (const cantidad of [0, '0', '', null, undefined]) {
    const r = S.validarFormulario({ cantidad }, { config, catalogo });
    assert.equal(r.valido, true, `cantidad ${JSON.stringify(cantidad)}: ${r.errores.join('; ')}`);
    assert.equal(r.solicitud.cantidad, 1);
  }
});

test('cantidad negativa, decimal, texto o sobre el máximo se rechaza con mensaje', () => {
  const max = config.simulador_max_conversaciones;
  for (const cantidad of [-1, 1.5, 'abc', max + 1]) {
    const r = S.validarFormulario({ cantidad }, { config, catalogo });
    assert.equal(r.valido, false, `cantidad ${JSON.stringify(cantidad)} debió rechazarse`);
    assert.ok(r.errores.some((e) => e.includes('cantidad')));
  }
});

// --- Rango de IDs reservado para pruebas (CONV-9000 a CONV-9999) ------------

const enRango = (id) => Number(id.slice(5)) >= 9000 && Number(id.slice(5)) <= 9999;

test('IDs: los existentes del rango de pruebas no cuentan para el máximo', () => {
  assert.deepEqual(S.generarIdsConversacion(['CONV-0003', 'CONV-9001', 'CONV-9007'], 3), ['CONV-0004', 'CONV-0005', 'CONV-0006']);
  assert.deepEqual(S.RANGO_IDS_PRUEBA, { minimo: 9000, maximo: 9999 });
});

test('IDs: cerca de 8999 salta a CONV-10000 y nunca cae en 9000-9999', () => {
  const ids = S.generarIdsConversacion(['CONV-8998'], 3);
  assert.deepEqual(ids, ['CONV-8999', 'CONV-10000', 'CONV-10001']);
  assert.deepEqual(S.generarIdsConversacion(['CONV-8999'], 3), ['CONV-10000', 'CONV-10001', 'CONV-10002']);
  assert.equal(ids.some(enRango), false);
});

test('IDs: sin existentes sigue igual y CONV-10000 es válido para el validador de payload', () => {
  assert.deepEqual(S.generarIdsConversacion([], 2), ['CONV-0001', 'CONV-0002']);
  const { validarPayload } = require('../validador_payload');
  const { payloadBueno } = require('./fixtures');
  const p = payloadBueno();
  p.conversation_id = 'CONV-10000';
  const r = validarPayload(p, { cuentas: DATOS.cuentas, config });
  assert.equal(r.errores.some((e) => e.ruta === '$.conversation_id'), false);
});
