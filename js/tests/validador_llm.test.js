// Pruebas de JS-5 (js/validador_llm.js). Ejecutar desde la raíz: node --test
// Cada prueba parte de la respuesta válida del contrato
// (contrato/ejemplos/llm_output_ejemplo.json) y le aplica UNA alteración, para
// comprobar que la regla correspondiente de rubrica.md 6.1 la detecta.
//
// La conversación contra la que se valida es la del ejemplo del contrato
// (contrato/ejemplos/payload_ejemplo.json, 10 mensajes), enmascarada como lo
// haría JS-2. Así el ejemplo de salida y la conversación siempre corresponden:
// si el contrato cambia sus ejemplos, estas pruebas siguen al contrato.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validarRespuestaLlm,
  redactarMensajeReintento,
  extraerTextoSalida,
  validarContraEsquema,
  diagnosticarTextoNoJson,
  mensajeRaizSinContenido,
} = require('../validador_llm.js');
const { limpiarEsquema } = require('../construccion_prompt.js');
const datos = require('./construccion_prompt_datos_referencia.js');

const fs = require('node:fs');
const path = require('node:path');

const ESQUEMA = datos.cargarEsquemaLlm();
const CATALOGO = datos.cargarCatalogo();
const BASE = datos.cargarBase();

// Mensajes del payload de ejemplo con el nombre del titular de CTA-104
// (datos/cuentas.csv: Héctor Villanueva Ruiz) enmascarado como [NOMBRE_1]
// (glosario, sección 8: nombre de pila solo = el mismo marcador). Solo se
// conservan los campos que usa JS-5: n, emisor y texto.
const PAYLOAD_EJEMPLO = JSON.parse(fs.readFileSync(path.join(datos.RAIZ, 'contrato', 'ejemplos', 'payload_ejemplo.json'), 'utf8'));
const CONVERSACION = PAYLOAD_EJEMPLO.mensajes.map((m) => ({
  n: m.n,
  emisor: m.emisor,
  texto: m.texto.split('Héctor Villanueva').join('[NOMBRE_1]').split('Héctor').join('[NOMBRE_1]'),
}));
const ULTIMO_N = CONVERSACION.length; // 10

function contexto(extra = {}) {
  return {
    esquema: ESQUEMA,
    mensajes: CONVERSACION,
    catalogo_temas: CATALOGO,
    base_conocimiento: BASE,
    tipo_interaccion: 'ce',
    termina_por_inactividad: false,
    ...extra,
  };
}

// Copia profunda del ejemplo para modificarlo sin afectar otras pruebas.
const ejemplo = () => datos.cargarEjemploLlm();

test('la conversación de prueba es la del contrato: 10 mensajes y el agente en 2, 4, 6, 8, 9 y 10', () => {
  assert.equal(ULTIMO_N, 10);
  assert.deepEqual(CONVERSACION.filter((m) => m.emisor === 'agente').map((m) => m.n), [2, 4, 6, 8, 9, 10]);
  assert.doesNotMatch(JSON.stringify(CONVERSACION), /Héctor/);
});

// Afirma que el resultado es inválido y que alguna entrada de detalle es de la
// regla indicada y menciona la ruta indicada.
function assertError(resultado, regla, fragmentoRuta) {
  assert.equal(resultado.valido, false, 'se esperaba respuesta inválida');
  const hallado = resultado.detalle.some((d) => d.regla === regla && d.ruta.includes(fragmentoRuta));
  assert.ok(hallado, `no se encontró error de la regla ${regla} en ${fragmentoRuta}. Errores: ${JSON.stringify(resultado.detalle, null, 2)}`);
}

// --- Respuestas válidas ------------------------------------------------------------

test('el ejemplo del contrato es válido (objeto)', () => {
  const r = validarRespuestaLlm(ejemplo(), contexto());
  assert.deepEqual(r.errores, []);
  assert.equal(r.valido, true);
});

test('el ejemplo del contrato es válido (texto JSON tal como lo devuelve la API)', () => {
  const r = validarRespuestaLlm(JSON.stringify(ejemplo()), contexto());
  assert.equal(r.valido, true);
});

