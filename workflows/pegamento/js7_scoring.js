// JS-7 Scoring (W2). Modo "Run Once for Each Item". Fuente: js/scoring.js.
// El nodo lleva "On Error -> Continue (using error output)": si todas las secciones quedan
// no_aplica, el error se registra con tipo_error = evaluacion_sin_secciones_aplicables.
const contexto = $json;
contexto.evaluacion = construirEvaluacion(contexto);
return { json: contexto };
