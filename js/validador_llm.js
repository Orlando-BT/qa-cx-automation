// =============================================================================
// validador_llm.js  (JS-5 del Workflow 2: Evaluación)
// -----------------------------------------------------------------------------
// Dueño: subagente evaluador-llm.
//
// Qué hace: revisa la respuesta del evaluador (OpenAI) ANTES de que JS la use.
// Aplica todas las reglas de contrato/rubrica.md, sección 6.1:
//   1. Estructura (llm_output.schema.json), tema dentro del catálogo y
//      artículos dentro de la base de conocimiento.
//   2. Números de mensaje existentes y del emisor correcto.
//   3. no_aplica prohibido donde la rúbrica dice "Nunca".
//   4. no_aplica de empatía solo con emoción neutral.
//   5. no_aplica de recapitula solo si termina_por_inactividad = true.
//   6. y 7. Coherencia de solicitudes detectadas y atendidas.
//   8. atendida <-> mensajes_atencion.
//   9. Evidencia de criterios (mensajes y justificación).
//  10. Evidencia de críticos.
// Más una extensión del mandato de evaluador-llm ("cada evidencia citada existe
// en la conversación"):
//  E1. Cada texto_error de errores_ortografia aparece en el mensaje citado.
//
// Devuelve { valido, errores[], detalle[] }:
//   - errores: textos en español, listos para reenviarse al modelo;
//   - detalle: los mismos errores con { regla, ruta, mensaje } para log_errores.
// Si valido = false, W2 reenvía la petición con redactarMensajeReintento()
// (máximo config.reintentos_validacion_llm reenvíos); si sigue fallando,
// log_errores con tipo_error = respuesta_llm_invalida y alerta operativa.
// Antes de validar, extraerTextoSalida() elige el mensaje final POR TIPO
// (phase = final_answer). Si la salida de la API es ambigua (falla_estructura),
// no se valida ni se reintenta: log_errores con tipo_error = fallo_api.
//
// Funciones puras: no leen archivos ni llaman APIs.
// =============================================================================

'use strict';

// -----------------------------------------------------------------------------
// 1. Definición de la rúbrica CE v1 que usa JS-5
// -----------------------------------------------------------------------------
// Son datos de la rúbrica (rubrica.md 3.2 a 3.6 y 6.1), no umbrales: por eso no
// viven en config. Una rúbrica nueva (Sales) pasaría su propia definición en
// contexto.definicion sin cambiar el código.
const DEFINICION_RUBRICA_CE_V1 = {
  // Regla 3: criterios cuya columna "no_aplica cuando" dice "Nunca".
  no_aplica_prohibido: [
    'empatia.cordialidad',
    'empatia.lenguaje_acorde',
    'diagnostico.solicitudes_detectadas',
    'diagnostico.solicitudes_atendidas',
    'solucion.informacion_correcta',
    'solucion.informacion_completa',
    'solucion.apego_proceso',
    'comunicacion.redaccion',
    'comunicacion.congruencia',
  ],
  // Regla 4: no_aplica permitido solo con emocion_cliente.emocion = neutral.
  no_aplica_solo_neutral: ['empatia.identifica_emocion', 'empatia.muestra_empatia'],
  emocion_neutral: 'neutral',
  // Regla 5: no_aplica permitido solo con termina_por_inactividad = true.
  no_aplica_solo_inactividad: ['recapitulacion.recapitula'],
  // Reglas 6 y 7.
  criterio_detectadas: 'diagnostico.solicitudes_detectadas',
  criterio_atendidas: 'diagnostico.solicitudes_atendidas',
};

// -----------------------------------------------------------------------------
// 2. Utilidades
// -----------------------------------------------------------------------------
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const textoNoVacio = (x) => typeof x === 'string' && x.trim() !== '';

// Tipo JSON de un valor, con la distinción integer/number de JSON Schema.
function tipoJson(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // string, boolean, object
}

const NOMBRE_TIPO = {
  string: 'texto',
  integer: 'entero',
  number: 'número',
  boolean: 'booleano (true/false)',
  object: 'objeto',
  array: 'lista',
  null: 'null',
};

// Agrega un error al resultado. Cada error lleva la regla de rubrica.md 6.1
// para que el dueño pueda rastrearlo y el modelo entienda qué corregir.
function agregar(lista, regla, ruta, mensaje) {
  lista.push({ regla, ruta, mensaje });
}