test('primer_mensaje_info_cuenta.mensaje_n = null es válido', () => {
  const e = ejemplo();
  e.primer_mensaje_info_cuenta.mensaje_n = null;
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

test('no_aplica en empatía es válido si la emoción es neutral', () => {
  const e = ejemplo();
  e.emocion_cliente.emocion = 'neutral';
  for (const k of ['identifica_emocion', 'muestra_empatia']) {
    e.criterios.empatia[k] = { resultado: 'no_aplica', mensajes: [], justificacion: 'Cliente neutral, sin situación que validar.' };
  }
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

test('recapitula no_aplica es válido si termina_por_inactividad = true', () => {
  const e = ejemplo();
  e.criterios.recapitulacion.recapitula = { resultado: 'no_aplica', mensajes: [], justificacion: 'La conversación termina por inactividad del cliente.' };
  assert.equal(validarRespuestaLlm(e, contexto({ termina_por_inactividad: true })).valido, true);
});

test('no_cumple por omisión con mensajes del tramo es válido', () => {
  const e = ejemplo();
  e.criterios.recapitulacion.recapitula = { resultado: 'no_cumple', mensajes: [8, 9, 10], justificacion: 'El agente no resume antes de cerrar.' };
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

test('crítico detectado con mensaje del agente y justificación es válido', () => {
  const e = ejemplo();
  e.criticos_posibles.mala_actitud = { detectado: true, mensajes: [6], justificacion: 'Ejemplo ficticio: "Va, sale." en tono burlón.' };
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

// --- Regla 1: estructura, catálogo y base ---------------------------------------------

test('regla 1: texto que no es JSON', () => {
  const r = validarRespuestaLlm('{"tema": ', contexto());
  assertError(r, '1', '(raíz)');
  assert.match(r.errores[0], /no es un JSON válido/);
});

test('regla 1: falta un campo obligatorio', () => {
  const e = ejemplo();
  delete e.criticos_posibles;
  assertError(validarRespuestaLlm(e, contexto()), '1', 'criticos_posibles');
});

test('regla 1: falta un criterio dentro de una sección', () => {
  const e = ejemplo();
  delete e.criterios.solucion.apego_proceso;
  assertError(validarRespuestaLlm(e, contexto()), '1', 'criterios.solucion.apego_proceso');
});

test('regla 1: campo adicional no permitido (por ejemplo, una nota)', () => {
  const e = ejemplo();
  e.nota = 85;
  const r = validarRespuestaLlm(e, contexto());
  assertError(r, '1', 'nota');
  assert.match(r.errores.join(' '), /no existe en el esquema/);
});

test('regla 1: valor fuera del enum (emoción y resultado)', () => {
  const e = ejemplo();
  e.emocion_cliente.emocion = 'feliz';
  e.criterios.empatia.cordialidad.resultado = 'parcial';
  const r = validarRespuestaLlm(e, contexto());
  assertError(r, '1', 'emocion_cliente.emocion');
  assertError(r, '1', 'criterios.empatia.cordialidad.resultado');
});

test('regla 1: tipo incorrecto (booleano como texto)', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].atendida = 'si';
  assertError(validarRespuestaLlm(e, contexto()), '1', 'solicitudes_cliente[0].atendida');
});

test('regla 1: solicitudes_cliente vacía (minItems)', () => {
  const e = ejemplo();
  e.solicitudes_cliente = [];
  assertError(validarRespuestaLlm(e, contexto()), '1', 'solicitudes_cliente');
});

test('regla 1: id_articulo con formato inválido (pattern)', () => {
  const e = ejemplo();
  e.articulos_base_usados[0].id_articulo = 'KB-2';
  assertError(validarRespuestaLlm(e, contexto()), '1', 'articulos_base_usados[0].id_articulo');
});

test('regla 1: tema fuera del catálogo', () => {
  const e = ejemplo();
  e.tema.valor = 'Cancelacion de CFDI'; // sin acento: no es el texto exacto del catálogo
  const r = validarRespuestaLlm(e, contexto());
  assertError(r, '1', 'tema.valor');
  assert.match(r.errores.join(' '), /Cancelación de CFDI/); // le muestra al modelo los temas válidos
});

test('regla 1: tema de una fila inactiva o de otro tipo no cuenta', () => {
  const catalogo = [
    { tema: 'Tema solo de sales', tipo_interaccion: 'sales', activo: 'si' },
    { tema: 'Tema inactivo', tipo_interaccion: 'ce', activo: 'no' },
    { tema: 'Cancelación de CFDI', tipo_interaccion: 'todos', activo: 'si' },
  ];
  const e = ejemplo();
  assert.equal(validarRespuestaLlm(e, contexto({ catalogo_temas: catalogo })).valido, true); // "todos" sí cuenta
  e.tema.valor = 'Tema solo de sales';
  assertError(validarRespuestaLlm(e, contexto({ catalogo_temas: catalogo })), '1', 'tema.valor');
  e.tema.valor = 'Tema inactivo';
  assertError(validarRespuestaLlm(e, contexto({ catalogo_temas: catalogo })), '1', 'tema.valor');
});

test('regla 1: id_articulo que no existe en la base', () => {
  const e = ejemplo();
  e.articulos_base_usados[0].id_articulo = 'KB-99';
  assertError(validarRespuestaLlm(e, contexto()), '1', 'articulos_base_usados[0].id_articulo');
});

// --- Regla 2: números de mensaje -------------------------------------------------------

test('regla 2: número de mensaje inexistente', () => {
  const e = ejemplo();
  e.tema.mensajes = [1, 11];
  const r = validarRespuestaLlm(e, contexto());
  assertError(r, '2', 'tema.mensajes[1]');
  assert.match(r.errores.join(' '), /del 1 al 10/);
});

test('regla 2: mensaje_n = 0 se rechaza aunque el esquema enviado no tenga minimum', () => {
  // Simula que la prueba A obligó a quitar minimum: JS-5 debe atraparlo igual.
  const sinMinimum = limpiarEsquema(ESQUEMA, ['minimum']);
  const e = ejemplo();
  e.primer_mensaje_info_cuenta.mensaje_n = 0;
  assertError(validarRespuestaLlm(e, contexto({ esquema: sinMinimum })), '2', 'primer_mensaje_info_cuenta.mensaje_n');
});

test('regla 2: error de ortografía en un mensaje del cliente', () => {
  const e = ejemplo();
  e.errores_ortografia[0].mensaje_n = 1;
  assertError(validarRespuestaLlm(e, contexto()), '2', 'errores_ortografia[0].mensaje_n');
});

test('regla 2: primer_mensaje_info_cuenta en un mensaje del cliente', () => {
  const e = ejemplo();
  e.primer_mensaje_info_cuenta.mensaje_n = 1;
  assertError(validarRespuestaLlm(e, contexto()), '2', 'primer_mensaje_info_cuenta.mensaje_n');
});

test('regla 2: solicitud planteada en un mensaje del agente', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].mensaje_n = 2;
  assertError(validarRespuestaLlm(e, contexto()), '2', 'solicitudes_cliente[0].mensaje_n');
});

test('regla 2: mensajes_atencion con un mensaje del cliente', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].mensajes_atencion = [1];
  assertError(validarRespuestaLlm(e, contexto()), '2', 'solicitudes_cliente[0].mensajes_atencion[0]');
});

test('regla 2: crítico que cita un mensaje del cliente', () => {
  const e = ejemplo();
  e.criticos_posibles.negacion_servicio = { detectado: true, mensajes: [1, 2], justificacion: 'Ejemplo.' };
  assertError(validarRespuestaLlm(e, contexto()), '2', 'criticos_posibles.negacion_servicio.mensajes[0]');
});

// --- Regla 3: no_aplica prohibido ------------------------------------------------------

test('regla 3: no_aplica en cada criterio donde la rúbrica dice "Nunca"', () => {
  const prohibidos = [
    ['empatia', 'cordialidad'],
    ['empatia', 'lenguaje_acorde'],
    ['diagnostico', 'solicitudes_detectadas'],
    ['diagnostico', 'solicitudes_atendidas'],
    ['solucion', 'informacion_correcta'],
    ['solucion', 'informacion_completa'],
    ['solucion', 'apego_proceso'],
    ['comunicacion', 'redaccion'],
    ['comunicacion', 'congruencia'],
  ];
  for (const [s, c] of prohibidos) {
    const e = ejemplo();
    e.criterios[s][c] = { resultado: 'no_aplica', mensajes: [], justificacion: 'x' };
    assertError(validarRespuestaLlm(e, contexto()), '3', `criterios.${s}.${c}.resultado`);
  }
});

test('regla 3: no_aplica permitido en asertividad, preguntas_necesarias y ofrece_alternativas', () => {
  const e = ejemplo();
  e.criterios.diagnostico.preguntas_necesarias = { resultado: 'no_aplica', mensajes: [], justificacion: 'Solicitud completa.' };
  // asertividad y ofrece_alternativas ya vienen en no_aplica en el ejemplo
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

// --- Regla 4: emoción neutral -----------------------------------------------------------

test('regla 4: no_aplica en muestra_empatia con emoción distinta de neutral', () => {
  const e = ejemplo(); // emoción preocupacion
  e.criterios.empatia.muestra_empatia = { resultado: 'no_aplica', mensajes: [], justificacion: 'x' };
  assertError(validarRespuestaLlm(e, contexto()), '4', 'criterios.empatia.muestra_empatia.resultado');
});

test('regla 4: no_aplica en identifica_emocion con emoción distinta de neutral', () => {
  const e = ejemplo();
  e.criterios.empatia.identifica_emocion = { resultado: 'no_aplica', mensajes: [], justificacion: 'x' };
  assertError(validarRespuestaLlm(e, contexto()), '4', 'criterios.empatia.identifica_emocion.resultado');
});

// --- Regla 5: recapitulación ---------------------------------------------------------------

test('regla 5: recapitula no_aplica con termina_por_inactividad = false', () => {
  const e = ejemplo();
  e.criterios.recapitulacion.recapitula = { resultado: 'no_aplica', mensajes: [], justificacion: 'x' };
  const r = validarRespuestaLlm(e, contexto({ termina_por_inactividad: false }));
  assertError(r, '5', 'criterios.recapitulacion.recapitula.resultado');
  assert.match(r.errores.join(' '), /TERMINA_POR_INACTIVIDAD = false/);
});

// --- Reglas 6, 7 y 8: solicitudes ------------------------------------------------------------

test('regla 6: solicitudes_detectadas cumple con una solicitud no detectada', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].detectada_por_agente = false;
  assertError(validarRespuestaLlm(e, contexto()), '6', 'criterios.diagnostico.solicitudes_detectadas.resultado');
});

test('regla 6: solicitudes_detectadas no_cumple con todas detectadas', () => {
  const e = ejemplo();
  e.criterios.diagnostico.solicitudes_detectadas.resultado = 'no_cumple';
  assertError(validarRespuestaLlm(e, contexto()), '6', 'criterios.diagnostico.solicitudes_detectadas.resultado');
});

test('regla 7: solicitudes_atendidas cumple con una solicitud no atendida', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].atendida = false;
  e.solicitudes_cliente[0].mensajes_atencion = [];
  assertError(validarRespuestaLlm(e, contexto()), '7', 'criterios.diagnostico.solicitudes_atendidas.resultado');
});

