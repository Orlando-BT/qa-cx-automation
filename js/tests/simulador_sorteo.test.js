/**
 * Pruebas del sorteo de W0 con semilla: fallas, incompatibilidades (rubrica.md sección 8),
 * fecha de inicio, tipificación errónea y límites del formulario.
 * Fixtures propios; no se usa nada del lote de calibración.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../simulador');
const { RUBRICAS } = require('../scoring');
const { configCE, DATOS, evaluar, criterio } = require('./ayudas');
const { payloadBase, CONVERSACION_BUENA, llmBueno } = require('./fixtures');
const { columnasDeHoja } = require('./columnas_contrato');

const RAIZ = path.join(__dirname, '..', '..');
const config = configCE();
const catalogo = DATOS.catalogo;
const cuentas = DATOS.cuentas;
const AHORA = new Date('2026-10-24T18:00:00Z'); // sábado 12:00 en America/Mexico_City

const solicitudBase = (cambios = {}) => ({
  tipo_interaccion: 'ce',
  tema: null,
  calidad_solicitada: 'aleatoria',
  errores_criticos_inyectados: [],
  criterios_que_deben_fallar: [],
  casos_dificiles: [],
  cantidad: 1,
  lote: 'demo',
  semilla_sorteo: null,
  ...cambios,
});
const escenario = (cambios, semilla, extra = {}) => S.completarEscenario(solicitudBase(cambios), { config, catalogo, cuentas, conversationId: 'CONV-0300', semilla, ahora: AHORA, ...extra });

const CRITICOS = S.CRITICOS_POR_VERSION.reglas_ce_v1;
const SEMILLAS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);

// --- Lectura independiente de rubrica.md sección 8 --------------------------

/** { critico: { id: motivo } } leído de la tabla de la sección 8 de rubrica.md. */
function tablaSeccion8() {
  const texto = fs.readFileSync(path.join(RAIZ, 'contrato', 'rubrica.md'), 'utf8');
  const seccion = texto.slice(texto.indexOf('## 8. Simulador'));
  const tabla = {};
  for (const linea of seccion.split('\n')) {
    const m = /^\| `(critico\.[a-z_]+)` \| (.+?) \| (.+?) \|/.exec(linea);
    if (!m) continue;
    tabla[m[1]] = tabla[m[1]] || {};
    const motivo = /^(implicado|inaplicable|contradice)/.exec(m[3]);
    for (const id of m[2].matchAll(/`([a-z_]+\.[a-z_]+)`/g)) tabla[m[1]][id[1]] = motivo ? motivo[1] : null;
  }
  return { tabla, texto: seccion };
}

test('la tabla de incompatibilidades de simulador.js es igual a la sección 8 de rubrica.md', () => {
  const { tabla } = tablaSeccion8();
  const mio = {};
  for (const [critico, filas] of Object.entries(S.INCOMPATIBLES_CON_CRITICO)) {
    if (filas.length) mio[critico] = Object.fromEntries(filas);
  }
  for (const c of Object.keys(tabla)) if (Object.keys(tabla[c]).length === 0) delete tabla[c];
  assert.deepEqual(mio, tabla);
  // Todos los críticos de la rúbrica aparecen en la tabla del código (aunque sea vacíos).
  assert.deepEqual(Object.keys(S.INCOMPATIBLES_CON_CRITICO).sort(), [...CRITICOS].sort());
  // Decisiones del dueño: estos dos NO se excluyen nunca.
  const todos = Object.values(S.INCOMPATIBLES_CON_CRITICO).flat().map(([id]) => id);
  assert.equal(todos.includes('ayuda_adicional.encuesta_caso_cerrado'), false);
  assert.equal(todos.includes('solucion.campos_obligatorios'), false);
});

test('pares excluyentes y fallas que activan críticos coinciden con la sección 8', () => {
  const { texto } = tablaSeccion8();
  for (const par of S.PARES_EXCLUYENTES) for (const id of par) assert.ok(texto.includes(`\`${id}\``), id);
  for (const [id, critico] of Object.entries(S.ACTIVA_CRITICO)) {
    assert.ok(texto.includes(`\`${id}\``), id);
    assert.ok(texto.includes(`\`${critico}\``), critico);
  }
  assert.ok(texto.includes(`\`${S.VARIANTE_SIN_CRITICO}\``));
});

test('los subelementos duplicados en simulador.js coinciden con scoring.js (ID y clase)', () => {
  const rubrica = RUBRICAS.reglas_ce_v1;
  const esperado = [];
  for (const s of rubrica.secciones) for (const [sub, , clase] of s.subelementos) esperado.push({ id: `${s.id}.${sub}`, seccion: s.id, clase });
  for (const [sub] of rubrica.identidad) esperado.push({ id: `identidad.${sub}`, seccion: 'identidad', clase: null });
  assert.deepEqual(S.listarSubelementos('reglas_ce_v1'), esperado);
  assert.equal(S.listarSubelementos('reglas_sales_v1'), null);
});

