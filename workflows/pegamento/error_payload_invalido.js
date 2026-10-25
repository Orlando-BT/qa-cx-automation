// Error de payload inválido (W1). Modo "Run Once for Each Item". Fuente: js/registro_errores.js.
// Los errores de validarPayload solo traen ruta y regla (sin texto de mensajes).
const v = $json;
const config = $('Config cargada').first().json;
const p = v.payload || {};
const registrar_error = {
  workflow: 'ingesta', nodo: 'Validar payload', tipo_error: 'payload_invalido',
  mensaje_error: `Payload inválido: ${v.errores.length} error(es) de validación`,
  conversation_id: p.conversation_id, lote: v.lote, tipo_interaccion: p.tipo_interaccion, detalle: { errores: v.errores },
};
return { json: { registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, config), config } };