test('regla 7: coherente cuando hay una solicitud no atendida y el criterio es no_cumple', () => {
  const e = ejemplo();
  e.solicitudes_cliente.push({
    descripcion: 'Saber si la factura se puede reactivar',
    mensaje_n: 1,
    detectada_por_agente: true,
    atendida: false,
    mensajes_atencion: [],
    justificacion: 'El agente no responde esa pregunta.',
  });
  e.criterios.diagnostico.solicitudes_atendidas = { resultado: 'no_cumple', mensajes: [1, 2], justificacion: 'Una solicitud quedó sin atender.' };
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

test('regla 8: atendida = true sin mensajes_atencion', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].mensajes_atencion = [];
  assertError(validarRespuestaLlm(e, contexto()), '8', 'solicitudes_cliente[0].mensajes_atencion');
});

test('regla 8: atendida = false con mensajes_atencion', () => {
  const e = ejemplo();
  e.solicitudes_cliente[0].atendida = false;
  e.criterios.diagnostico.solicitudes_atendidas.resultado = 'no_cumple';
  assertError(validarRespuestaLlm(e, contexto()), '8', 'solicitudes_cliente[0].mensajes_atencion');
});

// --- Regla 9: evidencia de criterios -----------------------------------------------------------

test('regla 9: no_cumple sin mensajes (omisión sin citar el tramo)', () => {
  const e = ejemplo();
  e.criterios.recapitulacion.recapitula = { resultado: 'no_cumple', mensajes: [], justificacion: 'No recapitula.' };
  const r = validarRespuestaLlm(e, contexto());
  assertError(r, '9', 'criterios.recapitulacion.recapitula.mensajes');
  assert.match(r.errores.join(' '), /tramo/);
});

test('regla 9: cumple con justificación vacía', () => {
  const e = ejemplo();
  e.criterios.comunicacion.redaccion.justificacion = '   ';
  assertError(validarRespuestaLlm(e, contexto()), '9', 'criterios.comunicacion.redaccion.justificacion');
});

// --- Regla 10: evidencia de críticos -------------------------------------------------------------

test('regla 10: crítico detectado sin mensajes', () => {
  const e = ejemplo();
  e.criticos_posibles.promesa_no_autorizada = { detectado: true, mensajes: [], justificacion: 'Promete reembolso.' };
  assertError(validarRespuestaLlm(e, contexto()), '10', 'criticos_posibles.promesa_no_autorizada.mensajes');
});

test('regla 10: crítico detectado solo con mensajes del cliente', () => {
  const e = ejemplo();
  e.criticos_posibles.mala_actitud = { detectado: true, mensajes: [1], justificacion: 'x' };
  assertError(validarRespuestaLlm(e, contexto()), '10', 'criticos_posibles.mala_actitud.mensajes');
});

