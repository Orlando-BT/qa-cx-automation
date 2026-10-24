const test = require('node:test');
const assert = require('node:assert/strict');

const { agregarSeccion, calcularNotaBase, calcularResultado, calcularSecciones, completarCriterios, criteriosEsperados, obtenerRubrica, redondear } = require('../scoring');
const { configCE, leerJSON, evaluar } = require('./ayudas');
const { payloadBueno, llmBueno } = require('./fixtures');

const config = configCE();
const sub = (id, clasificacion, resultado) => ({ id_criterio: id, clasificacion, resultado });

/** Sección con `claveFallidos` clave fallidos de 2 y `compFallidos` complementarios fallidos de 6. */
function apertura(claveFallidos, compFallidos) {
  return [
    sub('a.k1', 'clave', claveFallidos > 0 ? 'no_cumple' : 'cumple'),
    sub('a.k2', 'clave', 'cumple'),
    ...Array.from({ length: 6 }, (_, i) => sub(`a.c${i}`, 'complementario', i < compFallidos ? 'no_cumple' : 'cumple')),
  ];
}

test('D1: casos A a E de rubrica.md 2.1 (2 clave, 6 complementarios)', () => {
  assert.equal(agregarSeccion(apertura(0, 0), 0.5).resultado, 'cumple'); // A
  assert.equal(agregarSeccion(apertura(0, 2), 0.5).resultado, 'parcial'); // B 0.33
  assert.equal(agregarSeccion(apertura(0, 3), 0.5).resultado, 'parcial'); // C 0.50 no es mayor
  assert.equal(agregarSeccion(apertura(0, 4), 0.5).resultado, 'no_cumple'); // D 0.67
  const e = agregarSeccion(apertura(1, 0), 0.5); // E
  assert.equal(e.resultado, 'no_cumple');
  assert.deepEqual(e.clave_fallidos, ['a.k1']);
});

test('D1: casos F y G con no_aplica (comunicación sin esperas) e informativos ignorados', () => {
  const base = (compFallidos) => [
    sub('c.ortografia', 'clave', 'cumple'),
    sub('c.no_excede_espera', 'clave', 'no_aplica'),
    ...['pide_espera', 'agradece_espera', 'retoma_a_tiempo'].map((s) => sub(`c.${s}`, 'complementario', 'no_aplica')),
    ...Array.from({ length: 6 }, (_, i) => sub(`c.x${i}`, 'complementario', i < compFallidos ? 'no_cumple' : 'cumple')),
    sub('c.info', 'informativo', 'no_cumple'),
  ];
  const f = agregarSeccion(base(1), 0.5);
  assert.deepEqual([f.resultado, f.complementarios_fallidos, f.complementarios_aplicables], ['parcial', 1, 6]);
  assert.equal(agregarSeccion(base(4), 0.5).resultado, 'no_cumple');
  assert.equal(agregarSeccion([sub('x.k', 'clave', 'no_aplica'), sub('x.i', 'informativo', 'cumple')], 0.5).resultado, 'no_aplica');
  // El umbral de desempate viene de config.
  assert.equal(agregarSeccion(apertura(0, 4), 0.7).resultado, 'parcial');
});

/** Secciones con los resultados indicados y pesos de config. */
function secciones(resultados) {
  const factor = { cumple: 1, parcial: config.factor_parcial, no_cumple: 0, no_aplica: null };
  return Object.entries(resultados).map(([id, r]) => ({ id_seccion: id, peso: config[`peso_${id}`], resultado: r, factor: factor[r] }));
}

const EJEMPLO_D5 = {
  apertura: 'cumple',
  empatia: 'parcial',
  diagnostico: 'cumple',
  solucion: 'parcial',
  comunicacion: 'cumple',
  recapitulacion: 'no_cumple',
  ayuda_adicional: 'no_aplica',
  cierre: 'cumple',
};

test('D5: renormalización con sección no_aplica: 60.5 / 95 × 100 = 63.68', () => {
  assert.equal(calcularNotaBase(secciones(EJEMPLO_D5), config), 63.68);
});

test('D5: sin no_aplica, todas cumple salvo solución parcial = 82.5', () => {
  const r = Object.fromEntries(Object.keys(EJEMPLO_D5).map((k) => [k, 'cumple']));
  r.solucion = 'parcial';
  assert.equal(calcularNotaBase(secciones(r), config), 82.5);
});

