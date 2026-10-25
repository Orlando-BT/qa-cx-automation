// Fila alertas (evaluación) (W2), después del Telegram (salida normal o de error).
// Modo "Run Once for Each Item". Fuente: js/alertas.js. estado_envio sale de la respuesta de Telegram.
const alerta = $('Separar alertas').item.json;
const config = $('Preparar alertas de la evaluación').first().json.config;
return { json: filaAlertas(alerta, $json, config, new Date(), $itemIndex + 1) };
