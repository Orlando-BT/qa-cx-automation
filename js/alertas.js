/**
 * Alertas de Telegram: textos, modo de envío y fila de la hoja `alertas`.
 *
 * Este archivo NO envía nada: el envío lo hace el nodo Telegram de n8n. Aquí vive todo lo que se
 * decide con reglas: qué texto lleva cada tipo de alerta, si se envía de inmediato o en un
 * resumen de lote, y cómo se registra en `alertas` (17 columnas exactas de contrato/sheets.md).
 *
 * Tipos (glosario `tipo_alerta`): operativa, calidad, costo, calibracion.
 *
 * Reglas de contenido (CLAUDE.md, sección Alertas):
 *  - Calidad: ID de conversación, agente, tipo de error, número(s) de mensaje y evidencia YA
 *    enmascarada. Por seguridad, la evidencia se vuelve a limpiar aquí.
 *  - Modo de calidad por lote (config.md sección 12): lote `demo` -> `alerta_calidad_modo_lote_demo`
 *    (inmediato); cualquier otro -> `alerta_calidad_modo_otros_lotes` (resumen_lote).
 *  - `texto` es texto plano (es lo que se guarda en alertas.texto_enviado). Cada alerta trae además
 *    `texto_html`: el mismo texto con &, < y > escapados, para el nodo Telegram con parse_mode HTML
 *    (así guiones bajos, asteriscos o etiquetas de la evidencia no se interpretan como formato).
 *    `texto_html` es un campo intermedio de n8n, no una columna de ninguna hoja.
 *
 * Decisión sobre código duplicado (n8n no permite `require` entre nodos): `marcaTiempoSistema`
 * (de js/costo.js) y `limpiarTexto` (de js/registro_errores.js) se copian aquí; js/tests/
 * registro_alertas.test.js comprueba que las copias se comportan igual que los originales.
 */

const TIPOS_ALERTA = ['operativa', 'calidad', 'costo', 'calibracion'];
const MODOS_ENVIO = ['inmediato', 'resumen_lote'];
const ESTADOS_ENVIO = ['enviada', 'fallida'];
const WORKFLOWS = ['simulador', 'ingesta', 'evaluacion', 'errores', 'metricas', 'reproceso'];
const NOMBRES_METRICA = [
  'acuerdo',
  'kappa_cohen',
  'falsos_positivos',
  'falsos_negativos',
  'diferencia_promedio_nota',
  'precision_criticos',
  'recall_criticos',
  'costo_promedio_evaluacion',
  'tasa_fallos',
  'acuerdo_generador_humano',
];

// Columnas de `alertas`, en el orden de sheets.md.
const COLUMNAS_ALERTAS = [
  'id_alerta',
  'enviada_en',
  'tipo_alerta',
  'modo_envio',
  'workflow',
  'conversation_id',
  'lote',
  'agente',
  'id_criterio',
  'nombre_metrica',
  'mensajes',
  'evidencia',
  'valor_observado',
  'umbral',
  'texto_enviado',
  'destinatario',
  'estado_envio',
];

// Telegram rechaza mensajes de más de 4096 caracteres (límite de su API, no una regla de negocio).
const LIMITE_TELEGRAM = 4096;
const LONGITUD_MAXIMA_EVIDENCIA = 300;

// ---------------------------------------------------------------------------
// Copias de utilidades (ver nota de duplicación arriba)
// ---------------------------------------------------------------------------

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

const PATRONES_LIMPIEZA = [
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTADO]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTADO]'],
  [/\bBearer\s+\S+/gi, 'Bearer [REDACTADO]'],
  [/\b(api[_-]?key|x-api-key|token|secret|password|contrasena|authorization)(["']?\s*[:=]\s*)["']?[^\s,;"'}]+/gi, '$1$2[REDACTADO]'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTADO]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}\b/gi, '[RFC]'],
  [/(?<![0-9])(?:[0-9][\s\-()]*){10}(?![0-9])/g, '[TELEFONO]'],
];

function limpiarTexto(texto, maximo = 500) {
  let t = texto === undefined || texto === null ? '' : String(texto);
  for (const [patron, reemplazo] of PATRONES_LIMPIEZA) t = t.replace(patron, reemplazo);
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > maximo ? `${t.slice(0, maximo - 1)}…` : t;
}

