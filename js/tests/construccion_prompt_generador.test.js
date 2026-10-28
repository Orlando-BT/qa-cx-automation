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

// --- Petición a la Messages API de Anthropic (W0, paso 3) --------------------------------
// Sin llamadas reales: solo se revisa la forma del cuerpo y la lectura de respuestas de ejemplo.

const { configCE } = require('./ayudas.js');
const VALORES = Object.fromEntries(MARCADORES.map((m) => [m, `valor de ${m}`]));
const PLANTILLA_V2 = fs.readFileSync(path.join(RAIZ, 'prompts', 'generador_ce_v2.md'), 'utf8');
const MARCADORES_V2 = [...MARCADORES, 'TIPIFICACION_AGENTE', 'VARIANTE_IDENTIDAD'];
const VALORES_V2 = Object.fromEntries(MARCADORES_V2.map((m) => [m, `valor de ${m}`]));
const CONFIG_GEN = { modelo_generador: 'claude-haiku-5-5', version_prompt_generador: 'generador_ce_v1', max_tokens_generador: '8000', esfuerzo_generador: 'medium' };

function peticionGen(extra = {}) {
  return js4.construirPeticionGenerador({ plantilla: PLANTILLA, esquema: ESQUEMA_GEN, valores: VALORES, config: CONFIG_GEN, ...extra });
}

test('construirPeticionGenerador arma el cuerpo de la Messages API con output_config.format json_schema', () => {
  const c = peticionGen();
  assert.deepEqual(Object.keys(c).sort(), ['max_tokens', 'messages', 'model', 'output_config', 'system']);
  assert.equal(c.model, 'claude-haiku-5-5');
  assert.strictEqual(c.max_tokens, 8000);
  const { instrucciones } = js4.leerPlantilla(PLANTILLA, 'generador_ce_v1');
  assert.equal(c.system, instrucciones);
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].role, 'user');
  assert.match(c.messages[0].content, /valor de CONVERSATION_ID/);
  assert.doesNotMatch(c.messages[0].content, /<<[A-Z_]+>>/);
  assert.deepEqual(c.output_config, { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA_GEN } });
  assert.notEqual(c.output_config.format.schema, ESQUEMA_GEN); // copia, no la misma referencia
});

test('construirPeticionGenerador no envía temperature, top_p, top_k, output_format ni prefill', () => {
  const c = peticionGen();
  for (const k of ['temperature', 'top_p', 'top_k', 'output_format', 'thinking', 'stop_sequences']) assert.equal(k in c, false, k);
  assert.ok(c.messages.every((m) => m.role !== 'assistant'));
  // El cuerpo no lleva credenciales (x-api-key va en el encabezado, desde la credencial de n8n).
  assert.doesNotMatch(JSON.stringify(c), /api[_-]?key|sk-ant/i);
});

test('construirPeticionGenerador con las filas reales de datos/config.csv', () => {
  const config = configCE();
  // La plantilla es la de config.version_prompt_generador (v2 desde el 24-oct-2026).
  const plantilla = fs.readFileSync(path.join(RAIZ, 'prompts', `${config.version_prompt_generador}.md`), 'utf8');
  const c = peticionGen({ config, plantilla, valores: VALORES_V2 });
  assert.equal(c.model, 'claude-haiku-5-5');
  assert.strictEqual(c.max_tokens, 8000);
  assert.equal(c.output_config.effort, 'medium'); // esfuerzo_generador (ce)
  assert.equal('anthropic_version_api' in c, false); // va en el encabezado, no en el cuerpo
  assert.equal(config.anthropic_version_api, '2026-10-21');
});

test('construirPeticionGenerador envía effort de config junto con format; acepta los cinco niveles', () => {
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const c = peticionGen({ config: { ...CONFIG_GEN, esfuerzo_generador: e } });
    assert.equal(c.output_config.effort, e);
    assert.equal(c.output_config.format.type, 'json_schema');
  }
});

test('construirPeticionGenerador falla si esfuerzo_generador falta o no está en la lista', () => {
  for (const malo of [undefined, '', null, 'none', 'Medium', 'alto', 3]) {
    assert.throws(
      () => peticionGen({ config: { ...CONFIG_GEN, esfuerzo_generador: malo } }),
      /config.esfuerzo_generador debe ser uno de low|medium|high|xhigh|max/,
      `debió fallar con ${JSON.stringify(malo)}`
    );
  }
});

