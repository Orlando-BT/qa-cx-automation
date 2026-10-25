// JS-8 Costo (W2). Modo "Run Once for Each Item". Fuente: js/costo.js.
// uso_llm: [{ tokens_entrada, tokens_salida }] por llamada; anomalias_llm y estructura_salida_llm de JS-5.
// Las filas a escribir las calcula después "Planificar escritura" (solo lo que falte en Sheets).
const contexto = $json;
const consumo = calcularConsumo({
  intentos: contexto.uso_llm || [],
  sin_mensajes_agente: contexto.evaluacion.sin_mensajes_agente,
  config: contexto.config,
  anomalias_llm: contexto.anomalias_llm,
  estructura_salida_llm: contexto.estructura_salida_llm,
});
const evaluadoEn = marcaTiempoSistema(new Date(), contexto.config.zona_horaria);
const evaluacion = finalizarEvaluacion(contexto.evaluacion, consumo, evaluadoEn);
return { json: { evaluacion, alerta_costo: evaluarAlertaCostoEvaluacion(consumo.costo_usd, contexto.config) } };
