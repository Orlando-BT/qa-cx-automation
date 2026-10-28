const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../simulador');
const { RUBRICAS } = require('../scoring');
const { validarLote } = require('../validador_payload');
const { textoLegible, metadatosCasoLegible } = require('../texto_legible');
const { cargarConfig } = require('../normalizacion');
const { configCE, DATOS, filasConfigCon, leerJSON } = require('./ayudas');
const { columnasDeHoja } = require('./columnas_contrato');

// Los datos de referencia (config, catálogo, cuentas) son los de datos/; el payload es el ejemplo
// ilustrativo de contrato/ejemplos. No se usa nada del lote de calibración.
const config = configCE();
const catalogo = DATOS.catalogo;
const cuentas = DATOS.cuentas;
const payloadEjemplo = leerJSON('contrato/ejemplos/payload_ejemplo.json');

/** Generador aleatorio determinista: devuelve los valores en orden y vuelve a empezar. */
function secuencia(valores) {
  let i = 0;
  return () => valores[i++ % valores.length];
}

const solicitudBase = (cambios = {}) => ({
  tipo_interaccion: 'ce',
  tema: null,
  calidad_solicitada: 'aleatoria',
  errores_criticos_inyectados: [],
  cantidad: 1,
  lote: 'demo',
  ...cambios,
});

const contextoBase = (cambios = {}) => ({ config, catalogo, cuentas, conversationId: 'CONV-0200', aleatorio: secuencia([0]), ahora: new Date('2026-10-21T16:00:00Z'), ...cambios });

// --- Contrato ---------------------------------------------------------------

test('las columnas de escenarios y revision_humana coinciden con sheets.md', () => {
  assert.deepEqual(S.COLUMNAS_ESCENARIOS, columnasDeHoja('escenarios'));
  assert.equal(S.COLUMNAS_ESCENARIOS.length, 20);
  assert.deepEqual(S.COLUMNAS_REVISION_HUMANA, columnasDeHoja('revision_humana'));
  assert.equal(S.COLUMNAS_REVISION_HUMANA.length, 52);
});

test('la lista de críticos duplicada coincide con la de scoring.js', () => {
  const deScoring = RUBRICAS.reglas_ce_v1.criticos.map(([nombre]) => `critico.${nombre}`);
  assert.deepEqual(S.CRITICOS_POR_VERSION.reglas_ce_v1, deScoring);
});

// --- Lote destino -----------------------------------------------------------

test('W0 rechaza calibracion_v1 con un error explícito', () => {
  const r = S.validarLoteDestino('calibracion_v1', config);
  assert.equal(r.valido, false);
  assert.match(r.errores[0], /congelado/);
  assert.match(r.errores[0], /calibracion_v1/);
});

test('W0 acepta demo, lotes calibracion posteriores y usa el lote por defecto si viene vacío', () => {
  assert.equal(S.validarLoteDestino('demo', config).valido, true);
  assert.equal(S.validarLoteDestino('calibracion_v2', config).valido, true);
  assert.equal(S.validarLoteDestino('calibracion_v10', config).valido, true);
  const vacio = S.validarLoteDestino('', config);
  assert.equal(vacio.lote, config.lote_por_defecto);
  assert.equal(vacio.valido, true);
  assert.equal(S.validarLoteDestino(undefined, config).lote, 'demo');
});

test('lotes con patrón inválido se rechazan y el patrón coincide con el de validarLote', () => {
  for (const lote of ['prueba', 'calibracion_v', 'calibracion_vX', 'Demo', 'calibracion']) {
    const mio = S.validarLoteDestino(lote, config, []);
    assert.equal(mio.valido, validarLote(lote, config).valido, lote);
  }
  assert.equal(S.validarLoteDestino('prueba', config).valido, false);
});

/**
 * Extrae los lotes que un mensaje de error sugiere al usuario (demo, calibracion_v2...).
 * Se quita primero el lote rechazado que el mensaje cita al inicio (`lote "x" ...`) para no
 * tomarlo como sugerencia. El marcador genérico "calibracion_vN" no es un lote, se ignora.
 */
function lotesSugeridos(mensaje, loteRechazado) {
  const sinCita = mensaje.replace(`lote "${loteRechazado}"`, '');
  return [...new Set(sinCita.match(/\b(?:demo|calibracion_v\d+)\b/g) || [])];
}

