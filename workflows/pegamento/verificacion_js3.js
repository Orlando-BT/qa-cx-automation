// Verificación: JS-3 Reglas deterministas (W0, paso 4). Modo "Run Once for Each Item". Fuente: js/reglas.js.
const item = $json;
item.contexto_verificacion.resultados_js = evaluarReglasJS(item.contexto_verificacion);
return { json: item };