test('ningún archivo de evaluación usa la tabla de incompatibilidades del simulador', () => {
  for (const archivo of ['reglas.js', 'reglas_hibridas.js', 'scoring.js', 'normalizacion.js', 'enmascaramiento.js']) {
    const texto = fs.readFileSync(path.join(RAIZ, 'js', archivo), 'utf8');
    assert.doesNotMatch(texto, /INCOMPATIBLES_CON_CRITICO|ACTIVA_CRITICO|PARES_EXCLUYENTES|sortearFallas|motivoRechazoCriterio|require\(.*simulador/, archivo);
  }
});

// --- Semilla ----------------------------------------------------------------

test('crearAleatorio: misma semilla, misma secuencia; valores en [0, 1)', () => {
  const a = S.crearAleatorio(12345);
  const b = S.crearAleatorio(12345);
  const c = S.crearAleatorio(12346);
  const sa = Array.from({ length: 50 }, a);
  assert.deepEqual(sa, Array.from({ length: 50 }, b));
  assert.notDeepEqual(sa, Array.from({ length: 50 }, c));
  for (const x of sa) assert.ok(x >= 0 && x < 1);
  assert.throws(() => S.crearAleatorio(1.5), /semilla/);
  assert.throws(() => S.crearAleatorio(-1), /semilla/);
  assert.throws(() => S.crearAleatorio(2 ** 32), /semilla/);
  assert.equal(S.semillaDesdeAleatorio(0.5), 2147483648);
});

test('misma semilla + mismos datos = mismo escenario; otra semilla da otro', () => {
  const a = escenario({}, 42);
  const b = escenario({}, 42);
  assert.deepEqual(a, b);
  assert.equal(a.escenario.semilla_sorteo, 42);
  const distintos = new Set(SEMILLAS.map((s) => JSON.stringify(escenario({}, s).escenario)));
  assert.ok(distintos.size > 20, 'las semillas distintas producen escenarios distintos');
});

test('la semilla y los criterios finales van a la fila de escenarios', () => {
  const r = escenario({ calidad_solicitada: 'regular' }, 777);
  const fila = S.filaEscenarios(r.escenario, { modelo_generador: 'm', version_prompt_generador: 'generador_ce_v1', tokens_entrada: 1, tokens_salida: 1, costo_generacion_usd: null, generado_en: AHORA }, config);
  assert.equal(fila.semilla_sorteo, 777);
  assert.equal(fila.criterios_que_deben_fallar, r.escenario.criterios_que_deben_fallar.join('|'));
  assert.notEqual(fila.criterios_que_deben_fallar, '');
  assert.deepEqual(Object.keys(fila), columnasDeHoja('escenarios'));
});

test('planificarEscenarios: cada fila guarda su semilla (base + i) y se reproduce sola', () => {
  const p = S.planificarEscenarios(solicitudBase({ cantidad: 3, semilla_sorteo: 1000, calidad_solicitada: 'regular' }), { config, catalogo, cuentas, idsExistentes: ['CONV-0100'], ahora: AHORA });
  assert.equal(p.valido, true, p.errores.join('; '));
  assert.deepEqual(p.escenarios.map((e) => e.escenario.semilla_sorteo), [1000, 1001, 1002]);
  const otra = S.completarEscenario(solicitudBase({ calidad_solicitada: 'regular' }), { config, catalogo, cuentas, conversationId: 'CONV-0102', semilla: 1001, ahora: AHORA });
  assert.deepEqual(otra.escenario, p.escenarios[1].escenario);
  // Sin semilla del formulario, usa la que genera el pegamento.
  const q = S.planificarEscenarios(solicitudBase(), { config, catalogo, cuentas, idsExistentes: [], semillaNueva: 5, ahora: AHORA });
  assert.equal(q.escenarios[0].escenario.semilla_sorteo, 5);
  const sin = S.planificarEscenarios(solicitudBase(), { config, catalogo, cuentas, idsExistentes: [], ahora: AHORA });
  assert.equal(sin.valido, false);
  assert.match(sin.errores[0], /semilla/);
});

// --- Formulario: criterios, casos, semilla y cantidad -----------------------

const validar = (formulario) => S.validarFormulario(formulario, { config, catalogo });

test('un subelemento inexistente se rechaza nombrando el valor', () => {
  const r = validar({ criterios_que_deben_fallar: 'empatia.cordialidad|apertura.inventado' });
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /"apertura\.inventado" no es un subelemento de reglas_ce_v1/);
  assert.equal(validar({ criterios_que_deben_fallar: 'apertura' }).valido, false, 'una sección sola no es subelemento');
});

test('un informativo no se puede pedir como falla', () => {
  const r = validar({ criterios_que_deben_fallar: 'diagnostico.numero_preguntas' });
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /"diagnostico\.numero_preguntas" es informativo/);
});

test('un caso difícil fuera del glosario se rechaza nombrando el valor', () => {
  const r = validar({ casos_dificiles: 'critico_escondido, caso_raro' });
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /"caso_raro"/);
  assert.deepEqual(validar({ casos_dificiles: 'critico_escondido' }).solicitud.casos_dificiles, ['critico_escondido']);
});

test('una combinación incompatible pedida en el formulario se rechaza con el motivo', () => {
  const r = validar({ calidad_solicitada: 'mala', error_critico: 'critico.abandono', criterios_que_deben_fallar: 'cierre.despedida' });
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /"cierre\.despedida" no puede pedirse como falla junto con critico\.abandono \(implicado\)/);
  const par = validar({ criterios_que_deben_fallar: 'solucion.escala_cuando_requiere|solucion.no_escala_innecesario' });
  assert.match(par.errores.join(' '), /solo uno de los dos aplica/);
  assert.equal(validar({ criterios_que_deben_fallar: 'empatia.cordialidad|comunicacion.ortografia' }).valido, true);
});

