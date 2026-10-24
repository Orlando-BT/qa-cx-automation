const test = require('node:test');
const assert = require('node:assert/strict');

const { contextoHastaJS3, criterio, DATOS } = require('./ayudas');
const { payloadBase, payloadBueno, conMensaje, CONVERSACION_BUENA } = require('./fixtures');
const { convertirNumerosEnPalabras, plazoAHorasHabiles, detectarMayusculas, contarSignosApertura } = require('../reglas');

/** Corre JS-1 a JS-3 y devuelve una función para consultar criterios. */
function correr(lista, metadatos, opciones) {
  const ctx = contextoHastaJS3(payloadBase(lista, metadatos), opciones);
  const c = (id) => criterio(ctx.resultados_js.criterios, id);
  c.variables = ctx.resultados_js.variables;
  c.criterios = ctx.resultados_js.criterios;
  return c;
}
const res = (lista, id, metadatos, opciones) => correr(lista, metadatos, opciones)(id).resultado;

// ---------------------------------------------------------------------------
// Conversación buena: todas las reglas [JS] cumplen o no aplican
// ---------------------------------------------------------------------------

test('conversación buena: ningún criterio [JS] falla y ningún crítico [JS] se detecta', () => {
  const c = correr(CONVERSACION_BUENA);
  for (const cr of c.criterios) {
    assert.ok(['cumple', 'no_aplica', 'no_detectado'].includes(cr.resultado), `${cr.id_criterio}: ${cr.resultado} (${cr.evidencia.dato})`);
    assert.equal(cr.origen, 'JS');
  }
  // Todos los [JS] que decide JS-3 (los de identidad y numero_preguntas los cierra JS-6).
  assert.equal(c.criterios.length, 33 + 4);
  assert.equal(c('apertura.saludo').resultado, 'cumple');
  assert.deepEqual(c('apertura.saludo').evidencia, { mensajes: [2], dato: 'frase detectada: "hola"' });
  assert.equal(c.variables.mensaje_solicitud_n, 4);
  assert.equal(c.variables.termina_por_inactividad, false);
});

// ---------------------------------------------------------------------------
// Apertura
// ---------------------------------------------------------------------------

test('toma_a_tiempo en el límite exacto: 60 s cumple, 61 s no cumple y activa el crítico', () => {
  const a60 = correr(conMensaje(2, [null, 60, null]));
  assert.equal(a60('apertura.toma_a_tiempo').resultado, 'cumple');
  assert.equal(a60('apertura.toma_a_tiempo').evidencia.dato, 'primera respuesta 60 s ≤ 60 s');
  assert.equal(a60('critico.no_toma_a_tiempo').resultado, 'no_detectado');

  const a61 = correr(conMensaje(2, [null, 61, null]));
  assert.equal(a61('apertura.toma_a_tiempo').resultado, 'no_cumple');
  assert.deepEqual(a61('critico.no_toma_a_tiempo').evidencia, { mensajes: [1, 2], dato: 'primera respuesta 61 s > 60 s' });
  assert.equal(a61('critico.no_toma_a_tiempo').resultado, 'detectado');
});

test('toma_a_tiempo lee el umbral de config', () => {
  assert.equal(res(conMensaje(2, [null, 61, null]), 'apertura.toma_a_tiempo', {}, { configCambios: { chat_primera_respuesta_seg: 90 } }), 'cumple');
});

test('toma_a_tiempo no aplica si el primer mensaje es del agente (contacto saliente)', () => {
  const lista = [['agente', 0, 'Hola, te contacto de Contamix.'], ['cliente', 30, 'Hola']];
  assert.equal(res(lista, 'apertura.toma_a_tiempo'), 'no_aplica');
});