test('construirPeticionGenerador falla con config incompleta o plantilla de otra versión', () => {
  assert.throws(() => peticionGen({ config: { ...CONFIG_GEN, modelo_generador: 'por_verificar' } }), /por_verificar/);
  assert.throws(() => peticionGen({ config: { ...CONFIG_GEN, modelo_generador: '' } }), /modelo_generador/);
  assert.throws(() => peticionGen({ config: { ...CONFIG_GEN, version_prompt_generador: 'sin_rubrica' } }), /version_prompt_generador/);
  assert.throws(() => peticionGen({ config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v2' } }), /no corresponde/);
  for (const malo of [undefined, '', 0, '8000.5', 'mucho']) {
    assert.throws(() => peticionGen({ config: { ...CONFIG_GEN, max_tokens_generador: malo } }), /config\.max_tokens_generador debe ser un entero positivo/);
  }
  const incompletos = { ...VALORES };
  delete incompletos.CUENTA;
  assert.throws(() => peticionGen({ valores: incompletos }), /<<CUENTA>>/);
  assert.throws(() => peticionGen({ esquema: null }), /esquema/);
  assert.throws(() => peticionGen({ config: undefined }), /config/);
});

test('construirPeticionGenerador no modifica sus entradas', () => {
  const esquema = JSON.parse(JSON.stringify(ESQUEMA_GEN));
  const antes = JSON.stringify(esquema);
  const c = peticionGen({ esquema });
  c.output_config.format.schema.properties.canal = 'cambiado';
  assert.equal(JSON.stringify(esquema), antes);
});

// Respuestas de ejemplo con la forma documentada (content[], stop_reason, usage).
const SALIDA_OK = aFormaGenerador(PAYLOAD_EJEMPLO);
function respuesta(extra = {}) {
  return {
    id: 'msg_ejemplo',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'firma-cifrada' }, // display "omitted" por defecto
      { type: 'text', text: JSON.stringify(SALIDA_OK) },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 11000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 3200,
      output_tokens_details: { thinking_tokens: 400 },
    },
    ...extra,
  };
}

test('leerRespuestaGenerador: respuesta completa, ignora el bloque thinking y lee el uso', () => {
  const l = js4.leerRespuestaGenerador(respuesta());
  assert.equal(l.completa, true);
  assert.equal(l.motivo, null);
  assert.equal(l.stop_reason, 'end_turn');
  assert.deepEqual(l.salida, SALIDA_OK);
  assert.equal(l.texto, JSON.stringify(SALIDA_OK));
  assert.strictEqual(l.tokens_entrada, 11000);
  assert.strictEqual(l.tokens_salida, 3200); // incluye razonamiento: es lo que se cobra
  assert.strictEqual(l.tokens_razonamiento, 400);
  assert.deepEqual(l.bloques_por_tipo, { thinking: 1, text: 1 });
  assert.equal(l.categoria_rechazo, null);
  // La salida leída cumple el esquema del generador.
  const errores = [];
  validarContraEsquema(l.salida, ESQUEMA_GEN, '', errores);
  assert.deepEqual(errores, []);
});

test('leerRespuestaGenerador: tokens de entrada suman los de caché; sin usage -> null', () => {
  const l = js4.leerRespuestaGenerador(respuesta({ usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: null, output_tokens: 10 } }));
  assert.strictEqual(l.tokens_entrada, 150);
  assert.strictEqual(l.tokens_razonamiento, null);
  const s = js4.leerRespuestaGenerador(respuesta({ usage: undefined }));
  assert.strictEqual(s.tokens_entrada, null);
  assert.strictEqual(s.tokens_salida, null);
  assert.equal(s.completa, true); // el uso no decide si la generación sirve
});

