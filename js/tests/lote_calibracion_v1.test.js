/**
 * Pruebas sobre el lote congelado datos/lotes/calibracion_v1/.
 * `_escenarios.json` (verdad del escenario) se usa SOLO aquí, en pruebas, para comparar.
 * Los juicios [LLM] no se prueban: se comparan resultados [JS] y, por separado, el
 * pipeline completo con insumos del LLM simulados de forma explícita (lote_simulacion.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DATOS, RAIZ, leerCSV, configCE, contextoHastaJS3, evaluar } = require('./ayudas');
const { llmSimulado, separar } = require('./lote_simulacion');
const { validarPayload, validarConEsquema } = require('../validador_payload');
const { textoLegible, metadatosCasoLegible } = require('../texto_legible');

const CARPETA = path.join(RAIZ, 'datos', 'lotes', 'calibracion_v1');
const ESCENARIOS = JSON.parse(fs.readFileSync(path.join(CARPETA, '_escenarios.json'), 'utf8'));
const REVISION = leerCSV(fs.readFileSync(path.join(CARPETA, 'revision_humana.csv'), 'utf8'));
const ESQUEMA_EVALUACION = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'evaluacion.schema.json'), 'utf8'));
const leerPayload = (id) => JSON.parse(fs.readFileSync(path.join(CARPETA, `${id}.json`), 'utf8'));
const falla = (c) => c.resultado === 'no_cumple' || c.resultado === 'detectado';

test('lote: 24 conversaciones, cada una con payload válido según el contrato', () => {
  const archivos = fs.readdirSync(CARPETA).filter((f) => /^CONV-\d+\.json$/.test(f));
  assert.equal(archivos.length, 24);
  assert.equal(ESCENARIOS.length, 24);
  for (const f of archivos) {
    const r = validarPayload(JSON.parse(fs.readFileSync(path.join(CARPETA, f), 'utf8')), { cuentas: DATOS.cuentas, config: configCE() });
    assert.deepEqual(r.errores, [], f);
  }
});

test('lote: texto_legible y metadatos_caso_legible coinciden con revision_humana.csv', () => {
  assert.equal(REVISION.length, 24);
  for (const fila of REVISION) {
    const p = leerPayload(fila.conversation_id);
    assert.equal(textoLegible(p.mensajes), fila.texto_legible, fila.conversation_id);
    assert.equal(metadatosCasoLegible(p.metadatos_caso), fila.metadatos_caso_legible, fila.conversation_id);
  }
});

test('lote: resultados [JS] de JS-3 coinciden con los criterios y críticos que declara cada escenario', () => {
  let acuerdos = 0;
  const desacuerdos = [];
  for (const e of ESCENARIOS) {
    const ctx = contextoHastaJS3(leerPayload(e.conversation_id));
    const fallar = new Set(separar(e.criterios_que_deben_fallar));
    const criticos = new Set(separar(e.errores_criticos_inyectados));
    for (const c of ctx.resultados_js.criterios) {
      const esperado = c.tipo_criterio === 'critico' ? criticos.has(c.id_criterio) : fallar.has(c.id_criterio);
      if (falla(c) === esperado) acuerdos++;
      else desacuerdos.push(`${e.conversation_id} ${c.id_criterio}: ${c.resultado}`);
    }
  }
  assert.deepEqual(desacuerdos, []);
  assert.equal(acuerdos, 24 * 37);
});

test('lote: pipeline completo con LLM simulado reproduce criterios, críticos, secciones, notas y calidad', () => {
  for (const e of ESCENARIOS) {
    const payload = leerPayload(e.conversation_id);
    const ctx = contextoHastaJS3(payload);
    const llm = ctx.resultados_js.variables.sin_mensajes_agente ? null : llmSimulado(e, ctx);
    const { evaluacion } = evaluar(payload, llm, { lote: 'calibracion_v1' });
    const id = e.conversation_id;
    assert.deepEqual(validarConEsquema(evaluacion, ESQUEMA_EVALUACION), [], id);

    const fallar = new Set(separar(e.criterios_que_deben_fallar));
    const criticos = new Set(separar(e.errores_criticos_inyectados));
    for (const c of evaluacion.criterios) {
      if (c.id_criterio === 'diagnostico.numero_preguntas') continue; // depende del mensaje de atención simulado
      const esperado = c.tipo_criterio === 'critico' ? criticos.has(c.id_criterio) : fallar.has(c.id_criterio);
      assert.equal(falla(c), esperado, `${id} ${c.id_criterio}: ${c.resultado}`);
    }
    assert.deepEqual(Object.fromEntries(evaluacion.secciones.map((s) => [s.id_seccion, s.resultado])), e.secciones_esperadas, id);
    assert.equal(evaluacion.nota_base, e.nota_esperada.nota_base, `${id} nota_base`);
    assert.equal(evaluacion.nota_final, e.nota_esperada.nota_final, `${id} nota_final`);
    assert.equal(evaluacion.calidad, e.calidad_esperada, `${id} calidad`);

    // Ningún dato personal de la cuenta llega sin enmascarar a la evaluación.
    const cuenta = DATOS.cuentas.find((c) => c.cuenta_id === payload.cuenta_id);
    const texto = JSON.stringify(evaluacion).toLowerCase();
    for (const dato of [cuenta.correo, cuenta.rfc, cuenta.telefono]) assert.ok(!texto.includes(dato.toLowerCase()), `${id}: dato personal en la evaluación`);
  }
});