test('D2: con error crítico nota_final = 0 aunque nota_base sea 82.5; sin crítico cumple la meta', () => {
  const r = Object.fromEntries(Object.keys(EJEMPLO_D5).map((k) => [k, 'cumple']));
  r.solucion = 'parcial';
  const critico = { id_criterio: 'critico.mala_actitud', tipo_criterio: 'critico', origen: 'LLM', resultado: 'detectado', evidencia: { mensajes: [2], dato: 'x' }, justificacion: 'y' };
  const con = calcularResultado(secciones(r), [critico], config);
  assert.deepEqual([con.nota_base, con.nota_final, con.cumple_meta, con.calidad, con.tiene_error_critico], [82.5, 0, false, 'mala', true]);
  assert.equal(con.errores_criticos[0].id_critico, 'critico.mala_actitud');
  const sin = calcularResultado(secciones(r), [{ ...critico, resultado: 'no_detectado' }], config);
  assert.deepEqual([sin.nota_base, sin.nota_final, sin.cumple_meta, sin.calidad, sin.tiene_error_critico], [82.5, 82.5, true, 'buena', false]);
});

test('meta y bandas de calidad: 80 exacto cumple con comparación inclusiva; > con "no"', () => {
  const s = [{ id_seccion: 'a', peso: 100, resultado: 'cumple', factor: 0.8 }];
  assert.equal(calcularResultado(s, [], config).cumple_meta, true);
  assert.equal(calcularResultado(s, [], configCE({ meta_comparacion_inclusiva: 'no' })).cumple_meta, false);
  assert.equal(calcularResultado(s, [], config).calidad, 'buena');
  assert.equal(calcularResultado([{ ...s[0], factor: 0.7999 }], [], config).calidad, 'regular');
  assert.equal(calcularResultado([{ ...s[0], factor: 0.6 }], [], config).calidad, 'regular');
  assert.equal(calcularResultado([{ ...s[0], factor: 0.5999 }], [], config).calidad, 'mala');
});

test('todas las secciones no_aplica → error evaluacion_sin_secciones_aplicables', () => {
  const r = Object.fromEntries(Object.keys(EJEMPLO_D5).map((k) => [k, 'no_aplica']));
  assert.throws(() => calcularResultado(secciones(r), [], config), (e) => e.tipo_error === 'evaluacion_sin_secciones_aplicables');
});

test('redondeo mitad hacia arriba sin error de punto flotante', () => {
  assert.equal(redondear(1.005, 2), 1.01);
  assert.equal(redondear(63.684210526, 2), 63.68);
  assert.equal(redondear(82.5, 2), 82.5);
});

test('rúbrica reglas_ce_v1: 69 criterios (54 + 3 + 12) con los conteos del contrato', () => {
  const esperados = criteriosEsperados(obtenerRubrica('reglas_ce_v1'));
  const subs = esperados.filter((e) => e.tipo_criterio === 'subelemento');
  assert.equal(esperados.length, 69);
  assert.equal(subs.length, 54);
  assert.equal(subs.filter((e) => e.clasificacion === 'clave').length, 19);
  assert.equal(subs.filter((e) => e.clasificacion === 'informativo').length, 1);
  assert.deepEqual(['JS', 'LLM', 'HIBRIDO'].map((o) => subs.filter((e) => e.origen === o).length), [34, 15, 5]);
  assert.deepEqual(['JS', 'LLM', 'HIBRIDO'].map((o) => subs.filter((e) => e.origen === o && e.clasificacion === 'clave').length), [9, 7, 3]);
  // Pesos de config suman 100 y corresponden a las 8 secciones.
  const r = obtenerRubrica('reglas_ce_v1');
  assert.equal(r.secciones.reduce((a, s) => a + config[`peso_${s.id}`], 0), 100);
});

