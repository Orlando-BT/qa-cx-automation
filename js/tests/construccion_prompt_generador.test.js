// Pruebas del prompt del generador (prompts/generador_ce_v1.md) y de su esquema
// simplificado (prompts/generador_payload_salida.schema.json).
// Ejecutar desde la raíz: node --test

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js4 = require('../construccion_prompt.js');
const { validarContraEsquema } = require('../validador_llm.js');
const { RAIZ } = require('./construccion_prompt_datos_referencia.js');

const PLANTILLA = fs.readFileSync(path.join(RAIZ, 'prompts', 'generador_ce_v1.md'), 'utf8');
const ESQUEMA_GEN = JSON.parse(fs.readFileSync(path.join(RAIZ, 'prompts', 'generador_payload_salida.schema.json'), 'utf8'));
const ESQUEMA_PAYLOAD = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'payload.schema.json'), 'utf8'));
const PAYLOAD_EJEMPLO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'ejemplos', 'payload_ejemplo.json'), 'utf8'));

const MARCADORES = [
  'CONVERSATION_ID',
  'TEMA_ESPERADO',
  'TIPIFICACION_ESPERADA',
  'CALIDAD_ESPERADA',
  'ERRORES_CRITICOS_INYECTADOS',
  'CRITERIOS_QUE_DEBEN_FALLAR',
  'CASOS_DIFICILES',
  'FECHA_HORA_INICIO',
  'CUENTA',
  'PARAMETROS_CONFIG',
  'FRASES_REFERENCIA',
  'CATALOGO_TEMAS',
  'BASE_CONOCIMIENTO',
];

// Convierte un payload del contrato a la forma de salida del generador
// (campos_capturados como lista). Es la inversa de lo que hará validador_payload.js.
function aFormaGenerador(payload) {
  const copia = JSON.parse(JSON.stringify(payload));
  copia.metadatos_caso.campos_capturados = Object.entries(payload.metadatos_caso.campos_capturados).map(([campo, estado]) => ({ campo, estado }));
  return copia;
}

test('la plantilla del generador tiene los bloques, la versión y todos los marcadores', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(PLANTILLA, 'generador_ce_v1');
  assert.ok(instrucciones.length > 1000);
  for (const m of MARCADORES) assert.ok(plantilla_entrada.includes(`<<${m}>>`), `falta <<${m}>>`);
  const valores = Object.fromEntries(MARCADORES.map((m) => [m, 'x']));
  assert.doesNotMatch(js4.llenarPlantillaEntrada(plantilla_entrada, valores), /<<[A-Z_]+>>/);
});

test('los bloques del generador se pueden pegar en n8n (sin comillas invertidas, ${ ni {{)', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(PLANTILLA, 'generador_ce_v1');
  for (const b of [instrucciones, plantilla_entrada]) {
    assert.ok(!b.includes('`'));
    assert.ok(!b.includes('${'));
    assert.ok(!b.includes('{{'));
  }
});

test('el prompt del generador cubre los 12 errores críticos y los 5 casos difíciles del contrato', () => {
  const { instrucciones } = js4.leerPlantilla(PLANTILLA, 'generador_ce_v1');
  const criticos = [
    'no_toma_a_tiempo', 'no_genera_caso', 'abandono', 'palabras_altisonantes', 'validacion_identidad', 'confidencialidad',
    'tipificacion_incorrecta', 'informacion_incorrecta', 'promesa_no_autorizada', 'negacion_servicio', 'mala_actitud',
    'comentarios_negativos_marca',
  ];
  for (const c of criticos) assert.ok(instrucciones.includes(`critico.${c}`), `falta critico.${c}`);
  for (const c of ['amable_no_resuelve', 'resuelve_tono_seco', 'critico_escondido', 'tipificacion_incorrecta', 'validacion_fuera_de_orden']) {
    assert.ok(instrucciones.includes(`${c}:`), `falta el caso difícil ${c}`);
  }
});