test('regla 10: crítico detectado sin justificación', () => {
  const e = ejemplo();
  e.criticos_posibles.mala_actitud = { detectado: true, mensajes: [6], justificacion: '' };
  assertError(validarRespuestaLlm(e, contexto()), '10', 'criticos_posibles.mala_actitud.justificacion');
});

test('regla 10: crítico no detectado con mensajes', () => {
  const e = ejemplo();
  e.criticos_posibles.confidencialidad.mensajes = [2];
  assertError(validarRespuestaLlm(e, contexto()), '10', 'criticos_posibles.confidencialidad.mensajes');
});

// --- E1: texto del error de ortografía --------------------------------------------------------------

test('E1: texto_error que no aparece en el mensaje citado', () => {
  const e = ejemplo(); // el ejemplo cita "cancelacion" en el mensaje 6
  e.errores_ortografia[0].texto_error = 'aser';
  assertError(validarRespuestaLlm(e, contexto()), 'E1', 'errores_ortografia[0].texto_error');
});

test('E1: tolera mayúsculas, espacios y comillas alrededor del fragmento', () => {
  const e = ejemplo();
  e.errores_ortografia[0].texto_error = '  "proceso de  CANCELACION" ';
  assert.equal(validarRespuestaLlm(e, contexto()).valido, true);
});

test('E1: no confunde una palabra con acento con la misma sin acento', () => {
  const mensajes = [
    { n: 1, emisor: 'cliente', texto: 'Hola' },
    { n: 2, emisor: 'agente', texto: 'Sí, claro.' },
  ];
  const e = ejemplo();
  e.errores_ortografia[0] = { mensaje_n: 2, texto_error: 'Si', correccion: 'Sí', gravedad: 'grave' };
  assertError(validarRespuestaLlm(e, contexto({ mensajes })), 'E1', 'errores_ortografia[0].texto_error');
});

test('E1: se puede desactivar con opciones', () => {
  const e = ejemplo();
  e.errores_ortografia[0].texto_error = 'aser';
  assert.equal(validarRespuestaLlm(e, contexto(), { verificar_texto_error: false }).valido, true);
});

// --- Varios errores, reintento y errores de programación -------------------------------------------

test('acumula varios errores en una sola pasada y no los repite', () => {
  const e = ejemplo();
  e.tema.valor = 'Facturación';
  e.criterios.empatia.cordialidad.resultado = 'no_aplica';
  e.errores_ortografia[0].mensaje_n = ULTIMO_N + 5;
  const r = validarRespuestaLlm(e, contexto());
  assert.equal(r.valido, false);
  assert.ok(r.errores.length >= 3);
  assert.equal(new Set(r.errores).size, r.errores.length);
  assert.equal(r.errores.length, r.detalle.length);
});

test('redactarMensajeReintento numera los errores y pide el JSON completo', () => {
  const e = ejemplo();
  e.tema.valor = 'Facturación';
  e.criterios.empatia.cordialidad.resultado = 'no_aplica';
  const texto = redactarMensajeReintento(validarRespuestaLlm(e, contexto()));
  assert.match(texto, /JSON COMPLETO/);
  assert.match(texto, /^1\. /m);
  assert.match(texto, /^2\. /m);
});

test('errores de programación se lanzan (no se reenvían al modelo)', () => {
  assert.throws(() => validarRespuestaLlm(ejemplo(), contexto({ termina_por_inactividad: undefined })), /booleano/);
  assert.throws(() => validarRespuestaLlm(ejemplo(), contexto({ esquema: null })), /esquema/);
  assert.throws(() => validarRespuestaLlm(ejemplo(), contexto({ mensajes: [] })), /mensajes/);
});

test('validarContraEsquema acepta null en tipos ["integer","null"] y aplica minimum solo a números', () => {
  const errores = [];
  validarContraEsquema(null, { type: ['integer', 'null'], minimum: 1 }, 'x', errores);
  assert.deepEqual(errores, []);
  validarContraEsquema(0, { type: ['integer', 'null'], minimum: 1 }, 'x', errores);
  assert.equal(errores.length, 1);
});

// --- Extracción del texto de la API Responses ---------------------------------------------------------

test('extraerTextoSalida toma output_text del único mensaje y detecta refusal', () => {
  const api = {
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] },
    ],
  };
  const x = extraerTextoSalida(api);
  assert.equal(x.texto, '{"a":1}');
  assert.equal(x.rechazo, false);
  assert.equal(x.estado, 'completed');
  assert.equal(x.falla_estructura, null);
  assert.deepEqual(x.estructura, {
    items_por_tipo: { reasoning: 1, message: 1 },
    mensajes: 1,
    partes_output_text: 1,
    fases: [],
    incompleto_por: null,
    anomalias: [],
    caracteres_ignorados: 0,
  });
  const neg = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] };
  assert.equal(extraerTextoSalida(neg).rechazo, true);
  const vacio = extraerTextoSalida(null);
  assert.equal(vacio.texto, '');
  assert.equal(vacio.rechazo, false);
  assert.equal(vacio.estado, null);
  assert.equal(vacio.estructura.mensajes, 0);
  assert.equal(vacio.falla_estructura, null, 'sin mensajes: texto vacío para JS-5, no falla estructural');
});

// --- Elección del mensaje POR TIPO (phase), no por posición ---------------------------------------
// Caso real del 24-oct-2026: gpt-6-luna mandó commentary + final_answer y al
// concatenarlos JS-5 rechazó por "texto después del objeto JSON".

const TEXTO_VALIDO = JSON.stringify(datos.cargarEjemploLlm());
const msj = (phase, texto) => {
  const m = { type: 'message', content: [{ type: 'output_text', text: texto }] };
  if (phase !== undefined) m.phase = phase;
  return m;
};
const COMENTARIO = 'Voy a revisar a [NOMBRE_1]: {"borrador":true} y luego respondo.';