test('aviso de privacidad: debe ir antes de pedir datos de identidad', () => {
  // Sin aviso en ningún mensaje → no cumple.
  const sinAviso = conMensaje(2, [null, null, '¡Hola! Bienvenido a Contamix, soy Mariana. Con gusto te ayudo. ¿Con quién tengo el gusto?']);
  assert.equal(res(sinAviso, 'apertura.aviso_privacidad'), 'no_cumple');
  // El aviso llega después de la solicitud de datos (mensaje 4) → no cumple.
  const tarde = sinAviso.map((m) => [...m]);
  tarde[5][2] = `${tarde[5][2]} Tus datos personales están protegidos según nuestro aviso de privacidad.`;
  assert.equal(res(tarde, 'apertura.aviso_privacidad'), 'no_cumple');
});

test('apertura: saludo, bienvenida, marca y nombre del agente en los primeros mensajes', () => {
  const seco = conMensaje(2, [null, null, 'Dime.']);
  const c = correr(seco);
  assert.equal(c('apertura.saludo').resultado, 'no_cumple');
  assert.equal(c('apertura.bienvenida').resultado, 'no_cumple');
  assert.equal(c('apertura.marca').resultado, 'no_cumple');
  assert.equal(c('apertura.nombre_agente').resultado, 'no_cumple');
  assert.equal(c('apertura.ofrece_ayuda').resultado, 'no_cumple');
  // El mensaje 4 usa el nombre del titular: nombre_cliente cumple sin pedirlo.
  assert.equal(c('apertura.nombre_cliente').resultado, 'cumple');
});

// ---------------------------------------------------------------------------
// Empatía: mayúsculas sostenidas
// ---------------------------------------------------------------------------

test('mayúsculas sostenidas: 3 palabras de 4+ letras seguidas → no cumple', () => {
  const lista = conMensaje(8, [null, null, 'POR FAVOR REVISA ESTO en Facturación. Tu caso es CASO-58213.']);
  const c = correr(lista);
  assert.equal(c('empatia.mayusculas_sostenidas').resultado, 'no_cumple');
  assert.equal(c('empatia.mayusculas_sostenidas').evidencia.dato, 'mayúsculas sostenidas: "FAVOR REVISA ESTO"');
});

test('mayúsculas: siglas permitidas, palabras cortas y rachas cortadas no cuentan', () => {
  const siglas = ['RFC', 'CFDI', 'XML', 'PDF', 'UUID', 'PUBLICO EN GENERAL'];
  assert.equal(detectarMayusculas('Envía el CFDI XML PDF UUID', siglas, 3, 4), null);
  assert.equal(detectarMayusculas('Factura a PUBLICO EN GENERAL ahora', siglas, 3, 4), null);
  assert.equal(detectarMayusculas('ESTO ES MUY IMPORTANTE', siglas, 3, 4), null, 'solo 2 palabras de 4+ letras');
  assert.equal(detectarMayusculas('REVISA esto AHORA MISMO', siglas, 3, 4), null, 'la minúscula corta la racha');
  assert.equal(detectarMayusculas('Soy [NOMBRE_1] [EMAIL_1] [TELEFONO_1]', siglas, 3, 4), null, 'los marcadores no cuentan');
  assert.equal(detectarMayusculas('ESTO NO SE PUEDE HACER', siglas, 3, 4), 'ESTO PUEDE HACER');
});

// ---------------------------------------------------------------------------
// Comunicación
// ---------------------------------------------------------------------------

test('signos de apertura: pregunta sin ¿ no cumple; con ¿ a mitad de oración cumple; sin preguntas no aplica', () => {
  assert.deepEqual(contarSignosApertura('Claro, ¿me compartes tu RFC?'), { cierres: 1, omisiones: 0 });
  assert.deepEqual(contarSignosApertura('Me compartes tu RFC? ¡Gracias!'), { cierres: 2, omisiones: 1 });
  assert.deepEqual(contarSignosApertura('Visita https://ayuda.contamix.example/?id=3 hoy.'), { cierres: 0, omisiones: 0 });

  const sinApertura = conMensaje(6, [null, null, 'Gracias, la validación fue correcta. Me confirmas el UUID y el motivo de cancelación?']);
  const c = correr(sinApertura);
  assert.equal(c('comunicacion.signos_apertura').resultado, 'no_cumple');
  assert.deepEqual(c('comunicacion.signos_apertura').evidencia.mensajes, [6]);

  const sinPreguntas = [['cliente', 0, 'Hola'], ['agente', 30, 'Hola, soy Mariana de Contamix.']];
  assert.equal(res(sinPreguntas, 'comunicacion.signos_apertura'), 'no_aplica');
  // El máximo de omisiones viene de config.
  assert.equal(res(sinApertura, 'comunicacion.signos_apertura', {}, { configCambios: { signos_apertura_max_omisiones: 1 } }), 'cumple');
});

