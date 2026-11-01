// Pruebas de prompts/generador_ce_v3.md (30-oct-2026) y de las funciones de JS-4
// que la llenan: articuloDelTema, guiaFallas y valoresGenerador por versión.
// Ejecutar desde la raíz: node --test

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const js4 = require('../construccion_prompt.js');
const S = require('../simulador.js');
const { DATOS, configCE } = require('./ayudas.js');
const { RAIZ, cargarBase } = require('./construccion_prompt_datos_referencia.js');

const leer = (v) => fs.readFileSync(path.join(RAIZ, 'prompts', `generador_ce_${v}.md`), 'utf8');
const PLANTILLAS = { v1: leer('v1'), v2: leer('v2'), v3: leer('v3') };
const V3 = PLANTILLAS.v3;
const BASE = cargarBase();
const ESQUEMA_GEN = JSON.parse(fs.readFileSync(path.join(RAIZ, 'prompts', 'generador_payload_salida.schema.json'), 'utf8'));
const PAYLOAD_EJEMPLO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'ejemplos', 'payload_ejemplo.json'), 'utf8'));
const CUENTA = DATOS.cuentas.find((c) => c.cuenta_id === PAYLOAD_EJEMPLO.cuenta_id);

const TIPIF_CASO9 = 'Emisión de complemento de pago';
const temaDe = (tipificacion) => DATOS.catalogo.find((f) => f.tipificacion_valida === tipificacion).tema;

const MARCADORES_V1 = [
  'CONVERSATION_ID', 'TEMA_ESPERADO', 'TIPIFICACION_ESPERADA', 'CALIDAD_ESPERADA', 'ERRORES_CRITICOS_INYECTADOS',
  'CRITERIOS_QUE_DEBEN_FALLAR', 'CASOS_DIFICILES', 'FECHA_HORA_INICIO', 'CUENTA', 'PARAMETROS_CONFIG',
  'FRASES_REFERENCIA', 'CATALOGO_TEMAS', 'BASE_CONOCIMIENTO',
];
const MARCADORES_V2 = [...MARCADORES_V1, 'TIPIFICACION_AGENTE', 'VARIANTE_IDENTIDAD'];
const MARCADORES_V3 = [...MARCADORES_V2, 'ARTICULO_DEL_TEMA', 'GUIA_FALLAS'];

function escenario(extra = {}) {
  return {
    conversation_id: 'CONV-0909',
    lote: 'demo',
    tipo_interaccion: 'ce',
    calidad_esperada: 'regular',
    tema_esperado: temaDe(TIPIF_CASO9),
    tipificacion_esperada: TIPIF_CASO9,
    errores_criticos_inyectados: [],
    criterios_que_deben_fallar: ['diagnostico.preguntas_necesarias', 'comunicacion.redaccion'],
    casos_dificiles: [],
    cuenta_id: CUENTA.cuenta_id,
    ...extra,
  };
}
const EXTRAS = { fecha_hora_inicio: '2026-10-24T10:00:00', tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: false };
const datos = (extra = {}) => ({
  escenario: escenario(),
  extras: EXTRAS,
  cuenta: CUENTA,
  catalogo_temas: DATOS.catalogo,
  base_conocimiento: BASE,
  listas: DATOS.listas,
  config: configCE(),
  tipo_interaccion: 'ce',
  plantilla: V3,
  ...extra,
});
const peticion = (plantilla, valores, version) =>
  js4.construirPeticionGenerador({ plantilla, esquema: ESQUEMA_GEN, valores, config: { ...configCE(), version_prompt_generador: version } });

// Líneas "- id: texto" del bloque GUIA_FALLAS.
function lineasGuia(plantilla) {
  return js4
    .extraerBloque(plantilla.replace(/\r\n/g, '\n'), 'GUIA_FALLAS')
    .split('\n')
    .filter((l) => l.startsWith('- '));
}

// --- Plantilla v3 -----------------------------------------------------------------------------

