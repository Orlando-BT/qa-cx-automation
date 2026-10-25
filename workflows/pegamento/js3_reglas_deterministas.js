// JS-3 Reglas deterministas (W2). Modo "Run Once for Each Item". Fuente: js/reglas.js.
// Si contexto.resultados_js.variables.sin_mensajes_agente es true, el workflow no llama al LLM.
const contexto = $json; // salida de JS-2
contexto.resultados_js = evaluarReglasJS(contexto);
return { json: contexto };
