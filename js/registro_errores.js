/**
 * Registro de errores (hoja `log_errores`) para todos los workflows y el workflow de errores (WE).
 *
 * Qué hace este archivo:
 *  - Arma la fila de `log_errores` con las 11 columnas exactas de contrato/sheets.md.
 *  - Genera el `id_error` con el formato ERR-AAAAMMDD-HHMMSS-nnn (glosario, sección 2).
 *  - Limpia el mensaje y el detalle: nunca deben llevar datos personales ni credenciales
 *    (sheets.md, columnas `mensaje_error` y `detalle_json`). Es una defensa de último recurso:
 *    el texto de un error de n8n puede traer pedazos de la petición (un correo, un token).
 *  - Convierte lo que entrega el nodo Error Trigger de n8n en los campos del contrato.
 *
 * Decisión sobre `marcaTiempoSistema`: n8n no permite `require` entre nodos, así que esta
 * función se DUPLICA aquí (la original está en js/costo.js). Una prueba comprueba que ambas
 * dan siempre el mismo resultado. Así las funciones de este archivo reciben `ahora` (un Date)
 * y la zona sale de `config.zona_horaria`; el pegamento solo escribe `new Date()`.
 */

// Valores permitidos (glosario, sección 4). Son del contrato, no de la configuración editable.
const TIPOS_ERROR = [
  'payload_invalido',
  'tipo_interaccion_sin_rubrica',
  'evaluacion_sin_secciones_aplicables',
  'respuesta_llm_invalida',
  'fallo_nodo',
  'fallo_api',
  'fallo_sheets',
  'fallo_telegram',
  'generacion_invalida',
  'formulario_invalido',
];
const WORKFLOWS = ['simulador', 'ingesta', 'evaluacion', 'errores', 'metricas', 'reproceso'];
const TIPOS_INTERACCION = ['ce', 'sales'];

// Columnas de `log_errores`, en el orden de sheets.md.
const COLUMNAS_LOG_ERRORES = [
  'id_error',
  'ocurrido_en',
  'workflow',
  'nodo',
  'tipo_error',
  'mensaje_error',
  'conversation_id',
  'lote',
  'tipo_interaccion',
  'detalle_json',
  'alerta_enviada',
];

// Límites técnicos de seguridad (no son reglas de negocio): evitan celdas gigantes en Sheets.
const LONGITUD_MAXIMA_MENSAJE = 500;
const LONGITUD_MAXIMA_DETALLE = 5000;

/**
 * Marca de tiempo del sistema ISO 8601 con desfase (copia de js/costo.js; ver nota arriba).
 */
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

/**
 * ID con prefijo, fecha, hora y consecutivo: PREFIJO-AAAAMMDD-HHMMSS-nnn.
 * La fecha y la hora salen de la marca de tiempo del sistema (hora local de config).
 * `consecutivo` (1 a 999) distingue varios errores en el mismo segundo; el pegamento puede usar
 * el número de ítem + 1.
 */
function generarIdConConsecutivo(prefijo, ahora, zonaHoraria, consecutivo = 1) {
  if (!Number.isInteger(consecutivo) || consecutivo < 1 || consecutivo > 999) {
    throw new Error(`consecutivo debe ser un entero de 1 a 999 y vale ${JSON.stringify(consecutivo)}`);
  }
  const marca = marcaTiempoSistema(ahora, zonaHoraria); // 2026-10-21T10:02:11-06:00
  const fecha = marca.slice(0, 10).replace(/-/g, '');
  const hora = marca.slice(11, 19).replace(/:/g, '');
  return `${prefijo}-${fecha}-${hora}-${String(consecutivo).padStart(3, '0')}`;
}

function generarIdError(ahora, zonaHoraria, consecutivo = 1) {
  return generarIdConConsecutivo('ERR', ahora, zonaHoraria, consecutivo);
}

// ---------------------------------------------------------------------------
// Limpieza de datos personales y credenciales
// ---------------------------------------------------------------------------

