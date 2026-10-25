const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularConsumo, calcularCostoGeneracion, evaluarAlertaCostoEvaluacion, evaluarAlertaCostoLote, extraerUsoOpenAI, marcaTiempoSistema, filaEvaluaciones, filasDetalleCriterios, normalizarAnomaliasLlm, finalizarEvaluacion } = require('../costo');
const { columnasDeHoja } = require('./columnas_contrato');
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
  assert.deepEqual(c, { tokens_entrada: 10200, tokens_salida: 1850, intentos_llm: 2, anomalias_llm: [], costo_usd: null });
  assert.equal(evaluarAlertaCostoEvaluacion(c.costo_usd, config).evaluable, false);
});

test('precios de config.csv (verificados): costo = (10200 × 0.10 + 1850 × 0.50) / 1e6', () => {
  const c = calcularConsumo({ intentos, sin_mensajes_agente: false, config: configCE() });
  assert.deepEqual(c, { tokens_entrada: 10200, tokens_salida: 1850, intentos_llm: 2, anomalias_llm: [], costo_usd: 0.001945 });
});

test('precios verificados: costo = tokens × precio por millón', () => {
  const config = configCE({ precio_entrada_usd_millon_evaluador: '0.4', precio_salida_usd_millon_evaluador: '1.6' });
  const c = calcularConsumo({ intentos, sin_mensajes_agente: false, config });
  // (10200 × 0.4 + 1850 × 1.6) / 1e6 = 0.00704
  assert.equal(c.costo_usd, 0.00704);
});

test('sin mensajes del agente: tokens 0, intentos 0 y costo 0 aunque los precios estén por_verificar', () => {
  assert.deepEqual(calcularConsumo({ intentos: [], sin_mensajes_agente: true, config: configCE(POR_VERIFICAR) }), { tokens_entrada: 0, tokens_salida: 0, intentos_llm: 0, anomalias_llm: [], costo_usd: 0 });
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
  // Precios por_verificar explícitos → null (celda vacía).
  const sinPrecios = configCE({ precio_entrada_usd_millon_generador: 'por_verificar', precio_salida_usd_millon_generador: 'por_verificar' });
  assert.equal(calcularCostoGeneracion(1000, 2000, sinPrecios), null);
  // Precios reales de config.csv (0.10 / 0.50): (1000 × 0.10 + 2000 × 0.50) / 1e6 = 0.0011
  assert.equal(calcularCostoGeneracion(1000, 2000, configCE()), 0.0011);
  assert.equal(calcularCostoGeneracion(1000, 2000, configCE({ precio_entrada_usd_millon_generador: '1', precio_salida_usd_millon_generador: '5' })), 0.011);
  assert.deepEqual(extraerUsoOpenAI({ usage: { input_tokens: 10, output_tokens: 3 } }), { tokens_entrada: 10, tokens_salida: 3 });
  assert.deepEqual(extraerUsoOpenAI({ usage: { prompt_tokens: 7, completion_tokens: 2 } }), { tokens_entrada: 7, tokens_salida: 2 });
});

test('marca de tiempo del sistema con desfase de la zona de config', () => {
  assert.equal(marcaTiempoSistema(new Date('2026-10-21T16:05:20.789Z'), 'America/Mexico_City'), '2026-10-21T10:05:20-06:00');
  assert.equal(marcaTiempoSistema(new Date('2026-10-21T16:05:20Z'), 'UTC'), '2026-10-21T16:05:20+00:00');
});

