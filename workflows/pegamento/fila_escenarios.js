// Fila de escenarios (W0, paso 5). Modo "Run Once for Each Item". Fuentes: js/simulador.js + js/costo.js.
// La verdad sale del escenario (parámetros de W0), nunca de la salida del modelo.
// calcularCostoGeneracion devuelve null sin tokens o con precios por_verificar: la celda queda vacía.
const item = $json;
const l = item.lectura_generador;
const cfg = item.config;
const generacion = {
  modelo_generador: cfg.modelo_generador,
  version_prompt_generador: cfg.version_prompt_generador,
  tokens_entrada: l.tokens_entrada,
  tokens_salida: l.tokens_salida,
  costo_generacion_usd: calcularCostoGeneracion(l.tokens_entrada, l.tokens_salida, cfg),
  generado_en: new Date(),
};
return { json: filaEscenarios(item.escenario, generacion, cfg) };
