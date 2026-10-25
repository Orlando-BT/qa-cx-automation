const test = require('node:test');
const assert = require('node:assert/strict');

const { validarConEsquema } = require('../validador_payload');
const { evaluar, leerJSON, criterio } = require('./ayudas');
const { payloadBase, payloadBueno, llmBueno } = require('./fixtures');

const ESQUEMA_EVALUACION = leerJSON('contrato/evaluacion.schema.json');
const cumpleEsquema = (e) => assert.deepEqual(validarConEsquema(e, ESQUEMA_EVALUACION), []);

test('el validador de esquema acepta los ejemplos del contrato (control del validador)', () => {
  cumpleEsquema(leerJSON('contrato/ejemplos/evaluacion_ejemplo.json'));
  cumpleEsquema(leerJSON('contrato/ejemplos/evaluacion_sin_agente_ejemplo.json'));
  assert.ok(validarConEsquema({ ...leerJSON('contrato/ejemplos/evaluacion_ejemplo.json'), nota_final: 101 }, ESQUEMA_EVALUACION).length > 0);
});

test('pipeline JS-1 → JS-8 con la conversación buena: cumple evaluacion.schema.json y trae 69 criterios', () => {
  const { evaluacion } = evaluar(payloadBueno(), llmBueno());
  cumpleEsquema(evaluacion);
  assert.equal(evaluacion.criterios.length, 69);
  assert.equal(evaluacion.id_evaluacion, 'EVAL-CONV-0101-reglas_ce_v1-evaluador_ce_v1');
  assert.equal(evaluacion.llave_dedup, 'CONV-0101|reglas_ce_v1|evaluador_ce_v1');
  assert.deepEqual(evaluacion.consumo, { tokens_entrada: 5000, tokens_salida: 900, intentos_llm: 1, anomalias_llm: [], costo_usd: 0.00095 });
  // Ninguna evidencia lleva datos personales sin enmascarar.
  const texto = JSON.stringify(evaluacion);
  for (const dato of ['TLA190211QM2', 'hector.villanueva@', 'Villanueva', 'Héctor']) assert.ok(!texto.includes(dato), dato);
});

test('pipeline con payload_ejemplo + llm_output_ejemplo del contrato cumple el esquema', () => {
  const { evaluacion } = evaluar(leerJSON('contrato/ejemplos/payload_ejemplo.json'), leerJSON('contrato/ejemplos/llm_output_ejemplo.json'));
  cumpleEsquema(evaluacion);
});

test('conversación sin mensajes del agente: coincide con contrato/ejemplos/evaluacion_sin_agente_ejemplo.json', () => {
  const ejemplo = leerJSON('contrato/ejemplos/evaluacion_sin_agente_ejemplo.json');
  // Insumo construido para el ejemplo: un solo mensaje del cliente, caso abierto con
  // campos obligatorios ausentes (así `solucion` queda no_cumple como en el ejemplo).
  const payload = payloadBase([['cliente', 131, 'Hola, ¿hay alguien? Necesito cancelar una factura.']], {
    estado_caso: 'abierto',
    campos_capturados: { uuid_factura: 'ausente', motivo_cancelacion: 'ausente' },
  });
  payload.conversation_id = 'CONV-0002';
  payload.agente = 'Nombre del agente';
  const { evaluacion } = evaluar(payload, null);
  cumpleEsquema(evaluacion);

  for (const campo of ['id_evaluacion', 'llave_dedup', 'conversation_id', 'lote', 'canal', 'tipo_interaccion', 'agente', 'cuenta_id', 'version_reglas', 'version_prompt', 'modelo_evaluador', 'tema_detectado', 'emocion_cliente', 'nota_base', 'nota_final', 'meta_calidad', 'cumple_meta', 'calidad', 'tiene_error_critico', 'sin_mensajes_agente', 'errores_criticos', 'consumo', 'marcas_tiempo']) {
    assert.deepEqual(evaluacion[campo], ejemplo[campo], campo);
  }
  // Secciones: resultado, peso y factor (ver reporte: los contadores del ejemplo son ilustrativos).
  assert.deepEqual(
    evaluacion.secciones.map((s) => [s.id_seccion, s.peso, s.resultado, s.factor]),
    ejemplo.secciones.map((s) => [s.id_seccion, s.peso, s.resultado, s.factor])
  );
  // Los 3 criterios que muestra el ejemplo, idénticos.
  for (const c of ejemplo.criterios) assert.deepEqual(criterio(evaluacion.criterios, c.id_criterio), c, c.id_criterio);
  assert.equal(evaluacion.criterios.length, 69);
});