test('tecnicismos, frases negativas y vicios del lenguaje', () => {
  const lista = conMensaje(8, [null, null, 'Ok, o sea, no se puede: hay un error del servidor. Tu caso es CASO-58213.']);
  const c = correr(lista);
  assert.equal(c('comunicacion.tecnicismos').resultado, 'no_cumple');
  assert.match(c('comunicacion.tecnicismos').evidencia.dato, /servidor/);
  assert.equal(c('comunicacion.frases_negativas').resultado, 'no_cumple');
  assert.equal(c('comunicacion.vicios_lenguaje').resultado, 'no_cumple');
  // "catálogo" y "login" no coinciden con \blogs?\b.
  const sinFalso = conMensaje(8, [null, null, 'Revisa el catálogo después del login. Tu caso es CASO-58213.']);
  assert.equal(res(sinFalso, 'comunicacion.tecnicismos'), 'cumple');
});

/** Conversación con una espera anunciada. `seg` = tiempos [pide, continua o null, cierre]. */
function conEspera({ pide = 100, continua = null, cierre = 300, textoCierre = 'Gracias por la espera. Ya quedó: tu caso es CASO-58213.' } = {}) {
  const lista = [
    ['cliente', 0, 'Hola, necesito cancelar una factura.'],
    ['agente', 30, '¡Hola! Bienvenido a Contamix, soy Mariana. Con gusto te ayudo.'],
    ['cliente', 60, 'Es la factura A-1050.'],
    ['agente', pide, 'Permíteme revisar, dame un momento por favor.'],
  ];
  if (continua !== null) lista.push(['agente', continua, 'Sigo revisando, gracias.']);
  if (cierre !== null) lista.push(['agente', cierre, textoCierre]);
  return lista;
}

test('pide_espera: retraso de respuesta en el límite (60 s sin anunciar no es retraso; 61 s sí)', () => {
  const base = (seg) => [
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Hola, soy Mariana de Contamix.'],
    ['cliente', 60, 'Tengo una duda.'],
    ['agente', 60 + seg, 'Claro, dime.'],
  ];
  assert.equal(res(base(60), 'comunicacion.pide_espera'), 'no_aplica');
  const c = correr(base(61));
  assert.equal(c('comunicacion.pide_espera').resultado, 'no_cumple');
  assert.equal(c('comunicacion.pide_espera').evidencia.dato, 'retraso sin anunciar: [3] → [4] 61 s > 60 s');
  // La primera respuesta no cuenta como retraso (la evalúa toma_a_tiempo).
  const primera = [['cliente', 0, 'Hola'], ['agente', 90, 'Hola, soy Mariana.']];
  assert.equal(res(primera, 'comunicacion.pide_espera'), 'no_aplica');
});

test('episodio de espera: anunciada a tiempo, agradecida y dentro de 300 s (límite exacto)', () => {
  const c = correr(conEspera({ cierre: 400 }));
  assert.equal(c('comunicacion.pide_espera').resultado, 'cumple');
  assert.equal(c('comunicacion.agradece_espera').resultado, 'cumple');
  assert.equal(c('comunicacion.no_excede_espera').resultado, 'cumple', '300 s = máximo');
  assert.equal(c('comunicacion.retoma_a_tiempo').resultado, 'no_cumple', '300 s sin retomar > 120 s');

  const c301 = correr(conEspera({ cierre: 401 }));
  assert.equal(c301('comunicacion.no_excede_espera').resultado, 'no_cumple');
  assert.equal(c301('comunicacion.no_excede_espera').evidencia.dato, 'espera [4] → [5] 301 s > 300 s');
});

