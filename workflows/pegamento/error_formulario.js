// Error de formulario (W0). Modo "Run Once for Each Item". Fuente: js/registro_errores.js.
// Rechazo de validarFormulario o planificarEscenarios: se registra como formulario_invalido; debeAlertar
// devuelve false (sin Telegram) y el motivo se muestra en pantalla en "Formulario rechazado".
const config = $('Config general').first().json;
const registrar_error = {
  workflow: 'simulador', nodo: 'Validar formulario / Completar escenario', tipo_error: 'formulario_invalido',
  mensaje_error: $json.errores.join(' | '), detalle: { errores: $json.errores },
};
return { json: { registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, config), config } };