test('v3: bloques, versión y los 17 marcadores (15 de v2 + ARTICULO_DEL_TEMA + GUIA_FALLAS)', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(V3, 'generador_ce_v3');
  assert.ok(instrucciones.length > 1000);
  assert.deepEqual(js4.marcadoresDePlantilla(V3).sort(), [...MARCADORES_V3].sort());
  // Desde generador_ce_v4 JS conoce además GUIA_SITUACIONES (ver generador_v4.test.js).
  assert.deepEqual([...js4.MARCADORES_GENERADOR].sort(), [...MARCADORES_V3, 'GUIA_SITUACIONES'].sort());
  // GUIA_FALLAS va dentro de ESCENARIO; ARTICULO_DEL_TEMA, con su encabezado, antes de BASE DE CONOCIMIENTO.
  const iGuia = plantilla_entrada.indexOf('<<GUIA_FALLAS>>');
  assert.ok(plantilla_entrada.indexOf('ESCENARIO') < iGuia && iGuia < plantilla_entrada.indexOf('CUENTA (datos ficticios)'));
  const iArt = plantilla_entrada.indexOf('ARTÍCULO DEL TEMA (sigue todos sus pasos, en orden):\n<<ARTICULO_DEL_TEMA>>');
  assert.ok(iArt > 0 && iArt < plantilla_entrada.indexOf('BASE DE CONOCIMIENTO:\n<<BASE_CONOCIMIENTO>>'));
  // La versión cruzada se detiene.
  assert.throws(() => js4.leerPlantilla(V3, 'generador_ce_v2'), /no corresponde/);
});

test('v3: el texto enviado (y la guía) se puede pegar en n8n: sin `, ${, {{ ni $input.first/last/all/itemMatching', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(V3, 'generador_ce_v3');
  const guia = js4.extraerBloque(V3, 'GUIA_FALLAS');
  for (const b of [instrucciones, plantilla_entrada, guia]) {
    assert.ok(!b.includes('`'));
    assert.ok(!b.includes('${'));
    assert.ok(!b.includes('{{'));
    assert.doesNotMatch(b, /\$input\.(first|last|all|itemMatching)/);
  }
});

test('v3: secciones 10, 11 y 12 y viñeta 1 de la sección 9; la guía completa NO va en las instrucciones', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(V3, 'generador_ce_v3');
  for (const t of ['# 10. Artículo del tema', '# 11. Cómo fallar cada criterio sin afectar a otros', '# 12. Verificación final (antes de responder)']) {
    assert.ok(instrucciones.includes(t), t);
  }
  assert.ok(instrucciones.includes('- La solución sale del ARTÍCULO DEL TEMA (sección 10); el resto de la BASE DE CONOCIMIENTO se usa para lo demás.'));
  assert.ok(!instrucciones.includes('- La información correcta es solo la de BASE DE CONOCIMIENTO.'));
  for (const l of lineasGuia(V3)) {
    assert.ok(!instrucciones.includes(l) && !plantilla_entrada.includes(l), `la guía se envía completa: ${l.slice(0, 40)}`);
  }
  // Sigue cubriendo los 12 críticos y los 5 casos difíciles.
  for (const c of ['no_toma_a_tiempo', 'no_genera_caso', 'abandono', 'palabras_altisonantes', 'validacion_identidad', 'confidencialidad',
    'tipificacion_incorrecta', 'informacion_incorrecta', 'promesa_no_autorizada', 'negacion_servicio', 'mala_actitud', 'comentarios_negativos_marca']) {
    assert.ok(instrucciones.includes(`critico.${c}:`), c);
  }
  for (const c of ['amable_no_resuelve:', 'resuelve_tono_seco:', 'critico_escondido:', 'tipificacion_incorrecta:', 'validacion_fuera_de_orden:']) assert.ok(instrucciones.includes(c));
});

test('v3 solo agrega: todas las líneas enviadas de v2 siguen en v3, salvo la viñeta 1 de la sección 9', () => {
  const v2 = js4.leerPlantilla(PLANTILLAS.v2, 'generador_ce_v2');
  const v3 = js4.leerPlantilla(V3, 'generador_ce_v3');
  const lineas3 = new Set((v3.instrucciones + '\n' + v3.plantilla_entrada).split('\n'));
  const quitadas = (v2.instrucciones + '\n' + v2.plantilla_entrada).split('\n').filter((l) => !lineas3.has(l));
  assert.equal(quitadas.length, 1, quitadas.join(' | '));
  assert.match(quitadas[0], /^- La información correcta es solo la de BASE DE CONOCIMIENTO/);
});