test('fases commentary + final_answer: toma el final, es válido y registra la anomalía sin copiar texto', () => {
  const api = { status: 'completed', output: [msj('commentary', COMENTARIO), msj('final_answer', TEXTO_VALIDO)] };
  const x = extraerTextoSalida(api);
  assert.equal(x.falla_estructura, null);
  assert.equal(x.texto, TEXTO_VALIDO);
  assert.deepEqual(x.estructura.anomalias, ['fase_commentary_ignorada']);
  assert.deepEqual(x.estructura.fases, ['commentary', 'final_answer']);
  assert.equal(x.estructura.caracteres_ignorados, COMENTARIO.length);
  const forma = JSON.stringify(x.estructura);
  assert.ok(!forma.includes('NOMBRE') && !forma.includes('borrador'), 'la estructura no copia texto');
  const r = validarRespuestaLlm(x.texto, contexto());
  assert.equal(r.valido, true, r.errores.join(' | '));
  // El orden no importa: el final también se elige si llega primero.
  const alReves = extraerTextoSalida({ output: [msj('final_answer', TEXTO_VALIDO), msj('commentary', COMENTARIO)] });
  assert.equal(alReves.texto, TEXTO_VALIDO);
  assert.deepEqual(alReves.estructura.anomalias, ['fase_commentary_ignorada']);
});

test('dos mensajes final_answer: falla estructural, no elige ninguno y no copia texto', () => {
  const x = extraerTextoSalida({ status: 'completed', output: [msj('final_answer', TEXTO_VALIDO), msj('final_answer', COMENTARIO)] });
  assert.equal(x.texto, '');
  assert.equal(x.falla_estructura.causa, 'varios_final_answer');
  assert.match(x.falla_estructura.mensaje, /2 mensajes con fase final_answer/);
  assert.deepEqual(x.estructura.anomalias, ['varios_final_answer']);
  assert.equal(x.estructura.caracteres_ignorados, TEXTO_VALIDO.length + COMENTARIO.length);
  assert.ok(!JSON.stringify(x).includes('NOMBRE'), 'ni el mensaje ni la estructura copian texto');
});

test('final_answer con dos partes output_text: falla estructural (no concatena)', () => {
  const partes = [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }];
  const x = extraerTextoSalida({ output: [{ type: 'message', phase: 'final_answer', content: partes }] });
  assert.equal(x.texto, '');
  assert.equal(x.falla_estructura.causa, 'varias_partes_output_text');
  assert.match(x.falla_estructura.mensaje, /2 partes output_text/);
  // Lo mismo para un único mensaje sin fase.
  const sinFase = extraerTextoSalida({ output: [{ type: 'message', content: partes }] });
  assert.equal(sinFase.falla_estructura.causa, 'varias_partes_output_text');
});

test('sin fases con un solo mensaje: válido y sin anomalías', () => {
  const x = extraerTextoSalida({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, msj(undefined, TEXTO_VALIDO)] });
  assert.equal(x.falla_estructura, null);
  assert.equal(x.texto, TEXTO_VALIDO);
  assert.deepEqual(x.estructura.anomalias, []);
  assert.equal(validarRespuestaLlm(x.texto, contexto()).valido, true);
});

test('sin fases con dos mensajes: falla estructural', () => {
  const x = extraerTextoSalida({ output: [msj(undefined, COMENTARIO), msj(undefined, TEXTO_VALIDO)] });
  assert.equal(x.texto, '');
  assert.equal(x.falla_estructura.causa, 'varios_mensajes_sin_fase');
  assert.match(x.falla_estructura.mensaje, /2 mensajes sin fase/);
  assert.deepEqual(x.estructura.anomalias, ['varios_mensajes_sin_fase']);
});

test('solo commentary (ningún final_answer): falla estructural', () => {
  const x = extraerTextoSalida({ output: [msj('commentary', TEXTO_VALIDO)] });
  assert.equal(x.texto, '');
  assert.equal(x.falla_estructura.causa, 'sin_final_answer');
  assert.match(x.falla_estructura.mensaje, /ninguno con fase final_answer/);
  // Un mensaje sin fase junto a uno con fase distinta de final_answer también falla.
  assert.equal(extraerTextoSalida({ output: [msj(undefined, TEXTO_VALIDO), msj('commentary', COMENTARIO)] }).falla_estructura.causa, 'sin_final_answer');
});

test('final_answer junto a un mensaje sin fase: toma el final y registra mensaje_sin_fase_ignorado', () => {
  const x = extraerTextoSalida({ output: [msj(undefined, COMENTARIO), msj('final_answer', TEXTO_VALIDO)] });
  assert.equal(x.falla_estructura, null);
  assert.equal(x.texto, TEXTO_VALIDO);
  assert.deepEqual(x.estructura.anomalias, ['mensaje_sin_fase_ignorado']);
});

// --- Diagnóstico de respuestas que no parsean (regla 1 en la raíz) ---------------------------------

test('extraerTextoSalida describe la forma de la salida sin copiar texto (dos mensajes, fase, incompleta)', () => {
  const api = {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [
      { type: 'message', phase: 'commentary', content: [{ type: 'output_text', text: 'Texto con datos [NOMBRE_1]' }] },
      { type: 'message', phase: 'final_answer', content: [{ type: 'output_text', text: '{"a":1}' }] },
    ],
  };
  const { estructura } = extraerTextoSalida(api);
  assert.deepEqual(estructura, {
    items_por_tipo: { message: 2 },
    mensajes: 2,
    partes_output_text: 2,
    fases: ['commentary', 'final_answer'],
    incompleto_por: 'max_output_tokens',
    anomalias: ['fase_commentary_ignorada'],
    caracteres_ignorados: 'Texto con datos [NOMBRE_1]'.length,
  });
  assert.ok(!JSON.stringify(estructura).includes('NOMBRE'), 'la estructura no copia texto');
  // Una etiqueta que no parece etiqueta de API se reemplaza por "otro", también en la anomalía.
  assert.deepEqual(extraerTextoSalida({ output: [{ type: 'message', phase: 'Hola [NOMBRE_1]', content: [] }] }).estructura.fases, ['otro']);
  const rara = extraerTextoSalida({ output: [msj('Hola [NOMBRE_1]', 'x'), msj('final_answer', '{}')] });
  assert.deepEqual(rara.estructura.anomalias, ['fase_otro_ignorada']);
});