// Se aplican EN ESTE ORDEN: primero las credenciales (un token de Telegram empieza con dígitos y
// podría confundirse con un teléfono) y después los datos personales.
const PATRONES_LIMPIEZA = [
  // Token de bot de Telegram: 6+ dígitos, dos puntos y una cadena larga.
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTADO]'],
  // Llaves tipo sk-... (OpenAI) o sk-ant-... (Anthropic).
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTADO]'],
  // Encabezado Authorization.
  [/\bBearer\s+\S+/gi, 'Bearer [REDACTADO]'],
  // clave=valor o clave: valor para nombres típicos de credenciales.
  [/\b(api[_-]?key|x-api-key|token|secret|password|contrasena|authorization)(["']?\s*[:=]\s*)["']?[^\s,;"'}]+/gi, '$1$2[REDACTADO]'],
  // Cualquier cadena larga sin espacios (parece una llave).
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTADO]'],
  // Datos personales (los mismos que enmascara JS-2).
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}\b/gi, '[RFC]'],
  [/(?<![0-9])(?:[0-9][\s\-()]*){10}(?![0-9])/g, '[TELEFONO]'],
];

/**
 * Deja un texto seguro para guardarlo en Sheets o enviarlo por Telegram: sin credenciales,
 * sin correos/RFC/teléfonos, en una sola línea y con longitud máxima.
 */
function limpiarTexto(texto, maximo = LONGITUD_MAXIMA_MENSAJE) {
  let t = texto === undefined || texto === null ? '' : String(texto);
  for (const [patron, reemplazo] of PATRONES_LIMPIEZA) t = t.replace(patron, reemplazo);
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > maximo ? `${t.slice(0, maximo - 1)}…` : t;
}

// Claves cuyo valor jamás se copia al detalle.
const CLAVES_CREDENCIAL = /(password|contrasena|token|secret|authorization|api[_-]?key|credencial)/i;
// Claves que contienen la conversación o la petición completa (datos personales sin enmascarar).
const CLAVES_CONTENIDO = /^(mensajes|mensajes_json|texto|payload|body|headers|campos_capturados_json)$/i;

/** Copia recursiva del detalle aplicando las dos reglas anteriores y limpiando los textos. */
function limpiarDetalle(valor, profundidad = 0) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return limpiarTexto(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (profundidad >= 5) return '[PROFUNDIDAD_MAXIMA]';
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => limpiarDetalle(v, profundidad + 1));
  if (typeof valor === 'object') {
    const salida = {};
    for (const [clave, v] of Object.entries(valor)) {
      if (CLAVES_CREDENCIAL.test(clave)) salida[clave] = '[REDACTADO]';
      else if (CLAVES_CONTENIDO.test(clave)) salida[clave] = '[OMITIDO]';
      else salida[clave] = limpiarDetalle(v, profundidad + 1);
    }
    return salida;
  }
  return String(valor);
}

/** Detalle como JSON para la celda `detalle_json`; vacío si no hay detalle. */
function detalleComoJson(detalle) {
  if (detalle === undefined || detalle === null) return '';
  const texto = JSON.stringify(limpiarDetalle(detalle));
  if (texto.length <= LONGITUD_MAXIMA_DETALLE) return texto;
  // Demasiado largo: se guarda un aviso en lugar de un JSON cortado a la mitad (inválido).
  return JSON.stringify({ truncado: true, longitud_original: texto.length });
}

// ---------------------------------------------------------------------------
// Fila de log_errores
// ---------------------------------------------------------------------------

/**
 * Fila de `log_errores` (11 columnas exactas).
 *
 * datos: { workflow, nodo, tipo_error, mensaje_error, conversation_id, lote, tipo_interaccion,
 *          detalle, alerta_enviada, consecutivo }
 *
 * Criterio ante valores inválidos: el registro de errores NO debe fallar por culpa del error que
 * registra. Si `tipo_error` no es del glosario se guarda `fallo_nodo` y el valor original va en el
 * detalle. Un `workflow` inválido sí es un error de programación y lanza excepción.
 * Los campos opcionales con formato inválido (conversation_id, lote, tipo_interaccion) quedan
 * vacíos, como dice el contrato para "no aplica".
 */