test('retoma_a_tiempo: 120 s entre mensajes del agente cumple, 121 s no', () => {
  assert.equal(res(conEspera({ continua: 220, cierre: 340 }), 'comunicacion.retoma_a_tiempo'), 'cumple');
  assert.equal(res(conEspera({ continua: 221, cierre: 341 }), 'comunicacion.retoma_a_tiempo'), 'no_cumple');
});

test('agradece_espera: cierre sin agradecer o episodio abierto no cumplen', () => {
  assert.equal(res(conEspera({ cierre: 200, textoCierre: 'Disculpa la espera. Ya quedó.' }), 'comunicacion.agradece_espera'), 'no_cumple');
  const abierto = correr([...conEspera({ cierre: null }), ['cliente', 500, '¿Hola?']]);
  assert.equal(abierto('comunicacion.agradece_espera').resultado, 'no_cumple');
  assert.equal(abierto('comunicacion.no_excede_espera').resultado, 'no_cumple', 'abierto: dura hasta el último mensaje (400 s)');
  assert.equal(abierto('critico.abandono').resultado, 'detectado');
});

// ---------------------------------------------------------------------------
// Solución: campos obligatorios y plazo de seguimiento
// ---------------------------------------------------------------------------

test('campos obligatorios según la tipificación del agente', () => {
  assert.equal(res(CONVERSACION_BUENA, 'solucion.campos_obligatorios', { campos_capturados: { uuid_factura: 'presente', motivo_cancelacion: 'ausente' } }), 'no_cumple');
  assert.equal(res(CONVERSACION_BUENA, 'solucion.campos_obligatorios', { tipificacion_agente: 'Tipificación inventada' }), 'no_aplica');
  assert.equal(res(CONVERSACION_BUENA, 'solucion.campos_obligatorios', { tipificacion_agente: 'Actualización de método de pago', campos_capturados: {} }), 'no_aplica');
});

/** Conversación buena con caso abierto y un plazo en el mensaje 10. */
function conPlazo(texto) {
  return correr(conMensaje(10, [null, null, texto]), { estado_caso: 'abierto' })('solucion.seguimiento_en_plazo');
}

test('seguimiento_en_plazo: 48 h hábiles cumple, 49 no (umbral de config)', () => {
  assert.equal(conPlazo('Te daremos seguimiento en 48 horas hábiles.').resultado, 'cumple');
  const c = conPlazo('Te daremos seguimiento en 49 horas hábiles.');
  assert.equal(c.resultado, 'no_cumple');
  assert.equal(c.evidencia.dato, 'último plazo "49 horas habiles" = 49 h hábiles > 48');
});

test('seguimiento_en_plazo: números escritos con palabras (lista numero_en_palabras de listas.csv)', () => {
  // La tabla palabra -> cifra sale de la lista (columna notas), validada por JS-1 al cargar.
  const numeros = contextoHastaJS3(payloadBueno()).numeros_en_palabras;
  assert.equal(numeros['cuarenta y ocho'], 48);
  assert.equal(numeros.una, 1);
  assert.equal(convertirNumerosEnPalabras('en dos dias habiles', numeros), 'en 2 dias habiles');
  assert.equal(convertirNumerosEnPalabras('setenta y dos horas', numeros), '72 horas');
  assert.equal(convertirNumerosEnPalabras('de cuarenta y ocho a setenta y dos', numeros), 'de 48 a 72');
  assert.equal(convertirNumerosEnPalabras('todos los dias', numeros), 'todos los dias', 'solo palabras completas');
  assert.equal(convertirNumerosEnPalabras('cuarenta y ocho horas', numeros), '48 horas', '"cuarenta y ocho" no se lee como "ocho"');
  assert.throws(() => convertirNumerosEnPalabras('dos dias', undefined), /numeros_en_palabras/);
  assert.equal(conPlazo('Te daremos seguimiento en dos días hábiles.').resultado, 'cumple', '2 × 9 = 18 h');
  assert.equal(conPlazo('Te daremos seguimiento en Setenta y Dos horas hábiles.').resultado, 'no_cumple', '72 > 48');
  assert.equal(conPlazo('Te daremos seguimiento en una semana.').resultado, 'cumple', '1 × 5 × 9 = 45 h');
});

