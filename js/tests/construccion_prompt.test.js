// Pruebas de JS-4 (js/construccion_prompt.js) y de la plantilla
// prompts/evaluador_ce_v1.md. Ejecutar desde la raíz: node --test

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const js4 = require('../construccion_prompt.js');
const datos = require('./construccion_prompt_datos_referencia.js');

const ESQUEMA = datos.cargarEsquemaLlm();
const CATALOGO = datos.cargarCatalogo();
const BASE = datos.cargarBase();
const PLANTILLA = datos.cargarPlantillaEvaluador('evaluador_ce_v1');

function datosPeticion(extra = {}) {
  return {
    plantilla: PLANTILLA,
    esquema: ESQUEMA,
    mensajes: datos.CONVERSACION_EJEMPLO,
    termina_por_inactividad: false,
    catalogo_temas: CATALOGO,
    base_conocimiento: BASE,
    tipo_interaccion: 'ce',
    config: { ...datos.CONFIG_EJEMPLO },
    ...extra,
  };
}

// --- Plantilla versionada -------------------------------------------------------

test('la plantilla v1 tiene los dos bloques y los cuatro marcadores', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(PLANTILLA, 'evaluador_ce_v1');
  assert.ok(instrucciones.length > 1000);
  for (const m of ['<<CATALOGO_TEMAS>>', '<<BASE_CONOCIMIENTO>>', '<<TERMINA_POR_INACTIVIDAD>>', '<<CONVERSACION>>']) {
    assert.ok(plantilla_entrada.includes(m), `falta ${m}`);
  }
});

test('los bloques no tienen comillas invertidas ni "${" (se pueden pegar en n8n)', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(PLANTILLA, 'evaluador_ce_v1');
  for (const bloque of [instrucciones, plantilla_entrada]) {
    assert.ok(!bloque.includes('`'), 'hay una comilla invertida');
    assert.ok(!bloque.includes('${'), 'hay una secuencia ${');
    assert.ok(!bloque.includes('{{'), 'hay {{ (n8n lo interpretaría como expresión)');
  }
});

test('las instrucciones cubren todos los campos de criterios, emociones y gravedades del esquema', () => {
  const { instrucciones } = js4.leerPlantilla(PLANTILLA, 'evaluador_ce_v1');
  const secciones = ESQUEMA.properties.criterios.properties;
  for (const [seccion, def] of Object.entries(secciones)) {
    for (const sub of Object.keys(def.properties)) {
      assert.ok(instrucciones.includes(sub), `el prompt no menciona ${seccion}.${sub}`);
    }
  }
  for (const emo of ESQUEMA.properties.emocion_cliente.properties.emocion.enum) {
    assert.ok(instrucciones.includes(emo), `el prompt no menciona la emoción ${emo}`);
  }
  for (const critico of Object.keys(ESQUEMA.properties.criticos_posibles.properties)) {
    assert.ok(instrucciones.includes(critico), `el prompt no menciona el crítico ${critico}`);
  }
  for (const clave of ['grave', 'menor', 'primer_mensaje_info_cuenta', 'situacion_requiere_escalamiento', 'uso_correcto', 'problema_resuelto_en_conversacion', 'mensajes_atencion', 'articulos_base_usados']) {
    assert.ok(instrucciones.includes(clave), `el prompt no menciona ${clave}`);
  }
});

test('las instrucciones no piden nota, ponderación ni resultado de sección', () => {
  const { instrucciones } = js4.leerPlantilla(PLANTILLA, 'evaluador_ce_v1');
  assert.match(instrucciones, /NO calculas notas/);
  assert.doesNotMatch(instrucciones, /\bparcial\b/); // el LLM nunca usa el resultado "parcial"
});

test('leerPlantilla detiene si la versión no coincide (v1 pegada con config v2, o v1 vs v10)', () => {
  assert.throws(() => js4.leerPlantilla(PLANTILLA, 'evaluador_ce_v2'), /no corresponde a evaluador_ce_v2/);
  const falsa = PLANTILLA.replace('evaluador_ce_v1', 'evaluador_ce_v10');
  assert.throws(() => js4.leerPlantilla(falsa, 'evaluador_ce_v1'), /no corresponde/);
});