/** Los booleanos de config llegan como true/false (cargarConfig); se acepta también 'si'. */
function esVerdaderoConfig(valor) {
  return valor === true || valor === 'si';
}

/**
 * ¿Este tipo de error genera alerta operativa?
 *  - `formulario_invalido` (rechazo del formulario del simulador): NO, solo se registra.
 *  - `tipo_interaccion_sin_rubrica`: según config.alerta_tipo_interaccion_sin_rubrica.
 *  - cualquier otro: sí.
 * (Copia en js/alertas.js; una prueba verifica que dan lo mismo.)
 */
function debeAlertar(tipoError, config) {
  if (tipoError === 'formulario_invalido') return false;
  if (tipoError === 'tipo_interaccion_sin_rubrica') return esVerdaderoConfig(config.alerta_tipo_interaccion_sin_rubrica);
  return true;
}

function filaLogErrores(datos, config, ahora = new Date()) {
  if (!WORKFLOWS.includes(datos.workflow)) {
    throw new Error(`workflow inválido para log_errores: ${JSON.stringify(datos.workflow)}`);
  }
  let tipoError = datos.tipo_error;
  let detalle = datos.detalle;
  if (!TIPOS_ERROR.includes(tipoError)) {
    detalle = { ...(typeof detalle === 'object' && detalle ? detalle : { detalle_original: detalle }), tipo_error_original: String(tipoError) };
    tipoError = 'fallo_nodo';
  }
  const conversationId = /^CONV-[0-9]{4,}$/.test(datos.conversation_id || '') ? datos.conversation_id : '';
  const lote = /^(demo|calibracion_v[0-9]+)$/.test(datos.lote || '') ? datos.lote : '';
  const tipoInteraccion = TIPOS_INTERACCION.includes(datos.tipo_interaccion) ? datos.tipo_interaccion : '';
  return {
    id_error: generarIdError(ahora, config.zona_horaria, datos.consecutivo || 1),
    ocurrido_en: marcaTiempoSistema(ahora, config.zona_horaria),
    workflow: datos.workflow,
    nodo: limpiarTexto(datos.nodo, 100),
    tipo_error: tipoError,
    mensaje_error: limpiarTexto(datos.mensaje_error),
    conversation_id: conversationId,
    lote,
    tipo_interaccion: tipoInteraccion,
    detalle_json: detalleComoJson(detalle),
    // Un tipo que no genera alerta nunca queda marcado como alertado.
    alerta_enviada: datos.alerta_enviada && debeAlertar(tipoError, config) ? 'si' : 'no',
  };
}

// ---------------------------------------------------------------------------
// Workflow de errores (WE): interpretar lo que entrega el Error Trigger de n8n
// ---------------------------------------------------------------------------

/**
 * Palabras que identifican al workflow por su nombre (sin acentos, en minúsculas). El orden
 * importa: se usa la primera que aparezca. SUPUESTO: depende de cómo nombre `workflows-n8n`
 * sus workflows; si ninguna coincide se usa `errores`.
 */
const PALABRAS_WORKFLOW = [
  ['simulador', 'simulador'],
  ['ingesta', 'ingesta'],
  ['evaluacion', 'evaluacion'],
  ['reproceso', 'reproceso'],
  ['metricas', 'metricas'],
  ['errores', 'errores'],
];