test('seguimiento_en_plazo: lee la tabla de números de la lista, no del código', () => {
  // Si el dueño cambia la cifra en la hoja listas, el resultado cambia sin tocar código.
  const cambiar = (filas) => filas.map((f) => (f.clave_lista === 'numero_en_palabras' && f.valor === 'dos' ? { ...f, notas: '99' } : f));
  const lista = conMensaje(10, [null, null, 'Te daremos seguimiento en dos días hábiles.']);
  const base = contextoHastaJS3(payloadBase(lista, { estado_caso: 'abierto' }));
  assert.equal(criterio(base.resultados_js.criterios, 'solucion.seguimiento_en_plazo').resultado, 'cumple', '2 x 9 = 18 h');
  const alterada = contextoHastaJS3(payloadBase(lista, { estado_caso: 'abierto' }), { listas: cambiar(DATOS.listas) });
  assert.equal(criterio(alterada.resultados_js.criterios, 'solucion.seguimiento_en_plazo').resultado, 'no_cumple', '99 x 9 > 48 h');
});

test('seguimiento_en_plazo: rangos, unidades, varios plazos y plazo sin número', () => {
  assert.equal(plazoAHorasHabiles(['2', '3', 'dias', 'habiles'], 9), 27, 'rango: extremo mayor');
  assert.equal(plazoAHorasHabiles([undefined, '90', 'minutos'], 9), null, 'los minutos no son plazo de seguimiento');
  assert.equal(plazoAHorasHabiles([undefined, '6', 'dias'], 9), 54, 'días sin "hábiles" = hábiles');
  assert.equal(conPlazo('Te daremos seguimiento de 24 a 48 h.').resultado, 'cumple');
  // Contrato 3.11: con varios plazos se evalúa el último.
  const varios = conPlazo('Primero 24 horas para revisar y la respuesta final en 6 días.');
  assert.equal(varios.resultado, 'no_cumple');
  assert.match(varios.evidencia.dato, /"6 dias" = 54 h/);
  assert.equal(conPlazo('Te daremos seguimiento en breve.').resultado, 'no_cumple');
  // Con caso cerrado o sin caso no aplica.
  assert.equal(res(CONVERSACION_BUENA, 'solucion.seguimiento_en_plazo'), 'no_aplica');
});

// ---------------------------------------------------------------------------
// Recapitulación: número de caso
// ---------------------------------------------------------------------------

test('número de caso: informado, coincidente o distinto', () => {
  const distinto = conMensaje(8, [null, null, 'Registré tu caso con el número CASO-11111.']);
  const c = correr(distinto);
  assert.equal(c('recapitulacion.informa_numero_caso').resultado, 'cumple');
  assert.equal(c('recapitulacion.numero_caso_coincide').resultado, 'no_cumple');
  assert.equal(c('recapitulacion.numero_caso_coincide').evidencia.dato, 'comunicado CASO-11111 ≠ registrado CASO-58213');
});

test('critico.no_genera_caso: numero_caso null', () => {
  const c = correr(CONVERSACION_BUENA, { numero_caso: null, estado_caso: 'sin_caso' });
  assert.equal(c('critico.no_genera_caso').resultado, 'detectado');
  assert.equal(c('critico.no_genera_caso').evidencia.dato, 'numero_caso: null');
  assert.equal(c('recapitulacion.informa_numero_caso').resultado, 'no_aplica');
  assert.equal(correr(CONVERSACION_BUENA)('critico.no_genera_caso').resultado, 'no_detectado');
});

