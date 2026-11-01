/**
 * Pruebas de la "nota esperada" de W0: predice con el scoring de JS-7 la nota que darán las fallas
 * del escenario, rechaza el formulario si no cae en la banda pedida y re-sortea las fallas si el
 * sorteo no la alcanza. Fixtures propios; el reloj se inyecta (`ahora`); sin bucles largos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../simulador');
const scoring = require('../scoring');
const { configCE, DATOS } = require('./ayudas');

const config = configCE();
const catalogo = DATOS.catalogo;
const cuentas = DATOS.cuentas;
const AHORA = new Date('2026-10-24T18:00:00Z');
const VR = 'reglas_ce_v1';

const solicitudBase = (cambios = {}) => ({
  tipo_interaccion: 'ce',
  tema: null,
  calidad_solicitada: 'regular',
  errores_criticos_inyectados: [],
  criterios_que_deben_fallar: [],
  casos_dificiles: [],
  cantidad: 1,
  lote: 'demo',
  semilla_sorteo: null,
  ...cambios,
});
const completar = (cambios, semilla, extra = {}) =>
  S.completarEscenario(solicitudBase(cambios), { config, catalogo, cuentas, conversationId: 'CONV-0300', semilla, ahora: AHORA, scoring, ...extra });
const esperada = (criterios, extra = {}) => S.notaEsperada(criterios, { versionReglas: VR, criticos: [], config, fila: null, scoring, ...extra });
const filaDe = (escenario) => catalogo.find((f) => f.tipo_interaccion === 'ce' && f.tipificacion_valida === escenario.tipificacion_esperada);

const CAMPOS = 'solucion.campos_obligatorios';
const A = ['comunicacion.frases_negativas', 'cierre.marca'];
const B = ['diagnostico.preguntas_necesarias', 'solucion.ofrece_alternativas'];
const C = ['diagnostico.preguntas_necesarias', 'comunicacion.redaccion'];

test('notaEsperada: combinaciones de referencia (sin y con campos_obligatorios)', () => {
  assert.deepEqual(esperada(A), { nota: 91, calidad: 'buena', tiene_critico: false });
  assert.deepEqual(esperada([...A, CAMPOS]), { nota: 73.5, calidad: 'regular', tiene_critico: false });
  assert.deepEqual(esperada(B), { nota: 67.5, calidad: 'regular', tiene_critico: false });
  assert.deepEqual(esperada([...B, CAMPOS]), { nota: 67.5, calidad: 'regular', tiene_critico: false });
  assert.deepEqual(esperada(C), { nota: 78.5, calidad: 'regular', tiene_critico: false });
  assert.deepEqual(esperada([...C, CAMPOS]), { nota: 61, calidad: 'regular', tiene_critico: false });
  assert.deepEqual(esperada(['comunicacion.redaccion']), { nota: 93.5, calidad: 'buena', tiene_critico: false });
  assert.equal(esperada([]).nota, 100);
});

test('notaEsperada: lo inaplicable por la fila del catálogo y los pares excluyentes no cuentan', () => {
  // Dos complementarios de solución fallan. Fila con campos: 2 de 4 aplicables (0.5, no mayor que el umbral) = parcial.
  // Fila sin campos: 2 de 3 aplicables (0.67 > 0.5) = no_cumple. Lo inaplicable cambia la proporción.
  const pedidos = ['solucion.informacion_completa', 'solucion.ofrece_alternativas'];
  const conCampos = esperada(pedidos, { fila: { requiere_escalamiento: 'si', campos_obligatorios: 'a|b' } });
  const sinCampos = esperada(pedidos, { fila: { requiere_escalamiento: 'si', campos_obligatorios: '' } });
  assert.ok(conCampos.nota > sinCampos.nota, `${conCampos.nota} debía ser mayor que ${sinCampos.nota}`);
  // Si falla encuesta, seguimiento_en_plazo (su par) queda no_aplica: la nota es la de fallar solo encuesta.
  const par = esperada(['ayuda_adicional.encuesta']);
  assert.equal(par.nota, 95);
});

test('notaEsperada: con error crítico la nota es 0 y la calidad es mala', () => {
  assert.deepEqual(esperada(['comunicacion.redaccion'], { criticos: ['critico.abandono'] }), { nota: 0, calidad: 'mala', tiene_critico: true });
});

test('notaEsperada: exige scoring por parámetro', () => {
  assert.throws(() => S.notaEsperada([], { versionReglas: VR, config }), /falta scoring/);
});

test('sorteo regular con semilla que antes caía en buena: ahora se vuelve a sortear y cae en regular', () => {
  const sinScoring = completar({}, 1, { scoring: undefined });
  const antes = esperada(sinScoring.escenario.criterios_que_deben_fallar, { fila: filaDe(sinScoring.escenario) });
  assert.equal(antes.calidad, 'buena', 'la semilla 1 debía caer en buena con el sorteo anterior');
  assert.ok(sinScoring.advertencias.some((a) => /no verificada/.test(a)));

  const r = completar({}, 1);
  assert.equal(r.valido, true);
  const ahora = esperada(r.escenario.criterios_que_deben_fallar, { fila: filaDe(r.escenario) });
  assert.equal(ahora.calidad, 'regular');
  assert.equal(r.extras.nota_esperada, ahora.nota);
  assert.ok(r.escenario.descripcion_escenario.includes(`Nota esperada del scoring: ${ahora.nota}.`));
  assert.notDeepEqual(r.escenario.criterios_que_deben_fallar, sinScoring.escenario.criterios_que_deben_fallar);
});

test('el re-sorteo es reproducible con la misma semilla', () => {
  const a = completar({}, 1);
  const b = completar({}, 1);
  assert.deepEqual(a.escenario, b.escenario);
  assert.deepEqual(a.extras, b.extras);
});

test('sorteo mala sin crítico cae en la banda mala', () => {
  const r = completar({ calidad_solicitada: 'mala' }, 3);
  assert.equal(r.valido, true);
  assert.equal(esperada(r.escenario.criterios_que_deben_fallar, { fila: filaDe(r.escenario) }).calidad, 'mala');
});

test('mala con error crítico: nota esperada 0', () => {
  const r = completar({ calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.abandono'] }, 5);
  assert.equal(r.valido, true);
  assert.equal(r.extras.nota_esperada, 0);
});

test('formulario con solo comunicacion.redaccion y calidad regular se rechaza con nota y calidad esperadas', () => {
  const r = completar({ tema: 'Cancelación de CFDI', criterios_que_deben_fallar: ['comunicacion.redaccion'] }, 11);
  assert.equal(r.valido, false);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0], /Con comunicacion\.redaccion como única falla la nota esperada es \d+(\.\d+)? \(buena\), no regular/);
  assert.match(r.errores[0], /agrega otra falla complementaria/);
});

test('formulario con diagnostico.preguntas_necesarias + comunicacion.redaccion en regular se acepta', () => {
  const r = completar({ criterios_que_deben_fallar: C }, 11);
  assert.equal(r.valido, true, r.errores.join(' | '));
  assert.equal(r.escenario.calidad_esperada, 'regular');
  assert.ok([78.5, 61].includes(r.extras.nota_esperada));
});

test('formulario en buena con una falla clave se rechaza; con una complementaria leve se acepta', () => {
  const mal = completar({ calidad_solicitada: 'buena', criterios_que_deben_fallar: ['solucion.informacion_correcta'] }, 11);
  assert.equal(mal.valido, false);
  assert.match(mal.errores[0], /no buena/);
  const bien = completar({ calidad_solicitada: 'buena', criterios_que_deben_fallar: ['comunicacion.redaccion'] }, 11);
  assert.equal(bien.valido, true, bien.errores.join(' | '));
});

test('agotamiento de intentos: con una config donde regular es imposible, valido=false con error claro', () => {
  const imposible = { ...config, calidad_regular_nota_min: 101, calidad_buena_nota_min: 102 };
  const r = completar({}, 1, { config: imposible });
  assert.equal(r.valido, false);
  assert.match(r.errores[0], new RegExp(`tras ${S.MAX_INTENTOS_SORTEO_FALLAS} intentos`));
  assert.equal(S.MAX_INTENTOS_SORTEO_FALLAS, 30);
});