test('los lotes que sugiere el mensaje de lote congelado son aceptados por validarLoteDestino', () => {
  const r = S.validarLoteDestino('calibracion_v1', config);
  const sugeridos = lotesSugeridos(r.errores[0], 'calibracion_v1');
  assert.ok(sugeridos.includes('demo') && sugeridos.includes('calibracion_v2'), `sugeridos: ${sugeridos}`);
  for (const lote of sugeridos) {
    assert.equal(S.validarLoteDestino(lote, config).valido, true, `el mensaje sugiere "${lote}" pero se rechaza`);
  }
});

test('los lotes que sugiere el mensaje de formato inválido son aceptados por validarLoteDestino', () => {
  const r = S.validarLoteDestino('prueba', config);
  const sugeridos = lotesSugeridos(r.errores[0], 'prueba');
  // demo, el ejemplo calibracion_v2 y el lote por defecto de la configuración.
  assert.ok(sugeridos.includes('demo') && sugeridos.includes('calibracion_v2'), `sugeridos: ${sugeridos}`);
  assert.ok(r.errores[0].includes(`"${config.lote_por_defecto}"`), 'el mensaje debe citar lote_por_defecto');
  sugeridos.push(config.lote_por_defecto);
  for (const lote of sugeridos) {
    assert.equal(S.validarLoteDestino(lote, config).valido, true, `el mensaje sugiere "${lote}" pero se rechaza`);
  }
});

// --- Formulario -------------------------------------------------------------

test('formulario vacío: valores por defecto', () => {
  const r = S.validarFormulario({}, { config, catalogo });
  assert.equal(r.valido, true, r.errores.join('; '));
  assert.deepEqual(r.solicitud, {
    tipo_interaccion: 'ce',
    tema: null,
    calidad_solicitada: 'aleatoria',
    errores_criticos_inyectados: [],
    criterios_que_deben_fallar: [],
    casos_dificiles: [],
    cantidad: 1,
    lote: 'demo',
    semilla_sorteo: null,
  });
});

test('formulario completo: normaliza tema sin acentos, calidad y lista de críticos', () => {
  const r = S.validarFormulario(
    { tema: 'cancelacion de cfdi', calidad_solicitada: 'MALA', error_critico: 'critico.abandono|critico.mala_actitud', cantidad: '3', lote: 'calibracion_v2' },
    { config, catalogo }
  );
  assert.equal(r.valido, true, r.errores.join('; '));
  assert.equal(r.solicitud.tema, 'Cancelación de CFDI');
  assert.equal(r.solicitud.calidad_solicitada, 'mala');
  assert.deepEqual(r.solicitud.errores_criticos_inyectados, ['critico.abandono', 'critico.mala_actitud']);
  assert.equal(r.solicitud.cantidad, 3);
  assert.equal(r.solicitud.lote, 'calibracion_v2');
});

test('formulario con valores inválidos: acumula todos los errores', () => {
  const r = S.validarFormulario(
    { tema: 'Tema inexistente', calidad_solicitada: 'excelente', cantidad: '-1', lote: 'calibracion_v1', tipo_interaccion: 'otro', error_critico: 'critico.abandono,critico.abandono' },
    { config, catalogo }
  );
  assert.equal(r.valido, false);
  const texto = r.errores.join(' | ');
  assert.match(texto, /tipo_interaccion/);
  assert.match(texto, /calidad_solicitada/);
  assert.match(texto, /cantidad/);
  assert.match(texto, /congelado/);
  assert.match(texto, /error_critico repetido/);
});

test('cantidad no numérica o decimal se rechaza; "ninguno" en error_critico es lista vacía', () => {
  assert.equal(S.validarFormulario({ cantidad: 'abc' }, { config, catalogo }).valido, false);
  assert.equal(S.validarFormulario({ cantidad: '2.5' }, { config, catalogo }).valido, false);
  const r = S.validarFormulario({ error_critico: 'ninguno' }, { config, catalogo });
  assert.deepEqual(r.solicitud.errores_criticos_inyectados, []);
});

// --- Aleatorio, IDs y cuenta ------------------------------------------------

