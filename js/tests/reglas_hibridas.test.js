const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluar, contextoHastaJS3, criterio, leerJSON } = require('./ayudas');
const { payloadBase, payloadBueno, conMensaje, CONVERSACION_BUENA, llmBueno } = require('./fixtures');
const { evaluarReglasHibridas } = require('../reglas_hibridas');

/** Salida del LLM buena con cambios puntuales. */
function llmCon(cambios = {}) {
  const llm = llmBueno();
  if ('info_n' in cambios) llm.primer_mensaje_info_cuenta.mensaje_n = cambios.info_n;
  if (cambios.atencion) llm.solicitudes_cliente[0].mensajes_atencion = cambios.atencion;
  if (cambios.ortografia) llm.errores_ortografia = cambios.ortografia;
  if (cambios.tema) llm.tema.valor = cambios.tema;
  if (cambios.escala !== undefined) llm.insumos_hibridos.situacion_escalamiento.situacion_requiere_escalamiento = cambios.escala;
  if (cambios.uso_correcto !== undefined) llm.insumos_hibridos.uso_solucion_seguimiento.uso_correcto = cambios.uso_correcto;
  if (cambios.criticos) Object.assign(llm.criticos_posibles, cambios.criticos);
  return llm;
}

function correr(lista, llm, metadatos, opciones) {
  const { evaluacion } = evaluar(payloadBase(lista, metadatos), llm, opciones);
  const c = (id) => criterio(evaluacion.criterios, id);
  c.evaluacion = evaluacion;
  return c;
}

/** Resultados de identidad en el orden de la tabla de rubrica.md sección 4. */
function identidad(c) {
  return [c('identidad.pide_datos').resultado, c('identidad.datos_coinciden').resultado, c('identidad.orden_validacion').resultado, c('critico.validacion_identidad').resultado];
}

const PIDE = '¡Hola! Bienvenido a Contamix, soy Mariana. Te informo que tus datos personales están protegidos por nuestro aviso de privacidad. Para validar tu identidad, ¿me compartes tu RFC y tu correo?';
const INFO = 'Gracias. Veo en tu cuenta la factura A-1050 pendiente de cancelar. Tu caso es CASO-58213.';
const DECLINA = 'Los datos no coinciden con los registrados, por seguridad no puedo compartir información de la cuenta. Tu caso es CASO-58213.';
const conv = (m1, m2, m3, m4, extra = []) => [['cliente', 0, m1], ['agente', 30, m2], ['cliente', 60, m3], ['agente', 90, m4], ...extra];

// ---------------------------------------------------------------------------
// Validación de identidad: tabla "Cómo queda cada caso" (rubrica.md, sección 4)
// ---------------------------------------------------------------------------

test('identidad: pide, el cliente da 2 datos correctos y luego recibe información', () => {
  const c = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'RFC TLA190211QM2, correo hector.villanueva@taquerialosarcos.example', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.match(c('identidad.datos_coinciden').evidencia.dato, /datos correctos: 2 de 2 \(\[RFC_1\] coincide, \[EMAIL_1\] coincide\); incorrectos \(evidencia\): 0; validación: \[3\]/);
});