test('completarCriterios: falta, sobra o cambia el origen de un criterio → error', () => {
  const rubrica = obtenerRubrica('reglas_ce_v1');
  const todos = criteriosEsperados(rubrica).map((e) => ({ id_criterio: e.id, origen: e.origen, resultado: 'cumple' }));
  assert.equal(completarCriterios(todos, rubrica).length, 69);
  assert.throws(() => completarCriterios(todos.slice(1), rubrica), /falta el criterio apertura.saludo/);
  assert.throws(() => completarCriterios([...todos, { id_criterio: 'apertura.otro', origen: 'JS' }], rubrica), /no están en la rúbrica/);
  assert.throws(() => completarCriterios(todos.map((c, i) => (i === 0 ? { ...c, origen: 'LLM' } : c)), rubrica), /origen LLM/);
});

test('D1: evaluacion_ejemplo.json recalculado desde sus 69 criterios coincide con rubrica.md 2.1, 2.2 y 2.3', () => {
  const ejemplo = leerJSON('contrato/ejemplos/evaluacion_ejemplo.json');
  const rubrica = obtenerRubrica('reglas_ce_v1');

  // 1) El ejemplo trae exactamente los criterios de la rúbrica, con el mismo origen y clasificación.
  const esperados = criteriosEsperados(rubrica);
  assert.deepEqual(
    ejemplo.criterios.map((c) => [c.id_criterio, c.origen, c.clasificacion]),
    esperados.map((e) => [e.id, e.origen, e.clasificacion])
  );

  // 2) D1 (2.1): cada sección se recalcula SOLO con los resultados de sus subelementos.
  const recalculadas = calcularSecciones(ejemplo.criterios, rubrica, config);
  assert.deepEqual(recalculadas, ejemplo.secciones);

  // 3) D5 (2.2): nota_base = suma(peso x factor) / suma(pesos aplicables) x 100.
  //    Cuenta manual: (5 + 5 + 15 + 17.5 + 13 + 0 + 5) / 95 x 100 = 63.68
  const aplicables = ejemplo.secciones.filter((x) => x.resultado !== 'no_aplica');
  const puntos = aplicables.reduce((a, x) => a + x.peso * x.factor, 0);
  const pesos = aplicables.reduce((a, x) => a + x.peso, 0);
  assert.equal(puntos, 60.5);
  assert.equal(pesos, 95);
  assert.equal(calcularNotaBase(recalculadas, config), 63.68);
  assert.equal(ejemplo.nota_base, 63.68);

  // 4) D2 (2.3): con un crítico detectado nota_final = 0, cumple_meta = false y calidad = mala.
  const r = calcularResultado(recalculadas, ejemplo.criterios, config);
  for (const campo of ['nota_base', 'nota_final', 'meta_calidad', 'cumple_meta', 'calidad', 'tiene_error_critico', 'errores_criticos']) {
    assert.deepEqual(r[campo], ejemplo[campo], campo);
  }
  assert.deepEqual(r.errores_criticos.map((e) => e.id_critico), ['critico.promesa_no_autorizada']);

  // 5) El mismo ejemplo SIN el crítico: nota_final = nota_base = 63.68, banda regular, no cumple la meta.
  const sinCritico = ejemplo.criterios.map((c) => (c.id_criterio === 'critico.promesa_no_autorizada' ? { ...c, resultado: 'no_detectado' } : c));
  const r2 = calcularResultado(recalculadas, sinCritico, config);
  assert.deepEqual([r2.nota_base, r2.nota_final, r2.cumple_meta, r2.calidad, r2.tiene_error_critico], [63.68, 63.68, false, 'regular', false]);
});

test('evaluación completa de la conversación buena: todas las secciones cumplen, nota 100', () => {
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  assert.deepEqual(evaluacion.secciones.map((s) => s.resultado), Array(8).fill('cumple'));
  assert.deepEqual([evaluacion.nota_base, evaluacion.nota_final, evaluacion.cumple_meta, evaluacion.calidad], [100, 100, true, 'buena']);
  // Con secciones reales no_aplica: inactividad, ayuda adicional queda fuera y se renormaliza.
  const s = calcularSecciones(evaluacion.criterios.map((c) => (c.seccion === 'ayuda_adicional' ? { ...c, resultado: 'no_aplica' } : c)), obtenerRubrica('reglas_ce_v1'), config);
  assert.equal(s.find((x) => x.id_seccion === 'ayuda_adicional').resultado, 'no_aplica');
  assert.equal(calcularNotaBase(s, config), 100);
});