test('elegirAleatorio es determinista y valida el generador', () => {
  assert.equal(S.elegirAleatorio(['a', 'b', 'c', 'd'], () => 0), 'a');
  assert.equal(S.elegirAleatorio(['a', 'b', 'c', 'd'], () => 0.5), 'c');
  assert.equal(S.elegirAleatorio(['a', 'b', 'c', 'd'], () => 0.999999), 'd');
  assert.throws(() => S.elegirAleatorio(['a'], () => 1), /\[0, 1\)/);
  assert.throws(() => S.elegirAleatorio([], () => 0), /vacía/);
  assert.throws(() => S.elegirAleatorio(['a']), /función aleatoria/);
});

test('generarIdsConversacion: formato del glosario y sin chocar con existentes', () => {
  assert.deepEqual(S.generarIdsConversacion([], 2), ['CONV-0001', 'CONV-0002']);
  const existentes = ['CONV-0001', 'CONV-0124', 'CONV-0101', 'basura', 'CONV-12'];
  const ids = S.generarIdsConversacion(existentes, 3);
  assert.deepEqual(ids, ['CONV-0125', 'CONV-0126', 'CONV-0127']);
  for (const id of ids) {
    assert.match(id, /^CONV-[0-9]{4,}$/);
    assert.equal(existentes.includes(id), false);
  }
  assert.deepEqual(S.generarIdsConversacion(['CONV-10000'], 1), ['CONV-10001']);
});

test('elegirCuenta toma una cuenta de la hoja con el generador recibido', () => {
  assert.equal(S.elegirCuenta(cuentas, () => 0).cuenta_id, cuentas[0].cuenta_id);
  assert.equal(S.elegirCuenta(cuentas, () => 0.999).cuenta_id, cuentas[cuentas.length - 1].cuenta_id);
});

// --- Completar el escenario -------------------------------------------------

test('aleatoria se resuelve con el generador: buena, regular o mala', () => {
  const buena = S.completarEscenario(solicitudBase(), contextoBase({ aleatorio: secuencia([0, 0, 0, 0]) }));
  const regular = S.completarEscenario(solicitudBase(), contextoBase({ aleatorio: secuencia([0.4, 0, 0, 0]) }));
  const mala = S.completarEscenario(solicitudBase(), contextoBase({ aleatorio: secuencia([0.99, 0, 0, 0]) }));
  assert.equal(buena.escenario.calidad_esperada, 'buena');
  assert.equal(regular.escenario.calidad_esperada, 'regular');
  assert.equal(mala.escenario.calidad_esperada, 'mala');
  assert.equal(buena.escenario.calidad_solicitada, 'aleatoria');
});

test('escenario completo: tema y tipificación del catálogo, cuenta de la hoja, campos del contrato', () => {
  const r = S.completarEscenario(solicitudBase({ calidad_solicitada: 'buena', tema: 'Cancelación de CFDI' }), contextoBase({ aleatorio: secuencia([0.99]) }));
  assert.equal(r.valido, true, r.errores.join('; '));
  const e = r.escenario;
  assert.equal(e.conversation_id, 'CONV-0200');
  assert.equal(e.generado_por, 'simulador');
  assert.equal(e.tema_esperado, 'Cancelación de CFDI');
  const validas = catalogo.filter((f) => f.tema === 'Cancelación de CFDI').map((f) => f.tipificacion_valida);
  assert.ok(validas.includes(e.tipificacion_esperada));
  assert.equal(e.cuenta_id, cuentas[cuentas.length - 1].cuenta_id);
  assert.equal(r.cuenta.cuenta_id, e.cuenta_id);
  assert.deepEqual(e.errores_criticos_inyectados, []);
  assert.match(e.descripcion_escenario, /Cancelación de CFDI/);
});

test('mismo generador, mismo escenario (repetible)', () => {
  const a = S.completarEscenario(solicitudBase(), contextoBase({ aleatorio: secuencia([0.3, 0.6, 0.2, 0.8]) }));
  const b = S.completarEscenario(solicitudBase(), contextoBase({ aleatorio: secuencia([0.3, 0.6, 0.2, 0.8]) }));
  assert.deepEqual(a, b);
});

test('error crítico con calidad aleatoria da calidad mala', () => {
  const r = S.completarEscenario(solicitudBase({ errores_criticos_inyectados: ['critico.abandono'] }), contextoBase());
  assert.equal(r.valido, true);
  assert.equal(r.escenario.calidad_esperada, 'mala');
  assert.deepEqual(r.escenario.errores_criticos_inyectados, ['critico.abandono']);
});