test('fallas que activarían un crítico no pedido se rechazan', () => {
  for (const id of ['apertura.toma_a_tiempo', 'recapitulacion.tipificacion', 'identidad.pide_datos', 'identidad.orden_validacion']) {
    const r = validar({ calidad_solicitada: 'regular', criterios_que_deben_fallar: id });
    assert.equal(r.valido, false, id);
    assert.match(r.errores.join(' '), new RegExp(`"${id.replace('.', '\\.')}" activaría critico\\.`));
  }
  // Con el crítico pedido, el subelemento sería redundante (implicado): también se rechaza.
  assert.equal(validar({ calidad_solicitada: 'mala', error_critico: 'critico.validacion_identidad', criterios_que_deben_fallar: 'identidad.pide_datos' }).valido, false);
});

test('identidad.datos_coinciden sin crítico solo se acepta en regular (variante del dueño)', () => {
  assert.equal(validar({ calidad_solicitada: 'regular', criterios_que_deben_fallar: 'identidad.datos_coinciden' }).valido, true);
  const mala = validar({ calidad_solicitada: 'mala', criterios_que_deben_fallar: 'identidad.datos_coinciden' });
  assert.equal(mala.valido, false);
  assert.match(mala.errores.join(' '), /solo se acepta en calidad regular/);
});

test('semilla_sorteo del formulario: entero válido o rechazo', () => {
  assert.equal(validar({ semilla_sorteo: '123' }).solicitud.semilla_sorteo, 123);
  assert.equal(validar({ semilla_sorteo: 'abc' }).valido, false);
  assert.equal(validar({ semilla_sorteo: '-4' }).valido, false);
  assert.equal(validar({}).solicitud.semilla_sorteo, null);
});

test('semilla_sorteo: vacío o 0 (n8n no los distingue) = sorteo automático; explícita se respeta; inválidas se rechazan', () => {
  for (const v of [0, '0', '', null, undefined]) {
    const r = validar({ semilla_sorteo: v });
    assert.equal(r.valido, true, JSON.stringify(v));
    assert.equal(r.solicitud.semilla_sorteo, null, JSON.stringify(v));
    // Con semilla null, el escenario guarda la semilla nueva inyectada (no 0).
    const p = S.planificarEscenarios(r.solicitud, { config, catalogo, cuentas, idsExistentes: [], semillaNueva: 777, ahora: AHORA });
    assert.equal(p.escenarios[0].escenario.semilla_sorteo, 777);
    assert.notEqual(p.escenarios[0].escenario.semilla_sorteo, 0);
  }
  // Dos solicitudes con 0 y semillas nuevas distintas dan escenarios con semillas distintas.
  const s0 = validar({ semilla_sorteo: 0 }).solicitud;
  const a = S.planificarEscenarios(s0, { config, catalogo, cuentas, idsExistentes: [], semillaNueva: 111, ahora: AHORA });
  const b = S.planificarEscenarios(s0, { config, catalogo, cuentas, idsExistentes: [], semillaNueva: 222, ahora: AHORA });
  assert.notEqual(a.escenarios[0].escenario.semilla_sorteo, b.escenarios[0].escenario.semilla_sorteo);
  // Explícita
  assert.equal(validar({ semilla_sorteo: 12345 }).solicitud.semilla_sorteo, 12345);
  assert.equal(validar({ semilla_sorteo: '4294967295' }).solicitud.semilla_sorteo, 4294967295);
  // Rechazos
  for (const v of [-1, 1.5, 'abc', 4294967296, '4294967296']) {
    const r = validar({ semilla_sorteo: v });
    assert.equal(r.valido, false, JSON.stringify(v));
    assert.match(r.errores.join(' '), /semilla_sorteo.*1 a 4294967295/);
  }
});

test('cantidad mayor que simulador_max_conversaciones se rechaza antes de sortear', () => {
  assert.equal(config.simulador_max_conversaciones, 5);
  assert.equal(validar({ cantidad: '5' }).valido, true);
  const r = validar({ cantidad: '6' });
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /supera el máximo.*5/);
  // Cambiar la config cambia el límite (nada fijo en el código).
  assert.equal(S.validarFormulario({ cantidad: '6' }, { config: { ...config, simulador_max_conversaciones: 10 }, catalogo }).valido, true);
  // planificarEscenarios también lo comprueba, antes de generar IDs o sortear.
  const p = S.planificarEscenarios(solicitudBase({ cantidad: 6, semilla_sorteo: 1 }), { config, catalogo, cuentas, idsExistentes: [], ahora: AHORA });
  assert.equal(p.valido, false);
  assert.equal(p.escenarios.length, 0);
});

// --- Sorteo de fallas -------------------------------------------------------

test('buena no sortea fallas; las del formulario se respetan tal cual', () => {
  assert.deepEqual(escenario({ calidad_solicitada: 'buena' }, 5).escenario.criterios_que_deben_fallar, []);
  const pedido = escenario({ calidad_solicitada: 'regular', criterios_que_deben_fallar: ['empatia.cordialidad', 'cierre.agradece'] }, 5);
  assert.deepEqual(pedido.escenario.criterios_que_deben_fallar, ['empatia.cordialidad', 'cierre.agradece']);
});

