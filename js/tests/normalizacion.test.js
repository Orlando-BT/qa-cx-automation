const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cargarConfig, timestampASegundos, normalizarConversacion, filtrarPorTipoYActivas, prepararContexto, cargarNumerosEnPalabras } = require('../normalizacion');
const { DATOS, RAIZ, configCE } = require('./ayudas');
const { payloadBueno } = require('./fixtures');

test('config: el tipo concreto gana sobre todos y los valores se convierten a su tipo', () => {
  const filas = [
    { clave: 'meta_calidad', tipo_interaccion: 'todos', valor: '70', tipo: 'decimal' },
    { clave: 'meta_calidad', tipo_interaccion: 'ce', valor: '80', tipo: 'decimal' },
    { clave: 'meta_calidad', tipo_interaccion: 'sales', valor: '90', tipo: 'decimal' },
    { clave: 'campana_vigente_activa', tipo_interaccion: 'ce', valor: 'si', tipo: 'booleano' },
    { clave: 'canales_habilitados', tipo_interaccion: 'todos', valor: 'chat|correo', tipo: 'lista' },
    { clave: 'decimales_nota', tipo_interaccion: 'ce', valor: '2', tipo: 'entero' },
    { clave: 'precio_entrada_usd_millon_evaluador', tipo_interaccion: 'todos', valor: 'por_verificar', tipo: 'decimal' },
  ];
  const c = cargarConfig(filas, 'ce');
  assert.equal(c.meta_calidad, 80);
  assert.equal(c.campana_vigente_activa, true);
  assert.deepEqual(c.canales_habilitados, ['chat', 'correo']);
  assert.equal(c.decimales_nota, 2);
  assert.equal(c.precio_entrada_usd_millon_evaluador, 'por_verificar', 'los marcadores especiales no se convierten');
});

test('config: los pesos deben sumar 100', () => {
  const filas = [
    { clave: 'peso_a', tipo_interaccion: 'ce', valor: '50', tipo: 'decimal' },
    { clave: 'peso_b', tipo_interaccion: 'ce', valor: '40', tipo: 'decimal' },
  ];
  assert.throws(() => cargarConfig(filas, 'ce'), /suman 90/);
});