test('leerPlantilla detiene si faltan delimitadores', () => {
  assert.throws(() => js4.leerPlantilla('# evaluador_ce_v1\nsin bloques', 'evaluador_ce_v1'), /INSTRUCCIONES/);
});

test('leerPlantilla tolera saltos de línea de Windows', () => {
  const crlf = PLANTILLA.replace(/\n/g, '\r\n');
  const { instrucciones } = js4.leerPlantilla(crlf, 'evaluador_ce_v1');
  assert.ok(instrucciones.length > 1000);
});

// --- Catálogo, base y conversación -------------------------------------------------

test('formatearCatalogo: un tema por línea, sin repetir, con su artículo', () => {
  const texto = js4.formatearCatalogo(CATALOGO, 'ce');
  const temas = [...new Set(CATALOGO.map((f) => f.tema))];
  assert.equal(texto.split('\n').length, temas.length);
  assert.match(texto, /^- Cancelación de CFDI \(artículo principal: KB-02\)$/m);
});

test('filtrarPorTipo: une el tipo con "todos" y excluye otros tipos; el catálogo excluye inactivos', () => {
  const filas = [
    { tema: 'A', tipo_interaccion: 'ce', activo: 'si', id_articulo: 'KB-01' },
    { tema: 'B', tipo_interaccion: 'todos', activo: 'si', id_articulo: 'KB-02' },
    { tema: 'C', tipo_interaccion: 'sales', activo: 'si', id_articulo: 'KB-03' },
    { tema: 'D', tipo_interaccion: 'ce', activo: 'no', id_articulo: 'KB-04' },
  ];
  assert.deepEqual(js4.filtrarPorTipo(filas, 'ce').map((f) => f.tema), ['A', 'B', 'D']);
  const texto = js4.formatearCatalogo(filas, 'ce');
  assert.match(texto, /- A /);
  assert.match(texto, /- B /);
  assert.doesNotMatch(texto, /- C /);
  assert.doesNotMatch(texto, /- D /);
});

test('formatearBaseConocimiento incluye los 8 artículos completos y marca celdas vacías', () => {
  const texto = js4.formatearBaseConocimiento(BASE, 'ce');
  for (let i = 1; i <= 8; i++) assert.match(texto, new RegExp(`^## KB-0${i} \\|`, 'm'));
  assert.match(texto, /Casos de escalamiento: \(sin información\)/); // KB-03 no tiene casos
  assert.match(texto, /Cierre Fiscal Contamix 2026/); // promoción de KB-08
});

test('formatearConversacion: ordena por n, numera y sangra saltos de línea', () => {
  const texto = js4.formatearConversacion([
    { n: 2, emisor: 'agente', texto: 'Paso 1\nPaso 2' },
    { n: 1, emisor: 'cliente', texto: 'Hola' },
  ]);
  assert.equal(texto, '[1] cliente: Hola\n[2] agente: Paso 1\n    Paso 2');
});

test('formatearConversacion: sin mensajes del agente no se llama al LLM (rubrica.md 3.12)', () => {
  assert.throws(() => js4.formatearConversacion([{ n: 1, emisor: 'cliente', texto: 'Hola' }]), /3\.12/);
});

test('formatearConversacion rechaza emisor o número inválidos', () => {
  assert.throws(() => js4.formatearConversacion([{ n: 1, emisor: 'bot', texto: 'x' }]), /emisor/);
  assert.throws(() => js4.formatearConversacion([{ n: 0, emisor: 'agente', texto: 'x' }]), /número/);
});

test('llenarPlantillaEntrada conserva "$" del texto y detecta marcadores sin llenar', () => {
  const t = js4.llenarPlantillaEntrada('A <<X>> B', { X: 'cuesta $& y $1' });
  assert.equal(t, 'A cuesta $& y $1 B');
  assert.throws(() => js4.llenarPlantillaEntrada('A <<X>> <<Y>>', { X: '1' }), /<<Y>>/);
  assert.throws(() => js4.llenarPlantillaEntrada('A', { X: '1' }), /<<X>>/);
});