test('regular: generador_fallas_regular fallas complementarias de secciones distintas, nunca informativas', () => {
  const subelementos = Object.fromEntries(S.listarSubelementos('reglas_ce_v1').map((s) => [s.id, s]));
  for (const semilla of SEMILLAS) {
    const r = escenario({ calidad_solicitada: 'regular' }, semilla);
    const c = r.escenario.criterios_que_deben_fallar;
    assert.equal(c.length, config.generador_fallas_regular, `semilla ${semilla}`);
    assert.equal(new Set(c.map((id) => subelementos[id].seccion)).size, c.length, 'secciones distintas');
    for (const id of c) {
      assert.notEqual(subelementos[id].clase, 'informativo');
      // Complementarios, salvo la excepción del dueño (variante sin crítico de datos_coinciden).
      assert.ok(subelementos[id].clase === 'complementario' || id === 'identidad.datos_coinciden', id);
      assert.equal(['apertura.toma_a_tiempo', 'recapitulacion.tipificacion', 'identidad.pide_datos', 'identidad.orden_validacion'].includes(id), false, id);
    }
    assert.deepEqual(r.escenario.errores_criticos_inyectados, []);
  }
});

test('la cantidad de fallas sale de config (regular y mala)', () => {
  const cfg = { ...config, generador_fallas_regular: 4, generador_fallas_mala: 3 };
  const regular = S.completarEscenario(solicitudBase({ calidad_solicitada: 'regular' }), { config: cfg, catalogo, cuentas, conversationId: 'CONV-0300', semilla: 9, ahora: AHORA });
  assert.equal(regular.escenario.criterios_que_deben_fallar.length, 4);
  const mala = S.completarEscenario(solicitudBase({ calidad_solicitada: 'mala' }), { config: cfg, catalogo, cuentas, conversationId: 'CONV-0300', semilla: 9, ahora: AHORA });
  assert.equal(mala.escenario.criterios_que_deben_fallar.length, 3);
});

test('mala: generador_fallas_mala subelementos clave además del crítico', () => {
  const subelementos = Object.fromEntries(S.listarSubelementos('reglas_ce_v1').map((s) => [s.id, s]));
  for (const semilla of SEMILLAS) {
    for (const criticos of [[], ['critico.mala_actitud']]) {
      const r = escenario({ calidad_solicitada: 'mala', errores_criticos_inyectados: criticos }, semilla);
      const c = r.escenario.criterios_que_deben_fallar;
      assert.equal(c.length, config.generador_fallas_mala);
      for (const id of c) assert.equal(subelementos[id].clase, 'clave', id);
      assert.deepEqual(r.escenario.errores_criticos_inyectados, criticos);
      assert.equal(r.escenario.calidad_esperada, 'mala');
    }
  }
});

test('ningún sorteo produce una combinación excluida por la sección 8 (todos los críticos, varias semillas)', () => {
  const { tabla } = tablaSeccion8();
  const subelementos = Object.fromEntries(S.listarSubelementos('reglas_ce_v1').map((s) => [s.id, s]));
  for (const critico of CRITICOS) {
    const excluidos = Object.keys(tabla[critico] || {});
    for (const semilla of SEMILLAS) {
      const r = escenario({ calidad_solicitada: 'mala', errores_criticos_inyectados: [critico] }, semilla);
      assert.equal(r.valido, true, `${critico} semilla ${semilla}: ${r.errores}`);
      const c = r.escenario.criterios_que_deben_fallar;
      for (const id of c) {
        assert.equal(excluidos.includes(id), false, `${critico} + ${id}`);
        assert.notEqual(subelementos[id].clase, 'informativo');
        assert.equal(Boolean(S.ACTIVA_CRITICO[id]), false, `${id} activaría un crítico no pedido`);
      }
      for (const par of S.PARES_EXCLUYENTES) assert.equal(par.every((id) => c.includes(id)), false);
    }
  }
});

test('los sorteos regulares tampoco producen pares excluyentes ni repeticiones', () => {
  const cfg = { ...config, generador_fallas_regular: 8 };
  for (const semilla of SEMILLAS) {
    const r = S.completarEscenario(solicitudBase({ calidad_solicitada: 'regular' }), { config: cfg, catalogo, cuentas, conversationId: 'CONV-0300', semilla, ahora: AHORA });
    const c = r.escenario.criterios_que_deben_fallar;
    assert.equal(new Set(c).size, c.length);
    for (const par of S.PARES_EXCLUYENTES) assert.equal(par.every((id) => c.includes(id)), false);
  }
});

test('el sorteo regular puede elegir identidad.datos_coinciden (variante sin crítico) y lo anota', () => {
  let visto = null;
  for (let semilla = 1; semilla <= 400 && !visto; semilla++) {
    const r = escenario({ calidad_solicitada: 'regular' }, semilla);
    if (r.escenario.criterios_que_deben_fallar.includes('identidad.datos_coinciden')) visto = r;
  }
  assert.ok(visto, 'aparece en algún sorteo');
  assert.equal(visto.extras.variante_datos_coinciden_sin_critico, true);
  assert.match(visto.escenario.descripcion_escenario, /Variante sin crítico/);
  assert.deepEqual(visto.escenario.errores_criticos_inyectados, []);
});

