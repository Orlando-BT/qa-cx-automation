// JS-5 Validación de la respuesta (W2). Modo "Run Once for Each Item".
// Fuentes: js/validador_llm.js + js/costo.js (extraerUsoOpenAI se pasa como parámetro).
// Toda la decisión está en procesarRespuestaEvaluador: el Switch siguiente solo lee `accion`.
const item = $input.item.json; // salida de "Clasificar respuesta OpenAI" (accion HTTP = continuar)
const r = procesarRespuestaEvaluador({
  respuestaHttp: item.respuesta_http,
  item,
  esquema: $('Esquema LLM').first().json.esquema_llm,
  base_conocimiento: $('Leer hoja base_conocimiento').all().map((i) => i.json),
  extraerUso: extraerUsoOpenAI,
});
return { json: { ...item, ...r } };
