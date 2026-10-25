// Error de Sheets del simulador (W0), salida de error de "Escribir escenarios" o "Escribir revision_humana".
// Modo "Run Once for Each Item". Fuente: js/registro_errores.js.
const item = $('Decidir intento de generación').item.json;
const e = item.escenario;
const registrar_error = {
  workflow: 'simulador', nodo: 'Escribir escenarios / revision_humana', tipo_error: 'fallo_sheets', mensaje_error: String($json.error),
  conversation_id: e.conversation_id, lote: e.lote, tipo_interaccion: e.tipo_interaccion, detalle: {},
};
return { json: { registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