// -----------------------------------------------------------------------------
// 3. Regla 1a: validación contra el esquema (subconjunto de JSON Schema)
// -----------------------------------------------------------------------------
// Implementa solo las palabras clave que usa llm_output.schema.json: type,
// enum, const, required, properties, additionalProperties (false), items,
// minItems, minimum y pattern (más anyOf, que usa el esquema del generador). Se valida SIEMPRE contra el esquema original
// del contrato, aunque JS-4 haya quitado claves antes de enviarlo a OpenAI.
function validarContraEsquema(valor, esquema, ruta, errores) {
  if (!esObjeto(esquema)) return;
  const donde = ruta || '(raíz)';

  // anyOf: válido si cumple al menos una de las formas (lo usa, por ejemplo,
  // prompts/generador_payload_salida.schema.json para numero_caso texto o null).
  if (Array.isArray(esquema.anyOf)) {
    const cumpleAlguna = esquema.anyOf.some((sub) => {
      const prueba = [];
      validarContraEsquema(valor, sub, ruta, prueba);
      return prueba.length === 0;
    });
    if (!cumpleAlguna) {
      agregar(errores, '1', donde, `${donde}: el valor ${JSON.stringify(valor)} no coincide con ninguna de las formas permitidas.`);
    }
  }

  if (esquema.type !== undefined) {
    const permitidos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
    const t = tipoJson(valor);
    const ok = permitidos.includes(t) || (t === 'integer' && permitidos.includes('number'));
    if (!ok) {
      const esperado = permitidos.map((p) => NOMBRE_TIPO[p] || p).join(' o ');
      agregar(errores, '1', donde, `${donde}: debe ser ${esperado}, pero llegó ${NOMBRE_TIPO[t] || t}.`);
      return; // sin el tipo correcto, el resto de las comprobaciones no tiene sentido
    }
  }

  if (esquema.enum && !esquema.enum.some((e) => e === valor)) {
    agregar(errores, '1', donde, `${donde}: el valor ${JSON.stringify(valor)} no está permitido. Valores permitidos: ${esquema.enum.map((e) => JSON.stringify(e)).join(', ')}.`);
  }
  if (esquema.const !== undefined && esquema.const !== valor) {
    agregar(errores, '1', donde, `${donde}: debe ser exactamente ${JSON.stringify(esquema.const)}.`);
  }
  if (typeof valor === 'number' && typeof esquema.minimum === 'number' && valor < esquema.minimum) {
    agregar(errores, '1', donde, `${donde}: debe ser mayor o igual que ${esquema.minimum}; llegó ${valor}.`);
  }
  if (typeof valor === 'string' && typeof esquema.pattern === 'string' && !new RegExp(esquema.pattern).test(valor)) {
    agregar(errores, '1', donde, `${donde}: ${JSON.stringify(valor)} no tiene el formato requerido (${esquema.pattern}).`);
  }

  if (Array.isArray(valor)) {
    if (typeof esquema.minItems === 'number' && valor.length < esquema.minItems) {
      agregar(errores, '1', donde, `${donde}: debe tener al menos ${esquema.minItems} elemento(s).`);
    }
    if (esObjeto(esquema.items)) {
      valor.forEach((el, i) => validarContraEsquema(el, esquema.items, `${ruta}[${i}]`, errores));
    }
  }

  if (esObjeto(valor)) {
    const props = esquema.properties || {};
    for (const req of esquema.required || []) {
      if (!(req in valor)) {
        agregar(errores, '1', ruta ? `${ruta}.${req}` : req, `${ruta ? `${ruta}.${req}` : req}: falta este campo obligatorio.`);
      }
    }
    for (const [clave, sub] of Object.entries(valor)) {
      const r = ruta ? `${ruta}.${clave}` : clave;
      if (props[clave]) {
        validarContraEsquema(sub, props[clave], r, errores);
      } else if (esquema.additionalProperties === false) {
        agregar(errores, '1', r, `${r}: este campo no existe en el esquema; quítalo.`);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// 4. Recolección de números de mensaje citados
// -----------------------------------------------------------------------------
// Devuelve [{ ruta, n, emisorRequerido }] con cada número citado en la
// respuesta. emisorRequerido es 'agente', 'cliente' o null (cualquiera),
// según rubrica.md 6.1 regla 2.
function recolectarCitas(r) {
  const citas = [];
  const lista = (arr, ruta, emisor) => {
    if (Array.isArray(arr)) arr.forEach((n, i) => citas.push({ ruta: `${ruta}[${i}]`, n, emisorRequerido: emisor }));
  };

  if (esObjeto(r.tema)) lista(r.tema.mensajes, 'tema.mensajes', null);
  if (esObjeto(r.emocion_cliente)) lista(r.emocion_cliente.mensajes, 'emocion_cliente.mensajes', null);

  if (esObjeto(r.criterios)) {
    for (const [seccion, subs] of Object.entries(r.criterios)) {
      if (!esObjeto(subs)) continue;
      for (const [sub, c] of Object.entries(subs)) {
        if (esObjeto(c)) lista(c.mensajes, `criterios.${seccion}.${sub}.mensajes`, null);
      }
    }
  }

  if (esObjeto(r.insumos_hibridos)) {
    for (const [nombre, ins] of Object.entries(r.insumos_hibridos)) {
      if (esObjeto(ins)) lista(ins.mensajes, `insumos_hibridos.${nombre}.mensajes`, null);
    }
  }

  if (Array.isArray(r.errores_ortografia)) {
    r.errores_ortografia.forEach((e, i) => {
      if (esObjeto(e)) citas.push({ ruta: `errores_ortografia[${i}].mensaje_n`, n: e.mensaje_n, emisorRequerido: 'agente' });
    });
  }

  if (esObjeto(r.primer_mensaje_info_cuenta) && r.primer_mensaje_info_cuenta.mensaje_n !== null && r.primer_mensaje_info_cuenta.mensaje_n !== undefined) {
    citas.push({ ruta: 'primer_mensaje_info_cuenta.mensaje_n', n: r.primer_mensaje_info_cuenta.mensaje_n, emisorRequerido: 'agente' });
  }

  if (Array.isArray(r.solicitudes_cliente)) {
    r.solicitudes_cliente.forEach((s, i) => {
      if (!esObjeto(s)) return;
      citas.push({ ruta: `solicitudes_cliente[${i}].mensaje_n`, n: s.mensaje_n, emisorRequerido: 'cliente' });
      lista(s.mensajes_atencion, `solicitudes_cliente[${i}].mensajes_atencion`, 'agente');
    });
  }

  if (Array.isArray(r.articulos_base_usados)) {
    r.articulos_base_usados.forEach((a, i) => {
      if (esObjeto(a)) lista(a.mensajes, `articulos_base_usados[${i}].mensajes`, null);
    });
  }

  if (esObjeto(r.criticos_posibles)) {
    for (const [nombre, c] of Object.entries(r.criticos_posibles)) {
      if (esObjeto(c)) lista(c.mensajes, `criticos_posibles.${nombre}.mensajes`, 'agente');
    }
  }
  return citas;
}

// Normalización para comparar texto_error con el mensaje (regla E1): minúsculas
// y espacios colapsados. NO quita acentos: el acento es justamente el error.
function normalizarParaBusqueda(t) {
  return String(t).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Quita comillas y puntuación que el modelo pueda agregar alrededor del fragmento.
function recortarFragmento(t) {
  return String(t).replace(/^[\s"'“”‘’«».,;:]+|[\s"'“”‘’«».,;:]+$/g, '');
}

// -----------------------------------------------------------------------------
// 4b. Diagnóstico de una respuesta que no parsea como JSON (regla 1, raíz)
// -----------------------------------------------------------------------------
// Con salida estructurada estricta la API debería entregar siempre un objeto
// JSON. Si aun así JSON.parse falla, la causa importa: no es lo mismo una
// respuesta vacía que dos objetos pegados o una respuesta cortada. Este
// diagnóstico solo mide FORMA (posiciones, longitudes, cuántos objetos): los
// mensajes nunca copian texto de la respuesta ni de la conversación, así que
// se pueden guardar en log_errores y en el resumen agregado del modo lote.
//
// Devuelve { causa, mensaje }. causa es uno de:
//   vacia | sin_objeto | texto_antes | varios_objetos | texto_despues | cortada | sintaxis
const CIERRE_REINTENTO = 'Responde solo con UN objeto JSON completo del esquema, sin texto antes ni después.';
const PLANTILLAS_NO_JSON = {
  vacia: () => `La respuesta no es un JSON válido: llegó vacía (0 caracteres de texto). ${CIERRE_REINTENTO}`,
  sin_objeto: (l) => `La respuesta no es un JSON válido: no contiene ningún objeto JSON (${l} caracteres de texto). ${CIERRE_REINTENTO}`,
  texto_antes: (l, p) => `La respuesta no es un JSON válido: hay texto antes del objeto JSON (el objeto empieza en la posición ${p} de ${l}). ${CIERRE_REINTENTO}`,
  varios_objetos: (l, p) => `La respuesta no es un JSON válido: llegaron dos o más objetos JSON seguidos (el primero termina en la posición ${p} de ${l}). ${CIERRE_REINTENTO}`,
  texto_despues: (l, p) => `La respuesta no es un JSON válido: hay texto después del objeto JSON (el objeto termina en la posición ${p} de ${l}). ${CIERRE_REINTENTO}`,
  cortada: (l) => `La respuesta no es un JSON válido: el objeto JSON está incompleto, se corta antes de cerrarse (${l} caracteres). ${CIERRE_REINTENTO}`,
  sintaxis: (l) => `La respuesta no es un JSON válido: tiene un error de sintaxis JSON (${l} caracteres). ${CIERRE_REINTENTO}`,
};

// Posición (índice exclusivo) donde termina el primer valor JSON que empieza en
// "inicio" con "{" o "[", respetando cadenas y escapes. -1 si no se cierra.
function finDelPrimerValor(t, inicio) {
  let profundidad = 0;
  let enCadena = false;
  for (let i = inicio; i < t.length; i++) {
    const ch = t[i];
    if (enCadena) {
      if (ch === '\\') i++;
      else if (ch === '"') enCadena = false;
      continue;
    }
    if (ch === '"') enCadena = true;
    else if (ch === '{' || ch === '[') profundidad++;
    else if (ch === '}' || ch === ']') {
      profundidad--;
      if (profundidad === 0) return i + 1;
    }
  }
  return -1;
}

function diagnosticarTextoNoJson(texto) {
  const t = String(texto ?? '');
  const l = t.length;
  if (t.trim() === '') return { causa: 'vacia', mensaje: PLANTILLAS_NO_JSON.vacia() };
  const inicio = t.indexOf('{');
  if (inicio === -1) return { causa: 'sin_objeto', mensaje: PLANTILLAS_NO_JSON.sin_objeto(l) };
  if (t.slice(0, inicio).trim() !== '') return { causa: 'texto_antes', mensaje: PLANTILLAS_NO_JSON.texto_antes(l, inicio) };
  const fin = finDelPrimerValor(t, inicio);
  if (fin === -1) return { causa: 'cortada', mensaje: PLANTILLAS_NO_JSON.cortada(l) };
  const resto = t.slice(fin).trim();
  if (resto !== '') {
    const causa = resto.startsWith('{') ? 'varios_objetos' : 'texto_despues';
    return { causa, mensaje: PLANTILLAS_NO_JSON[causa](l, fin) };
  }
  return { causa: 'sintaxis', mensaje: PLANTILLAS_NO_JSON.sintaxis(l) };
}

function mensajeNoObjeto(tipo) {
  return `La respuesta debe ser un objeto JSON con los campos del esquema; llegó ${NOMBRE_TIPO[tipo] || 'otro tipo'}.`;
}

// ¿El error es uno de los mensajes FIJOS de raíz (sin texto de la respuesta ni
// de la conversación)? Devuelve el mensaje si lo es, o null. Se compara contra
// las plantillas con los números reemplazados por "#": cualquier otro texto
// (aunque tenga regla 1 y ruta raíz) devuelve null. Lo usa el modo lote de
// prompts/verificacion/verificar_openai.mjs para guardar solo errores seguros.
const MENSAJES_RAIZ_SEGUROS = new Set(
  [
    ...Object.values(PLANTILLAS_NO_JSON).map((f) => f(0, 0)),
    ...Object.keys(NOMBRE_TIPO).map((k) => mensajeNoObjeto(k)),
    mensajeNoObjeto('?'),
  ].map((m) => m.replace(/\d+/g, '#'))
);
function mensajeRaizSinContenido(d) {
  if (!d || d.regla !== '1' || d.ruta !== '(raíz)' || typeof d.mensaje !== 'string') return null;
  return MENSAJES_RAIZ_SEGUROS.has(d.mensaje.replace(/\d+/g, '#')) ? d.mensaje : null;
}

// -----------------------------------------------------------------------------
// 5. Validación completa
// -----------------------------------------------------------------------------
// respuesta: objeto ya parseado o el texto JSON tal como lo devolvió el modelo.
// contexto = {
//   esquema,                 // contrato/llm_output.schema.json ORIGINAL (objeto)
//   mensajes,                // [{ n, emisor, texto }] (texto enmascarado de JS-2)
//   catalogo_temas,          // filas de la hoja catalogo_temas
//   base_conocimiento,       // filas de la hoja base_conocimiento
//   tipo_interaccion,        // "ce"
//   termina_por_inactividad, // booleano calculado por JS
//   definicion,              // opcional; por defecto DEFINICION_RUBRICA_CE_V1
// }
// opciones = { verificar_texto_error: true }
function validarRespuestaLlm(respuesta, contexto, opciones = {}) {
  const verificarTextoError = opciones.verificar_texto_error !== false;
  const def = contexto.definicion || DEFINICION_RUBRICA_CE_V1;

  // Errores de programación (no del modelo): se lanzan, no se reenvían al LLM.
  if (typeof contexto.termina_por_inactividad !== 'boolean') {
    throw new Error('contexto.termina_por_inactividad debe ser booleano.');
  }
  if (!esObjeto(contexto.esquema)) throw new Error('contexto.esquema es obligatorio.');
  if (!Array.isArray(contexto.mensajes) || contexto.mensajes.length === 0) throw new Error('contexto.mensajes es obligatorio.');

  const detalle = [];

  // --- Parseo -----------------------------------------------------------------
  let r = respuesta;
  if (typeof respuesta === 'string') {
    try {
      r = JSON.parse(respuesta);
    } catch (e) {
      // El mensaje dice POR QUÉ no parsea (vacía, texto antes o después, dos
      // objetos seguidos, cortada o sintaxis) solo con posiciones y longitudes:
      // nunca copia texto de la respuesta (ver diagnosticarTextoNoJson).
      agregar(detalle, '1', '(raíz)', diagnosticarTextoNoJson(respuesta).mensaje);
      return cerrar(detalle);
    }
  }
  if (!esObjeto(r)) {
    agregar(detalle, '1', '(raíz)', mensajeNoObjeto(tipoJson(r)));
    return cerrar(detalle);
  }

  // --- Regla 1: estructura, catálogo y base -------------------------------------
  validarContraEsquema(r, contexto.esquema, '', detalle);

  const tipo = contexto.tipo_interaccion;
  const delTipo = (f) => f && (f.tipo_interaccion === tipo || f.tipo_interaccion === 'todos');
  const temasValidos = new Set(
    (contexto.catalogo_temas || []).filter((f) => delTipo(f) && (f.activo === 'si' || f.activo === true)).map((f) => f.tema)
  );
  const articulosValidos = new Set((contexto.base_conocimiento || []).filter(delTipo).map((f) => f.id_articulo));

  if (esObjeto(r.tema) && typeof r.tema.valor === 'string' && !temasValidos.has(r.tema.valor)) {
    agregar(
      detalle,
      '1',
      'tema.valor',
      `tema.valor: "${r.tema.valor}" no está en el catálogo. Copia exactamente uno de estos temas: ${[...temasValidos].map((t) => `"${t}"`).join(', ')}.`
    );
  }
  if (Array.isArray(r.articulos_base_usados)) {
    r.articulos_base_usados.forEach((a, i) => {
      if (esObjeto(a) && typeof a.id_articulo === 'string' && !articulosValidos.has(a.id_articulo)) {
        agregar(
          detalle,
          '1',
          `articulos_base_usados[${i}].id_articulo`,
          `articulos_base_usados[${i}].id_articulo: "${a.id_articulo}" no existe en la base de conocimiento. Artículos válidos: ${[...articulosValidos].sort().join(', ')}.`
        );
      }
    });
  }

  // --- Regla 2: números de mensaje ---------------------------------------------
  const emisorPorN = new Map(contexto.mensajes.map((m) => [m.n, m.emisor]));
  const maxN = Math.max(...contexto.mensajes.map((m) => m.n));
  for (const c of recolectarCitas(r)) {
    if (!Number.isInteger(c.n)) continue; // el error de tipo ya lo reportó la regla 1
    if (c.n < 1) {
      agregar(detalle, '2', c.ruta, `${c.ruta}: el número de mensaje ${c.n} no es válido; los mensajes empiezan en 1.`);
      continue;
    }
    if (!emisorPorN.has(c.n)) {
      agregar(detalle, '2', c.ruta, `${c.ruta}: el mensaje ${c.n} no existe. La conversación tiene mensajes del 1 al ${maxN}.`);
      continue;
    }
    if (c.emisorRequerido && emisorPorN.get(c.n) !== c.emisorRequerido) {
      agregar(
        detalle,
        '2',
        c.ruta,
        `${c.ruta}: el mensaje ${c.n} es del ${emisorPorN.get(c.n)}, pero aquí solo se aceptan mensajes del ${c.emisorRequerido}.`
      );
    }
  }

  // --- Reglas 3, 4, 5 y 9: criterios -------------------------------------------
  const criterio = (id) => {
    const [seccion, sub] = id.split('.');
    return esObjeto(r.criterios) && esObjeto(r.criterios[seccion]) && esObjeto(r.criterios[seccion][sub]) ? r.criterios[seccion][sub] : null;
  };
  const emocion = esObjeto(r.emocion_cliente) ? r.emocion_cliente.emocion : undefined;

  for (const id of def.no_aplica_prohibido) {
    const c = criterio(id);
    if (c && c.resultado === 'no_aplica') {
      agregar(detalle, '3', `criterios.${id}.resultado`, `criterios.${id}.resultado: este criterio nunca puede ser "no_aplica"; responde "cumple" o "no_cumple" con su evidencia.`);
    }
  }
  for (const id of def.no_aplica_solo_neutral) {
    const c = criterio(id);
    if (c && c.resultado === 'no_aplica' && emocion !== def.emocion_neutral) {
      agregar(
        detalle,
        '4',
        `criterios.${id}.resultado`,
        `criterios.${id}.resultado: "no_aplica" solo se permite si emocion_cliente.emocion es "${def.emocion_neutral}", y reportaste "${emocion}". Responde "cumple" o "no_cumple", o corrige la emoción si el cliente realmente es neutral.`
      );
    }
  }
  for (const id of def.no_aplica_solo_inactividad) {
    const c = criterio(id);
    if (c && c.resultado === 'no_aplica' && contexto.termina_por_inactividad === false) {
      agregar(
        detalle,
        '5',
        `criterios.${id}.resultado`,
        `criterios.${id}.resultado: la conversación NO termina por inactividad del cliente (TERMINA_POR_INACTIVIDAD = false), así que "no_aplica" no está permitido. Responde "cumple" o "no_cumple"; si el agente no recapituló, usa "no_cumple" y cita los últimos mensajes del agente.`
      );
    }
  }
  if (esObjeto(r.criterios)) {
    for (const [seccion, subs] of Object.entries(r.criterios)) {
      if (!esObjeto(subs)) continue;
      for (const [sub, c] of Object.entries(subs)) {
        if (!esObjeto(c) || c.resultado === 'no_aplica' || c.resultado === undefined) continue;
        const base = `criterios.${seccion}.${sub}`;
        if (Array.isArray(c.mensajes) && c.mensajes.length === 0) {
          agregar(
            detalle,
            '9',
            `${base}.mensajes`,
            `${base}.mensajes: con resultado "${c.resultado}" debes citar al menos un mensaje. Si es una omisión del agente, cita los mensajes del tramo donde debía ocurrir la acción.`
          );
        }
        if (typeof c.justificacion === 'string' && !textoNoVacio(c.justificacion)) {
          agregar(detalle, '9', `${base}.justificacion`, `${base}.justificacion: no puede estar vacía cuando el resultado es "${c.resultado}".`);
        }
      }
    }
  }

  // --- Reglas 6, 7 y 8: solicitudes del cliente ----------------------------------
  if (Array.isArray(r.solicitudes_cliente) && r.solicitudes_cliente.length > 0) {
    const sols = r.solicitudes_cliente.filter(esObjeto);
    const todasDetectadas = sols.every((s) => s.detectada_por_agente === true);
    const todasAtendidas = sols.every((s) => s.atendida === true);

    const det = criterio(def.criterio_detectadas);
    if (det && (det.resultado === 'cumple') !== todasDetectadas && det.resultado !== 'no_aplica') {
      agregar(
        detalle,
        '6',
        `criterios.${def.criterio_detectadas}.resultado`,
        todasDetectadas
          ? `criterios.${def.criterio_detectadas}.resultado: todas las solicitudes_cliente tienen detectada_por_agente = true, así que el resultado debe ser "cumple" (o corrige la solicitud que no se detectó).`
          : `criterios.${def.criterio_detectadas}.resultado: hay solicitudes_cliente con detectada_por_agente = false, así que el resultado debe ser "no_cumple" (o corrige esa solicitud si sí se detectó).`
      );
    }
    const ate = criterio(def.criterio_atendidas);
    if (ate && (ate.resultado === 'cumple') !== todasAtendidas && ate.resultado !== 'no_aplica') {
      agregar(
        detalle,
        '7',
        `criterios.${def.criterio_atendidas}.resultado`,
        todasAtendidas
          ? `criterios.${def.criterio_atendidas}.resultado: todas las solicitudes_cliente tienen atendida = true, así que el resultado debe ser "cumple" (o corrige la solicitud que no se atendió).`
          : `criterios.${def.criterio_atendidas}.resultado: hay solicitudes_cliente con atendida = false, así que el resultado debe ser "no_cumple" (o corrige esa solicitud si sí se atendió).`
      );
    }

    r.solicitudes_cliente.forEach((s, i) => {
      if (!esObjeto(s) || !Array.isArray(s.mensajes_atencion)) return;
      const ruta = `solicitudes_cliente[${i}].mensajes_atencion`;
      if (s.atendida === true && s.mensajes_atencion.length === 0) {
        agregar(detalle, '8', ruta, `${ruta}: la solicitud tiene atendida = true; cita los mensajes del agente donde la atiende.`);
      }
      if (s.atendida === false && s.mensajes_atencion.length > 0) {
        agregar(detalle, '8', ruta, `${ruta}: la solicitud tiene atendida = false, así que esta lista debe ir vacía (o cambia atendida a true si el agente sí la atendió).`);
      }
    });
  }

  // --- Regla 10: críticos ---------------------------------------------------------
  if (esObjeto(r.criticos_posibles)) {
    for (const [nombre, c] of Object.entries(r.criticos_posibles)) {
      if (!esObjeto(c) || !Array.isArray(c.mensajes)) continue;
      const base = `criticos_posibles.${nombre}`;
      if (c.detectado === true) {
        const delAgente = c.mensajes.filter((n) => emisorPorN.get(n) === 'agente');
        if (delAgente.length === 0) {
          agregar(detalle, '10', `${base}.mensajes`, `${base}.mensajes: con detectado = true debes citar al menos un mensaje del agente donde ocurre; si no hay evidencia, usa detectado = false.`);
        }
        if (typeof c.justificacion === 'string' && !textoNoVacio(c.justificacion)) {
          agregar(detalle, '10', `${base}.justificacion`, `${base}.justificacion: con detectado = true debe explicar y citar el texto del agente.`);
        }
      } else if (c.detectado === false && c.mensajes.length > 0) {
        agregar(detalle, '10', `${base}.mensajes`, `${base}.mensajes: con detectado = false la lista debe ir vacía.`);
      }
    }
  }

  // --- E1: el texto del error de ortografía existe en el mensaje citado -----------
  if (verificarTextoError && Array.isArray(r.errores_ortografia)) {
    const textoPorN = new Map(contexto.mensajes.map((m) => [m.n, m.texto]));
    r.errores_ortografia.forEach((e, i) => {
      if (!esObjeto(e) || typeof e.texto_error !== 'string' || !Number.isInteger(e.mensaje_n)) return;
      if (emisorPorN.get(e.mensaje_n) !== 'agente') return; // ya lo reportó la regla 2
      const fragmento = normalizarParaBusqueda(recortarFragmento(e.texto_error));
      const texto = normalizarParaBusqueda(textoPorN.get(e.mensaje_n) || '');
      if (fragmento === '' || !texto.includes(fragmento)) {
        agregar(
          detalle,
          'E1',
          `errores_ortografia[${i}].texto_error`,
          `errores_ortografia[${i}].texto_error: "${e.texto_error}" no aparece en el mensaje ${e.mensaje_n}. Copia el fragmento tal como está escrito en ese mensaje del agente, o quita el error si no existe.`
        );
      }
    });
  }

  return cerrar(detalle);
}

// Arma el resultado final sin errores repetidos (el mismo problema puede salir
// por dos caminos; al modelo se le dice una sola vez).
function cerrar(detalle) {
  const vistos = new Set();
  const unicos = detalle.filter((d) => {
    const k = `${d.regla}|${d.ruta}|${d.mensaje}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return { valido: unicos.length === 0, errores: unicos.map((d) => d.mensaje), detalle: unicos };
}

// -----------------------------------------------------------------------------
// 6. Mensaje para el reintento
// -----------------------------------------------------------------------------
// Texto que se envía al modelo como mensaje "user" en el reintento (ver
// agregarReintento() de js/construccion_prompt.js).
function redactarMensajeReintento(resultado) {
  const lineas = resultado.errores.map((e, i) => `${i + 1}. ${e}`);
  return [
    'Tu respuesta anterior no pasó la validación automática. Corrige exactamente estos puntos y entrega de nuevo el JSON COMPLETO (no solo las partes corregidas):',
    ...lineas,
    'Recuerda: no inventes evidencia. Cita solo mensajes que existan y del emisor que pide cada campo.',
  ].join('\n');
}

// -----------------------------------------------------------------------------
// 7. Texto de salida de la API Responses
// -----------------------------------------------------------------------------
// En la API Responses el texto está en output[] -> type "message" ->
// content[] -> type "output_text". Si el modelo se niega, aparece "refusal".
// estado = status de la respuesta ("completed", "incomplete", ...). Una
// respuesta "incomplete" (por ejemplo, cortada por max_output_tokens) suele
// traer JSON truncado: validarRespuestaLlm lo rechazará por no parsear.
//
// REGLA: el bloque se elige POR TIPO, no por posición ni concatenando.
// Algunos modelos mandan varios items "message" con un campo phase
// ("commentary" para comentarios intermedios, "final_answer" para la respuesta).
// Diagnóstico real (24-oct-2026, gpt-6-luna): llegaron commentary +
// final_answer; al concatenarlos, JS-5 rechazó por "texto después del objeto
// JSON" y se gastó un reintento. Ahora:
//   1. Si hay EXACTAMENTE un message con phase "final_answer", se toma ese y
//      los demás se ignoran (anomalía "fase_<fase>_ignorada" o
//      "mensaje_sin_fase_ignorado"). No cuenta como intento inválido.
//   2. Dos o más final_answer -> falla_estructura "varios_final_answer".
//   3. Mensajes con fase pero ninguno final_answer -> falla "sin_final_answer".
//   4. Ningún mensaje trae phase (modelos que no la usan): se acepta solo si
//      hay exactamente un message; con dos o más -> falla
//      "varios_mensajes_sin_fase".
//   5. El mensaje elegido debe traer a lo sumo UNA parte output_text; con más
//      -> falla "varias_partes_output_text" (no se concatenan).
//   6. Ningún message (por ejemplo, solo reasoning en una respuesta cortada):
//      texto vacío, como antes; JS-5 lo reporta como "llegó vacía".
// Con falla_estructura no se elige ningún texto (texto = '') y el nodo NO
// debe llamar a validarRespuestaLlm ni gastar un reintento de JS-5: se trata
// como falla de la API (log_errores con tipo_error = fallo_api + alerta
// operativa). Ver el bloque de n8n al final.
// rechazo = true si CUALQUIER message trae una parte refusal (conservador).
//
// estructura: forma de la salida SIN texto (para diagnosticar):
//   items_por_tipo       { message: 1, reasoning: 1, ... }
//   mensajes             cuántos items type "message" llegaron
//   partes_output_text   partes output_text en TODOS los mensajes
//   fases                valores de item.phase de los mensajes, si la API los manda
//   incompleto_por       incomplete_details.reason (por ejemplo max_output_tokens)
//   anomalias            etiquetas fijas (ver arriba); [] si la salida es normal
//   caracteres_ignorados longitud del texto output_text que NO se usó (solo el
//                        número; sirve para estimar cuánto costó lo ignorado)
// Solo se copian etiquetas cortas de la API (minúsculas y guion bajo).
const etiquetaSegura = (x) => (typeof x === 'string' && /^[a-z_]{1,40}$/.test(x) ? x : x === undefined || x === null ? null : 'otro');
const FASE_FINAL = 'final_answer';
// Mensajes fijos de falla estructural: solo números, nunca texto de la API.
const PLANTILLAS_ESTRUCTURA = {
  varios_final_answer: (k) => `La salida de la API trae ${k} mensajes con fase final_answer; no se elige ninguno.`,
  sin_final_answer: (k) => `La salida de la API trae ${k} mensaje(s) con fase, pero ninguno con fase final_answer.`,
  varios_mensajes_sin_fase: (k) => `La salida de la API trae ${k} mensajes sin fase; no se puede saber cuál es la respuesta final.`,
  varias_partes_output_text: (k) => `El mensaje final de la API trae ${k} partes output_text; no se concatenan.`,
};
const tieneFase = (item) => item.phase !== undefined && item.phase !== null;
const partesTexto = (item) => (Array.isArray(item.content) ? item.content : []).filter((p) => p && p.type === 'output_text');
const largoTexto = (item) => partesTexto(item).reduce((s, p) => s + String(p.text || '').length, 0);

function extraerTextoSalida(respuestaApi) {
  let texto = '';
  let rechazo = false;
  let falla = null;
  const estructura = {
    items_por_tipo: {},
    mensajes: 0,
    partes_output_text: 0,
    fases: [],
    incompleto_por: null,
    anomalias: [],
    caracteres_ignorados: 0,
  };
  const mensajes = [];
  for (const item of (respuestaApi && respuestaApi.output) || []) {
    const tipo = etiquetaSegura(item && item.type) || 'sin_tipo';
    estructura.items_por_tipo[tipo] = (estructura.items_por_tipo[tipo] || 0) + 1;
    if (!item || item.type !== 'message') continue;
    mensajes.push(item);
    estructura.mensajes++;
    if (item.phase !== undefined) estructura.fases.push(etiquetaSegura(item.phase));
    estructura.partes_output_text += partesTexto(item).length;
    for (const parte of item.content || []) {
      if (parte && parte.type === 'refusal') rechazo = true;
    }
  }

  // Elección por tipo.
  const finales = mensajes.filter((m) => m.phase === FASE_FINAL);
  let elegido = null;
  if (finales.length > 1) falla = 'varios_final_answer';
  else if (finales.length === 1) elegido = finales[0];
  else if (mensajes.some(tieneFase)) falla = 'sin_final_answer';
  else if (mensajes.length === 1) elegido = mensajes[0];
  else if (mensajes.length > 1) falla = 'varios_mensajes_sin_fase';

  if (elegido && partesTexto(elegido).length > 1) {
    falla = 'varias_partes_output_text';
    elegido = null;
  }
  if (elegido) {
    const partes = partesTexto(elegido);
    texto = partes.length === 1 ? String(partes[0].text || '') : '';
    for (const m of mensajes) {
      if (m === elegido) continue;
      estructura.anomalias.push(tieneFase(m) ? `fase_${etiquetaSegura(m.phase)}_ignorada` : 'mensaje_sin_fase_ignorado');
    }
  }
  estructura.caracteres_ignorados = mensajes.reduce((s, m) => s + largoTexto(m), 0) - texto.length;

  let falla_estructura = null;
  if (falla) {
    estructura.anomalias.push(falla);
    const k = falla === 'varios_final_answer' ? finales.length : falla === 'varias_partes_output_text' ? partesTexto(finales[0] || mensajes[0]).length : mensajes.length;
    falla_estructura = { causa: falla, mensaje: PLANTILLAS_ESTRUCTURA[falla](k) };
  }

  const det = respuestaApi && respuestaApi.incomplete_details;
  if (det && det.reason !== undefined) estructura.incompleto_por = etiquetaSegura(det.reason);
  return { texto, rechazo, estado: (respuestaApi && respuestaApi.status) || null, estructura, falla_estructura };
}

const exportados = {
  DEFINICION_RUBRICA_CE_V1,
  validarContraEsquema,
  recolectarCitas,
  validarRespuestaLlm,
  redactarMensajeReintento,
  extraerTextoSalida,
  diagnosticarTextoNoJson,
  mensajeRaizSinContenido,
};
if (typeof module !== 'undefined' && module.exports) module.exports = exportados;

// =============================================================================
// BLOQUE PARA EL NODO CODE DE n8n (JS-5)  —  modo "Run Once for Each Item"
// -----------------------------------------------------------------------------
// Cómo se pega: copia TODO este archivo desde "'use strict';" hasta la línea
// "const exportados = ..." (sin incluirla) y debajo el bloque de abajo (sin
// los "// "). Los nombres de nodos y de campos intermedios son de ejemplo; los
// fija workflows-n8n.
// Campos intermedios del flujo (falla_api, estructura_salida_llm, valido,
// errores_validacion, estado_respuesta_llm, texto_respuesta_llm, respuesta_llm,
// mensaje_reintento): no son columnas de ninguna hoja ni campos del contrato;
// los fija workflows-n8n.
//
// Después de este nodo, un IF sobre falla_api y luego otro sobre valido:
//   - falla_api = true -> log_errores (tipo_error fallo_api, detalle_json =
//           { falla_estructura, estructura }, sin texto) + alerta operativa.
//           NO gasta reintento de JS-5: la salida de la API es ambigua (por
//           ejemplo, dos mensajes final_answer) y corregir al modelo no aplica.
//   - true  -> JS-6 (reglas híbridas) con respuesta_llm;
//   - false y intentos_llm <= config.reintentos_validacion_llm
//           -> nodo de reintento (agregarReintento de JS-4) y de vuelta a OpenAI;
//   - false sin reintentos -> log_errores (tipo_error respuesta_llm_invalida,
//           detalle_json = detalle, sin texto de la conversación) + alerta.
//
// const item = $input.item.json;
// const api = $('OpenAI').item.json;               // respuesta cruda de la API Responses
// const { texto, rechazo, estado, estructura, falla_estructura } = extraerTextoSalida(api);
// if (falla_estructura) {
//   return {
//     json: {
//       ...item,
//       valido: false,
//       falla_api: true,
//       errores_validacion: [{ regla: 'estructura_salida', ruta: '(raíz)', mensaje: falla_estructura.mensaje }],
//       estructura_salida_llm: estructura,
//       estado_respuesta_llm: estado,
//       texto_respuesta_llm: null,
//       respuesta_llm: null,
//       mensaje_reintento: null,
//     },
//   };
// }
// const resultado = validarRespuestaLlm(texto, {
//   esquema: $('Esquema LLM').first().json.esquema_llm,
//   mensajes: item.extraccion.mensajes_enmascarados,
//   catalogo_temas: item.catalogo,
//   base_conocimiento: $('Base de conocimiento').all().map((i) => i.json),
//   tipo_interaccion: item.payload.tipo_interaccion,
//   termina_por_inactividad: item.resultados_js.variables.termina_por_inactividad,
// });
// if (rechazo) {
//   const d = { regla: '1', ruta: '(raíz)', mensaje: 'El modelo se negó a responder (refusal).' };
//   resultado.valido = false;
//   resultado.detalle.unshift(d);
//   resultado.errores.unshift(d.mensaje);
// }
// return {
//   json: {
//     ...item,
//     valido: resultado.valido,
//     falla_api: false,
//     errores_validacion: resultado.detalle,
//     estructura_salida_llm: estructura,            // anomalias sin texto (p. ej. fase_commentary_ignorada)
//     estado_respuesta_llm: estado,
//     texto_respuesta_llm: texto,
//     respuesta_llm: resultado.valido ? JSON.parse(texto) : null,
//     mensaje_reintento: resultado.valido ? null : redactarMensajeReintento(resultado),
//   },
// };
// =============================================================================
