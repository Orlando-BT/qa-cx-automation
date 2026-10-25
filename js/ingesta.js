/**
 * Workflow 1 (Ingesta) y Workflow 4 (Reproceso): decisiones y armado de filas.
 *
 * Aquí vive TODA la lógica de decisión de esos workflows para que los nodos Code de n8n solo
 * tengan unas líneas de pegamento:
 *  - llave de deduplicación (conversation_id|version_reglas|version_prompt);
 *  - qué hacer al recibir una conversación: insertar, duplicado, reutilizar o sin rúbrica;
 *  - armado de la fila de `conversaciones` (21 columnas exactas de contrato/sheets.md);
 *  - si se evalúa al ingerir (lote demo sí; calibracion_* según config);
 *  - disparador manual de calibración (filas nuevas por versión y lista de pendientes);
 *  - W4: reenviar a Evaluación o pasar a `error`.
 *
 * Las funciones son puras: no leen ni escriben hojas. Reciben las filas ya leídas de Sheets
 * (todo texto, como las entrega Sheets) y devuelven lo que el workflow debe escribir.
 *
 * Decisión sobre `marcaTiempoSistema`: n8n no permite `require` entre nodos, así que se DUPLICA
 * aquí (original en js/costo.js; una prueba verifica que son iguales). Las funciones reciben
 * `ahora` (Date) y la zona sale de `config.zona_horaria`.
 */

const COLUMNAS_CONVERSACIONES = [
  'llave_dedup',
  'conversation_id',
  'lote',
  'canal',
  'tipo_interaccion',
  'agente',
  'cuenta_id',
  'tipificacion_agente',
  'numero_caso',
  'estado_caso',
  'escalado',
  'campos_capturados_json',
  'mensajes_json',
  'total_mensajes',
  'version_reglas',
  'version_prompt',
  'estado',
  'intentos',
  'recibido_en',
  'actualizado_en',
  'id_evaluacion',
];

// Columnas 2 a 14 de `conversaciones`: los datos de la conversación que se copian al crear la
// fila de una versión nueva (sheets.md, disparador manual).
const COLUMNAS_DATOS_CONVERSACION = COLUMNAS_CONVERSACIONES.slice(1, 14);

const PATRON_LOTE = /^(demo|calibracion_v[0-9]+)$/;
const PATRON_VERSION_REGLAS = /^reglas_(ce|sales)_v[0-9]+$/;
const PATRON_VERSION_PROMPT = /^evaluador_(ce|sales)_v[0-9]+$/;
const SIN_RUBRICA = 'sin_rubrica';

