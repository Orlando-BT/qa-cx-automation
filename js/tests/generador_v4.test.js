// Pruebas de prompts/generador_ce_v4.md (1-nov-2026) y de lo que JS-4 agrega para
// llenarla: guiaSituaciones y el marcador GUIA_SITUACIONES de valoresGenerador.
// Ejecutar desde la raíz: node --test
//
// Qué cubre:
//   - v4 se arma sin marcadores sin resolver y v1, v2 y v3 siguen armándose igual;
//   - la guía de fallas y la de situaciones se filtran por los criterios pedidos;
//   - el ejemplo de mala redacción solo viaja si se pide comunicacion.redaccion;
//   - la guía de situaciones coincide con la columna "no_aplica cuando" de la rúbrica;
//   - las frases de confirmación de la apertura las reconoce la lista ofrece_ayuda
//     con la misma búsqueda de js/reglas.js (reglas_ce_v1, sin cambios).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const js4 = require('../construccion_prompt.js');
const S = require('../simulador.js');
const reglas = require('../reglas.js');
const { DATOS, configCE } = require('./ayudas.js');
const { RAIZ, cargarBase } = require('./construccion_prompt_datos_referencia.js');

const leer = (v) => fs.readFileSync(path.join(RAIZ, 'prompts', `generador_ce_${v}.md`), 'utf8');
const PLANTILLAS = { v1: leer('v1'), v2: leer('v2'), v3: leer('v3'), v4: leer('v4') };
const V3 = PLANTILLAS.v3;
const V4 = PLANTILLAS.v4;
const BASE = cargarBase();
const ESQUEMA_GEN = JSON.parse(fs.readFileSync(path.join(RAIZ, 'prompts', 'generador_payload_salida.schema.json'), 'utf8'));
const RUBRICA = fs.readFileSync(path.join(RAIZ, 'contrato', 'rubrica.md'), 'utf8');
const CUENTA = DATOS.cuentas[0];

const TIPIF = 'Emisión de complemento de pago';
const temaDe = (tipificacion) => DATOS.catalogo.find((f) => f.tipificacion_valida === tipificacion).tema;

const MARCADORES_V1 = [
  'CONVERSATION_ID', 'TEMA_ESPERADO', 'TIPIFICACION_ESPERADA', 'CALIDAD_ESPERADA', 'ERRORES_CRITICOS_INYECTADOS',
  'CRITERIOS_QUE_DEBEN_FALLAR', 'CASOS_DIFICILES', 'FECHA_HORA_INICIO', 'CUENTA', 'PARAMETROS_CONFIG',
  'FRASES_REFERENCIA', 'CATALOGO_TEMAS', 'BASE_CONOCIMIENTO',
];
const MARCADORES_V2 = [...MARCADORES_V1, 'TIPIFICACION_AGENTE', 'VARIANTE_IDENTIDAD'];
const MARCADORES_V3 = [...MARCADORES_V2, 'ARTICULO_DEL_TEMA', 'GUIA_FALLAS'];
const MARCADORES_V4 = [...MARCADORES_V3, 'GUIA_SITUACIONES'];

function escenario(extra = {}) {
  return {
    conversation_id: 'CONV-0910',
    lote: 'demo',
    tipo_interaccion: 'ce',
    calidad_esperada: 'regular',
    tema_esperado: temaDe(TIPIF),
    tipificacion_esperada: TIPIF,
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
  plantilla: V4,
  ...extra,
});
const peticion = (plantilla, valores, version) =>
  js4.construirPeticionGenerador({ plantilla, esquema: ESQUEMA_GEN, valores, config: { ...configCE(), version_prompt_generador: version } });
const entradaV4 = (criterios, calidad = 'regular') =>
  peticion(V4, js4.valoresGenerador(datos({ escenario: escenario({ calidad_esperada: calidad, criterios_que_deben_fallar: criterios }) })), 'generador_ce_v4').messages[0].content;

