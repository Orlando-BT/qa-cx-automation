// Verificación: JS-1 Normalización (W0, paso 4). Modo "Run Once for Each Item". Fuente: js/normalizacion.js.
// Contexto de la conversación generada, solo para verificarEscenarioGenerado (no se guarda).
const item = $json;
const contexto = prepararContexto({
  payload: item.payload,
  lote: item.escenario.lote,
  filasConfig: $('Leer hoja config').all().map((i) => i.json),
  filasListas: $('Leer hoja listas').all().map((i) => i.json),
  filasCatalogo: $('Leer hoja catalogo_temas').all().map((i) => i.json),
  filasCuentas: $('Leer hoja cuentas').all().map((i) => i.json),
});
return { json: { ...item, contexto_verificacion: contexto } };