test('leerRespuestaGenerador: max_tokens y refusal no son completas aunque traigan texto', () => {
  const corta = js4.leerRespuestaGenerador(respuesta({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"conversation_id": "CONV-00' }] }));
  assert.equal(corta.completa, false);
  assert.equal(corta.motivo, 'max_tokens');
  assert.equal(corta.salida, null);
  const rechazo = js4.leerRespuestaGenerador(
    respuesta({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'Texto libre de la API.' } })
  );
  assert.equal(rechazo.completa, false);
  assert.equal(rechazo.motivo, 'refusal');
  assert.equal(rechazo.categoria_rechazo, 'cyber');
  assert.doesNotMatch(JSON.stringify(rechazo), /Texto libre/);
});

test('leerRespuestaGenerador: sin texto, varios bloques de texto, JSON inválido y stop_reason inesperado', () => {
  assert.equal(js4.leerRespuestaGenerador(respuesta({ content: [{ type: 'thinking', thinking: '' }] })).motivo, 'sin_texto');
  const dos = js4.leerRespuestaGenerador(respuesta({ content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] }));
  assert.equal(dos.motivo, 'varios_bloques_texto');
  assert.equal(dos.texto, ''); // no se concatenan
  assert.equal(js4.leerRespuestaGenerador(respuesta({ content: [{ type: 'text', text: 'Aquí está la conversación: {' }] })).motivo, 'json_invalido');
  assert.equal(js4.leerRespuestaGenerador(respuesta({ content: [{ type: 'text', text: '[1, 2]' }] })).motivo, 'json_invalido');
  assert.equal(js4.leerRespuestaGenerador(respuesta({ stop_reason: 'pause_turn' })).motivo, 'stop_reason_pause_turn');
  assert.equal(js4.leerRespuestaGenerador(respuesta({ stop_reason: 'Algo Raro!' })).motivo, 'stop_reason_otro');
  const vacia = js4.leerRespuestaGenerador(null);
  assert.equal(vacia.completa, false);
  assert.equal(vacia.motivo, 'stop_reason_ausente');
});

// --- generador_ce_v2 (24-oct-2026): dos marcadores nuevos ---------------------------------------

test('v2: bloques, versión y los 15 marcadores; todos se llenan y no queda ninguno', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(PLANTILLA_V2, 'generador_ce_v2');
  const encontrados = [...new Set(plantilla_entrada.match(/<<[A-Z_]+>>/g).map((m) => m.slice(2, -2)))].sort();
  assert.deepEqual(encontrados, [...MARCADORES_V2].sort());
  const c = peticionGen({ plantilla: PLANTILLA_V2, valores: VALORES_V2, config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v2' } });
  assert.doesNotMatch(c.messages[0].content, /<<[A-Z_]+>>/);
  assert.match(c.messages[0].content, /Tipificación que registra el agente: valor de TIPIFICACION_AGENTE/);
  assert.match(c.messages[0].content, /Variante de identidad: valor de VARIANTE_IDENTIDAD/);
  assert.equal(c.system, instrucciones);
  // Con los 13 marcadores de v1 falta llenar los nuevos: error explícito.
  assert.throws(
    () => peticionGen({ plantilla: PLANTILLA_V2, valores: VALORES, config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v2' } }),
    /marcador sin llenar: <<(TIPIFICACION_AGENTE|VARIANTE_IDENTIDAD)>>/
  );
});

test('v2: instrucciones con reglas para TIPIFICACION_AGENTE y VARIANTE_IDENTIDAD, pegables en n8n', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(PLANTILLA_V2, 'generador_ce_v2');
  assert.match(instrucciones, /tipificacion_agente = TIPIFICACION_AGENTE/);
  assert.match(instrucciones, /VARIANTE_IDENTIDAD = datos_coinciden_sin_critico/);
  assert.match(instrucciones, /VARIANTE_IDENTIDAD = ninguna/);
  assert.doesNotMatch(instrucciones, /tipificacion_agente = TIPIFICACION_ESPERADA/);
  for (const b of [instrucciones, plantilla_entrada]) {
    assert.ok(!b.includes('`'));
    assert.ok(!b.includes('${'));
    assert.ok(!b.includes('{{'));
  }
  // Sigue cubriendo los 12 críticos y los 5 casos difíciles de v1.
  for (const c of ['critico.tipificacion_incorrecta', 'critico.validacion_identidad', 'critico.comentarios_negativos_marca']) assert.ok(instrucciones.includes(c));
  for (const c of ['amable_no_resuelve:', 'resuelve_tono_seco:', 'critico_escondido:', 'tipificacion_incorrecta:', 'validacion_fuera_de_orden:']) assert.ok(instrucciones.includes(c));
});

test('v2 solo agrega lo necesario: fuera de las líneas cambiadas, los bloques son iguales a v1', () => {
  const v1 = js4.leerPlantilla(PLANTILLA, 'generador_ce_v1');
  const v2 = js4.leerPlantilla(PLANTILLA_V2, 'generador_ce_v2');
  const lineas1 = new Set((v1.instrucciones + '\n' + v1.plantilla_entrada).split('\n'));
  const lineas2 = (v2.instrucciones + '\n' + v2.plantilla_entrada).split('\n');
  const nuevas = lineas2.filter((l) => !lineas1.has(l));
  // 4 reglas reescritas + 2 reglas de VARIANTE_IDENTIDAD + regla de campos_capturados + 2 líneas de entrada.
  assert.ok(nuevas.length <= 9, `demasiadas líneas nuevas: ${nuevas.length}`);
  for (const l of nuevas) assert.match(l, /TIPIFICACION_AGENTE|VARIANTE_IDENTIDAD/);
});

test('v1 sigue cargando cuando config apunta a generador_ce_v1', () => {
  const c = peticionGen({ config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v1' } });
  assert.equal(c.system, js4.leerPlantilla(PLANTILLA, 'generador_ce_v1').instrucciones);
  // Plantilla y versión cruzadas: se detiene.
  assert.throws(() => peticionGen({ plantilla: PLANTILLA_V2, valores: VALORES_V2, config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v1' } }), /no corresponde/);
  assert.throws(() => peticionGen({ config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v2' } }), /no corresponde/);
});

test('valoresExtrasGenerador: tipificación del agente y variante de identidad a partir de extras', () => {
  const sinCritico = js4.valoresExtrasGenerador({ tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: false }, 'Cancelación de CFDI');
  assert.deepEqual(sinCritico, { TIPIFICACION_AGENTE: 'Cancelación de CFDI', VARIANTE_IDENTIDAD: 'ninguna' });
  const conCritico = js4.valoresExtrasGenerador({ tipificacion_agente_prevista: 'Permisos de usuario', variante_datos_coinciden_sin_critico: true }, 'Cancelación de CFDI');
  assert.deepEqual(conCritico, { TIPIFICACION_AGENTE: 'Permisos de usuario', VARIANTE_IDENTIDAD: 'datos_coinciden_sin_critico' });
  assert.throws(() => js4.valoresExtrasGenerador(null, 'x'), /extras/);
  assert.throws(() => js4.valoresExtrasGenerador({ tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: false }, ''), /tipificación esperada/);
  assert.throws(() => js4.valoresExtrasGenerador({ tipificacion_agente_prevista: '', variante_datos_coinciden_sin_critico: false }, 'x'), /tipificacion_agente_prevista/);
  assert.throws(() => js4.valoresExtrasGenerador({ tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: 'si' }, 'x'), /variante_datos_coinciden_sin_critico/);
});

test('v2 con extras en la forma documentada de completarEscenario: los marcadores nuevos se llenan', () => {
  // Usa la forma documentada de extras; no depende de los sorteos.
  const extras = { fecha_hora_inicio: '2026-10-24T10:00:00', tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: false };
  const valores = { ...VALORES, ...js4.valoresExtrasGenerador(extras, 'valor de TIPIFICACION_ESPERADA') };
  const c = peticionGen({ plantilla: PLANTILLA_V2, valores, config: { ...CONFIG_GEN, version_prompt_generador: 'generador_ce_v2' } });
  assert.match(c.messages[0].content, /Tipificación que registra el agente: valor de TIPIFICACION_ESPERADA/);
  assert.match(c.messages[0].content, /Variante de identidad: ninguna/);
});

// --- valoresGenerador: los 15 marcadores desde datos de referencia --------------------------
// Datos: contrato/ejemplos/payload_ejemplo.json (cuenta y tema) + datos/*.csv y
// datos/base_conocimiento.md (nunca datos/lotes/).

const { DATOS } = require('./ayudas.js');
const BASE_GEN = require('./construccion_prompt_datos_referencia.js').cargarBase();
const CUENTA_EJEMPLO = DATOS.cuentas.find((c) => c.cuenta_id === PAYLOAD_EJEMPLO.cuenta_id);
const ESCENARIO_EJEMPLO = {
  conversation_id: PAYLOAD_EJEMPLO.conversation_id,
  lote: 'demo',
  tipo_interaccion: 'ce',
  calidad_esperada: 'buena',
  tema_esperado: DATOS.catalogo.find((f) => f.tipificacion_valida === PAYLOAD_EJEMPLO.metadatos_caso.tipificacion_agente).tema,
  tipificacion_esperada: PAYLOAD_EJEMPLO.metadatos_caso.tipificacion_agente,
  errores_criticos_inyectados: [],
  criterios_que_deben_fallar: [],
  casos_dificiles: [],
  cuenta_id: PAYLOAD_EJEMPLO.cuenta_id,
};
const EXTRAS_EJEMPLO = { fecha_hora_inicio: PAYLOAD_EJEMPLO.mensajes[0].timestamp, tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: false };
const datosValores = (extra = {}) => ({
  escenario: ESCENARIO_EJEMPLO,
  extras: EXTRAS_EJEMPLO,
  cuenta: CUENTA_EJEMPLO,
  catalogo_temas: DATOS.catalogo,
  base_conocimiento: BASE_GEN,
  listas: DATOS.listas,
  config: configCE(),
  tipo_interaccion: 'ce',
  ...extra,
});

test('valoresGenerador devuelve exactamente los 15 marcadores de v2 y la plantilla llenada no deja <<', () => {
  const v = js4.valoresGenerador(datosValores());
  assert.deepEqual(Object.keys(v).sort(), [...MARCADORES_V2].sort());
  for (const [k, x] of Object.entries(v)) assert.ok(typeof x === 'string' && x.trim() !== '', `${k} vacío`);
  const config = { ...configCE(), version_prompt_generador: 'generador_ce_v2' };
  const c = peticionGen({ plantilla: PLANTILLA_V2, valores: v, config });
  assert.doesNotMatch(c.messages[0].content, /<<|>>/);
  // También llena v1 (con sus 13 marcadores).
  const v1 = Object.fromEntries(MARCADORES.map((m) => [m, v[m]]));
  assert.doesNotMatch(peticionGen({ valores: v1 }).messages[0].content, /<<|>>/);
});

test('valoresGenerador: formatos de la tabla de marcadores', () => {
  const v = js4.valoresGenerador(datosValores());
  assert.equal(v.CONVERSATION_ID, PAYLOAD_EJEMPLO.conversation_id);
  assert.equal(v.CUENTA.split('\n').length, 8);
  assert.equal(v.CUENTA.split('\n')[0], `cuenta_id: ${CUENTA_EJEMPLO.cuenta_id}`);
  assert.match(v.CUENTA, new RegExp(`^rfc: ${CUENTA_EJEMPLO.rfc}$`, 'm'));
  assert.match(v.FECHA_HORA_INICIO, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(v.CALIDAD_ESPERADA, 'buena');
  for (const k of ['ERRORES_CRITICOS_INYECTADOS', 'CRITERIOS_QUE_DEBEN_FALLAR', 'CASOS_DIFICILES']) assert.equal(v[k], 'ninguno');
  assert.equal(v.TIPIFICACION_AGENTE, ESCENARIO_EJEMPLO.tipificacion_esperada);
  assert.equal(v.VARIANTE_IDENTIDAD, 'ninguna');
  // Catálogo: una línea por fila activa (ce ∪ todos), 5 columnas separadas por " | ".
  const activas = DATOS.catalogo.filter((f) => (f.tipo_interaccion === 'ce' || f.tipo_interaccion === 'todos') && f.activo === 'si');
  const lineas = v.CATALOGO_TEMAS.split('\n');
  assert.equal(lineas.length, activas.length);
  assert.ok(lineas.every((l) => l.split(' | ').length === 5));
  assert.equal(lineas[0], [activas[0].tema, activas[0].tipificacion_valida, activas[0].requiere_escalamiento, activas[0].campos_obligatorios.split('|').join(', '), activas[0].id_articulo].join(' | '));
  assert.equal(v.BASE_CONOCIMIENTO, js4.formatearBaseConocimiento(BASE_GEN, 'ce'));
  // Frases: "clave: v1 | v2", solo los 5 tipos de lista del generador.
  const fr = v.FRASES_REFERENCIA.split('\n');
  assert.ok(fr.some((l) => l.startsWith('saludo: ')));
  assert.ok(fr.every((l) => /^[a-z_]+: /.test(l)));
  const sigla = DATOS.listas.find((f) => f.tipo_lista === 'sigla_permitida');
  if (sigla) assert.ok(!fr.some((l) => l.startsWith(`${sigla.clave_lista}: `)), 'sigla_permitida no va al generador');
  const regex = DATOS.listas.find((f) => f.es_regex === 'si' && f.activo === 'si' && f.tipo_interaccion !== 'sales');
  if (regex) assert.ok(v.FRASES_REFERENCIA.includes(`${regex.valor} (regex)`));
  // Config: 19 claves, booleanos como si/no y listas con ", ".
  const pc = v.PARAMETROS_CONFIG.split('\n');
  assert.equal(pc.length, 19);
  assert.match(v.PARAMETROS_CONFIG, /^marca: Contamix$/m);
  assert.match(v.PARAMETROS_CONFIG, /^campana_vigente_activa: (si|no)$/m);
  assert.match(v.PARAMETROS_CONFIG, /^rfc_genericos_permitidos: XAXX010101000, XEXX010101000$/m);
});

test('valoresGenerador con un escenario real de completarEscenario (js/simulador.js)', () => {
  const S = require('../simulador.js');
  let i = 0;
  const valores = [0.99, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const r = S.completarEscenario(
    { tipo_interaccion: 'ce', tema: null, calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.tipificacion_incorrecta'], cantidad: 1, lote: 'demo' },
    { config: configCE(), catalogo: DATOS.catalogo, cuentas: DATOS.cuentas, conversationId: 'CONV-0300', aleatorio: () => valores[i++ % valores.length], ahora: new Date('2026-10-21T16:00:00Z') }
  );
  assert.equal(r.valido, true, (r.errores || []).join(' | '));
  const v = js4.valoresGenerador({ ...datosValores(), escenario: r.escenario, extras: r.extras, cuenta: r.cuenta });
  assert.equal(v.ERRORES_CRITICOS_INYECTADOS, 'critico.tipificacion_incorrecta');
  assert.equal(v.TIPIFICACION_AGENTE, r.extras.tipificacion_agente_prevista);
  assert.notEqual(v.TIPIFICACION_AGENTE, v.TIPIFICACION_ESPERADA);
  const c = peticionGen({ plantilla: PLANTILLA_V2, valores: v, config: { ...configCE(), version_prompt_generador: 'generador_ce_v2' } });
  assert.doesNotMatch(c.messages[0].content, /<<|>>/);
});

test('valoresGenerador: listas con valores y errores explícitos por datos faltantes', () => {
  const esc = { ...ESCENARIO_EJEMPLO, calidad_esperada: 'mala', errores_criticos_inyectados: ['critico.abandono', 'critico.mala_actitud'], casos_dificiles: 'critico_escondido' };
  const v = js4.valoresGenerador(datosValores({ escenario: esc }));
  assert.equal(v.ERRORES_CRITICOS_INYECTADOS, 'critico.abandono, critico.mala_actitud');
  assert.equal(v.CASOS_DIFICILES, 'critico_escondido');
  assert.throws(() => js4.valoresGenerador(datosValores({ escenario: { ...ESCENARIO_EJEMPLO, calidad_esperada: 'aleatoria' } })), /calidad_esperada/);
  const sinRfc = { ...CUENTA_EJEMPLO };
  delete sinRfc.rfc;
  assert.throws(() => js4.valoresGenerador(datosValores({ cuenta: sinRfc })), /cuenta\.rfc/);
  const cfg = configCE();
  delete cfg.marca;
  assert.throws(() => js4.valoresGenerador(datosValores({ config: cfg })), /config\.marca/);
  assert.throws(() => js4.valoresGenerador(datosValores({ extras: { ...EXTRAS_EJEMPLO, fecha_hora_inicio: '' } })), /fecha_hora_inicio/);
  assert.throws(() => js4.valoresGenerador(datosValores({ listas: [] })), /frases activas/);
  assert.throws(() => js4.valoresGenerador(datosValores({ escenario: undefined })), /escenario/);
});
