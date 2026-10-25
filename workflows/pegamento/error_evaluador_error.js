// Error del evaluador: a error (W2), Switch "Según validación" = rechazo_llm o respuesta_llm_invalida.
// Modo "Run Once for Each Item". Fuentes: js/ingesta.js + js/registro_errores.js (debeAlertar). Sin reproceso: queda para revisión manual.
const item = $json;
const d = item.detalle_log;
const p = item.payload;
const registrar_error = {
  workflow: 'evaluacion', nodo: 'JS-5 Validación de la respuesta', tipo_error: d.tipo_error,
  mensaje_error: `Respuesta del evaluador inválida (${d.causa}); la conversación queda en error para revisión manual`,
  conversation_id: p.conversation_id, lote: item.lote, tipo_interaccion: p.tipo_interaccion, detalle: d,
};
const actualizacion = actualizacionEstadoEvaluacion(item.llave_dedup, 'error', item.config, new Date());
return { json: { ...actualizacion, registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