function generarIdAlerta(ahora, zonaHoraria, consecutivo = 1) {
  if (!Number.isInteger(consecutivo) || consecutivo < 1 || consecutivo > 999) {
    throw new Error(`consecutivo debe ser un entero de 1 a 999 y vale ${JSON.stringify(consecutivo)}`);
  }
  const marca = marcaTiempoSistema(ahora, zonaHoraria);
  return `ALR-${marca.slice(0, 10).replace(/-/g, '')}-${marca.slice(11, 19).replace(/:/g, '')}-${String(consecutivo).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Modo de envío de las alertas de calidad
// ---------------------------------------------------------------------------

/**
 * `demo` -> modo simulador (inmediato); cualquier otro lote -> modo lote (resumen).
 * Los dos valores salen de config; si alguien los edita con un valor que no es del glosario, se
 * detiene con un error claro en lugar de enviar a medias.
 */
function modoAlertaCalidad(lote, config) {
  const modo = lote === 'demo' ? config.alerta_calidad_modo_lote_demo : config.alerta_calidad_modo_otros_lotes;
  if (!MODOS_ENVIO.includes(modo)) {
    throw new Error(`modo de alerta de calidad inválido en config para el lote ${JSON.stringify(lote)}: ${JSON.stringify(modo)}`);
  }
  return modo;
}

// ---------------------------------------------------------------------------
// Textos por tipo de alerta
// ---------------------------------------------------------------------------

/**
 * Escapa texto para parse_mode HTML de Telegram: solo &, < y >. El & va PRIMERO para no volver
 * a escapar los & que producen los otros dos reemplazos.
 */
function escaparHtml(texto) {
  return String(texto === undefined || texto === null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Une las líneas que tienen valor (las vacías se omiten). */
function unirLineas(lineas) {
  return lineas.filter((l) => l !== null && l !== undefined && l !== '').join('\n');
}

function lineaConversacion(conversationId, lote) {
  if (!conversationId && !lote) return '';
  return `Conversación: ${conversationId || 'n/a'}${lote ? ` (lote ${lote})` : ''}`;
}

/**
 * Alerta operativa: fallo de un workflow, payload inválido, respuesta del LLM inválida tras los
 * reintentos, conversación que pasa a error en reproceso. Envío inmediato.
 * datos: { workflow, nodo, tipo_error, mensaje_error, conversation_id, lote, id_error }
 */
function textoAlertaOperativa(datos) {
  return unirLineas([
    'ALERTA OPERATIVA',
    `Workflow: ${datos.workflow}`,
    datos.nodo ? `Nodo: ${limpiarTexto(datos.nodo, 100)}` : '',
    `Tipo de error: ${datos.tipo_error}`,
    lineaConversacion(datos.conversation_id, datos.lote),
    `Detalle: ${limpiarTexto(datos.mensaje_error, 300)}`,
    datos.id_error ? `Registro: ${datos.id_error} (hoja log_errores)` : '',
  ]);
}

/**
 * Alerta de calidad por UN error crítico detectado.
 * datos: { conversation_id, lote, agente, id_criterio, mensajes: [n], evidencia }
 */
function textoAlertaCalidad(datos) {
  const mensajes = (datos.mensajes || []).join(', ');
  return unirLineas([
    'ALERTA DE CALIDAD: error crítico',
    lineaConversacion(datos.conversation_id, datos.lote),
    `Agente: ${limpiarTexto(datos.agente, 100) || 'n/a'}`,
    `Error: ${datos.id_criterio}`,
    `Mensaje(s): ${mensajes || 'n/a'}`,
    `Evidencia: ${limpiarTexto(datos.evidencia, LONGITUD_MAXIMA_EVIDENCIA) || 'n/a'}`,
  ]);
}

/**
 * Alerta de costo. ambito: 'evaluacion' (una conversación) o 'lote' (acumulado del lote).
 * datos: { ambito, conversation_id, lote, valor_observado, umbral }
 */
function textoAlertaCosto(datos) {
  const titulo = datos.ambito === 'lote' ? 'ALERTA DE COSTO: lote' : 'ALERTA DE COSTO: evaluación';
  return unirLineas([
    titulo,
    datos.ambito === 'lote' ? (datos.lote ? `Lote: ${datos.lote}` : '') : lineaConversacion(datos.conversation_id, datos.lote),
    `Costo observado: ${datos.valor_observado} USD`,
    `Umbral configurado: ${datos.umbral} USD`,
  ]);
}

/**
 * Alerta de calibración (solo la estructura; las métricas se calculan en la Fase 4).
 * datos: { nombre_metrica, valor_observado, umbral, lote, version_reglas, version_prompt }
 */
function textoAlertaCalibracion(datos) {
  if (!NOMBRES_METRICA.includes(datos.nombre_metrica)) {
    throw new Error(`nombre_metrica fuera del glosario: ${JSON.stringify(datos.nombre_metrica)}`);
  }
  return unirLineas([
    'ALERTA DE CALIBRACIÓN',
    datos.lote ? `Lote: ${datos.lote}` : '',
    datos.version_reglas ? `Versión de reglas: ${datos.version_reglas}` : '',
    datos.version_prompt ? `Versión de prompt: ${datos.version_prompt}` : '',
    `Métrica: ${datos.nombre_metrica}`,
    `Valor observado: ${datos.valor_observado}`,
    `Umbral configurado: ${datos.umbral}`,
  ]);
}

// ---------------------------------------------------------------------------
// Calidad: de la evaluación a las alertas
// ---------------------------------------------------------------------------

/**
 * Errores críticos detectados en una evaluación (objeto de evaluacion.schema.json).
 * Un elemento por error: id_criterio, números de mensaje y evidencia (ya enmascarada).
 */
function erroresCriticosDeEvaluacion(evaluacion) {
  return (evaluacion.criterios || [])
    .filter((c) => c.tipo_criterio === 'critico' && c.resultado === 'detectado')
    .map((c) => ({
      conversation_id: evaluacion.conversation_id,
      lote: evaluacion.lote,
      agente: evaluacion.agente,
      id_criterio: c.id_criterio,
      mensajes: (c.evidencia && c.evidencia.mensajes) || [],
      evidencia: limpiarTexto(c.evidencia && c.evidencia.dato, LONGITUD_MAXIMA_EVIDENCIA),
    }));
}

/**
 * Decide qué hacer con los errores críticos de una evaluación.
 *  - modo `inmediato` (lote demo): `envios` trae un mensaje por error, listo para enviar.
 *  - modo `resumen_lote` (otros lotes): `envios` queda vacío y `acumular` trae los errores que el
 *    workflow guarda hasta el final de la ejecución para `armarResumenCalidadLote`.
 * SUPUESTO: un mensaje por error crítico (no uno por conversación), porque la hoja `alertas`
 * tiene una sola columna `id_criterio`.
 */
function prepararAlertasCalidad(evaluacion, config) {
  const modo = modoAlertaCalidad(evaluacion.lote, config);
  const errores = erroresCriticosDeEvaluacion(evaluacion);
  if (modo === 'resumen_lote') return { modo_envio: modo, envios: [], acumular: errores };
  return {
    modo_envio: modo,
    acumular: [],
    envios: errores.map((e) => ({
      tipo_alerta: 'calidad',
      modo_envio: modo,
      workflow: 'evaluacion',
      conversation_id: e.conversation_id,
      lote: e.lote,
      agente: e.agente,
      id_criterio: e.id_criterio,
      mensajes: e.mensajes,
      evidencia: e.evidencia,
      texto: textoAlertaCalidad(e),
      texto_html: escaparHtml(textoAlertaCalidad(e)),
    })),
  };
}

/**
 * Resumen agrupado de un lote (modo `resumen_lote`). Una sola alerta con todos los errores
 * críticos. Si no hubo ninguno, no hay nada que enviar. Respeta el límite de Telegram.
 */
function armarResumenCalidadLote(errores, lote) {
  if (!errores || errores.length === 0) return { enviar: false, texto: '', texto_html: '', total_errores: 0, total_conversaciones: 0 };
  const conversaciones = new Set(errores.map((e) => e.conversation_id));
  const cabecera = unirLineas([
    `RESUMEN DE CALIDAD DEL LOTE ${lote}`,
    `Errores críticos detectados: ${errores.length} en ${conversaciones.size} conversación(es)`,
    '',
  ]);
  const lineas = errores.map((e) => {
    const msgs = (e.mensajes || []).join(', ') || 'n/a';
    return `- ${e.conversation_id} | ${limpiarTexto(e.agente, 60)} | ${e.id_criterio} | mensaje(s) ${msgs} | ${limpiarTexto(e.evidencia, 120)}`;
  });
  // El límite se mide sobre el texto YA ESCAPADO (texto_html), que es el que viaja a Telegram y
  // siempre es igual o más largo que el plano. Se cortan líneas completas, nunca a mitad de una
  // línea, así que tampoco se parte una entidad (&amp;, &lt;, &gt;). `texto` lleva exactamente las
  // mismas líneas, para que lo guardado en la hoja alertas sea el mismo contenido recortado.
  const armar = (n) => (n === lineas.length ? `${cabecera}\n${lineas.join('\n')}` : `${cabecera}\n${lineas.slice(0, n).join('\n')}\n... y ${lineas.length - n} más (ver hoja detalle_criterios)`);
  let incluidas = lineas.length;
  while (incluidas > 0 && escaparHtml(armar(incluidas)).length > LIMITE_TELEGRAM) incluidas--;
  const texto = armar(incluidas);
  return { enviar: true, texto, texto_html: escaparHtml(texto), total_errores: errores.length, total_conversaciones: conversaciones.size };
}

// ---------------------------------------------------------------------------
// Costo y operativa: armado de la alerta a partir de los resultados de otras funciones
// ---------------------------------------------------------------------------

/**
 * Alerta de costo a partir del resultado de `evaluarAlertaCostoEvaluacion` o
 * `evaluarAlertaCostoLote` (js/costo.js): { evaluable, disparar, valor_observado, umbral }.
 * Devuelve null si no hay nada que enviar (no se evaluó o no se superó el umbral).
 */
function armarAlertaCosto(resultado, { ambito, conversation_id: conversationId = '', lote = '' }) {
  if (!resultado || !resultado.evaluable || !resultado.disparar) return null;
  const texto = textoAlertaCosto({ ambito, conversation_id: conversationId, lote, valor_observado: resultado.valor_observado, umbral: resultado.umbral });
  return {
    tipo_alerta: 'costo',
    modo_envio: 'inmediato',
    workflow: 'evaluacion',
    conversation_id: ambito === 'lote' ? '' : conversationId,
    lote,
    valor_observado: resultado.valor_observado,
    umbral: resultado.umbral,
    texto,
    texto_html: escaparHtml(texto),
  };
}

function armarAlertaCalibracion(datos) {
  const texto = textoAlertaCalibracion(datos);
  return {
    tipo_alerta: 'calibracion',
    modo_envio: 'inmediato',
    workflow: 'metricas',
    conversation_id: '',
    lote: datos.lote,
    nombre_metrica: datos.nombre_metrica,
    valor_observado: datos.valor_observado,
    umbral: datos.umbral,
    texto,
    texto_html: escaparHtml(texto),
  };
}

/** Alerta operativa lista para enviar y registrar. `datos` como en `textoAlertaOperativa`. */
function armarAlertaOperativa(datos) {
  const texto = textoAlertaOperativa(datos);
  return {
    tipo_alerta: 'operativa',
    modo_envio: 'inmediato',
    workflow: datos.workflow,
    conversation_id: datos.conversation_id || '',
    lote: datos.lote || '',
    texto,
    texto_html: escaparHtml(texto),
  };
}

// ---------------------------------------------------------------------------
// Armado por evaluación y cierre de lote (para el workflow de Evaluación)
// ---------------------------------------------------------------------------

/**
 * Quita de `envios` las alertas de calidad que ya se enviaron antes (reproceso o reevaluación de la
 * misma conversación). Regla del dueño: no se reenvía si la hoja `alertas` ya tiene una fila con
 * tipo_alerta = 'calidad', estado_envio = 'enviada' y la misma pareja (conversation_id, id_criterio).
 *  - Una fila previa 'fallida' NO bloquea: ese aviso nunca llegó, así que se reintenta.
 *  - Las alertas de costo (y cualquier otra que no sea de calidad) pasan siempre.
 * Las filas llegan de Google Sheets como texto: se comparan sin espacios sobrantes. Filas nulas o con
 * campos vacíos se ignoran sin tronar.
 * Devuelve { envios, omitidas_ya_enviadas } (cuántas se quitaron, para trazabilidad).
 */
function filtrarAlertasCalidadYaEnviadas(envios, filasAlertasExistentes) {
  const limpio = (v) => String(v === undefined || v === null ? '' : v).trim();
  const yaEnviadas = new Set();
  for (const fila of filasAlertasExistentes || []) {
    if (!fila || limpio(fila.tipo_alerta) !== 'calidad' || limpio(fila.estado_envio) !== 'enviada') continue;
    yaEnviadas.add(`${limpio(fila.conversation_id)} ${limpio(fila.id_criterio)}`);
  }
  const lista = envios || [];
  const resultado = lista.filter((e) => !(e && e.tipo_alerta === 'calidad' && yaEnviadas.has(`${limpio(e.conversation_id)} ${limpio(e.id_criterio)}`)));
  return { envios: resultado, omitidas_ya_enviadas: lista.length - resultado.length };
}

/**
 * Alertas que salen de UNA evaluación: las de calidad inmediatas (lote demo) y, si dispara, la de
 * costo por evaluación. `acumular` trae los errores críticos que se guardan para el resumen del lote
 * (lotes de calibración).
 * resultadoAlertaCosto: resultado de evaluarAlertaCostoEvaluacion (costo.js).
 * filasAlertasExistentes (opcional): filas de la hoja `alertas`; si se pasa, no se reenvían las de
 * calidad ya enviadas (ver filtrarAlertasCalidadYaEnviadas). Sin ella, el resultado es el de siempre.
 * Devuelve { envios, acumular, omitidas_ya_enviadas }.
 */
function alertasDeEvaluacion(evaluacion, resultadoAlertaCosto, config, filasAlertasExistentes) {
  const calidad = prepararAlertasCalidad(evaluacion, config);
  const envios = [...calidad.envios];
  const costo = armarAlertaCosto(resultadoAlertaCosto, { ambito: 'evaluacion', conversation_id: evaluacion.conversation_id, lote: evaluacion.lote });
  if (costo) envios.push(costo);
  const filtrado = filtrarAlertasCalidadYaEnviadas(envios, filasAlertasExistentes);
  return { envios: filtrado.envios, acumular: calidad.acumular, omitidas_ya_enviadas: filtrado.omitidas_ya_enviadas };
}

// Copia de evaluarAlertaCostoLote de js/costo.js (sin require entre módulos). Los nombres llevan
// el sufijo "Alerta" para no chocar con los de costo.js si ambos archivos se pegan en el mismo
// nodo; una prueba comprueba que da lo mismo que el original.
function esNumeroAlerta(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}
function redondearAlerta(valor, decimales) {
  return Number(`${Math.round(Number(`${valor}e${decimales}`))}e-${decimales}`);
}
function alertaCostoLoteCopia(costos, config) {
  const tope = config.tope_costo_lote_usd;
  if (!esNumeroAlerta(tope)) return { evaluable: false, disparar: false, motivo: `tope_costo_lote_usd = ${tope}` };
  if (costos.some((c) => !esNumeroAlerta(c))) return { evaluable: false, disparar: false, motivo: 'hay evaluaciones con costo_usd desconocido' };
  const total = redondearAlerta(costos.reduce((a, c) => a + c, 0), 8);
  return { evaluable: true, disparar: total > tope, valor_observado: total, umbral: tope, motivo: null };
}

/**
 * Cierre de un lote: junta lo que dejó cada evaluación y arma, si corresponde, el resumen de
 * calidad y la alerta de costo del lote.
 * resultados: salidas de W2, cada una { acumular: [...], costo_usd } (o sin esos campos si terminó
 * en error). Los costos que no son número (null por precios por_verificar, o ausentes) se ignoran.
 * Devuelve { envios: [...] }; el resumen ya tiene la forma que espera filaAlertas
 * ({ tipo_alerta:'calidad', modo_envio:'resumen_lote', workflow:'evaluacion', lote, texto }).
 */
function cierreDeLote(resultados, lote, config) {
  const lista = resultados || [];
  const errores = lista.flatMap((r) => (r && Array.isArray(r.acumular) ? r.acumular : []));
  const costos = lista.map((r) => (r ? r.costo_usd : undefined)).filter(esNumeroAlerta);
  const envios = [];
  const resumen = armarResumenCalidadLote(errores, lote);
  if (resumen.enviar) envios.push({ tipo_alerta: 'calidad', modo_envio: 'resumen_lote', workflow: 'evaluacion', lote, texto: resumen.texto, texto_html: resumen.texto_html });
  const costo = armarAlertaCosto(alertaCostoLoteCopia(costos, config), { ambito: 'lote', lote });
  if (costo) envios.push(costo);
  return { envios };
}

/**
 * ¿Este tipo de error genera alerta operativa? (copia de js/registro_errores.js)
 *  - formulario_invalido: no; tipo_interaccion_sin_rubrica: según config; el resto: sí.
 */
function debeAlertar(tipoError, config) {
  if (tipoError === 'formulario_invalido') return false;
  if (tipoError === 'tipo_interaccion_sin_rubrica') return config.alerta_tipo_interaccion_sin_rubrica === true || config.alerta_tipo_interaccion_sin_rubrica === 'si';
  return true;
}

/**
 * Cierre cuando los resultados mezclan lotes (W4 reprocesa conversaciones de varios lotes): agrupa
 * por `lote` de cada resultado y aplica cierreDeLote por grupo, en el orden en que aparece cada lote.
 * Los resultados de W2 deben traer `lote`; los que no lo traen no se pueden asignar a un lote y se
 * omiten. Devuelve { envios } con los envíos de todos los grupos.
 */
function cierrePorLotes(resultados, config) {
  const grupos = new Map();
  for (const r of resultados || []) {
    if (!r || !r.lote) continue;
    if (!grupos.has(r.lote)) grupos.set(r.lote, []);
    grupos.get(r.lote).push(r);
  }
  const envios = [];
  for (const [lote, lista] of grupos) envios.push(...cierreDeLote(lista, lote, config).envios);
  return { envios };
}

// ---------------------------------------------------------------------------
// Fila de la hoja `alertas`
// ---------------------------------------------------------------------------

/**
 * Estado del envío según la respuesta del nodo Telegram. La API de Telegram responde
 * `{ ok: true, result: ... }` si salió bien. Con "continuar con salida de error", una falla llega
 * como un objeto sin `ok: true` (por ejemplo `{ error: ... }`). Todo lo que no sea ok -> fallida.
 */
function estadoEnvio(respuestaTelegram) {
  return respuestaTelegram && respuestaTelegram.ok === true ? 'enviada' : 'fallida';
}

function numeroOVacio(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : '';
}

/**
 * Fila de `alertas` (17 columnas exactas).
 * alerta: una de las que devuelven `armarAlerta*`, `prepararAlertasCalidad().envios[i]` o la de
 *         resumen ({ tipo_alerta:'calidad', modo_envio:'resumen_lote', workflow:'evaluacion',
 *         lote, texto }). Vacíos según sheets.md: en resumen y calibración `conversation_id` va
 *         vacío; `agente`/`id_criterio` solo en calidad; `nombre_metrica` solo en calibración.
 * resultadoEnvio: respuesta del nodo Telegram (ver estadoEnvio).
 */
function filaAlertas(alerta, resultadoEnvio, config, ahora = new Date(), consecutivo = 1) {
  if (!TIPOS_ALERTA.includes(alerta.tipo_alerta)) throw new Error(`tipo_alerta fuera del glosario: ${JSON.stringify(alerta.tipo_alerta)}`);
  if (!MODOS_ENVIO.includes(alerta.modo_envio)) throw new Error(`modo_envio fuera del glosario: ${JSON.stringify(alerta.modo_envio)}`);
  if (!WORKFLOWS.includes(alerta.workflow)) throw new Error(`workflow fuera del glosario: ${JSON.stringify(alerta.workflow)}`);
  if (alerta.tipo_alerta === 'calibracion' && !NOMBRES_METRICA.includes(alerta.nombre_metrica)) {
    throw new Error(`nombre_metrica fuera del glosario: ${JSON.stringify(alerta.nombre_metrica)}`);
  }
  const esCalidad = alerta.tipo_alerta === 'calidad';
  return {
    id_alerta: generarIdAlerta(ahora, config.zona_horaria, consecutivo),
    enviada_en: marcaTiempoSistema(ahora, config.zona_horaria),
    tipo_alerta: alerta.tipo_alerta,
    modo_envio: alerta.modo_envio,
    workflow: alerta.workflow,
    conversation_id: alerta.conversation_id || '',
    lote: alerta.lote || '',
    agente: esCalidad ? alerta.agente || '' : '',
    id_criterio: esCalidad ? alerta.id_criterio || '' : '',
    nombre_metrica: alerta.tipo_alerta === 'calibracion' ? alerta.nombre_metrica : '',
    mensajes: esCalidad ? (alerta.mensajes || []).join('|') : '',
    evidencia: esCalidad ? limpiarTexto(alerta.evidencia, LONGITUD_MAXIMA_EVIDENCIA) : '',
    valor_observado: numeroOVacio(alerta.valor_observado),
    umbral: numeroOVacio(alerta.umbral),
    texto_enviado: alerta.texto,
    destinatario: config.telegram_destinatario,
    estado_envio: estadoEnvio(resultadoEnvio),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TIPOS_ALERTA,
    MODOS_ENVIO,
    COLUMNAS_ALERTAS,
    LIMITE_TELEGRAM,
    marcaTiempoSistema,
    limpiarTexto,
    escaparHtml,
    generarIdAlerta,
    modoAlertaCalidad,
    textoAlertaOperativa,
    textoAlertaCalidad,
    textoAlertaCosto,
    textoAlertaCalibracion,
    erroresCriticosDeEvaluacion,
    prepararAlertasCalidad,
    armarResumenCalidadLote,
    armarAlertaCosto,
    armarAlertaCalibracion,
    armarAlertaOperativa,
    filtrarAlertasCalidadYaEnviadas,
    alertasDeEvaluacion,
    alertaCostoLoteCopia,
    cierreDeLote,
    cierrePorLotes,
    debeAlertar,
    estadoEnvio,
    filaAlertas,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "Alerta de calidad", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * const config = $('Config cargada').first().json;
 * const r = prepararAlertasCalidad($json.evaluacion, config);
 * // r.envios: lista de { texto, ... } para enviar ahora (un ítem por alerta).
 * // r.acumular: errores a guardar para el resumen del lote (modo resumen_lote).
 * return r.envios.length ? r.envios.map((e) => ({ json: e })) : [{ json: { modo_envio: r.modo_envio, acumular: r.acumular } }];
 *
 * // Después del envío por Telegram, en otro nodo Code (modo "Run Once for Each Item"):
 * // return { json: filaAlertas($json, $('Telegram').item.json, config, new Date(), $itemIndex + 1) };
 * //
 * // Al final del lote: const resumen = armarResumenCalidadLote(todosLosErrores, lote);
 * // si resumen.enviar -> enviar resumen.texto y registrar filaAlertas({ tipo_alerta: 'calidad',
 * //   modo_envio: 'resumen_lote', workflow: 'evaluacion', lote, texto: resumen.texto }, ...).
 *
 * --- W2, nodo Code "Alertas de la evaluación" (Run Once for Each Item) ---
 * // filasAlertas = filas de la hoja `alertas` (array de objetos; [] si está vacía).
 * const r = alertasDeEvaluacion($json.evaluacion, $json.alerta_costo, config, filasAlertas);
 * return { json: { envios: r.envios, acumular: r.acumular, omitidas_ya_enviadas: r.omitidas_ya_enviadas, costo_usd: $json.evaluacion.consumo.costo_usd } };
 *
 * --- W2, cierre del lote, nodo Code "Cierre de lote" (Run Once for All Items) ---
 * // itemsDeEntrada = la lista de ítems de entrada del nodo (en n8n, el método "todos" del objeto de entrada).
 * const c = cierreDeLote(itemsDeEntrada.map((i) => i.json), lote, config);
 * return c.envios.map((e) => ({ json: e }));
 * ------------------------------------------------------------------------- */
