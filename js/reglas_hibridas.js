/**
 * JS-6 Reglas híbridas (Workflow 2: Evaluación, paso 8).
 *
 * Principio del proyecto: el LLM entrega insumos semánticos con evidencia y JavaScript
 * decide. Este archivo:
 *  1. Convierte los 15 criterios [LLM] de la salida del evaluador al formato de
 *     `evaluacion.schema.json` (sin cambiar el juicio), salvo `recapitulacion.recapitula`,
 *     que JS fuerza a `no_aplica` cuando la conversación termina por inactividad.
 *  2. Decide los 5 subelementos [HÍBRIDO]: escalamiento (2), ortografía, uso de
 *     "solución"/"seguimiento" y tipificación.
 *  3. Cierra los criterios [JS] que dependen de un dato del LLM:
 *     `diagnostico.numero_preguntas` y la validación de identidad (rubrica.md, sección 4).
 *  4. Decide los críticos híbridos (`validacion_identidad`, `confidencialidad`,
 *     `tipificacion_incorrecta`) y acepta los 5 críticos [LLM] solo con evidencia válida.
 *  5. Si la conversación no tiene mensajes del agente (rubrica.md 3.12), no hubo llamada
 *     al LLM (`contexto.llm = null`) y aplica los resultados fijos del contrato.
 *
 * Entrada: el contexto con `llm` (salida con la forma de `contrato/llm_output.schema.json`,
 * ya validada por JS-5), `resultados_js.variables` (JS-3), `extraccion` (JS-2),
 * `catalogo`, `config`, `payload` y `conversacion`.
 * No depende del código del validador de JS-5: solo de la forma del esquema.
 */

/** Criterios [LLM] de la rúbrica CE, en la forma `seccion.subelemento` de llm_output. */
const CRITERIOS_LLM = [
  'empatia.identifica_emocion',
  'empatia.muestra_empatia',
  'empatia.cordialidad',
  'empatia.lenguaje_acorde',
  'empatia.asertividad',
  'diagnostico.preguntas_necesarias',
  'diagnostico.solicitudes_detectadas',
  'diagnostico.solicitudes_atendidas',
  'solucion.informacion_correcta',
  'solucion.informacion_completa',
  'solucion.apego_proceso',
  'solucion.ofrece_alternativas',
  'comunicacion.redaccion',
  'comunicacion.congruencia',
  'recapitulacion.recapitula',
];

/** Subelementos [HÍBRIDO] de sección. */
const SUBELEMENTOS_HIBRIDOS = [
  'solucion.escala_cuando_requiere',
  'solucion.no_escala_innecesario',
  'comunicacion.ortografia',
  'recapitulacion.uso_solucion_seguimiento',
  'recapitulacion.tipificacion',
];

/** Críticos [LLM]: nombre en `criticos_posibles` = sufijo del ID `critico.<nombre>`. */
const CRITICOS_LLM = ['informacion_incorrecta', 'promesa_no_autorizada', 'negacion_servicio', 'mala_actitud', 'comentarios_negativos_marca'];

const SIN_AGENTE = 'sin mensajes del agente';
const SIN_AGENTE_JUSTIFICACION = 'sin mensajes del agente: no se llamó al LLM';

function crearCriterio(id, origen, resultado, mensajes, dato, justificacion) {
  const prefijo = id.split('.')[0];
  return {
    id_criterio: id,
    tipo_criterio: prefijo === 'critico' ? 'critico' : prefijo === 'identidad' ? 'identidad' : 'subelemento',
    seccion: prefijo,
    origen,
    clasificacion: null, // JS-7 la completa con la definición de la rúbrica
    resultado,
    evidencia: { mensajes: [...new Set(mensajes)].sort((a, b) => a - b), dato },
    justificacion,
  };
}

const lista = (ns) => ns.map((n) => `[${n}]`).join(', ');

// ---------------------------------------------------------------------------
// Validación de identidad (rubrica.md, sección 4)
// ---------------------------------------------------------------------------

