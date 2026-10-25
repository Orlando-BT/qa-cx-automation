/**
 * JS-8 Costo (Workflow 2: Evaluación, paso 10) y armado final para Sheets.
 *
 * Reglas del contrato (config.md, sección 10 y notas de diseño):
 *  - Precios en USD por millón de tokens, leídos de config.
 *  - Si algún precio del evaluador está en `por_verificar`: se suman tokens pero
 *    `costo_usd = null` (celda vacía) y la alerta de costo no se puede evaluar.
 *  - `pendiente_fase_1` solo desactiva la alerta que depende de esa clave; el costo se
 *    calcula normalmente.
 *  - Conversación sin mensajes del agente (rubrica.md 3.12): no hubo llamada al LLM →
 *    tokens 0, intentos 0 y costo 0, aunque los precios estén en `por_verificar`.
 *
 * Este archivo también completa la evaluación (consumo y `evaluado_en`) y arma las filas
 * de `evaluaciones` y `detalle_criterios` con las columnas exactas de sheets.md.
 */

/** Decimales del costo en USD (SUPUESTO: el contrato no fija un redondeo para el costo). */
const DECIMALES_COSTO = 8;

function esNumero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function redondear(valor, decimales) {
  return Number(`${Math.round(Number(`${valor}e${decimales}`))}e-${decimales}`);
}

/** tokens × precio por millón. null si algún precio no es un número (por_verificar). */
function calcularCostoTokens(tokensEntrada, tokensSalida, precioEntrada, precioSalida) {
  if (!esNumero(precioEntrada) || !esNumero(precioSalida)) return null;
  return redondear((tokensEntrada * precioEntrada + tokensSalida * precioSalida) / 1e6, DECIMALES_COSTO);
}

/**
 * Lee los tokens de una respuesta de OpenAI. Acepta el formato de la API Responses
 * (`usage.input_tokens`, `usage.output_tokens`) y el de Chat Completions
 * (`usage.prompt_tokens`, `usage.completion_tokens`).
 */
function extraerUsoOpenAI(respuesta) {
  const uso = (respuesta && respuesta.usage) || {};
  return {
    tokens_entrada: uso.input_tokens ?? uso.prompt_tokens ?? 0,
    tokens_salida: uso.output_tokens ?? uso.completion_tokens ?? 0,
  };
}

/**
 * Consumo de una evaluación (tokens, intentos, anomalías del LLM y costo). `intentos` (el arreglo `uso_llm` del contexto; `intentos_llm` es el número) = una entrada por llamada al LLM (la original más
 * cada reenvío por respuesta inválida), cada una con {tokens_entrada, tokens_salida}.
 */
function calcularConsumo({ intentos, sin_mensajes_agente: sinAgente, config, anomalias_llm: anomalias = [], estructura_salida_llm: estructura = null }) {
  if (sinAgente) return { tokens_entrada: 0, tokens_salida: 0, intentos_llm: 0, anomalias_llm: [], costo_usd: 0 };
  const tokensEntrada = intentos.reduce((a, i) => a + (i.tokens_entrada || 0), 0);
  const tokensSalida = intentos.reduce((a, i) => a + (i.tokens_salida || 0), 0);
  return {
    tokens_entrada: tokensEntrada,
    tokens_salida: tokensSalida,
    intentos_llm: intentos.length,
    // Anomalías del evaluador (columna evaluaciones.anomalias_llm se DERIVA de este campo).
    anomalias_llm: normalizarAnomaliasLlm({ anomalias_llm: anomalias, estructura_salida_llm: estructura }),
    costo_usd: calcularCostoTokens(tokensEntrada, tokensSalida, config.precio_entrada_usd_millon_evaluador, config.precio_salida_usd_millon_evaluador),
  };
}

/**
 * Costo de generación del simulador (W0). null → celda vacía en escenarios.costo_generacion_usd.
 * Si los tokens son null o no vienen (la API no los mandó) el costo es DESCONOCIDO (null), no 0:
 * un 0 sería un dato falso.
 */
