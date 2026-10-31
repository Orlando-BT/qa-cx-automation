/**
 * Pruebas de aplicabilidad del sorteo de W0: el sorteo (y el formulario) no piden fallar un
 * subelemento que quedaría `no_aplica` por datos que W0 ya conoce (config, fila del catálogo de la
 * tipificación esperada, estado de caso deducido de otras fallas, crítico inyectado).
 * El "oráculo" de esta prueba está escrito aparte del código y lee el catálogo de datos/.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../simulador');
const { configCE, DATOS } = require('./ayudas');

const config = configCE();
const catalogo = DATOS.catalogo;
const cuentas = DATOS.cuentas;
const AHORA = new Date('2026-10-24T18:00:00Z');
const CRITICOS = S.CRITICOS_POR_VERSION.reglas_ce_v1;

const solicitudBase = (cambios = {}) => ({
  tipo_interaccion: 'ce', tema: null, calidad_solicitada: 'aleatoria', errores_criticos_inyectados: [],
  criterios_que_deben_fallar: [], casos_dificiles: [], cantidad: 1, lote: 'demo', semilla_sorteo: null, ...cambios,
});
const escenario = (cambios, semilla, cfg = config) => S.completarEscenario(solicitudBase(cambios), { config: cfg, catalogo, cuentas, conversationId: 'CONV-0300', semilla, ahora: AHORA });
const validar = (formulario, cfg = config) => S.validarFormulario(formulario, { config: cfg, catalogo });
const fila = (tipificacion) => catalogo.find((f) => f.tipificacion_valida === tipificacion);
const camposDe = (f) => String(f.campos_obligatorios || '').split('|').filter(Boolean);

/** Oráculo: motivo por el que `id` quedaría no_aplica con esa fila/config, o null. Independiente del código. */
function oraculoInaplicable(id, f, cfg, criticos, tipificacionAgente) {
  if (id === 'solucion.escala_cuando_requiere') return f.requiere_escalamiento === 'no' ? 'sin escalamiento' : null;
  if (id === 'solucion.no_escala_innecesario') return f.requiere_escalamiento === 'si' ? 'debe escalar' : null;
  if (id === 'ayuda_adicional.campana_vigente') return cfg.campana_vigente_activa === true ? null : 'sin campaña';
  if (id === 'solucion.campos_obligatorios') {
    const usada = criticos.includes('critico.tipificacion_incorrecta') ? fila(tipificacionAgente) : f;
    return camposDe(usada).length === 0 ? 'sin campos' : null;
  }
  return null;
}

const TODOS_LOS_PARES = [...S.PARES_EXCLUYENTES, ...S.PARES_EXCLUYENTES_DEDUCIDOS];
const TIPIFICACIONES = catalogo.filter((f) => f.activo === 'si' && (f.tipo_interaccion === 'ce' || f.tipo_interaccion === 'todos'));

test('datos de la prueba: hay tipificaciones con y sin campos obligatorios y de los tres tipos de escalamiento', () => {
  assert.ok(TIPIFICACIONES.some((f) => camposDe(f).length === 0));
  for (const v of ['si', 'no', 'segun_caso']) assert.ok(TIPIFICACIONES.some((f) => f.requiere_escalamiento === v), v);
});

test('500 semillas x cada tipificación del catálogo: ningún criterio sorteado es inaplicable (regular, mala y mala con crítico)', () => {
  const cfgMuchas = { ...config, generador_fallas_regular: 6, generador_fallas_mala: 6 };
  const casos = [
    { calidad: 'regular', criticos: [] },
    { calidad: 'mala', criticos: [] },
    { calidad: 'mala', criticos: ['critico.no_genera_caso'] },
    { calidad: 'mala', criticos: ['critico.tipificacion_incorrecta'] },
  ];
  const vistos = new Set();
  for (const f of TIPIFICACIONES) {
    for (let semilla = 1; semilla <= 500; semilla++) {
      for (const caso of casos) {
        // Se prueba el sorteo de fallas directamente (rápido) con la fila de la tipificación esperada.
        const r = S.sortearFallas({ calidad: caso.calidad, criticos: caso.criticos, versionReglas: 'reglas_ce_v1', config: cfgMuchas, aleatorio: S.crearAleatorio(semilla), filas: [f] });
        const c = r.criterios;
        for (const id of c) {
          vistos.add(id);
          // Con critico.tipificacion_incorrecta, campos_obligatorios depende de la tipificación errónea (se prueba aparte).
          if (id === 'solucion.campos_obligatorios' && caso.criticos.includes('critico.tipificacion_incorrecta')) continue;
          assert.equal(oraculoInaplicable(id, f, cfgMuchas, caso.criticos, null), null, `${f.tipificacion_valida} semilla ${semilla} ${caso.criticos}: ${id}`);
        }
        for (const par of TODOS_LOS_PARES) assert.equal(par.every((id) => c.includes(id)), false, `${par} en ${c}`);
        if (caso.criticos.includes('critico.no_genera_caso')) {
          for (const id of ['recapitulacion.informa_numero_caso', 'recapitulacion.numero_caso_coincide', 'solucion.seguimiento_en_plazo', 'ayuda_adicional.encuesta', 'recapitulacion.uso_solucion_seguimiento']) assert.equal(c.includes(id), false, id);
        }
      }
    }
  }
  // El sorteo sí sigue eligiendo los criterios que dependen de la fila cuando aplican.
  for (const id of ['solucion.escala_cuando_requiere', 'solucion.no_escala_innecesario', 'solucion.campos_obligatorios', 'ayuda_adicional.campana_vigente']) assert.ok(vistos.has(id), `${id} sigue siendo sorteable`);
});

