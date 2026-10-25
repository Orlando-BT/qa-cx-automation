// Error al enviar a Ingesta (W0), salida de error de "POST a Ingesta".
// Modo "Run Once for Each Item". Fuente: js/registro_errores.js.
const item = $('Decidir intento de generación').item.json;
const e = item.escenario;
const registrar_error = {
  workflow: 'simulador', nodo: 'POST a Ingesta', tipo_error: 'fallo_nodo', mensaje_error: String($json.error),
  conversation_id: e.conversation_id, lote: e.lote, tipo_interaccion: e.tipo_interaccion, detalle: {},
};
return { json: { registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
