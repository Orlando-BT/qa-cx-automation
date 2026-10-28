// Error HTTP del evaluador: a reproceso (W2), Switch "Según respuesta HTTP" = falla_api.
// Modo "Run Once for Each Item". Fuentes: js/ingesta.js + js/registro_errores.js (debeAlertar). La decisión (falla_api) es de clasificacion_http.js.
const item = $json;
const c = item.clasificacion_http;
const p = item.payload;
const registrar_error = {
  workflow: 'evaluacion', nodo: 'OpenAI: evaluar conversación', tipo_error: 'fallo_api', mensaje_error: c.motivo,
  conversation_id: p.conversation_id, lote: item.lote, tipo_interaccion: p.tipo_interaccion,
  detalle: { codigo_http: c.codigo_http, intento_conexion: item.intento_conexion },
};
const actualizacion = actualizacionEstadoEvaluacion(item.llave_dedup, 'reproceso', item.config, new Date());
return { json: { actualizacion, registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