// --- Petición completa ---------------------------------------------------------------

test('construirPeticion arma el cuerpo de la API Responses con temperatura 0', () => {
  const c = js4.construirPeticion(datosPeticion());
  assert.equal(c.model, 'gpt-6-luna');
  assert.equal(c.temperature, 0);
  assert.equal(c.reasoning, undefined);
  assert.equal(c.store, false);
  assert.strictEqual(c.max_output_tokens, 8000); // Fase 2: siempre se envía, desde config.max_tokens_evaluador
  assert.equal(c.text.format.type, 'json_schema');
  assert.equal(c.text.format.strict, true);
  assert.equal(c.text.format.name, 'evaluacion_ce');
  assert.deepEqual(c.text.format.schema, ESQUEMA); // sin claves a quitar, el esquema va tal cual
  assert.equal(c.instructions, js4.leerPlantilla(PLANTILLA).instrucciones);
  assert.equal(c.input.length, 1);
  assert.equal(c.input[0].role, 'user');

  const entrada = c.input[0].content;
  assert.doesNotMatch(entrada, /<<[A-Z_]+>>/);
  assert.match(entrada, /TERMINA_POR_INACTIVIDAD: false/);
  assert.match(entrada, /^\[1\] cliente: Hola, soy \[NOMBRE_1\]/m);
  assert.match(entrada, /^\[2\] agente: /m);
  assert.doesNotMatch(entrada, /2026-10-21T10:02:11/); // sin timestamps
  // Orden pensado para el caché: catálogo, base y al final la conversación.
  const iCat = entrada.indexOf('- Cancelación de CFDI');
  const iBase = entrada.indexOf('## KB-01');
  const iConv = entrada.indexOf('[1] cliente');
  assert.ok(iCat < iBase && iBase < iConv);
});

test('construirPeticion no envía metadatos_caso ni la tipificación del agente', () => {
  const c = js4.construirPeticion(datosPeticion());
  const todo = JSON.stringify({ i: c.instructions, e: c.input });
  assert.doesNotMatch(todo, /tipificacion_agente/);
  assert.doesNotMatch(todo, /CASO-\d{5}/);
});

test('construirPeticion con termina_por_inactividad = true', () => {
  const c = js4.construirPeticion(datosPeticion({ termina_por_inactividad: true }));
  assert.match(c.input[0].content, /TERMINA_POR_INACTIVIDAD: true/);
});

test('construirPeticion con esfuerzo de razonamiento: sin temperature', () => {
  const c = js4.construirPeticion(datosPeticion(), { esfuerzo_razonamiento: 'none', max_tokens_salida: 8000 });
  assert.deepEqual(c.reasoning, { effort: 'none' });
  assert.equal('temperature' in c, false);
  assert.equal(c.max_output_tokens, 8000);
});

test('construirPeticion siempre envía max_output_tokens desde config.max_tokens_evaluador', () => {
  // Texto crudo de Sheets ("8000") o número ya convertido por JS-1 (8000).
  for (const valor of ['8000', 8000, ' 8000 ']) {
    const c = js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, max_tokens_evaluador: valor } }));
    assert.strictEqual(c.max_output_tokens, 8000);
  }
  const c2 = js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, max_tokens_evaluador: 1200 } }));
  assert.strictEqual(c2.max_output_tokens, 1200);
});

test('construirPeticion falla con error explícito si max_tokens_evaluador falta o no es entero positivo', () => {
  const sin = { ...datos.CONFIG_EJEMPLO };
  delete sin.max_tokens_evaluador;
  assert.throws(() => js4.construirPeticion(datosPeticion({ config: sin })), /config\.max_tokens_evaluador debe ser un entero positivo/);
  for (const malo of ['', null, 0, -5, '0', 8000.5, '8000.5', 'ocho mil', '8e3', NaN, Infinity, true, [8000]]) {
    assert.throws(
      () => js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, max_tokens_evaluador: malo } })),
      /config\.max_tokens_evaluador debe ser un entero positivo/,
      `debió fallar con ${JSON.stringify(malo)}`
    );
  }
});

