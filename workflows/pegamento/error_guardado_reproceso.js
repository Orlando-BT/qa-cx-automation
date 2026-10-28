// Error al guardar resultados: a reproceso (W2), salida de error de las escrituras en Sheets.
// Modo "Run Once for All Items". Fuentes: js/ingesta.js + js/registro_errores.js (debeAlertar).
const e = $('JS-8 Costo').first().json.evaluacion;
const config = $('JS-1 Normalización').first().json.config;
const registrar_error = {
  workflow: 'evaluacion', nodo: 'Guardar resultados', tipo_error: 'fallo_sheets',
  mensaje_error: `No se pudo guardar la evaluación en Sheets: ${$input.first().json.error}`,
  conversation_id: e.conversation_id, lote: e.lote, tipo_interaccion: e.tipo_interaccion, detalle: { id_evaluacion: e.id_evaluacion },
};
const actualizacion = actualizacionEstadoEvaluacion(e.llave_dedup, 'reproceso', config, new Date());
return [{ json: { actualizacion, registrar_error, enviar_alerta: debeAlertar(registrar_error.tipo_error, config), config } }];
