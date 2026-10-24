const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularConsumo, calcularCostoGeneracion, evaluarAlertaCostoEvaluacion, evaluarAlertaCostoLote, extraerUsoOpenAI, marcaTiempoSistema, filaEvaluaciones, filasDetalleCriterios } = require('../costo');
const { configCE, evaluar } = require('./ayudas');
const { payloadBueno, llmBueno } = require('./fixtures');

const intentos = [
  { tokens_entrada: 5000, tokens_salida: 900 },
  { tokens_entrada: 5200, tokens_salida: 950 },
];

// Los precios del evaluador de datos/config.csv ya están verificados (0.10 y 0.50 USD por millón);
// para probar el marcador `por_verificar` se reemplazan explícitamente.
const POR_VERIFICAR = { precio_entrada_usd_millon_evaluador: 'por_verificar', precio_salida_usd_millon_evaluador: 'por_verificar' };

test('precios por_verificar: tokens sumados y costo_usd null', () => {
  const config = configCE(POR_VERIFICAR);
  const c = calcularConsumo({ intentos, sin_mensajes_agente: false, config });
  assert.deepEqual(c, { tokens_entrada: 10200, tokens_salida: 1850, intentos_llm: 2, costo_usd: null });
  assert.equal(evaluarAlertaCostoEvaluacion(c.costo_usd, config).evaluable, false);
});

test('precios de config.csv (verificados): costo = (10200 × 0.10 + 1850 × 0.50) / 1e6', () => {
  const c = calcularConsumo({ intentos, sin_mensajes_agente: false, config: configCE() });
  assert.deepEqual(c, { tokens_entrada: 10200, tokens_salida: 1850, intentos_llm: 2, costo_usd: 0.001945 });
});

test('precios verificados: costo = tokens × precio por millón', () => {
  const config = configCE({ precio_entrada_usd_millon_evaluador: '0.4', precio_salida_usd_millon_evaluador: '1.6' });
  const c = calcularConsumo({ intentos, sin_mensajes_agente: false, config });
  // (10200 × 0.4 + 1850 × 1.6) / 1e6 = 0.00704
  assert.equal(c.costo_usd, 0.00704);
});

test('sin mensajes del agente: tokens 0, intentos 0 y costo 0 aunque los precios estén por_verificar', () => {
  assert.deepEqual(calcularConsumo({ intentos: [], sin_mensajes_agente: true, config: configCE(POR_VERIFICAR) }), { tokens_entrada: 0, tokens_salida: 0, intentos_llm: 0, costo_usd: 0 });
});

test('pendiente_fase_1 solo desactiva la alerta (forzado en la prueba); con valor fijado la alerta se evalúa', () => {
  const PEND = { costo_estimado_por_evaluacion_usd: 'pendiente_fase_1', tope_costo_lote_usd: 'pendiente_fase_1' };
  const pendiente = evaluarAlertaCostoEvaluacion(0.01, configCE(PEND));
  assert.deepEqual([pendiente.evaluable, pendiente.disparar], [false, false]);
  assert.equal(evaluarAlertaCostoLote([0.1, 0.2], configCE(PEND)).evaluable, false);
  const config = configCE({ costo_estimado_por_evaluacion_usd: '0.005' });
  assert.equal(evaluarAlertaCostoEvaluacion(0.01, config).disparar, false, '0.01 no es mayor que 2 × 0.005');
  assert.equal(evaluarAlertaCostoEvaluacion(0.0101, config).disparar, true);
  assert.equal(evaluarAlertaCostoLote([0.1, 0.2], configCE({ tope_costo_lote_usd: '0.25' })).disparar, true);
  assert.equal(evaluarAlertaCostoLote([0.1, null], configCE({ tope_costo_lote_usd: '0.25' })).evaluable, false);
});

test('con los valores reales de config.csv las alertas de costo sí se evalúan', () => {
  const real = configCE();
  const e1 = evaluarAlertaCostoEvaluacion(0.01, real);
  assert.deepEqual([e1.evaluable, e1.disparar], [true, false], '0.01 = 2 × 0.005, no supera');
  assert.equal(evaluarAlertaCostoEvaluacion(0.0101, real).disparar, true);
  const l1 = evaluarAlertaCostoLote([0.1, 0.15], real);
  assert.deepEqual([l1.evaluable, l1.disparar], [true, false], '0.25 no supera el tope 0.25');
  assert.equal(evaluarAlertaCostoLote([0.1, 0.16], real).disparar, true);
});

test('costo de generación del simulador y lectura de usage de OpenAI', () => {
  assert.equal(calcularCostoGeneracion(1000, 2000, configCE()), null);
  assert.equal(calcularCostoGeneracion(1000, 2000, configCE({ precio_entrada_usd_millon_generador: '1', precio_salida_usd_millon_generador: '5' })), 0.011);
  assert.deepEqual(extraerUsoOpenAI({ usage: { input_tokens: 10, output_tokens: 3 } }), { tokens_entrada: 10, tokens_salida: 3 });
  assert.deepEqual(extraerUsoOpenAI({ usage: { prompt_tokens: 7, completion_tokens: 2 } }), { tokens_entrada: 7, tokens_salida: 2 });
});

test('marca de tiempo del sistema con desfase de la zona de config', () => {
  assert.equal(marcaTiempoSistema(new Date('2026-10-21T16:05:20.789Z'), 'America/Mexico_City'), '2026-10-21T10:05:20-06:00');
  assert.equal(marcaTiempoSistema(new Date('2026-10-21T16:05:20Z'), 'UTC'), '2026-10-21T16:05:20+00:00');
});

test('filas de Sheets: 29 columnas en evaluaciones y 77 filas en detalle_criterios', () => {
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  const fila = filaEvaluaciones(evaluacion);
  assert.equal(Object.keys(fila).length, 29);
  assert.equal(fila.costo_usd, 0.00095, 'precios verificados de config.csv');
  const sinPrecio = evaluar(payloadBueno(), llmBueno(), { configCambios: POR_VERIFICAR });
  assert.equal(filaEvaluaciones(sinPrecio.evaluacion).costo_usd, '', 'por_verificar → celda vacía');
  assert.equal(fila.cumple_meta, 'si');
  assert.equal(fila.errores_criticos, '');
  const detalle = filasDetalleCriterios(evaluacion);
  assert.equal(detalle.length, 77);
  assert.equal(Object.keys(detalle[0]).length, 17);
  assert.equal(detalle.filter((f) => f.tipo_criterio === 'seccion').length, 8);
  assert.equal(detalle.find((f) => f.id_criterio === 'apertura.toma_a_tiempo').mensajes, '1|2');
});
