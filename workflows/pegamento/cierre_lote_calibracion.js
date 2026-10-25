// Cierre del lote (W1, disparador manual), después de evaluar todas las pendientes.
// Modo "Run Once for All Items". Fuente: js/alertas.js. Entrada: una salida de W2 por conversación.
const config = $('Config de calibración').first().json;
const lote = $('Parámetros de calibración').first().json.lote;
const r = cierreDeLote($input.all().map((i) => i.json), lote, config);
return r.envios.map((e) => ({ json: { ...e, config } }));