// Líneas "- id: texto" de un bloque de guía, como Map id -> línea.
function guia(plantilla, bloque) {
  const m = new Map();
  for (const l of js4.extraerBloque(plantilla.replace(/\r\n/g, '\n'), bloque).split('\n')) {
    if (l.startsWith('- ')) m.set(l.match(/^- ([a-z_]+\.[a-z_]+):/)[1], l);
  }
  return m;
}
const FALLAS_V3 = guia(V3, 'GUIA_FALLAS');
const FALLAS_V4 = guia(V4, 'GUIA_FALLAS');
const SITUACIONES_V4 = guia(V4, 'GUIA_SITUACIONES');

// Columna "no_aplica cuando" de las tablas de subelementos de contrato/rubrica.md (sección 3).
function noAplicaCuando(id) {
  const fila = RUBRICA.split('\n').find((l) => l.startsWith(`| \`${id}\` |`));
  assert.ok(fila, `${id} no está en las tablas de rubrica.md`);
  const sinFin = fila.trim().replace(/\|\s*$/, '');
  return sinFin.slice(sinFin.lastIndexOf('|') + 1).trim();
}

// Subelementos que el sorteo o el formulario pueden pedir como falla (misma definición que generador_v3.test.js).
function pedibles() {
  const version = configCE().version_reglas;
  const criticos = Object.keys(S.INCOMPATIBLES_CON_CRITICO);
  return S.listarSubelementos(version)
    .map((s) => s.id)
    .filter((id) =>
      ['regular', 'mala'].some((calidad) =>
        [[], ...criticos.map((c) => [c])].some((cs) => S.motivoRechazoCriterio(id, { version_reglas: version, criticos: cs, calidad, otros: [] }) === null)
      )
    );
}

// --- Plantilla v4 -----------------------------------------------------------------------------

test('v4: bloques, versión y los 18 marcadores (17 de v3 + GUIA_SITUACIONES dentro de ESCENARIO)', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(V4, 'generador_ce_v4');
  assert.ok(instrucciones.length > 1000);
  assert.deepEqual(js4.marcadoresDePlantilla(V4).sort(), [...MARCADORES_V4].sort());
  assert.deepEqual([...js4.MARCADORES_GENERADOR].sort(), [...MARCADORES_V4].sort());
  const iFallas = plantilla_entrada.indexOf('<<GUIA_FALLAS>>');
  const iSit = plantilla_entrada.indexOf('- GUIA_SITUACIONES (criterio: situación que debes crear || qué más aplica al crearla):\n<<GUIA_SITUACIONES>>');
  assert.ok(iFallas > 0 && iFallas < iSit && iSit < plantilla_entrada.indexOf('CUENTA (datos ficticios)'));
  assert.throws(() => js4.leerPlantilla(V4, 'generador_ce_v3'), /no corresponde/);
  assert.throws(() => js4.leerPlantilla(V3, 'generador_ce_v4'), /no corresponde/);
});

test('v4: el texto enviado y las dos guías se pueden pegar en n8n: sin `, ${, {{ ni $input.first/last/all/itemMatching', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(V4, 'generador_ce_v4');
  for (const b of [instrucciones, plantilla_entrada, js4.extraerBloque(V4, 'GUIA_FALLAS'), js4.extraerBloque(V4, 'GUIA_SITUACIONES')]) {
    assert.ok(!b.includes('`'));
    assert.ok(!b.includes('${'));
    assert.ok(!b.includes('{{'));
    assert.doesNotMatch(b, /\$input\.(first|last|all|itemMatching)/);
  }
});

test('v4 solo agrega a v3: la única línea enviada de v3 que ya no está es la viñeta general de situaciones de la sección 11', () => {
  const a = js4.leerPlantilla(V3, 'generador_ce_v3');
  const b = js4.leerPlantilla(V4, 'generador_ce_v4');
  const lineas4 = new Set((b.instrucciones + '\n' + b.plantilla_entrada).split('\n'));
  const quitadas = (a.instrucciones + '\n' + a.plantilla_entrada).split('\n').filter((l) => !lineas4.has(l));
  assert.equal(quitadas.length, 1, quitadas.join(' | '));
  assert.match(quitadas[0], /^- Si un criterio necesita una situación para aplicar/);
  assert.match(b.instrucciones, /^- GUIA_SITUACIONES \(en ESCENARIO\) trae, para los criterios pedidos que solo aplican si ocurre algo/m);
  assert.match(b.instrucciones, /^5\. Cada situación de GUIA_SITUACIONES ocurre de verdad en el chat\.$/m);
});