test('critico.palabras_altisonantes', () => {
  const lista = conMensaje(8, [null, null, 'Pinche sistema, ya quedó. CASO-58213.']);
  const c = correr(lista);
  assert.equal(c('critico.palabras_altisonantes').resultado, 'detectado');
  assert.deepEqual(c('critico.palabras_altisonantes').evidencia.mensajes, [8]);
  // "cómputo" no coincide con \bput(o|a)\b.
  assert.equal(res(conMensaje(8, [null, null, 'El cómputo quedó listo. CASO-58213.']), 'critico.palabras_altisonantes'), 'no_detectado');
});

// ---------------------------------------------------------------------------
// Casos que antes eran "riesgos reportados" y ya tienen el comportamiento correcto del contrato
// ---------------------------------------------------------------------------

test('pedir el RFC del receptor (un tercero) NO es solicitud de datos de identidad', () => {
  // Con la solicitud real en [4], la del receptor en [6] no cambia nada.
  const c = correr(conMensaje(6, [null, null, 'Gracias. ¿Me compartes el RFC del receptor de la factura?']));
  assert.equal(c.variables.mensaje_solicitud_n, 4, 'en el fixture la solicitud real es la [4]');
  // Sin solicitud previa: el bloque de identidad no se activa por pedir el RFC de un tercero.
  for (const frase of [
    'Hola, ¿me compartes el RFC del receptor?',
    'Hola, ¿me compartes el RFC del cliente final?',
    'Hola, ¿me puedes indicar el RFC de tu cliente?',
    'Hola, ¿me compartes el correo de la factura?',
  ]) {
    const sin = correr([['cliente', 0, 'Hola'], ['agente', 30, frase]]);
    assert.equal(sin.variables.mensaje_solicitud_n, null, frase);
  }
  // Control: pedir el RFC de la propia cuenta SÍ es solicitud de identidad.
  assert.equal(correr([['cliente', 0, 'Hola'], ['agente', 30, 'Hola, ¿me compartes tu RFC?']]).variables.mensaje_solicitud_n, 2);
});

test('plazo en minutos ("dame 10 minutos") no es plazo de seguimiento', () => {
  // Si el único "plazo" del agente está en minutos, no hay plazo comunicado: no cumple.
  const solo = conPlazo('Dame 10 minutos para revisarlo, por favor.');
  assert.equal(solo.resultado, 'no_cumple');
  assert.equal(solo.evidencia.dato, 'el agente no comunica un plazo con número');
  // Tampoco cuenta como "último plazo": gana el plazo real anterior (24 h hábiles <= 48).
  const variasHoras = correr(conMensaje(10, [null, null, 'Te daremos seguimiento en 24 horas. Dame 10 minutos para registrarlo.']), { estado_caso: 'abierto' })('solucion.seguimiento_en_plazo');
  assert.equal(variasHoras.resultado, 'cumple');
  assert.match(variasHoras.evidencia.dato, /"24 horas"/);
  // Y si el plazo real está después de los minutos, también gana el real (49 h > 48).
  const despues = correr(conMensaje(10, [null, null, 'Dame 30 minutos. Luego te doy seguimiento en 49 horas.']), { estado_caso: 'abierto' })('solucion.seguimiento_en_plazo');
  assert.equal(despues.resultado, 'no_cumple');
  assert.match(despues.evidencia.dato, /"49 horas"/);
});

// ---------------------------------------------------------------------------
// Inactividad del cliente vs abandono del agente (rubrica.md 3.10)
// ---------------------------------------------------------------------------

const META_INVENTARIO = {
  tipificacion_agente: 'Ajuste de inventario',
  numero_caso: 'CASO-11111',
  estado_caso: 'abierto',
  campos_capturados: { almacen: 'presente', sku_producto: 'presente' },
};

/** Final con recordatorio (125 s después) y cierre por inactividad (`cierre` s después). */
function inactividad(cierre = 130, extra = []) {
  return [
    ['cliente', 0, 'Hola, tengo diferencias en mi inventario.'],
    ['agente', 30, '¡Hola! Bienvenido a Contamix, soy Mariana. Con gusto te ayudo. ¿Qué producto tiene diferencias?'],
    ['cliente', 60, 'El producto 1020.'],
    ['agente', 90, 'Gracias. Tu caso es CASO-11111. ¿Me confirmas si ya aparece el ajuste?'],
    ['agente', 215, '¿Sigues ahí? Quedo atento.'],
    ['agente', 215 + cierre, 'Al no recibir respuesta, cierro el chat. Gracias por contactar a Contamix.'],
    ...extra,
  ];
}