test('identidad: RFC en el primer mensaje + correo después de la solicitud cuentan juntos', () => {
  const c = correr(conv('Hola, mi RFC es TLA190211QM2, quiero cancelar una factura.', PIDE, 'Mi correo es hector.villanueva@taquerialosarcos.example', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
});

test('identidad: datos correctos en el primer mensaje pero el agente nunca los pide', () => {
  const c = correr(conv('Hola, RFC TLA190211QM2 y correo hector.villanueva@taquerialosarcos.example.', '¡Hola! Bienvenido a Contamix, soy Mariana.', 'Quiero cancelar una factura.', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['no_cumple', 'no_aplica', 'cumple', 'detectado']);
});

test('identidad: 2 o más datos incorrectos y el agente declina sin dar información', () => {
  const c = correr(conv('Hola.', PIDE, 'RFC GOMA850101AB3 y correo otro@correo.example', DECLINA), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
});

test('identidad: 2 o más datos incorrectos y el agente da información', () => {
  const c = correr(conv('Hola.', PIDE, 'RFC GOMA850101AB3 y correo otro@correo.example', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
});

test('identidad: datos insuficientes y el agente declina (no hay error)', () => {
  const c = correr(conv('Hola.', PIDE, 'Solo tengo el RFC: TLA190211QM2', DECLINA), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
});

test('identidad: datos insuficientes y el agente da información', () => {
  const c = correr(conv('Hola.', PIDE, 'Solo tengo el RFC: TLA190211QM2', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
});

test('identidad: validación FUERA DE ORDEN (da información antes de completar la validación)', () => {
  const lista = conv('Hola.', PIDE, 'Mi RFC es TLA190211QM2', INFO, [
    ['cliente', 120, 'Y mi correo es hector.villanueva@taquerialosarcos.example'],
    ['agente', 150, 'Gracias. Que tengas buen día.'],
  ]);
  const c = correr(lista, llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
  assert.equal(c('identidad.orden_validacion').evidencia.dato, 'info_n: [4]; mensaje_validacion_n: null; validacion_exitosa: false');
  assert.equal(c.evaluacion.nota_final, 0);
});

test('identidad: no pide datos ni da información → bloque no aplica', () => {
  const c = correr(conv('Hola, ¿qué planes tienen?', '¡Hola! Bienvenido a Contamix, soy Mariana.', 'Gracias.', 'Tenemos tres planes. Tu caso es CASO-58213.'), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['no_aplica', 'no_aplica', 'no_aplica', 'no_detectado']);
  assert.equal(c('identidad.pide_datos').evidencia.dato, 'bloque de identidad no aplica');
});

test('identidad: conversación buena del fixture (titular + RFC antes de info_n = 6)', () => {
  const c = correr(CONVERSACION_BUENA, llmBueno());
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
});

// ---------------------------------------------------------------------------
// Confidencialidad (parte JS + parte LLM)
// ---------------------------------------------------------------------------

const confidencialidad = (lista, llm = llmCon({ info_n: null, atencion: [4] })) => correr(lista, llm)('critico.confidencialidad');

test('confidencialidad: el agente revela el correo registrado completo que el cliente no escribió', () => {
  const c = confidencialidad(conv('Hola.', '¡Hola! Soy Mariana de Contamix.', '¿A qué correo llega la factura?', 'Llega a hector.villanueva@taquerialosarcos.example. Caso CASO-58213.'));
  assert.equal(c.resultado, 'detectado');
  assert.equal(c.evidencia.dato, 'JS: [4] correo completo [EMAIL_1] (dato registrado)');
});

test('confidencialidad: repetir un dato que el cliente ya escribió o un canal oficial no es revelación', () => {
  assert.equal(confidencialidad(conv('Mi correo es hector.villanueva@taquerialosarcos.example', '¡Hola! Soy Mariana de Contamix.', 'ok', 'Confirmo hector.villanueva@taquerialosarcos.example. Caso CASO-58213.')).resultado, 'no_detectado');
  assert.equal(confidencialidad(conv('Hola.', '¡Hola! Soy Mariana de Contamix.', 'ok', 'Escribe a soporte@contamix.example o al 5550001000. Caso CASO-58213.')).resultado, 'no_detectado');
});

test('confidencialidad: dato parcial antes de validar es revelación; después, solo con el formato de config', () => {
  const validado = (texto) =>
    conv('Hola.', PIDE, 'RFC TLA190211QM2 y teléfono 55 5456 7804', INFO, [['agente', 120, texto]]);
  const llm = llmCon({ info_n: 4, atencion: [4] });
  assert.equal(confidencialidad(validado('Tu correo registrado es h***@taquerialosarcos.example.'), llm).resultado, 'no_detectado');
  assert.equal(confidencialidad(validado('Tu correo registrado es he***@taquerialosarcos.example.'), llm).resultado, 'detectado', 'más visibles que los permitidos');
  // Antes de cualquier validación.
  const antes = confidencialidad(conv('Hola.', '¡Hola! Soy Mariana de Contamix.', '¿Qué correo tengo?', 'Termina en h***@taquerialosarcos.example. Caso CASO-58213.'));
  assert.equal(antes.resultado, 'detectado');
});

test('confidencialidad: un RFC completo de un tercero cuenta como revelación; el genérico del SAT no', () => {
  // RFC de un tercero (no es el de la cuenta ni genérico): revelación.
  const tercero = confidencialidad(conv('Hola.', '¡Hola! Soy Mariana de Contamix.', '¿Qué RFC tiene mi proveedor?', 'Su RFC es GOMA850101AB3. Caso CASO-58213.'));
  assert.equal(tercero.resultado, 'detectado');
  assert.match(tercero.evidencia.dato, /rfc completo \[RFC_1\] \(dato de un tercero\)/);
  // RFC genérico (config.rfc_genericos_permitidos): nunca cuenta, igual que un canal oficial.
  for (const generico of ['XAXX010101000', 'xexx010101000']) {
    const c = confidencialidad(conv('Hola.', '¡Hola! Soy Mariana de Contamix.', '¿Qué RFC uso para público en general?', `Usa el RFC genérico ${generico}. Caso CASO-58213.`));
    assert.equal(c.resultado, 'no_detectado', generico);
  }
  // La lista sale de config: si se quita el genérico de la lista, vuelve a ser un RFC de tercero.
  const sinLista = correr(conv('Hola.', '¡Hola! Soy Mariana de Contamix.', '¿Qué RFC uso?', 'Usa XAXX010101000. Caso CASO-58213.'), llmCon({ info_n: null, atencion: [4] }), undefined, { configCambios: { rfc_genericos_permitidos: 'XEXX010101000' } });
  assert.equal(sinLista('critico.confidencialidad').resultado, 'detectado');
});

test('confidencialidad: la parte LLM basta si trae evidencia válida', () => {
  const llm = llmCon({ criticos: { confidencialidad: { detectado: true, mensajes: [8], justificacion: 'Revela el plan de otro cliente.' } } });
  const c = correr(CONVERSACION_BUENA, llm)('critico.confidencialidad');
  assert.equal(c.resultado, 'detectado');
  assert.deepEqual(c.evidencia.mensajes, [8]);
});

// ---------------------------------------------------------------------------
// Ortografía, escalamiento, uso de palabras, tipificación
// ---------------------------------------------------------------------------

test('ortografía: umbrales de config para graves y menores; errores del cliente se descartan', () => {
  const orto = (errores) => correr(CONVERSACION_BUENA, llmCon({ ortografia: errores }))('comunicacion.ortografia');
  const e = (n, gravedad) => ({ mensaje_n: n, texto_error: 'x', correccion: 'y', gravedad });
  assert.equal(orto([e(2, 'grave')]).resultado, 'no_cumple');
  assert.equal(orto([e(2, 'menor'), e(4, 'menor')]).resultado, 'cumple');
  assert.equal(orto([e(2, 'menor'), e(4, 'menor'), e(6, 'menor')]).resultado, 'no_cumple');
  const descartado = orto([e(1, 'grave')]);
  assert.equal(descartado.resultado, 'cumple');
  assert.match(descartado.evidencia.dato, /descartados: 1/);
});

test('escalamiento: con temas mixtos decide el LLM; con todas las filas iguales decide el catálogo', () => {
  // Cancelación de CFDI tiene filas "no" y "segun_caso": decide el LLM.
  const llmSi = correr(CONVERSACION_BUENA, llmCon({ escala: true }));
  assert.equal(llmSi('solucion.escala_cuando_requiere').resultado, 'no_cumple', 'requiere y no escaló');
  assert.equal(llmSi('solucion.no_escala_innecesario').resultado, 'no_aplica');
  // Planes y promociones solo tiene "no": el catálogo gana aunque el LLM diga true.
  const planes = correr(CONVERSACION_BUENA, llmCon({ tema: 'Planes y promociones', escala: true }), { escalado: true });
  assert.equal(planes('solucion.escala_cuando_requiere').resultado, 'no_aplica');
  assert.equal(planes('solucion.no_escala_innecesario').resultado, 'no_cumple');
  assert.match(planes('solucion.no_escala_innecesario').evidencia.dato, /fuente: catálogo/);
  // Todas las filas "si" (catálogo de prueba): requiere = true aunque el LLM diga false.
  const ctx = contextoHastaJS3(payloadBueno({ escalado: true }));
  ctx.catalogo = ctx.catalogo.map((f) => (f.tema === 'Cancelación de CFDI' ? { ...f, requiere_escalamiento: 'si' } : f));
  ctx.llm = llmCon({ escala: false });
  const r = evaluarReglasHibridas(ctx);
  assert.equal(criterio(r.criterios, 'solucion.escala_cuando_requiere').resultado, 'cumple');
});

test('tipificación incorrecta: no cumple y activa el crítico', () => {
  const c = correr(CONVERSACION_BUENA, llmBueno(), { tipificacion_agente: 'Emisión de CFDI', campos_capturados: { rfc_receptor: 'presente', uso_cfdi: 'presente' } });
  assert.equal(c('recapitulacion.tipificacion').resultado, 'no_cumple');
  assert.equal(c('critico.tipificacion_incorrecta').resultado, 'detectado');
  assert.equal(c('critico.tipificacion_incorrecta').evidencia.dato, 'tema LLM: Cancelación de CFDI; tipificación agente: Emisión de CFDI; válidas: Cancelación de CFDI | Seguimiento de cancelación pendiente');
  // La otra tipificación válida del tema sí cumple.
  const ok = correr(CONVERSACION_BUENA, llmBueno(), { tipificacion_agente: 'Seguimiento de cancelación pendiente', campos_capturados: { uuid_factura: 'presente', fecha_solicitud_cancelacion: 'presente' } });
  assert.equal(ok('recapitulacion.tipificacion').resultado, 'cumple');
});

test('uso de "solución"/"seguimiento": palabra esperada según estado_caso y uso_correcto del LLM', () => {
  assert.equal(correr(CONVERSACION_BUENA, llmBueno())('recapitulacion.uso_solucion_seguimiento').resultado, 'cumple');
  assert.equal(correr(CONVERSACION_BUENA, llmCon({ uso_correcto: false }))('recapitulacion.uso_solucion_seguimiento').resultado, 'no_cumple');
  // Caso abierto pero el agente dice "solución": usa la contraria y no la esperada.
  assert.equal(correr(CONVERSACION_BUENA, llmBueno(), { estado_caso: 'abierto' })('recapitulacion.uso_solucion_seguimiento').resultado, 'no_cumple');
  assert.equal(correr(CONVERSACION_BUENA, llmBueno(), { numero_caso: null, estado_caso: 'sin_caso' })('recapitulacion.uso_solucion_seguimiento').resultado, 'no_aplica');
});

test('recapitula: JS impone no_aplica con inactividad del cliente', () => {
  const lista = [
    ['cliente', 0, 'Hola, tengo una duda.'],
    ['agente', 30, '¡Hola! Bienvenido a Contamix, soy Mariana. ¿En qué te puedo ayudar? Tu caso es CASO-58213.'],
    ['agente', 160, '¿Sigues ahí?'],
    ['agente', 290, 'Al no recibir respuesta, cierro el chat. Gracias por contactar a Contamix.'],
  ];
  const c = correr(lista, llmCon({ atencion: [2] }));
  assert.equal(c('recapitulacion.recapitula').resultado, 'no_aplica');
  assert.equal(c('recapitulacion.uso_solucion_seguimiento').resultado, 'no_aplica');
  assert.equal(c.evaluacion.secciones.find((s) => s.id_seccion === 'ayuda_adicional').resultado, 'no_aplica');
});

test('numero_preguntas (informativo): cuenta preguntas antes del primer mensaje de atención', () => {
  const c = correr(CONVERSACION_BUENA, llmBueno());
  assert.equal(c('diagnostico.numero_preguntas').resultado, 'cumple');
  assert.equal(c('diagnostico.numero_preguntas').evidencia.dato, '3 mensajes del agente con pregunta antes de [8]');
  assert.equal(correr(CONVERSACION_BUENA, llmCon({ atencion: [2] }))('diagnostico.numero_preguntas').resultado, 'no_aplica');
  assert.equal(correr(conMensaje(2, [null, null, 'Hola, soy Mariana de Contamix. Con gusto te ayudo.']), llmCon({ atencion: [4] }))('diagnostico.numero_preguntas').resultado, 'no_cumple');
});

// ---------------------------------------------------------------------------
// Críticos [LLM]
// ---------------------------------------------------------------------------

test('crítico [LLM] con evidencia válida se acepta; sin mensaje del agente detiene el flujo', () => {
  const c = correr(CONVERSACION_BUENA, llmCon({ criticos: { mala_actitud: { detectado: true, mensajes: [8], justificacion: 'Sarcasmo en [8].' } } }));
  assert.equal(c('critico.mala_actitud').resultado, 'detectado');
  assert.equal(c.evaluacion.nota_final, 0);
  assert.throws(
    () => correr(CONVERSACION_BUENA, llmCon({ criticos: { mala_actitud: { detectado: true, mensajes: [1], justificacion: 'x' } } })),
    /JS-5 debió rechazarlo/
  );
});

test('JS-6 consume contrato/ejemplos/llm_output_ejemplo.json con payload_ejemplo.json y reproduce evaluacion_ejemplo.json', () => {
  const llm = leerJSON('contrato/ejemplos/llm_output_ejemplo.json');
  const payload = leerJSON('contrato/ejemplos/payload_ejemplo.json');
  const ejemplo = leerJSON('contrato/ejemplos/evaluacion_ejemplo.json');
  const { evaluacion } = evaluar(payload, llm);
  const c = (id) => criterio(evaluacion.criterios, id);
  // Un error menor de ortografía no alcanza el umbral (3 menores o 1 grave).
  assert.equal(c('comunicacion.ortografia').resultado, 'cumple');
  assert.equal(c('empatia.identifica_emocion').evidencia.dato, 'emoción del cliente: preocupacion');
  // El agente no pide datos ni da información de la cuenta (mensaje_n = null): identidad no aplica.
  assert.equal(c('identidad.pide_datos').resultado, 'no_aplica');
  assert.equal(c('critico.validacion_identidad').resultado, 'no_detectado');
  assert.equal(c('critico.promesa_no_autorizada').resultado, 'detectado');
  assert.equal(evaluacion.tema_detectado, 'Cancelación de CFDI');
  // Cada uno de los 69 criterios, las secciones y las notas coinciden con el ejemplo del contrato.
  assert.deepEqual(evaluacion.criterios.map((x) => [x.id_criterio, x.origen, x.clasificacion, x.resultado]), ejemplo.criterios.map((x) => [x.id_criterio, x.origen, x.clasificacion, x.resultado]));
  assert.deepEqual(evaluacion.secciones, ejemplo.secciones);
  assert.deepEqual([evaluacion.nota_base, evaluacion.nota_final, evaluacion.cumple_meta, evaluacion.calidad], [ejemplo.nota_base, ejemplo.nota_final, ejemplo.cumple_meta, ejemplo.calidad]);
});

// ---------------------------------------------------------------------------
// Validación de identidad: casos pedidos por el dueño (mínimo = config.identidad_min_datos_correctos)
// ---------------------------------------------------------------------------

const PIDE3 = '¡Hola! Bienvenido a Contamix, soy Mariana. Te informo que tus datos personales están protegidos por nuestro aviso de privacidad. Para validar tu identidad, ¿me compartes tu RFC, tu correo y tu teléfono?';
const CAMBIA_TEMA = 'Mientras tanto, te cuento que tenemos una promoción vigente de cierre fiscal. Tu caso es CASO-58213.';
const CIERRA_SIN_DECLINAR = 'Gracias por contactar a Contamix. Soy Mariana, que tengas un excelente día. Tu caso es CASO-58213.';
const validacionIdentidad = (c) => c('critico.validacion_identidad');

test('identidad caso 1 (2 de 3 acertados): el tercero es incorrecto pero la validación es exitosa', () => {
  const c = correr(conv('Hola, quiero cancelar una factura.', PIDE3, 'RFC TLA190211QM2, correo hector.villanueva@taquerialosarcos.example y teléfono 55 1111 2222', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  // El dato incorrecto solo queda como evidencia: no hace fallar la validación.
  assert.match(c('identidad.datos_coinciden').evidencia.dato, /datos correctos: 2 de 2.*incorrectos \(evidencia\): 1/);
});

test('identidad caso 2 (1 acertado y 2 que no sabe): no alcanza el mínimo; si declina no hay error, si da información sí', () => {
  const cliente = 'Mi RFC es TLA190211QM2, pero el correo y el teléfono no los sé.';
  const declina = correr(conv('Hola, quiero cancelar una factura.', PIDE3, cliente, DECLINA), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(declina), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.match(declina('identidad.datos_coinciden').evidencia.dato, /datos correctos: 1 de 2/);
  const informa = correr(conv('Hola, quiero cancelar una factura.', PIDE3, cliente, INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(informa), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
  assert.equal(informa.evaluacion.nota_final, 0);
});

test('identidad caso 3 (dato alternativo): 1 acertado y 1 fallido; el agente pide otro y el acertado cuenta para el mínimo', () => {
  const lista = [
    ['cliente', 0, 'Hola, quiero cancelar una factura.'],
    ['agente', 30, PIDE],
    ['cliente', 60, 'Mi RFC es TLA190211QM2 y mi correo es otro@correo.example'],
    ['agente', 90, 'Ese correo no coincide. ¿Me puedes indicar tu teléfono registrado?'],
    ['cliente', 120, 'Es el 55 5456 7804'],
    ['agente', 150, INFO],
  ];
  const c = correr(lista, llmCon({ info_n: 6, atencion: [6] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.match(c('identidad.datos_coinciden').evidencia.dato, /validación: \[5\]/);
  // Control: si el dato alternativo también falla, no se llega al mínimo y dar información es crítico.
  const falla = lista.map((m, i) => (i === 4 ? ['cliente', 120, 'Es el 55 1111 2222'] : m));
  const f = correr(falla, llmCon({ info_n: 6, atencion: [6] }));
  assert.deepEqual(identidad(f), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
});

test('identidad "sin declinar" 1: no alcanza el mínimo, no da información y cambia de tema → datos_coinciden no_cumple SIN crítico', () => {
  const c = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Solo tengo el RFC: TLA190211QM2', CAMBIA_TEMA), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'cumple', 'no_detectado']);
  assert.match(c('identidad.datos_coinciden').justificacion, /no declina ni sigue pidiendo datos/);
  assert.equal(c.evaluacion.errores_criticos.some((e) => e.id_critico === 'critico.validacion_identidad'), false);
});

test('identidad "sin declinar" 2: no alcanza el mínimo, da largas y cierra sin declinar → no_cumple SIN crítico', () => {
  const lista = [
    ['cliente', 0, 'Hola, quiero cancelar una factura.'],
    ['agente', 30, PIDE],
    ['cliente', 60, 'Solo tengo el RFC: TLA190211QM2'],
    ['agente', 90, 'Gracias por el dato, déjame revisar con calma.'],
    ['cliente', 120, 'Ok.'],
    ['agente', 150, CIERRA_SIN_DECLINAR],
  ];
  const c = correr(lista, llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'cumple', 'no_detectado']);
  assert.equal(c.evaluacion.errores_criticos.some((e) => e.id_critico === 'critico.validacion_identidad'), false);
  assert.equal(c('cierre.despedida').resultado, 'cumple', 'la despedida del cierre se ve normal');
});

test('identidad: pide datos, el cliente da datos insuficientes y el agente solo se despide sin declinar → datos_coinciden no_cumple SIN crítico', () => {
  // rubrica.md sección 4: la solicitud [2] es anterior a los datos del cliente [3]; la despedida no
  // cuenta como seguir pidiendo, así que el agente no actuó ante el resultado de la validación.
  const c = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Solo tengo el RFC: TLA190211QM2', CIERRA_SIN_DECLINAR), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'cumple', 'no_detectado']);
  assert.equal(c.evaluacion.errores_criticos.some((e) => e.id_critico === 'critico.validacion_identidad'), false);
});

test('identidad: el cliente abandona tras la solicitud (recordatorio y cierre por inactividad) → datos_coinciden cumple, sin crítico', () => {
  const lista = [
    ['cliente', 0, 'Hola, quiero cancelar una factura.'],
    ['agente', 30, PIDE],
    ['agente', 160, '¿Sigues ahí?'],
    ['agente', 290, 'Al no recibir respuesta, cierro el chat. Gracias por contactar a Contamix.'],
  ];
  const c = correr(lista, llmCon({ info_n: null, atencion: [2] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.match(c('identidad.datos_coinciden').justificacion, /sigue pidiendo datos/);
});

test('identidad: datos insuficientes, el agente pide otro dato y el cliente ya no responde → datos_coinciden cumple', () => {
  const sigue = 'Con ese dato no alcanzo a validar tu identidad. ¿Me puedes indicar tu teléfono registrado?';
  const lista = [
    ['cliente', 0, 'Hola, quiero cancelar una factura.'],
    ['agente', 30, PIDE],
    ['cliente', 60, 'Solo tengo el RFC: TLA190211QM2'],
    ['agente', 90, sigue],
    ['agente', 220, '¿Sigues ahí?'],
    ['agente', 350, 'Al no recibir respuesta, cierro el chat. Gracias por contactar a Contamix.'],
  ];
  const c = correr(lista, llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
});

test('identidad: si el agente sigue pidiendo datos (alternativos o los mismos) cumple; una despedida final no lo impide', () => {
  const sigue = 'Con ese dato no alcanzo a validar tu identidad. ¿Me puedes indicar tu teléfono registrado?';
  const c = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Solo tengo el RFC: TLA190211QM2', sigue), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.match(c('identidad.datos_coinciden').justificacion, /sigue pidiendo datos/);
  // El último mensaje que no es despedida sigue pidiendo datos: se salta la despedida del final.
  const conDespedida = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Solo tengo el RFC: TLA190211QM2', sigue, [['cliente', 120, 'No lo tengo a la mano.'], ['agente', 150, 'Gracias por contactar a Contamix. Soy Mariana, que tengas un excelente día.']]), llmCon({ info_n: null, atencion: [4] }));
  assert.equal(conDespedida('identidad.datos_coinciden').resultado, 'cumple');
});

test('identidad: el mínimo sale de config (identidad_min_datos_correctos)', () => {
  const lista = conv('Hola, quiero cancelar una factura.', PIDE, 'Solo tengo el RFC: TLA190211QM2', INFO);
  const llm = () => llmCon({ info_n: 4, atencion: [4] });
  // Con mínimo 1, un dato acertado basta.
  assert.deepEqual(identidad(correr(lista, llm(), undefined, { configCambios: { identidad_min_datos_correctos: 1 } })), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  // Con mínimo 3, dos datos acertados ya no bastan.
  const dos = conv('Hola, quiero cancelar una factura.', PIDE, 'RFC TLA190211QM2, correo hector.villanueva@taquerialosarcos.example', INFO);
  assert.deepEqual(identidad(correr(dos, llm(), undefined, { configCambios: { identidad_min_datos_correctos: 3 } })), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
});

test('identidad: el número de caso no cuenta como dato de identidad, pero pedirlo o recibirlo no penaliza', () => {
  // (a) El cliente acierta 1 dato y da un número de caso: no cuenta, no se alcanza el mínimo.
  const alternativo = [
    ['cliente', 0, 'Hola, quiero cancelar una factura.'],
    ['agente', 30, PIDE],
    ['cliente', 60, 'Mi RFC es TLA190211QM2 y no recuerdo el correo.'],
    ['agente', 90, 'Entiendo. ¿Me compartes algún número de caso anterior?'],
    ['cliente', 120, 'Sí, el CASO-58213.'],
  ];
  const sinInfo = correr([...alternativo, ['agente', 150, DECLINA]], llmCon({ info_n: null, atencion: [6] }));
  // Pedir el número de caso no cambia ningún resultado: no es solicitud de identidad (la solicitud sigue siendo el mensaje 2).
  assert.equal(sinInfo('identidad.pide_datos').evidencia.mensajes[0], 2);
  assert.deepEqual(identidad(sinInfo), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.match(sinInfo('identidad.datos_coinciden').evidencia.dato, /datos correctos: 1 de 2/);
  // (b) Si el agente da información con solo ese dato + el número de caso: sigue siendo crítico.
  const conInfo = correr([...alternativo, ['agente', 150, INFO]], llmCon({ info_n: 6, atencion: [6] }));
  assert.deepEqual(identidad(conInfo), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
  // (c) Pedir el número de caso NO activa el bloque de identidad por sí solo.
  const soloCaso = correr(conv('Hola, necesito seguimiento.', '¡Hola! Bienvenido a Contamix, soy Mariana.', 'Gracias.', '¿Me compartes tu número de caso para ubicarlo?'), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(soloCaso), ['no_aplica', 'no_aplica', 'no_aplica', 'no_detectado']);
  // (d) Cuando el cliente ya acertó 2 datos, escribir además un número de caso no cambia nada.
  const dosYCaso = correr(conv('Hola, mi caso es CASO-58213.', PIDE, 'RFC TLA190211QM2, correo hector.villanueva@taquerialosarcos.example', INFO), llmCon({ info_n: 4, atencion: [4] }));
  assert.deepEqual(identidad(dosYCaso), ['cumple', 'cumple', 'cumple', 'no_detectado']);
});

test('identidad: RFC de la cuenta cuenta; RFC del receptor y RFC genérico no suman', () => {
  const llm = () => llmCon({ info_n: 4, atencion: [4] });
  const correo = 'hector.villanueva@taquerialosarcos.example';
  // RFC de la cuenta + correo de la cuenta: exitosa.
  assert.deepEqual(identidad(correr(conv('Hola.', PIDE, `RFC TLA190211QM2 y correo ${correo}`, INFO), llm())), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  // RFC del receptor (lista real dato_de_tercero, no coincide con la cuenta) + correo: solo 1 acertado;
  // el RFC es de tercero, así que ni suma ni queda como incorrecto.
  const receptor = correr(conv('Hola.', PIDE, `El RFC del receptor es GOMA850101AB3 y mi correo ${correo}`, INFO), llm());
  assert.deepEqual(identidad(receptor), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
  assert.match(receptor('identidad.datos_coinciden').evidencia.dato, /datos correctos: 1 de 2.*incorrectos \(evidencia\): 0/);
  // RFC genérico + correo: el genérico no es dato de identidad (se ignora, ni suma ni queda incorrecto).
  const generico = correr(conv('Hola.', PIDE, `Facturé a XAXX010101000 y mi correo es ${correo}`, INFO), llm());
  assert.deepEqual(identidad(generico), ['cumple', 'no_cumple', 'no_cumple', 'detectado']);
  assert.match(generico('identidad.datos_coinciden').evidencia.dato, /datos correctos: 1 de 2.*incorrectos \(evidencia\): 0/);
  // Receptor + RFC propio + correo: el del receptor no estorba, se alcanzan 2.
  const ambos = correr(conv('Hola.', PIDE, `Mi RFC TLA190211QM2, el del receptor es GOMA850101AB3 y mi correo ${correo}`, INFO), llm());
  assert.deepEqual(identidad(ambos), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  // Pedir el RFC del receptor no es solicitud de identidad: el agente que solo hace eso no activa el bloque.
  const pideReceptor = correr(conv('Quiero emitir una factura.', '¡Hola! Bienvenido a Contamix, soy Mariana.', 'Gracias.', '¿Me compartes el RFC del receptor de la factura?'), llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(pideReceptor), ['no_aplica', 'no_aplica', 'no_aplica', 'no_detectado']);
});

// ---------------------------------------------------------------------------
// "Sigue pidiendo datos": lista pide_numero_caso y definición de "cliente aporta datos de identidad"
// (rubrica.md sección 4, decisión del dueño 23-oct-2026)
// ---------------------------------------------------------------------------

const { DATOS } = require('./ayudas');
const { normalizarTexto, compilarListas, buscarEnLista } = require('../reglas');

const INSUFICIENTE = 'Solo tengo el RFC: TLA190211QM2';

test('lista pide_numero_caso leída de datos/listas.csv: frases positivas y negativas de folio', () => {
  const compiladas = compilarListas(DATOS.listas.filter((f) => f.activo === 'si'));
  const coincide = (t) => buscarEnLista(compiladas, 'pide_numero_caso', normalizarTexto(t)).length > 0;
  for (const t of ['¿Me compartes el número de caso anterior?', '¿Cuál es tu número de caso?', 'Necesito el folio del caso, por favor.', '¿Me puedes pasar el folio de tu ticket?']) {
    assert.equal(coincide(t), true, `debe coincidir: ${t}`);
  }
  for (const t of ['Número de caso, por favor.', '¿Número de caso?']) assert.equal(coincide(t), true, `debe coincidir: ${t}`);
  for (const t of ['Tu número de caso es CASO-58231', 'Gracias. Tu número de caso, que anoto, es 5']) assert.equal(coincide(t), false, `no debe coincidir: ${t}`);
  for (const t of ['¿Me compartes el folio fiscal de la factura?', '¿Cuál es el folio de la factura?', 'Tu número de caso es CASO-58213.', 'Por favor dime el folio.']) {
    assert.equal(coincide(t), false, `no debe coincidir: ${t}`);
  }
});

test('número de caso 1: datos insuficientes, el agente pide el número de caso y el cliente no responde → datos_coinciden cumple, sin crítico, pide_datos no cambia', () => {
  const lista = conv('Hola, quiero cancelar una factura.', PIDE, INSUFICIENTE, 'Gracias. ¿Me compartes el número de caso anterior?');
  const c = correr(lista, llmCon({ info_n: null, atencion: [4] }));
  assert.deepEqual(identidad(c), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  assert.deepEqual(c('identidad.pide_datos').evidencia.mensajes, [2], 'la solicitud de identidad sigue siendo la del mensaje 2, no la del número de caso');
  assert.match(c('identidad.datos_coinciden').justificacion, /sigue pidiendo datos/);
});

test('número de caso 2: pedir el número de caso NO cuenta como solicitud de identidad (sin otra solicitud, pide_datos no_cumple)', () => {
  const lista = conv('Hola, quiero cancelar una factura.', '¡Hola! Bienvenido a Contamix, soy Mariana. ¿Me compartes el número de caso anterior?', 'No lo tengo.', INFO);
  const c = correr(lista, llmCon({ info_n: 4, atencion: [4] }));
  assert.equal(c('identidad.pide_datos').resultado, 'no_cumple');
});

for (const folio of ['Gracias. ¿Me compartes el folio fiscal de la factura?', 'Gracias. ¿Cuál es el folio de la factura?']) {
  test(`folio negativa: "${folio}" tras datos insuficientes NO cuenta como seguir pidiendo → no_cumple, sin crítico`, () => {
    const c = correr(conv('Hola, quiero cancelar una factura.', PIDE, INSUFICIENTE, folio), llmCon({ info_n: null, atencion: [4] }));
    assert.deepEqual(identidad(c), ['cumple', 'no_cumple', 'cumple', 'no_detectado']);
    assert.equal(c.evaluacion.errores_criticos.some((e) => e.id_critico === 'critico.validacion_identidad'), false);
  });
}

test('aporta datos: RFC genérico del cliente no cuenta, la solicitud previa sigue vigente → cumple; el control con RFC incorrecto de la cuenta + despedida → no_cumple', () => {
  const llm = llmCon({ info_n: null, atencion: [4] });
  const generico = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'La factura es para público en general, RFC XAXX010101000.', CIERRA_SIN_DECLINAR), llm);
  assert.deepEqual(identidad(generico), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  const control = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Mi RFC es GOMA850101AB3.', CIERRA_SIN_DECLINAR), llm);
  assert.deepEqual(identidad(control), ['cumple', 'no_cumple', 'cumple', 'no_detectado']);
});

test('aporta datos: RFC del receptor (dato de tercero) no cuenta; el mismo RFC sin esa mención sí cuenta', () => {
  const llm = llmCon({ info_n: null, atencion: [4] });
  const receptor = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'El RFC del receptor es GOMA850101AB3.', CIERRA_SIN_DECLINAR), llm);
  assert.deepEqual(identidad(receptor), ['cumple', 'cumple', 'cumple', 'no_detectado']);
  // Regla del dueño: un RFC que COINCIDE con la cuenta nunca es de tercero, aunque la cláusula diga "mi cliente".
  const delDueno = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Mi RFC es TLA190211QM2, con él le facturo a mi cliente.', CIERRA_SIN_DECLINAR), llm);
  // Un solo dato correcto no basta (se piden 2), pero cuenta como correcto y no como de tercero ni incorrecto.
  assert.match(delDueno('identidad.datos_coinciden').evidencia.dato, /datos correctos: 1 de 2.*incorrectos \(evidencia\): 0/);
  assert.equal(delDueno.evaluacion.errores_criticos.some((e) => e.id_critico === 'critico.validacion_identidad'), false);
  const propio = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Mi RFC es GOMA850101AB3.', CIERRA_SIN_DECLINAR), llm);
  assert.deepEqual(identidad(propio), ['cumple', 'no_cumple', 'cumple', 'no_detectado']);
});

test('aporta datos: un nombre de pila solo no cuenta como dato aportado', () => {
  const llm = llmCon({ info_n: null, atencion: [4] });
  const c = correr(conv('Hola, quiero cancelar una factura.', PIDE, 'Soy Héctor.', CIERRA_SIN_DECLINAR), llm);
  assert.equal(c('identidad.datos_coinciden').resultado, 'cumple');
});