test('filas de Sheets: 30 columnas en evaluaciones y 77 filas en detalle_criterios', () => {
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  const fila = filaEvaluaciones(evaluacion);
  assert.equal(Object.keys(fila).length, 30);
  assert.deepEqual(Object.keys(fila), columnasDeHoja('evaluaciones'));
  assert.equal(fila.anomalias_llm, '');
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

test('convención: intentos_llm es número y uso_llm es el arreglo que lee el bloque n8n', () => {
  const fs = require('node:fs');
  const fuente = fs.readFileSync(require('node:path').join(__dirname, '..', 'costo.js'), 'utf8');
  assert.match(fuente, /intentos: contexto\.uso_llm \|\| \[\]/);
  assert.doesNotMatch(fuente, /intentos: contexto\.intentos_llm/);
  const c = calcularConsumo({ intentos: [{ tokens_entrada: 10, tokens_salida: 5 }, { tokens_entrada: 20, tokens_salida: 5 }], sin_mensajes_agente: false, config: configCE() });
  assert.equal(c.intentos_llm, 2);
  assert.equal(typeof c.intentos_llm, 'number');
});

test('anomalias_llm: normaliza, sin duplicados, orden fijo y vacía sin LLM', () => {
  assert.deepEqual(normalizarAnomaliasLlm({}), []);
  assert.deepEqual(normalizarAnomaliasLlm({ anomalias_llm: ['refusal', 'incompleta', 'incompleta'] }), ['incompleta', 'refusal']);
  const conCommentary = { anomalias_llm: ['refusal'], estructura_salida_llm: { anomalias: ['fase_commentary_ignorada'] } };
  assert.deepEqual(normalizarAnomaliasLlm(conCommentary), ['refusal', 'commentary']);
  assert.deepEqual(normalizarAnomaliasLlm({ estructura_salida_llm: { anomalias: ['fase_otra_ignorada'] } }), []);
  assert.deepEqual(normalizarAnomaliasLlm({ ...conCommentary, sin_mensajes_agente: true }), []);
});

test('consumo.anomalias_llm se calcula en JS-8; la columna de evaluaciones se deriva de él y la evaluación cumple el esquema', () => {
  const { validarConEsquema } = require('../validador_payload');
  const esquema = require('./ayudas').leerJSON('contrato/evaluacion.schema.json');
  const { evaluacion: base, contexto } = evaluar(payloadBueno(), llmBueno());
  const consumo = calcularConsumo({
    intentos,
    sin_mensajes_agente: false,
    config: contexto.config,
    anomalias_llm: ['refusal', 'incompleta'],
    estructura_salida_llm: { anomalias: ['fase_commentary_ignorada'] },
  });
  assert.deepEqual(consumo.anomalias_llm, ['incompleta', 'refusal', 'commentary']);
  const evaluacion = finalizarEvaluacion(base, consumo, base.marcas_tiempo.evaluado_en);
  assert.deepEqual(evaluacion.consumo.anomalias_llm, ['incompleta', 'refusal', 'commentary']);
  assert.equal(filaEvaluaciones(evaluacion).anomalias_llm, 'incompleta|refusal|commentary');
  assert.equal(filaEvaluaciones(evaluacion).anomalias_llm, JSON.parse(filaEvaluaciones(evaluacion).evaluacion_json).consumo.anomalias_llm.join('|'));
  assert.deepEqual(validarConEsquema(evaluacion, esquema), []);
  // Sin anomalías: arreglo vacío y celda vacía.
  assert.equal(filaEvaluaciones(base).anomalias_llm, '');
  assert.deepEqual(base.consumo.anomalias_llm, []);
  // Sin LLM: siempre vacío.
  const sinAgente = calcularConsumo({ intentos: [], sin_mensajes_agente: true, config: contexto.config, anomalias_llm: ['refusal'] });
  assert.deepEqual(sinAgente.anomalias_llm, []);
});

test('calcularCostoGeneracion: tokens null o ausentes dan null (celda vacía), nunca 0', () => {
  const { calcularCostoGeneracion: costoGen } = require('../costo');
  const c = configCE();
  assert.equal(costoGen(null, null, c), null);
  assert.equal(costoGen(undefined, 100, c), null);
  assert.equal(costoGen(100, undefined, c), null);
  assert.equal(costoGen(100, null, c), null);
  assert.equal(costoGen(NaN, 10, c), null);
  // Con tokens medidos sí hay costo: (1000 x 0.10 + 500 x 0.50) / 1e6.
  assert.equal(costoGen(1000, 500, c), 0.00035);
  assert.equal(costoGen(0, 0, c), 0, 'cero tokens medidos es 0 real');
  // Precios por_verificar siguen dando null.
  assert.equal(costoGen(1000, 500, configCE({ precio_entrada_usd_millon_generador: 'por_verificar' })), null);
});

// --- Escritura idempotente ------------------------------------------------------

test('planificarEscrituraResultados: primera ejecución escribe todo (1 evaluación + 77 filas de detalle)', () => {
  const { planificarEscrituraResultados, filaEvaluaciones: filaEv, filasDetalleCriterios: filasDet } = require('../costo');
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  const plan = planificarEscrituraResultados({ evaluacion, filasEvaluacionesExistentes: [], filasDetalleExistentes: [] });
  assert.equal(plan.escribir_evaluacion, true);
  assert.deepEqual(plan.filas_evaluacion, [filaEv(evaluacion)]);
  assert.deepEqual(plan.filas_detalle, filasDet(evaluacion));
  assert.equal(plan.filas_detalle.length, 77);
});

test('planificarEscrituraResultados: doble ejecución no escribe nada nuevo', () => {
  const { planificarEscrituraResultados, filaEvaluaciones: filaEv, filasDetalleCriterios: filasDet } = require('../costo');
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  // Las filas existentes llegan de Sheets como texto.
  const comoTexto = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)]));
  const plan = planificarEscrituraResultados({
    evaluacion,
    filasEvaluacionesExistentes: [comoTexto(filaEv(evaluacion))],
    filasDetalleExistentes: filasDet(evaluacion).map(comoTexto),
  });
  assert.deepEqual(plan, { escribir_evaluacion: false, filas_evaluacion: [], filas_detalle: [] });
});