test('caso 1: inactividad del cliente atendida en tiempo', () => {
  const c = correr(inactividad(130), META_INVENTARIO);
  assert.equal(c.variables.termina_por_inactividad, true);
  assert.equal(c('recapitulacion.recordatorio_inactividad').resultado, 'cumple');
  assert.equal(c('recapitulacion.cierre_inactividad').resultado, 'cumple');
  assert.equal(c('critico.abandono').resultado, 'no_detectado');
  assert.equal(c('cierre.despedida').resultado, 'cumple');
  for (const id of ['ofrece_ayuda_adicional', 'encuesta', 'canales_horarios', 'campana_vigente', 'encuesta_caso_cerrado']) {
    assert.equal(c(`ayuda_adicional.${id}`).resultado, 'no_aplica', id);
  }
});

test('caso 1b y límite exacto: cierre 120 s después del recordatorio cumple; 119 s o 40 s no', () => {
  assert.equal(res(inactividad(120), 'recapitulacion.cierre_inactividad', META_INVENTARIO), 'cumple');
  assert.equal(res(inactividad(119), 'recapitulacion.cierre_inactividad', META_INVENTARIO), 'no_cumple');
  const c = correr(inactividad(40), META_INVENTARIO);
  assert.equal(c('recapitulacion.cierre_inactividad').resultado, 'no_cumple');
  assert.equal(c.variables.termina_por_inactividad, true, 'el tiempo no cambia la clasificación');
});

test('recordatorio de inactividad en el límite: silencio de 120 s no exige recordatorio; 121 s sí', () => {
  const base = (seg) => [
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Hola, soy Mariana de Contamix. ¿Me compartes el folio?'],
    ['cliente', 30 + seg, 'Es A-1050.'],
    ['agente', 40 + seg, 'Gracias.'],
  ];
  assert.equal(res(base(120), 'recapitulacion.recordatorio_inactividad'), 'no_aplica');
  const c = correr(base(121));
  assert.equal(c('recapitulacion.recordatorio_inactividad').resultado, 'no_cumple');
  assert.equal(c('recapitulacion.recordatorio_inactividad').evidencia.dato, 'silencio [2] → [3] 121 s sin recordatorio');
});

test('caso 2: abandono del agente (mensaje del cliente sin respuesta)', () => {
  const lista = [...CONVERSACION_BUENA.slice(0, 10), ['cliente', 320, '¿Y qué hago con la factura duplicada?']];
  const c = correr(lista);
  assert.equal(c('critico.abandono').resultado, 'detectado');
  assert.deepEqual(c('critico.abandono').evidencia, { mensajes: [11], dato: 'último mensaje del cliente sin respuesta' });
  assert.equal(c('cierre.despedida').resultado, 'no_cumple');
  assert.equal(c('recapitulacion.cierre_inactividad').resultado, 'no_aplica');
});

test('caso 3: el cliente escribe después de la despedida → no es abandono', () => {
  const c = correr([...CONVERSACION_BUENA, ['cliente', 360, 'gracias']]);
  assert.equal(c('critico.abandono').resultado, 'no_detectado');
  assert.equal(c('recapitulacion.recordatorio_inactividad').resultado, 'no_aplica');
});

test('caso 4: el cliente escribe después del cierre por inactividad → no es abandono', () => {
  const c = correr(inactividad(130, [['cliente', 500, 'perdón, ya regresé']]), META_INVENTARIO);
  assert.equal(c('critico.abandono').resultado, 'no_detectado');
  assert.equal(c('recapitulacion.cierre_inactividad').resultado, 'cumple');
  assert.equal(c.variables.termina_por_inactividad, true);
});