function calcularCostoGeneracion(tokensEntrada, tokensSalida, config) {
  if (!esNumero(tokensEntrada) || !esNumero(tokensSalida)) return null;
  return calcularCostoTokens(tokensEntrada, tokensSalida, config.precio_entrada_usd_millon_generador, config.precio_salida_usd_millon_generador);
}

/**
 * Alerta de costo por evaluación (D4): costo_usd > multiplicador × costo estimado.
 * Devuelve si se pudo evaluar y por qué no, para que el workflow no envíe alertas falsas.
 */
function evaluarAlertaCostoEvaluacion(costoUsd, config) {
  const estimado = config.costo_estimado_por_evaluacion_usd;
  if (!esNumero(costoUsd)) return { evaluable: false, disparar: false, motivo: 'costo_usd desconocido (precios por_verificar)' };
  if (!esNumero(estimado)) return { evaluable: false, disparar: false, motivo: `costo_estimado_por_evaluacion_usd = ${estimado}` };
  const umbral = config.multiplicador_alerta_costo * estimado;
  return { evaluable: true, disparar: costoUsd > umbral, valor_observado: costoUsd, umbral, motivo: null };
}

/**
 * Alerta de costo por lote (D4): costo acumulado > tope. Si alguna evaluación tiene costo
 * desconocido (null), el acumulado no es confiable y no se evalúa (SUPUESTO).
 */
function evaluarAlertaCostoLote(costos, config) {
  const tope = config.tope_costo_lote_usd;
  if (!esNumero(tope)) return { evaluable: false, disparar: false, motivo: `tope_costo_lote_usd = ${tope}` };
  if (costos.some((c) => !esNumero(c))) return { evaluable: false, disparar: false, motivo: 'hay evaluaciones con costo_usd desconocido' };
  const total = redondear(costos.reduce((a, c) => a + c, 0), DECIMALES_COSTO);
  return { evaluable: true, disparar: total > tope, valor_observado: total, umbral: tope, motivo: null };
}

/**
 * Marca de tiempo del sistema: ISO 8601 con desfase y sin milisegundos, en la zona de
 * config (por ejemplo 2026-10-21T10:05:20-06:00).
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

/** Completa la evaluación de JS-7 con el consumo y `evaluado_en`. */
function finalizarEvaluacion(evaluacion, consumo, evaluadoEn) {
  return {
    ...evaluacion,
    consumo,
    marcas_tiempo: { ...evaluacion.marcas_tiempo, evaluado_en: evaluadoEn },
  };
}

// ---------------------------------------------------------------------------
// Filas para Sheets (columnas exactas de contrato/sheets.md)
// ---------------------------------------------------------------------------

const siNo = (b) => (b ? 'si' : 'no');
const vacioSiNulo = (v) => (v === null || v === undefined ? '' : v);

/** Orden fijo de las anomalías de la columna `anomalias_llm` (sheets.md, hoja evaluaciones). */
const ORDEN_ANOMALIAS_LLM = ['incompleta', 'refusal', 'commentary'];

/**
 * Anomalías de las llamadas al LLM, normalizadas para la columna `anomalias_llm`.
 *  - `anomalias_llm`: arreglo que deja procesarRespuestaEvaluador ('incompleta' / 'refusal').
 *  - `estructura_salida_llm.anomalias`: si trae `fase_commentary_ignorada`, el modelo mandó un
 *    comentario intermedio que se ignoró -> 'commentary'.
 * Sin duplicados y en el orden fijo incompleta, refusal, commentary. Sin LLM
 * (`sin_mensajes_agente`) devuelve [].
 */