test('completarEscenario completo (con su tipificación sorteada) tampoco sortea criterios inaplicables', () => {
  const cfgMuchas = { ...config, generador_fallas_regular: 6, generador_fallas_mala: 6 };
  const alcanzadas = new Set();
  for (let semilla = 1; semilla <= 60; semilla++) {
    for (const caso of [{ calidad_solicitada: 'regular' }, { calidad_solicitada: 'mala' }, { calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.tipificacion_incorrecta'] }]) {
      const r = escenario(caso, semilla, cfgMuchas);
      assert.equal(r.valido, true, `${semilla}: ${r.errores}`);
      const f = fila(r.escenario.tipificacion_esperada);
      alcanzadas.add(f.tipificacion_valida);
      for (const id of r.escenario.criterios_que_deben_fallar) {
        assert.equal(oraculoInaplicable(id, f, cfgMuchas, r.escenario.errores_criticos_inyectados, r.extras.tipificacion_agente_prevista), null, `${f.tipificacion_valida} semilla ${semilla}: ${id}`);
      }
    }
  }
  assert.equal(alcanzadas.size, TIPIFICACIONES.length, 'todas las tipificaciones del catálogo se alcanzaron');
});

test('con config.campana_vigente_activa = no nunca se sortea campana_vigente', () => {
  const cfg = { ...config, campana_vigente_activa: false, generador_fallas_regular: 8 };
  for (let semilla = 1; semilla <= 80; semilla++) {
    assert.equal(escenario({ calidad_solicitada: 'regular' }, semilla, cfg).escenario.criterios_que_deben_fallar.includes('ayuda_adicional.campana_vigente'), false);
  }
});

test('casos puntuales del sorteo: escalamiento por la fila de la tipificación', () => {
  // Complemento de pago: requiere_escalamiento = no -> nunca escala_cuando_requiere.
  assert.equal(fila('Emisión de complemento de pago').requiere_escalamiento, 'no');
  const visto = new Set();
  for (let semilla = 1; semilla <= 80; semilla++) {
    const r = escenario({ calidad_solicitada: 'mala', tema: 'Complemento de pago' }, semilla, { ...config, generador_fallas_mala: 6 });
    for (const id of r.escenario.criterios_que_deben_fallar) visto.add(id);
  }
  assert.equal(visto.has('solucion.escala_cuando_requiere'), false);
  // Diferencias de inventario por sincronización (si): nunca no_escala_innecesario.
  const visto2 = new Set();
  for (let semilla = 1; semilla <= 80; semilla++) {
    const r = escenario({ calidad_solicitada: 'regular', tema: 'Inventario' }, semilla, { ...config, generador_fallas_regular: 6 });
    if (r.escenario.tipificacion_esperada === 'Diferencias de inventario por sincronización') for (const id of r.escenario.criterios_que_deben_fallar) visto2.add(id);
  }
  assert.ok(visto2.size > 0);
  assert.equal(visto2.has('solucion.no_escala_innecesario'), false);
});

test('casos puntuales: pares de estado de caso, número de caso e inactividad no se mezclan', () => {
  const junto = (a, b) => validar({ calidad_solicitada: 'regular', criterios_que_deben_fallar: `${a}|${b}` }).errores.join(' ');
  assert.match(junto('solucion.seguimiento_en_plazo', 'ayuda_adicional.encuesta'), /no pueden fallar juntos/);
  assert.match(junto('recapitulacion.informa_numero_caso', 'recapitulacion.numero_caso_coincide'), /no pueden fallar juntos/);
  assert.match(junto('recapitulacion.cierre_inactividad', 'ayuda_adicional.canales_horarios'), /no pueden fallar juntos/);
  assert.match(junto('recapitulacion.cierre_inactividad', 'recapitulacion.recapitula'), /no pueden fallar juntos/);
  // seguimiento_en_plazo + encuesta_caso_cerrado sí son compatibles (ambos exigen caso no cerrado).
  assert.equal(junto('solucion.seguimiento_en_plazo', 'ayuda_adicional.encuesta_caso_cerrado'), '');
});

test('el formulario rechaza un subelemento inaplicable y dice qué corregir', () => {
  const e1 = validar({ tema: 'Complemento de pago', criterios_que_deben_fallar: 'solucion.escala_cuando_requiere' });
  assert.equal(e1.valido, false);
  assert.match(e1.errores.join(' '), /"solucion\.escala_cuando_requiere" no aplicaría con la tipificación "Emisión de complemento de pago": requiere_escalamiento = no/);
  assert.match(e1.errores.join(' '), /elige otro tema/);
  assert.match(e1.errores.join(' '), /quita "solucion\.escala_cuando_requiere"/);
  // Un tema con una tipificación que escala y otra que no admite ambos subelementos.
  assert.equal(validar({ tema: 'Inventario', criterios_que_deben_fallar: 'solucion.no_escala_innecesario' }).valido, true);
  assert.equal(validar({ tema: 'Inventario', criterios_que_deben_fallar: 'solucion.escala_cuando_requiere' }).valido, true);
  // campos_obligatorios en un tema cuya única tipificación no tiene campos
  const e2 = validar({ tema: 'Planes y promociones', criterios_que_deben_fallar: 'solucion.campos_obligatorios' });
  assert.equal(e2.valido, false);
  assert.match(e2.errores.join(' '), /no tiene campos_obligatorios/);
  // campaña vigente desactivada
  const e3 = validar({ criterios_que_deben_fallar: 'ayuda_adicional.campana_vigente' }, { ...config, campana_vigente_activa: false });
  assert.equal(e3.valido, false);
  assert.match(e3.errores.join(' '), /config\.campana_vigente_activa = no/);
  assert.equal(validar({ criterios_que_deben_fallar: 'ayuda_adicional.campana_vigente' }).valido, true);
  // Sin tema se acepta si alguna tipificación lo admite; con crítico de tipificación incorrecta, campos_obligatorios usa la del agente.
  assert.equal(validar({ criterios_que_deben_fallar: 'solucion.campos_obligatorios' }).valido, true);
  assert.equal(validar({ tema: 'Planes y promociones', calidad_solicitada: 'mala', error_critico: 'critico.tipificacion_incorrecta', criterios_que_deben_fallar: 'solucion.campos_obligatorios' }).valido, true);
});

test('fallas manuales que dependen de la fila: el sorteo del tema y la tipificación solo elige filas compatibles', () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = escenario({ criterios_que_deben_fallar: ['solucion.escala_cuando_requiere', 'solucion.campos_obligatorios'], calidad_solicitada: 'mala' }, semilla);
    assert.equal(r.valido, true, `${semilla}: ${r.errores}`);
    const f = fila(r.escenario.tipificacion_esperada);
    assert.notEqual(f.requiere_escalamiento, 'no');
    assert.ok(camposDe(f).length > 0);
  }
  // Con el tema pedido, solo entra la tipificación compatible.
  for (let semilla = 1; semilla <= 30; semilla++) {
    const r = escenario({ tema: 'Pagos de suscripción', criterios_que_deben_fallar: ['solucion.campos_obligatorios'], calidad_solicitada: 'regular' }, semilla);
    assert.equal(r.escenario.tipificacion_esperada, 'Aclaración de cargo de suscripción');
  }
  // Ninguna tipificación del tema admite lo pedido: rechazo con mensaje.
  const r = escenario({ tema: 'Planes y promociones', criterios_que_deben_fallar: ['solucion.campos_obligatorios'], calidad_solicitada: 'regular' }, 1);
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /campos_obligatorios/);
});

test('con critico.tipificacion_incorrecta y campos_obligatorios pedido, la tipificación errónea tiene campos', () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = escenario({ calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.tipificacion_incorrecta'], criterios_que_deben_fallar: ['solucion.campos_obligatorios'] }, semilla);
    assert.equal(r.valido, true, r.errores && r.errores.join(' '));
    assert.ok(camposDe(fila(r.extras.tipificacion_agente_prevista)).length > 0, r.extras.tipificacion_agente_prevista);
  }
});

test('reproducibilidad: misma semilla y mismos datos dan el mismo escenario', () => {
  for (const calidad of ['regular', 'mala', 'aleatoria']) {
    assert.deepEqual(escenario({ calidad_solicitada: calidad }, 4242), escenario({ calidad_solicitada: calidad }, 4242));
  }
});

test('todos los críticos de la rúbrica siguen produciendo escenarios válidos con el nuevo filtro', () => {
  for (const critico of CRITICOS) {
    for (let semilla = 1; semilla <= 12; semilla++) assert.equal(escenario({ calidad_solicitada: 'mala', errores_criticos_inyectados: [critico] }, semilla).valido, true, `${critico} ${semilla}`);
  }
});
