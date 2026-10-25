const test = require('node:test');
const assert = require('node:assert/strict');

const { clasificarRespuestaHttp, interpretarRetryAfter } = require('../clasificacion_http');

// Config mínima con los valores de datos/config.csv (3 reintentos, 5000 ms).
const config = { reintentos_conexion_api: 3, espera_entre_reintentos_ms: 5000, espera_maxima_reintento_ms: 60000 };
const AHORA = new Date('2026-10-24T12:00:00Z');
const resp = (statusCode, headers = {}) => ({ statusCode, headers, body: { error: 'contenido que no debe salir en el motivo: a@b.com' } });

test('200 y otros 2xx: continuar', () => {
  assert.deepEqual(clasificarRespuestaHttp(resp(200), 0, config), { accion: 'continuar' });
  assert.deepEqual(clasificarRespuestaHttp(resp(204), 2, config), { accion: 'continuar' });
});

for (const codigo of [400, 401, 404]) {
  test(`${codigo}: falla_api sin reintento, aunque queden reintentos`, () => {
    const r = clasificarRespuestaHttp(resp(codigo), 0, config);
    assert.equal(r.accion, 'falla_api');
    assert.equal(r.codigo_http, codigo);
    assert.match(r.motivo, new RegExp(String(codigo)));
    assert.doesNotMatch(r.motivo, /a@b\.com|contenido/, 'el motivo no copia el contenido de la respuesta');
  });
}

test('429 sin Retry-After: reintentar con la espera de config', () => {
  assert.deepEqual(clasificarRespuestaHttp(resp(429), 0, config), { accion: 'reintentar', espera_ms: 5000, siguiente_intento: 1 });
});

test('429 con Retry-After en segundos (también con otra capitalización)', () => {
  assert.deepEqual(clasificarRespuestaHttp(resp(429, { 'Retry-After': '7' }), 1, config), { accion: 'reintentar', espera_ms: 7000, siguiente_intento: 2 });
  assert.deepEqual(clasificarRespuestaHttp(resp(429, { 'retry-after': '2' }), 1, config), { accion: 'reintentar', espera_ms: 2000, siguiente_intento: 2 });
});

test('429 con Retry-After como fecha HTTP', () => {
  const r = clasificarRespuestaHttp(resp(429, { 'retry-after': 'Sat, 24 Oct 2026 12:00:09 GMT' }), 0, config, AHORA);
  assert.deepEqual(r, { accion: 'reintentar', espera_ms: 9000, siguiente_intento: 1 });
  // Fecha ya pasada: no hay que esperar.
  assert.equal(interpretarRetryAfter('Sat, 24 Oct 2026 11:00:00 GMT', AHORA), 0);
});

test('Retry-After inválido: se usa la espera de config', () => {
  for (const malo of ['pronto', '-5', '1.5', '', 'Fecha rara 99']) {
    assert.deepEqual(clasificarRespuestaHttp(resp(429, { 'retry-after': malo }), 0, config, AHORA), { accion: 'reintentar', espera_ms: 5000, siguiente_intento: 1 }, `valor "${malo}"`);
  }
});

test('500 y 503: reintentar', () => {
  assert.deepEqual(clasificarRespuestaHttp(resp(500), 0, config), { accion: 'reintentar', espera_ms: 5000, siguiente_intento: 1 });
  assert.deepEqual(clasificarRespuestaHttp(resp(503, { 'retry-after': '3' }), 2, config), { accion: 'reintentar', espera_ms: 3000, siguiente_intento: 3 });
});

test('error de red o timeout (sin statusCode): reintentar', () => {
  assert.deepEqual(clasificarRespuestaHttp({ error: { code: 'ETIMEDOUT' } }, 0, config), { accion: 'reintentar', espera_ms: 5000, siguiente_intento: 1 });
  assert.deepEqual(clasificarRespuestaHttp(undefined, 0, config), { accion: 'reintentar', espera_ms: 5000, siguiente_intento: 1 });
});

test('agotamiento de reintentos: falla_api (límite exacto: intentoActual == reintentos)', () => {
  // intentoActual 2 de 3 aún reintenta; 3 ya no.
  assert.equal(clasificarRespuestaHttp(resp(503), 2, config).accion, 'reintentar');
  const r = clasificarRespuestaHttp(resp(503), 3, config);
  assert.equal(r.accion, 'falla_api');
  assert.equal(r.codigo_http, 503);
  assert.match(r.motivo, /3 reintentos/);
  const red = clasificarRespuestaHttp({ error: { message: 'secreto sk-123' } }, 3, config);
  assert.equal(red.accion, 'falla_api');
  assert.equal(red.codigo_http, null);
  assert.doesNotMatch(red.motivo, /sk-123/);
});

test('los reintentos salen de config: con 0 reintentos un 500 falla de inmediato', () => {
  assert.equal(clasificarRespuestaHttp(resp(500), 0, { ...config, reintentos_conexion_api: 0 }).accion, 'falla_api');
});

test('config faltante o inválida: error explícito', () => {
  assert.throws(() => clasificarRespuestaHttp(resp(200), 0, {}), /reintentos_conexion_api/);
  assert.throws(() => clasificarRespuestaHttp(resp(200), 0, { reintentos_conexion_api: 3 }), /espera_entre_reintentos_ms/);
  assert.throws(() => clasificarRespuestaHttp(resp(200), 0, { reintentos_conexion_api: 3, espera_entre_reintentos_ms: 5000 }), /espera_maxima_reintento_ms/);
  assert.throws(() => clasificarRespuestaHttp(resp(200), 0, { ...config, espera_entre_reintentos_ms: 60001 }), /supera/);
  assert.throws(() => clasificarRespuestaHttp(resp(200), 0, { reintentos_conexion_api: '3', espera_entre_reintentos_ms: 5000, espera_maxima_reintento_ms: 60000 }), /reintentos_conexion_api/);
  assert.throws(() => clasificarRespuestaHttp(resp(200), 0, undefined), /clasificacion_http/);
});

test('tope de espera: Retry-After igual al tope reintenta; mayor falla_api', () => {
  assert.deepEqual(clasificarRespuestaHttp(resp(429, { 'retry-after': '60' }), 0, config), { accion: 'reintentar', espera_ms: 60000, siguiente_intento: 1 });
  const r = clasificarRespuestaHttp(resp(429, { 'retry-after': '61' }), 0, config);
  assert.equal(r.accion, 'falla_api');
  assert.equal(r.codigo_http, 429);
  assert.match(r.motivo, /supera el tope/);
});

test('tope de espera: fecha HTTP que excede el tope falla_api; la que cabe reintenta', () => {
  const r = clasificarRespuestaHttp(resp(503, { 'retry-after': 'Sat, 24 Oct 2026 12:02:00 GMT' }), 0, config, AHORA);
  assert.equal(r.accion, 'falla_api');
  assert.equal(r.codigo_http, 503);
  assert.deepEqual(clasificarRespuestaHttp(resp(503, { 'retry-after': 'Sat, 24 Oct 2026 12:01:00 GMT' }), 0, config, AHORA), { accion: 'reintentar', espera_ms: 60000, siguiente_intento: 1 });
});

test('reintentar incluye siguiente_intento = intentoActual + 1', () => {
  const { clasificarRespuestaHttp } = require('../clasificacion_http');
  const { configCE } = require('./ayudas');
  const r = clasificarRespuestaHttp({ statusCode: 503, headers: {} }, 1, configCE());
  assert.equal(r.accion, 'reintentar');
  assert.equal(r.siguiente_intento, 2);
});