test('campos_obligatorios y encuesta_caso_cerrado sí se pueden sortear junto con sus críticos (decisión del dueño)', () => {
  const pedidos = [
    ['critico.tipificacion_incorrecta', 'solucion.campos_obligatorios'],
    ['critico.no_genera_caso', 'ayuda_adicional.encuesta_caso_cerrado'],
  ];
  for (const [critico, id] of pedidos) {
    const r = validar({ calidad_solicitada: 'mala', error_critico: critico, criterios_que_deben_fallar: id });
    assert.equal(r.valido, true, `${critico} + ${id}: ${r.errores}`);
  }
});

// --- Tipificación incorrecta ------------------------------------------------

test('critico.tipificacion_incorrecta: el agente usa una categoría existente del catálogo distinta de la correcta', () => {
  const existentes = new Set(catalogo.map((f) => f.tipificacion_valida));
  for (const semilla of SEMILLAS) {
    const r = escenario({ calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.tipificacion_incorrecta'] }, semilla);
    const errada = r.extras.tipificacion_agente_prevista;
    assert.ok(existentes.has(errada), `existe en catalogo_temas: ${errada}`);
    assert.notEqual(errada, r.escenario.tipificacion_esperada);
    const validasDelTema = catalogo.filter((f) => f.tema === r.escenario.tema_esperado).map((f) => f.tipificacion_valida);
    assert.equal(validasDelTema.includes(errada), false, 'no es válida para el tema');
    assert.match(r.escenario.descripcion_escenario, new RegExp(errada));
  }
  // Sin ese crítico no hay tipificación errónea.
  assert.equal(escenario({ calidad_solicitada: 'mala' }, 3).extras.tipificacion_agente_prevista, null);
});

// --- Fecha de inicio --------------------------------------------------------

/** Campos locales (día de la semana y minuto del día) de 'YYYY-MM-DDTHH:MM:SS'. */
function campos(local) {
  const d = new Date(`${local}Z`);
  return { dia: d.getUTCDay(), minuto: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 };
}

function dentroDeHorario(local) {
  const { dia, minuto } = campos(local);
  if (dia >= 1 && dia <= 5) return minuto >= 8 * 60 && minuto < 20 * 60; // lun-vie 08:00-20:00
  if (dia === 6) return minuto >= 9 * 60 && minuto < 14 * 60; // sab 09:00-14:00
  return false; // domingo cerrado
}

test('parsearHorario interpreta la config y rechaza formatos inválidos', () => {
  const h = S.parsearHorario(config.horario_atencion_chat);
  assert.deepEqual(h, [
    { dias: [1, 2, 3, 4, 5], inicio_min: 480, fin_min: 1200 },
    { dias: [6], inicio_min: 540, fin_min: 840 },
  ]);
  assert.throws(() => S.parsearHorario(['lunes 8-20']), /inválido/);
  assert.throws(() => S.parsearHorario(['xyz 08:00-20:00']), /día desconocido/);
  assert.throws(() => S.parsearHorario(['lun 20:00-08:00']), /horas inválidas/);
});

test('la fecha de inicio cae en horario (zona de config), dentro del rango y nunca en el futuro', () => {
  const ahoras = [
    new Date('2026-10-24T18:00:00Z'), // sábado 12:00 local
    new Date('2026-10-25T18:00:00Z'), // domingo (cerrado)
    new Date('2026-10-21T12:00:00Z'), // miércoles 06:00 local (antes de abrir)
    new Date('2026-10-23T05:00:00Z'), // jueves 23:00 del miércoles... local 23:00 vie? fuera de horario
  ];
  const vistos = { sabado: false };
  for (const ahora of ahoras) {
    for (const semilla of SEMILLAS) {
      const local = S.sortearFechaInicio(config, ahora, S.crearAleatorio(semilla));
      assert.match(local, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/);
      assert.ok(dentroDeHorario(local), `${local} (ahora ${ahora.toISOString()}) fuera de horario`);
      const instante = Date.parse(`${local}-06:00`); // México no tiene horario de verano desde 2022
      assert.ok(instante <= ahora.getTime(), `${local} está en el futuro`);
      assert.ok(instante >= ahora.getTime() - config.simulador_dias_atras * 86400000, `${local} es demasiado antigua`);
      if (campos(local).dia === 6) vistos.sabado = true;
    }
  }
  assert.ok(vistos.sabado, 'también se sortean sábados');
});

test('con ahora en domingo, el último instante válido es el cierre del sábado anterior', () => {
  const domingo = new Date('2026-10-25T18:00:00Z');
  // Una sola semana atrás: todos los sorteos caen antes del cierre del sábado 24 a las 14:00 local.
  const cfg = { ...config, simulador_dias_atras: 0 };
  assert.throws(() => S.sortearFechaInicio(cfg, domingo, S.crearAleatorio(1)), /ningún instante/);
  const cfg1 = { ...config, simulador_dias_atras: 1 };
  for (const semilla of SEMILLAS) {
    const local = S.sortearFechaInicio(cfg1, domingo, S.crearAleatorio(semilla));
    assert.ok(local.startsWith('2026-10-24T'), local);
    assert.ok(dentroDeHorario(local));
  }
});

test('el horario se aplica en la zona de config (zona con horario de verano)', () => {
  const cfg = { ...config, zona_horaria: 'America/New_York' };
  const ahora = new Date('2026-03-10T20:00:00Z'); // tras el cambio de horario del 8 de marzo
  for (const semilla of SEMILLAS) {
    const local = S.sortearFechaInicio(cfg, ahora, S.crearAleatorio(semilla));
    assert.ok(dentroDeHorario(local), local);
  }
});

test('horario_atencion_chat de config coincide con el horario escrito en KB-08', () => {
  const kb = fs.readFileSync(path.join(RAIZ, 'datos', 'base_conocimiento.md'), 'utf8');
  const seccion = kb.slice(kb.indexOf('## KB-08'));
  const m = /lunes a viernes de ([0-9]{1,2}):([0-9]{2}) a ([0-9]{1,2}):([0-9]{2}) y s[aá]bados de ([0-9]{1,2}):([0-9]{2}) a ([0-9]{1,2}):([0-9]{2})/.exec(seccion);
  assert.ok(m, 'KB-08 describe el horario del chat');
  const [, h1, m1, h2, m2, h3, m3, h4, m4] = m.map(Number);
  const h = S.parsearHorario(config.horario_atencion_chat);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], { dias: [1, 2, 3, 4, 5], inicio_min: h1 * 60 + m1, fin_min: h2 * 60 + m2 });
  assert.deepEqual(h[1], { dias: [6], inicio_min: h3 * 60 + m3, fin_min: h4 * 60 + m4 });
  assert.ok(/hora del centro de M[eé]xico/.test(seccion), 'la zona de KB-08 es la de config');
  assert.equal(config.zona_horaria, 'America/Mexico_City');
});