test('v1 y v2 no cambiaron: son idénticas, byte a byte, a las del último commit (git show HEAD)', () => {
  for (const v of ['v1', 'v2']) {
    const enHead = execFileSync('git', ['show', `HEAD:prompts/generador_ce_${v}.md`], { cwd: RAIZ, encoding: 'utf8' });
    assert.equal(PLANTILLAS[v], enHead, `prompts/generador_ce_${v}.md cambió`);
    const a = js4.leerPlantilla(PLANTILLAS[v], `generador_ce_${v}`);
    const b = js4.leerPlantilla(enHead, `generador_ce_${v}`);
    assert.equal(a.instrucciones, b.instrucciones);
    assert.equal(a.plantilla_entrada, b.plantilla_entrada);
  }
});

// --- Guía de fallas vs contrato y vs el sorteo -------------------------------------------------

test('guía de fallas: cada subelemento que el sorteo o el formulario pueden pedir (js/simulador.js) tiene su línea, y no sobra ninguna', () => {
  const version = configCE().version_reglas;
  const criticos = Object.keys(S.INCOMPATIBLES_CON_CRITICO);
  // Pedible = existe un contexto (calidad regular o mala; sin crítico o con un crítico) en el que
  // motivoRechazoCriterio (la regla que usan el sorteo y el formulario) no lo rechaza.
  const pedibles = S.listarSubelementos(version)
    .map((s) => s.id)
    .filter((id) =>
      ['regular', 'mala'].some((calidad) =>
        [[], ...criticos.map((c) => [c])].some((cs) => S.motivoRechazoCriterio(id, { version_reglas: version, criticos: cs, calidad, otros: [] }) === null)
      )
    );
  const enGuia = lineasGuia(V3).map((l) => l.match(/^- ([a-z_]+\.[a-z_]+):/)[1]);
  assert.deepEqual([...enGuia].sort(), [...new Set(enGuia)].sort(), 'ids repetidos en la guía');
  assert.deepEqual([...enGuia].sort(), [...pedibles].sort());
  assert.equal(enGuia.length, 52);
  // guiaFallas acepta todos a la vez.
  assert.equal(js4.guiaFallas(V3, pedibles).split('\n').length, pedibles.length);
});

test('guía de fallas: solo nombra claves de listas y de config que existen en datos/ (o campos del payload)', () => {
  const claves = new Set([
    ...DATOS.listas.map((f) => f.clave_lista),
    ...DATOS.config.map((f) => f.clave),
  ]);
  // Campos del payload/catálogo y valores de enum que la guía nombra (contrato/payload.schema.json y sheets.md).
  const campos = new Set(['metadatos_caso', 'numero_caso', 'estado_caso', 'en_seguimiento', 'campos_capturados', 'campos_obligatorios', 'datos_coinciden_sin_critico']);
  const esquema = JSON.stringify(JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'payload.schema.json'), 'utf8')));
  for (const c of ['metadatos_caso', 'numero_caso', 'estado_caso', 'en_seguimiento', 'campos_capturados']) assert.ok(esquema.includes(`"${c}"`), c);
  const desconocidos = new Set();
  for (const l of lineasGuia(V3)) {
    const cuerpo = l.replace(/^- [a-z_]+\.[a-z_]+:/, '');
    for (const nombre of cuerpo.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || []) {
      if (!claves.has(nombre) && !campos.has(nombre)) desconocidos.add(nombre);
    }
  }
  assert.deepEqual([...desconocidos], []);
  // Las 5 claves nuevas de PARAMETROS_CONFIG existen en datos/config.csv (ce o todos).
  for (const c of ['mayusculas_min_palabras_consecutivas', 'mayusculas_min_longitud_palabra', 'ortografia_umbral_graves', 'ortografia_umbral_menores', 'signos_apertura_max_omisiones']) {
    assert.ok(DATOS.config.some((f) => f.clave === c && (f.tipo_interaccion === 'ce' || f.tipo_interaccion === 'todos')), c);
    assert.ok(js4.CLAVES_CONFIG_GENERADOR.includes(c), c);
  }
});