test('v4: ninguna de las dos guías se envía completa (sus líneas no están en el texto enviado)', () => {
  const { instrucciones, plantilla_entrada } = js4.leerPlantilla(V4, 'generador_ce_v4');
  for (const l of [...FALLAS_V4.values(), ...SITUACIONES_V4.values()]) {
    assert.ok(!instrucciones.includes(l) && !plantilla_entrada.includes(l), `se envía completa: ${l.slice(0, 50)}`);
  }
});

test('v1, v2 y v3 no cambiaron: son idénticas, byte a byte, a las del último commit (git show HEAD)', () => {
  for (const v of ['v1', 'v2', 'v3']) {
    const enHead = execFileSync('git', ['show', `HEAD:prompts/generador_ce_${v}.md`], { cwd: RAIZ, encoding: 'utf8' });
    assert.equal(PLANTILLAS[v], enHead, `prompts/generador_ce_${v}.md cambió`);
  }
});

// --- Guía de fallas v4 ----------------------------------------------------------------------------

test('guía de fallas v4: mismos 52 criterios que v3; solo cambian apertura.ofrece_ayuda y comunicacion.redaccion', () => {
  assert.deepEqual([...FALLAS_V4.keys()].sort(), [...FALLAS_V3.keys()].sort());
  assert.equal(FALLAS_V4.size, 52);
  const cambiadas = [...FALLAS_V4.keys()].filter((id) => FALLAS_V4.get(id) !== FALLAS_V3.get(id));
  assert.deepEqual(cambiadas.sort(), ['apertura.ofrece_ayuda', 'comunicacion.redaccion']);
  assert.equal(js4.guiaFallas(V4, pedibles()).split('\n').length, pedibles().length);
});

test('guía de fallas v4, comunicacion.redaccion: al menos 2 mensajes, ejemplo ficticio y sin mezclar ortografía', () => {
  const l = FALLAS_V4.get('comunicacion.redaccion');
  assert.match(l, /^- comunicacion\.redaccion: .+ \|\| .+/);
  const [falla, noTocar] = l.split(' || ');
  assert.match(falla, /en al menos 2 mensajes del agente/);
  assert.match(falla, /Ejemplo ficticio del estilo \(no lo copies\)/);
  for (const rasgo of ['ideas encimadas sin puntos ni comas', 'concordancia rota', 'referencias ambiguas']) assert.ok(falla.includes(rasgo), rasgo);
  assert.match(noTocar, /mala redacción NO es mala ortografía; sin errores de ortografía salvo que se pida comunicacion\.ortografia/);
  assert.match(noTocar, /todos los pasos, datos y plazos del artículo presentes y en orden/);
  // Los dos mensajes de ejemplo (entre comillas, separados por " / ") no activan reglas JS de
  // comunicación: sin vicio_lenguaje, termino_prohibido, frase_negativa ni palabra_altisonante,
  // y sin signos sin abrir (no tienen preguntas ni exclamaciones).
  const ejemplo = falla.slice(falla.indexOf('(no lo copies): ') + '(no lo copies): '.length);
  const mensajes = ejemplo.split('" / "').map((m) => m.replace(/^"|"\.?$/g, ''));
  assert.equal(mensajes.length, 2);
  const compiladas = reglas.compilarListas(DATOS.listas.filter((f) => f.activo === 'si' && (f.tipo_interaccion === 'ce' || f.tipo_interaccion === 'todos')));
  for (const m of mensajes) {
    assert.ok(m.length > 80, m);
    assert.doesNotMatch(m, /[?!¿¡]/);
    for (const clave of ['vicio_lenguaje', 'termino_prohibido', 'frase_negativa', 'palabra_altisonante']) {
      assert.deepEqual(reglas.buscarEnLista(compiladas, clave, reglas.normalizarTexto(m)), [], `${clave} en: ${m}`);
    }
  }
  // El ejemplo sigue KB-03 (contenido técnico correcto): ruta del menú, timbrado y plazo del día 5.
  const kb03 = BASE.find((a) => a.id_articulo === 'KB-03');
  assert.ok(kb03.contenido.includes('Facturación > Complementos de pago > Nuevo') && mensajes[0].includes('Facturación y en Complementos de pago le das en Nuevo'));
  assert.ok(kb03.plazos.includes('día 5 del mes siguiente') && mensajes[1].includes('el 5 del mes siguiente'));
});

