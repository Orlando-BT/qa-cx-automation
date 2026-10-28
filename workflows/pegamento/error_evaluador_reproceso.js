// Error del evaluador: a reproceso (W2), Switch "Según validación" = falla_api.
// Modo "Run Once for Each Item". Fuentes: js/ingesta.js + js/registro_errores.js (debeAlertar). detalle_log ya viene sin texto (JS-5).
const item = $json;
const d = item.detalle_log;
const p = item.payload;
const registrar_error = {
  workflow: 'evaluacion', nodo: 'JS-5 Validación de la respuesta', tipo_error: d.tipo_error,
  mensaje_error: `Respuesta del evaluador no utilizable (${d.causa}); la conversación va a la cola de reproceso`,
  conversation_id: p.conversation_id, lote: item.lote, tipo_interaccion: p.tipo_interaccion, detalle: d,
};
const actualizacion = actualizacionEstadoEvaluacion(item.llave_dedup, 'reproceso', item.config, new Date());
return { json: { actualizacion, registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