test('error crítico con calidad buena o regular es contradictorio y se rechaza', () => {
  for (const calidad of ['buena', 'regular']) {
    const r = S.completarEscenario(solicitudBase({ calidad_solicitada: calidad, errores_criticos_inyectados: ['critico.abandono'] }), contextoBase());
    assert.equal(r.valido, false);
    assert.match(r.errores.join(' '), /Contradicción/);
  }
});

test('un crítico que no existe en la rúbrica se rechaza', () => {
  const r = S.completarEscenario(solicitudBase({ errores_criticos_inyectados: ['critico.inventado'] }), contextoBase());
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /critico\.inventado/);
});

test('tipo sin generador (sales) se rechaza', () => {
  const configSales = cargarConfig(filasConfigCon(), 'sales');
  const r = S.completarEscenario(solicitudBase({ tipo_interaccion: 'sales' }), contextoBase({ config: configSales }));
  assert.equal(r.valido, false);
  assert.match(r.errores.join(' '), /generador/);
});

test('criterios y casos difíciles del contexto se validan y pasan a la verdad del escenario', () => {
  const ok = S.completarEscenario(
    solicitudBase({ calidad_solicitada: 'regular', criterios_que_deben_fallar: ['empatia.cordialidad'], casos_dificiles: ['amable_no_resuelve'] }),
    contextoBase()
  );
  assert.equal(ok.valido, true);
  assert.deepEqual(ok.escenario.criterios_que_deben_fallar, ['empatia.cordialidad']);
  assert.deepEqual(ok.escenario.casos_dificiles, ['amable_no_resuelve']);
  assert.deepEqual(ok.advertencias, []);

  const mal = S.completarEscenario(solicitudBase({ casos_dificiles: ['inventado'], criterios_que_deben_fallar: ['sin_punto'] }), contextoBase());
  assert.equal(mal.valido, false);
});

test('planificarEscenarios: varios IDs nuevos y todo o nada', () => {
  const p = S.planificarEscenarios(solicitudBase({ cantidad: 3, calidad_solicitada: 'buena' }), {
    config,
    catalogo,
    cuentas,
    idsExistentes: ['CONV-0001', 'CONV-0124'],
    aleatorio: secuencia([0.1, 0.5, 0.9]),
    ahora: new Date('2026-10-21T16:00:00Z'),
  });
  assert.equal(p.valido, true);
  assert.deepEqual(
    p.escenarios.map((x) => x.escenario.conversation_id),
    ['CONV-0125', 'CONV-0126', 'CONV-0127']
  );

  const malo = S.planificarEscenarios(solicitudBase({ cantidad: 3, errores_criticos_inyectados: ['critico.x'] }), {
    config,
    catalogo,
    cuentas,
    idsExistentes: [],
    aleatorio: secuencia([0]),
    ahora: new Date('2026-10-21T16:00:00Z'),
  });
  assert.equal(malo.valido, false);
  assert.equal(malo.escenarios.length, 0);
  assert.equal(malo.errores.length, 1, 'errores sin repetir');
});

// --- Filas ------------------------------------------------------------------

