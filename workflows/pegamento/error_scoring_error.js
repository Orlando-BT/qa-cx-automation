// Error de scoring: a error (W2), salida de error de "JS-7 Scoring" (rubrica.md 2.2: todas las
// secciones no_aplica). Modo "Run Once for Each Item". Fuentes: js/ingesta.js + js/registro_errores.js (debeAlertar).
const item = $('JS-6 Reglas híbridas').item.json;
const p = item.payload;
const registrar_error = {
  workflow: 'evaluacion', nodo: 'JS-7 Scoring', tipo_error: 'evaluacion_sin_secciones_aplicables',
  mensaje_error: `JS-7 no pudo calcular la nota: ${$json.error}`,
  conversation_id: p.conversation_id, lote: item.lote, tipo_interaccion: p.tipo_interaccion, detalle: {},
};
const actualizacion = actualizacionEstadoEvaluacion(item.llave_dedup, 'error', item.config, new Date());
return { json: { actualizacion, registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
