// Valores del generador (W0, paso 3a). Modo "Run Once for Each Item". Fuente: js/construccion_prompt.js.
// La plantilla (prompts/generador_ce_vN.md, nodo "Plantilla generador", antes en la cadena) dice qué
// marcadores llenar.
const item = $input.item.json; // { escenario, cuenta, extras } de completarEscenario
const config = $('Config cargada').first().json;
const valores = valoresGenerador({
  escenario: item.escenario,
  extras: item.extras,
  cuenta: item.cuenta,
  catalogo_temas: $('Leer hoja catalogo_temas').all().map((i) => i.json),
  base_conocimiento: $('Leer hoja base_conocimiento').all().map((i) => i.json),
  listas: $('Leer hoja listas').all().map((i) => i.json),
  config,
  tipo_interaccion: item.escenario.tipo_interaccion,
  plantilla: $('Plantilla generador').first().json.plantilla_generador,
});
return { json: { ...item, config, valores_generador: valores, intento_generacion: 0 } };