test('el escenario trae la fecha de inicio sorteada con la misma semilla', () => {
  const a = escenario({}, 99);
  assert.ok(dentroDeHorario(a.extras.fecha_hora_inicio));
  assert.equal(escenario({}, 99).extras.fecha_hora_inicio, a.extras.fecha_hora_inicio);
});

// --- Variante sin crítico evaluada con el motor real -----------------------

test('variante sin crítico de datos_coinciden: no_cumple, sin crítico y calidad regular (motor JS-1 a JS-7)', () => {
  // Conversación fixture propia: el cliente da solo el RFC (sin nombre ni correo: 1 dato acertado de los 2 mínimos), el
  // agente no declina pero tampoco revela información de la cuenta: sigue con el trámite.
  const lista = CONVERSACION_BUENA.map((m) => [...m]);
  lista[2][2] = 'Prefiero ir directo al tema.';
  lista[4][2] = 'Mi RFC es TLA190211QM2. El correo registrado no lo recuerdo en este momento.';
  lista[5][2] = 'Gracias por tu respuesta. Para avanzar con tu trámite necesito el UUID de la factura y el motivo de cancelación.';
  const payload = payloadBase(lista);

  // Salida simulada del evaluador: no hay información de la cuenta, y dos fallas complementarias
  // en secciones distintas (informacion_completa en solucion, lenguaje_acorde en empatia).
  const llm = llmBueno();
  llm.primer_mensaje_info_cuenta = { mensaje_n: null, justificacion: 'El agente no menciona datos de la cuenta.' };
  llm.criterios.solucion.informacion_completa = { resultado: 'no_cumple', mensajes: [8], justificacion: 'Falta indicar un paso.' };
  llm.criterios.empatia.lenguaje_acorde = { resultado: 'no_cumple', mensajes: [2], justificacion: 'Tono poco claro.' };

  const { evaluacion } = evaluar(payload, llm);
  const identidad = criterio(evaluacion.criterios, 'identidad.datos_coinciden');
  assert.equal(identidad.resultado, 'no_cumple');
  assert.equal(criterio(evaluacion.criterios, 'identidad.pide_datos').resultado, 'cumple');
  assert.equal(criterio(evaluacion.criterios, 'identidad.orden_validacion').resultado, 'cumple');
  assert.equal(criterio(evaluacion.criterios, 'critico.validacion_identidad').resultado, 'no_detectado');
  assert.equal(evaluacion.tiene_error_critico, false);
  assert.deepEqual(evaluacion.errores_criticos, []);
  assert.equal(evaluacion.calidad, 'regular', `nota_final ${evaluacion.nota_final}`);
  assert.ok(evaluacion.nota_final >= config.calidad_regular_nota_min && evaluacion.nota_final < config.calidad_buena_nota_min);
});

// --- verificarEscenarioGenerado ---------------------------------------------

const { contextoHastaJS3 } = require('./ayudas');
const { calcularIdentidad, revelacionesConfidencialidad } = require('../reglas_hibridas');

const funciones = { calcularIdentidad, revelacionesConfidencialidad };

/** Conversación de la variante: el cliente solo da el RFC y el agente sigue con el trámite sin revelar nada. */
function listaVariante(cambios = {}) {
  const lista = CONVERSACION_BUENA.map((m) => [...m]);
  lista[2][2] = 'Prefiero ir directo al tema.';
  lista[4][2] = 'Mi RFC es TLA190211QM2. El correo registrado no lo recuerdo en este momento.';
  lista[5][2] = 'Gracias por tu respuesta. Para avanzar con tu trámite necesito el UUID de la factura y el motivo de cancelación.';
  for (const [n, texto] of Object.entries(cambios)) lista[n - 1][2] = texto;
  return lista;
}

function verificar(lista, extras, metadatos = {}) {
  const payload = payloadBase(lista, metadatos);
  const contexto = contextoHastaJS3(payload);
  return S.verificarEscenarioGenerado(payload, {}, extras, { contexto, funciones });
}

const EXTRAS_VARIANTE = { variante_datos_coinciden_sin_critico: true, tipificacion_agente_prevista: null };