test('filaEscenarios: 20 columnas, listas con | y costo vacío si es desconocido', () => {
  const r = S.completarEscenario(
    solicitudBase({ calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.abandono', 'critico.mala_actitud'], casos_dificiles: ['critico_escondido'], criterios_que_deben_fallar: ['empatia.muestra_empatia'] }),
    contextoBase()
  );
  const fila = S.filaEscenarios(
    r.escenario,
    { modelo_generador: 'claude-haiku-5-5', version_prompt_generador: 'generador_ce_v1', tokens_entrada: 3000, tokens_salida: 1200, costo_generacion_usd: null, generado_en: new Date('2026-10-24T18:00:00Z') },
    config
  );
  assert.deepEqual(Object.keys(fila), columnasDeHoja('escenarios'));
  assert.equal(fila.errores_criticos_inyectados, 'critico.abandono|critico.mala_actitud');
  assert.equal(fila.casos_dificiles, 'critico_escondido');
  assert.equal(fila.criterios_que_deben_fallar, 'empatia.muestra_empatia');
  assert.equal(fila.costo_generacion_usd, '');
  assert.equal(fila.tokens_entrada, 3000);
  assert.equal(fila.generado_en, '2026-10-24T12:00:00-06:00');
  assert.equal(fila.generado_por, 'simulador');
});

test('filaEscenarios: el costo numérico se conserva y tokens desconocidos quedan vacíos', () => {
  const r = S.completarEscenario(solicitudBase(), contextoBase());
  const fila = S.filaEscenarios(r.escenario, { modelo_generador: 'm', version_prompt_generador: 'generador_ce_v1', tokens_entrada: null, tokens_salida: null, costo_generacion_usd: 0.0012, generado_en: '2026-10-24T12:00:00-06:00' }, config);
  assert.equal(fila.costo_generacion_usd, 0.0012);
  assert.equal(fila.tokens_entrada, '');
});

test('filaRevisionHumana: 52 columnas, h_* vacías, pendiente, lote del formulario y sin verdad del escenario', () => {
  const fila = S.filaRevisionHumana(payloadEjemplo, 'calibracion_v2', { textoLegible, metadatosCasoLegible });
  assert.deepEqual(Object.keys(fila), columnasDeHoja('revision_humana'));
  assert.equal(fila.lote, 'calibracion_v2');
  assert.equal(fila.estado_revision, 'pendiente');
  assert.equal(fila.texto_legible, textoLegible(payloadEjemplo.mensajes));
  assert.equal(fila.metadatos_caso_legible, metadatosCasoLegible(payloadEjemplo.metadatos_caso));
  for (const columna of Object.keys(fila).filter((c) => c.startsWith('h_'))) assert.equal(fila[columna], '', columna);
  assert.equal(fila.comentarios_humano, '');
  assert.equal(fila.calificado_en, '');
  // Ninguna columna exclusiva de escenarios (la verdad oculta) aparece en la hoja de ciegas.
  const compartidas = new Set(['conversation_id', 'lote', 'tipo_interaccion', 'cuenta_id']);
  for (const columna of S.COLUMNAS_ESCENARIOS.filter((c) => !compartidas.has(c))) assert.equal(columna in fila, false, columna);
});

// --- POST a Ingesta ---------------------------------------------------------

test('armarPostIngesta: URL con ?lote= y cuerpo igual al payload', () => {
  const post = S.armarPostIngesta(payloadEjemplo, 'demo', 'http://localhost:5678/webhook/ingesta');
  assert.equal(post.method, 'POST');
  assert.equal(post.url, 'http://localhost:5678/webhook/ingesta?lote=demo');
  assert.deepEqual(post.body, payloadEjemplo);
});

test('el POST nunca lleva campos de la verdad del escenario, aunque lleguen mezclados con el payload', () => {
  const escenario = S.completarEscenario(solicitudBase({ calidad_solicitada: 'mala', errores_criticos_inyectados: ['critico.abandono'] }), contextoBase()).escenario;
  // Payload contaminado a propósito: campos del escenario en la raíz y dentro de metadatos y mensajes.
  const contaminado = JSON.parse(JSON.stringify(payloadEjemplo));
  const { conversation_id: _a, cuenta_id: _b, tipo_interaccion: _c, ...soloVerdad } = escenario;
  Object.assign(contaminado, soloVerdad, { lote: 'demo' });
  contaminado.metadatos_caso.calidad_esperada = 'mala';
  contaminado.mensajes[0].errores_criticos_inyectados = ['critico.abandono'];

  const post = S.armarPostIngesta(contaminado, 'demo', 'http://localhost:5678/webhook/ingesta');
  assert.deepEqual(post.body, payloadEjemplo);

  const esquema = leerJSON('contrato/payload.schema.json');
  assert.deepEqual(Object.keys(post.body).sort(), Object.keys(esquema.properties).sort());
  const soloEscenario = S.COLUMNAS_ESCENARIOS.filter((c) => !['conversation_id', 'tipo_interaccion', 'cuenta_id'].includes(c));
  const texto = JSON.stringify(post.body);
  for (const columna of soloEscenario) assert.equal(texto.includes(`"${columna}"`), false, columna);
});

test('armarPostIngesta rechaza lote inválido y URL vacía', () => {
  assert.throws(() => S.armarPostIngesta(payloadEjemplo, 'otro', 'http://x'), /lote inválido/);
  assert.throws(() => S.armarPostIngesta(payloadEjemplo, 'demo', ''), /URL/);
});

// ---------------------------------------------------------------------------
// Cada rechazo del formulario dice QUÉ CORREGIR (campo, valor recibido, motivo y corrección).
// ---------------------------------------------------------------------------
test('rechazos del formulario incluyen la corrección concreta', () => {
  const val = (f, cfg = config) => S.validarFormulario(f, { config: cfg, catalogo }).errores.join(' | ');
  const crit = 'critico.abandono';
  const con = (campos) => val({ ...campos });
  // lote congelado: sugiere demo y un lote nuevo
  assert.match(con({ lote: 'calibracion_v1' }), /"calibracion_v1" está congelado.*usa "demo" o un lote nuevo \(calibracion_v2/);
  // lote con formato inválido: valor recibido y formatos válidos
  assert.match(con({ lote: 'prueba' }), /lote "prueba".*"demo" o "calibracion_vN"/);
  // cantidad: máximo y valor recibido
  assert.match(con({ cantidad: '8' }), /cantidad 8 supera el máximo por ejecución; escribe un número de 1 a 5 \(simulador_max_conversaciones\)/);
  assert.match(con({ cantidad: '-1' }), /cantidad "-1".*de 1 a 5/);
  // tema fuera de catálogo: lista temas activos del tipo
  const tema = con({ tema: 'Tema inexistente' });
  assert.match(tema, /tema "Tema inexistente"/);
  assert.match(tema, /Cancelación de CFDI/);
  assert.match(tema, /déjalo vacío para sorteo/);
  // tipo, calidad, caso difícil: opciones válidas
  assert.match(con({ tipo_interaccion: 'otro' }), /tipo_interaccion "otro".*escribe uno de: /);
  assert.match(con({ calidad_solicitada: 'excelente' }), /"excelente".*buena, regular, mala, aleatoria/);
  assert.match(con({ casos_dificiles: 'raro' }), /"raro".*amable_no_resuelve/);
  // semilla: rango y sorteo automático
  assert.match(con({ semilla_sorteo: '-4' }), /semilla_sorteo "-4".*0 a 4294967295.*sorteo automático/);
  // repetidos
  assert.match(con({ error_critico: `${crit},${crit}` }), /error_critico repetido.*una sola vez/);
  // crítico inexistente: lista los válidos
  assert.match(con({ error_critico: 'critico.inventado', criterios_que_deben_fallar: 'cierre.agradece' }), /"critico\.inventado".*critico\.abandono/);
  // subelemento inexistente / informativo / incompatible / activa crítico / par excluyente
  assert.match(con({ criterios_que_deben_fallar: 'apertura.inventado' }), /los válidos de apertura son: apertura\.saludo/);
  assert.match(con({ criterios_que_deben_fallar: 'inventado.x' }), /usa el formato seccion\.subelemento/);
  assert.match(con({ criterios_que_deben_fallar: 'diagnostico.numero_preguntas' }), /informativo.*elige otro subelemento de diagnostico/);
  assert.match(con({ error_critico: crit, criterios_que_deben_fallar: 'cierre.despedida' }), /quita "cierre\.despedida" de criterios_que_deben_fallar o quita critico\.abandono de error_critico/);
  assert.match(con({ criterios_que_deben_fallar: 'apertura.toma_a_tiempo' }), /agrega critico\.no_toma_a_tiempo en error_critico/);
  assert.match(con({ calidad_solicitada: 'mala', criterios_que_deben_fallar: 'identidad.datos_coinciden' }), /cambia calidad_solicitada a regular/);
  assert.match(con({ criterios_que_deben_fallar: 'solucion.escala_cuando_requiere|solucion.no_escala_innecesario' }), /quita uno de los dos/);
  assert.match(con({ criterios_que_deben_fallar: 'cierre.agradece|cierre.agradece' }), /repetido.*una sola vez/);
});

test('rechazos de completarEscenario también dicen qué corregir', () => {
  const r = S.completarEscenario(solicitudBase({ calidad_solicitada: 'buena', errores_criticos_inyectados: ['critico.abandono'] }), contextoBase());
  assert.match(r.errores.join(' '), /cambia calidad_solicitada a mala.*o quita el error crítico/);
  const inv = S.completarEscenario(solicitudBase({ errores_criticos_inyectados: ['critico.inventado'] }), contextoBase());
  assert.match(inv.errores.join(' '), /escribe uno de: critico\./);
  const cd = S.completarEscenario(solicitudBase({ casos_dificiles: ['raro'] }), contextoBase());
  assert.match(cd.errores.join(' '), /escribe uno de: amable_no_resuelve/);
});