function sinAcentos(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function workflowDesdeNombre(nombre, palabras = PALABRAS_WORKFLOW) {
  const n = sinAcentos(nombre);
  const encontrada = palabras.find(([palabra]) => n.includes(palabra));
  return encontrada ? encontrada[1] : 'errores';
}

/**
 * Clasifica el tipo de error según el nodo que falló. Se mira el tipo de nodo de n8n
 * (por ejemplo `n8n-nodes-base.googleSheets`) y, si no, su nombre.
 */
function tipoErrorDesdeNodo(tipoNodo, nombreNodo, mensaje = '') {
  // Un error de nuestro propio código empieza con su tipo entre corchetes, por ejemplo
  // "[evaluacion_sin_secciones_aplicables] todas las secciones...". Tiene prioridad.
  const marcado = /^\s*\[([a-z_]+)\]/.exec(String(mensaje || ''));
  if (marcado && TIPOS_ERROR.includes(marcado[1])) return marcado[1];
  const t = sinAcentos(`${tipoNodo || ''} ${nombreNodo || ''}`);
  if (t.includes('sheets')) return 'fallo_sheets';
  if (t.includes('telegram')) return 'fallo_telegram';
  if (/(httprequest|http request|openai|anthropic|claude)/.test(t)) return 'fallo_api';
  return 'fallo_nodo';
}

/**
 * Convierte la salida del nodo Error Trigger de n8n en los campos de `log_errores`.
 *
 * entrada (forma estándar de n8n):
 *   { execution: { id, error: { message, node: { name, type } }, lastNodeExecuted },
 *     workflow: { id, name } }
 * Opcional: `conversationId`, si el pegamento pudo recuperarla de la ejecución. Si no, se busca
 * un CONV-nnnn dentro del texto del error.
 * Devuelve datos listos para `filaLogErrores` (le falta `alerta_enviada` y `consecutivo`).
 */
function analizarErrorTrigger(entrada, conversationId = '', opciones = {}) {
  const ejecucion = (entrada && entrada.execution) || {};
  const error = ejecucion.error || {};
  const nodo = error.node || {};
  const nombreNodo = nodo.name || ejecucion.lastNodeExecuted || '';
  const mensajeCrudo = error.message || 'Error sin mensaje';
  const encontrado = (String(mensajeCrudo).match(/CONV-[0-9]{4,}/) || [])[0];
  const workflow = (entrada && entrada.workflow) || {};
  const workflowEnum = workflowDesdeNombre(workflow.name);

  // Si falló W2 y se conoce la conversación (llave_dedup en opciones o dentro del mensaje), la fila de
  // `conversaciones` pasa a `reproceso` (solo estado y actualizado_en). Misma forma que
  // actualizacionEstadoEvaluacion(llave, 'reproceso', config, ahora) de js/ingesta.js (prueba de igualdad).
  let actualizacion = null;
  const llave = opciones.llave_dedup || (String(mensajeCrudo).match(/CONV-[0-9]{4,}\|reglas_(?:ce|sales)_v[0-9]+\|evaluador_(?:ce|sales)_v[0-9]+/) || [])[0];
  if (workflowEnum === 'evaluacion' && llave && opciones.config) {
    actualizacion = {
      llave_dedup: llave,
      estado: 'reproceso',
      actualizado_en: marcaTiempoSistema(opciones.ahora || new Date(), opciones.config.zona_horaria),
    };
  }
  const idDeLlave = llave ? String(llave).split('|')[0] : '';
  return {
    workflow: workflowEnum,
    nodo: nombreNodo,
    tipo_error: tipoErrorDesdeNodo(nodo.type, nombreNodo, mensajeCrudo),
    mensaje_error: mensajeCrudo,
    conversation_id: conversationId || encontrado || idDeLlave || '',
    detalle: { id_ejecucion: ejecucion.id, nombre_workflow: workflow.name, tipo_nodo: nodo.type },
    actualizacion_conversacion: actualizacion,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TIPOS_ERROR,
    WORKFLOWS,
    COLUMNAS_LOG_ERRORES,
    marcaTiempoSistema,
    generarIdConConsecutivo,
    generarIdError,
    limpiarTexto,
    limpiarDetalle,
    detalleComoJson,
    debeAlertar,
    filaLogErrores,
    workflowDesdeNombre,
    tipoErrorDesdeNodo,
    analizarErrorTrigger,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "Fila log_errores", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * // En el workflow de errores (Error Trigger):
 * const datos = analizarErrorTrigger($json);
 * // En cualquier otro workflow: datos = { workflow: 'ingesta', nodo: '...', tipo_error: '...',
 * //   mensaje_error: '...', conversation_id: $json.conversation_id, lote: $json.lote, detalle: {...} };
 * const config = $('Config cargada').first().json;
 * return { json: filaLogErrores({ ...datos, alerta_enviada: true, consecutivo: $itemIndex + 1 }, config, new Date()) };
 * ------------------------------------------------------------------------- */
