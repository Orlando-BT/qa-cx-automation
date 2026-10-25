// Fila alertas (cierre del lote) (W1 manual y W4), después del Telegram (salida normal o de error).
// Modo "Run Once for Each Item". Fuente: js/alertas.js.
const alerta = $('Cierre del lote').item.json;
return { json: filaAlertas(alerta, $json, alerta.config, new Date(), $itemIndex + 1) };
