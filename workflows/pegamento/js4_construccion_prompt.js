// JS-4 Construcción del prompt (W2). Modo "Run Once for Each Item". Fuente: js/construccion_prompt.js.
// Contadores del flujo: intentos_llm (llamadas al evaluador), intentos_incompleta, uso_llm y
// anomalias_llm (los acumula JS-5) e intento_conexion (reintentos por 429/5xx).
const item = $input.item.json; // contexto de JS-1 a JS-3
const cuerpo = construirPeticion({
  plantilla: $('Plantilla evaluador').first().json.plantilla_evaluador,
  esquema: $('Esquema LLM').first().json.esquema_llm,
  mensajes: item.extraccion.mensajes_enmascarados,
  termina_por_inactividad: item.resultados_js.variables.termina_por_inactividad,
  catalogo_temas: item.catalogo,
  base_conocimiento: $('Leer hoja base_conocimiento').all().map((i) => i.json),
  tipo_interaccion: item.payload.tipo_interaccion,
  config: item.config,
});
const contadores = { intentos_llm: 1, intentos_incompleta: 0, uso_llm: [], anomalias_llm: [], intento_conexion: 0 };
return { json: { ...item, peticion_openai: cuerpo, ...contadores } };