test('config: datos/config.csv carga con los valores de contrato/config.md', () => {
  const c = configCE();
  assert.equal(c.version_reglas, 'reglas_ce_v1');
  assert.equal(c.chat_primera_respuesta_seg, 60);
  assert.equal(c.umbral_desempate_complementarios, 0.5);
  assert.deepEqual(c.identidad_datos_comparables, ['correo', 'rfc', 'telefono', 'titular']);
  assert.equal(c.costo_estimado_por_evaluacion_usd, 0.005, 'valor provisional aprobado');
  assert.equal(c.tope_costo_lote_usd, 0.25, 'valor provisional aprobado');

  // Cada clave del contrato aparece en config.csv con el mismo valor por defecto.
  const md = fs.readFileSync(path.join(RAIZ, 'contrato', 'config.md'), 'utf8');
  const claves = [...md.matchAll(/^\| `([a-z0-9_]+)` \| (?:`(todos|ce|sales)` \| )?`([^`]*)` \|/gm)].map((m) => [m[1], m[2], m[3].replace(/\\\|/g, '|')]);
  assert.ok(claves.length > 50);
  for (const [clave, ambito, valor] of claves) {
    const fila = DATOS.config.find((f) => f.clave === clave && (ambito ? f.tipo_interaccion === ambito : true));
    assert.ok(fila, `config.csv no tiene ${clave}`);
    assert.equal(fila.valor, valor, `config.csv: ${clave}`);
  }
});

test('config Fase 2: las claves nuevas de tipo entero cargan como número entero desde datos/config.csv', () => {
  const c = configCE();
  const esperados = {
    max_tokens_evaluador: 8000,
    max_tokens_generador: 16000,
    reproceso_max_intentos: 3,
    reproceso_intervalo_min: 30,
    reintentos_conexion_api: 3,
    espera_entre_reintentos_ms: 5000,
    espera_maxima_reintento_ms: 60000,
  };
  for (const [clave, valor] of Object.entries(esperados)) {
    assert.strictEqual(c[clave], valor, clave);
    assert.ok(Number.isInteger(c[clave]), `${clave} debe ser entero`);
  }
});

test('timestamps a segundos y diferencias', () => {
  assert.equal(timestampASegundos('2026-10-21T10:01:00') - timestampASegundos('2026-10-21T10:00:00'), 60);
  assert.equal(timestampASegundos('2026-10-22T00:00:00') - timestampASegundos('2026-10-21T23:59:59'), 1);
  assert.throws(() => timestampASegundos('2026-10-21 10:00:00'));
});

test('normalización: ordena por n, mide tiempos y arma ventanas desde config', () => {
  const payload = payloadBueno();
  payload.mensajes.reverse(); // llegan desordenados
  const conv = normalizarConversacion(payload, configCE());
  assert.deepEqual(conv.mensajes.map((m) => m.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(conv.mensajes[1].seg_desde_anterior, 40);
  assert.deepEqual(conv.mensajes_agente, [2, 4, 6, 8, 10, 12]);
  assert.deepEqual(conv.primeros_agente_apertura, [2, 4]);
  assert.deepEqual(conv.primeros_agente_privacidad, [2, 4, 6]);
  assert.deepEqual(conv.ultimos_agente_cierre, [8, 10, 12]);
  assert.equal(conv.sin_mensajes_agente, false);

  const otra = normalizarConversacion(payloadBueno(), configCE({ apertura_mensajes_agente: 1, cierre_mensajes_agente: 2 }));
  assert.deepEqual(otra.primeros_agente_apertura, [2]);
  assert.deepEqual(otra.ultimos_agente_cierre, [10, 12]);
});

test('listas y catálogo: tipo ∪ todos y solo activas', () => {
  const filas = [
    { clave_lista: 'a', tipo_interaccion: 'ce', activo: 'si' },
    { clave_lista: 'b', tipo_interaccion: 'todos', activo: 'si' },
    { clave_lista: 'c', tipo_interaccion: 'sales', activo: 'si' },
    { clave_lista: 'd', tipo_interaccion: 'ce', activo: 'no' },
  ];
  assert.deepEqual(filtrarPorTipoYActivas(filas, 'ce').map((f) => f.clave_lista), ['a', 'b']);
});

test('prepararContexto: falla si la cuenta no existe', () => {
  const payload = { ...payloadBueno(), cuenta_id: 'CTA-999' };
  assert.throws(
    () => prepararContexto({ payload, lote: 'demo', filasConfig: DATOS.config, filasListas: DATOS.listas, filasCatalogo: DATOS.catalogo, filasCuentas: DATOS.cuentas }),
    /CTA-999/
  );
});

// ---------------------------------------------------------------------------
// Lista numero_en_palabras: validación al cargar (glosario.md, "Convención de numero_en_palabras")
// ---------------------------------------------------------------------------

const fila = (valor, notas, extra = {}) => ({ clave_lista: 'numero_en_palabras', tipo_lista: 'frase_criterio', tipo_interaccion: 'ce', valor, es_regex: 'no', activo: 'si', notas, ...extra });

test('numero_en_palabras: la lista real de datos/listas.csv carga y devuelve palabra → cifra', () => {
  const numeros = cargarNumerosEnPalabras(filtrarPorTipoYActivas(DATOS.listas, 'ce'));
  assert.equal(numeros.una, 1);
  assert.equal(numeros['cuarenta y ocho'], 48);
  assert.equal(numeros['setenta y dos'], 72);
  assert.equal(numeros.uno, undefined, 'la lista trae "una" y no "uno": una sola palabra por cifra');
  assert.equal(Object.keys(numeros).length, DATOS.listas.filter((f) => f.clave_lista === 'numero_en_palabras').length);
  // prepararContexto la deja lista para JS-3.
  const contexto = prepararContexto({ payload: payloadBueno(), lote: 'demo', filasConfig: DATOS.config, filasListas: DATOS.listas, filasCatalogo: DATOS.catalogo, filasCuentas: DATOS.cuentas });
  assert.deepEqual(contexto.numeros_en_palabras, numeros);
});

test('numero_en_palabras: la palabra se normaliza (acentos, mayúsculas, espacios) y la cifra admite espacios y números de Sheets', () => {
  const n = cargarNumerosEnPalabras([fila('  Veinticuátro ', ' 24 '), fila('Cuarenta   y  OCHO', 48)]);
  assert.deepEqual(n, { veinticuatro: 24, 'cuarenta y ocho': 48 });
});

test('numero_en_palabras: notas debe ser un entero no vacío (vacío, texto, decimal, negativo)', () => {
  for (const mala of ['', '   ', 'dos', '2.5', '-2', '2 horas', '1e3']) {
    assert.throws(() => cargarNumerosEnPalabras([fila('dos', mala)]), /numero_en_palabras inválida.*"dos".*entero no vacío/, `notas = "${mala}"`);
  }
  assert.throws(() => cargarNumerosEnPalabras([fila('dos', undefined)]), /entero no vacío/);
  assert.throws(() => cargarNumerosEnPalabras([fila('dos', null)]), /entero no vacío/);
});

test('numero_en_palabras: sin palabras duplicadas (sin acentos ni mayúsculas)', () => {
  assert.throws(() => cargarNumerosEnPalabras([fila('veinticuatro', '24'), fila('Veinticuátro', '25')]), /palabra duplicada/);
  assert.throws(() => cargarNumerosEnPalabras([fila('dos', '2'), fila('dos', '2')]), /palabra duplicada/);
});

test('numero_en_palabras: sin cifras duplicadas (una sola palabra por número)', () => {
  assert.throws(() => cargarNumerosEnPalabras([fila('uno', '1'), fila('una', '1')]), /la cifra 1 ya tiene la palabra "uno"/);
  // "02" y "2" son la misma cifra.
  assert.throws(() => cargarNumerosEnPalabras([fila('dos', '2'), fila('segundo', '02')]), /la cifra 2 ya tiene/);
});

test('numero_en_palabras: valor vacío o expresión regular también es error, y el mensaje junta todos los fallos', () => {
  assert.throws(() => cargarNumerosEnPalabras([fila('', '2')]), /valor vacío/);
  assert.throws(() => cargarNumerosEnPalabras([fila('dos|tres', '2', { es_regex: 'si' })]), /es_regex debe ser no/);
  assert.throws(() => cargarNumerosEnPalabras([fila('dos', 'x'), fila('tres', 'y')]), (e) => /"dos"/.test(e.message) && /"tres"/.test(e.message));
});

test('numero_en_palabras: solo se validan las filas activas del tipo; sin filas devuelve un objeto vacío', () => {
  // Una fila inactiva mal escrita no estorba (filtrarPorTipoYActivas la descarta antes de cargar).
  const listas = filtrarPorTipoYActivas([fila('dos', '2'), fila('tres', 'mal', { activo: 'no' }), fila('cuatro', 'mal', { tipo_interaccion: 'sales' })], 'ce');
  assert.deepEqual(cargarNumerosEnPalabras(listas), { dos: 2 });
  assert.deepEqual(cargarNumerosEnPalabras([]), {});
});

test('numero_en_palabras: una lista mal armada detiene prepararContexto (la evaluación no se hace)', () => {
  const malas = [...DATOS.listas, fila('uno', '1')]; // "uno" repite la cifra de "una"
  assert.throws(
    () => prepararContexto({ payload: payloadBueno(), lote: 'demo', filasConfig: DATOS.config, filasListas: malas, filasCatalogo: DATOS.catalogo, filasCuentas: DATOS.cuentas }),
    /numero_en_palabras inválida, no se evalúa.*la cifra 1 ya tiene la palabra "una"/
  );
});
