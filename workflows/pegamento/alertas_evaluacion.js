// Preparar alertas de la evaluación (W2). Modo "Run Once for All Items". Fuente: js/alertas.js.
// envios: calidad inmediata (lote demo) y costo si dispara; acumular: críticos para el resumen del lote.
// Filas de `alertas` de esta conversación: alertasDeEvaluacion no reenvía las de calidad ya enviadas.
// Sin filas llega {} (alwaysOutputData) y si la lectura falló llega { error }: la función los ignora.
const r8 = $('JS-8 Costo').first().json;
const config = $('JS-1 Normalización').first().json.config;
const filas = $('Leer alertas de la conversación').all().map((i) => i.json);
const r = alertasDeEvaluacion(r8.evaluacion, r8.alerta_costo, config, filas);
return [{ json: { envios: r.envios, acumular: r.acumular, omitidas_ya_enviadas: r.omitidas_ya_enviadas, config } }];
