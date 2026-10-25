// Error de generación (W0), Switch "Según intento de generación" = generacion_invalida.
// Modo "Run Once for Each Item". Fuente: js/registro_errores.js. registrar_error viene de decidirIntentoGeneracion.
const item = $json;
const registrar_error = item.decision.registrar_error;
return { json: { registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, item.config), config: item.config } };