test('planificarEscrituraResultados: escritura parcial previa escribe solo lo que falta', () => {
  const { planificarEscrituraResultados, filaEvaluaciones: filaEv, filasDetalleCriterios: filasDet } = require('../costo');
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  const detalle = filasDet(evaluacion);
  // Caso 1: se escribió la evaluación y 30 filas de detalle; faltan 47 y la evaluación no se repite.
  const parcial = planificarEscrituraResultados({ evaluacion, filasEvaluacionesExistentes: [filaEv(evaluacion)], filasDetalleExistentes: detalle.slice(0, 30) });
  assert.equal(parcial.escribir_evaluacion, false);
  assert.deepEqual(parcial.filas_evaluacion, []);
  assert.deepEqual(parcial.filas_detalle, detalle.slice(30));
  // Caso 2: solo había detalle (la evaluación no se escribió): escribe la evaluación y lo que falta.
  const sinEval = planificarEscrituraResultados({ evaluacion, filasEvaluacionesExistentes: [], filasDetalleExistentes: detalle.slice(0, 77) });
  assert.equal(sinEval.escribir_evaluacion, true);
  assert.equal(sinEval.filas_detalle.length, 0);
  // Las filas existentes de OTRA evaluación no cuentan.
  const otra = detalle.slice(0, 10).map((f) => ({ ...f, id_evaluacion: 'EVAL-CONV-9999-reglas_ce_v1-evaluador_ce_v1' }));
  assert.equal(planificarEscrituraResultados({ evaluacion, filasEvaluacionesExistentes: [], filasDetalleExistentes: otra }).filas_detalle.length, 77);
});

test('planificarEscrituraResultados: id_evaluacion se deriva de la llave; si no corresponde, error', () => {
  const { planificarEscrituraResultados } = require('../costo');
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  assert.equal(evaluacion.id_evaluacion, `EVAL-${evaluacion.llave_dedup.split('|').join('-')}`);
  assert.throws(() => planificarEscrituraResultados({ evaluacion: { ...evaluacion, id_evaluacion: 'EVAL-CONV-0001-reglas_ce_v1-evaluador_ce_v1' } }), /no corresponde a la llave_dedup/);
});