// --- guiaFallas ----------------------------------------------------------------------------------

test('guiaFallas: criterios pedidos -> solo sus líneas, en el orden pedido', () => {
  const g = js4.guiaFallas(V3, ['comunicacion.redaccion', 'diagnostico.preguntas_necesarias']);
  const lineas = g.split('\n');
  assert.equal(lineas.length, 2);
  assert.match(lineas[0], /^- comunicacion\.redaccion: .+ \|\| .+/);
  assert.match(lineas[1], /^- diagnostico\.preguntas_necesarias: .+ \|\| .+/);
  assert.doesNotMatch(g, /apertura\.|comunicacion\.ortografia/);
  // Texto "a|b" (celda de Sheets) y repetidos.
  assert.equal(js4.guiaFallas(V3, 'comunicacion.redaccion|comunicacion.redaccion'), lineas[0]);
});

test('guiaFallas: sin criterios -> ninguno', () => {
  for (const vacio of [[], '', null, undefined]) assert.equal(js4.guiaFallas(V3, vacio), 'ninguno');
});

test('guiaFallas: criterio sin línea, línea mal formada, línea repetida o plantilla sin el bloque -> error', () => {
  assert.throws(() => js4.guiaFallas(V3, ['comunicacion.redaccion', 'apertura.toma_a_tiempo']), /no tiene línea para: apertura\.toma_a_tiempo/);
  assert.throws(() => js4.guiaFallas(V3, ['diagnostico.numero_preguntas']), /no tiene línea para/);
  const mal = V3.replace('<!-- FIN_GUIA_FALLAS -->', '- esto no es un criterio\n<!-- FIN_GUIA_FALLAS -->');
  assert.throws(() => js4.guiaFallas(mal, ['comunicacion.redaccion']), /mal formada/);
  const linea = lineasGuia(V3)[0];
  const doble = V3.replace('<!-- FIN_GUIA_FALLAS -->', `${linea}\n<!-- FIN_GUIA_FALLAS -->`);
  assert.throws(() => js4.guiaFallas(doble, []), /dos líneas para apertura\.saludo/);
  assert.throws(() => js4.guiaFallas(PLANTILLAS.v2, ['comunicacion.redaccion']), /GUIA_FALLAS/);
  assert.throws(() => js4.guiaFallas('', []), /plantilla/);
});

// --- articuloDelTema ---------------------------------------------------------------------------