test('el esquema del generador solo usa palabras clave que acepta la salida estructurada de Anthropic', () => {
  const prohibidas = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'propertyNames', 'if', 'then', 'else', 'minItems', 'maxItems', '$ref'];
  function revisar(nodo, ruta) {
    if (!nodo || typeof nodo !== 'object') return;
    if (Array.isArray(nodo)) return nodo.forEach((x, i) => revisar(x, `${ruta}[${i}]`));
    for (const [k, v] of Object.entries(nodo)) {
      if (ruta.endsWith('.properties')) {
        revisar(v, `${ruta}.${k}`); // nombres de propiedades, no palabras clave
        continue;
      }
      assert.ok(!prohibidas.includes(k), `palabra clave no admitida "${k}" en ${ruta}`);
      if (k === 'additionalProperties') assert.equal(v, false, `additionalProperties distinto de false en ${ruta}`);
      if (k === 'type' && nodo.type === 'object') assert.equal(nodo.additionalProperties, false, `objeto sin additionalProperties false en ${ruta}`);
      revisar(v, `${ruta}.${k}`);
    }
  }
  revisar(ESQUEMA_GEN, '(raíz)');
});

test('el esquema del generador pide los mismos campos que el payload del contrato', () => {
  assert.deepEqual([...ESQUEMA_GEN.required].sort(), [...ESQUEMA_PAYLOAD.required].sort());
  assert.deepEqual(
    [...ESQUEMA_GEN.properties.metadatos_caso.required].sort(),
    [...ESQUEMA_PAYLOAD.properties.metadatos_caso.required].sort()
  );
  assert.deepEqual(
    [...ESQUEMA_GEN.properties.mensajes.items.required].sort(),
    [...ESQUEMA_PAYLOAD.properties.mensajes.items.required].sort()
  );
  assert.deepEqual(ESQUEMA_GEN.properties.metadatos_caso.properties.estado_caso.enum, ESQUEMA_PAYLOAD.properties.metadatos_caso.properties.estado_caso.enum);
  // No hay ningún campo para la verdad del escenario.
  const texto = JSON.stringify(Object.keys(ESQUEMA_GEN.properties));
  for (const k of ['calidad', 'critico', 'escenario', 'criterios', 'casos_dificiles']) assert.ok(!texto.includes(k));
});

test('el payload de ejemplo, convertido a la forma del generador, cumple el esquema del generador', () => {
  const errores = [];
  validarContraEsquema(aFormaGenerador(PAYLOAD_EJEMPLO), ESQUEMA_GEN, '', errores);
  assert.deepEqual(errores, []);
  const sinCaso = aFormaGenerador(PAYLOAD_EJEMPLO);
  sinCaso.metadatos_caso.numero_caso = null;
  sinCaso.metadatos_caso.estado_caso = 'sin_caso';
  validarContraEsquema(sinCaso, ESQUEMA_GEN, '', errores);
  assert.deepEqual(errores, []);
});

test('el esquema del generador rechaza campos_capturados como objeto y campos extra', () => {
  const errores = [];
  validarContraEsquema(PAYLOAD_EJEMPLO, ESQUEMA_GEN, '', errores); // forma del payload: objeto
  assert.ok(errores.some((e) => e.ruta === 'metadatos_caso.campos_capturados'));
  const extra = aFormaGenerador(PAYLOAD_EJEMPLO);
  extra.calidad_esperada = 'buena';
  const e2 = [];
  validarContraEsquema(extra, ESQUEMA_GEN, '', e2);
  assert.ok(e2.some((e) => e.ruta === 'calidad_esperada'));
  const numero = aFormaGenerador(PAYLOAD_EJEMPLO);
  numero.metadatos_caso.numero_caso = 58213;
  const e3 = [];
  validarContraEsquema(numero, ESQUEMA_GEN, '', e3);
  assert.ok(e3.some((e) => e.ruta === 'metadatos_caso.numero_caso'));
});