/**
 * Calcula las variables de identidad. `info_n` es el primer mensaje del agente con
 * información de la cuenta según el LLM (null si nunca la da).
 *
 * Regla del dueño (rubrica.md sección 4): la validación es EXITOSA si el cliente acierta al
 * menos `config.identidad_min_datos_correctos` datos distintos (correo, RFC, teléfono,
 * titular) comparados con la hoja `cuentas`. Un dato que no sabe o que es incorrecto no
 * suma. Los datos alternativos que el agente pida después cuentan igual para el mínimo.
 * Supuestos:
 *  - "datos distintos" = tipos de dato distintos; un mismo tipo cuenta una sola vez.
 *  - `incorrectos` = valores distintos de correo, RFC o teléfono que no coinciden con la
 *    cuenta. Es solo evidencia: no cambia ningún resultado.
 *  - Los canales oficiales y los RFC genéricos que escriba el cliente no son datos de
 *    identidad (JS-2 los marca `es_oficial`).
 *  - El número de caso NO es dato de identidad (reservado para la Fase 5): JS-2 no lo
 *    devuelve como detección, así que no suma ni resta.
 */
function calcularIdentidad({ detecciones, variables, config, infoN }) {
  const comparables = config.identidad_datos_comparables || [];
  const minCorrectos = config.identidad_min_datos_correctos;
  const solicitudN = variables.mensaje_solicitud_n;
  // Datos del cliente anteriores a info_n (o todos si info_n es null); no solo los
  // posteriores a la solicitud, para no castigar a quien da su RFC en el primer mensaje.
  // El titular solo cuenta con nombre completo o nombre de pila + apellido; el nombre de
  // pila solo no.
  const datos = detecciones
    .filter((d) => d.emisor === 'cliente' && !d.es_oficial && !d.de_tercero && comparables.includes(d.tipo))
    .filter((d) => d.tipo !== 'titular' || d.forma !== 'pila')
    .filter((d) => infoN === null || d.n < infoN)
    .sort((a, b) => a.n - b.n);

  // Acumulamos en orden los tipos de dato ACERTADOS hasta alcanzar el mínimo.
  const acertados = new Set();
  let mensajeValidacionN = null;
  for (const d of datos) {
    if (!d.coincide_cuenta) continue; // un dato incorrecto no suma
    acertados.add(d.tipo);
    if (mensajeValidacionN === null && acertados.size >= minCorrectos) mensajeValidacionN = d.n;
  }
  const incorrectos = new Set(datos.filter((d) => d.tipo !== 'titular' && !d.coincide_cuenta).map((d) => `${d.tipo}|${d.valor_normalizado}`)).size;
  const mensajesDeclina = solicitudN === null ? [] : variables.mensajes_declina.filter((n) => n > solicitudN);

  // "Sigue pidiendo datos" (rubrica.md sección 4): el último mensaje del agente que no es
  // despedida ni inactividad (JS-3 lo calcula) pide datos Y es POSTERIOR al último mensaje del
  // cliente que aporta datos de identidad. Así, si el cliente respondió con datos insuficientes y
  // el agente solo se despide, la solicitud original ya quedó "atendida" y no cuenta como seguir
  // pidiendo; si el cliente nunca respondió (abandono) no hay respuesta posterior que superar.
  // "Aporta datos" (decisión del dueño, 23-oct-2026) = correo, RFC, teléfono o titular del cliente
  // (según identidad_datos_comparables), correcto o no, sin importar info_n. NO cuentan: RFC
  // genéricos y canales oficiales (es_oficial), datos de terceros como el RFC del receptor
  // (de_tercero, por la lista `dato_de_tercero`) ni el nombre de pila solo.
  const ultimoClienteConDatosN = detecciones
    .filter((d) => d.emisor === 'cliente' && !d.es_oficial && !d.de_tercero && comparables.includes(d.tipo) && (d.tipo !== 'titular' || d.forma !== 'pila'))
    .reduce((max, d) => Math.max(max, d.n), 0);
  const ultimoTemaN = variables.ultimo_mensaje_tema_n === undefined ? null : variables.ultimo_mensaje_tema_n;
  const seguiaPidiendo = variables.sigue_pidiendo_datos === true && ultimoTemaN !== null && ultimoTemaN > ultimoClienteConDatosN;

  // Resumen enmascarado de los datos comparados (para la evidencia).
  const vistos = new Map();
  for (const d of datos) {
    const llave = `${d.tipo}|${d.valor_normalizado}`;
    if (!vistos.has(llave)) vistos.set(llave, `${d.marcador} ${d.coincide_cuenta ? 'coincide' : 'no coincide'}`);
  }

  return {
    aplica: infoN !== null || solicitudN !== null,
    info_n: infoN,
    mensaje_solicitud_n: solicitudN,
    datos_correctos: acertados.size,
    mensaje_validacion_n: mensajeValidacionN,
    incorrectos,
    validacion_exitosa: mensajeValidacionN !== null,
    mensajes_declina: mensajesDeclina,
    sigue_pidiendo_datos: seguiaPidiendo,
    ultimo_mensaje_tema_n: variables.ultimo_mensaje_tema_n === undefined ? null : variables.ultimo_mensaje_tema_n,
    resumen_datos: [...vistos.values()].join(', ') || 'sin datos',
  };
}

