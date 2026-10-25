// Entrada a evaluación (W2). Modo "Run Once for All Items". Fuente: js/ingesta.js.
// La fila pasa a en_evaluacion y suma 1 a intentos (regla de sheets.md; la aplica la función).
const contexto = $('JS-1 Normalización').first().json;
const fila = $('Leer conversación').first().json;
return [{ json: actualizacionEntradaEvaluacion(fila, contexto.config, new Date()) }];