function marcaTiempoSistema(fecha, zonaHoraria) {
  const partes = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(fecha)
    .forEach((p) => {
      partes[p.type] = p.value;
    });
  const local = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  const sinMs = Math.floor(fecha.getTime() / 1000) * 1000;
  const desfaseMin = Math.round((local - sinMs) / 60000);
  const signo = desfaseMin < 0 ? '-' : '+';
  const abs = Math.abs(desfaseMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${signo}${hh}:${mm}`;
}

/** Los booleanos de config llegan como true/false (cargarConfig); se acepta también 'si'. */
function esVerdadero(valor) {
  return valor === true || valor === 'si';
}

// ---------------------------------------------------------------------------
// Llave de deduplicación y decisiones de la ingesta por webhook
// ---------------------------------------------------------------------------

/** `conversation_id|version_reglas|version_prompt` (glosario, sección 2). */
function llaveDedup(conversationId, versionReglas, versionPrompt) {
  return `${conversationId}|${versionReglas}|${versionPrompt}`;
}

/**
 * ¿Se evalúa al ingerir? (config.md sección 1)
 *  - lote `demo`: siempre.
 *  - lote `calibracion_*`: solo si config.evaluar_al_ingerir_calibracion es verdadero.
 */
function debeEvaluarAlIngerir(lote, config) {
  if (lote === 'demo') return true;
  if (/^calibracion_v[0-9]+$/.test(lote)) return esVerdadero(config.evaluar_al_ingerir_calibracion);
  throw new Error(`lote inválido: ${JSON.stringify(lote)}`);
}

/**
 * Fila de `conversaciones` para una conversación nueva (21 columnas, estado `pendiente`).
 * `intentos` empieza en 0: cuenta las veces que la conversación ENTRÓ a evaluación (lo suma W2).
 * `recibido_en` y `actualizado_en` valen lo mismo al insertar.
 */
function filaConversaciones(payload, lote, versiones, config, ahora = new Date()) {
  const marca = marcaTiempoSistema(ahora, config.zona_horaria);
  const meta = payload.metadatos_caso;
  return {
    llave_dedup: llaveDedup(payload.conversation_id, versiones.version_reglas, versiones.version_prompt),
    conversation_id: payload.conversation_id,
    lote,
    canal: payload.canal,
    tipo_interaccion: payload.tipo_interaccion,
    agente: payload.agente,
    cuenta_id: payload.cuenta_id,
    tipificacion_agente: meta.tipificacion_agente,
    numero_caso: meta.numero_caso === null || meta.numero_caso === undefined ? '' : meta.numero_caso,
    estado_caso: meta.estado_caso,
    escalado: meta.escalado ? 'si' : 'no',
    campos_capturados_json: JSON.stringify(meta.campos_capturados),
    mensajes_json: JSON.stringify(payload.mensajes),
    total_mensajes: payload.mensajes.length,
    version_reglas: versiones.version_reglas,
    version_prompt: versiones.version_prompt,
    estado: 'pendiente',
    intentos: 0,
    recibido_en: marca,
    actualizado_en: marca,
    id_evaluacion: '',
  };
}

/**
 * Decide qué hace Ingesta con un payload ya validado.
 *
 * Entradas:
 *   payload           payload válido (paso 2 de Ingesta).
 *   lote              lote ya validado (si viene vacío se usa config.lote_por_defecto).
 *   config            config cargada para el `tipo_interaccion` del payload.
 *   filasExistentes   filas de `conversaciones` (basta con las de este conversation_id).
 *   ahora             Date del momento de recepción.
 *   opciones.nodo     nombre del nodo que registra el error (opcional).
 *
 * Devuelve siempre { accion, lote, llave_dedup, evaluar, ... } con accion:
 *   'sin_rubrica'  el tipo no tiene rúbrica: NO se inserta. Trae `registrar_error` (para
 *                  filaLogErrores) y `enviar_alerta` (verdadero solo si
 *                  config.alerta_tipo_interaccion_sin_rubrica = si).
 *   'duplicado'    la llave ya existe con estado distinto de `error` (incluido `reproceso`: ya
 *                  está en la cola). No se escribe nada.
 *   'reutilizar'   la llave existe en estado `error`: vuelve a `pendiente` y suma 1 a `intentos`
 *                  (SUPUESTO del contrato). Trae `actualizacion`.
 *   'insertar'     llave nueva: trae `fila` (21 columnas).
 * `evaluar` indica si, después, hay que llamar a Evaluación (solo en insertar y reutilizar).
 */
function decidirIngesta({ payload, lote, config, filasExistentes = [], ahora = new Date(), opciones = {} }) {
  const loteFinal = lote === undefined || lote === null || lote === '' ? config.lote_por_defecto : lote;
  if (!PATRON_LOTE.test(loteFinal)) throw new Error(`lote inválido: ${JSON.stringify(loteFinal)}`);
  const versiones = { version_reglas: config.version_reglas, version_prompt: config.version_prompt };

  // Tipo sin rúbrica (hoy `sales`): no hay versión con la que formar la llave.
  if (versiones.version_reglas === SIN_RUBRICA || versiones.version_prompt === SIN_RUBRICA) {
    return {
      accion: 'sin_rubrica',
      lote: loteFinal,
      llave_dedup: null,
      evaluar: false,
      enviar_alerta: esVerdadero(config.alerta_tipo_interaccion_sin_rubrica),
      registrar_error: {
        workflow: 'ingesta',
        nodo: opciones.nodo || 'Decidir ingesta',
        tipo_error: 'tipo_interaccion_sin_rubrica',
        mensaje_error: `El tipo_interaccion ${payload.tipo_interaccion} no tiene rúbrica activa (version_reglas = ${SIN_RUBRICA}); la conversación no se guarda ni se evalúa`,
        conversation_id: payload.conversation_id,
        lote: loteFinal,
        tipo_interaccion: payload.tipo_interaccion,
        detalle: { version_reglas: versiones.version_reglas, version_prompt: versiones.version_prompt },
      },
    };
  }

  const llave = llaveDedup(payload.conversation_id, versiones.version_reglas, versiones.version_prompt);
  const evaluar = debeEvaluarAlIngerir(loteFinal, config);
  const existente = filasExistentes.find((f) => f.llave_dedup === llave);

  if (existente) {
    if (existente.estado !== 'error') return { accion: 'duplicado', lote: loteFinal, llave_dedup: llave, evaluar: false, estado_existente: existente.estado };
    return {
      accion: 'reutilizar',
      lote: loteFinal,
      llave_dedup: llave,
      evaluar,
      actualizacion: {
        llave_dedup: llave,
        estado: 'pendiente',
        intentos: (Number(existente.intentos) || 0) + 1,
        actualizado_en: marcaTiempoSistema(ahora, config.zona_horaria),
      },
    };
  }

  return { accion: 'insertar', lote: loteFinal, llave_dedup: llave, evaluar, fila: filaConversaciones(payload, loteFinal, versiones, config, ahora) };
}

// ---------------------------------------------------------------------------
// Disparador manual de calibración
// ---------------------------------------------------------------------------

/**
 * Prepara la ejecución manual de un lote con una versión de reglas y de prompt.
 *
 * Para cada conversation_id del lote que NO tiene fila con la nueva llave, crea una fila
 * `pendiente` copiando las columnas 2 a 14 de una fila existente (la de `recibido_en` más
 * antigua). Así se puede reevaluar el mismo lote con otra versión sin regenerar ni reenviar nada.
 * Después devuelve la lista de llaves `pendiente` de ese lote y versión (las nuevas y las que ya
 * existían pendientes) para que el workflow las pase UNA POR UNA a Evaluación.
 *
 * Devuelve { valido, errores, advertencias, filas_nuevas, llaves_pendientes }.
 */
function planificarCalibracionManual({ lote, version_reglas: versionReglas, version_prompt: versionPrompt, filasConversaciones, config, ahora = new Date() }) {
  const errores = [];
  if (!PATRON_LOTE.test(lote || '')) errores.push(`lote inválido: ${JSON.stringify(lote)}`);
  if (!PATRON_VERSION_REGLAS.test(versionReglas || '')) errores.push(`version_reglas inválida o sin rúbrica: ${JSON.stringify(versionReglas)}`);
  if (!PATRON_VERSION_PROMPT.test(versionPrompt || '')) errores.push(`version_prompt inválida o sin rúbrica: ${JSON.stringify(versionPrompt)}`);
  if (errores.length) return { valido: false, errores, advertencias: [], filas_nuevas: [], llaves_pendientes: [] };

  const delLote = filasConversaciones.filter((f) => f.lote === lote);
  if (delLote.length === 0) {
    return { valido: false, errores: [`no hay conversaciones del lote ${lote} en la hoja conversaciones`], advertencias: [], filas_nuevas: [], llaves_pendientes: [] };
  }

  // Tipo de interacción al que pertenece la rúbrica pedida (reglas_ce_v1 -> ce).
  const tipoRubrica = versionReglas.split('_')[1];
  const marca = marcaTiempoSistema(ahora, config.zona_horaria);

  // Fila origen por conversación: la recibida primero (las marcas ISO con el mismo desfase se
  // ordenan como texto; si empatan, gana la que aparece antes en la hoja).
  const origen = new Map();
  for (const fila of delLote) {
    const actual = origen.get(fila.conversation_id);
    if (!actual || String(fila.recibido_en) < String(actual.recibido_en)) origen.set(fila.conversation_id, fila);
  }

  const advertencias = [];
  const filasNuevas = [];
  const llavesPendientes = [];
  const idsOrdenados = [...origen.keys()].sort();
  for (const id of idsOrdenados) {
    const fuente = origen.get(id);
    if (fuente.tipo_interaccion !== tipoRubrica) {
      advertencias.push(`${id}: tipo_interaccion ${fuente.tipo_interaccion} no corresponde a ${versionReglas}; se omite`);
      continue;
    }
    const llave = llaveDedup(id, versionReglas, versionPrompt);
    const existente = delLote.find((f) => f.llave_dedup === llave);
    if (existente) {
      if (existente.estado === 'pendiente') llavesPendientes.push(llave);
      continue;
    }
    const fila = { llave_dedup: llave };
    for (const columna of COLUMNAS_DATOS_CONVERSACION) fila[columna] = fuente[columna];
    Object.assign(fila, {
      version_reglas: versionReglas,
      version_prompt: versionPrompt,
      estado: 'pendiente',
      intentos: 0,
      recibido_en: fuente.recibido_en, // copia de la fila origen (sheets.md)
      actualizado_en: marca,
      id_evaluacion: '',
    });
    // Mismo orden de columnas que la hoja.
    filasNuevas.push(Object.fromEntries(COLUMNAS_CONVERSACIONES.map((c) => [c, fila[c]])));
    llavesPendientes.push(llave);
  }
  return { valido: true, errores: [], advertencias, filas_nuevas: filasNuevas, llaves_pendientes: llavesPendientes };
}

// ---------------------------------------------------------------------------
// W2: cambios de estado de la fila de `conversaciones`
// ---------------------------------------------------------------------------

/**
 * Entrada a evaluación: la fila pasa a `en_evaluacion` y `intentos` sube 1 (W2 es quien lo hace;
 * W4 no). `intentos` llega como texto desde Sheets.
 */
function actualizacionEntradaEvaluacion(fila, config, ahora = new Date()) {
  return {
    llave_dedup: fila.llave_dedup,
    estado: 'en_evaluacion',
    intentos: (Number(fila.intentos) || 0) + 1,
    actualizado_en: marcaTiempoSistema(ahora, config.zona_horaria),
  };
}

const ESTADOS_FINALES_EVALUACION = ['evaluada', 'reproceso', 'error'];

/**
 * Cambio de estado al terminar la evaluación: `evaluada`, `reproceso` o `error`. `id_evaluacion`
 * solo se escribe con `evaluada` (es el ID de la evaluación guardada); con otro estado se rechaza.
 */
function actualizacionEstadoEvaluacion(llaveDedup, estado, config, ahora = new Date(), idEvaluacion = '') {
  if (!ESTADOS_FINALES_EVALUACION.includes(estado)) {
    throw new Error(`estado inválido para terminar una evaluación: ${JSON.stringify(estado)}; opciones: ${ESTADOS_FINALES_EVALUACION.join(', ')}`);
  }
  if (estado !== 'evaluada' && idEvaluacion !== '' && idEvaluacion !== undefined && idEvaluacion !== null) {
    throw new Error(`id_evaluacion solo se escribe con el estado evaluada (llegó con ${estado})`);
  }
  const actualizacion = { llave_dedup: llaveDedup, estado, actualizado_en: marcaTiempoSistema(ahora, config.zona_horaria) };
  if (estado === 'evaluada') actualizacion.id_evaluacion = idEvaluacion || '';
  return actualizacion;
}

// ---------------------------------------------------------------------------
// W4 Reproceso
// ---------------------------------------------------------------------------

/**
 * Peor caso de duración de una evaluación en W2, en segundos (config.md, `evaluacion_tiempo_maximo_min`):
 *   llamadas al LLM = 1 + reintentos_respuesta_incompleta + reintentos_validacion_llm
 *   cada llamada <= (reintentos_conexion_api + 1) x tiempo_maximo_peticion_llm_ms / 1000
 *                   + reintentos_conexion_api x espera_maxima_reintento_ms / 1000
 * `evaluacion_tiempo_maximo_min` x 60 debe ser mayor que este número (regla del dueño); una prueba lo
 * comprueba con los valores de datos/config.csv.
 */
function peorCasoDuracionEvaluacionSeg(config) {
  const llamadas = 1 + config.reintentos_respuesta_incompleta + config.reintentos_validacion_llm;
  const porLlamada =
    (config.reintentos_conexion_api + 1) * (config.tiempo_maximo_peticion_llm_ms / 1000) + config.reintentos_conexion_api * (config.espera_maxima_reintento_ms / 1000);
  return llamadas * porLlamada;
}

/**
 * Decide qué hacer con UNA fila de `conversaciones` leída por W4.
 *
 * Filas `reproceso`: si `intentos` <= config.reproceso_max_intentos se reenvía a Evaluación (W2
 * pondrá `en_evaluacion` y sumará el intento; W4 NO). Si no, la fila pasa a `error` (solo se
 * escribe `estado` y `actualizado_en`), se registra en `log_errores` y se envía alerta operativa.
 * Con el valor 3: 1 evaluación original + hasta 3 reenvíos.
 *
 * Filas `en_evaluacion` ATASCADAS (W2 murió sin dejar rastro): si (ahora - actualizado_en) es MAYOR
 * que config.evaluacion_tiempo_maximo_min, la acción es `marcar_atascada`: actualización a
 * `reproceso` (sin sumar intentos) y registro en log_errores (`fallo_nodo`, sin alerta), y
 * `reenviar: true` porque, enseguida, se aplica el MISMO límite: si `intentos` ya superó
 * `reproceso_max_intentos`, la acción es `pasar_a_error` (con `atascada: true`). Si no está atascada
 * (o su `actualizado_en` no se puede leer), `ignorar`.
 *
 * Otros estados: `ignorar`.
 *
 * SUPUESTO: el contrato no define un tipo_error específico para "reproceso agotado"; se usa
 * `fallo_api` (la causa principal de la cola de reproceso, config.md sección 13). Se puede pasar
 * otro valor del glosario en `opciones.tipo_error`. Una fila atascada que agota los reenvíos usa
 * `fallo_nodo`.
 */
function decidirReproceso(fila, config, ahora = new Date(), opciones = {}) {
  const intentos = Number(fila.intentos) || 0;
  const marca = marcaTiempoSistema(ahora, config.zona_horaria);
  let atascada = false;

  if (fila.estado === 'en_evaluacion') {
    const desde = Date.parse(fila.actualizado_en);
    if (Number.isNaN(desde)) return { accion: 'ignorar', llave_dedup: fila.llave_dedup, motivo: 'actualizado_en no se puede leer' };
    const minutos = (ahora.getTime() - desde) / 60000;
    if (!(minutos > config.evaluacion_tiempo_maximo_min)) return { accion: 'ignorar', llave_dedup: fila.llave_dedup };
    atascada = true;
  } else if (fila.estado !== 'reproceso') {
    return { accion: 'ignorar', llave_dedup: fila.llave_dedup };
  }

  if (intentos <= config.reproceso_max_intentos) {
    if (!atascada) return { accion: 'reenviar', llave_dedup: fila.llave_dedup, conversation_id: fila.conversation_id, intentos };
    return {
      accion: 'marcar_atascada',
      llave_dedup: fila.llave_dedup,
      conversation_id: fila.conversation_id,
      intentos,
      reenviar: true,
      enviar_alerta: false,
      actualizacion: { llave_dedup: fila.llave_dedup, estado: 'reproceso', actualizado_en: marca },
      registrar_error: {
        workflow: 'reproceso',
        nodo: opciones.nodo || 'Decidir reproceso',
        tipo_error: 'fallo_nodo',
        mensaje_error: `La conversación llevaba más de ${config.evaluacion_tiempo_maximo_min} minutos en en_evaluacion; se pasa a reproceso`,
        conversation_id: fila.conversation_id,
        lote: fila.lote,
        tipo_interaccion: fila.tipo_interaccion,
        detalle: { llave_dedup: fila.llave_dedup, intentos, evaluacion_tiempo_maximo_min: config.evaluacion_tiempo_maximo_min },
      },
    };
  }

  return {
    accion: 'pasar_a_error',
    llave_dedup: fila.llave_dedup,
    conversation_id: fila.conversation_id,
    intentos,
    atascada,
    actualizacion: { llave_dedup: fila.llave_dedup, estado: 'error', actualizado_en: marca },
    enviar_alerta: true,
    registrar_error: {
      workflow: 'reproceso',
      nodo: opciones.nodo || 'Decidir reproceso',
      tipo_error: atascada ? 'fallo_nodo' : opciones.tipo_error || 'fallo_api',
      mensaje_error: `La conversación agotó los reenvíos de reproceso (intentos ${intentos}, máximo ${config.reproceso_max_intentos})${atascada ? ' y estaba atascada en en_evaluacion' : ''}; pasa a error`,
      conversation_id: fila.conversation_id,
      lote: fila.lote,
      tipo_interaccion: fila.tipo_interaccion,
      detalle: { llave_dedup: fila.llave_dedup, intentos, reproceso_max_intentos: config.reproceso_max_intentos, atascada },
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLUMNAS_CONVERSACIONES,
    COLUMNAS_DATOS_CONVERSACION,
    marcaTiempoSistema,
    llaveDedup,
    debeEvaluarAlIngerir,
    filaConversaciones,
    decidirIngesta,
    planificarCalibracionManual,
    peorCasoDuracionEvaluacionSeg,
    decidirReproceso,
    actualizacionEntradaEvaluacion,
    actualizacionEstadoEvaluacion,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n
 * Pega TODO este archivo y, debajo, el bloque que corresponda sin comentar.
 *
 * --- W1 Ingesta, nodo Code "Decidir ingesta" (Run Once for Each Item) ---
 * const config = $('Config cargada').first().json;               // cargarConfig(filas, tipo del payload)
 * const existentes = $('Leer conversaciones').all().map((i) => i.json);
 * return { json: decidirIngesta({ payload: $json.payload, lote: $json.lote, config, filasExistentes: existentes, ahora: new Date() }) };
 * // Después, un Switch por `accion`: insertar -> Sheets (append `fila`); reutilizar -> Sheets
 * // (update `actualizacion`); sin_rubrica -> log_errores (+ alerta si enviar_alerta); duplicado -> nada.
 *
 * --- W1 disparador manual, nodo Code "Planificar calibración" (Run Once for All Items) ---
 * const config = $('Config cargada').first().json;
 * const filas = $('Leer conversaciones').all().map((i) => i.json);
 * const p = $('Parametros').first().json;                        // lote, version_reglas, version_prompt
 * return [{ json: planificarCalibracionManual({ ...p, filasConversaciones: filas, config, ahora: new Date() }) }];
 *
 * --- W4 Reproceso, nodo Code "Decidir reproceso" (Run Once for Each Item) ---
 * const config = $('Config cargada').first().json;
 * return { json: decidirReproceso($json, config, new Date()) };
 *
 * --- W2, nodos Code de estado (Run Once for Each Item) ---
 * return { json: actualizacionEntradaEvaluacion($json, config, new Date()) };            // al entrar
 * return { json: actualizacionEstadoEvaluacion($json.llave_dedup, 'evaluada', config, new Date(), $json.id_evaluacion) };
 * //   (estado: 'evaluada' | 'reproceso' | 'error'; id_evaluacion solo con 'evaluada')
 * ------------------------------------------------------------------------- */
