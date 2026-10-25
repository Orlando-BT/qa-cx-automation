// JS-6 Reglas híbridas (W2). Modo "Run Once for Each Item". Fuente: js/reglas_hibridas.js.
// contexto.llm = salida del LLM validada por JS-5 (respuesta_llm), o null si no hubo llamada
// porque la conversación no tiene mensajes del agente (rubrica.md 3.12).
const contexto = $json;
contexto.llm = contexto.respuesta_llm || null;
contexto.resultados_hibridos = evaluarReglasHibridas(contexto);
return { json: contexto };