test('articuloDelTema: "Emisión de complemento de pago" -> KB-03, con el mismo formato que la base completa', () => {
  const a = js4.articuloDelTema(DATOS.catalogo, BASE, TIPIF_CASO9, temaDe(TIPIF_CASO9), 'ce');
  assert.match(a, /^## KB-03 \| /);
  assert.equal(a, js4.formatearArticulo(BASE.find((x) => x.id_articulo === 'KB-03')));
  assert.ok(js4.formatearBaseConocimiento(BASE, 'ce').includes(a));
  assert.equal(a.match(/^## KB-/gm).length, 1);
});

test('articuloDelTema: cada tipificación activa del catálogo (ce ∪ todos) da el artículo de su fila', () => {
  const activas = DATOS.catalogo.filter((f) => (f.tipo_interaccion === 'ce' || f.tipo_interaccion === 'todos') && f.activo === 'si');
  assert.ok(activas.length > 0);
  for (const f of activas) {
    assert.match(js4.articuloDelTema(DATOS.catalogo, BASE, f.tipificacion_valida, f.tema, 'ce'), new RegExp(`^## ${f.id_articulo} \\| `));
  }
});

test('articuloDelTema: errores explícitos (sin id_articulo, sin artículo, tema distinto, tipificación inexistente o repetida)', () => {
  const tema = temaDe(TIPIF_CASO9);
  const sinId = DATOS.catalogo.map((f) => (f.tipificacion_valida === TIPIF_CASO9 ? { ...f, id_articulo: '' } : f));
  assert.throws(() => js4.articuloDelTema(sinId, BASE, TIPIF_CASO9, tema, 'ce'), /no tiene id_articulo/);
  const sinArticulo = BASE.filter((a) => a.id_articulo !== 'KB-03');
  assert.throws(() => js4.articuloDelTema(DATOS.catalogo, sinArticulo, TIPIF_CASO9, tema, 'ce'), /exactamente 1 artículo KB-03 .* tiene 0/);
  const articuloDoble = [...BASE, { ...BASE.find((a) => a.id_articulo === 'KB-03') }];
  assert.throws(() => js4.articuloDelTema(DATOS.catalogo, articuloDoble, TIPIF_CASO9, tema, 'ce'), /tiene 2/);
  assert.throws(() => js4.articuloDelTema(DATOS.catalogo, BASE, TIPIF_CASO9, 'Cancelación de CFDI', 'ce'), /pertenece al tema "Complemento de pago"/);
  assert.throws(() => js4.articuloDelTema(DATOS.catalogo, BASE, 'No existe', tema, 'ce'), /exactamente 1 fila activa .* tiene 0/);
  const inactiva = DATOS.catalogo.map((f) => (f.tipificacion_valida === TIPIF_CASO9 ? { ...f, activo: 'no' } : f));
  assert.throws(() => js4.articuloDelTema(inactiva, BASE, TIPIF_CASO9, tema, 'ce'), /tiene 0/);
  const fila = DATOS.catalogo.find((f) => f.tipificacion_valida === TIPIF_CASO9);
  assert.throws(() => js4.articuloDelTema([...DATOS.catalogo, { ...fila }], BASE, TIPIF_CASO9, tema, 'ce'), /tiene 2/);
  assert.throws(() => js4.articuloDelTema(DATOS.catalogo, BASE, '', tema, 'ce'), /tipificación esperada/);
});

// --- valoresGenerador por versión ------------------------------------------------------------

test('valoresGenerador llena v1 (13), v2 (15) y v3 (17) sin error, según los marcadores de cada plantilla', () => {
  const esperados = { v1: MARCADORES_V1, v2: MARCADORES_V2, v3: MARCADORES_V3 };
  const porVersion = {};
  for (const v of ['v1', 'v2', 'v3']) {
    const valores = js4.valoresGenerador(datos({ plantilla: PLANTILLAS[v] }));
    assert.deepEqual(Object.keys(valores).sort(), [...esperados[v]].sort(), v);
    for (const [k, x] of Object.entries(valores)) assert.ok(typeof x === 'string' && x.trim() !== '', `${v}: ${k} vacío`);
    const c = peticion(PLANTILLAS[v], valores, `generador_ce_${v}`);
    assert.doesNotMatch(c.messages[0].content, /<<|>>/, v);
    porVersion[v] = valores;
  }
  // Los marcadores comunes valen lo mismo en las tres versiones.
  for (const m of MARCADORES_V1) assert.equal(porVersion.v1[m], porVersion.v3[m], m);
  for (const m of MARCADORES_V2) assert.equal(porVersion.v2[m], porVersion.v3[m], m);
});

test('valoresGenerador v1 no exige los extras de v2 ni el artículo de v3', () => {
  const extras = { fecha_hora_inicio: '2026-10-24T10:00:00' }; // sin tipificacion_agente_prevista ni variante
  const sinArticulo = BASE.filter((a) => a.id_articulo !== 'KB-03');
  const v = js4.valoresGenerador(datos({ plantilla: PLANTILLAS.v1, extras, base_conocimiento: sinArticulo }));
  assert.equal(Object.keys(v).length, 13);
  // La misma entrada con v3 sí se detiene.
  assert.throws(() => js4.valoresGenerador(datos({ extras, base_conocimiento: sinArticulo })), /variante_datos_coinciden_sin_critico|KB-03/);
});

test('valoresGenerador v3: artículo KB-03 y guía de los criterios pedidos en la petición final', () => {
  const v = js4.valoresGenerador(datos());
  assert.match(v.ARTICULO_DEL_TEMA, /^## KB-03 \| /);
  assert.equal(v.GUIA_FALLAS, js4.guiaFallas(V3, ['diagnostico.preguntas_necesarias', 'comunicacion.redaccion']));
  assert.equal(v.PARAMETROS_CONFIG.split('\n').length, 24);
  assert.match(v.PARAMETROS_CONFIG, /^ortografia_umbral_graves: \d+$/m);
  const c = peticion(V3, v, 'generador_ce_v3');
  const entrada = c.messages[0].content;
  assert.ok(entrada.indexOf('- diagnostico.preguntas_necesarias: ') < entrada.indexOf('CUENTA (datos ficticios)'));
  assert.ok(entrada.indexOf('ARTÍCULO DEL TEMA (sigue todos sus pasos, en orden):\n## KB-03') < entrada.indexOf('BASE DE CONOCIMIENTO:\n## KB-01'));
  assert.equal((entrada.match(/^- [a-z_]+\.[a-z_]+: /gm) || []).length, 2); // solo las 2 líneas pedidas
  assert.equal(c.system, js4.leerPlantilla(V3, 'generador_ce_v3').instrucciones);
});

test('valoresGenerador v3 sin criterios (calidad buena): GUIA_FALLAS = ninguno', () => {
  const v = js4.valoresGenerador(datos({ escenario: escenario({ calidad_esperada: 'buena', criterios_que_deben_fallar: [] }) }));
  assert.equal(v.GUIA_FALLAS, 'ninguno');
  assert.equal(v.CRITERIOS_QUE_DEBEN_FALLAR, 'ninguno');
  assert.match(peticion(V3, v, 'generador_ce_v3').messages[0].content, /GUIA_FALLAS \(criterio: cómo fallarlo \|\| qué no tocar\):\nninguno\n/);
});

test('valoresGenerador v3 con critico.tipificacion_incorrecta: el artículo sale de la tipificación ESPERADA', () => {
  const otra = DATOS.catalogo.find((f) => f.activo === 'si' && f.tema !== temaDe(TIPIF_CASO9) && f.id_articulo !== 'KB-03');
  const v = js4.valoresGenerador(
    datos({
      escenario: escenario({ calidad_esperada: 'mala', errores_criticos_inyectados: ['critico.tipificacion_incorrecta'], criterios_que_deben_fallar: [] }),
      extras: { ...EXTRAS, tipificacion_agente_prevista: otra.tipificacion_valida },
    })
  );
  assert.equal(v.TIPIFICACION_AGENTE, otra.tipificacion_valida);
  assert.equal(v.TIPIFICACION_ESPERADA, TIPIF_CASO9);
  assert.match(v.ARTICULO_DEL_TEMA, /^## KB-03 \| /);
  assert.ok(!v.ARTICULO_DEL_TEMA.startsWith(`## ${otra.id_articulo} `));
});

test('valoresGenerador v3 con un escenario real de completarEscenario (js/simulador.js)', () => {
  let i = 0;
  const azar = [0.99, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const r = S.completarEscenario(
    { tipo_interaccion: 'ce', tema: null, calidad_solicitada: 'regular', errores_criticos_inyectados: [], cantidad: 1, lote: 'demo' },
    { config: configCE(), catalogo: DATOS.catalogo, cuentas: DATOS.cuentas, conversationId: 'CONV-0301', aleatorio: () => azar[i++ % azar.length], ahora: new Date('2026-10-21T16:00:00Z') }
  );
  assert.equal(r.valido, true, (r.errores || []).join(' | '));
  const v = js4.valoresGenerador(datos({ escenario: r.escenario, extras: r.extras, cuenta: r.cuenta }));
  const pedidos = r.escenario.criterios_que_deben_fallar;
  assert.equal(v.GUIA_FALLAS, pedidos.length ? js4.guiaFallas(V3, pedidos) : 'ninguno');
  assert.doesNotMatch(peticion(V3, v, 'generador_ce_v3').messages[0].content, /<<|>>/);
});