function normalizarAnomaliasLlm({ anomalias_llm: anomalias = [], estructura_salida_llm: estructura = null, sin_mensajes_agente: sinAgente = false } = {}) {
  if (sinAgente) return [];
  const encontradas = new Set(Array.isArray(anomalias) ? anomalias : []);
  const deEstructura = estructura && Array.isArray(estructura.anomalias) ? estructura.anomalias : [];
  if (deEstructura.includes('fase_commentary_ignorada')) encontradas.add('commentary');
  return ORDEN_ANOMALIAS_LLM.filter((a) => encontradas.has(a));
}

/**
 * Fila de la hoja `evaluaciones` (30 columnas, en orden). La columna `anomalias_llm` se deriva de
 * `e.consumo.anomalias_llm` (nunca se calcula por separado), unida con `|`.
 */
function filaEvaluaciones(e) {
  return {
    id_evaluacion: e.id_evaluacion,
    llave_dedup: e.llave_dedup,
    conversation_id: e.conversation_id,
    lote: e.lote,
    canal: e.canal,
    tipo_interaccion: e.tipo_interaccion,
    agente: e.agente,
    cuenta_id: e.cuenta_id,
    version_reglas: e.version_reglas,
    version_prompt: e.version_prompt,
    modelo_evaluador: vacioSiNulo(e.modelo_evaluador),
    tema_detectado: vacioSiNulo(e.tema_detectado),
    emocion_cliente: vacioSiNulo(e.emocion_cliente),
    nota_base: e.nota_base,
    nota_final: e.nota_final,
    meta_calidad: e.meta_calidad,
    cumple_meta: siNo(e.cumple_meta),
    calidad: e.calidad,
    tiene_error_critico: siNo(e.tiene_error_critico),
    sin_mensajes_agente: siNo(e.sin_mensajes_agente),
    errores_criticos: e.errores_criticos.map((c) => c.id_critico).join('|'),
    tokens_entrada: e.consumo.tokens_entrada,
    tokens_salida: e.consumo.tokens_salida,
    intentos_llm: e.consumo.intentos_llm,
    costo_usd: vacioSiNulo(e.consumo.costo_usd),
    recibido_en: e.marcas_tiempo.recibido_en,
    iniciado_en: e.marcas_tiempo.iniciado_en,
    evaluado_en: e.marcas_tiempo.evaluado_en,
    evaluacion_json: JSON.stringify(e),
    anomalias_llm: e.sin_mensajes_agente ? '' : (e.consumo.anomalias_llm || []).join('|'),
  };
}