test('caso 5: el cliente responde tarde tras el recordatorio', () => {
  const lista = [...inactividad(130).slice(0, 5), ['cliente', 415, 'Sí, aquí estoy, ya aparece.'], ['agente', 430, 'Perfecto. Tu caso CASO-11111 sigue en seguimiento. Que tengas buen día.']];
  const c = correr(lista, META_INVENTARIO);
  assert.equal(c('recapitulacion.recordatorio_inactividad').resultado, 'cumple');
  assert.equal(c('recapitulacion.cierre_inactividad').resultado, 'no_aplica');
  assert.equal(c.variables.termina_por_inactividad, false);
});

test('recordatorio sin cierre posterior → cierre_inactividad no cumple', () => {
  const c = correr(inactividad(130).slice(0, 5), META_INVENTARIO);
  assert.equal(c('recapitulacion.cierre_inactividad').resultado, 'no_cumple');
  assert.equal(c('critico.abandono').resultado, 'no_detectado', 'termina en mensaje del agente: no es abandono');
});

// ---------------------------------------------------------------------------
// Ayuda adicional y cierre
// ---------------------------------------------------------------------------

test('encuesta con caso no cerrado y campaña desactivada en config', () => {
  const c = correr(CONVERSACION_BUENA, { estado_caso: 'abierto' });
  assert.equal(c('ayuda_adicional.encuesta').resultado, 'no_aplica');
  assert.equal(c('ayuda_adicional.encuesta_caso_cerrado').resultado, 'no_cumple');
  assert.equal(res(CONVERSACION_BUENA, 'ayuda_adicional.campana_vigente', {}, { configCambios: { campana_vigente_activa: 'no' } }), 'no_aplica');
});

test('conversación sin mensajes del agente (3.12): reglas [JS] sobre conjunto vacío', () => {
  const c = correr([['cliente', 0, 'Hola, ¿hay alguien? Necesito cancelar una factura.']], { estado_caso: 'abierto', campos_capturados: {} });
  assert.equal(c.variables.sin_mensajes_agente, true);
  for (const id of ['apertura.saludo', 'apertura.aviso_privacidad', 'apertura.toma_a_tiempo', 'recapitulacion.informa_numero_caso', 'ayuda_adicional.ofrece_ayuda_adicional', 'cierre.agradece', 'cierre.despedida']) {
    assert.equal(c(id).resultado, 'no_cumple', id);
  }
  for (const id of ['empatia.mayusculas_sostenidas', 'comunicacion.signos_apertura', 'comunicacion.tecnicismos', 'comunicacion.frases_negativas', 'comunicacion.vicios_lenguaje', 'comunicacion.pide_espera', 'recapitulacion.recordatorio_inactividad', 'recapitulacion.numero_caso_coincide']) {
    assert.equal(c(id).resultado, 'no_aplica', id);
  }
  assert.equal(c('solucion.campos_obligatorios').resultado, 'no_cumple', 'metadatos: se evalúa igual');
  assert.equal(c('critico.no_toma_a_tiempo').resultado, 'detectado');
  assert.equal(c('critico.abandono').resultado, 'detectado');
  assert.equal(c('critico.palabras_altisonantes').resultado, 'no_detectado');
});

test('cierre: últimos N mensajes del agente (N de config)', () => {
  // Con N = 1 solo cuenta el mensaje 12, que sí trae todo.
  const c = correr(CONVERSACION_BUENA, {}, { configCambios: { cierre_mensajes_agente: 1 } });
  assert.equal(c('cierre.agradece').resultado, 'cumple');
  // Si el último mensaje no se despide, falla.
  const sinDespedida = correr(conMensaje(12, [null, null, 'Te invito a responder la encuesta de Contamix. Soy Mariana.']), {}, { configCambios: { cierre_mensajes_agente: 1 } });
  assert.equal(sinDespedida('cierre.despedida').resultado, 'no_cumple');
  assert.equal(sinDespedida('cierre.frase_cortesia').resultado, 'no_cumple');
});

test('payloadBueno se mantiene igual entre pruebas (fixtures sin efectos)', () => {
  assert.equal(payloadBueno().mensajes.length, 12);
});
