const test = require('node:test');
const assert = require('node:assert/strict');

const { ESQUEMA_PAYLOAD, validarPayload, validarLote, convertirSalidaGenerador, validarGeneracion } = require('../validador_payload');
const { leerJSON, DATOS, configCE } = require('./ayudas');
const { payloadBueno } = require('./fixtures');

const cuentas = DATOS.cuentas;
const config = configCE();
const rutas = (r) => r.errores.map((e) => e.ruta);

test('la copia del esquema en el código es idéntica a contrato/payload.schema.json', () => {
  assert.deepEqual(ESQUEMA_PAYLOAD, leerJSON('contrato/payload.schema.json'));
});

test('payloads válidos: ejemplo del contrato y fixture', () => {
  assert.deepEqual(validarPayload(leerJSON('contrato/ejemplos/payload_ejemplo.json'), { cuentas, config }), { valido: true, errores: [] });
  assert.equal(validarPayload(payloadBueno(), { cuentas, config }).valido, true);
});

test('esquema: campos obligatorios, campos extra, tipos, formatos y enumeraciones', () => {
  const p = payloadBueno();
  delete p.agente;
  p.extra = 1;
  p.canal = 'correo';
  p.conversation_id = 'C-1';
  p.metadatos_caso.escalado = 'no';
  p.metadatos_caso.campos_capturados.uuid_factura = 'si';
  p.mensajes[0].emisor = 'bot';
  const r = validarPayload(p, { cuentas, config });
  assert.equal(r.valido, false);
  for (const ruta of ['$.agente', '$.extra', '$.canal', '$.conversation_id', '$.metadatos_caso.escalado', '$.metadatos_caso.campos_capturados.uuid_factura', '$.mensajes[0].emisor']) {
    assert.ok(rutas(r).includes(ruta), ruta);
  }
  // Ningún mensaje de error copia el texto de los mensajes.
  assert.ok(r.errores.every((e) => !e.mensaje.includes('factura')));
});

test('reglas fuera del esquema: n consecutivos, fechas reales, orden de timestamps y cuenta existente', () => {
  const p = payloadBueno();
  p.mensajes[2].n = 30;
  assert.ok(validarPayload(p, { cuentas }).errores.some((e) => /consecutivos/.test(e.mensaje)));

  const p2 = payloadBueno();
  p2.mensajes[1].timestamp = '2026-02-30T10:00:40';
  assert.ok(validarPayload(p2, { cuentas }).errores.some((e) => /fecha y hora real/.test(e.mensaje)));

  const p3 = payloadBueno();
  p3.mensajes[3].timestamp = '2026-10-21T09:59:00';
  assert.ok(validarPayload(p3, { cuentas }).errores.some((e) => /anterior al timestamp del mensaje 3/.test(e.mensaje)));

  // Desordenados en el arreglo pero coherentes al ordenar por n: válido.
  const p4 = payloadBueno();
  p4.mensajes.reverse();
  assert.equal(validarPayload(p4, { cuentas }).valido, true);

  const p5 = { ...payloadBueno(), cuenta_id: 'CTA-999' };
  assert.deepEqual(rutas(validarPayload(p5, { cuentas })), ['$.cuenta_id']);
});

test('estado_caso = sin_caso si y solo si numero_caso es null', () => {
  assert.equal(validarPayload(payloadBueno({ numero_caso: null, estado_caso: 'sin_caso' }), { cuentas }).valido, true);
  assert.equal(validarPayload(payloadBueno({ numero_caso: null, estado_caso: 'abierto' }), { cuentas }).valido, false);
  assert.equal(validarPayload(payloadBueno({ estado_caso: 'sin_caso' }), { cuentas }).valido, false);
});

test('lote: por defecto demo y patrón demo|calibracion_vN', () => {
  assert.deepEqual(validarLote(undefined, config), { lote: 'demo', valido: true, errores: [] });
  assert.equal(validarLote('calibracion_v2', config).valido, true);
  assert.equal(validarLote('prueba', config).valido, false);
});

test('salida del generador: campos_capturados en lista {campo, estado} → objeto del contrato', () => {
  const salida = payloadBueno();
  salida.metadatos_caso.campos_capturados = [
    { campo: 'uuid_factura', estado: 'presente' },
    { campo: 'motivo_cancelacion', estado: 'ausente' },
  ];
  salida.conversation_id = 'CONV-9999';
  const { payload, errores } = convertirSalidaGenerador(salida, { conversation_id: 'CONV-0150' });
  assert.deepEqual(errores, []);
  assert.deepEqual(payload.metadatos_caso.campos_capturados, { uuid_factura: 'presente', motivo_cancelacion: 'ausente' });
  assert.equal(payload.conversation_id, 'CONV-0150', 'los campos fijos del simulador ganan');

  const repetido = payloadBueno();
  repetido.metadatos_caso.campos_capturados = [{ campo: 'a', estado: 'presente' }, { campo: 'a', estado: 'ausente' }];
  const r = validarGeneracion(repetido, { cuentas, config });
  assert.equal(r.valido, false);
  assert.ok(r.errores.some((e) => /repetido/.test(e.mensaje)));
});