test('opciones.max_tokens_salida sustituye el valor (pruebas), pero config.max_tokens_evaluador se valida igual', () => {
  const c = js4.construirPeticion(datosPeticion(), { max_tokens_salida: 500 });
  assert.strictEqual(c.max_output_tokens, 500);
  assert.throws(() => js4.construirPeticion(datosPeticion(), { max_tokens_salida: 0 }), /opciones\.max_tokens_salida/);
  const sin = { ...datos.CONFIG_EJEMPLO };
  delete sin.max_tokens_evaluador;
  assert.throws(() => js4.construirPeticion(datosPeticion({ config: sin }), { max_tokens_salida: 8000 }), /config\.max_tokens_evaluador/);
});

test('leerEnteroPositivo acepta enteros y texto de dígitos; rechaza lo demás', () => {
  assert.strictEqual(js4.leerEnteroPositivo('42', 'x'), 42);
  assert.strictEqual(js4.leerEnteroPositivo(1, 'x'), 1);
  assert.throws(() => js4.leerEnteroPositivo(undefined, 'config.clave'), /config\.clave debe ser un entero positivo y vale undefined/);
  assert.throws(() => js4.leerEnteroPositivo('-1', 'x'), /entero positivo/);
});

test('construirPeticion toma el esfuerzo de razonamiento de config.llm_esfuerzo_razonamiento', () => {
  // Con esfuerzo en config no se envía temperature, ni se valida llm_temperatura.
  const config = { ...datos.CONFIG_EJEMPLO, llm_esfuerzo_razonamiento: 'none', llm_temperatura: 'no aplica' };
  const c = js4.construirPeticion(datosPeticion({ config }));
  assert.deepEqual(c.reasoning, { effort: 'none' });
  assert.equal('temperature' in c, false);
  // Celda vacía -> temperature de config.
  const c2 = js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, llm_esfuerzo_razonamiento: '' } }));
  assert.equal(c2.temperature, 0);
  assert.equal(c2.reasoning, undefined);
});

test('construirPeticion quita del esquema las claves de config.claves_esquema_excluidas_evaluador', () => {
  // Vacía (como en datos/config.csv), como texto "a|b" o como arreglo ya convertido por JS-1.
  for (const vacia of ['', [], null, undefined]) {
    const c = js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, claves_esquema_excluidas_evaluador: vacia } }));
    assert.deepEqual(c.text.format.schema, ESQUEMA);
  }
  for (const lista of ['$schema|title', ['$schema', 'title']]) {
    const c = js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, claves_esquema_excluidas_evaluador: lista } }));
    assert.equal('$schema' in c.text.format.schema, false);
    assert.equal('title' in c.text.format.schema, false);
    assert.ok(c.text.format.schema.properties.tema); // las propiedades se conservan
  }
});

test('con las filas reales de datos/config.csv: reasoning none, sin temperature y esquema completo', () => {
  // Resuelve config para ce como indica contrato/config.md sección 0 (el tipo gana sobre "todos").
  // Conversión mínima: solo el tipo "lista" se separa por "|"; lo demás queda como texto.
  const filas = datos.leerCsv(require('node:fs').readFileSync(require('node:path').join(datos.RAIZ, 'datos', 'config.csv'), 'utf8'));
  const config = {};
  for (const tipo of ['todos', 'ce']) {
    for (const f of filas.filter((x) => x.tipo_interaccion === tipo)) {
      config[f.clave] = f.tipo === 'lista' ? js4.leerListaConfig(f.valor) : f.valor;
    }
  }
  const c = js4.construirPeticion(datosPeticion({ config }));
  assert.equal(c.model, config.modelo_evaluador);
  assert.deepEqual(c.reasoning, { effort: config.llm_esfuerzo_razonamiento });
  assert.equal('temperature' in c, false);
  assert.deepEqual(c.text.format.schema, ESQUEMA);
  // datos/config.csv trae max_tokens_evaluador = 8000 (el mismo tope de la prueba B).
  assert.strictEqual(c.max_output_tokens, 8000);
});

