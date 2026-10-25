// Fila alertas (operativa) (cadena común), después del Telegram (salida normal o de error).
// Modo "Run Once for Each Item". Fuente: js/alertas.js.
const alerta = $('Armar alerta operativa').item.json;
return { json: filaAlertas(alerta, $json, alerta.config, new Date(), $itemIndex + 1) };