test('verificar (a): la tipificación del agente debe ser exactamente la errónea pedida', () => {
  const payload = payloadBase(CONVERSACION_BUENA, { tipificacion_agente: 'Alta y permisos de usuarios' });
  const ok = S.verificarEscenarioGenerado(payload, {}, { tipificacion_agente_prevista: 'Alta y permisos de usuarios' });
  assert.deepEqual(ok, { valido: true, errores: [], advertencias: [], tipo_error: null });
  const mal = S.verificarEscenarioGenerado(payload, {}, { tipificacion_agente_prevista: 'Ajuste de inventario' });
  assert.equal(mal.valido, false);
  assert.equal(mal.tipo_error, 'generacion_invalida');
  assert.match(mal.errores[0], /tipificación/);
  // Sin tipificación errónea pedida no se comprueba nada.
  assert.equal(S.verificarEscenarioGenerado(payload, {}, { tipificacion_agente_prevista: null }).valido, true);
  assert.equal(S.verificarEscenarioGenerado(payload, {}, null).valido, true);
});

test('verificar (b): la variante correcta pasa y deja la advertencia de lo no verificable sin LLM', () => {
  const r = verificar(listaVariante(), EXTRAS_VARIANTE);
  assert.equal(r.valido, true, r.errores.join('; '));
  assert.equal(r.tipo_error, null);
  assert.equal(r.advertencias.length, 1);
  assert.match(r.advertencias[0], /No verificable sin LLM/);
});

test('verificar (b): el cliente que alcanza el mínimo de datos acertados invalida la variante', () => {
  const r = verificar(CONVERSACION_BUENA.map((m) => [...m]), EXTRAS_VARIANTE);
  assert.equal(r.valido, false);
  assert.equal(r.tipo_error, 'generacion_invalida');
  assert.match(r.errores.join(' '), /alcanza el mínimo de datos acertados/);
});

test('verificar (b): el agente que declina invalida la variante', () => {
  const r = verificar(listaVariante({ 6: 'No puedo compartirte información de la cuenta sin validar tu identidad.' }), EXTRAS_VARIANTE);
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /declina/);
});

test('verificar (b): el agente que sigue pidiendo datos invalida la variante', () => {
  const r = verificar(listaVariante({ 10: 'Para validar tu identidad, ¿me compartes tu correo registrado?' }), EXTRAS_VARIANTE);
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /sigue pidiendo datos/);
});

test('verificar (b): el agente que revela un dato de la cuenta invalida la variante, sin copiar el dato', () => {
  const r = verificar(listaVariante({ 6: 'Gracias. Veo que tu correo es hector.villanueva@taquerialosarcos.example; necesito el UUID de la factura.' }), EXTRAS_VARIANTE);
  assert.equal(r.valido, false);
  const texto = r.errores.join(' ');
  assert.match(texto, /revela datos de la cuenta \(mensaje\(s\) 6\)/);
  assert.equal(texto.includes('taquerialosarcos'), false);
  assert.equal(texto.includes('TLA190211QM2'), false);
});

test('verificar (b): si el agente nunca pide datos, datos_coinciden sería no_aplica y la variante es inválida', () => {
  const r = verificar(listaVariante({ 4: 'Gracias. ¿En qué más puedo apoyarte con la cancelación?' }), EXTRAS_VARIANTE);
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /nunca pide datos/);
});

test('verificar: puede acumular varios errores a la vez (tipificación y variante)', () => {
  const payload = payloadBase(CONVERSACION_BUENA);
  const contexto = contextoHastaJS3(payload);
  const r = S.verificarEscenarioGenerado(payload, {}, { tipificacion_agente_prevista: 'Ajuste de inventario', variante_datos_coinciden_sin_critico: true }, { contexto, funciones });
  assert.equal(r.valido, false);
  assert.ok(r.errores.length >= 2);
});

test('verificar: la variante sin contexto ni funciones es un error de uso, no una salida inválida', () => {
  assert.throws(() => S.verificarEscenarioGenerado(payloadBase(CONVERSACION_BUENA), {}, EXTRAS_VARIANTE), /necesita contexto/);
});

test('verificar: sin variante ni tipificación pedidas, cualquier conversación pasa sin advertencias', () => {
  const r = S.verificarEscenarioGenerado(payloadBase(CONVERSACION_BUENA), {}, { tipificacion_agente_prevista: null, variante_datos_coinciden_sin_critico: false });
  assert.deepEqual(r, { valido: true, errores: [], advertencias: [], tipo_error: null });
});

// --- decidirIntentoGeneracion -------------------------------------------------

const { filaLogErrores } = require('../registro_errores');

const escenarioFila = { conversation_id: 'CONV-0300', lote: 'demo', tipo_interaccion: 'ce' };
const lecturaOk = { completa: true, motivo: null, texto: 'TEXTO-SECRETO-DE-LA-CONVERSACION' };
const decidir = (cambios) => S.decidirIntentoGeneracion({ lectura: lecturaOk, validacion: { valido: true, errores: [] }, verificacion: { valido: true, errores: [], advertencias: [] }, intento_generacion: 0, config, escenario: escenarioFila, ...cambios });

test('decidirIntentoGeneracion: todo válido continúa; las advertencias no invalidan', () => {
  assert.equal(config.reintentos_generacion, 1);
  assert.deepEqual(decidir({}), { accion: 'continuar', siguiente_intento: 0, registrar_error: null });
  const conAdvertencia = decidir({ verificacion: { valido: true, errores: [], advertencias: ['No verificable sin LLM'] } });
  assert.equal(conAdvertencia.accion, 'continuar');
  // verificación null con payload válido (no había nada que verificar): continúa.
  assert.equal(decidir({ verificacion: null }).accion, 'continuar');
});

