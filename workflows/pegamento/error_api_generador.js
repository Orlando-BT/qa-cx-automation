// Error de API del generador (W0), Switch "Según respuesta HTTP" = falla_api.
// Modo "Run Once for Each Item". Fuente: js/registro_errores.js. La decisión es de clasificacion_http.js.
const item = $json;
const e = item.escenario;
const registrar_error = {
  workflow: 'simulador', nodo: 'Claude: generar conversación', tipo_error: 'fallo_api', mensaje_error: item.clasificacion_http.motivo,
  conversation_id: e.conversation_id, lote: e.lote, tipo_interaccion: e.tipo_interaccion,
  detalle: { codigo_http: item.clasificacion_http.codigo_http },
};
return { json: { registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
