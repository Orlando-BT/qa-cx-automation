// Envío a Ingesta (W0, paso 8). Modo "Run Once for Each Item". Fuente: js/simulador.js.
// armarPostIngesta copia SOLO los campos del payload (lista blanca) y pone ?lote= en la URL.
const item = $('Decidir intento de generación').item.json;
const url = $('URL de Ingesta').first().json.url_webhook_ingesta;
return { json: armarPostIngesta(item.payload, item.escenario.lote, url) };