test('decidirIntentoGeneracion: max_tokens no se reintenta (ni en el intento 0 ni en el 1)', () => {
  const lectura = { completa: false, motivo: 'max_tokens', texto: 'TEXTO-SECRETO-DE-LA-CONVERSACION' };
  assert.equal(config.reintentos_generacion, 1);
  for (const intento of [0, 1]) {
    const r = decidir({ lectura, validacion: null, verificacion: null, intento_generacion: intento });
    assert.equal(r.accion, 'generacion_invalida');
    assert.equal(r.siguiente_intento, intento);
    assert.match(r.registrar_error.mensaje_error, /^Generación inválida en el intento/);
    assert.match(r.registrar_error.mensaje_error, /max_tokens_generador/);
    assert.equal(r.registrar_error.detalle.sin_reintento, 'max_tokens');
    assert.equal(r.registrar_error.detalle.motivo_lectura, 'max_tokens');
    assert.equal(JSON.stringify(r).includes('TEXTO-SECRETO'), false);
  }
  // Con más reintentos configurados tampoco se reintenta.
  assert.equal(decidir({ lectura, validacion: null, verificacion: null, config: { ...config, reintentos_generacion: 3 } }).accion, 'generacion_invalida');
});

test('decidirIntentoGeneracion: otro motivo de lectura incompleta sigue reintentando', () => {
  const lectura = { completa: false, motivo: 'json_invalido', texto: 'TEXTO-SECRETO-DE-LA-CONVERSACION' };
  const primero = decidir({ lectura, validacion: null, verificacion: null });
  assert.equal(primero.accion, 'reintentar');
  assert.equal(primero.siguiente_intento, 1);
  assert.equal(primero.registrar_error.detalle.motivo_lectura, 'json_invalido');
  assert.equal(primero.registrar_error.detalle.sin_reintento, undefined);
  const payloadMalo = decidir({ validacion: { valido: false, errores: [{ ruta: '$.x', mensaje: 'falta' }] }, verificacion: null });
  assert.equal(payloadMalo.accion, 'reintentar');
  assert.equal(payloadMalo.registrar_error.detalle.sin_reintento, undefined);
  const segundo = decidir({ lectura, validacion: null, verificacion: null, intento_generacion: 1 });
  assert.equal(segundo.accion, 'generacion_invalida');
  assert.equal(segundo.siguiente_intento, 1);
  assert.match(segundo.registrar_error.mensaje_error, /Sin más reintentos/);
});

test('decidirIntentoGeneracion: el número de reintentos sale de config', () => {
  const lectura = { completa: false, motivo: 'refusal' };
  const dos = { ...config, reintentos_generacion: 2 };
  assert.equal(decidir({ lectura, validacion: null, verificacion: null, config: dos, intento_generacion: 1 }).accion, 'reintentar');
  assert.equal(decidir({ lectura, validacion: null, verificacion: null, config: dos, intento_generacion: 2 }).accion, 'generacion_invalida');
  assert.equal(decidir({ lectura, validacion: null, verificacion: null, config: { ...config, reintentos_generacion: 0 } }).accion, 'generacion_invalida');
});

test('decidirIntentoGeneracion: errores de validación y de verificación van al detalle sin texto', () => {
  const validacion = { valido: false, errores: [{ ruta: '$.mensajes[3].timestamp', mensaje: 'no cumple el formato' }] };
  const r1 = decidir({ validacion, verificacion: null });
  assert.equal(r1.accion, 'reintentar');
  assert.deepEqual(r1.registrar_error.detalle.errores_validacion, validacion.errores);
  const verificacion = { valido: false, errores: ['La tipificación del agente no es la pedida'], advertencias: [] };
  const r2 = decidir({ verificacion, intento_generacion: 1 });
  assert.equal(r2.accion, 'generacion_invalida');
  assert.deepEqual(r2.registrar_error.detalle.errores_verificacion, verificacion.errores);
  for (const r of [r1, r2]) assert.equal(JSON.stringify(r).includes('TEXTO-SECRETO'), false);
});

test('decidirIntentoGeneracion: registrar_error sirve como entrada de filaLogErrores', () => {
  const r = decidir({ lectura: { completa: false, motivo: 'json_invalido' }, validacion: null, verificacion: null });
  assert.deepEqual(
    { workflow: r.registrar_error.workflow, nodo: r.registrar_error.nodo, tipo_error: r.registrar_error.tipo_error, conversation_id: r.registrar_error.conversation_id, lote: r.registrar_error.lote, tipo_interaccion: r.registrar_error.tipo_interaccion },
    { workflow: 'simulador', nodo: 'Decidir intento de generación', tipo_error: 'generacion_invalida', conversation_id: 'CONV-0300', lote: 'demo', tipo_interaccion: 'ce' }
  );
  const fila = filaLogErrores({ ...r.registrar_error, alerta_enviada: false }, config, AHORA);
  assert.equal(fila.tipo_error, 'generacion_invalida');
  assert.equal(fila.conversation_id, 'CONV-0300');
  assert.equal(JSON.parse(fila.detalle_json).motivo_lectura, 'json_invalido');
});