test('guía de fallas v4, apertura.ofrece_ayuda: tampoco confirma la solicitud, con frases que sí están en la lista', () => {
  const l = FALLAS_V4.get('apertura.ofrece_ayuda');
  assert.match(l, /no pregunta en qué puede ayudar ni confirma la solicitud/);
  const ofrece = new Set(DATOS.listas.filter((f) => f.clave_lista === 'ofrece_ayuda').map((f) => f.valor));
  for (const f of ['entiendo que necesitas', 'con gusto te ayudo', 'te ayudo con']) {
    assert.ok(l.includes(`"${f}"`), f);
    assert.ok(ofrece.has(f), `${f} no está en ofrece_ayuda`);
  }
});

test('el ejemplo de redacción solo viaja si se pide comunicacion.redaccion', () => {
  const MARCA = 'Ejemplo ficticio del estilo';
  assert.ok(js4.guiaFallas(V4, ['comunicacion.redaccion']).includes(MARCA));
  assert.ok(!js4.guiaFallas(V4, ['comunicacion.ortografia', 'diagnostico.preguntas_necesarias']).includes(MARCA));
  assert.ok(entradaV4(['diagnostico.preguntas_necesarias', 'comunicacion.redaccion']).includes(MARCA));
  assert.ok(!entradaV4(['diagnostico.preguntas_necesarias', 'comunicacion.congruencia']).includes(MARCA));
  assert.ok(!entradaV4([], 'buena').includes(MARCA));
  // Tampoco va en las instrucciones (system).
  assert.ok(!js4.leerPlantilla(V4, 'generador_ce_v4').instrucciones.includes(MARCA));
});

// --- Guía de situaciones vs rúbrica ----------------------------------------------------------------

const SITUACIONALES_OBLIGATORIOS = [
  'empatia.identifica_emocion', 'empatia.muestra_empatia', 'empatia.asertividad', 'diagnostico.preguntas_necesarias',
  'solucion.ofrece_alternativas', 'solucion.escala_cuando_requiere', 'solucion.no_escala_innecesario', 'solucion.seguimiento_en_plazo',
  'comunicacion.pide_espera', 'comunicacion.agradece_espera', 'comunicacion.retoma_a_tiempo', 'comunicacion.no_excede_espera',
  'recapitulacion.recordatorio_inactividad', 'recapitulacion.cierre_inactividad', 'ayuda_adicional.encuesta', 'ayuda_adicional.encuesta_caso_cerrado',
];
// Pedibles con "no_aplica cuando" distinto de "Nunca" que NO llevan línea de situación, y por qué.
const SIN_SITUACION = {
  'solucion.campos_obligatorios': 'depende del catálogo, que W0 ya controla (rubrica.md 8)',
  'ayuda_adicional.campana_vigente': 'depende de config.campana_vigente_activa, que W0 ya controla (rubrica.md 8)',
  'comunicacion.signos_apertura': 'el agente siempre hace preguntas en una conversación normal (sección 5)',
  'recapitulacion.recapitula': 'solo no aplica con cierre por inactividad; aplica en una conversación normal',
  'recapitulacion.uso_solucion_seguimiento': 'solo no aplica con sin_caso o inactividad; aplica en una conversación normal',
  'recapitulacion.informa_numero_caso': 'solo no aplica si numero_caso es null; aplica en una conversación normal',
  'recapitulacion.numero_caso_coincide': 'solo no aplica si el agente no comunica número de caso; aplica en una conversación normal',
  'ayuda_adicional.ofrece_ayuda_adicional': 'solo no aplica con cierre por inactividad; aplica en una conversación normal',
  'ayuda_adicional.canales_horarios': 'solo no aplica con cierre por inactividad; aplica en una conversación normal',
};