test('regla 1: el mensaje de raíz distingue la causa y nunca copia texto de la respuesta', () => {
  const casos = [
    ['', 'vacia', /llegó vacía/],
    ['sin llaves [NOMBRE_1]', 'sin_objeto', /ningún objeto JSON/],
    ['Aquí va: {"a":1}', 'texto_antes', /texto antes del objeto JSON/],
    ['{"a":1}{"a":1}', 'varios_objetos', /dos o más objetos JSON seguidos/],
    ['{"a":1} gracias [NOMBRE_1]', 'texto_despues', /texto después del objeto JSON/],
    ['{"tema": {"valor": "Canc', 'cortada', /incompleto/],
    ['{"a":1,}', 'sintaxis', /error de sintaxis/],
  ];
  for (const [texto, causa, patron] of casos) {
    assert.equal(diagnosticarTextoNoJson(texto).causa, causa, `causa de ${JSON.stringify(texto)}`);
    const r = validarRespuestaLlm(texto, contexto());
    assert.equal(r.valido, false);
    assert.equal(r.detalle.length, 1);
    assertError(r, '1', '(raíz)');
    assert.match(r.errores[0], /no es un JSON válido/);
    assert.match(r.errores[0], patron);
    assert.ok(!r.errores[0].includes('NOMBRE') && !r.errores[0].includes('Canc') && !r.errores[0].includes('Aquí'), 'no copia texto');
    assert.equal(mensajeRaizSinContenido(r.detalle[0]), r.errores[0]);
  }
});

test('regla 1: JSON que no es objeto dice qué tipo llegó', () => {
  const r = validarRespuestaLlm('[1,2]', contexto());
  assertError(r, '1', '(raíz)');
  assert.match(r.errores[0], /llegó lista/);
  assert.equal(mensajeRaizSinContenido(r.detalle[0]), r.errores[0]);
});

test('mensajeRaizSinContenido solo deja pasar los mensajes fijos de raíz', () => {
  assert.equal(mensajeRaizSinContenido({ regla: '1', ruta: '(raíz)', mensaje: '(raíz): el valor "Cancelación" no coincide con ninguna de las formas permitidas.' }), null);
  assert.equal(mensajeRaizSinContenido({ regla: '1', ruta: 'tema.valor', mensaje: 'La respuesta no es un JSON válido: llegó vacía (0 caracteres de texto).' }), null);
  assert.equal(mensajeRaizSinContenido({ regla: 'refusal', ruta: '(raíz)', mensaje: 'El modelo se negó a responder (refusal).' }), null);
  assert.equal(mensajeRaizSinContenido(null), null);
  // Un error real de esquema con datos (tema fuera del catálogo) nunca es "seguro".
  const e = ejemplo();
  e.tema.valor = 'Tema inventado';
  for (const d of validarRespuestaLlm(e, contexto()).detalle) assert.equal(mensajeRaizSinContenido(d), null);
});

// --- procesarRespuestaEvaluador: decisión completa de JS-5 (accion) ---------------------------
// Sin llamadas reales: respuestas de ejemplo con la forma de la API Responses,
// envueltas como las entrega el HTTP Request de n8n ({ statusCode, body }).

const { procesarRespuestaEvaluador } = require('../validador_llm.js');
const { extraerUsoOpenAI } = require('../costo.js');
const { prepararReintento, prepararReintentoIncompleta, agregarReintento } = require('../construccion_prompt.js');