/** Filas de `detalle_criterios`: una por sección y una por criterio (77 con reglas_ce_v1). */
function filasDetalleCriterios(e) {
  const comunes = {
    id_evaluacion: e.id_evaluacion,
    conversation_id: e.conversation_id,
    lote: e.lote,
    tipo_interaccion: e.tipo_interaccion,
    version_reglas: e.version_reglas,
    version_prompt: e.version_prompt,
  };
  const filas = e.secciones.map((s) => ({
    ...comunes,
    id_criterio: s.id_seccion,
    tipo_criterio: 'seccion',
    seccion: s.id_seccion,
    origen: '',
    clasificacion: '',
    peso: s.peso,
    resultado: s.resultado,
    mensajes: '',
    evidencia_dato: `clave fallidos: ${s.clave_fallidos.join(', ') || 'ninguno'}; complementarios fallidos: ${s.complementarios_fallidos} de ${s.complementarios_aplicables}`,
    justificacion: '',
    evaluado_en: e.marcas_tiempo.evaluado_en,
  }));
  for (const c of e.criterios) {
    filas.push({
      ...comunes,
      id_criterio: c.id_criterio,
      tipo_criterio: c.tipo_criterio,
      seccion: c.seccion,
      origen: c.origen,
      clasificacion: vacioSiNulo(c.clasificacion),
      peso: '',
      resultado: c.resultado,
      mensajes: c.evidencia.mensajes.join('|'),
      evidencia_dato: c.evidencia.dato,
      justificacion: c.justificacion,
      evaluado_en: e.marcas_tiempo.evaluado_en,
    });
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Escritura idempotente de los resultados de W2
// ---------------------------------------------------------------------------

/**
 * Qué falta escribir en `evaluaciones` y `detalle_criterios` (regla del dueño: una sola fila por
 * `llave_dedup` en evaluaciones y una sola por `id_evaluacion` + `id_criterio` en detalle_criterios).
 * Así una doble ejecución no duplica nada y una escritura parcial anterior se completa con lo que
 * falta.
 *
 * El `id_evaluacion` se DERIVA de la llave (EVAL-<conversation_id>-<version_reglas>-<version_prompt>);
 * si la evaluación trae otro, es un error del flujo y se detiene.
 *
 * filasEvaluacionesExistentes / filasDetalleExistentes: filas ya leídas de Sheets (basta con las de
 * esta llave o este id_evaluacion; se comparan como texto).
 * Devuelve { escribir_evaluacion, filas_evaluacion: [fila]|[], filas_detalle: [solo las que faltan] }.
 */
function planificarEscrituraResultados({ evaluacion, filasEvaluacionesExistentes = [], filasDetalleExistentes = [] }) {
  const idEsperado = `EVAL-${String(evaluacion.llave_dedup).split('|').join('-')}`;
  if (evaluacion.id_evaluacion !== idEsperado) {
    throw new Error(`id_evaluacion no corresponde a la llave_dedup (esperado ${idEsperado}, llegó ${evaluacion.id_evaluacion})`);
  }
  const yaHayEvaluacion = filasEvaluacionesExistentes.some((f) => String(f.llave_dedup) === String(evaluacion.llave_dedup));
  const existentes = new Set(filasDetalleExistentes.map((f) => `${f.id_evaluacion}|${f.id_criterio}`));
  const faltantes = filasDetalleCriterios(evaluacion).filter((f) => !existentes.has(`${f.id_evaluacion}|${f.id_criterio}`));
  return {
    escribir_evaluacion: !yaHayEvaluacion,
    filas_evaluacion: yaHayEvaluacion ? [] : [filaEvaluaciones(evaluacion)],
    filas_detalle: faltantes,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calcularCostoTokens,
    extraerUsoOpenAI,
    calcularConsumo,
    calcularCostoGeneracion,
    evaluarAlertaCostoEvaluacion,
    evaluarAlertaCostoLote,
    marcaTiempoSistema,
    finalizarEvaluacion,
    normalizarAnomaliasLlm,
    filaEvaluaciones,
    filasDetalleCriterios,
    planificarEscrituraResultados,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "JS-8 Costo", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * const contexto = $json;
 * // Convención: `intentos_llm` es un NÚMERO (cuántos intentos); `uso_llm` es el arreglo
 * // [{tokens_entrada, tokens_salida}], una entrada por intento, acumulado por JS-5 en cada
 * // llamada (usa extraerUsoOpenAI(respuesta) sobre cada respuesta de OpenAI).
 * const consumo = calcularConsumo({
 *   intentos: contexto.uso_llm || [],
 *   sin_mensajes_agente: contexto.evaluacion.sin_mensajes_agente,
 *   config: contexto.config,
 *   anomalias_llm: contexto.anomalias_llm,                 // etiquetas incompleta/refusal de JS-5
 *   estructura_salida_llm: contexto.estructura_salida_llm, // aporta la anomalía commentary
 * });
 * const evaluadoEn = marcaTiempoSistema(new Date(), contexto.config.zona_horaria);
 * const evaluacion = finalizarEvaluacion(contexto.evaluacion, consumo, evaluadoEn);
 * return {
 *   json: {
 *     evaluacion,
 *     fila_evaluaciones: filaEvaluaciones(evaluacion),
 *     filas_detalle_criterios: filasDetalleCriterios(evaluacion),
 *     alerta_costo: evaluarAlertaCostoEvaluacion(consumo.costo_usd, contexto.config),
 *   },
 * };
 * ------------------------------------------------------------------------- */