test('guía de situaciones: cubre los situacionales pedidos y coincide con la columna "no_aplica cuando" de la rúbrica', () => {
  const ids = [...SITUACIONES_V4.keys()];
  assert.equal(ids.length, 18);
  for (const id of SITUACIONALES_OBLIGATORIOS) assert.ok(SITUACIONES_V4.has(id), `falta ${id}`);
  // Toda línea de situación es de un criterio que también está en la guía de fallas (pedible).
  for (const id of ids) assert.ok(FALLAS_V4.has(id), `${id} no es pedible`);
  // Solo llevan línea los que pueden quedar no_aplica, más los dos de solicitudes (que necesitan una segunda solicitud para fallar).
  for (const id of ids) {
    const regla = noAplicaCuando(id);
    if (['diagnostico.solicitudes_detectadas', 'diagnostico.solicitudes_atendidas'].includes(id)) assert.equal(regla, 'Nunca.', id);
    else assert.notEqual(regla, 'Nunca.', id);
  }
  // Y al revés: cada pedible que puede quedar no_aplica tiene línea o está en SIN_SITUACION con su motivo.
  const subelementos = pedibles().filter((id) => !id.startsWith('identidad.'));
  for (const id of subelementos) {
    if (noAplicaCuando(id) === 'Nunca.') continue;
    assert.ok(SITUACIONES_V4.has(id) !== Object.hasOwn(SIN_SITUACION, id), `${id}: debe tener línea de situación o motivo en SIN_SITUACION (no ambos)`);
  }
});

test('guía de situaciones: formato "criterio: situación || qué más aplica" y solo nombra claves que existen', () => {
  const claves = new Set([...DATOS.listas.map((f) => f.clave_lista), ...DATOS.config.map((f) => f.clave)]);
  const campos = new Set(['estado_caso', 'en_seguimiento']);
  const desconocidos = new Set();
  for (const l of SITUACIONES_V4.values()) {
    assert.match(l, /^- [a-z_]+\.[a-z_]+: .+ \|\| .+/);
    assert.equal(l.split(' || ').length, 2, l.slice(0, 60));
    // Los IDs de criterio que nombra existen en la guía de fallas o en la rúbrica.
    for (const id of l.match(/\b[a-z_]+\.[a-z_]+\b/g) || []) assert.ok(FALLAS_V4.has(id) || RUBRICA.includes(`\`${id}\``), id);
    const cuerpo = l.replace(/\b[a-z_]+\.[a-z_]+\b/g, '');
    for (const nombre of cuerpo.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || []) if (!claves.has(nombre) && !campos.has(nombre)) desconocidos.add(nombre);
    // Nada en el texto que el modelo pueda copiar como frase negativa.
    assert.ok(!reglas.normalizarTexto(l).includes('no se puede'), l.slice(0, 60));
  }
  assert.deepEqual([...desconocidos], []);
});

// --- guiaSituaciones ------------------------------------------------------------------------------

test('guiaSituaciones: solo las líneas de los criterios pedidos que tienen una, en el orden pedido', () => {
  const g = js4.guiaSituaciones(V4, ['comunicacion.redaccion', 'solucion.ofrece_alternativas', 'empatia.asertividad', 'cierre.marca']);
  const lineas = g.split('\n');
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0], SITUACIONES_V4.get('solucion.ofrece_alternativas'));
  assert.equal(lineas[1], SITUACIONES_V4.get('empatia.asertividad'));
  assert.match(lineas[0], /la solución principal NO es posible para el cliente/);
  // Texto "a|b" (celda de Sheets) y repetidos.
  assert.equal(js4.guiaSituaciones(V4, 'solucion.ofrece_alternativas|solucion.ofrece_alternativas'), lineas[0]);
  // Las tres de espera, cada una sola y con sus hermanas como "también aplican".
  for (const id of ['comunicacion.agradece_espera', 'comunicacion.retoma_a_tiempo', 'comunicacion.no_excede_espera']) {
    const l = js4.guiaSituaciones(V4, [id]);
    assert.match(l, /pide un momento con una frase de pide_espera/);
    assert.match(l, /\|\| también aplican comunicacion\./);
  }
});