const USO = { input_tokens: 9000, output_tokens: 1500 };
const http = (body) => ({ statusCode: 200, headers: {}, body });
const cuerpo = (output, extra = {}) => ({ status: 'completed', output, usage: USO, ...extra });
const CORTADA = () => cuerpo([msj(undefined, TEXTO_VALIDO.slice(0, 200))], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
const RECHAZO = () => cuerpo([{ type: 'message', content: [{ type: 'refusal', refusal: 'No puedo ayudar con [NOMBRE_1].' }] }]);
const CONFIG_JS5 = { reintentos_validacion_llm: 2, reintentos_respuesta_incompleta: 1 };
const itemEval = (extra = {}) => ({
  intentos_llm: 1,
  config: CONFIG_JS5,
  extraccion: { mensajes_enmascarados: CONVERSACION },
  catalogo: CATALOGO,
  payload: { tipo_interaccion: 'ce' },
  resultados_js: { variables: { termina_por_inactividad: false } },
  ...extra,
});
const procesar = (body, extra = {}, otros = {}) =>
  procesarRespuestaEvaluador({ respuestaHttp: http(body), item: itemEval(extra), esquema: ESQUEMA, base_conocimiento: BASE, extraerUso: extraerUsoOpenAI, ...otros });
const INVALIDA = (() => {
  const r = ejemplo();
  r.tema.valor = 'tema_que_no_existe';
  return JSON.stringify(r);
})();
const sinTextoEnLog = (r) => {
  const log = JSON.stringify(r.detalle_log);
  for (const t of ['NOMBRE', 'borrador', 'tema_que_no_existe', 'No puedo']) assert.ok(!log.includes(t), `detalle_log copia texto: ${t}`);
};

test('accion continuar: respuesta válida, uso acumulado, sin anomalía ni log', () => {
  const r = procesar(cuerpo([msj(undefined, TEXTO_VALIDO)]), { uso_llm: [{ tokens_entrada: 1, tokens_salida: 2 }] });
  assert.equal(r.accion, 'continuar');
  assert.equal(r.valido, true);
  assert.equal(r.falla_api, false);
  assert.deepEqual(r.respuesta_llm, JSON.parse(TEXTO_VALIDO));
  assert.equal(r.mensaje_reintento, null);
  assert.equal(r.detalle_log, null);
  assert.equal(r.anomalia, null);
  assert.deepEqual(r.anomalias_llm, []);
  assert.equal(r.intentos_llm, 1); // no lo cambia
  assert.equal(r.intentos_incompleta, 0);
  assert.deepEqual(r.uso_llm, [{ tokens_entrada: 1, tokens_salida: 2 }, { tokens_entrada: 9000, tokens_salida: 1500 }]);
});

test('accion continuar con commentary ignorado: toma el final_answer y no es anomalía contable', () => {
  const r = procesar(cuerpo([msj('commentary', COMENTARIO), msj('final_answer', TEXTO_VALIDO)]));
  assert.equal(r.accion, 'continuar');
  assert.deepEqual(r.estructura_salida_llm.anomalias, ['fase_commentary_ignorada']);
  assert.ok(!JSON.stringify(r.estructura_salida_llm).includes('borrador'));
  assert.equal(r.anomalia, null);
  assert.deepEqual(r.uso_llm, [{ tokens_entrada: 9000, tokens_salida: 1500 }]); // uso_llm ausente -> arreglo nuevo
});

test('accion reintentar_validacion: inválida con intentos de validación <= reintentos_validacion_llm', () => {
  for (const intentos of [1, 2]) {
    const r = procesar(cuerpo([msj(undefined, INVALIDA)]), { intentos_llm: intentos });
    assert.equal(r.accion, 'reintentar_validacion');
    assert.equal(r.valido, false);
    assert.equal(r.falla_api, false);
    assert.match(r.mensaje_reintento, /^Tu respuesta anterior no pasó la validación/);
    assert.equal(r.texto_respuesta_llm, INVALIDA); // para el turno assistant del reintento
    assert.ok(r.errores_validacion.length > 0);
    assert.equal(r.detalle_log, null);
  }
  // El reintento inmediato por incompleta no consume reintentos de validación:
  // intentos_llm 3 con 1 incompleta = 2 de validación -> todavía reintenta.
  assert.equal(procesar(cuerpo([msj(undefined, INVALIDA)]), { intentos_llm: 3, intentos_incompleta: 1 }).accion, 'reintentar_validacion');
});

test('accion respuesta_llm_invalida por validación agotada: log sin texto', () => {
  const r = procesar(cuerpo([msj(undefined, INVALIDA)]), { intentos_llm: 3 });
  assert.equal(r.accion, 'respuesta_llm_invalida');
  assert.equal(r.mensaje_reintento, null);
  assert.equal(r.detalle_log.tipo_error, 'respuesta_llm_invalida');
  assert.equal(r.detalle_log.causa, 'validacion_agotada');
  assert.equal(r.detalle_log.intentos_llm, 3);
  assert.ok(r.detalle_log.reglas.length > 0);
  assert.ok(r.detalle_log.reglas.every((x) => Object.keys(x).join() === 'regla,ruta'));
  sinTextoEnLog(r);
  // Con reintentos_validacion_llm = 0 (texto de Sheets "0") el primer intento inválido ya agota.
  const cero = procesar(cuerpo([msj(undefined, INVALIDA)]), { config: { ...CONFIG_JS5, reintentos_validacion_llm: '0' } });
  assert.equal(cero.accion, 'respuesta_llm_invalida');
});

test('accion rechazo_llm: refusal -> error con revisión manual, anomalía contable y log sin texto', () => {
  const r = procesar(RECHAZO());
  assert.equal(r.accion, 'rechazo_llm');
  assert.equal(r.falla_api, false);
  assert.equal(r.valido, false);
  assert.equal(r.mensaje_reintento, null);
  assert.equal(r.texto_respuesta_llm, null);
  assert.equal(r.anomalia, 'refusal');
  assert.deepEqual(r.anomalias_llm, ['refusal']);
  assert.equal(r.detalle_log.tipo_error, 'respuesta_llm_invalida');
  assert.equal(r.detalle_log.causa, 'refusal');
  assert.deepEqual(r.detalle_log.anomalias, ['refusal']);
  assert.equal(r.uso_llm.length, 1); // la llamada se cobra igual
  sinTextoEnLog(r);
  // Refusal junto a un JSON válido: gana el rechazo (no se valida).
  const mixto = cuerpo([{ type: 'message', content: [{ type: 'output_text', text: TEXTO_VALIDO }, { type: 'refusal', refusal: 'No.' }] }]);
  assert.equal(procesar(mixto).accion, 'rechazo_llm');
});

test('accion reintentar_incompleta: primer corte -> misma petición, contador propio y anomalía', () => {
  const r = procesar(CORTADA());
  assert.equal(r.accion, 'reintentar_incompleta');
  assert.equal(r.mensaje_reintento, null); // sin mensaje de error explicado
  assert.equal(r.texto_respuesta_llm, null);
  assert.equal(r.detalle_log, null);
  assert.equal(r.anomalia, 'incompleta');
  assert.deepEqual(r.anomalias_llm, ['incompleta']);
  assert.equal(r.estructura_salida_llm.incompleto_por, 'max_output_tokens');
});

test('incompleta -> reintento inmediato -> completa: continuar y la anomalía queda contada', () => {
  const peticion = { model: 'gpt-6-luna', input: [{ role: 'user', content: 'conversación' }] };
  const r1 = procesar(CORTADA());
  const item2 = { ...itemEval(), ...r1, peticion_openai: peticion };
  const p = prepararReintentoIncompleta(item2);
  assert.deepEqual(p.peticion_openai, peticion); // la MISMA petición
  assert.notEqual(p.peticion_openai, peticion); // copia
  assert.equal(p.intentos_llm, 2);
  assert.equal(p.intentos_incompleta, 1);
  const r2 = procesar(cuerpo([msj(undefined, TEXTO_VALIDO)]), { ...item2, ...p });
  assert.equal(r2.accion, 'continuar');
  assert.equal(r2.anomalia, null);
  assert.deepEqual(r2.anomalias_llm, ['incompleta']); // el corte recuperado se cuenta
  assert.equal(r2.intentos_llm, 2);
  assert.equal(r2.uso_llm.length, 2);
});

test('incompleta -> reintento inmediato -> incompleta: respuesta_llm_invalida con causa incompleta', () => {
  const peticion = { model: 'gpt-6-luna', input: [{ role: 'user', content: 'conversación' }] };
  const r1 = procesar(CORTADA());
  const item2 = { ...itemEval(), ...r1, peticion_openai: peticion };
  const r2 = procesar(CORTADA(), { ...item2, ...prepararReintentoIncompleta(item2) });
  assert.equal(r2.accion, 'respuesta_llm_invalida');
  assert.equal(r2.falla_api, false);
  assert.equal(r2.detalle_log.tipo_error, 'respuesta_llm_invalida');
  assert.equal(r2.detalle_log.causa, 'incompleta');
  assert.deepEqual(r2.detalle_log.anomalias, ['incompleta', 'incompleta']);
  assert.equal(r2.detalle_log.intentos_llm, 2);
  sinTextoEnLog(r2);
  // Con reintentos_respuesta_incompleta = 0 el primer corte ya agota.
  assert.equal(procesar(CORTADA(), { config: { ...CONFIG_JS5, reintentos_respuesta_incompleta: 0 } }).accion, 'respuesta_llm_invalida');
});

test('accion falla_api: salida ambigua o cuerpo ilegible (antes que valido)', () => {
  const r = procesar(cuerpo([msj('final_answer', TEXTO_VALIDO), msj('final_answer', COMENTARIO)]));
  assert.equal(r.accion, 'falla_api');
  assert.equal(r.falla_api, true);
  assert.equal(r.detalle_log.tipo_error, 'fallo_api');
  assert.equal(r.detalle_log.causa, 'varios_final_answer');
  assert.equal(r.anomalia, null);
  sinTextoEnLog(r);
  for (const malo of ['esto no es JSON', null, [1, 2]]) {
    const x = procesar(malo);
    assert.equal(x.accion, 'falla_api');
    assert.equal(x.detalle_log.causa, 'cuerpo_invalido');
    assert.deepEqual(x.uso_llm, [{ tokens_entrada: 0, tokens_salida: 0 }]);
  }
  // Cuerpo como texto JSON (n8n sin parsear) y cuerpo directo sin envoltorio se leen igual.
  assert.equal(procesar(JSON.stringify(cuerpo([msj(undefined, TEXTO_VALIDO)]))).accion, 'continuar');
  const directo = procesarRespuestaEvaluador({ respuestaHttp: cuerpo([msj(undefined, TEXTO_VALIDO)]), item: itemEval(), esquema: ESQUEMA, base_conocimiento: BASE, extraerUso: extraerUsoOpenAI });
  assert.equal(directo.accion, 'continuar');
});

test('sin mensajes con status completed se reintenta por validación; sin status no es incompleta', () => {
  assert.equal(procesar(cuerpo([{ type: 'reasoning', summary: [] }])).accion, 'reintentar_validacion');
  const sinStatus = cuerpo([msj(undefined, TEXTO_VALIDO)]);
  delete sinStatus.status;
  assert.equal(procesar(sinStatus).accion, 'continuar');
});

test('procesarRespuestaEvaluador lanza ante errores de armado del flujo', () => {
  const body = cuerpo([msj(undefined, TEXTO_VALIDO)]);
  assert.throws(() => procesar(body, {}, { extraerUso: undefined }), /extraerUso/);
  assert.throws(() => procesar(body, { intentos_llm: 0 }), /intentos_llm/);
  assert.throws(() => procesar(body, { intentos_llm: [] }), /intentos_llm/);
  assert.throws(() => procesar(body, { intentos_incompleta: 1 }), /intentos_incompleta/); // no puede igualar intentos_llm
  assert.throws(() => procesar(body, { uso_llm: {} }), /uso_llm/);
  assert.throws(() => procesar(body, { anomalias_llm: 'x' }), /anomalias_llm/);
  assert.throws(() => procesar(body, { config: { ...CONFIG_JS5, reintentos_validacion_llm: 'dos' } }), /reintentos_validacion_llm/);
  assert.throws(() => procesar(body, { config: { reintentos_validacion_llm: 2 } }), /config\.reintentos_respuesta_incompleta/);
  assert.throws(() => procesar(body, { config: undefined }), /config/);
  // config explícita tiene precedencia sobre item.config.
  const r = procesar(cuerpo([msj(undefined, INVALIDA)]), {}, { config: { ...CONFIG_JS5, reintentos_validacion_llm: 0 } });
  assert.equal(r.accion, 'respuesta_llm_invalida');
});

test('prepararReintento agrega los turnos y sube intentos_llm en 1', () => {
  const peticion = { model: 'gpt-6-luna', input: [{ role: 'user', content: 'conversación' }] };
  const r = procesar(cuerpo([msj(undefined, INVALIDA)]));
  const item = { ...itemEval(), ...r, peticion_openai: peticion };
  const p = prepararReintento(item);
  assert.equal(p.intentos_llm, 2);
  assert.deepEqual(p.peticion_openai, agregarReintento(peticion, INVALIDA, r.mensaje_reintento));
  assert.equal(peticion.input.length, 1); // no modifica la original
  assert.throws(() => prepararReintento({ ...item, mensaje_reintento: null }), /mensaje_reintento/);
  assert.throws(() => prepararReintento({ ...item, intentos_llm: undefined }), /intentos_llm/);
  assert.throws(() => prepararReintentoIncompleta({ ...item, intentos_incompleta: -1 }), /intentos_incompleta/);
});

test('datos/config.csv trae reintentos_respuesta_incompleta = 1 (entero, ámbito todos)', (t) => {
  const { configCE } = require('./ayudas.js');
  const c = configCE();
  if (!('reintentos_respuesta_incompleta' in c)) {
    t.skip('la clave todavía no está en datos/config.csv (la agrega contrato-datos)');
    return;
  }
  assert.strictEqual(c.reintentos_respuesta_incompleta, 1);
  // Con la config real: un corte reintenta y el segundo agota.
  const r1 = procesar(CORTADA(), { config: c });
  assert.equal(r1.accion, 'reintentar_incompleta');
  assert.equal(procesar(CORTADA(), { config: c, intentos_llm: 2, intentos_incompleta: 1 }).accion, 'respuesta_llm_invalida');
});