/** Los 3 subelementos de identidad y el crítico `critico.validacion_identidad`. */
function evaluarIdentidad(id, variables, config) {
  const criterios = [];
  const minimo = config.identidad_min_datos_correctos;
  if (!id.aplica) {
    for (const c of ['identidad.pide_datos', 'identidad.datos_coinciden']) {
      criterios.push(crearCriterio(c, 'JS', 'no_aplica', [], 'bloque de identidad no aplica', 'El agente no pide datos ni da información de la cuenta.'));
    }
    criterios.push(crearCriterio('identidad.orden_validacion', 'HIBRIDO', 'no_aplica', [], 'bloque de identidad no aplica', 'El agente no pide datos ni da información de la cuenta.'));
    criterios.push(crearCriterio('critico.validacion_identidad', 'HIBRIDO', 'no_detectado', [], 'bloque de identidad no aplica', 'Se detecta si algún subelemento de identidad es no_cumple.'));
    return criterios;
  }

  // identidad.pide_datos
  if (id.mensaje_solicitud_n !== null) {
    criterios.push(crearCriterio('identidad.pide_datos', 'JS', 'cumple', [id.mensaje_solicitud_n], `solicitud en [${id.mensaje_solicitud_n}]: "${variables.frase_solicitud}"`, 'El agente pide datos de validación (lista pide_datos_identidad).'));
  } else {
    criterios.push(crearCriterio('identidad.pide_datos', 'JS', 'no_cumple', id.info_n ? [id.info_n] : [], `da información de la cuenta en [${id.info_n}] sin pedir datos de identidad`, 'El bloque aplica y el agente nunca pide datos de validación.'));
  }

  // identidad.datos_coinciden: cómo actúa el agente ante el resultado de la validación.
  {
    const base = `datos correctos: ${id.datos_correctos} de ${minimo} (${id.resumen_datos}); incorrectos (evidencia): ${id.incorrectos}; validación: ${id.mensaje_validacion_n ? `[${id.mensaje_validacion_n}]` : 'no alcanzada'}; declinación: ${id.mensajes_declina.length ? lista(id.mensajes_declina) : 'no'}`;
    let ns = [id.mensaje_validacion_n, ...id.mensajes_declina, id.info_n].filter((n) => n !== null && n !== undefined);
    let resultado;
    let justif;
    if (id.mensaje_solicitud_n === null) {
      resultado = 'no_aplica';
      justif = 'El agente nunca pidió datos: lo castigan identidad.pide_datos y critico.validacion_identidad.';
    } else if (id.validacion_exitosa) {
      resultado = 'cumple';
      justif = `El cliente acertó al menos ${minimo} datos (config.identidad_min_datos_correctos).`;
    } else if (id.info_n !== null) {
      resultado = 'no_cumple';
      justif = `Da información de la cuenta en [${id.info_n}] sin que el cliente acierte ${minimo} datos.`;
    } else if (id.mensajes_declina.length) {
      resultado = 'cumple';
      justif = 'El cliente no alcanzó el mínimo de datos acertados y el agente declina, como debe.';
    } else if (id.sigue_pidiendo_datos) {
      resultado = 'cumple';
      justif = 'El cliente no alcanzó el mínimo y el agente sigue pidiendo datos (su último mensaje sobre el tema los pide y es posterior a los datos del cliente, o el cliente abandonó).';
      ns = [...ns, id.ultimo_mensaje_tema_n].filter((n) => n !== null);
    } else {
      // Sin crítico: no reveló información (ver critico.validacion_identidad más abajo).
      resultado = 'no_cumple';
      justif = 'El cliente no alcanzó el mínimo y el agente no declina ni sigue pidiendo datos (cambia de tema, da largas o cierra sin declinar). No revela información, por eso no activa el crítico.';
      ns = [...ns, id.ultimo_mensaje_tema_n].filter((n) => n !== null);
    }
    criterios.push(crearCriterio('identidad.datos_coinciden', 'JS', resultado, ns, base, justif));
  }

  // identidad.orden_validacion
  {
    const dato = `info_n: ${id.info_n === null ? 'null' : `[${id.info_n}]`}; mensaje_validacion_n: ${id.mensaje_validacion_n === null ? 'null' : `[${id.mensaje_validacion_n}]`}; validacion_exitosa: ${id.validacion_exitosa}`;
    const ns = [id.info_n, id.mensaje_validacion_n].filter((n) => n !== null);
    let resultado;
    let justif;
    if (id.info_n === null) {
      resultado = 'cumple';
      justif = 'El agente no da información de la cuenta.';
    } else if (id.validacion_exitosa && id.info_n > id.mensaje_validacion_n) {
      resultado = 'cumple';
      justif = 'La información de la cuenta se da después de una validación exitosa.';
    } else {
      resultado = 'no_cumple';
      justif = 'Información de la cuenta antes de la validación, sin validación o con validación fallida.';
    }
    criterios.push(crearCriterio('identidad.orden_validacion', 'HIBRIDO', resultado, ns, dato, justif));
  }

  // El crítico se activa si falla algún subelemento, EXCEPTO datos_coinciden cuando el agente
  // no reveló información (info_n null): ese no_cumple es "no declinó", no una revelación.
  const fallidos = criterios.filter(
    (c) => c.resultado === 'no_cumple' && !(c.id_criterio === 'identidad.datos_coinciden' && id.info_n === null)
  );
  criterios.push(
    crearCriterio(
      'critico.validacion_identidad',
      'HIBRIDO',
      fallidos.length ? 'detectado' : 'no_detectado',
      fallidos.flatMap((c) => c.evidencia.mensajes),
      fallidos.length ? `subelementos fallidos: ${fallidos.map((c) => c.id_criterio).join(', ')}` : 'ningún subelemento de identidad activa el crítico',
      'Se detecta si algún subelemento de identidad es no_cumple, salvo datos_coinciden cuando el agente no reveló información.'
    )
  );
  return criterios;
}