test('guiaSituaciones: sin criterios o sin criterios situacionales -> ninguna', () => {
  for (const vacio of [[], '', null, undefined]) assert.equal(js4.guiaSituaciones(V4, vacio), 'ninguna');
  assert.equal(js4.guiaSituaciones(V4, ['comunicacion.redaccion', 'apertura.saludo', 'cierre.marca']), 'ninguna');
});

test('guiaSituaciones: línea mal formada, repetida o plantilla sin el bloque -> error', () => {
  const mal = V4.replace('<!-- FIN_GUIA_SITUACIONES -->', '- esto no es un criterio\n<!-- FIN_GUIA_SITUACIONES -->');
  assert.throws(() => js4.guiaSituaciones(mal, []), /guía de situaciones tiene una línea mal formada/);
  const linea = SITUACIONES_V4.get('empatia.identifica_emocion');
  const doble = V4.replace('<!-- FIN_GUIA_SITUACIONES -->', `${linea}\n<!-- FIN_GUIA_SITUACIONES -->`);
  assert.throws(() => js4.guiaSituaciones(doble, []), /dos líneas para empatia\.identifica_emocion/);
  assert.throws(() => js4.guiaSituaciones(V3, ['solucion.ofrece_alternativas']), /GUIA_SITUACIONES/);
  assert.throws(() => js4.guiaSituaciones('', []), /plantilla/);
  // guiaFallas sigue con sus mensajes de siempre.
  assert.throws(() => js4.guiaFallas(V4, ['apertura.toma_a_tiempo']), /La guía de fallas de la plantilla no tiene línea para: apertura\.toma_a_tiempo/);
});

// --- Apertura: confirmar la solicitud ------------------------------------------------------------

test('apertura v4: las frases de confirmación del prompt las reconoce la lista ofrece_ayuda (búsqueda de js/reglas.js)', () => {
  const { instrucciones } = js4.leerPlantilla(V4, 'generador_ce_v4');
  const vineta = instrucciones.split('\n').find((l) => l.startsWith('- Si el primer mensaje del cliente ya dice qué necesita'));
  assert.ok(vineta);
  assert.match(vineta, /Salvo que se pida apertura\.ofrece_ayuda\.$/);
  const compiladas = reglas.compilarListas(DATOS.listas.filter((f) => f.clave_lista === 'ofrece_ayuda' && f.activo === 'si'));
  const coincide = (t) => reglas.buscarEnLista(compiladas, 'ofrece_ayuda', reglas.normalizarTexto(t)).length > 0;
  // Cada frase citada entre comillas y el ejemplo completo coinciden; la redacción distinta, no.
  const citadas = (vineta.match(/"([^"]+)"/g) || []).map((x) => x.slice(1, -1));
  assert.ok(citadas.includes('Entiendo que necesitas cambiar el correo de tu cuenta, con gusto te ayudo.'));
  for (const f of citadas) assert.ok(coincide(f), f);
  assert.equal(coincide('Entiendo que quieres cambiar el correo de tu cuenta.'), false);
  // Formas de usted que nombra la sección 5 están en la lista.
  for (const f of ['entiendo que necesita', 'entiendo que requiere', 'con gusto le ayudo', 'le ayudo con']) assert.ok(coincide(f), f);
  // La verificación final lo revisa.
  assert.match(instrucciones, /^6\. Si el cliente planteó su solicitud en su primer mensaje, el agente la confirma con una frase de ofrece_ayuda \(salvo que se pida apertura\.ofrece_ayuda\)\.$/m);
});

// --- valoresGenerador por versión ------------------------------------------------------------------