test('construirPeticion falla con modelo en por_verificar, temperatura no numérica o bandera faltante', () => {
  assert.throws(() => js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, modelo_evaluador: 'por_verificar' } })), /por_verificar/);
  assert.throws(() => js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, llm_temperatura: 'cero' } })), /llm_temperatura/);
  assert.throws(() => js4.construirPeticion(datosPeticion({ termina_por_inactividad: 'no' })), /booleano/);
  assert.throws(() => js4.construirPeticion(datosPeticion({ config: { ...datos.CONFIG_EJEMPLO, version_prompt: 'evaluador_ce_v2' } })), /no corresponde/);
});

test('construirPeticion no modifica sus entradas', () => {
  const d = datosPeticion();
  const antes = JSON.stringify({ esquema: d.esquema, mensajes: d.mensajes, catalogo: d.catalogo_temas });
  js4.construirPeticion(d, { claves_esquema_no_aceptadas: ['$schema', 'title', 'minimum', 'minItems'] });
  assert.equal(JSON.stringify({ esquema: d.esquema, mensajes: d.mensajes, catalogo: d.catalogo_temas }), antes);
});

// --- Limpieza del esquema ----------------------------------------------------------------

test('limpiarEsquema: lista vacía devuelve una copia idéntica', () => {
  const l = js4.limpiarEsquema(ESQUEMA);
  assert.deepEqual(l, ESQUEMA);
  assert.notEqual(l, ESQUEMA);
});

test('limpiarEsquema: quita $schema y title en todo el esquema', () => {
  const l = js4.limpiarEsquema(ESQUEMA, ['$schema', 'title']);
  assert.equal(l.$schema, undefined);
  assert.equal(l.title, undefined);
  assert.equal(ESQUEMA.title !== undefined, true); // el original no cambia
});

test('limpiarEsquema: minimum solo en primer_mensaje_info_cuenta.mensaje_n', () => {
  const l = js4.limpiarEsquema(ESQUEMA, ['minimum@primer_mensaje_info_cuenta.mensaje_n']);
  assert.equal(l.properties.primer_mensaje_info_cuenta.properties.mensaje_n.minimum, undefined);
  assert.equal(l.properties.tema.properties.mensajes.items.minimum, 1); // los demás se conservan
  assert.equal(l.properties.solicitudes_cliente.items.properties.mensaje_n.minimum, 1);
});

test('limpiarEsquema: rutas que atraviesan arreglos y minItems', () => {
  const l = js4.limpiarEsquema(ESQUEMA, ['minimum@solicitudes_cliente.mensaje_n', 'minItems']);
  assert.equal(l.properties.solicitudes_cliente.items.properties.mensaje_n.minimum, undefined);
  assert.equal(l.properties.solicitudes_cliente.minItems, undefined);
  assert.equal(l.properties.errores_ortografia.items.properties.mensaje_n.minimum, 1);
});

test('limpiarEsquema: no borra una PROPIEDAD que se llame como la palabra clave', () => {
  const esquema = {
    type: 'object',
    title: 'raíz',
    properties: { title: { type: 'string', title: 'campo' }, minimum: { type: 'integer' } },
  };
  const l = js4.limpiarEsquema(esquema, ['title', 'minimum']);
  assert.equal(l.title, undefined);
  assert.ok(l.properties.title, 'se borró la propiedad "title"');
  assert.equal(l.properties.title.title, undefined);
  assert.ok(l.properties.minimum, 'se borró la propiedad "minimum"');
});

// --- Reintento --------------------------------------------------------------------------

test('agregarReintento agrega la respuesta anterior y los errores sin modificar la original', () => {
  const c = js4.construirPeticion(datosPeticion());
  const r = js4.agregarReintento(c, '{"tema":1}', '1. tema.valor: ...');
  assert.equal(c.input.length, 1);
  assert.equal(r.input.length, 3);
  assert.deepEqual(r.input[1], { role: 'assistant', content: '{"tema":1}' });
  assert.deepEqual(r.input[2], { role: 'user', content: '1. tema.valor: ...' });
  assert.equal(r.instructions, c.instructions);
});
