// Cierre del lote (W4), después de reenviar la cola de reproceso. Modo "Run Once for All Items".
// Fuente: js/alertas.js. La cola puede mezclar lotes: cierrePorLotes agrupa por el `lote` de cada
// resultado de W2 y arma un resumen y una alerta de costo por lote.
const config = $('Config cargada').first().json;
const r = cierrePorLotes($input.all().map((i) => i.json), config);
return r.envios.map((e) => ({ json: { ...e, config } }));
