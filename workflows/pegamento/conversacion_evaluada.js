// Conversación evaluada (W2). Modo "Run Once for All Items". Fuente: js/ingesta.js.
// Se ejecuta una vez aunque lleguen las 77 filas de detalle_criterios.
const e = $('JS-8 Costo').first().json.evaluacion;
const config = $('JS-1 Normalización').first().json.config;
return [{ json: actualizacionEstadoEvaluacion(e.llave_dedup, 'evaluada', config, new Date(), e.id_evaluacion) }];