test('valoresGenerador llena v1 (13), v2 (15), v3 (17) y v4 (18) sin marcadores sin resolver', () => {
  const esperados = { v1: MARCADORES_V1, v2: MARCADORES_V2, v3: MARCADORES_V3, v4: MARCADORES_V4 };
  const porVersion = {};
  for (const v of ['v1', 'v2', 'v3', 'v4']) {
    const valores = js4.valoresGenerador(datos({ plantilla: PLANTILLAS[v] }));
    assert.deepEqual(Object.keys(valores).sort(), [...esperados[v]].sort(), v);
    for (const [k, x] of Object.entries(valores)) assert.ok(typeof x === 'string' && x.trim() !== '', `${v}: ${k} vacío`);
    const c = peticion(PLANTILLAS[v], valores, `generador_ce_${v}`);
    assert.doesNotMatch(c.messages[0].content, /<<|>>/, v);
    porVersion[v] = valores;
  }
  // Los marcadores comunes valen lo mismo; solo cambia la guía de fallas por la línea de redacción.
  for (const m of MARCADORES_V3) if (m !== 'GUIA_FALLAS') assert.equal(porVersion.v3[m], porVersion.v4[m], m);
  assert.equal(porVersion.v4.GUIA_FALLAS.split('\n')[0], porVersion.v3.GUIA_FALLAS.split('\n')[0]); // diagnostico.preguntas_necesarias no cambió
});

test('valoresGenerador v4, caso 9 (preguntas_necesarias + redaccion): guía de fallas con ejemplo y guía de situaciones de preguntas_necesarias', () => {
  const v = js4.valoresGenerador(datos());
  assert.equal(v.GUIA_FALLAS, js4.guiaFallas(V4, ['diagnostico.preguntas_necesarias', 'comunicacion.redaccion']));
  assert.equal(v.GUIA_SITUACIONES, SITUACIONES_V4.get('diagnostico.preguntas_necesarias'));
  const entrada = peticion(V4, v, 'generador_ce_v4').messages[0].content;
  assert.ok(entrada.indexOf('- GUIA_SITUACIONES (') < entrada.indexOf('CUENTA (datos ficticios)'));
  // 2 líneas de fallas + 1 de situaciones, nada más de las guías.
  assert.equal((entrada.match(/^- [a-z_]+\.[a-z_]+: /gm) || []).length, 3);
});

test('valoresGenerador v4, CONV-0129 (ofrece_alternativas): la situación que lo hace aplicable viaja en la entrada', () => {
  const entrada = entradaV4(['solucion.ofrece_alternativas', 'empatia.cordialidad']);
  assert.ok(entrada.includes(SITUACIONES_V4.get('solucion.ofrece_alternativas')));
  assert.ok(!entrada.includes(SITUACIONES_V4.get('empatia.asertividad')));
  assert.match(entrada, /GUIA_SITUACIONES \(criterio: situación que debes crear \|\| qué más aplica al crearla\):\n- solucion\.ofrece_alternativas: /);
});

test('valoresGenerador v4 sin criterios (calidad buena): GUIA_FALLAS = ninguno y GUIA_SITUACIONES = ninguna', () => {
  const v = js4.valoresGenerador(datos({ escenario: escenario({ calidad_esperada: 'buena', criterios_que_deben_fallar: [] }) }));
  assert.equal(v.GUIA_FALLAS, 'ninguno');
  assert.equal(v.GUIA_SITUACIONES, 'ninguna');
  assert.match(peticion(V4, v, 'generador_ce_v4').messages[0].content, /qué más aplica al crearla\):\nninguna\n/);
});

test('valoresGenerador v4 con un escenario real de completarEscenario (js/simulador.js)', () => {
  let i = 0;
  const azar = [0.99, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const r = S.completarEscenario(
    { tipo_interaccion: 'ce', tema: null, calidad_solicitada: 'regular', errores_criticos_inyectados: [], cantidad: 1, lote: 'demo' },
    { config: configCE(), catalogo: DATOS.catalogo, cuentas: DATOS.cuentas, conversationId: 'CONV-0302', aleatorio: () => azar[i++ % azar.length], ahora: new Date('2026-10-21T16:00:00Z') }
  );
  assert.equal(r.valido, true, (r.errores || []).join(' | '));
  const v = js4.valoresGenerador(datos({ escenario: r.escenario, extras: r.extras, cuenta: r.cuenta }));
  const pedidos = r.escenario.criterios_que_deben_fallar;
  assert.equal(v.GUIA_FALLAS, pedidos.length ? js4.guiaFallas(V4, pedidos) : 'ninguno');
  assert.equal(v.GUIA_SITUACIONES, js4.guiaSituaciones(V4, pedidos));
  assert.doesNotMatch(peticion(V4, v, 'generador_ce_v4').messages[0].content, /<<|>>/);
});
