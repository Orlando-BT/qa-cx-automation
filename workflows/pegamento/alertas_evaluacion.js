// Preparar alertas de la evaluación (W2). Modo "Run Once for All Items". Fuente: js/alertas.js.
// envios: calidad inmediata (lote demo) y costo si dispara; acumular: críticos para el resumen del lote.
const r8 = $('JS-8 Costo').first().json;
const config = $('JS-1 Normalización').first().json.config;
const r = alertasDeEvaluacion(r8.evaluacion, r8.alerta_costo, config);
return [{ json: { envios: r.envios, acumular: r.acumular, config } }];