// ---------------------------------------------------------------------------
// Confidencialidad (parte JS)
// ---------------------------------------------------------------------------

/**
 * Revelaciones de datos por el agente (rubrica.md, critico.confidencialidad):
 *  - Dato COMPLETO (correo, RFC o teléfono; registrado o de un tercero) que el cliente no
 *    escribió antes y que no es canal oficial → revelación siempre.
 *  - Dato PARCIAL que corresponde a la cuenta y que el cliente no escribió completo antes:
 *      antes de una validación exitosa → revelación;
 *      después → solo se permite con el formato de config (visibles y posición).
 */
function revelacionesConfidencialidad({ detecciones, parciales, identidad }) {
  const revelaciones = [];
  const clienteEscribio = (tipo, valor, n) =>
    detecciones.some((c) => c.emisor === 'cliente' && c.tipo === tipo && c.valor_normalizado === valor && c.n < n);
  const clienteEscribioRegistrado = (tipo, n) =>
    detecciones.some((c) => c.emisor === 'cliente' && c.tipo === tipo && c.coincide_cuenta && c.n < n);

  for (const d of detecciones) {
    if (d.emisor !== 'agente' || d.es_oficial || !['correo', 'rfc', 'telefono'].includes(d.tipo)) continue;
    if (clienteEscribio(d.tipo, d.valor_normalizado, d.n)) continue;
    revelaciones.push({ n: d.n, dato: `${d.tipo} completo ${d.marcador} (${d.coincide_cuenta ? 'dato registrado' : 'dato de un tercero'})` });
  }
  for (const p of parciales) {
    if (!p.corresponde_cuenta) continue; // los parciales que no son de la cuenta se ignoran
    if (clienteEscribioRegistrado(p.tipo, p.n)) continue;
    const antesDeValidar = !identidad.validacion_exitosa || identidad.mensaje_validacion_n === null || p.n <= identidad.mensaje_validacion_n;
    if (antesDeValidar) revelaciones.push({ n: p.n, dato: `${p.tipo} parcial de la cuenta antes de una validación exitosa` });
    else if (!p.formato_permitido) revelaciones.push({ n: p.n, dato: `${p.tipo} parcial de la cuenta con más caracteres visibles o en otra posición que lo permitido` });
  }
  return revelaciones;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Regla general de los críticos del LLM (rubrica.md, sección 5): solo se acepta
 * `detectado = true` con al menos un mensaje del agente y justificación no vacía.
 * JS-5 ya rechaza respuestas que no cumplen; si llega aquí algo inválido es un error del
 * flujo y se detiene en lugar de aceptarlo o ignorarlo en silencio.
 */
function criticoLLMValido(c, mensajesAgente) {
  if (!c || c.detectado !== true) return false;
  const delAgente = (c.mensajes || []).filter((n) => mensajesAgente.includes(n));
  if (delAgente.length === 0 || !String(c.justificacion || '').trim()) {
    throw new Error('JS-6: crítico del LLM detectado sin mensaje del agente o sin justificación (JS-5 debió rechazarlo)');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

function evaluarReglasHibridas(contexto) {
  const { config, payload, catalogo, conversacion, extraccion, llm } = contexto;
  const variables = contexto.resultados_js.variables;
  const meta = payload.metadatos_caso;
  const criterios = [];
  const agregar = (...args) => criterios.push(crearCriterio(...args));

  // ---------- Caso 3.12: sin mensajes del agente (no hubo llamada al LLM) ----------
  if (variables.sin_mensajes_agente) {
    for (const id of CRITERIOS_LLM) agregar(id, 'LLM', 'no_aplica', [], SIN_AGENTE, SIN_AGENTE_JUSTIFICACION);
    for (const id of SUBELEMENTOS_HIBRIDOS) agregar(id, 'HIBRIDO', 'no_aplica', [], SIN_AGENTE, SIN_AGENTE_JUSTIFICACION);
    agregar('diagnostico.numero_preguntas', 'JS', 'no_aplica', [], SIN_AGENTE, 'Sin mensajes del agente no hay preguntas que contar.');
    // Identidad: no hay solicitud ni información de la cuenta (info_n se toma como null).
    criterios.push(...evaluarIdentidad({ aplica: false }, variables, config));
    agregar('critico.confidencialidad', 'HIBRIDO', 'no_detectado', [], SIN_AGENTE, 'Sin mensajes del agente no hay revelación posible.');
    // SUPUESTO del contrato: no hay tema del LLM con qué comparar.
    agregar('critico.tipificacion_incorrecta', 'HIBRIDO', 'no_detectado', [], SIN_AGENTE, 'Sin tema del LLM no se puede comparar la tipificación.');
    for (const c of CRITICOS_LLM) agregar(`critico.${c}`, 'LLM', 'no_detectado', [], SIN_AGENTE, SIN_AGENTE_JUSTIFICACION);
    return { criterios, identidad: null };
  }

  if (!llm) throw new Error('JS-6: falta la salida del LLM y la conversación sí tiene mensajes del agente');
  const mensajesAgente = conversacion.mensajes_agente;

  // ---------- 1. Criterios [LLM] ----------
  for (const id of CRITERIOS_LLM) {
    const [seccion, sub] = id.split('.');
    const c = llm.criterios[seccion][sub];
    if (id === 'recapitulacion.recapitula' && variables.termina_por_inactividad) {
      // rubrica.md 3.6: con inactividad del cliente, JS impone no_aplica sin importar el LLM.
      agregar(id, 'LLM', 'no_aplica', c.mensajes, 'termina por inactividad del cliente', 'no_aplica impuesto por JS (termina_por_inactividad = true).');
      continue;
    }
    const dato = id === 'empatia.identifica_emocion' ? `emoción del cliente: ${llm.emocion_cliente.emocion}` : `juicio del LLM: ${c.resultado}`;
    agregar(id, 'LLM', c.resultado, c.mensajes, dato, c.justificacion);
  }

  // ---------- 2. Escalamiento (requiere) ----------
  {
    const insumo = llm.insumos_hibridos.situacion_escalamiento;
    const filas = catalogo.filter((f) => f.tema === llm.tema.valor);
    const valores = [...new Set(filas.map((f) => f.requiere_escalamiento))];
    // El catálogo decide si todas sus filas del tema dicen lo mismo (si o no); con
    // segun_caso o filas en desacuerdo decide el insumo del LLM.
    let requiere;
    let fuente;
    if (valores.length === 1 && valores[0] === 'si') {
      requiere = true;
      fuente = 'catálogo';
    } else if (valores.length === 1 && valores[0] === 'no') {
      requiere = false;
      fuente = 'catálogo';
    } else {
      requiere = insumo.situacion_requiere_escalamiento === true;
      fuente = 'LLM';
    }
    const escalado = meta.escalado === true;
    const dato = `requiere = ${requiere} (fuente: ${fuente}); escalado = ${escalado}`;
    const justifLLM = `Insumo del LLM: situacion_requiere_escalamiento = ${insumo.situacion_requiere_escalamiento}. ${insumo.justificacion}`;
    agregar('solucion.escala_cuando_requiere', 'HIBRIDO', !requiere ? 'no_aplica' : escalado ? 'cumple' : 'no_cumple', insumo.mensajes, dato, justifLLM);
    agregar('solucion.no_escala_innecesario', 'HIBRIDO', requiere ? 'no_aplica' : !escalado ? 'cumple' : 'no_cumple', insumo.mensajes, dato, justifLLM);
  }

  // ---------- 3. Ortografía ----------
  {
    // Se descartan errores en mensajes inexistentes o del cliente.
    const validos = llm.errores_ortografia.filter((e) => mensajesAgente.includes(e.mensaje_n));
    const descartados = llm.errores_ortografia.length - validos.length;
    const graves = validos.filter((e) => e.gravedad === 'grave').length;
    const menores = validos.filter((e) => e.gravedad === 'menor').length;
    const falla = graves >= config.ortografia_umbral_graves || menores >= config.ortografia_umbral_menores;
    const ejemplos = validos.slice(0, 3).map((e) => `"${e.texto_error}" → "${e.correccion}" (${e.gravedad})`).join('; ');
    agregar(
      'comunicacion.ortografia',
      'HIBRIDO',
      falla ? 'no_cumple' : 'cumple',
      validos.map((e) => e.mensaje_n),
      `graves: ${graves}, menores: ${menores}${descartados ? `, descartados: ${descartados}` : ''}${ejemplos ? `; ${ejemplos}` : ''}`,
      `No cumple con ${config.ortografia_umbral_graves} o más graves o ${config.ortografia_umbral_menores} o más menores (config).`
    );
  }

  // ---------- 4. Uso de "solución" / "seguimiento" ----------
  {
    const id = 'recapitulacion.uso_solucion_seguimiento';
    const insumo = llm.insumos_hibridos.uso_solucion_seguimiento;
    const justifBase = `LLM: uso_correcto = ${insumo.uso_correcto}, problema_resuelto_en_conversacion = ${insumo.problema_resuelto_en_conversacion}. ${insumo.justificacion}`;
    if (meta.estado_caso === 'sin_caso') {
      agregar(id, 'HIBRIDO', 'no_aplica', [], 'estado_caso = sin_caso', justifBase);
    } else if (variables.termina_por_inactividad) {
      agregar(id, 'HIBRIDO', 'no_aplica', [], 'termina por inactividad del cliente', justifBase);
    } else {
      const cerrado = meta.estado_caso === 'cerrado';
      const esperada = cerrado ? variables.mensajes_palabra_solucion : variables.mensajes_palabra_seguimiento;
      const contraria = cerrado ? variables.mensajes_palabra_seguimiento : variables.mensajes_palabra_solucion;
      const nombreEsperada = cerrado ? 'solución' : 'seguimiento';
      const ok = esperada.length > 0 && contraria.length === 0 && insumo.uso_correcto === true;
      const dato = `estado_caso = ${meta.estado_caso}; palabra esperada "${nombreEsperada}": ${esperada.length ? lista(esperada) : 'no'}; contraria: ${contraria.length ? lista(contraria) : 'no'}; uso_correcto LLM = ${insumo.uso_correcto}`;
      agregar(id, 'HIBRIDO', ok ? 'cumple' : 'no_cumple', [...esperada, ...contraria, ...insumo.mensajes], dato, justifBase);
    }
  }

  // ---------- 5. Tipificación y su crítico ----------
  {
    const tipificacion = String(meta.tipificacion_agente || '').trim();
    const validas = catalogo.filter((f) => f.tema === llm.tema.valor).map((f) => String(f.tipificacion_valida).trim());
    const ok = validas.includes(tipificacion);
    const dato = `tema LLM: ${llm.tema.valor}; tipificación agente: ${tipificacion}; válidas: ${validas.join(' | ') || 'ninguna'}`;
    agregar('recapitulacion.tipificacion', 'HIBRIDO', ok ? 'cumple' : 'no_cumple', llm.tema.mensajes, dato, `Cumple si existe en el catálogo una fila con ese tema y tipificacion_valida = tipificacion_agente. LLM: ${llm.tema.justificacion}`);
    agregar('critico.tipificacion_incorrecta', 'HIBRIDO', ok ? 'no_detectado' : 'detectado', ok ? [] : llm.tema.mensajes, dato, 'Se detecta si recapitulacion.tipificacion = no_cumple.');
  }

  // ---------- 6. diagnostico.numero_preguntas (JS, informativo) ----------
  {
    const id = 'diagnostico.numero_preguntas';
    const justif = 'Cuenta los mensajes del agente con "?" antes del primer mensaje de atención (m); cumple si hay al menos uno. Informativo: no entra en la agregación.';
    const atenciones = llm.solicitudes_cliente.flatMap((s) => s.mensajes_atencion || []);
    if (atenciones.length === 0) {
      agregar(id, 'JS', 'no_aplica', [], 'ninguna solicitud tiene mensajes_atencion', justif);
    } else {
      const m = Math.min(...atenciones);
      const antes = mensajesAgente.filter((n) => n < m);
      if (antes.length === 0) agregar(id, 'JS', 'no_aplica', [], `no hay mensajes del agente antes de [${m}]`, justif);
      else {
        const conPregunta = variables.mensajes_agente_con_pregunta.filter((n) => n < m);
        agregar(id, 'JS', conPregunta.length >= 1 ? 'cumple' : 'no_cumple', conPregunta, `${conPregunta.length} mensajes del agente con pregunta antes de [${m}]`, justif);
      }
    }
  }

  // ---------- 7. Identidad ----------
  const identidad = calcularIdentidad({
    detecciones: extraccion.detecciones,
    variables,
    config,
    infoN: llm.primer_mensaje_info_cuenta.mensaje_n,
  });
  criterios.push(...evaluarIdentidad(identidad, variables, config));

  // ---------- 8. Confidencialidad (JS + LLM) ----------
  {
    const revelaciones = revelacionesConfidencialidad({ detecciones: extraccion.detecciones, parciales: extraccion.parciales, identidad });
    const c = llm.criticos_posibles.confidencialidad;
    const porLLM = criticoLLMValido(c, mensajesAgente);
    const detectado = revelaciones.length > 0 || porLLM;
    const partes = [];
    if (revelaciones.length) partes.push(`JS: ${revelaciones.map((r) => `[${r.n}] ${r.dato}`).join('; ')}`);
    if (porLLM) partes.push('LLM: revelación detectada');
    agregar(
      'critico.confidencialidad',
      'HIBRIDO',
      detectado ? 'detectado' : 'no_detectado',
      [...revelaciones.map((r) => r.n), ...(porLLM ? c.mensajes.filter((n) => mensajesAgente.includes(n)) : [])],
      partes.join(' | ') || 'sin revelación de datos',
      porLLM ? c.justificacion : 'Detectado si JS encuentra un dato revelado o el LLM lo indica con evidencia válida.'
    );
  }

  // ---------- 9. Críticos [LLM] ----------
  for (const nombre of CRITICOS_LLM) {
    const c = llm.criticos_posibles[nombre];
    const ok = criticoLLMValido(c, mensajesAgente);
    agregar(`critico.${nombre}`, 'LLM', ok ? 'detectado' : 'no_detectado', ok ? c.mensajes : [], ok ? 'detectado por el LLM' : 'no detectado por el LLM', c.justificacion || 'Sin evidencia.');
  }

  return { criterios, identidad };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CRITERIOS_LLM,
    SUBELEMENTOS_HIBRIDOS,
    CRITICOS_LLM,
    calcularIdentidad,
    evaluarIdentidad,
    revelacionesConfidencialidad,
    evaluarReglasHibridas,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "JS-6 Reglas híbridas", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * const contexto = $json;
 * // contexto.llm = salida del LLM ya validada por JS-5 (objeto JSON), o null si
 * // contexto.resultados_js.variables.sin_mensajes_agente es true.
 * contexto.resultados_hibridos = evaluarReglasHibridas(contexto);
 * return { json: contexto };
 * ------------------------------------------------------------------------- */
