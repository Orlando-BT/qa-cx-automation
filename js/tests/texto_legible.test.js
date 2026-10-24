const test = require('node:test');
const assert = require('node:assert/strict');

const { textoLegible, metadatosCasoLegible } = require('../texto_legible');
const { payloadBueno } = require('./fixtures');

test('texto legible: [n] HH:MM:SS emisor: texto, una línea por mensaje y en orden', () => {
  const p = payloadBueno();
  p.mensajes.reverse();
  const lineas = textoLegible(p.mensajes).split('\n');
  assert.equal(lineas.length, 12);
  assert.equal(lineas[0], '[1] 10:00:00 cliente: Hola, necesito cancelar una factura que emití por error.');
  assert.match(lineas[1], /^\[2\] 10:00:40 agente: ¡Hola! Bienvenido a Contamix/);
  assert.equal(textoLegible([{ n: 1, emisor: 'cliente', timestamp: '2026-10-21T10:00:00', texto: 'uno\ndos' }]), '[1] 10:00:00 cliente: uno dos');
});

test('metadatos legibles con el formato de sheets.md', () => {
  assert.equal(
    metadatosCasoLegible(payloadBueno().metadatos_caso),
    'tipificacion_agente: Cancelación de CFDI | numero_caso: CASO-58213 | estado_caso: cerrado | escalado: no | campos_capturados: uuid_factura=presente, motivo_cancelacion=presente'
  );
  assert.equal(
    metadatosCasoLegible({ tipificacion_agente: 'X', numero_caso: null, estado_caso: 'sin_caso', escalado: true, campos_capturados: {} }),
    'tipificacion_agente: X | numero_caso: sin caso | estado_caso: sin_caso | escalado: si | campos_capturados: '
  );
});
